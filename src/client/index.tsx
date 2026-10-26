/**
 * dsh-memory-tree client half — sidebar panel.
 *
 * A sidebar panel (same two-slot pattern as feiyu-memory) that shows the
 * plugin's three-tier memory — L1 transient / L2 short-term / L3 long-term —
 * plus the agent's decision log, with a delete action. The layered view is
 * the plugin's core identity, so it is surfaced here, not flattened.
 *
 * Client contract (verified against feiyu-memory + dsh-meme):
 *   - export `inject` array (here `['slots']`);
 *   - access services via `ctx.get('slots')`;
 *   - register the sidebar entry on `sidebar.panellist` and the panel on
 *     `main` (their key/id must match);
 *   - React via `require('react')` from the browser module table.
 *
 * Data flows over the host webServer:
 *   GET  /dsh-memory-tree-api/state   -> layered memory + log + config
 *   POST /dsh-memory-tree-api/forget  -> delete one L3 node by id
 */

declare const React: any

export const inject = ['slots']

const PANEL_ID = 'memory-tree'

const C = {
  bg: 'var(--dsw-alias-bg-base)',
  layer1: 'var(--dsw-alias-bg-layer-1)',
  layer2: 'var(--dsw-alias-bg-layer-2)',
  border: 'var(--dsw-alias-border-l1)',
  label: 'var(--dsw-alias-label-primary)',
  label2: 'var(--dsw-alias-label-secondary)',
  danger: 'var(--dsw-alias-status-danger, #d33)',
  accent: 'var(--dsw-alias-brand-primary)',
}

const CSS = [
  '.mtp-panel{display:flex;flex-direction:column;gap:12px;padding:8px 4px;font-size:13px;color:' + C.label + '}',
  '.mtp-panel .mtp-err{color:' + C.danger + ';font-size:12px}',
  '.mtp-panel .mtp-bar{display:flex;gap:8px;align-items:center}',
  '.mtp-panel .mtp-refresh,.mtp-panel .mtp-del{border:1px solid ' + C.border + ';background:transparent;color:inherit;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:12px}',
  '.mtp-panel .mtp-refresh:hover{background:' + C.layer2 + '}',
  '.mtp-panel .mtp-del{color:' + C.danger + ';border-color:' + C.danger + ';opacity:.8;margin-left:auto}',
  '.mtp-panel .mtp-section{display:flex;flex-direction:column;gap:6px}',
  '.mtp-panel .mtp-head{font-size:12px;font-weight:600;color:' + C.label2 + ';text-transform:uppercase;letter-spacing:.04em}',
  '.mtp-panel .mtp-node{display:flex;flex-direction:column;gap:2px;padding:6px 8px;background:' + C.layer1 + ';border:1px solid ' + C.border + ';border-radius:8px}',
  '.mtp-panel .mtp-node .mtp-statement{color:' + C.label + ';line-height:1.4}',
  '.mtp-panel .mtp-node .mtp-meta{display:flex;gap:8px;font-size:11px;color:' + C.label2 + '}',
  '.mtp-panel .mtp-node .mtp-tag{padding:0 5px;border-radius:4px;background:' + C.layer2 + '}',
  '.mtp-panel .mtp-log{display:flex;flex-direction:column;gap:3px;max-height:220px;overflow:auto}',
  '.mtp-panel .mtp-log .mtp-logline{font-size:12px;color:' + C.label2 + ';display:flex;gap:8px;border-bottom:1px dashed ' + C.border + ';padding:2px 0}',
  '.mtp-panel .mtp-log .mtp-logts{flex:none;opacity:.7}',
  '.mtp-panel .mtp-empty{font-size:12px;color:' + C.label2 + ';font-style:italic}',
].join('\n')

type NodeItem = {
  id: string
  statement: string
  type: string
  status: string
  scope: string
  source: string
  updated_at: number
}

type ConflictItem = {
  conflict_id: string
  question: string
  created_at: number
}

type StatePayload = {
  ok: boolean
  error?: string
  persona: { complete: boolean; mode: string }
  layers: {
    l1: { snapshot_stale: boolean; description: string }
    l2: { buffer: Array<{ id: string; statement: string; type: string }>; pending_conflicts: ConflictItem[]; description: string }
    l3: { nodes: NodeItem[]; description: string }
  }
  log: Array<{ ts: number; event: string; detail?: unknown }>
  config: Record<string, unknown>
}

const API_STATE = '/dsh-memory-tree-api/state'
const API_FORGET = '/dsh-memory-tree-api/forget'

function fmtTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function Icon(props: any) {
  const size = props && typeof props.size === 'number' ? props.size : 20
  const active = Boolean(props && props.active)
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      role: 'img',
      'aria-label': '记忆树',
      style: { display: 'block', opacity: active ? 1 : 0.72 },
    },
    // three stacked tiers (L1/L2/L3) as a small tree
    React.createElement('path', {
      d: 'M12 3 L12 8',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
    }),
    React.createElement('path', {
      d: 'M12 8 L6 12 M12 8 L18 12',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
    }),
    React.createElement('circle', { cx: 12, cy: 3, r: 1.6, fill: 'currentColor' }),
    React.createElement('circle', { cx: 6, cy: 14, r: 1.8, fill: 'currentColor' }),
    React.createElement('circle', { cx: 12, cy: 17, r: 1.8, fill: 'currentColor' }),
    React.createElement('circle', { cx: 18, cy: 14, r: 1.8, fill: 'currentColor' }),
    React.createElement('path', {
      d: 'M12 8 L12 15',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
    }),
  )
}

