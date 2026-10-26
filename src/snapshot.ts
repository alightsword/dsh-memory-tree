/**
 * snapshot.ts — frozen snapshot (injection channel one).
 *
 * On agent/session-start, read ROOT.md + all active rules' statements, and
 * inject a single systemPrompt section. The snapshot is FROZEN for the session.
 *
 * complete:true degradation (hard rule): if the deployment:persona section
 * carries complete:true, channel one is skipped (otherwise the injection would
 * be silently dropped) and a decision_log entry records snapshot_skipped.
 */

import type { MemoryStore } from './store.js'

export interface SnapshotDeps {
  store: MemoryStore
  /** Whether the deployment:persona section has complete:true. */
  isCompleteMode: () => boolean
  /** Inject a systemPrompt section (text + order). */
  injectSection: (name: string, text: string, order: number) => void
  log: (event: string, detail?: unknown) => Promise<void>
}

export const SNAPSHOT_SECTION_NAME = 'plugin:memory-context'
export const SNAPSHOT_SECTION_ORDER = 50
const GENERIC_NOTICE = 'L2 存在冲突候选，确认前不生效。'

export interface BuildResult {
  content: string
  skipped: false
}

export interface SkipResult {
  content: null
  skipped: true
  skipped_reason: 'complete_mode'
}

export async function buildSnapshot(store: MemoryStore): Promise<string> {
  const root = await store.readRootMd()
  const actives = await store.readActiveRules()

  const lines: string[] = []
  lines.push(root.trimEnd())
  lines.push('')
  lines.push('## Active rules')
  if (actives.length === 0) {
    lines.push('(none)')
  } else {
    for (const n of actives) {
      const scope = n.scope ? `[scope: ${n.scope}] ` : ''
      lines.push(`- ${scope}${n.statement}`)
    }
  }
  lines.push('')
  lines.push(GENERIC_NOTICE)
  return lines.join('\n')
}

export async function runSnapshot(deps: SnapshotDeps): Promise<BuildResult | SkipResult> {
  if (deps.isCompleteMode()) {
    await deps.log('snapshot_skipped', { reason: 'complete_mode' })
    return { content: null, skipped: true, skipped_reason: 'complete_mode' }
  }

  const content = await buildSnapshot(deps.store)
  deps.injectSection(SNAPSHOT_SECTION_NAME, content, SNAPSHOT_SECTION_ORDER)
  await deps.log('snapshot_injected', { bytes: content.length })
  return { content, skipped: false }
}
