/**
 * Conflict detection — the write-before-interception core.
 *
 * A conflict exists when BOTH hold:
 *   1. scope overlap  — either scope is empty (global) OR they intersect.
 *   2. semantic opposition — the candidate statement contradicts an existing
 *      active rule. Detected rule-first, with an LLM fallback when the rule
 *      signal is low-confidence.
 *
 * Rule-first is cheap and dependency-free but can miss paraphrased
 * opposition (documented trade-off #2). The LLM fallback covers the
 * low-confidence band to reduce false negatives.
 */

import type { MemoryNode } from './types.js'

export interface ConflictResult {
  conflict: boolean
  against: MemoryNode[]
  reason: 'scope_overlap+semantic_opposition' | 'none'
  /** How the opposition was judged, for the decision log. */
  detector: 'rule' | 'llm' | 'none'
}

export type SemanticOppositionFn = (
  candidate: string,
  existing: string,
) => Promise<boolean>

// --- rule-first detectors --------------------------------------------------

/**
 * Negation / reversal cues present in the candidate relative to existing.
 *
 * NOTE: `\b` (word boundary) does NOT match around CJK characters in JS regex
 * (CJK is not `\w`), so the Chinese alternation MUST be boundary-free. Only the
 * latin alternation uses `\b`.
 */
