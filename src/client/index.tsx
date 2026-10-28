/**
 * dsh-memory-tree client half — sidebar panel (feiyu-memory visual clone).
 *
 * Two-slot sidebar panel (sidebar.panellist + main). Visual language is a
 * deliberate close copy of feiyu-memory: inline styles, theme tokens only,
 * the same card / section / link-button / relative-time patterns.
 *
 * Client contract (verified against feiyu-memory + dsh-meme):
 *   - export `inject` array (here `['slots']`);
 *   - access services via `ctx.get('slots')`;
 *   - register `sidebar.panellist` + `main` (key/id must match);
 *   - React via `require('react')` from the browser module table.
 */

declare const React: any

import { MemoryTree } from './tree'

export const inject = ['slots']

// client-build marker v3 (feiyu-style panel; bump to force a DSH bundle re-read)
const PANEL_ID = 'memory-tree'

/** Theme tokens only — light/dark switch automatically. */
const C = {
  bg: 'var(--dsw-alias-bg-base)',
  layer1: 'var(--dsw-alias-bg-layer-1)',
  layer2: 'var(--dsw-alias-bg-layer-2)',
  border1: 'var(--dsw-alias-border-l1)',
  border2: 'var(--dsw-alias-border-l2)',
  text1: 'var(--dsw-alias-label-primary)',
  text2: 'var(--dsw-alias-label-secondary)',
  idle: 'var(--dsw-alias-state-idle-primary)',
  err: 'var(--dsw-alias-state-error-primary)',
  brand: 'var(--dsw-alias-brand-primary)',
}

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
  log: Array<{ ts: number; event: string }>
  config: Record<string, unknown>
}

const BASE = '/dsh-memory-tree-api'

/** 时间说人话：今天 / 昨天 / 3 天前 / 10-05 */
function dayLabel(ts: number): string {
  if (!Number.isFinite(ts)) return ''
  const startOfDay = (t: number) => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}

function linkStyle(color: string): any {
  return {
    margin: 0,
    padding: 0,
    border: 0,
    background: 'none',
    color,
    font: 'inherit',
    fontSize: 12,
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
  }
}

