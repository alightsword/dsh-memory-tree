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

// --- cue extraction (shared) ----------------------------------------------

/** Token-bearing words that carry no recall signal on their own. */
const STOP_CUES = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'have', 'has', 'are', 'was',
  'what', 'when', 'where', 'which', 'how', 'why', 'please', 'want', 'need',
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '的', '了', '是',
  '在', '有', '和', '与', '要', '想', '能', '会', '给', '把', '被', '让',
  '这个', '那个', '一个', '一些', '什么', '怎么', '为什么', '请', '帮',
])

/**
 * Extract recall cues from a user message. Returns up to `limit` cues, keeping
 * longer (more specific) tokens first and dropping stop-word noise. This is a
 * pure lexical heuristic — no embedding service exists in DSH, so recall must
 * stay deterministic and dependency-free.
 */
export function extractCues(message: string, limit = 5): string[] {
  if (!message) return []
  const raw = message
    .split(/[\s，。！？、,.!?;；:：()（）\[\]【】"'“”‘’]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1)
  const latin = raw.filter((t) => /[a-zA-Z0-9_]/.test(t))
  const cjk = raw.filter((t) => /[\u4e00-\u9fff]/.test(t) && t.length >= 2)
  // Prefer specific tokens: multi-char CJK and multi-char latin first, longest
  // first, then single CJK chars as a last resort.
  const scored = [...latin, ...cjk]
    .filter((t) => !STOP_CUES.has(t.toLowerCase()))
    .sort((a, b) => b.length - a.length)
  // Dedupe preserving order.
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of scored) {
    const k = t.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= limit) break
  }
  return out
}

// --- matching --------------------------------------------------------------

/** CJK bigram set + latin tokens, for overlap scoring. */
function tokenize(s: string): Set<string> {
  const out = new Set<string>()
  const latin = s.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  for (const t of latin) out.add('w:' + t)
  const cjk = s.replace(/[\s\p{P}\p{S}]/gu, '')
  for (let i = 0; i < cjk.length - 1; i++) out.add('c:' + cjk.slice(i, i + 2))
  return out
}

/**
 * Score a cue entry against the query cues. Replaces the old substring-contains
 * check with a Jaccard-over-bigrams overlap, which also matches reworded or
 * partial cues ("深色主题" matches "用深色" through the shared "深色" bigram).
 */
function scoreEntry(entryCue: string, entrySummary: string, cues: string[]): number {
  const entryTokens = tokenize(`${entryCue} ${entrySummary}`)
  if (entryTokens.size === 0) return 0
  let score = 0
  for (const cue of cues) {
    const cueTokens = tokenize(cue)
    if (cueTokens.size === 0) continue
    // Exact substring is a strong signal.
    if (entryCue.toLowerCase().includes(cue.toLowerCase())) {
      score += 2
      continue
    }
    // Bigram overlap catches reworded matches.
    let inter = 0
    for (const x of cueTokens) if (entryTokens.has(x)) inter++
    const j = inter / (cueTokens.size + entryTokens.size - inter)
    if (j > 0.3) score += 1
  }
  return score
}

async function recallTopK(
  store: MemoryStore,
  config: MemoryConfig,
  cues: string[],
): Promise<Array<{ cue: string; summary: string }>> {
  const index = await store.readCueIndex()
  const scored = index.cues
    .map((entry) => ({ entry, score: scoreEntry(entry.cue, entry.summary, cues) }))
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
