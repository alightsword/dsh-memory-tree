/**
 * memory_add — write a new memory node.
 *
 * target semantics:
 *   - target "l2" (default): write to L2 buffer, NO conflict check
 *     (L2 does not participate in routing, so checking is meaningless).
 *   - target "l3": conflict-check first, then either write or return
 *     pending_conflict.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryStore } from '../store.js'
import type { SemanticOppositionFn } from '../conflict.js'
import { detectConflict } from '../conflict.js'
import { makeNode, buildConflictQuestion, newId, json } from './helpers.js'
import type { ConflictCandidate, MemoryConfig } from '../types.js'

export interface MemoryAddDeps {
  store: MemoryStore
  config: MemoryConfig
  llmOpposition?: SemanticOppositionFn
  log: (event: string, detail?: unknown) => Promise<void>
}

export function memoryAddTool(deps: MemoryAddDeps) {
  const { store, llmOpposition, log } = deps

  return defineTool({
    name: 'memory_add',
    description:
      'Add a memory. Use target "l2" for short-term buffer (no conflict check); ' +
      'target "l3" for long-term rules/facts (conflict-checked against active rules).',
    parameters: {
      statement: { type: 'string', required: true, description: 'The memory statement.' },
      target: {
        type: 'string',
        enum: ['l2', 'l3'] as const,
        description: 'Tier to write to. Default "l2".',
      },
      type: {
        type: 'string',
        enum: ['rule', 'fact'] as const,
        description: 'Node type. Default "rule".',
      },
      scope: { type: 'string', description: 'Scope this node governs. Empty = global.' },
      body: {
        type: 'string',
        description: 'Optional body text (not injected into the frozen snapshot).',
      },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value: any) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args: any) {
      const target = (args.target ?? 'l2') as 'l2' | 'l3'
      const node = makeNode({
        statement: args.statement,
        type: (args.type ?? 'rule') as 'rule' | 'fact',
        scope: args.scope,
        body: args.body,
      })

      if (target === 'l2') {
        const buffer = await store.readBuffer()
        buffer.push(node)
        await store.writeBuffer(buffer)
        await log('memory_add', { target: 'l2', node_id: node.id })
        return json({ status: 'ok', target: 'l2', node_id: node.id })
      }

      // target === 'l3': conflict check.
      const actives = await store.readActiveRules()
      const result = await detectConflict(node, actives, llmOpposition)

      if (!result.conflict) {
        const nodes = await store.readL3Nodes()
        nodes.push(node)
        await store.writeL3Nodes(nodes)
        await log('memory_add', {
          target: 'l3',
          node_id: node.id,
          conflict: false,
          detector: result.detector,
        })
        return json({ status: 'ok', target: 'l3', node_id: node.id })
      }

      // Conflict hit: park the candidate in the L2 pending queue, NEVER write L3.
      const candidate: ConflictCandidate = {
        conflict_id: newId('conflict'),
        candidate: node,
        against_ids: result.against.map((n) => n.id),
        question: buildConflictQuestion(node, result.against),
        created_at: Date.now(),
        status: 'pending',
      }
      const pending = await store.readPending()
      pending.conflicts.push(candidate)
      await store.writePending(pending)
      await log('memory_add_pending_conflict', {
        conflict_id: candidate.conflict_id,
        node_id: node.id,
        against_ids: candidate.against_ids,
        detector: result.detector,
      })

      return json({
        status: 'pending_conflict',
        conflict_id: candidate.conflict_id,
        question: candidate.question,
      })
    },
  })
}