function Panel() {
  const [data, setData] = React.useState<StatePayload | null>(null)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState('')
  const [tick, setTick] = React.useState(0)

  const load = React.useCallback(() => {
    fetch(API_STATE, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          setData(j)
          setError('')
        } else {
          setError(String(j?.error ?? 'unknown error'))
        }
      })
      .catch((e) => setError(String(e?.message ?? e)))
  }, [])

  React.useEffect(() => {
    load()
  }, [load, tick])

  const forget = (id: string) => {
    setBusy(id)
    fetch(API_FORGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && j.removed) setTick((t) => t + 1)
        else setError(j?.error ?? 'delete failed')
      })
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setBusy(''))
  }

  if (error && !data) {
    return React.createElement(
      'div',
      { className: 'mtp-panel' },
      React.createElement('div', { className: 'mtp-err' }, '加载失败: ' + error),
      React.createElement('button', { className: 'mtp-refresh', onClick: () => setTick((t) => t + 1) }, '重试'),
    )
  }

  const layers = data?.layers
  const nodes = layers?.l3.nodes ?? []
  const buffer = layers?.l2.buffer ?? []
  const pending = layers?.l2.pending_conflicts ?? []
  const log = data?.log ?? []

  return React.createElement(
    'div',
    { className: 'mtp-panel' },
    React.createElement(
      'div',
      { className: 'mtp-bar' },
      React.createElement(
        'button',
        { className: 'mtp-refresh', onClick: () => setTick((t) => t + 1) },
        '刷新',
      ),
      data
        ? React.createElement(
            'span',
            { style: { fontSize: 11, color: C.label2 } },
            (data.persona.complete ? 'complete 模式' : data.persona.mode),
          )
        : null,
    ),

    // --- L3 长时层 ---
    React.createElement(
      'div',
      { className: 'mtp-section' },
      React.createElement('div', { className: 'mtp-head' }, 'L3 长时记忆'),
      nodes.length === 0
        ? React.createElement('div', { className: 'mtp-empty' }, '（空）')
        : nodes.map((n) =>
            React.createElement(
              'div',
              { className: 'mtp-node', key: n.id },
              React.createElement('div', { className: 'mtp-statement' }, n.statement),
              React.createElement(
                'div',
                { className: 'mtp-meta' },
                React.createElement('span', { className: 'mtp-tag' }, n.type),
                React.createElement('span', { className: 'mtp-tag' }, n.status),
                n.scope ? React.createElement('span', { className: 'mtp-tag' }, n.scope) : null,
                React.createElement('span', { style: { marginLeft: 'auto' } }, fmtTime(n.updated_at)),
                React.createElement(
                  'button',
                  {
                    className: 'mtp-del',
                    disabled: busy === n.id,
                    onClick: () => forget(n.id),
                  },
                  busy === n.id ? '…' : '删',
                ),
              ),
            ),
          ),
    ),

    // --- L2 短时层 ---
    React.createElement(
      'div',
      { className: 'mtp-section' },
      React.createElement('div', { className: 'mtp-head' }, 'L2 短时记忆'),
      buffer.length === 0 && pending.length === 0
        ? React.createElement('div', { className: 'mtp-empty' }, '（空）')
        : null,
      buffer.map((b) =>
        React.createElement(
          'div',
          { className: 'mtp-node', key: b.id },
          React.createElement('div', { className: 'mtp-statement' }, b.statement),
          React.createElement(
            'div',
            { className: 'mtp-meta' },
            React.createElement('span', { className: 'mtp-tag' }, b.type),
          ),
        ),
      ),
      pending.map((c) =>
        React.createElement(
          'div',
          { className: 'mtp-node', key: c.conflict_id },
          React.createElement('div', { className: 'mtp-statement' }, c.question),
          React.createElement(
            'div',
            { className: 'mtp-meta' },
            React.createElement('span', { className: 'mtp-tag', style: { color: C.danger } }, '冲突待确认'),
          ),
        ),
      ),
    ),

    // --- L1 瞬时层 ---
    React.createElement(
      'div',
      { className: 'mtp-section' },
      React.createElement('div', { className: 'mtp-head' }, 'L1 瞬时层'),
      React.createElement(
        'div',
        { className: 'mtp-empty' },
        layers?.l1.snapshot_stale ? '快照已过期（待重建）' : '快照已冻结',
      ),
    ),

    // --- 决策日志 ---
    React.createElement(
      'div',
      { className: 'mtp-section' },
      React.createElement('div', { className: 'mtp-head' }, '决策日志'),
      log.length === 0
        ? React.createElement('div', { className: 'mtp-empty' }, '（无记录）')
        : React.createElement(
            'div',
            { className: 'mtp-log' },
            log
              .slice(-50)
              .reverse()
              .map((l, i) =>
                React.createElement(
                  'div',
                  { className: 'mtp-logline', key: i },
                  React.createElement('span', { className: 'mtp-logts' }, fmtTime(l.ts)),
                  React.createElement('span', null, l.event),
                ),
              ),
          ),
    ),

    error
      ? React.createElement('div', { className: 'mtp-err' }, error)
      : null,
  )
}

export function apply(ctx: any): void {
  const styleEl = document.createElement('style')
  styleEl.textContent = CSS
  document.head.appendChild(styleEl)
  ctx.effect(() => () => styleEl.remove(), 'dsh-memory-tree: styles')

  const slots = ctx.get('slots')
  if (!slots) return

  slots.inject('sidebar.panellist', () =>
    slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: () => '记忆树' },
      Icon,
    ),
  )

  slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, Panel))
}
