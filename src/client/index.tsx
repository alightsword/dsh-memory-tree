/**
 * dsh-memory-tree client half — sidebar panel (feiyu-memory style).
 *
 * Two-slot sidebar panel (sidebar.panellist + main) showing the plugin's
 * three-tier memory. Visual language follows feiyu-memory:
 *   - one-line overview header ("本地存储 · N 条 · 认识 N 天");
 *   - card stream with relative timestamps, scope chips and in-place edit;
 *   - two-step inline delete confirm (忘掉 → 确定忘掉？/ 算了), no modal;
 *   - a manual note composer so users can add / edit memories themselves.
 * The layered identity is kept: L3 cards are the main stream, L2 conflicts
 * and the agent decision log render as dedicated sections below.
 *
 * Client contract (verified against feiyu-memory + dsh-meme):
 *   - export `inject` array (here `['slots']`);
 *   - access services via `ctx.get('slots')`;
 *   - register `sidebar.panellist` + `main` (key/id must match);
 *   - React via `require('react')` from the browser module table.
 */

declare const React: any

export const inject = ['slots']

const PANEL_ID = 'memory-tree'

const C = {
  layer1: 'var(--dsw-alias-bg-layer-1)',
  layer2: 'var(--dsw-alias-bg-layer-2)',
  border: 'var(--dsw-alias-border-l1)',
  label: 'var(--dsw-alias-label-primary)',
  label2: 'var(--dsw-alias-label-secondary)',
  danger: 'var(--dsw-alias-status-danger, #d33)',
  accent: 'var(--dsw-alias-brand-primary)',
}

