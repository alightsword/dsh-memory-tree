/**
 * dsh-memory-tree client half — settings card.
 *
 * Four blocks:
 *   1. 人格状态 (persona status, read-only)
 *   2. 日志查看 (decision log viewer)
 *   3. 深层记忆 (L3 read-only)
 *   4. 配置 (four tunable groups in v1; the rest read-only, labelled
 *      "高级配置，后续版本开放")
 *
 * IMPORTANT — soft dependency:
 *   @deepseek-ai/dsh-client-runtime cannot currently be installed because its
 *   transitive dependency @deepseek-ai/dsh-compact is unpublished (npm 404).
 *   This file therefore does NOT hard-import that package. It exports a single
 *   `apply(ctx)` that wires the card into whatever slot registry the host
 *   supplies at runtime, using only the well-known slot contract
 *   `{ name: 'domain.settings.card' }`. Types are declared loosely here; once
 *   the runtime resolves cleanly, swap the `any` types for the real imports.
 *
 * The card itself is a self-contained, dependency-free renderer so it also
 * works as a plain data formatter in non-React hosts.
 */

type DshClientContext = any
type SlotRegistry = any

/** The four read-only / editable groups surfaced by the card. */
interface SettingsCardData {
  persona: { complete: boolean; mode: string }
  log: Array<{ ts: number; event: string; detail?: unknown }>
  memory: {
    active_rules: number
    active_facts: number
    superseded: number
    buffer_count: number
    pending_conflicts: number
  }
  config: {
    forgetting_tier: 'gentle' | 'normal' | 'aggressive'
    p1_question_enabled: boolean
    p1_question_copy: string
    logging_enabled: boolean
    recall_top_k: number
  }
}

export async function apply(ctx: DshClientContext): Promise<void> {
  console.log('[dsh-memory-tree] client apply entered', {
    hasCtx: !!ctx,
    ctxKeys: ctx ? Object.keys(ctx).slice(0, 20) : null,
    hasSlots: !!ctx?.slots,
    slotKeys: ctx?.slots ? Object.keys(ctx.slots).slice(0, 20) : null,
  })
  try {
    const slots: SlotRegistry | undefined = ctx?.slots
    if (!slots?.register) {
      console.warn('[dsh-memory-tree] no slots registry on ctx; card not registered')
      return
    }
    // The card is registered as a function; the host resolves the four blocks.
    slots.register({ name: 'domain.settings.card' }, (data: SettingsCardData) =>
      renderSettingsCard(data),
    )
    console.log('[dsh-memory-tree] settings card registered')
  } catch (err) {
    console.error('[dsh-memory-tree] client apply failed', err)
    throw err
  }
}

/**
 * Render the settings card as a plain data shape the host can display. Kept
 * framework-free so it degrades gracefully to a structured object.
 */
export function renderSettingsCard(data: SettingsCardData): unknown {
  return {
    kind: 'dsh-memory-tree-settings',
    blocks: [
      {
        title: '人格状态',
        fields: [
          { label: 'complete 模式', value: data.persona.complete ? '是' : '否' },
          { label: '注入通道', value: data.persona.mode },
        ],
      },
      {
        title: '日志查看',
        fields: data.log.slice(-20).map((e) => ({
          label: new Date(e.ts).toISOString(),
          value: e.event,
        })),
      },
      {
        title: '深层记忆',
        fields: [
          { label: 'active rules', value: String(data.memory.active_rules) },
          { label: 'active facts', value: String(data.memory.active_facts) },
          { label: 'superseded', value: String(data.memory.superseded) },
          { label: 'buffer', value: String(data.memory.buffer_count) },
          { label: 'pending conflicts', value: String(data.memory.pending_conflicts) },
        ],
      },
      {
        title: '配置',
        fields: [
          { label: 'forgetting_tier', value: data.config.forgetting_tier },
          { label: 'p1_question_enabled', value: String(data.config.p1_question_enabled) },
          { label: 'p1_question_copy', value: data.config.p1_question_copy },
          { label: 'logging_enabled', value: String(data.config.logging_enabled) },
          { label: 'recall_top_k', value: String(data.config.recall_top_k) },
        ],
      },
    ],
  }
}

export default { apply, renderSettingsCard }
