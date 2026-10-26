/**
 * memory_resolve — resolve a pending conflict.
 *
 * Input: conflict_id, decision (replace | scope_split | reject).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryStore } from '../store.js'
import type { MemoryConfig } from '../types.js'
import { scopeOverlap } from '../conflict.js'
import { json } from './helpers.js'

export interface MemoryResolveDeps {
  store: MemoryStore
  config: MemoryConfig
  log: (event: string, detail?: unknown) => Promise<void>
}

export function memoryResolveTool(deps: MemoryResolveDeps) {
  const { store, log } = deps

  return defineTool({
    name: 'memory_resolve',
    description:
      'Resolve a pending conflict: replace (supersede old), scope_split (keep both with ' +
      'disjoint scopes), or reject (discard candidate).',
    parameters: {
      conflict_id: {
        type: 'string',
        required: true,
        description: 'Conflict id from pending_conflict.',
      },
      decision: {
        type: 'string',
        required: true,
        enum: ['replace', 'scope_split', 'reject'] as const,
        description: 'Resolution decision.',
      },
      new_scope: {
        type: 'string',
        description:
          'For scope_split: the narrowed scope to assign the candidate so it no longer overlaps the existing rule. Required when the candidate scope still overlaps.',
      },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value: any) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args: any) {
      const pending = await store.readPending()
      const idx = pending.conflicts.findIndex((c) => c.conflict_id === args.conflict_id)
      if (idx < 0) {
        return json({ status: 'error', error: `conflict not found: ${args.conflict_id}` })
      }
      const conflict = pending.conflicts[idx]
      const decision = args.decision as 'replace' | 'scope_split' | 'reject'

      const nodes = await store.readL3Nodes()
      const againstNodes = nodes.filter((n) => conflict.against_ids.includes(n.id))
      const candidate = conflict.candidate

      if (decision === 'replace') {
        for (const old of againstNodes) {
          old.status = 'superseded'
          old.superseded_by = candidate.id
          old.updated_at = Date.now()
        }
        const newNode = { ...candidate, status: 'active' as const, source: 'confirmed' as const }
        const existing = nodes.findIndex((n) => n.id === candidate.id)
        if (existing >= 0) nodes[existing] = newNode
        else nodes.push(newNode)
        await store.writeL3Nodes(nodes)
        await store.setSnapshotStale()
      } else if (decision === 'scope_split') {
        if (!candidate.scope || againstNodes.some((n) => !n.scope)) {
          return json({
            status: 'error',
            error:
              'scope_split requires both the candidate and the existing rule to declare non-empty scopes.',
          })
        }
        // Determine the final scope for the candidate. If the caller supplied a
        // narrowed new_scope, use it; otherwise keep the candidate's own scope.
        const finalScope = typeof args.new_scope === 'string' && args.new_scope.trim()
          ? args.new_scope.trim()
          : candidate.scope
        // scope_split only dissolves the conflict if the two scopes are truly
        // disjoint. If they still overlap, splitting leaves two still-active,
        // still-contradictory rules — so reject that case.
        if (againstNodes.some((n) => scopeOverlap(finalScope, n.scope))) {
          return json({
            status: 'error',
            error:
              'scope_split requires disjoint scopes; provide a new_scope that does not overlap the existing rule\'s scope.',
          })
        }
        const newNode = {
          ...candidate,
          scope: finalScope,
          status: 'active' as const,
          source: 'confirmed' as const,
        }
        const existing = nodes.findIndex((n) => n.id === candidate.id)
        if (existing >= 0) nodes[existing] = newNode
        else nodes.push(newNode)
        await store.writeL3Nodes(nodes)
        await store.setSnapshotStale()
      }
      // reject: candidate stays in queue, marked resolved; nothing written to L3.

      conflict.status = 'resolved'
      conflict.resolution = decision
      await store.writePending(pending)

      await log('conflict_resolved', {
        conflict_id: conflict.conflict_id,
        decision,
        node_id: candidate.id,
      })

      return json({ status: 'ok', decision, conflict_id: conflict.conflict_id })
    },
  })
}
