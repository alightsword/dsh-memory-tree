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
 */

declare const React: any

export const inject = ['slots']

const PANEL_STYLE =
  '.mt-panel{display:flex;flex-direction:column;gap:10px;padding:4px 0;font-size:13px;color:var(--dsw-alias-label-primary)}' +
  '.mt-panel .row{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}' +
  '.mt-panel .label{color:var(--dsw-alias-label-secondary)}'

type SettingsCardData = {
  persona: { complete: boolean; mode: string }
  log: Array<{ ts: number; event: string; detail?: unknown }>
  memory: {
    active_rules: number
    active_facts: number
    superseded: number
    buffer_count: number
    pending_conflicts: number
  }
  config: {
    forgetting_tier: string
    p1_question_enabled: boolean
    p1_question_copy: string
    logging_enabled: boolean
    recall_top_k: number
  }
}

function Panel(props: { data?: SettingsCardData }) {
  const data = props.data
  if (!data) {
    return React.createElement(
      'div',
      { className: 'mt-panel' },
      React.createElement('div', { className: 'row' }, '暂无记忆数据'),
    )
  }
  const rows = [
    ['complete 模式', data.persona.complete ? '是' : '否'],
    ['注入通道', data.persona.mode],
    ['active rules', String(data.memory.active_rules)],
    ['active facts', String(data.memory.active_facts)],
    ['pending conflicts', String(data.memory.pending_conflicts)],
    ['forgetting_tier', data.config.forgetting_tier],
    ['recall_top_k', String(data.config.recall_top_k)],
  ]
  return React.createElement(
    'div',
    { className: 'mt-panel' },
    rows.map(([label, value]) =>
      React.createElement(
        'div',
        { className: 'row', key: label },
        React.createElement('span', { className: 'label' }, label),
        React.createElement('span', null, value),
      ),
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
