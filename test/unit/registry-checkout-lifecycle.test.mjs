import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount } from './_hook-harness.mjs'
import { bindContext, controllerFor, disposeAll, resyncAll, useCheckouts, useGitView, selectedRepo, selectRepo } from '../../lib/hookkit.mjs'

const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const IDLE_MS = 60_000
let nextId = 0
const rootFor = (sessionId) => `/repo/${sessionId}`
const selector = (name) => `.agents/worktrees/${name}`
function rowsFor(sessionId, names = ['a', 'b']) {
  const root = rootFor(sessionId)
  return [
    { path: '', root, name: sessionId, kind: 'workspace', role: 'main' },
    ...names.map((name) => ({ path: selector(name), root: `${root}/${selector(name)}`, name, kind: 'nested', role: 'linked' })),
    { path: 'site', root: `${root}/site`, name: 'site', kind: 'nested', role: 'repo' },
  ]
}
const transport = (value) => ({ ok: true, value })

function setup(t, { snapshotError } = {}) {
  disposeAll()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const prefix = `registry-checkouts-${++nextId}`
  let clock = 0
  const snapshots = [], queries = [], mounts = []
  bindContext({ get: () => ({ rpc: {
    call: async (_, endpoint, { args: { request } }, signal) => {
      if (endpoint === 'dbGitPanel/snapshot') {
        snapshots.push({ request, signal })
        if (snapshotError !== undefined) return transport({ ok: false, error: { code: snapshotError, cwd: rootFor(request.sessionId) } })
        return transport({ ok: true, value: {
          root: request.repo ? `${rootFor(request.sessionId)}/${request.repo}` : rootFor(request.sessionId),
          checkedAt: ++clock, stateFingerprint: 'stable', refreshIntervalMs: 300_000,
          changes: [], detectCheckouts: true, repoLimit: 50, followSessionCheckout: true,
        } })
      }
      assert.equal(endpoint, 'dbGitPanel/query')
      assert.equal(request.query.kind, 'repo-list')
      assert.equal(request.repo, undefined, 'the shared list belongs to the session, not the selected checkout')
      let resolve
      const pending = new Promise((yes) => { resolve = yes })
      queries.push({ request, signal, resolve })
      return pending
    },
  } }) })
  t.after(() => {
    for (const h of mounts) h.unmount()
    disposeAll()
    t.mock.timers.reset()
  })
  return {
    snapshots, queries,
    sid: (name) => `${prefix}-${name}`,
    mount(hook) { const h = mount(hook, { autoRender: true }); mounts.push(h); return h },
    async answer(index, names = ['a', 'b'], repos) {
      const q = queries[index]
      q.resolve(transport({ ok: true, value: { kind: 'repo-list', cwd: rootFor(q.request.sessionId), repos: repos ?? rowsFor(q.request.sessionId, names), worktrees: 'ok' } }))
      await drain()
    },
    async advance(ms) { t.mock.timers.tick(ms); await drain() },
  }
}

function surface(sessionId, active, directory, discover) {
  const view = useGitView(sessionId)
  const checkouts = useCheckouts(sessionId, active, directory, discover)
  return { view, ...checkouts }
}

test('real registry hooks share one discovery and do not rescan on projection rerenders', async (t) => {
  const f = setup(t), sid = f.sid('shared')
  let directory = `${rootFor(sid)}/${selector('a')}`
  const pill = f.mount(() => surface(sid, true, directory, false))
  const panel = f.mount(() => surface(sid, true, directory, true))
  const sidebar = f.mount(() => surface(sid, true, directory, true))
  await drain()
  assert.equal(f.snapshots.length, 1, 'all views share the initial GitController sample')
  assert.equal(f.queries.length, 1, 'all checkout hooks join the same initial list read')
  await f.answer(0)
  assert.equal(pill.value.list, panel.value.list)
  assert.equal(panel.value.list, sidebar.value.list)
  assert.equal(pill.value.ready, true)
  assert.equal(selectedRepo(sid), selector('a'))
  assert.equal(controllerFor(sid).getRepo(), selector('a'))
  directory = `${rootFor(sid)}/${selector('b')}`
  pill.rerender(); panel.rerender(); sidebar.rerender()
  await drain()
  assert.equal(selectedRepo(sid), selector('b'))
  assert.equal(controllerFor(sid).getRepo(), selector('b'))
  for (let i = 0; i < 4; i++) { pill.rerender(); panel.rerender(); sidebar.rerender() }
  await controllerFor(sid).refresh()
  await drain()
  assert.equal(f.queries.length, 1, 'the observer is retained across directory and snapshot changes')
  directory = rootFor(sid)
  pill.rerender(); panel.rerender(); sidebar.rerender()
  await drain()
  assert.equal(controllerFor(sid).getRepo(), '')
  assert.equal(f.queries.length, 1)
})

