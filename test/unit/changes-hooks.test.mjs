import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount } from './_hook-harness.mjs'
import { useChangesData } from '../../lib/hookkit.mjs'

const initial = { root: '/fixture', checkedAt: 1, changes: [{ path: 'a.txt' }, { path: 'b.txt' }] }
const fail = () => assert.fail('unexpected stash failure')
function deferred() {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
function diff(text) { return { ok: true, value: { kind: 'diff', text, newLines: 10 } } }
function remoteFixture(respond = (q) => q.kind === 'diff' ? diff(q.path) : { ok: true, value: { kind: 'stash-list', entries: [] } }) {
  const calls = []
  return { calls, query: async ({ query: q }) => { calls.push(q); return respond(q) } }
}

test('hidden Changes accumulates ticks without stash/diff requests and restores only current target', async () => {
  const remote = remoteFixture()
  const props = { visible: false, snapshot: initial }
  const h = mount(() => useChangesData(remote, 's', props.snapshot, props.visible, fail))
  h.value.showDiff('a.txt', 'worktree', true)
  await h.settle()
  for (let i = 2; i <= 4; i++) { props.snapshot = { ...initial, checkedAt: i }; h.rerender() }
  await h.settle()
  assert.equal(remote.calls.length, 0)
  props.visible = true; h.rerender(); await h.settle()
  assert.deepEqual(remote.calls.map((q) => q.kind).sort(), ['diff', 'stash-list'])
  assert.equal(remote.calls.find((q) => q.kind === 'diff').context, 2000)
  assert.equal(h.value.diffData.text, 'a.txt')
  assert.equal(h.value.expanded, true)
  h.unmount()
})

test('opening or toggling a diff sends exactly one request and polling keeps previous content', async () => {
  const gate = deferred()
  let diffs = 0
  const remote = remoteFixture((q) => q.kind === 'diff'
    ? (++diffs === 3 ? gate.promise : diff('loaded-' + diffs))
    : { ok: true, value: { kind: 'stash-list', entries: [] } })
  let snapshot = initial
  const h = mount(() => useChangesData(remote, 's', snapshot, true, fail))
  await h.settle()
  h.value.showDiff('a.txt', 'worktree')
  await h.settle()
  assert.equal(diffs, 1)
  h.value.showDiff('a.txt', 'worktree', true)
  await h.settle()
  assert.equal(diffs, 2)
  assert.equal(h.value.diffData.text, 'loaded-2')
  snapshot = { ...initial, checkedAt: 2 }; h.rerender()
  assert.equal(h.value.diffData.text, 'loaded-2')
  gate.resolve(diff('updated'))
  await h.settle()
  assert.equal(diffs, 3)
  assert.equal(h.value.diffData.text, 'updated')
  h.unmount()
})

for (const pending of [false, true]) {
  test(`reopening the same diff ${pending ? 'while pending' : 'after loading'} requests fresh data without a snapshot tick`, async (t) => {
    const first = deferred(), second = deferred()
    let diffs = 0
    const remote = remoteFixture((q) => q.kind === 'diff'
      ? (++diffs === 1 ? pending ? first.promise : diff('first') : second.promise)
      : { ok: true, value: { kind: 'stash-list', entries: [] } })
    const h = mount(() => useChangesData(remote, 's', initial, true, fail))
    t.after(() => h.unmount())
    h.value.showDiff('a.txt', 'worktree'); await h.settle()
    assert.equal(diffs, 1)
    assert.equal(h.value.diffData?.text ?? null, pending ? null : 'first')
    h.value.showDiff('a.txt', 'worktree'); await h.settle()
    assert.equal(diffs, 2)
    assert.equal(h.value.diffData, null)
    second.resolve(diff('fresh')); await h.settle()
    assert.equal(h.value.diffData.text, 'fresh')
    if (pending) {
      first.resolve(diff('stale')); await h.settle()
      assert.equal(h.value.diffData.text, 'fresh')
    }
    assert.equal(remote.calls.filter((q) => q.kind === 'stash-list').length, 1)
  })
}

test('old path response cannot replace a newly selected diff', async () => {
  const gate = deferred()
  const remote = remoteFixture((q) => q.kind === 'diff' ? q.path === 'a.txt' ? gate.promise : diff('new-b') : { ok: true, value: { kind: 'stash-list', entries: [] } })
  const h = mount(() => useChangesData(remote, 's', initial, true, fail))
  h.value.showDiff('a.txt', 'worktree'); h.rerender()
  h.value.showDiff('b.txt', 'staged'); h.rerender()
  await h.settle()
  gate.resolve(diff('old-a'))
  await h.settle()
  assert.equal(h.value.diffData.text, 'new-b')
  assert.equal(h.value.diffPath.base, 'staged')
  h.unmount()
})

test('path removal while hidden prunes diff without querying and ignores the old response', async () => {
  const gate = deferred()
  const remote = remoteFixture((q) => q.kind === 'diff' ? gate.promise : { ok: true, value: { kind: 'stash-list', entries: [] } })
  const props = { snapshot: initial, visible: true }
  const h = mount(() => useChangesData(remote, 's', props.snapshot, props.visible, fail))
  h.value.showDiff('a.txt', 'worktree'); h.rerender()
  props.snapshot = { ...initial, checkedAt: 2, changes: [] }; props.visible = false; h.rerender()
  const count = remote.calls.length
  gate.resolve(diff('removed'))
  await h.settle()
  assert.equal(h.value.diffPath, null)
  assert.equal(h.value.diffData, null)
  assert.equal(remote.calls.length, count)
  props.visible = true; h.rerender(); await h.settle()
  assert.equal(remote.calls.filter((q) => q.kind === 'diff').length, 1)
  h.unmount()
})

test('stash error preserves previous entries and remains retryable after the next visible tick', async () => {
  let snapshot = initial, bad = false, errors = 0
  const remote = remoteFixture((q) => bad ? { ok: false, error: { code: 'git-error' } } : { ok: true, value: { kind: 'stash-list', entries: [{ index: 0, message: 'saved' }] } })
  const h = mount(() => useChangesData(remote, 's', snapshot, true, () => { errors++ }))
  await h.settle()
  bad = true; snapshot = { ...initial, checkedAt: 2 }; h.rerender(); await h.settle()
  assert.equal(errors, 1)
  assert.equal(h.value.stashes[0].message, 'saved')
  bad = false; snapshot = { ...initial, checkedAt: 3 }; h.rerender(); await h.settle()
  assert.equal(remote.calls.length, 3)
  assert.equal(h.value.stashes[0].message, 'saved')
  h.unmount()
})

test('a successful visible tick updates stash even if the worktree contents are unchanged', async () => {
  let entries = [{ index: 0 }, { index: 1 }], snapshot = initial
  const remote = remoteFixture(() => ({ ok: true, value: { kind: 'stash-list', entries } }))
  const h = mount(() => useChangesData(remote, 's', snapshot, true, fail))
  await h.settle()
  entries = [{ index: 0 }]; snapshot = { ...initial, checkedAt: 2 }; h.rerender(); await h.settle()
  assert.equal(h.value.stashes.length, 1)
  assert.equal(remote.calls.length, 2)
  h.unmount()
})