function viewToggleStyle(active: boolean): any {
  return {
    margin: 0,
    padding: '3px 14px',
    border: `1px solid ${active ? C.brand : C.border1}`,
    borderRadius: 6,
    // Never use a brand fill: brand-primary resolves light in dark theme, which
    // would put light text on a light button. Use a dark surface + brand border
    // for the active state instead.
    background: active ? C.layer1 : 'none',
    color: active ? C.text1 : C.text2,
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
  }
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

function Section(props: { title: string; sub?: string; children: any }) {
  return React.createElement(
    'section',
    { style: { marginTop: 26 } },
    React.createElement(
      'h3',
      { style: { margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: C.text1, letterSpacing: 0 } },
      props.title,
      props.sub ? React.createElement('span', { style: { fontWeight: 400, fontSize: 12, color: C.text2, marginLeft: 8 } }, props.sub) : null,
    ),
    props.children,
  )
}

function Empty(props: { text: string }) {
  return React.createElement(
    'p',
    { style: { margin: 0, fontSize: 13, lineHeight: 1.7, color: C.text2 } },
    props.text,
  )
}

/** 一条 L3 记忆卡片（对齐 feiyu 的 Entry）。 */
function NodeCard(props: {
  node: NodeItem
  onDone: () => void
  post: (path: string, body: any) => Promise<any>
  setError: (s: string) => void
}) {
  const n = props.node
  const [confirming, setConfirming] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(n.statement)
  const [busy, setBusy] = React.useState(false)

  const when = dayLabel(n.updated_at)
  const tags = [n.type === 'rule' ? '规矩' : '事实']
  if (n.scope) tags.push(n.scope)

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
    'article',
    { id: 'mem-node-' + n.id, style: { position: 'relative', padding: '12px 14px', marginBottom: 8, borderRadius: 10, background: C.layer1, border: `1px solid ${C.border1}` } },
    React.createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 11, color: C.text2 } },
      React.createElement('span', null, when),
      tags.length > 0 ? React.createElement('span', { style: { opacity: 0.6 } }, '·') : null,
      React.createElement('span', null, tags.join(' · ')),
    ),
    editing
      ? React.createElement('textarea', {
          value: draft,
          onChange: (e: any) => setDraft(e.target.value),
          autoFocus: true,
          style: {
            width: '100%', boxSizing: 'border-box', minHeight: 64, resize: 'vertical',
            padding: '8px 10px', margin: 0, fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit',
            color: C.text1, background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 8,
          },
        })
      : React.createElement('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.75, color: C.text1 } }, n.statement),
    React.createElement(
      'div',
      { style: { marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' } },
      confirming
        ? React.createElement(
            'span',
            { style: { display: 'inline-flex', gap: 10, alignItems: 'center', fontSize: 12 } },
            React.createElement('span', { style: { color: C.text2 } }, '确定忘掉？'),
            React.createElement('button', { type: 'button', onClick: doForget, disabled: busy, style: linkStyle(C.err) }, busy ? '…' : '忘掉'),
            React.createElement('button', { type: 'button', onClick: () => setConfirming(false), style: linkStyle(C.text2) }, '算了'),
          )
        : React.createElement(
            React.Fragment,
            null,
            React.createElement('button', {
              type: 'button', onClick: () => setEditing((v) => !v),
              style: { ...linkStyle(C.text2), opacity: 0.75 },
            }, editing ? '收起' : '改'),
            React.createElement('button', {
              type: 'button', onClick: () => setConfirming(true),
              style: { ...linkStyle(C.text2), opacity: busy ? 0.5 : 0.75 },
              disabled: Boolean(busy),
            }, '忘掉'),
          ),
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
  const [view, setView] = React.useState<'list' | 'tree'>('tree')
  const [focusId, setFocusId] = React.useState<string | null>(null)

  const focusNode = React.useCallback((nodeId: string) => {
    // Switch to list view and scroll to the matching card.
    setView('list')
    setFocusId(nodeId)
    setTimeout(() => {
      const el = document.getElementById('mem-node-' + nodeId)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }, [])

  const post = React.useCallback(
    (path: string, body: any) =>
      fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    [],
  )

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

  const count = activeNodes.length
  const days = data && data.first_seen ? Math.max(1, Math.ceil((Date.now() - data.first_seen) / 86400000)) : 1
  const pendingCount = pending.length
  const overview = data
    ? `本地存储 · ${count} 条` + (pendingCount > 0 ? ` · ${pendingCount} 条冲突待确认` : '') + ` · 认识 ${days} 天`
    : ''

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        padding: '4px 2px',
        fontSize: 13,
        lineHeight: 1.55,
        color: C.text1,
        // The sidebar `main` slot does not scroll by itself; make the panel
        // scrollable so long lists (and the tree) are fully reachable.
        height: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box',
      },
    },

    // 大标题 + 概览（对齐肥鱼的「肥鱼日记 + 本地存储 · N 条」结构）
    React.createElement('h2', { style: { margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: C.text1 } }, '记忆树'),
    React.createElement('p', { style: { margin: 0, fontSize: 12, color: C.text2 } }, overview),

    // 视图切换：树状 / 列表
    React.createElement(
      'div',
      { style: { display: 'flex', gap: 6, margin: '14px 0 6px' } },
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => setView('tree'),
          style: viewToggleStyle(view === 'tree'),
        },
        '树状',
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => setView('list'),
          style: viewToggleStyle(view === 'list'),
        },
        '列表',
      ),
    ),

    // 树状视图（默认）
    view === 'tree'
      ? React.createElement(MemoryTree, { nodes: layers?.l3.nodes ?? [], onFocus: focusNode })
      : null,

    // 列表视图：顶部加"返回树状"入口（点击叶子跳转后，用户需要能回去）
    view === 'list'
      ? React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => setView('tree'),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              margin: '2px 0 14px',
              padding: '5px 12px',
              border: `1px solid ${C.border1}`,
              borderRadius: 6,
              background: C.layer1,
              color: C.text1,
              fontSize: 12,
              cursor: 'pointer',
            },
          },
          '← 返回树状',
        )
      : null,

    // 自录入
    view === 'list'
      ? React.createElement(
      Section,
      { title: '手动记一条' },
      React.createElement('textarea', {
        placeholder: '写一条要长期记住的事，例如：我不吃香菜',
        value: noteText,
        onChange: (e: any) => setNoteText(e.target.value),
        style: {
          width: '100%', boxSizing: 'border-box', minHeight: 60, resize: 'vertical',
          padding: '8px 10px', marginBottom: 8, fontSize: 13, lineHeight: 1.6, fontFamily: 'inherit',
          color: C.text1, background: C.layer1, border: `1px solid ${C.border1}`, borderRadius: 8,
        },
      }),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        React.createElement('select', {
          value: noteType,
          onChange: (e: any) => setNoteType(e.target.value),
          style: { background: C.layer1, color: C.text1, border: `1px solid ${C.border1}`, borderRadius: 6, padding: '3px 8px', fontSize: 12 },
        },
          React.createElement('option', { value: 'rule' }, '规矩'),
          React.createElement('option', { value: 'fact' }, '事实'),
        ),
        React.createElement('input', {
          placeholder: 'scope（可选）',
          value: noteScope,
          onChange: (e: any) => setNoteScope(e.target.value),
          style: { flex: 1, minWidth: 90, background: C.layer1, color: C.text1, border: `1px solid ${C.border1}`, borderRadius: 6, padding: '4px 8px', fontSize: 12 },
        }),
        React.createElement('button', {
          type: 'button',
          onClick: addNote,
          disabled: noteBusy || !noteText.trim(),
          style: {
            margin: 0, padding: '3px 14px', border: `1px solid ${C.brand}`, borderRadius: 6,
            background: 'none', color: C.brand, fontSize: 12, cursor: 'pointer', opacity: noteBusy || !noteText.trim() ? 0.5 : 1,
          },
        }, noteBusy ? '…' : '记住'),
      ),
    ) : null,

    // L3 记下的事
    view === 'list'
      ? React.createElement(
      Section,
      { title: '记下的事', sub: '长时记忆' },
      activeNodes.length === 0
        ? React.createElement(Empty, { text: '还没有记住任何事' })
        : activeNodes.map((n) =>
            React.createElement(NodeCard, { key: n.id, node: n, onDone: refresh, post, setError }),
          ),
    ) : null,

    // L2 短时与冲突
    view === 'list' && (buffer.length > 0 || pending.length > 0)
      ? React.createElement(
          Section,
          { title: '短时与冲突', sub: '自动流转' },
          buffer.map((b) =>
            React.createElement(
              'article',
              { key: b.id, style: { padding: '12px 14px', marginBottom: 8, borderRadius: 10, background: C.layer1, border: `1px solid ${C.border1}` } },
              React.createElement('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.75, color: C.text1 } }, b.statement),
            ),
          ),
          pending.map((c) =>
            React.createElement(
              'article',
              { key: c.conflict_id, style: { padding: '12px 14px', marginBottom: 8, borderRadius: 10, background: C.layer1, border: `1px solid ${C.err}` } },
              React.createElement('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.75, color: C.text1 } }, c.question),
              React.createElement('p', { style: { margin: '6px 0 0', fontSize: 11, color: C.err } }, '冲突待确认'),
            ),
          ),
        )
      : null,

    // 决策日志
    React.createElement(
      Section,
      { title: '决策日志', sub: '记忆操作记录' },
      log.length === 0
        ? React.createElement(Empty, { text: '（无记录）' })
        : React.createElement(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflow: 'auto' } },
            log.slice(-50).reverse().map((l, i) =>
              React.createElement(
                'div',
                { key: i, style: { display: 'flex', gap: 8, fontSize: 12, color: C.text2, borderBottom: `1px dashed ${C.border1}`, padding: '2px 0' } },
                React.createElement('span', { style: { flex: 'none', opacity: 0.7 } }, dayLabel(l.ts)),
                React.createElement('span', null, l.event),
              ),
            ),
          ),
    ),

    error
      ? React.createElement('p', { style: { marginTop: 12, fontSize: 12, color: C.err } }, error)
      : null,
  )
}

export function apply(ctx: any): void {
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