test('a hidden retained copy cannot overwrite the visible hook projection', async (t) => {
  const f = setup(t), sid = f.sid('hidden')
  let hiddenDirectory = `${rootFor(sid)}/${selector('b')}`
  const pill = f.mount(() => surface(sid, true, `${rootFor(sid)}/${selector('a')}`, false))
  const hidden = f.mount(() => surface(sid, false, hiddenDirectory, true))
  await drain()
  await f.answer(0)
  hiddenDirectory = rootFor(sid); hidden.rerender()
  await drain()
  assert.equal(selectedRepo(sid), selector('a'))
  assert.equal(pill.value.list, hidden.value.list, 'the hidden copy still subscribes to the shared result')
  assert.equal(f.queries.length, 1)
})

test('resync invalidates the live checkout owner and old session replies cannot reach the replacement', async (t) => {
  const f = setup(t), old = f.sid('old'), next = f.sid('next')
  let sid = old
  const h = f.mount(() => surface(sid, true, `${rootFor(sid)}/${selector('a')}`, false))
  await drain()
  assert.equal(f.queries.length, 1)
  const oldRefetch = h.value.refetch
  sid = next; h.rerender(); await drain()
  assert.equal(f.queries.length, 2)
  assert.equal(f.queries[0].signal.aborted, true, 'releasing the old observer cancels its scan')
  resyncAll(); await drain()
  assert.equal(f.queries.length, 3, 'only the currently observed session performs the replacement discovery')
  assert.equal(f.queries[2].request.sessionId, next)
  assert.equal(f.queries[1].signal.aborted, true, 'resync supersedes the pending live read')
  assert.equal(h.value.ready, false)
  await f.answer(0)
  await f.answer(1)
  assert.equal(h.value.list, null, 'neither released nor superseded results publish')
  assert.equal(selectedRepo(old), '')
  assert.equal(selectedRepo(next), '')
  await f.answer(2)
  assert.equal(h.value.ready, true)
  assert.equal(h.value.list.cwd, rootFor(next))
  assert.equal(selectedRepo(next), selector('a'))
  oldRefetch(); await drain()
  assert.equal(f.queries.length, 3, 'a saved old-session refetch callback cannot invalidate the current owner')
})

test('a registry resync keeps old rows visible but non-authoritative until the new list succeeds', async (t) => {
  const f = setup(t), sid = f.sid('resync')
  const h = f.mount(() => surface(sid, true, `${rootFor(sid)}/${selector('a')}`, false))
  await drain(); await f.answer(0)
  const oldList = h.value.list
  resyncAll(); await drain()
  assert.equal(f.queries.length, 2)
  assert.equal(h.value.list, oldList)
  assert.equal(h.value.ready, false)
  selectRepo(sid, 'site')
  f.queries[1].resolve(transport({ ok: false, error: { code: 'transport' } }))
  await drain()
  assert.equal(h.value.list, oldList)
  assert.equal(h.value.ready, false)
  assert.equal(selectedRepo(sid), 'site', 'a failed reconnect read cannot repair or overwrite a new manual pick')
  h.value.refetch(); await drain()
  await f.answer(2)
  assert.equal(h.value.ready, true)
  assert.equal(selectedRepo(sid), 'site')
  assert.equal(controllerFor(sid).getRepo(), 'site')
})