const NEGATION_PATTERNS = [
  // Explicit negators, longest-first so prefixes don't shadow suffixes.
  /(不允许|不需要|不应当|不应该|不再是|不再|不支持|不赞成|不认可|不愿意|不希望|不同意|不能|不得|不要|不可|不准|不应|不该|不必|切勿|勿|别|禁止|严禁|反对|否定|取消|废除|撤销|讨厌|厌恶|不喜欢|反感|抵触)/,
  /\b(not|never|no|don'?t|forbid|prohibit|disallow|must not|cannot|refuse|reject|dislike|hate)\b/i,
]

/**
 * Fixed Chinese words that start with "不" but are NOT negations. These are
 * lexemes where "不" is fused into a new positive meaning, not a negator.
 * Used to recover the single-char "不" negation WITHOUT false-positives.
 */
const NON_NEGATING_BU_X = new Set([
  '不错', '不得不', '不断', '不仅', '不久', '不满', '不免', '不配', '不平',
  '不然', '不时', '不惜', '不息', '不行', '不意', '不止', '不至于', '不只',
  '不管', '不论', '无论', '不愧', '不料', '不懂', '不妨', '不明', '不良',
  '不利', '不便', '不惜', '不顺', '不符', '不动', '不急', '不变',
])

/**
 * Single-char "不" negation: "不" followed by a verb/adjective IS a negator
 * (不吃辣 / 不高 / 不红), EXCEPT when it fuses into a fixed non-negating word
 * (不错 / 不得不 / 不明原因). Implemented via a post-check against the
 * non-negating lexicon.
 */
function hasBareBuNegation(text: string): boolean {
  let idx = -1
  const bu = /不/g
  let m: RegExpExecArray | null
  while ((m = bu.exec(text)) !== null) {
    const next = text[m.index + 1]
    if (!next) break
    // "不" followed by a CJK char forms a candidate "不X".
    const pair = text.slice(m.index, m.index + 2)
    if (NON_NEGATING_BU_X.has(pair)) {
      // skip over this fused lexeme
      bu.lastIndex = m.index + 2
      continue
    }
    // "不" followed by punctuation/space is not a negator prefix (e.g. "好，不坏").
    if (/[\s\p{P}\p{S}]/u.test(next)) continue
    return true
  }
  return false
}

function hasNegation(text: string): boolean {
  // Mask non-negating fused lexemes first, so "不得" inside "不得不" (double
  // negation = affirmative) and "不明" are NOT treated as negators.
  const masked = maskNonNegating(text)
  if (NEGATION_PATTERNS.some((re) => re.test(masked))) return true
  return hasBareBuNegation(masked)
}

/** Replace fused non-negating "不X" lexemes with a neutral placeholder. */
function maskNonNegating(text: string): string {
  let out = text
  for (const w of NON_NEGATING_BU_X) {
    // Replace the whole lexeme; use a split/join to avoid overlapping-index bugs.
    out = out.split(w).join('　') // U+3000 ideographic space as neutral filler
  }
  return out
}

/**
 * Oppositional token pairs. Each pair is (A, B) meaning A-words oppose B-words.
 * The detector checks both directions. Presence of a pair on opposite sides is
 * a strong signal even when lexical overlap is thin.
 */
const OPPOSITE_PAIRS: Array<[RegExp, RegExp]> = [
  [/(允许|可以|支持|赞成|同意|启用|开启|打开)/, /(禁止|不允许|反对|拒绝|禁用|关闭|停用|不得)/],
  [/(总是|永远|始终|必须|一直)/, /(从不|绝不|禁止|不允许)/],
  [/(喜欢|喜爱|偏好|倾向|认可|满意)/, /(讨厌|厌恶|不喜欢|反感|抵触|排斥)/],
  [/(增加|提升|扩大|增强|加)/, /(减少|降低|缩小|减弱|减)/],
  [/(保留|维持|保持|留存)/, /(删除|移除|清除|丢弃|去掉)/],
  [/(深色|暗色|黑色|黑底|暗黑)/, /(浅色|亮色|白色|白底|明亮)/],
  [/(自动|默认开启|默认打开)/, /(手动|默认关闭|默认禁用)/],
]

/**
 * Rule-based opposition check. Returns:
 *   true  — clear opposition
 *   false — clear non-opposition
 *   null  — low confidence, hand off to LLM
 */
function ruleBasedOpposition(candidate: string, existing: string): boolean | null {
  const cNeg = hasNegation(candidate)
  const eNeg = hasNegation(existing)
  const overlap = lexicalOverlap(candidate, existing)

  // Strong signal: one side negates while the other asserts, and they share
  // a content core.
  if ((cNeg !== eNeg) && overlap > 0.15) {
    return true
  }

  // Opposite-pair hit: A-words on one side vs B-words on the other.
  for (const [a, b] of OPPOSITE_PAIRS) {
    const candidateHasA = a.test(candidate)
    const existingHasB = b.test(existing)
    const existingHasA = a.test(existing)
    const candidateHasB = b.test(candidate)
    const opposed = (candidateHasA && existingHasB) || (existingHasA && candidateHasB)
    if (opposed) {
      // Opposite words on both sides, with any shared content → clear opposition.
      if (overlap > 0) return true
      // Opposite words but no shared content → ambiguous, hand off to LLM.
      return null
    }
  }

  // No negation, no opposite pair → non-opposition.
  return false
}

/** Crude lexical overlap (Jaccard over CJK bigrams + latin tokens). */
function lexicalOverlap(a: string, b: string): number {
  const tokenize = (s: string): Set<string> => {
    const out = new Set<string>()
    const latin = s.toLowerCase().match(/[a-z0-9_]+/g) ?? []
    for (const t of latin) out.add('w:' + t)
    const cjk = s.replace(/[\s\p{P}\p{S}]/gu, '')
    for (let i = 0; i < cjk.length - 1; i++) out.add('c:' + cjk.slice(i, i + 2))
    return out
  }
  const A = tokenize(a)
  const B = tokenize(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

// --- scope overlap ----------------------------------------------------------

/** Empty scope means global overlap. Otherwise intersects on shared words. */
export function scopeOverlap(a?: string, b?: string): boolean {
  if (!a || !b) return true
  const ta = tokenizeScope(a)
  const tb = tokenizeScope(b)
  for (const t of ta) if (tb.has(t)) return true
  return false
}

function tokenizeScope(s: string): Set<string> {
  const out = new Set<string>()
  const latin = s.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  for (const t of latin) out.add(t)
  const cjk = s.replace(/[\s\p{P}\p{S}]/gu, '')
  for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2))
  return out
}

// --- main entry ------------------------------------------------------------

/**
 * Detect whether `candidate` conflicts with any active rule in `actives`.
 * Rule-first; LLM fallback only when the rule signal is ambiguous (null).
 */
export async function detectConflict(
  candidate: MemoryNode,
  actives: MemoryNode[],
  llmOpposition?: SemanticOppositionFn,
): Promise<ConflictResult> {
  const against: MemoryNode[] = []
  let detector: ConflictResult['detector'] = 'none'

  for (const existing of actives) {
    if (existing.id === candidate.id) continue
    if (!scopeOverlap(candidate.scope, existing.scope)) continue

    const rule = ruleBasedOpposition(candidate.statement, existing.statement)

    if (rule === true) {
      against.push(existing)
      detector = 'rule'
      continue
    }

    if (rule === null && llmOpposition) {
      const opposed = await llmOpposition(candidate.statement, existing.statement)
      if (opposed) {
        against.push(existing)
        if (detector === 'none') detector = 'llm'
      }
    }
  }

  if (against.length > 0) {
    return {
      conflict: true,
      against,
      reason: 'scope_overlap+semantic_opposition',
      detector,
    }
  }

  return { conflict: false, against: [], reason: 'none', detector: 'none' }
}
