/**
 * promotion.ts — L2 → L3 automatic promotion.
 *
 * The short-term buffer (L2) accumulates statements the model has seen fit to
 * remember mid-session but has not committed to long-term storage. When the
 * SAME statement (or a near-duplicate of it) has been buffered `min_count`
 * times, it is promoted to L3 through the normal conflict-checked path — the
 * write-before-interception guarantee is preserved, so a promoted statement
 * that contradicts an existing rule is still parked as a pending conflict, not
 * silently written.
 *
 * Promotion is fail-open: any error is logged and never blocks the turn.
 */

import type { MemoryStore } from './store.js'
import type { MemoryConfig, MemoryNode } from './types.js'
import type { SemanticOppositionFn } from './conflict.js'
import { detectConflict } from './conflict.js'
import { lexicalOverlap } from './tools/helpers.js'
import { randomUUID } from 'node:crypto'

export interface PromotionDeps {
  store: MemoryStore
  config: MemoryConfig
  llmOpposition?: SemanticOppositionFn
  log: (event: string, detail?: unknown) => Promise<void>
}

export interface PromotionResult {
  promoted: number
  conflicted: number
}

/**
 * Group buffered statements into near-duplicate clusters. Two statements are
 * "the same" when their lexical overlap exceeds `similarity_threshold`.
 */
function clusterBuffer(
  buffer: MemoryNode[],
  threshold: number,
): Array<{ statement: string; count: number; items: MemoryNode[] }> {
  const clusters: Array<{ statement: string; count: number; items: MemoryNode[] }> = []
  for (const node of buffer) {
    let placed = false
    for (const c of clusters) {
      if (lexicalOverlap(c.statement, node.statement) >= threshold) {
        c.items.push(node)
        c.count++
        placed = true
        break
      }
    }
    if (!placed) {
      clusters.push({ statement: node.statement, count: 1, items: [node] })
    }
  }
  return clusters
}

/**
 * Scan the L2 buffer and promote any statement seen at least `min_count` times
 * into L3, conflict-checked. Promoted statements are removed from the buffer.
 * Fail-open: errors are logged, never thrown.
 */
export async function runPromotion(deps: PromotionDeps, minCount = 2): Promise<PromotionResult> {
  const result: PromotionResult = { promoted: 0, conflicted: 0 }
  try {
    const buffer = await deps.store.readBuffer()
    if (buffer.length === 0) return result

    const threshold = 0.6
    const clusters = clusterBuffer(buffer, threshold)
    const actives = await deps.store.readActiveRules()
    const nodes = await deps.store.readL3Nodes()

    let promotedAny = false

    for (const cluster of clusters) {
      if (cluster.count < minCount) continue
      // Inherit the type from the buffered entries (rule vs fact) rather than
      // hard-coding 'rule', so a repeatedly-buffered fact stays a fact.
      const srcType = cluster.items[0]?.type ?? 'rule'
      const node: MemoryNode = {
        id: `promo_${randomUUID().slice(0, 8)}`,
        type: srcType,
        statement: cluster.statement,
        status: 'active',
        source: 'model',
        base_weight: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
      }

      const conflict = await detectConflict(node, actives, deps.llmOpposition)
      if (conflict.conflict) {
        // Park as pending conflict (preserves the write-before-interception
        // guarantee); do NOT write to L3.
        result.conflicted++
        const pending = await deps.store.readPending()
        pending.conflicts.push({
          conflict_id: `promo_conflict_${randomUUID().slice(0, 8)}`,
          candidate: node,
          against_ids: conflict.against.map((n) => n.id),
          question:
            `自动晋升的记忆「${node.statement}」与现有规矩相矛盾，请确认处理方式（replace / scope_split / reject）。`,
          created_at: Date.now(),
          status: 'pending',
        })
        await deps.store.writePending(pending)
        await deps.log('promotion_conflict', { node_id: node.id })
      } else {
        nodes.push(node)
        actives.push(node)
        result.promoted++
        await deps.log('promotion', { node_id: node.id, statement: node.statement.slice(0, 60) })
      }

      promotedAny = true
    }

    if (promotedAny) {
      await deps.store.writeL3Nodes(nodes)
      // Drop promoted (and conflicted) clusters from the buffer.
      const promotedIds = new Set<string>()
      for (const cluster of clusters) {
        if (cluster.count >= minCount) {
          for (const item of cluster.items) promotedIds.add(item.id)
        }
      }
      const remaining = buffer.filter((n) => !promotedIds.has(n.id))
      await deps.store.writeBuffer(remaining)
      await deps.store.setSnapshotStale()
    }
  } catch (err) {
    await deps.log('promotion_error', { error: String(err) })
  }
  return result
}
