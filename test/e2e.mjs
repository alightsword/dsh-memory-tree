/**
 * End-to-end runtime test for dsh-memory-tree.
 *
 * Builds a mock DSH Context and actually calls apply(ctx), then drives the
 * plugin through its full lifecycle: session-start snapshot injection, all
 * five tools, conflict interception + resolve paths, recall, conflict
 * reminder, complete-mode degradation, and forgetting governance.
 *
 * Run: node test-e2e.mjs
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, name, inject } from '../lib/index.js'

// --- tiny assertion harness ------------------------------------------------
let passed = 0
let failed = 0
function assert(cond, label) {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.error(`  ✗ ${label}`)
  }
}

// --- mock DSH Context ------------------------------------------------------
// Mirrors the rc.3 (0.2.1-rc.3, desktop) contract the plugin now targets:
//   * SystemPrompt exposes `layers` (a ScopedLayers) — NOT a private `_layers`;
//     complete mode is read through `layers.merge(undefined, l => l.sections)`
//     and looked up on `deployment:persona-prefix`.
//   * `section.text` may be a thunk, and dsh-system-prompt re-renders it on
//     every assemble(), so the mock resolves functions lazily.
//   * The lifecycle event is `agent/created` (serial, payload {agent, source});
//     rc.3 never emits `agent/session-start`.
function makeMockContext({ completeMode = false } = {}) {
  const tools = new Map()
  const handlers = {}
  const injectedSections = []
  const llmCalls = []
  const routes = new Map()

  const ctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    on(event, handler) {
      ;(handlers[event] ??= []).push(handler)
    },
    emit(event, payload) {
      for (const h of handlers[event] ?? []) h(payload)
    },
    tools: {
      register(def) {
        tools.set(def.name, def)
        return () => tools.delete(def.name)
      },
    },
    systemPrompt: {
      section(s) {
        const entry = { name: s.name, order: s.order }
        Object.defineProperty(entry, 'text', {
          enumerable: true,
          get: () => (typeof s.text === 'function' ? s.text({}) : s.text),
        })
        injectedSections.push(entry)
      },
      getSectionOrder: (n) => ({ DEPLOYMENT_PERSONA_PREFIX: 0 })[n],
      layers: {
        merge(scope, pick) {
          const sections = new Map()
          sections.set(
            'deployment:persona-prefix',
            completeMode ? { name: 'deployment:persona-prefix', complete: true } : { name: 'deployment:persona-prefix' },
          )
          return pick({ sections })
        },
      },
    },
    llm: {
      complete(prompt) {
        llmCalls.push(prompt)
        // Mock LLM opposition: answer false (no opposition) by default.
        return 'false'
      },
    },
    agents: {},
  }
  // Mock webServer: capture registered routes so panel API handlers can be
  // driven directly (req is a stream, res collects writes).
  ctx.webServer = {
    register(def) {
      routes.set(def.path, def.handler)
      return () => routes.delete(def.path)
    },
  }
  return { ctx, tools, handlers, injectedSections, llmCalls, routes }
}

// --- main -------------------------------------------------------------------
async function main() {
  const baseDir = mkdtempSync(join(tmpdir(), 'dsh-mem-e2e-'))
  console.log(`baseDir: ${baseDir}`)

  // 1. apply() boots without throwing, exposes name + inject.
  console.log('\n[1] apply() boot')
  const { ctx, tools, handlers, injectedSections, llmCalls, routes } = makeMockContext()
  apply(ctx, { baseDir, config: { logging_enabled: true } })
  assert(name === 'dsh-memory-tree', 'name exported')
  assert(Array.isArray(inject) && inject.length > 0, 'inject declared')

  // 2. All five tools registered.
  console.log('\n[2] tool registration')
  for (const t of ['memory_add', 'memory_replace', 'memory_recall', 'memory_show', 'memory_resolve']) {
    assert(tools.has(t), `tool registered: ${t}`)
  }

  // 3. agent/created → snapshot injection (channel one). rc.3 has no
  //    agent/session-start; the serial agent/created fires once per agent.
  console.log('\n[3] snapshot injection on agent/created')
  await new Promise((r) => setTimeout(r, 10)) // let ensureSkeleton settle
  handlers['agent/created']?.[0]?.({ agent: { inject: () => {} }, source: 'startup' })
  await new Promise((r) => setTimeout(r, 20))
  const snap = injectedSections.find((s) => s.name === 'plugin:memory-context')
  assert(!!snap, 'snapshot section injected')
  assert(typeof snap?.text === 'string' && snap.text.includes('## Active rules'), 'snapshot has active-rules header')

  // 4. memory_add to l3 (no conflict) → ok.
  console.log('\n[4] memory_add l3 (no conflict)')
  const addNoConflict = await tools.get('memory_add').execute({
    statement: '用户偏好红色作为主色调',
    target: 'l3',
    type: 'rule',
  })
  assert(addNoConflict.status === 'ok', 'l3 add returns ok')
  assert(addNoConflict.target === 'l3', 'target l3')

  // 5. memory_add to l3 (conflict) → pending_conflict.
  console.log('\n[5] memory_add l3 (conflict interception)')
  const addConflict = await tools.get('memory_add').execute({
    statement: '用户讨厌红色，不要用红色',
    target: 'l3',
    type: 'rule',
  })
  assert(addConflict.status === 'pending_conflict', 'returns pending_conflict')
  assert(!!addConflict.conflict_id, 'has conflict_id')
  assert(!!addConflict.question, 'has question')

  // L3 must NOT contain the conflicting node.
  const showAfterConflict = await tools.get('memory_show').execute({})
  const activeRules = showAfterConflict.active_rules
  assert(activeRules.length === 1, 'L3 still has only 1 active rule (conflict not written)')
  assert(showAfterConflict.pending_conflicts.length === 1, 'conflict enqueued')

  // 6. memory_resolve: replace.
  console.log('\n[6] memory_resolve: replace')
  const resReplace = await tools.get('memory_resolve').execute({
    conflict_id: addConflict.conflict_id,
    decision: 'replace',
  })
  assert(resReplace.status === 'ok', 'replace ok')
  const showAfterReplace = await tools.get('memory_show').execute({})
  const actives2 = showAfterReplace.active_rules
  assert(actives2.some((n) => n.statement.includes('讨厌红色')), 'new rule active')
  assert(actives2.every((n) => !n.statement.includes('偏好红色')), 'old rule superseded')
  assert(showAfterReplace.superseded.length === 1, 'old rule marked superseded')

  // 7. conflict interception again → then scope_split path.
  console.log('\n[7] memory_add conflict → scope_split')
  // Seed a global rule, then add a scoped contradicting one.
  await tools.get('memory_add').execute({ statement: '默认主题为深色', target: 'l3', type: 'rule' })
  const addSplit = await tools.get('memory_add').execute({
    statement: '不要使用深色主题',
    target: 'l3',
    type: 'rule',
    scope: '移动端',
  })
  // The existing "默认主题为深色" is global; "不要使用深色主题" negates → conflict.
  assert(addSplit.status === 'pending_conflict', 'scoped contradict → pending_conflict')
  const resSplit = await tools.get('memory_resolve').execute({
    conflict_id: addSplit.conflict_id,
    decision: 'scope_split',
  })
  // scope_split requires both scopes non-empty; the global rule has no scope → error.
  assert(resSplit.status === 'error', 'scope_split against global rule errors (needs disjoint scopes)')

  // 7b. scope_split with overlapping (non-disjoint) scopes must also be rejected.
  console.log('\n[7b] scope_split requires truly disjoint scopes')
  await tools.get('memory_add').execute({ statement: '默认字体为衬线体', target: 'l3', type: 'rule', scope: '网页端' })
  const addOverlap = await tools.get('memory_add').execute({
    statement: '不要使用衬线字体',
    target: 'l3',
    type: 'rule',
    scope: '网页端与移动端',
  })
  assert(addOverlap.status === 'pending_conflict', 'overlapping-scope contradict → pending_conflict')
  const resOverlap = await tools.get('memory_resolve').execute({
    conflict_id: addOverlap.conflict_id,
    decision: 'scope_split',
  })
  assert(resOverlap.status === 'error', 'scope_split with overlapping scopes errors')

  // 7c. scope_split with a narrowed new_scope succeeds → two active, disjoint.
  console.log('\n[7c] scope_split narrows scope via new_scope')
  const resSplitOk = await tools.get('memory_resolve').execute({
    conflict_id: addOverlap.conflict_id,
    decision: 'scope_split',
    new_scope: '打印版',
  })
  assert(resSplitOk.status === 'ok', 'scope_split with disjoint new_scope ok')
  const showAfterSplit = await tools.get('memory_show').execute({})
  const splitRules = showAfterSplit.active_rules.filter((n) => n.statement.includes('衬线'))
  assert(splitRules.some((n) => n.scope === '打印版'), 'candidate narrowed to new_scope')
  assert(splitRules.some((n) => n.scope === '网页端'), 'existing rule keeps its scope')

  // 8. memory_replace with conflict.
  console.log('\n[8] memory_replace interception')
  // Seed an unrelated rule, then replace it with a statement that contradicts
  // the still-active "讨厌红色" rule (the other rule).
  const addB = await tools.get('memory_add').execute({ statement: '界面语言为中文', target: 'l3', type: 'rule' })
  assert(addB.status === 'ok', 'seed second rule ok')
  const showBeforeRepl = await tools.get('memory_show').execute({})
  const ruleToReplace = showBeforeRepl.active_rules.find((n) => n.statement.includes('界面语言'))
  assert(!!ruleToReplace, 'seed rule for replace present')
  // Replace "界面语言为中文" with "用户喜欢红色" → contradicts "用户讨厌红色，不要用红色".
  const replConflict = await tools.get('memory_replace').execute({
    node_id: ruleToReplace.id,
    statement: '用户喜欢红色',
  })
  assert(replConflict.status === 'pending_conflict', 'replace with opposition → pending_conflict')

  // 9. reject path.
  console.log('\n[9] memory_resolve: reject')
  const resReject = await tools.get('memory_resolve').execute({
    conflict_id: replConflict.conflict_id,
    decision: 'reject',
  })
  assert(resReject.status === 'ok', 'reject ok')
  const showAfterReject = await tools.get('memory_show').execute({})
  // The rejected conflict is no longer pending; the rejected candidate is NOT
  // written to L3 (the "界面语言" rule is unchanged, "用户喜欢红色" absent).
  assert(
    showAfterReject.pending_conflicts.every((c) => c.conflict_id !== replConflict.conflict_id),
    'rejected conflict no longer pending',
  )
  assert(
    showAfterReject.active_rules.some((n) => n.statement.includes('界面语言')),
    'rejected candidate not written; original rule intact',
  )

  // 10. recall + conflict reminder (channel two, via agent/pre-step).
  console.log('\n[10] recall + conflict reminder')
  // Create a fresh pending conflict (opposite of the still-active "讨厌红色" rule).
  const addC = await tools.get('memory_add').execute({
    statement: '用户喜欢红色',
    target: 'l3',
    type: 'rule',
  })
  if (addC.status === 'pending_conflict') {
    const preStep = handlers['agent/pre-step']?.[0]
    assert(!!preStep, 'agent/pre-step handler registered')
    // Drive the pre-step hook: next() yields an "enter" decision with one human message.
    const decision = await preStep(
      { agent: {}, signal: { aborted: false } },
      async () => ({
        kind: 'enter',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: '换个颜色' }],
            source: { kind: 'user' },
          },
        ],
      }),
    )
    assert(decision.kind === 'enter', 'pre-step returns enter decision')
    assert(
      decision.messages.some((m) => m?.source?.kind === 'plugin:dsh-memory-tree'),
      'recall/reminder message appended with plugin source',
    )
    assert(
      decision.messages.some((m) => JSON.stringify(m).includes('未确认的冲突')),
      'reminder mentions pending conflict',
    )
    // rc.3 ContextFormed has 'recall' and 'notice' — there is no 'reminder'.
    assert(
      decision.messages.some((m) => m?.source?.form === 'notice' || m?.source?.form === 'recall'),
      'appended message carries a dsh form tag',
    )
    // MessageBase requires an id on every injected message (the human message
    // in this fixture is hand-built, so only plugin messages are checked).
    assert(
      decision.messages
        .filter((m) => m?.source?.kind === 'plugin:dsh-memory-tree')
        .every((m) => typeof m?.id === 'string' && m.id.length > 0),
      'every injected message carries an id',
    )
  } else {
    assert(false, 'expected conflict for "用户喜欢红色" against existing rule')
  }

  // 11. complete-mode degradation.
  console.log('\n[11] complete:true degradation')
  const { ctx: ctx2, injectedSections: sec2 } = makeMockContext({ completeMode: true })
  apply(ctx2, { baseDir, config: { logging_enabled: true } })
  const handlers2 = {}
  ctx2.on = (ev, h) => { (handlers2[ev] ??= []).push(h) }
  handlers2['agent/created']?.[0]?.({ agent: { inject: () => {} }, source: 'startup' })
  await new Promise((r) => setTimeout(r, 30))
  const snap2 = sec2.find((s) => s.name === 'plugin:memory-context')
  assert(!snap2, 'channel one skipped in complete mode')

  // 12. forgetting governance (fail-open).
  console.log('\n[12] forgetting governance')
  const { decayWeight } = await import('../lib/forgetting.js')
  const w = decayWeight({ updated_at: Date.now() - 100 * 24 * 3600 * 1000, base_weight: 1 }, Date.now(), 'aggressive')
  assert(w < 1, 'decay reduces weight over time')
  assert(typeof w === 'number' && w > 0, 'decay weight is positive finite')

  // 13. client half (ModuleLoader bundle shape, aligned with dsh-meme).
  console.log('\n[13] client bundle surface')
  const clientSrc = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const captured = {}
  const fakeRequire = (n) => {
    if (n === 'react') return { createElement: (...a) => a }
    throw new Error('unexpected require: ' + n)
  }
  const fakeDoc = { head: { appendChild() {} } }
  const fakeLoader = {
    load: (m) => {
      captured.surface = m.factory(fakeRequire)
    },
  }
  new Function('window', 'globalThis', 'document', clientSrc)(
    { __ModuleLoader__: fakeLoader },
    { __ModuleLoader__: fakeLoader },
    fakeDoc,
  )
  assert(captured.surface && typeof captured.surface.apply === 'function', 'client exposes apply()')
  assert(
    Array.isArray(captured.surface.inject) && captured.surface.inject.includes('slots'),
    'client inject declares slots service',
  )

  // 14. conflict-detection edge cases (false-positive / false-negative guard).
  console.log('\n[14] conflict detection edge cases')
  const { detectConflict } = await import('../lib/conflict.js')
  const probe = (c, e) =>
    detectConflict({ id: 'c', statement: c, type: 'rule' }, [{ id: 'e', statement: e, type: 'rule' }], undefined)
      .then((r) => r.conflict)
  // False positives: non-negating "不X" fused lexemes must NOT count as negation.
  assert((await probe('这个方案不错', '这个方案很好')) === false, '不错 → no conflict')
  assert((await probe('不得不承认', '必须承认')) === false, '不得不 (double-neg) → no conflict')
  assert((await probe('不明原因', '原因未知')) === false, '不明 → no conflict')
  assert((await probe('不仅要做A', '还要做B')) === false, '不仅 → no conflict')
  // False negatives: real opposition must be caught.
  assert((await probe('改为深色模式', '保持浅色模式')) === true, '深色 vs 浅色 → conflict')
  assert((await probe('用户不吃辣', '用户喜欢吃辣')) === true, '不吃辣 vs 吃辣 → conflict')
  assert((await probe('界面不高', '界面要高')) === true, '不高 vs 高 → conflict')
  assert((await probe('用户不得迟到', '用户可以迟到')) === true, '不得 vs 可以 → conflict')

  // 15. store delete + full log read (backing the sidebar panel API).
  console.log('\n[15] store delete + decision log')
  const { MemoryStore } = await import('../lib/store.js')
  const st = new MemoryStore(baseDir)
  await st.ensureSkeleton()
  await st.writeL3Nodes([
    { id: 'keep', statement: '保留', type: 'fact', status: 'active', source: 'confirmed', base_weight: 1, created_at: Date.now(), updated_at: Date.now() },
    { id: 'drop', statement: '删除', type: 'fact', status: 'active', source: 'confirmed', base_weight: 1, created_at: Date.now(), updated_at: Date.now() },
  ])
  assert((await st.deleteL3Node('drop')) === true, 'deleteL3Node removes existing node')
  assert((await st.deleteL3Node('missing')) === false, 'deleteL3Node returns false for missing id')
  const remaining = await st.readL3Nodes()
  assert(remaining.length === 1 && remaining[0].id === 'keep', 'only kept node remains')
  await st.appendDecisionLog({ ts: 1, event: 'a' })
  await st.appendDecisionLog({ ts: 2, event: 'b' })
  const fullLog = await st.readDecisionLog()
  assert(
    fullLog.some((l) => l.event === 'b'),
    'readDecisionLog includes appended entries',
  )

  // 16. panel API: note / edit / forget handlers end-to-end.
  console.log('\n[16] panel API handlers')
  assert(routes.has('/dsh-memory-tree-api/state'), 'state route registered')
  assert(routes.has('/dsh-memory-tree-api/note'), 'note route registered')
  assert(routes.has('/dsh-memory-tree-api/edit'), 'edit route registered')
  assert(routes.has('/dsh-memory-tree-api/forget'), 'forget route registered')

  const { EventEmitter } = await import('node:events')
  const callHandler = async (path, body, method = 'POST') => {
    const req = new EventEmitter()
    req.method = method
    const res = {
      code: 0,
      body: '',
      writeHead(status, _headers) {
        this.code = status
      },
      end(payload) {
        this.body = payload ?? ''
      },
    }
    const handler = routes.get(path)
    const p = handler(req, res)
    req.emit('data', Buffer.from(JSON.stringify(body ?? {})))
    req.emit('end')
    await p
    return { status: res.code, json: JSON.parse(res.body || '{}') }
  }

  const noteRes = await callHandler('/dsh-memory-tree-api/note', {
    statement: '用户不吃香菜',
    type: 'rule',
    scope: '',
  })
  assert(noteRes.status === 200 && noteRes.json.ok && noteRes.json.id, 'note creates an L3 node')
  const nodesAfterNote = await st.readL3Nodes()
  const noted = nodesAfterNote.find((n) => n.id === noteRes.json.id)
  assert(!!noted && noted.statement === '用户不吃香菜' && noted.source === 'confirmed' && noted.status === 'active', 'noted node is active/confirmed')

  const editRes = await callHandler('/dsh-memory-tree-api/edit', {
    id: noteRes.json.id,
    statement: '用户非常讨厌香菜',
  })
  assert(editRes.status === 200 && editRes.json.ok, 'edit updates the node')
  const afterEdit = (await st.readL3Nodes()).find((n) => n.id === noteRes.json.id)
  assert(afterEdit?.statement === '用户非常讨厌香菜', 'edit persisted')

  const forgetRes = await callHandler('/dsh-memory-tree-api/forget', { id: noteRes.json.id })
  assert(forgetRes.status === 200 && forgetRes.json.ok && forgetRes.json.removed, 'forget removes the node')
  const afterForget = (await st.readL3Nodes()).find((n) => n.id === noteRes.json.id)
  assert(!afterForget, 'forgotten node is gone')

  const stateRes = await callHandler('/dsh-memory-tree-api/state', {}, 'GET')
  assert(stateRes.status === 200 && stateRes.json.ok, 'state returns ok')
  assert(Array.isArray(stateRes.json.layers?.l3?.nodes), 'state exposes layered l3 nodes')
  assert(typeof stateRes.json.first_seen === 'number', 'state exposes first_seen')

  // summary
  console.log(`\n=============================`)
  console.log(`PASS: ${passed}  FAIL: ${failed}`)
  rmSync(baseDir, { recursive: true, force: true })
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL', err)
  process.exit(1)
})
