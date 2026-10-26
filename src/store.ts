/**
 * Filesystem-backed storage for the memory tree.
 *
 * Layout under DSH_HOME (or a configured base dir):
 *   L3/ROOT.md          — long-term root skeleton (empty template on cold start)
 *   L3/nodes.json       — all L3 nodes (active / superseded / rejected)
 *   L3/cue_index.json   — cue -> top summaries for pre-step recall
 *   L2/buffer.json      — short-term buffer entries
 *   L2/pending.json     — conflict candidates awaiting confirmation
 *   l1_transient/snapshot_stale.flag — marker to rebuild snapshot next session
 *   decision_log.jsonl  — append-only decision log
 *
 * All reads/writes are fail-open: a storage error is logged, never thrown to
 * the conversation path. The only exception is corruption that would make a
 * write ambiguous — in that case we refuse the write but keep the session alive.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { MemoryConfig, MemoryNode, PendingStore, CueIndex } from './types.js'

export class MemoryStore {
  readonly baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  // --- path helpers -------------------------------------------------------

  private l3Root() {
    return path.join(this.baseDir, 'L3', 'ROOT.md')
  }
  private l3Nodes() {
    return path.join(this.baseDir, 'L3', 'nodes.json')
  }
  private l3CueIndex() {
    return path.join(this.baseDir, 'L3', 'cue_index.json')
  }
  private l2Buffer() {
    return path.join(this.baseDir, 'L2', 'buffer.json')
  }
  private l2Pending() {
    return path.join(this.baseDir, 'L2', 'pending.json')
  }
  private snapshotFlag() {
    return path.join(this.baseDir, 'l1_transient', 'snapshot_stale.flag')
  }
  private decisionLog() {
    return path.join(this.baseDir, 'decision_log.jsonl')
  }

  // --- generic JSON helpers ----------------------------------------------

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(file, 'utf-8')
      return JSON.parse(raw) as T
    } catch (err: any) {
      if (err?.code === 'ENOENT') return fallback
      throw err
    }
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, file)
  }

  // --- ensure cold-start skeleton -----------------------------------------

  /** Ensure the on-disk directory skeleton exists; create an empty ROOT.md. */
  async ensureSkeleton(): Promise<void> {
    await fs.mkdir(path.join(this.baseDir, 'L3'), { recursive: true })
    await fs.mkdir(path.join(this.baseDir, 'L2'), { recursive: true })
    await fs.mkdir(path.join(this.baseDir, 'l1_transient'), { recursive: true })

    try {
      await fs.access(this.l3Root())
    } catch {
      // Cold start: write an empty skeleton with partition headers.
      const skeleton = [
        '# ROOT',
        '',
        '## Rules',
        '',
        '## Facts',
        '',
      ].join('\n')
      await fs.writeFile(this.l3Root(), skeleton, 'utf-8')
    }
  }

  // --- L3 nodes -----------------------------------------------------------

  async readL3Nodes(): Promise<MemoryNode[]> {
    return this.readJson<MemoryNode[]>(this.l3Nodes(), [])
  }

  async writeL3Nodes(nodes: MemoryNode[]): Promise<void> {
    await this.writeJson(this.l3Nodes(), nodes)
  }

  /** Active L3 rules only — the routing-governing set. */
  async readActiveRules(): Promise<MemoryNode[]> {
    const nodes = await this.readL3Nodes()
    return nodes.filter((n) => n.status === 'active' && n.type === 'rule')
  }

  async readRootMd(): Promise<string> {
    try {
      return await fs.readFile(this.l3Root(), 'utf-8')
    } catch (err: any) {
      if (err?.code === 'ENOENT') return ''
      throw err
    }
  }

  async readCueIndex(): Promise<CueIndex> {
    return this.readJson<CueIndex>(this.l3CueIndex(), { cues: [] })
  }

  async writeCueIndex(index: CueIndex): Promise<void> {
    await this.writeJson(this.l3CueIndex(), index)
  }

  // --- L2 pending (conflict queue) ---------------------------------------

  async readPending(): Promise<PendingStore> {
    return this.readJson<PendingStore>(this.l2Pending(), { conflicts: [] })
  }

  async writePending(pending: PendingStore): Promise<void> {
    await this.writeJson(this.l2Pending(), pending)
  }

  // --- L2 buffer ----------------------------------------------------------

  async readBuffer(): Promise<MemoryNode[]> {
    return this.readJson<MemoryNode[]>(this.l2Buffer(), [])
  }

  async writeBuffer(nodes: MemoryNode[]): Promise<void> {
    await this.writeJson(this.l2Buffer(), nodes)
  }

  // --- snapshot stale flag ------------------------------------------------

  async setSnapshotStale(): Promise<void> {
    await fs.mkdir(path.dirname(this.snapshotFlag()), { recursive: true })
    await fs.writeFile(this.snapshotFlag(), String(Date.now()), 'utf-8')
  }

  async isSnapshotStale(): Promise<boolean> {
    try {
      await fs.access(this.snapshotFlag())
      return true
    } catch {
      return false
    }
  }

  async clearSnapshotStale(): Promise<void> {
    try {
      await fs.unlink(this.snapshotFlag())
    } catch {
      // already cleared
    }
  }

  // --- decision log -------------------------------------------------------

  async appendDecisionLog(entry: unknown): Promise<void> {
    await fs.mkdir(path.dirname(this.decisionLog()), { recursive: true })
    await fs.appendFile(this.decisionLog(), JSON.stringify(entry) + '\n', 'utf-8')
  }

  /** Read the last `limit` decision-log entries (oldest first). */
  async readDecisionLogTail(limit: number): Promise<Array<{ ts: number; event: string }>> {
    try {
      const raw = await fs.readFile(this.decisionLog(), 'utf-8')
      const lines = raw.split('\n').filter((l) => l.trim().length > 0)
      return lines
        .slice(-limit)
        .map((l) => {
          try {
            return JSON.parse(l) as { ts: number; event: string }
          } catch {
            return { ts: 0, event: l.slice(0, 120) }
          }
        })
    } catch {
      return []
    }
  }
}

/** Resolve the base dir for memory storage. */
export function resolveBaseDir(explicit?: string): string {
  if (explicit) return explicit
  const dshHome = process.env.DSH_HOME
  if (dshHome) return path.join(dshHome, 'memory-tree')
  return path.join(process.cwd(), '.dsh-memory-tree')
}
