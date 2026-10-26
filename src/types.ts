/**
 * Shared types for dsh-memory-tree.
 *
 * Three-tier memory model:
 *   L1 (transient)  — per-session runtime state, never persisted. Holds the
 *                     frozen snapshot flag and in-flight recall results.
 *   L2 (short-term) — buffer + conflict candidates, persisted to disk.
 *                     Does NOT participate in routing, so no conflict check.
 *   L3 (long-term)  — durable rules / facts, persisted to disk. Participates
 *                     in routing, so writes are conflict-checked.
 */

export type MemoryTier = 'l2' | 'l3'

export type NodeStatus =
  | 'active'
  | 'superseded'
  | 'rejected'

export type NodeSource =
  | 'confirmed' // user-confirmed, protected from archival
  | 'model' // written by the model without explicit confirmation

export type NodeType = 'rule' | 'fact'

/** A single memory node (L3) or buffer entry (L2). */
export interface MemoryNode {
  id: string
  /** Scope this node governs. Empty string / undefined = global scope. */
  scope?: string
  type: NodeType
  statement: string
  status: NodeStatus
  source: NodeSource
  base_weight: number
  created_at: number
  updated_at: number
  /** For superseded nodes: id of the node that replaced it. */
  superseded_by?: string
  /** Raw body (not injected into the frozen snapshot). */
  body?: string
}

/** A conflict candidate held in L2 pending queue. */
export interface ConflictCandidate {
  conflict_id: string
  candidate: MemoryNode
  /** The existing active node(s) the candidate contradicts. */
  against_ids: string[]
  /** The confirmation question template the model should relay to the user. */
  question: string
  created_at: number
  status: 'pending' | 'resolved'
  resolution?: 'replace' | 'scope_split' | 'reject'
}

/** Shape of the L2 pending store (pending.json). */
export interface PendingStore {
  conflicts: ConflictCandidate[]
}

/** One cue entry for pre-step recall. */
export interface CueEntry {
  cue: string
  summary: string
  node_ids: string[]
}

export interface CueIndex {
  cues: CueEntry[]
}

/** Plugin configuration, tunable in cordis.patch.yml or the settings page. */
export interface MemoryConfig {
  /** Forgetting profile: controls power-law decay aggressiveness. */
  forgetting_tier: 'gentle' | 'normal' | 'aggressive'
  /** P1 (conflict) question toggle and copy. */
  p1_question_enabled: boolean
  p1_question_copy: string
  /** decision_log toggle. */
  logging_enabled: boolean
  /** Recall top-K. */
  recall_top_k: number
  /** Snapshot injection budget: max chars of the frozen snapshot. */
  snapshot_budget_chars: number
  /** Archival threshold: nodes whose decayed weight drops below this are archived. */
  archive_threshold: number
  /** Base directory override (empty = $DSH_HOME/memory-tree). */
  base_dir: string
  /** Custom forgetting factor (0 = use tier preset). */
  forgetting_factor: number
}

export const DEFAULT_CONFIG: MemoryConfig = {
  forgetting_tier: 'normal',
  p1_question_enabled: true,
  p1_question_copy: '检测到与新表达相矛盾的已有规矩，请确认是否替换/划分范围/拒绝：',
  logging_enabled: true,
  recall_top_k: 3,
  snapshot_budget_chars: 2000,
  archive_threshold: 0.15,
  base_dir: '',
  forgetting_factor: 0,
}

/** Decision log entry, append-only. */
export interface DecisionLogEntry {
  ts: number
  event: string
  detail?: unknown
}
