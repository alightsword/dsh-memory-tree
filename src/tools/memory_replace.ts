/**
 * memory_replace — replace an existing node's statement.
 *
 * Same write-before-interception contract as memory_add: if the replacement
 * contradicts another active rule (scope overlap + semantic opposition), the
 * write is intercepted and returned as pending_conflict.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryStore } from '../store.js'
import type { SemanticOppositionFn } from '../conflict.js'
import { detectConflict } from '../conflict.js'
import { newId, buildConflictQuestion, json } from './helpers.js'
import type { ConflictCandidate, MemoryConfig } from '../types.js'

export interface MemoryReplaceDeps {
  store: MemoryStore
  config: MemoryConfig
  llmOpposition?: SemanticOppositionFn
  log: (event: string, detail?: unknown) => Promise<void>
}

export function memoryReplaceTool(deps: MemoryReplaceDeps) {
  const { store, llmOpposition, log } = deps

  return defineTool({
    name: 'memory_replace',
    description:
      'Replace the statement of an existing long-term (L3) node. ' +
      'Conflict-checked against other active rules; returns pending_conflict on opposition.',
    parameters: {
      node_id: { type: 'string', required: true, description: 'Id of the node to replace.' },
      statement: { type: 'string', required: true, description: 'New statement.' },
      scope: { type: 'string', description: 'New scope (optional).' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value: any) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args: any) {
      const nodes = await store.readL3Nodes()
      const target = nodes.find((n) => n.id === args.node_id)
      if (!target) {
        return json({ status: 'error', error: `node not found: ${args.node_id}` })
      }

      const prospective = {
        ...target,
        statement: args.statement,
        scope: args.scope ?? target.scope,
      }

      const actives = (await store.readActiveRules()).filter((n) => n.id !== target.id)
      const result = await detectConflict(prospective, actives, llmOpposition)

      if (!result.conflict) {
        target.statement = args.statement
        if (args.scope !== undefined) target.scope = args.scope
        target.updated_at = Date.now()
        await store.writeL3Nodes(nodes)
        await log('memory_replace', { node_id: target.id })
        return json({ status: 'ok', node_id: target.id })
      }

      const candidate: ConflictCandidate = {
        conflict_id: newId('conflict'),
        candidate: prospective,
        against_ids: result.against.map((n) => n.id),
        question: buildConflictQuestion(prospective, result.against),
        created_at: Date.now(),
        status: 'pending',
      }
      const pending = await store.readPending()
      pending.conflicts.push(candidate)
      await store.writePending(pending)
      await log('memory_replace_pending_conflict', {
        conflict_id: candidate.conflict_id,
        node_id: target.id,
        against_ids: candidate.against_ids,
      })

      return json({
        status: 'pending_conflict',
        conflict_id: candidate.conflict_id,
        question: candidate.question,
      })
    },
  })
}
