/**
 * recall.ts — pre-step recall (injection channel two).
 *
 * After every user message, query cue_index.json with ≤5 cues, take top-K
 * summaries. Injection is performed by the caller via agent.inject() — a
 * model-facing UserMessage with a plugin source — so it is unaffected by
 * complete mode (it does not go through systemPrompt).
 *
 * Conflict reminder: every pre-step, check L2 pending.json conflicts queue.
 * If there is an unresolved conflict not yet asked this turn, produce one
 * reminder line (at most one per turn, does not consume P1 budget).
 */

import type { MemoryStore } from './store.js'
import type { MemoryConfig } from './types.js'

export interface RecallDeps {
  store: MemoryStore
  config: MemoryConfig
  extractCues: (message: string) => string[]
  log: (event: string, detail?: unknown) => Promise<void>
}

export interface RecallOutput {
  /** Recall content to inject, or null if nothing matched. */
  recallText: string | null
  /** Conflict reminder line, or null if none due. */
  reminderText: string | null
}

async function recallTopK(
  store: MemoryStore,
  config: MemoryConfig,
  cues: string[],
): Promise<Array<{ cue: string; summary: string }>> {
  const index = await store.readCueIndex()
  const scored = index.cues
    .map((entry) => {
      let score = 0
      for (const cue of cues) {
        if (entry.cue.toLowerCase().includes(cue.toLowerCase())) score += 1
      }
      return { entry, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.recall_top_k)
  return scored.map((x) => ({ cue: x.entry.cue, summary: x.entry.summary }))
}

export async function runRecall(deps: RecallDeps, message: string): Promise<RecallOutput> {
  const cues = deps.extractCues(message)
  let recallText: string | null = null

  if (cues.length > 0) {
    const results = await recallTopK(deps.store, deps.config, cues)
    if (results.length > 0) {
      recallText = results
        .map((r, i) => `${i + 1}. ${r.summary}${r.cue ? ` (cue: ${r.cue})` : ''}`)
        .join('\n')
      await deps.log('recall_injected', { count: results.length, cues })
    }
  }

  // Conflict reminder (at most one per turn, no P1 budget consumed).
  let reminderText: string | null = null
  const pending = await deps.store.readPending()
  const unresolved = pending.conflicts.find((c) => c.status === 'pending')
  if (unresolved) {
    reminderText = `存在未确认的冲突：${unresolved.question}`
    await deps.log('conflict_reminder', { conflict_id: unresolved.conflict_id })
  }

  return { recallText, reminderText }
}
