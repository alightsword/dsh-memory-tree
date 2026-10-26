/**
 * dsh-memory-tree — DSH native plugin entry.
 *
 * Cross-session three-tier memory (L1 transient / L2 short-term / L3 long-term)
 * with write-before-conflict interception.
 *
 * All registrations go through ctx as reversible effects so the runtime cleans
 * up on unload. All storage is fail-open.
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import type { MemoryConfig } from './types.js'
import { DEFAULT_CONFIG } from './types.js'
import { MemoryStore, resolveBaseDir } from './store.js'
import { detectConflict } from './conflict.js'
import { runSnapshot, SNAPSHOT_SECTION_NAME, SNAPSHOT_SECTION_ORDER } from './snapshot.js'
import { runRecall } from './recall.js'
import { runGovernance, decayWeight } from './forgetting.js'
import { createLifecycle } from './lifecycle.js'
import { memoryAddTool } from './tools/memory_add.js'
import { memoryReplaceTool } from './tools/memory_replace.js'
import { memoryResolveTool } from './tools/memory_resolve.js'
import { memoryRecallTool } from './tools/memory_recall.js'
import { memoryShowTool } from './tools/memory_show.js'
import { Config } from './config-schema.js'

export const name = 'dsh-memory-tree'

export const inject = ['tools', 'systemPrompt', 'agents', 'webServer']

export { Config }

/**
 * The persona PREFIX section carries `complete: true` when the deployment runs
 * in complete mode (`dsh-persona/lib/index.js`, and dsh-system-prompt exports
 * both PERSONA_PREFIX_SECTION and PERSONA_SUFFIX_SECTION).
 */
const PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'

export interface MemoryTreeConfig {
  baseDir?: string
  config?: Partial<MemoryConfig>
}

