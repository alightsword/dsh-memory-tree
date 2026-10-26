/**
 * dsh-memory-tree client half — settings card.
 *
 * Loaded as a dsh.client bundle (same shape as dsh-meme). The browser
 * artifact registers a lazy factory whose id equals the package name; React
 * comes from the browser module table (no duplicate install).
 *
 * Contract (verified against dsh-meme and the host cookbook):
 *   - export `inject` array declaring the services the client needs;
 *   - access services via `ctx.get('slots')`, not `ctx.slots`;
 *   - wrap registration in `slots.inject(ownerKey, () => slots.register(...))`;
 *   - manage lifecycle with `ctx.effect(...)`;
 *   - the settings page slot is `settings.section`.
 *
 * Data flows over the host webServer: GET /dsh-memory-tree-api returns the
 * current memory state as JSON (the browser cannot read the filesystem).
 */

declare const React: any

export const inject = ['slots']

const PANEL_STYLE =
  '.mt-panel{display:flex;flex-direction:column;gap:10px;padding:4px 0;font-size:13px;color:var(--dsw-alias-label-primary)}' +
  '.mt-panel .row{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}' +
  '.mt-panel .label{color:var(--dsw-alias-label-secondary)}' +
  '.mt-panel .err{color:var(--dsw-alias-status-danger, #d33)}' +
  '.mt-panel .refresh{align-self:flex-start;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px}' +
  '.mt-panel .refresh:hover{background:var(--dsw-alias-bg-layer-2)}'

type ApiPayload = {
  ok: boolean
  error?: string
  persona: { complete: boolean; mode: string }
  log: Array<{ ts: number; event: string }>
  memory: {
    active_rules: number
    active_facts: number
    superseded: number
    buffer_count: number
    pending_conflicts: number
  }
  config: {
    forgetting_tier: string
    forgetting_factor: number
    archive_threshold: number
    p1_question_enabled: boolean
    p1_question_copy: string
    logging_enabled: boolean
    recall_top_k: number
    snapshot_budget_chars: number
    base_dir: string
  }
}

const API_PATH = '/dsh-memory-tree-api'

function Panel() {
  const [data, setData] = React.useState<ApiPayload | null>(null)
  const [error, setError] = React.useState('')
  const [tick, setTick] = React.useState(0)

  React.useEffect(() => {
    let alive = true
    fetch(API_PATH, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return
        if (j?.ok) {
          setData(j)
          setError('')
        } else {
          setError(String(j?.error ?? 'unknown error'))
        }
      })
      .catch((e) => {
        if (alive) setError(String(e?.message ?? e))
      })
    return () => {
      alive = false
    }
  }, [tick])

  const rows: Array<[string, string]> = data
    ? [
        ['complete 模式', data.persona.complete ? '是' : '否'],
        ['注入通道', data.persona.mode],
        ['active rules', String(data.memory.active_rules)],
        ['active facts', String(data.memory.active_facts)],
        ['superseded', String(data.memory.superseded)],
        ['L2 buffer', String(data.memory.buffer_count)],
        ['pending conflicts', String(data.memory.pending_conflicts)],
        ['forgetting_tier', data.config.forgetting_tier],
        ['forgetting_factor', String(data.config.forgetting_factor)],
        ['archive_threshold', String(data.config.archive_threshold)],
        ['recall_top_k', String(data.config.recall_top_k)],
        ['snapshot 预算', String(data.config.snapshot_budget_chars)],
        ['p1 提问', String(data.config.p1_question_enabled)],
        ['日志', String(data.config.logging_enabled)],
      ]
    : []

  return React.createElement(
    'div',
    { className: 'mt-panel' },
    error
      ? React.createElement('div', { className: 'err' }, '加载失败: ' + error)
      : rows.map(([label, value]) =>
          React.createElement(
            'div',
            { className: 'row', key: label },
            React.createElement('span', { className: 'label' }, label),
            React.createElement('span', null, value),
          ),
        ),
    React.createElement(
      'button',
      { className: 'refresh', onClick: () => setTick((t: number) => t + 1) },
      '刷新',
    ),
  )
}

export function apply(ctx: any): void {
  const styleEl = document.createElement('style')
  styleEl.textContent = PANEL_STYLE
  document.head.appendChild(styleEl)
  ctx.effect(() => () => styleEl.remove(), 'dsh-memory-tree: styles')

  const slots = ctx.get('slots')
  if (!slots) return

  slots.inject('settings.section', () =>
    slots.register(
      { name: 'settings.section', id: 'memory-tree', order: 90, label: '记忆树' },
      () => React.createElement(Panel),
    ),
  )
}
