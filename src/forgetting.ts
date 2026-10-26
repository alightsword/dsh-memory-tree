/**
 * forgetting.ts — power-law decay + archival, fail-open.
 *
 * Decay: R(t, S) = (1 + F*t/S) ** -0.5, weight = R × base_weight.
 * Archival only targets status:active AND source != confirmed nodes.
 *
 * Governance is fail-open: any error is logged and does not block the
 * conversation.
 */

import type { MemoryStore } from './store.js'
import type { MemoryConfig, MemoryNode } from './types.js'

export interface ForgettingDeps {
  store: MemoryStore
  config: MemoryConfig
  log: (event: string, detail?: unknown) => Promise<void>
}

/** F (forgetting factor) per tier. */
const FORGETTING_FACTOR: Record<MemoryConfig['forgetting_tier'], number> = {
  gentle: 0.2,
  normal: 0.5,
  aggressive: 1.0,
}

/** Half-life scale S in milliseconds (approx 30 days). */
const SCALE_S = 30 * 24 * 60 * 60 * 1000

export function decayWeight(
  node: MemoryNode,
  nowMs: number,
  tier: MemoryConfig['forgetting_tier'],
): number {
  const F = FORGETTING_FACTOR[tier]
  const t = Math.max(0, nowMs - node.updated_at)
  const R = Math.pow(1 + (F * t) / SCALE_S, -0.5)
  return R * node.base_weight
}

/**
 * Run a lightweight governance pass: decay weights and archive nodes whose
 * weight has decayed below the archival threshold. Fail-open.
 */
export async function runGovernance(deps: ForgettingDeps): Promise<void> {
  try {
    const nodes = await deps.store.readL3Nodes()
    const nowMs = Date.now()
    const THRESHOLD = 0.15

    for (const node of nodes) {
      if (node.status !== 'active' || node.source === 'confirmed') continue
      const w = decayWeight(node, nowMs, deps.config.forgetting_tier)
      if (w < THRESHOLD) {
        // Archive: mark superseded (no replacing node). Fail-open — just a status flip.
        node.status = 'superseded'
        node.updated_at = nowMs
        await deps.log('archive_decayed', { node_id: node.id, weight: w })
      }
    }

    await deps.store.writeL3Nodes(nodes)
  } catch (err) {
    // fail-open: log and continue, never throw to the conversation.
    await deps.log('governance_error', { error: String(err) })
  }
}
