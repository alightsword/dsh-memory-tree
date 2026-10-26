/**
 * memory_recall — query the long-term store via cue index (top-K summaries).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MemoryStore } from '../store.js'
import type { MemoryConfig } from '../types.js'
import { json } from './helpers.js'

export interface MemoryRecallDeps {
  store: MemoryStore
  config: MemoryConfig
}

export function memoryRecallTool(deps: MemoryRecallDeps) {
  const { store, config } = deps

  return defineTool({
    name: 'memory_recall',
    description: 'Recall top-K long-term memory summaries matching the given cues.',
    parameters: {
      cues: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Up to 5 cue strings to search.',
      },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value: any) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args: any) {
      const index = await store.readCueIndex()
      const cues: string[] = (args.cues ?? []).slice(0, 5)
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

      const summaries = scored.map((x) => ({
        cue: x.entry.cue,
        summary: x.entry.summary,
        node_ids: x.entry.node_ids,
      }))

      return json({ status: 'ok', results: summaries })
    },
  })
}
