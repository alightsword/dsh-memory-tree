/**
 * Shared helpers for memory tools.
 */

import { randomUUID } from 'node:crypto'
import type { MemoryNode, NodeType } from '../types.js'

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`
}

/**
 * Normalize a value into a JSON-safe object for tool outputs. Strips
 * `undefined` fields and coerces internal objects (e.g. MemoryNode) into plain
 * JSON objects, satisfying dsh-tools' strict `execute(): Promise<JsonValue>`.
 * Returns `any` so the caller's shape is accepted as a JsonValue.
 */
export function json(value: any): any {
  return JSON.parse(JSON.stringify(value))
}

export function now(): number {
  return Date.now()
}

export function makeNode(opts: {
  statement: string
  type?: NodeType
  scope?: string
  body?: string
  base_weight?: number
  source?: MemoryNode['source']
}): MemoryNode {
  const t = now()
  return {
    id: newId('mem'),
    scope: opts.scope,
    type: opts.type ?? 'rule',
    statement: opts.statement,
    status: 'active',
    source: opts.source ?? 'model',
    base_weight: opts.base_weight ?? 1,
    created_at: t,
    updated_at: t,
    body: opts.body,
  }
}

/**
 * Build the confirmation question the model should relay verbatim to the user.
 */
export function buildConflictQuestion(
  candidate: MemoryNode,
  against: MemoryNode[],
): string {
  const againstSummary = against
    .map((n) => `「${n.statement}」`)
    .join(' 与 ')
  return (
    `检测到新表达「${candidate.statement}」与现有规矩 ${againstSummary} 相矛盾。` +
    `请确认处理方式：replace（用新表达替换旧规矩）/ scope_split（划清各自适用范围，两者并存）/ reject（放弃新表达）。`
  )
}
