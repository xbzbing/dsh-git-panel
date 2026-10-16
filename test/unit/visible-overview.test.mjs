import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount } from './_hook-harness.mjs'
import { useBranchTree, useHistory } from '../../lib/hookkit.mjs'

const F = { ref: null, search: '', author: '', since: '' }
function deferred() {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
function refResult(kind, branch = 'main') {
  return { ok: true, value: kind === 'branches'
    ? { kind, current: branch, defaultBranch: null, local: [], remote: [] }
    : kind === 'tags' ? { kind, tags: [] } : { kind, authors: ['Tester'] } }
}

test('hidden overview coalesces ticks and resumes one current ref/history batch', async () => {
  const calls = []
  const remote = { query: async ({ query: q }) => {
    calls.push(q)
    return q.kind === 'history' ? { ok: true, value: { kind: 'history', commits: [{ hash: q.ref ?? 'main' }], total: 1 } } : refResult(q.kind)
  } }
  const props = { visible: false, key: 0, filter: F }
  const h = mount(() => ({
    tree: useBranchTree(remote, 's', props.key, props.visible),
    history: useHistory(remote, 's', props.filter, props.key, () => {}, props.visible),
  }))
  await h.settle()
  props.key = 1; h.rerender()
  props.key = 2; props.filter = { ...F, ref: 'feature' }; h.rerender()
  await h.settle()
  assert.equal(calls.length, 0)
  props.visible = true; h.rerender(); await h.settle()
  assert.deepEqual(calls.map((q) => q.kind).sort(), ['authors', 'branches', 'history', 'tags'])
  assert.equal(h.value.history.commits[0].hash, 'feature')
  h.unmount()
})

test('branch completion after hide cannot start authors; restore at the same key retries the batch', async () => {
  const gate = deferred()
  const calls = []
  const remote = { query: async ({ query: q }) => {
    calls.push(q.kind)
    if (q.kind === 'branches' && calls.filter((k) => k === 'branches').length === 1) return gate.promise
    return refResult(q.kind)
  } }
  let visible = true
  const h = mount(() => useBranchTree(remote, 's', 1, visible))
  visible = false; h.rerender()
  gate.resolve(refResult('branches'))
  await h.settle()
  assert.deepEqual(calls, ['branches', 'tags'])
  visible = true; h.rerender(); await h.settle()
  assert.equal(calls.filter((k) => k === 'authors').length, 1)
  assert.equal(h.value.tree.current, 'main')
  h.unmount()
})

test('hide/restore with an unchanged request in flight reuses that request', async () => {
  const gate = deferred()
  let branches = 0
  const remote = { query: async ({ query: q }) => {
    if (q.kind === 'branches') { branches++; return gate.promise }
    return refResult(q.kind)
  } }
  let visible = true
  const h = mount(() => useBranchTree(remote, 's', 1, visible))
  visible = false; h.rerender()
  visible = true; h.rerender()
  assert.equal(branches, 1)
  gate.resolve(refResult('branches'))
  await h.settle()
  assert.deepEqual(h.value.authors, ['Tester'])
  h.unmount()
})

test('stale tree response cannot overwrite a new session or refresh generation', async () => {
  const gate = deferred()
  let sid = 'old'
  const remote = { query: async ({ sessionId, query: q }) => q.kind === 'branches' && sessionId === 'old' ? gate.promise : refResult(q.kind, sessionId) }
  const h = mount(() => useBranchTree(remote, sid, 1, true))
  sid = 'new'; h.rerender(); await h.settle()
  gate.resolve(refResult('branches', 'old'))
  await h.settle()
  assert.equal(h.value.tree.current, 'new')
  h.unmount()
})

for (const failedKind of ['tags', 'authors']) {
  test(`${failedKind} failure leaves successful branches visible and recovers on the next tick`, async (t) => {
    let key = 1, fail = true
    const remote = { query: async ({ query: q }) => q.kind === failedKind && fail
      ? { ok: false, error: { code: 'git-error' } } : refResult(q.kind) }
    const h = mount(() => useBranchTree(remote, 's', key, true))
    t.after(() => h.unmount())
    await h.settle()
    assert.equal(h.value.treeError, false)
    assert.equal(h.value.tree.current, 'main')
    assert.deepEqual(h.value.tree.tags, [])
    assert.deepEqual(h.value.authors, failedKind === 'authors' ? [] : ['Tester'])
    fail = false; key++; h.rerender(); await h.settle()
    assert.equal(h.value.treeError, false)
    assert.deepEqual(h.value.authors, ['Tester'])
  })
}

test('secondary refresh failures preserve loaded tags without hiding fresh branches or stale author options', async (t) => {
  let key = 1, fail = false
  const tags = [{ name: 'v1' }]
  const remote = { query: async ({ query: q }) => {
    if (fail && q.kind !== 'branches') return { ok: false, error: { code: 'git-error' } }
    return q.kind === 'tags' ? { ok: true, value: { kind: 'tags', tags } } : refResult(q.kind, `branch-${key}`)
  } }
  const h = mount(() => useBranchTree(remote, 's', key, true))
  t.after(() => h.unmount())
  await h.settle()
  assert.deepEqual(h.value.tree.tags, tags)
  assert.deepEqual(h.value.authors, ['Tester'])
  fail = true; key++; h.rerender(); await h.settle()
  assert.equal(h.value.treeError, false)
  assert.equal(h.value.tree.current, 'branch-2')
  assert.deepEqual(h.value.tree.tags, tags)
  assert.deepEqual(h.value.authors, [])
  fail = false; key++; h.rerender(); await h.settle()
  assert.equal(h.value.treeError, false)
  assert.deepEqual(h.value.authors, ['Tester'])
})

for (const rejected of [false, true]) {
  test(`branches ${rejected ? 'rejection' : 'failure'} still shows the retry error and manual retry recovers`, async (t) => {
    let fail = true
    const remote = { query: async ({ query: q }) => {
      if (q.kind === 'branches' && fail) {
        if (rejected) throw new Error('disconnected')
        return { ok: false, error: { code: 'git-error' } }
      }
      return refResult(q.kind)
    } }
    const h = mount(() => useBranchTree(remote, 's', 1, true))
    t.after(() => h.unmount())
    await h.settle()
    assert.equal(h.value.treeError, true)
    assert.equal(h.value.tree, null)
    fail = false; await h.value.reload(); await h.settle()
    assert.equal(h.value.treeError, false)
    assert.equal(h.value.tree.current, 'main')
    assert.deepEqual(h.value.authors, ['Tester'])
  })
}

test('hidden history blocks pagination, then resumes current filter without poll selection resets', async () => {
  const calls = []
  const props = { visible: true, filter: F, key: 0 }
  let resets = 0
  const remote = { query: async ({ query: q }) => {
    calls.push(q)
    return { ok: true, value: { kind: 'history', commits: [{ hash: q.ref ?? 'main' }], total: 5 } }
  } }
  const h = mount(() => useHistory(remote, 's', props.filter, props.key, () => { resets++ }, props.visible))
  await h.settle()
  props.visible = false; h.rerender()
  h.value.loadMore()
  props.filter = { ...F, ref: 'new' }; props.key++; h.rerender()
  await h.settle()
  assert.equal(calls.length, 1)
  props.visible = true; h.rerender(); await h.settle()
  assert.equal(calls.length, 2)
  assert.equal(h.value.commits[0].hash, 'new')
  assert.equal(resets, 1)
  props.key++; h.rerender(); await h.settle()
  assert.equal(resets, 1)
  h.unmount()
})

test('old pagination cannot clear the loading guard of a new first-page request', async () => {
  const oldMore = deferred(), newPage = deferred()
  let filter = F
  const remote = { query: async ({ query: q }) => q.ref === 'new' ? newPage.promise : q.skip > 0 ? oldMore.promise
    : { ok: true, value: { kind: 'history', commits: [{ hash: 'old' }], total: 10 } } }
  const h = mount(() => useHistory(remote, 's', filter, 1, () => {}, true))
  await h.settle()
  h.value.loadMore()
  filter = { ...F, ref: 'new' }; h.rerender()
  oldMore.resolve({ ok: true, value: { kind: 'history', commits: [{ hash: 'stale' }], total: 10 } })
  await h.settle()
  assert.equal(h.value.loading, true)
  newPage.resolve({ ok: true, value: { kind: 'history', commits: [{ hash: 'new' }], total: 1 } })
  await h.settle()
  assert.deepEqual(h.value.commits.map((c) => c.hash), ['new'])
  assert.equal(h.value.loading, false)
  h.unmount()
})