const CSS = [
  '.mtp{display:flex;flex-direction:column;gap:14px;padding:6px 2px;font-size:13px;color:' + C.label + ';line-height:1.55}',
  '.mtp .mtp-ov{font-size:12px;color:' + C.label2 + '}',
  '.mtp .mtp-sec{display:flex;flex-direction:column;gap:8px}',
  '.mtp .mtp-head{font-size:13px;font-weight:600;color:' + C.label + '}',
  '.mtp .mtp-sub{font-size:11px;font-weight:400;color:' + C.label2 + ';margin-left:6px}',
  '.mtp .mtp-card{position:relative;display:flex;flex-direction:column;gap:4px;padding:8px 10px;background:' + C.layer1 + ';border:1px solid ' + C.border + ';border-radius:10px}',
  '.mtp .mtp-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px;color:' + C.label2 + '}',
  '.mtp .mtp-chip{padding:0 6px;border-radius:4px;background:' + C.layer2 + ';white-space:nowrap}',
  '.mtp .mtp-chip.warn{color:' + C.danger + ';border:1px solid ' + C.danger + ';background:transparent}',
  '.mtp .mtp-statement{white-space:pre-wrap;word-break:break-word}',
  '.mtp .mtp-ops{display:flex;gap:8px;justify-content:flex-end;font-size:11px}',
  '.mtp .mtp-link{background:none;border:none;padding:0;color:' + C.label2 + ';cursor:pointer;font-size:11px;text-decoration:underline}',
  '.mtp .mtp-link:hover{color:' + C.label + '}',
  '.mtp .mtp-link.danger{color:' + C.danger + '}',
  '.mtp .mtp-confirm{display:flex;gap:10px;justify-content:flex-end;font-size:12px;color:' + C.label2 + ';margin-top:2px}',
  '.mtp textarea.mtp-input{width:100%;box-sizing:border-box;min-height:56px;resize:vertical;background:' + C.layer1 + ';color:' + C.label + ';border:1px solid ' + C.border + ';border-radius:8px;padding:8px;font-size:13px;font-family:inherit;line-height:1.5}',
  '.mtp textarea.mtp-input:focus{outline:none;border-color:' + C.accent + '}',
  '.mtp .mtp-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
  '.mtp .mtp-select,.mtp .mtp-scope{background:' + C.layer1 + ';color:' + C.label + ';border:1px solid ' + C.border + ';border-radius:6px;padding:3px 8px;font-size:12px}',
  '.mtp .mtp-scope{flex:1;min-width:90px}',
  '.mtp .mtp-add{border:1px solid ' + C.accent + ';color:' + C.accent + ';background:transparent;border-radius:6px;padding:3px 14px;cursor:pointer;font-size:12px}',
  '.mtp .mtp-add:hover{background:' + C.layer2 + '}',
  '.mtp .mtp-add:disabled{opacity:.5;cursor:default}',
  '.mtp .mtp-err{color:' + C.danger + ';font-size:12px}',
  '.mtp .mtp-empty{font-size:12px;color:' + C.label2 + ';font-style:italic}',
  '.mtp .mtp-logline{display:flex;gap:8px;font-size:12px;color:' + C.label2 + ';border-bottom:1px dashed ' + C.border + ';padding:2px 0}',
  '.mtp .mtp-logts{flex:none;opacity:.7}',
  '.mtp .mtp-logbox{display:flex;flex-direction:column;gap:2px;max-height:200px;overflow:auto}',
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

type ConflictItem = { conflict_id: string; question: string; created_at: number }

type StatePayload = {
  ok: boolean
  error?: string
  persona: { complete: boolean; mode: string }
  first_seen: number
  layers: {
    l1: { snapshot_stale: boolean }
    l2: { buffer: Array<{ id: string; statement: string; type: string }>; pending_conflicts: ConflictItem[] }
    l3: { nodes: NodeItem[] }
  }
  log: Array<{ ts: number; event: string; detail?: unknown }>
  config: Record<string, unknown>
}

const BASE = '/dsh-memory-tree-api'

function relTime(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  return `${day} 天前`
}

function Icon(props: any) {
  const size = props && typeof props.size === 'number' ? props.size : 20
  const active = Boolean(props && props.active)
  return React.createElement(
    'svg',
    {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', role: 'img',
      'aria-label': '记忆树', style: { display: 'block', opacity: active ? 1 : 0.72 },
    },
    React.createElement('path', { d: 'M12 3 L12 8 M12 8 L6 12 M12 8 L18 12 M12 8 L12 15', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
    React.createElement('circle', { cx: 12, cy: 3, r: 1.6, fill: 'currentColor' }),
    React.createElement('circle', { cx: 6, cy: 14, r: 1.8, fill: 'currentColor' }),
    React.createElement('circle', { cx: 12, cy: 17, r: 1.8, fill: 'currentColor' }),
    React.createElement('circle', { cx: 18, cy: 14, r: 1.8, fill: 'currentColor' }),
  )
}

/** One L3 card: chips + statement + (edit in place) + two-step forget. */
function NodeCard(props: { node: NodeItem; onDone: () => void; post: (path: string, body: any) => Promise<any>; setError: (s: string) => void }) {
  const n = props.node
  const [confirming, setConfirming] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(n.statement)
  const [busy, setBusy] = React.useState(false)

  const doForget = () => {
    setBusy(true)
    props.post('/forget', { id: n.id }).then((j) => {
      setBusy(false)
      if (j?.ok) props.onDone()
      else props.setError(String(j?.error ?? '删除失败'))
    })
  }
  const saveEdit = () => {
    const text = draft.trim()
    if (!text || text === n.statement) return setEditing(false)
    setBusy(true)
    props.post('/edit', { id: n.id, statement: text }).then((j) => {
      setBusy(false)
      if (j?.ok) {
        setEditing(false)
        props.onDone()
      } else props.setError(String(j?.error ?? '保存失败'))
    })
  }

  return React.createElement(
    'div',
    { className: 'mtp-card' },
    React.createElement(
      'div',
      { className: 'mtp-meta' },
      React.createElement('span', null, relTime(n.updated_at)),
      React.createElement('span', { className: 'mtp-chip' }, n.type === 'rule' ? '规矩' : '事实'),
      n.scope ? React.createElement('span', { className: 'mtp-chip' }, n.scope) : null,
      n.source === 'confirmed' ? React.createElement('span', { className: 'mtp-chip' }, '已确认') : null,
    ),
    editing
      ? React.createElement('textarea', {
          className: 'mtp-input',
          value: draft,
          onChange: (e: any) => setDraft(e.target.value),
          autoFocus: true,
        })
      : React.createElement('div', { className: 'mtp-statement' }, n.statement),
    confirming
      ? React.createElement(
          'div',
          { className: 'mtp-confirm' },
          '确定忘掉？',
          React.createElement('button', { className: 'mtp-link danger', disabled: busy, onClick: doForget }, busy ? '…' : '忘掉'),
          React.createElement('button', { className: 'mtp-link', onClick: () => setConfirming(false) }, '算了'),
        )
      : React.createElement(
          'div',
          { className: 'mtp-ops' },
          React.createElement('button', { className: 'mtp-link', onClick: () => setEditing((v) => !v) }, editing ? '收起' : '改'),
          React.createElement('button', { className: 'mtp-link danger', onClick: () => setConfirming(true) }, '忘掉'),
        ),
  )
}

function Panel() {
  const [data, setData] = React.useState<StatePayload | null>(null)
  const [error, setError] = React.useState('')
  const [tick, setTick] = React.useState(0)
  const [noteText, setNoteText] = React.useState('')
  const [noteType, setNoteType] = React.useState('rule')
  const [noteScope, setNoteScope] = React.useState('')
  const [noteBusy, setNoteBusy] = React.useState(false)

  const post = React.useCallback((path: string, body: any) =>
    fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json()), [])

  const load = React.useCallback(() => {
    fetch(BASE + '/state', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          setData(j)
          setError('')
        } else setError(String(j?.error ?? 'unknown error'))
      })
      .catch((e) => setError(String(e?.message ?? e)))
  }, [])

  React.useEffect(() => {
    load()
  }, [load, tick])

  const refresh = () => setTick((t) => t + 1)

  const addNote = () => {
    const statement = noteText.trim()
    if (!statement) return
    setNoteBusy(true)
    post('/note', { statement, type: noteType, scope: noteScope }).then((j) => {
      setNoteBusy(false)
      if (j?.ok) {
        setNoteText('')
        setNoteScope('')
        refresh()
      } else setError(String(j?.error ?? '添加失败'))
    })
  }

  const layers = data?.layers
  const nodes = [...(layers?.l3.nodes ?? [])].sort((a, b) => b.updated_at - a.updated_at)
  const activeNodes = nodes.filter((n) => n.status === 'active')
  const buffer = layers?.l2.buffer ?? []
  const pending = layers?.l2.pending_conflicts ?? []
  const log = data?.log ?? []

  // Overview: count + days known.
  let overview = ''
  if (data) {
    const count = activeNodes.length
    const days = data.first_seen ? Math.max(1, Math.ceil((Date.now() - data.first_seen) / 86400000)) : 1
    overview = `本地存储 · ${count} 条 · 认识 ${days} 天`
  }

  return React.createElement(
    'div',
    { className: 'mtp' },
    React.createElement('div', { className: 'mtp-ov' }, overview || (error ? '' : '加载中…')),

    // --- 自录入 ---
    React.createElement(
      'div',
      { className: 'mtp-sec' },
      React.createElement('div', { className: 'mtp-head' }, '手动记一条'),
      React.createElement('textarea', {
        className: 'mtp-input',
        placeholder: '写一条要长期记住的事，例如：我不吃香菜',
        value: noteText,
        onChange: (e: any) => setNoteText(e.target.value),
      }),
      React.createElement(
        'div',
        { className: 'mtp-row' },
        React.createElement(
          'select',
          { className: 'mtp-select', value: noteType, onChange: (e: any) => setNoteType(e.target.value) },
          React.createElement('option', { value: 'rule' }, '规矩'),
          React.createElement('option', { value: 'fact' }, '事实'),
        ),
        React.createElement('input', {
          className: 'mtp-scope',
          placeholder: 'scope（可选，如 qq 群）',
          value: noteScope,
          onChange: (e: any) => setNoteScope(e.target.value),
        }),
        React.createElement('button', { className: 'mtp-add', disabled: noteBusy || !noteText.trim(), onClick: addNote }, noteBusy ? '…' : '记住'),
      ),
    ),

    // --- 最近的事（L3 active 卡片流） ---
    React.createElement(
      'div',
      { className: 'mtp-sec' },
      React.createElement('div', { className: 'mtp-head' }, '记下的事', React.createElement('span', { className: 'mtp-sub' }, '长时记忆，改动会影响快照')),
      activeNodes.length === 0
        ? React.createElement('div', { className: 'mtp-empty' }, '还没有记住任何事')
        : activeNodes.map((n) =>
            React.createElement(NodeCard, { key: n.id, node: n, onDone: refresh, post, setError }),
          ),
    ),

    // --- L2 短时层 ---
    (buffer.length > 0 || pending.length > 0)
      ? React.createElement(
          'div',
          { className: 'mtp-sec' },
          React.createElement('div', { className: 'mtp-head' }, '短时与冲突', React.createElement('span', { className: 'mtp-sub' }, 'L2 · 自动流转，无需手动管理')),
          buffer.map((b) =>
            React.createElement(
              'div',
              { className: 'mtp-card', key: b.id },
              React.createElement('div', { className: 'mtp-statement' }, b.statement),
            ),
          ),
          pending.map((c) =>
            React.createElement(
              'div',
              { className: 'mtp-card', key: c.conflict_id },
              React.createElement(
                'div',
                { className: 'mtp-meta' },
                React.createElement('span', { className: 'mtp-chip warn' }, '冲突待确认'),
              ),
              React.createElement('div', { className: 'mtp-statement' }, c.question),
            ),
          ),
        )
      : null,

    // --- 决策日志 ---
    React.createElement(
      'div',
      { className: 'mtp-sec' },
      React.createElement('div', { className: 'mtp-head' }, '决策日志', React.createElement('span', { className: 'mtp-sub' }, 'agent 的记忆操作记录')),
      log.length === 0
        ? React.createElement('div', { className: 'mtp-empty' }, '（无记录）')
        : React.createElement(
            'div',
            { className: 'mtp-logbox' },
            log.slice(-50).reverse().map((l, i) =>
              React.createElement(
                'div',
                { className: 'mtp-logline', key: i },
                React.createElement('span', { className: 'mtp-logts' }, relTime(l.ts)),
                React.createElement('span', null, l.event),
              ),
            ),
          ),
    ),

    error ? React.createElement('div', { className: 'mtp-err' }, error) : null,
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
