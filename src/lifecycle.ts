/**
 * lifecycle.ts — session lifecycle hooks.
 *
 *   agent/created        → build frozen snapshot, inject channel one.
 *                          (rc.3 has NO `agent/session-start` event; the
 *                          serial `agent/created` fires once per live agent
 *                          with source 'startup' | 'resume' | 'clear' |
 *                          'compaction'.)
 *   agent/turn-stopping  → incrementally persist L2 buffer; fail-open.
 *   agent/disposed       → run a lightweight governance pass, fail-open.
 *   (per user message)   → run recall.ts for channel-two injection through the
 *                          agent/pre-step decision messages.
 */

import type { MemoryStore } from './store.js'
import type { MemoryConfig } from './types.js'
import { runSnapshot } from './snapshot.js'
import { runRecall, type RecallOutput } from './recall.js'
import { runGovernance } from './forgetting.js'

export interface LifecycleDeps {
  store: MemoryStore
  config: MemoryConfig
  snapshot: Parameters<typeof runSnapshot>[0]
  recall: Parameters<typeof runRecall>[0]
  governance: Parameters<typeof runGovernance>[0]
}

export interface LifecycleHooks {
  /** @param source agent/created source: startup | resume | clear | compaction. */
  onSessionStart: (source?: string) => Promise<void>
  onFlush: () => Promise<void>
  onDisposed: () => Promise<void>
  onUserMessage: (message: string) => Promise<RecallOutput>
}

export function createLifecycle(deps: LifecycleDeps): LifecycleHooks {
  return {
    async onSessionStart(source?: string) {
      try {
        if (await deps.store.isSnapshotStale()) {
          await deps.store.clearSnapshotStale()
        }
        await deps.snapshot.log('session_start', { source: source ?? 'unknown' })
        await runSnapshot(deps.snapshot)
      } catch (err) {
        await deps.snapshot.log('session_start_error', { error: String(err) })
      }
    },

    async onFlush() {
      try {
        await deps.store.ensureSkeleton()
      } catch (err) {
        await deps.snapshot.log('session_flush_error', { error: String(err) })
      }
    },

    async onDisposed() {
      try {
        await runGovernance(deps.governance)
      } catch (err) {
        await deps.snapshot.log('session_disposed_error', { error: String(err) })
      }
    },

    async onUserMessage(message: string) {
      try {
        return await runRecall(deps.recall, message)
      } catch (err) {
        await deps.snapshot.log('pre_step_error', { error: String(err) })
        return { recallText: null, reminderText: null }
      }
    },
  }
}
