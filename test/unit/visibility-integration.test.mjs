import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount } from './_hook-harness.mjs'
import { GitController, usePageVisibility, useBranchTree, useHistory, useChangesData, useImageDiff } from '../../lib/hookkit.mjs'

const initial = { root: '/fixture', checkedAt: 1, refreshIntervalMs: 30_000, changes: [{ path: 'a.txt' }, { path: 'img.png' }] }
const F = { ref: null, search: '', author: '', since: '' }
function deferred() {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
function documentFixture(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const listeners = new Set()
  const document = { hidden: false,
    addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor)
    else delete globalThis.document
  })
  return (hidden) => { document.hidden = hidden; for (const fn of [...listeners]) fn() }
}
function queryResult(q) {
  const value = q.kind === 'branches' ? { kind: q.kind, current: 'main', defaultBranch: null, local: [], remote: [] }
    : q.kind === 'tags' ? { kind: q.kind, tags: [] }
      : q.kind === 'authors' ? { kind: q.kind, authors: [] }
        : q.kind === 'history' ? { kind: q.kind, commits: [], total: 0 }
          : q.kind === 'stash-list' ? { kind: q.kind, entries: [] }
            : q.kind === 'image-diff' ? { kind: q.kind, path: q.path, before: null, after: null }
              : { kind: 'diff', text: q.path, newLines: 1 }
  return { ok: true, value }
}

for (const activeTab of ['overview', 'changes']) {
  test(`page restore waits for the current snapshot before one ${activeTab} catch-up batch`, async (t) => {
    const hide = documentFixture(t)
    const gate = deferred()
    const calls = []
    let snapshots = 0
    const remote = {
      snapshot: async () => { calls.push('snapshot'); return ++snapshots === 1 ? { ok: true, value: initial } : gate.promise },
      query: async ({ query }) => { calls.push(query.kind); return queryResult(query) },
    }
    const controller = new GitController(remote, 's')
    const h = mount(() => {
      const visible = usePageVisibility() && controller.isVisibilitySnapshotCurrent()
      const view = controller.getSnapshot()
      const snapshot = view.state === 'ready' ? view.snapshot : initial
      useBranchTree(remote, 's', snapshot.checkedAt, visible && activeTab === 'overview')
      useHistory(remote, 's', F, snapshot.checkedAt, () => {}, visible && activeTab === 'overview')
      return useChangesData(remote, 's', snapshot, visible && activeTab === 'changes', () => assert.fail('stash failed'))
    })
    t.after(() => { h.unmount(); controller.dispose() })
    controller.ensure(); await h.settle()
    if (activeTab === 'changes') { h.value.showDiff('a.txt', 'worktree'); await h.settle() }
    hide(true); h.rerender()
    calls.length = 0
    hide(false); h.rerender(); await h.settle()
    assert.deepEqual(calls, ['snapshot'], 'old snapshot must not trigger an early child batch')
    gate.resolve({ ok: true, value: { ...initial, checkedAt: 2 } })
    await h.settle()
    assert.deepEqual(calls.slice(1).sort(), activeTab === 'overview'
      ? ['authors', 'branches', 'history', 'tags'] : ['diff', 'stash-list'])
    h.rerender(); await h.settle()
    assert.equal(calls.length, activeTab === 'overview' ? 5 : 3)
  })
}

test('an old in-flight response after hide/show cannot release the catch-up gate', async (t) => {
  const hide = documentFixture(t)
  const old = deferred(), fresh = deferred()
  let requests = 0
  const controller = new GitController({ snapshot: () => ++requests === 1 ? old.promise : fresh.promise }, 's')
  t.after(() => controller.dispose())
  controller.ensure()
  hide(true); hide(false)
  old.resolve({ ok: true, value: initial })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.equal(requests, 2)
  assert.equal(controller.isVisibilitySnapshotCurrent(), false)
  fresh.resolve({ ok: true, value: { ...initial, checkedAt: 2 } })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  assert.equal(controller.isVisibilitySnapshotCurrent(), true)
})

test('a pending binary diff completed hidden cannot start its image-diff stage', async () => {
  const gate = deferred()
  const calls = []
  const remote = { query: async ({ query: q }) => {
    calls.push(q.kind)
    return q.kind === 'diff' ? gate.promise : queryResult(q)
  } }
  let visible = true
  const h = mount(() => {
    const data = useChangesData(remote, 's', initial, visible, () => assert.fail('stash failed'))
    const ready = data.diffData !== null && data.diffPath !== null
    const image = useImageDiff(ready ? remote : undefined, ready ? 's' : undefined,
      ready ? data.diffPath.path : undefined, ready ? data.diffPath.base : undefined, undefined, visible)
    return { ...data, image }
  })
  h.value.showDiff('img.png', 'worktree'); h.rerender()
  visible = false; h.rerender()
  gate.resolve({ ok: true, value: { kind: 'diff', text: 'Binary files a/img.png and b/img.png differ\n', newLines: 0 } })
  await h.settle()
  assert.equal(h.value.diffData.text.startsWith('Binary'), true)
  assert.equal(calls.filter((k) => k === 'image-diff').length, 0)
  visible = true; h.rerender(); await h.settle()
  assert.equal(calls.filter((k) => k === 'image-diff').length, 1)
  h.unmount()
})

test('image results retain the current image on hide/restore and reject stale paths', async () => {
  const old = deferred()
  let path = 'old.png', visible = true
  const remote = { query: async ({ query: q }) => q.path === 'old.png' ? old.promise : queryResult(q) }
  const h = mount(() => useImageDiff(remote, 's', path, 'worktree', undefined, visible))
  path = 'new.png'; h.rerender(); await h.settle()
  old.resolve(queryResult({ kind: 'image-diff', path: 'old.png' }))
  await h.settle()
  assert.equal(h.value.kind, 'ready')
  assert.equal(h.value.res.path, 'new.png')
  visible = false; h.rerender()
  assert.equal(h.value.res.path, 'new.png')
  visible = true; h.rerender()
  assert.equal(h.value.kind, 'ready', 'activation must not blank an already-loaded image')
  await h.settle()
  h.unmount()
})
