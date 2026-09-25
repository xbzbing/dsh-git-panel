/**
 * OverviewTab data-hook tests (S1): drive the extracted hooks through a minimal
 * synchronous hook runtime (_hook-harness) with a scripted remote, locking the
 * fetch timing the e2e can't reach — generation guards, paging, total:-1, the
 * detail LRU, and tree-error recovery.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount } from './_hook-harness.mjs'
import { useBranchTree, useHistory, useCommitDetail } from '../../lib/hookkit.mjs'

const F = { ref: null, search: '', author: '', since: '' }

function historyRemote(page) {
  return {
    query: async (req) => {
      if (req.query.kind !== 'history') return { ok: true, value: { kind: req.query.kind, commits: [], total: 0 } }
      const p = page(req.query)
      return { ok: true, value: { kind: 'history', commits: p.commits, total: p.total } }
    },
  }
}

test('useHistory loads page 0 on mount and appends on loadMore', async () => {
  const remote = historyRemote((q) => q.skip === 0
    ? { commits: [{ hash: 'a' }, { hash: 'b' }], total: 4 }
    : { commits: [{ hash: 'c' }, { hash: 'd' }], total: 4 })
  const props = { remote, sid: 's', filter: F, refreshKey: 0 }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.refreshKey, () => {}))
  await h.settle()
  assert.deepEqual(h.value.commits.map((c) => c.hash), ['a', 'b'])
  assert.equal(h.value.total, 4)
  assert.equal(h.value.hasMore, true)
  h.value.loadMore()
  await h.settle()
  assert.deepEqual(h.value.commits.map((c) => c.hash), ['a', 'b', 'c', 'd'])
  assert.equal(h.value.hasMore, false)
  h.unmount()
})

test('useHistory drops a stale in-flight page when the filter changes (generation guard)', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  let call = 0
  const remote = {
    query: async (req) => {
      if (req.query.kind !== 'history') return { ok: true, value: { kind: req.query.kind, commits: [], total: 0 } }
      call += 1
      if (call === 1) { await gate; return { ok: true, value: { kind: 'history', commits: [{ hash: 'stale' }], total: 1 } } }
      return { ok: true, value: { kind: 'history', commits: [{ hash: 'fresh' }], total: 1 } }
    },
  }
  const props = { remote, sid: 's', filter: F, refreshKey: 0 }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.refreshKey, () => {}))
  props.filter = { ref: 'feature', search: '', author: '', since: '' }
  h.rerender()
  await h.settle()
  release()
  await h.settle()
  assert.deepEqual(h.value.commits.map((c) => c.hash), ['fresh'])
  h.unmount()
})

test('useHistory treats total:-1 as always-more (hash-jump paging)', async () => {
  const remote = historyRemote(() => ({ commits: [{ hash: 'x' }], total: -1 }))
  const props = { remote, sid: 's', filter: F, refreshKey: 0 }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.refreshKey, () => {}))
  await h.settle()
  assert.equal(h.value.total, -1)
  assert.equal(h.value.hasMore, true)
  h.unmount()
})

test('useHistory calls onReset before reloading page 0', async () => {
  let resets = 0
  const remote = historyRemote(() => ({ commits: [], total: 0 }))
  const props = { remote, sid: 's', filter: F, refreshKey: 0 }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.refreshKey, () => { resets += 1 }))
  await h.settle()
  assert.equal(resets, 1)
  props.refreshKey = 1
  h.rerender()
  await h.settle()
  assert.equal(resets, 2)
  h.unmount()
})

function showRemote(counter) {
  return {
    query: async (req) => {
      if (req.query.kind === 'show') { counter.n += 1; return { ok: true, value: { kind: 'show', ref: req.query.ref, commit: { hash: req.query.ref }, body: 'b', stats: [] } } }
      return { ok: true, value: { kind: req.query.kind } }
    },
  }
}

test('useCommitDetail caches show per hash and re-selection hits the cache', async () => {
  const counter = { n: 0 }
  const remote = showRemote(counter)
  const h = mount(() => useCommitDetail(remote, 's'))
  h.value.select({ hash: 'a1' })
  await h.settle()
  assert.equal(h.value.detail.body, 'b')
  assert.equal(counter.n, 1)
  h.value.select({ hash: 'a2' }); await h.settle()
  h.value.select({ hash: 'a1' }); await h.settle()
  assert.equal(counter.n, 2, 're-selecting a1 does not refetch')
  h.unmount()
})

test('useCommitDetail evicts the oldest entries past the 50 cap', async () => {
  const counter = { n: 0 }
  const remote = showRemote(counter)
  const h = mount(() => useCommitDetail(remote, 's'))
  for (let i = 0; i < 55; i++) { h.value.select({ hash: 'c' + i }); await h.settle() }
  assert.equal(counter.n, 55)
  h.value.select({ hash: 'c0' }); await h.settle()
  assert.equal(counter.n, 56, 'evicted entry refetches')
  h.unmount()
})

test('useBranchTree surfaces treeError when branches fail, and reload recovers', async () => {
  let ok = false
  const remote = {
    query: async (req) => {
      if (req.query.kind === 'branches') {
        return ok
          ? { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [], remote: [] } }
          : { ok: false, error: { code: 'git-error' } }
      }
      if (req.query.kind === 'tags') return { ok: true, value: { kind: 'tags', tags: [] } }
      return { ok: true, value: { kind: 'authors', authors: [] } }
    },
  }
  const h = mount(() => useBranchTree(remote, 's', 0))
  await h.settle()
  assert.equal(h.value.treeError, true)
  assert.equal(h.value.tree, null)
  ok = true
  h.value.reload()
  await h.settle()
  assert.equal(h.value.treeError, false)
  assert.equal(h.value.tree?.current, 'main')
  h.unmount()
})
