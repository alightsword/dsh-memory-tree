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

export const name = 'dsh-memory-tree'

export const inject = ['tools', 'systemPrompt', 'agents']

export interface MemoryTreeConfig {
  baseDir?: string
  config?: Partial<MemoryConfig>
}

export function apply(ctx: Context, rawConfig?: MemoryTreeConfig) {
  const config: MemoryConfig = { ...DEFAULT_CONFIG, ...(rawConfig?.config ?? {}) }
  const store = new MemoryStore(resolveBaseDir(rawConfig?.baseDir))

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

  // --- snapshot deps -------------------------------------------------------
  const snapshotDeps = {
    store,
    isCompleteMode: () => {
      // Detect complete:true on the deployment:persona section. The section
      // contract is { name, order, text, complete? }.
      const sp = (ctx as any).systemPrompt as any
      const PERSONA = 'deployment:persona'
      // Probe the registry's layers for a section named deployment:persona.
      if (sp?._layers) {
        for (const layer of sp._layers) {
          for (const s of layer ?? []) {
            if (s?.name === PERSONA) return s.complete === true
          }
        }
      }
      return false
    },
    injectSection: (sectionName: string, text: string, order: number) => {
      const sp = (ctx as any).systemPrompt as any
      sp?.section?.({ name: sectionName, order, text })
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
            const content = await buildSnapshot(store)
            snapshotDeps.injectSection(SNAPSHOT_SECTION_NAME, content, SNAPSHOT_SECTION_ORDER)
          }
        },
        log,
      }),
    )
    return () => {}
  })

  // --- lifecycle hooks -----------------------------------------------------
  // Channel one (frozen snapshot) runs on session-start; channel two (pre-step
  // recall) runs on every pre-step and APPENDS a sourced message via the real
  // dsh pre-step decision shape (see vectorize-io/hindsight for the verified
  // contract). Write-back runs on turn-stopping, not disposed.
  ctx.effect(() => {
    const on = (ctx as any).on as any
    if (!on) return () => {}

    on('agent/session-start', (payload: any) => {
      void lifecycle.onSessionStart()
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

  // eslint-disable-next-line no-console
  console.log('[dsh-memory-tree] plugin loaded')
}

/**
 * Build an injected user-role message with a producer-owned source kind and a
 * dsh `form` tag so the UI renders it as recalled material, not user input.
 * `source.kind: 'plugin:dsh-memory-tree'` is the V4 producer-owned kind.
 */
function buildUserMessage(text: string, form: 'recall' | 'reminder'): any {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin:dsh-memory-tree', form },
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