export function apply(ctx: Context, rawConfig?: MemoryTreeConfig) {
  const config: MemoryConfig = { ...DEFAULT_CONFIG, ...(rawConfig?.config ?? {}) }
  const baseDir = config.base_dir || rawConfig?.baseDir || undefined
  const store = new MemoryStore(resolveBaseDir(baseDir))

  ctx.effect(() => {
    void store.ensureSkeleton()
    return () => {}
  })

  const log = async (event: string, detail?: unknown): Promise<void> => {
    if (!config.logging_enabled) return
    try {
      await store.appendDecisionLog({ ts: Date.now(), event, detail })
    } catch {
      /* fail-open */
    }
  }

  const llmOpposition = async (candidate: string, existing: string): Promise<boolean> => {
    try {
      const llm = (ctx as any).llm
      if (!llm?.complete) return false
      const out = await llm.complete(
        '你是一个记忆冲突检测器。判断下面两条表达在语义上是否相反（互相矛盾）。' +
          '只回答 true 或 false。\n' +
          `A: ${candidate}\nB: ${existing}`,
      )
      const text = String(out).trim().toLowerCase()
      return text.startsWith('true') || text.includes('是') || text === '1'
    } catch {
      return false
    }
  }

  // Live text per section name + which names are already registered on the
  // systemPrompt registry (duplicate registration throws inside a layer).
  const injectedSections = new Map<string, string>()
  const registeredSections = new Set<string>()

  // --- snapshot deps -------------------------------------------------------
  const snapshotDeps = {
    store,
    config,
    isCompleteMode: () => {
      // complete:true lives on the persona PREFIX section, not on
      // `deployment:persona` (that name never exists — see
      // dsh-persona/lib/index.js: PERSONA_PREFIX_SECTION). Read it through the
      // public ScopedLayers.merge() (dsh-scope), never a private `_layers`.
      const sp = (ctx as any).systemPrompt as any
      try {
        const merged = sp?.layers?.merge?.(undefined, (layer: any) => layer.sections)
        if (merged?.get) {
          return merged.get(PERSONA_PREFIX_SECTION)?.complete === true
        }
      } catch {
        /* fall through */
      }
      return false
    },
    injectSection: (sectionName: string, text: string, order: number) => {
      const sp = (ctx as any).systemPrompt as any
      if (!sp?.section) return
      // One registration per section name: ScopedLayers rejects a duplicate
      // name inside the same layer, so a re-injection (every new agent) must
      // only update the live text, never re-register. `section.text` may be a
      // function (dsh-system-prompt assemble(): `typeof section.text ===
      // "function" ? section.text(context) : section.text`), so the render is
      // always read fresh from this map.
      injectedSections.set(sectionName, text)
      if (registeredSections.has(sectionName)) return
      registeredSections.add(sectionName)
      ctx.effect(() =>
        sp.section({
          name: sectionName,
          order,
          text: () => injectedSections.get(sectionName) ?? '',
        }),
      )
    },
    log,
  }

  // --- recall deps ---------------------------------------------------------
  const recallDeps = {
    store,
    config,
    extractCues: (message: string): string[] => {
      const tokens = message
        .split(/[\s，。！？、,.!?;；:：]+/)
        .filter((t) => t.length >= 2)
      return tokens.slice(0, 5)
    },
    log,
  }

  // --- governance deps -----------------------------------------------------
  const governanceDeps = { store, config, log }

  const lifecycle = createLifecycle({
    store,
    config,
    snapshot: snapshotDeps,
    recall: recallDeps,
    governance: governanceDeps,
  })

  // --- register tools ------------------------------------------------------
  const addDeps = { store, config, llmOpposition, log }
  const replaceDeps = { store, config, llmOpposition, log }
  const resolveDeps = { store, config, log }

  ctx.effect(() => {
    const tools = (ctx as any).tools as any
    if (!tools?.register) return () => {}
    tools.register(memoryAddTool(addDeps))
    tools.register(memoryReplaceTool(replaceDeps))
    tools.register(memoryResolveTool(resolveDeps))
    tools.register(memoryRecallTool({ store, config }))
    tools.register(
      memoryShowTool({
        store,
        config,
        rebuildSnapshot: async () => {
          if (!snapshotDeps.isCompleteMode()) {
            const { buildSnapshot } = await import('./snapshot.js')
            const content = await buildSnapshot(store, config.snapshot_budget_chars)
            snapshotDeps.injectSection(SNAPSHOT_SECTION_NAME, content, SNAPSHOT_SECTION_ORDER)
          }
        },
        log,
      }),
    )
    return () => {}
  })

  // --- lifecycle hooks -----------------------------------------------------
  // Channel one (frozen snapshot) runs on agent/created — rc.3 does NOT emit
  // `agent/session-start` at all (only agent/created|pre-step|turn-stopping|
  // disposed|status|request|request-error|assistant-stream|error). Channel two
  // (pre-step recall) appends a sourced user message. Write-back runs on
  // turn-stopping, not disposed.
  ctx.effect(() => {
    const on = (ctx as any).on as any
    if (!on) return () => {}

    // serial event, payload { agent, source: 'startup'|'resume'|'clear'|
    // 'compaction', signal? } — fires exactly once per live agent.
    on('agent/created', (payload: any) => {
      void lifecycle.onSessionStart(payload?.source)
    })

    on('agent/disposed', () => {
      void lifecycle.onDisposed()
    })

    // Write-back the completed exchange at the turn's stop boundary.
    on('agent/turn-stopping', () => {
      void lifecycle.onFlush()
    })

    // Channel two: recall + conflict reminder, injected as a sourced message by
    // appending to the pre-step decision's message batch (source.form: 'recall').
    on(
      'agent/pre-step',
      async (payload: any, next: () => Promise<any>) => {
        const decision = await next()
        if (!decision || decision.kind !== 'enter') return decision
        const prompt = extractPrompt(decision.messages)
        if (!prompt) return decision

        const { recallText, reminderText } = await lifecycle.onUserMessage(prompt)
        const additions: any[] = []
        if (recallText) additions.push(buildUserMessage(recallText, 'recall'))
        if (reminderText) additions.push(buildUserMessage(reminderText, 'reminder'))
        if (additions.length === 0) return decision

        return { ...decision, messages: [...(decision.messages ?? []), ...additions] }
      },
      { prepend: true },
    )
    return () => {}
  })

  // --- settings API for the client panel -----------------------------------
  // The client half (browser) cannot read the filesystem; expose the memory
  // state over the host webServer (same pattern as dsh-meme's /dsh-memes-api).
  const webServer = (ctx as any).webServer ?? (ctx as any).get?.('webServer')
  if (webServer?.register) {
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-memory-tree-api',
          async handler(_req: any, res: any) {
            const json = (obj: unknown, status = 200) => {
              res.writeHead(status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
              })
              res.end(JSON.stringify(obj))
            }
            try {
              const nodes = await store.readL3Nodes()
              const buffer = await store.readBuffer()
              const pending = await store.readPending()
              const stale = await store.isSnapshotStale()
              json({
                ok: true,
                persona: {
                  complete: snapshotDeps.isCompleteMode(),
                  mode: stale ? 'recall-only (snapshot stale)' : 'snapshot + recall',
                },
                log: await store.readDecisionLogTail(30),
                memory: {
                  active_rules: nodes.filter((n) => n.status === 'active' && n.type === 'rule').length,
                  active_facts: nodes.filter((n) => n.status === 'active' && n.type === 'fact').length,
                  superseded: nodes.filter((n) => n.status === 'superseded').length,
                  buffer_count: buffer.length,
                  pending_conflicts: (pending.conflicts ?? []).filter((c) => c.status === 'pending')
                    .length,
                },
                config,
              })
            } catch (err: any) {
              json({ ok: false, error: String(err?.message ?? err) }, 500)
            }
          },
        }),
      'dsh-memory-tree: /dsh-memory-tree-api',
    )
  }

  // eslint-disable-next-line no-console
  console.log('[dsh-memory-tree] plugin loaded')
}

/**
 * Build an injected user-role message carrying a producer-owned source kind so
 * the host treats it as plugin material rather than human input.
 *
 * rc.3 facts (verified in dsh-agent-preset-registry/lib/typert.host.js):
 *  - `MessageBase` requires `id`, `content`, `source` — an id is mandatory, so
 *    one is minted here (dsh-llm's createUserMessage does the same with
 *    `brandString(randomUUID())`).
 *  - `ContextFormed` allows `form: 'recall'` but there is NO `'reminder'`; the
 *    notice-shaped form is `{ form: 'notice', summary }`.
 */
function buildUserMessage(text: string, form: 'recall' | 'reminder'): any {
  const source =
    form === 'recall'
      ? { kind: 'plugin:dsh-memory-tree', form: 'recall' }
      : {
          kind: 'plugin:dsh-memory-tree',
          form: 'notice',
          summary: text.length <= 120 ? text : `${text.slice(0, 119)}…`,
        }
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  }
}

/**
 * The human text in this pre-step's claimed batch. Only `source.kind === 'user'`
 * messages are real prompts worth recalling on; plugin-injected context is not.
 */
function extractPrompt(messages: any): string {
  if (!Array.isArray(messages)) return ''
  return messages
    .filter((m: any) => m?.source?.kind === 'user')
    .flatMap((m: any) => m?.content ?? [])
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n')
    .trim()
}

export { detectConflict, decayWeight }
export type { MemoryNode, MemoryConfig, NodeStatus, NodeSource, NodeType } from './types.js'