test('non-Git and unavailable-Git panels can rediscover external rows after resync without a ready snapshot', async (t) => {
  for (const code of ['not-a-git-repo', 'git-unavailable']) {
    await t.test(code, async (t) => {
      const f = setup(t, { snapshotError: code }), sid = f.sid('non-git')
      const external = { path: '../external', root: `/external/${sid}`, name: 'external', kind: 'external', role: 'repo' }
      const h = f.mount(() => surface(sid, true, external.root, true))
      await drain()
      assert.equal(h.value.view.state, 'error')
      assert.equal(h.value.view.error.code, code)
      assert.equal(controllerFor(sid).getQuerySignal().ready, false)
      assert.equal(f.queries.length, 1, 'panel discovery does not require a successful Git snapshot')
      await f.answer(0, [], [external])
      assert.equal(h.value.ready, true)
      assert.deepEqual(h.value.list.repos, [external])
      const oldList = h.value.list
      resyncAll(); await drain()
      assert.equal(f.queries.length, 2, 'resync still invalidates and reloads a visible non-Git panel')
      assert.equal(h.value.list, oldList, 'old external rows stay visible during rediscovery')
      assert.equal(h.value.ready, false)
      await f.answer(1, [], [external])
      assert.equal(h.value.ready, true)
      assert.deepEqual(h.value.list.repos, [external])
      h.value.refetch(); await drain()
      assert.equal(f.queries.length, 3, 'an explicit selector refetch cannot become a permanent no-op')
      const added = { ...external, path: '../external-added', root: `${external.root}-added`, name: 'external-added' }
      await f.answer(2, [], [external, added])
      assert.equal(h.value.ready, true)
      assert.deepEqual(h.value.list.repos, [external, added])
      assert.equal(h.value.view.state, 'error')
      assert.equal(h.value.view.error.code, code, 'discovery does not forge a ready Git snapshot')
      assert.equal(controllerFor(sid).getQuerySignal().ready, false)
      assert.equal(selectedRepo(sid), '', 'foreign rows are never automatically followed')
      assert.equal(controllerFor(sid).getRepo(), '')
    })
  }
})

test('last checkout hook release disposes the idle owner and a late reply cannot affect its replacement', async (t) => {
  const f = setup(t), sid = f.sid('idle')
  const h = f.mount(() => surface(sid, true, `${rootFor(sid)}/${selector('a')}`, false))
  await drain()
  const old = controllerFor(sid)
  h.unmount()
  assert.equal(f.queries[0].signal.aborted, true)
  await f.advance(IDLE_MS - 1)
  assert.equal(controllerFor(sid), old)
  await f.advance(1)
  const replacement = controllerFor(sid)
  assert.notEqual(replacement, old)
  const current = f.mount(() => surface(sid, true, `${rootFor(sid)}/${selector('b')}`, false))
  await drain()
  assert.equal(f.queries.length, 2)
  await f.answer(1)
  const newList = current.value.list
  await f.answer(0, ['a'])
  assert.equal(current.value.list, newList, 'disposed checkout cannot publish over its successor')
  assert.equal(selectedRepo(sid), selector('b'))
  assert.equal(controllerFor(sid), replacement)
  assert.equal(controllerFor(sid).getRepo(), selector('b'))
})

test('teardown clears old idle callbacks and stale checkout-hook cleanup cannot release a replacement', async (t) => {
  const f = setup(t), sid = f.sid('stale'), idleSid = f.sid('old-idle')
  // Discovery alone retains one reference; a second business hook must not mask an incorrect decrement.
  const stale = f.mount(() => useCheckouts(sid, true, rootFor(sid), true))
  const idle = f.mount(() => useCheckouts(idleSid, true, rootFor(idleSid), true))
  await drain()
  assert.equal(f.queries.length, 2)
  idle.unmount()
  disposeAll()
  const current = f.mount(() => useCheckouts(sid, true, rootFor(sid), true))
  await drain()
  const replacement = controllerFor(sid)
  assert.equal(f.queries.length, 3)
  stale.unmount()
  await f.advance(IDLE_MS * 2)
  assert.equal(controllerFor(sid), replacement, 'stale cleanup must not decrement the new owner reference')
  await f.answer(0)
  await f.answer(1)
  assert.equal(current.value.list, null, 'old teardown replies remain ignored')
  await f.answer(2)
  assert.equal(current.value.list.cwd, rootFor(sid))
  assert.equal(current.value.ready, true)
  current.value.refetch(); await drain()
  assert.equal(f.queries.length, 4, 'the replacement checkout remains live beyond the idle deadline')
  await f.answer(3)
})
