/**
 * memory_show — inspect memory state.
 *
 *   refresh: true → explicitly rebuild the frozen snapshot in-session.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryStore } from '../store.js'
import type { MemoryConfig } from '../types.js'
import { json } from './helpers.js'

export interface MemoryShowDeps {
  store: MemoryStore
  config: MemoryConfig
  rebuildSnapshot: () => Promise<void>
  log: (event: string, detail?: unknown) => Promise<void>
}

export function memoryShowTool(deps: MemoryShowDeps) {
  const { store, rebuildSnapshot, log } = deps

  return defineTool({
    name: 'memory_show',
    description:
      'Show memory state (active rules, buffer, pending conflicts). Pass refresh:true ' +
      'to explicitly rebuild the frozen snapshot in the current session.',
    parameters: {
      refresh: {
        type: 'boolean',
        description: 'Explicitly rebuild the frozen snapshot now.',
      },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value: any) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args: any) {
      if (args.refresh === true) {
        await rebuildSnapshot()
        await store.clearSnapshotStale()
        await log('memory_show_refresh', { refresh: true })
      }

      const nodes = await store.readL3Nodes()
      const buffer = await store.readBuffer()
      const pending = await store.readPending()
      const root = await store.readRootMd()

      return json({
        status: 'ok',
        active_rules: nodes.filter((n) => n.status === 'active' && n.type === 'rule'),
        active_facts: nodes.filter((n) => n.status === 'active' && n.type === 'fact'),
        superseded: nodes.filter((n) => n.status === 'superseded').map((n) => n.id),
        buffer_count: buffer.length,
        pending_conflicts: pending.conflicts
          .filter((c) => c.status === 'pending')
          .map((c) => ({ conflict_id: c.conflict_id, question: c.question })),
        root_md: root,
      })
    },
  })
}
