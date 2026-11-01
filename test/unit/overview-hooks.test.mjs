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
      // Forward the optional field only when the scripted page sets it, so an
      // omitted topology models an unfiltered page or an older host.
      return { ok: true, value: { kind: 'history', commits: p.commits, total: p.total, ...(p.topology !== undefined ? { topology: p.topology } : {}) } }
    },
  }
}

/** A full object id, so topology fixtures read as real hashes. */
const H = (c) => c.repeat(40)
const FILTERED = { ref: null, search: 'x', author: '', since: '' }

test('useHistory loads page 0 on mount and appends on loadMore', async () => {
  const remote = historyRemote((q) => q.skip === 0
    ? { commits: [{ hash: 'a' }, { hash: 'b' }], total: 4 }
    : { commits: [{ hash: 'c' }, { hash: 'd' }], total: 4 })
  const props = { remote, sid: 's', filter: F, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
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
  const props = { remote, sid: 's', filter: F, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
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
  const props = { remote, sid: 's', filter: F, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
  await h.settle()
  assert.equal(h.value.total, -1)
  assert.equal(h.value.hasMore, true)
  h.unmount()
})

test('useHistory resets selection on a filter change but not on a plain poll refresh', async () => {
  let resets = 0
  const remote = historyRemote(() => ({ commits: [], total: 0 }))
  const props = { remote, sid: 's', filter: F, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => { resets += 1 }))
  await h.settle()
  // Mount keeps the initial filter → no reset (nothing selected yet either).
  assert.equal(resets, 0)
  // A content tick refreshes history while preserving the selected commit.
  props.queryKey = [1]
  h.rerender()
  await h.settle()
  assert.equal(resets, 0)
  // A genuine filter change may drop the selection from the new list → reset.
  props.filter = { ref: 'feature', search: '', author: '', since: '' }
  h.rerender()
  await h.settle()
  assert.equal(resets, 1)
  h.unmount()
})

test('useHistory publishes rows, topology and applied filter together across delayed and stale responses', async () => {
  const pending = []
  const remote = { query: (req) => new Promise((resolve) => pending.push({ query: req.query, resolve })) }
  const a = { hash: H('a'), parents: [H('b')] }
  const b = { hash: H('b'), parents: [] }
  const author = { ...F, author: '疯狂的 dabing' }
  const props = { filter: author }
  const publications = []
  const h = mount(() => {
    const result = useHistory(remote, 's', props.filter, [0], () => {})
    publications.push({ commits: result.commits, topology: result.topology, filter: result.appliedFilter })
    return result
  }, { autoRender: true })
  const respond = (request, commits, topology) => request.resolve({ ok: true, value: { kind: 'history', commits, total: 10, ...(topology ? { topology } : {}) } })
  respond(pending[0], [a], [a, b])
  await h.settle()
  const original = h.value
  props.filter = F
  h.rerender()
  await h.settle()
  assert.equal(h.value.commits, original.commits, 'pending request retains the old rows')
  assert.equal(h.value.topology, original.topology, 'pending request retains their topology')
  assert.equal(h.value.appliedFilter, author, 'layout still uses the filter that produced the rows')
  const start = publications.length
  respond(pending[1], [a, b])
  await h.settle()
  for (const value of publications.slice(start)) {
    if (value.commits.length === 2) {
      assert.equal(value.topology, undefined, 'new unfiltered rows never carry stale filtered topology')
      assert.equal(value.filter, F, 'new layout policy is published with the new rows')
    }
  }
  assert.equal(h.value.appliedFilter, F)
  props.filter = author
  h.rerender()
  const oldRequest = pending.at(-1)
  const latestFilter = { ...F, author: 'xbzbing' }
  props.filter = latestFilter
  h.rerender()
  const latestRequest = pending.at(-1)
  respond(latestRequest, [b], [b])
  await h.settle()
  respond(oldRequest, [a], [a, b])
  await h.settle()
  assert.deepEqual(h.value.commits, [b])
  assert.equal(h.value.appliedFilter, latestFilter, 'stale response cannot change the applied filter')
  assert.deepEqual(h.value.topology, [b])
  h.unmount()
})

test('useHistory cannot append the pending filter to retained rows after a failed replacement', async () => {
  const calls = []
  let fail = false
  const remote = { query: async (req) => {
    calls.push(req.query)
    if (fail) return { ok: false, error: { code: 'git-error', message: 'failed' } }
    return { ok: true, value: { kind: 'history', commits: [{ hash: H('a'), parents: [] }], total: 10 } }
  } }
  const props = { filter: F, key: [0] }
  const h = mount(() => useHistory(remote, 's', props.filter, props.key, () => {}))
  await h.settle()
  fail = true
  props.filter = { ...F, author: '疯狂的 dabing' }
  h.rerender()
  await h.settle()
  assert.equal(h.value.listError, true)
  assert.equal(h.value.appliedFilter, F)
  const count = calls.length
  h.value.loadMore()
  await h.settle()
  assert.equal(calls.length, count, 'failed page 0 blocks appending the new filter at an old offset')
  fail = false
  props.key = [1]
  h.rerender()
  await h.settle()
  assert.equal(h.value.appliedFilter, props.filter)
  h.value.loadMore()
  await h.settle()
  assert.equal(calls.at(-1).skip, 1, 'successful page 0 restores pagination')
  h.unmount()
})

// ── filtered-graph topology ───────────────────────────────────────────────

test('useHistory accumulates topology across pages of one generation', async () => {
  const remote = historyRemote((q) => q.skip === 0
    ? {
      commits: [{ hash: H('a'), parents: [H('b')] }], total: 2,
      topology: [{ hash: H('a'), parents: [H('b')] }, { hash: H('b'), parents: [] }],
    }
    : { commits: [{ hash: H('c'), parents: [] }], total: 2, topology: [{ hash: H('c'), parents: [] }] })
  const props = { remote, sid: 's', filter: FILTERED, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
  await h.settle()
  assert.deepEqual(h.value.topology.map((n) => n.hash), [H('a'), H('b')])
  h.value.loadMore()
  await h.settle()
  assert.deepEqual(h.value.topology.map((n) => n.hash).sort(), [H('a'), H('b'), H('c')].sort(), 'later pages merge by hash')
  h.unmount()
})

test('useHistory leaves topology undefined when the host omits the field', async () => {
  // An unfiltered page, and equally an older host: no field, no projection.
  const remote = historyRemote(() => ({ commits: [{ hash: H('a'), parents: [] }], total: 1 }))
  const props = { remote, sid: 's', filter: F, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
  await h.settle()
  assert.equal(h.value.topology, undefined)
  h.unmount()
})

test('useHistory resets topology when the filter is cleared', async () => {
  const remote = historyRemote((q) => q.search === 'x'
    ? { commits: [{ hash: H('a'), parents: [] }], total: 1, topology: [{ hash: H('a'), parents: [] }] }
    : { commits: [{ hash: H('a'), parents: [] }], total: 1 })
  const props = { remote, sid: 's', filter: FILTERED, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
  await h.settle()
  assert.equal(h.value.topology?.length, 1)
  props.filter = F
  h.rerender()
  await h.settle()
  assert.equal(h.value.topology, undefined, 'a fresh unfiltered generation drops the projection')
  h.unmount()
})

test('useHistory drops a stale page topology together with its commits', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  let call = 0
  const remote = {
    query: async (req) => {
      if (req.query.kind !== 'history') return { ok: true, value: { kind: req.query.kind } }
      call += 1
      if (call === 1) {
        await gate
        return { ok: true, value: { kind: 'history', commits: [{ hash: H('s') }], total: 1, topology: [{ hash: H('s'), parents: [] }] } }
      }
      return { ok: true, value: { kind: 'history', commits: [{ hash: H('f') }], total: 1, topology: [{ hash: H('f'), parents: [] }] } }
    },
  }
  const props = { remote, sid: 's', filter: F, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
  props.filter = { ref: 'feature', search: '', author: '', since: '' }
  h.rerender()
  await h.settle()
  release()
  await h.settle()
  assert.deepEqual(h.value.commits.map((c) => c.hash), [H('f')])
  assert.deepEqual(h.value.topology.map((n) => n.hash), [H('f')], 'stale topology cannot leak into the new generation')
  h.unmount()
})

test('useHistory fills visible commits the bounded walk missed or truncated', async () => {
  // The walk dropped a seed under its budget and reported a shallow boundary
  // with no parents; the page's own %P still has them.
  const remote = historyRemote(() => ({
    commits: [
      { hash: H('a'), parents: [H('b')] },
      { hash: H('c'), parents: [H('d')] },
    ],
    total: 2,
    topology: [{ hash: H('a'), parents: [] }],
  }))
  const props = { remote, sid: 's', filter: FILTERED, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
  await h.settle()
  const byHash = new Map(h.value.topology.map((n) => [n.hash, n.parents]))
  assert.deepEqual(byHash.get(H('a')), [H('b')], 'a parentless node is repaired from the visible commit')
  assert.deepEqual(byHash.get(H('c')), [H('d')], 'a seed missing from the walk is added from the visible commit')
  h.unmount()
})

test('useHistory lets a visible commit override the walk for the same hash', async () => {
  // The walk reported a shallow boundary (no parents) for a commit the page
  // shows with real parents: the visible %P must win, not merely fill a gap.
  const remote = historyRemote(() => ({
    commits: [{ hash: H('a'), parents: [H('b')] }],
    total: 1,
    topology: [{ hash: H('a'), parents: [H('x')] }, { hash: H('x'), parents: [] }],
  }))
  const props = { remote, sid: 's', filter: FILTERED, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
  await h.settle()
  const byHash = new Map(h.value.topology.map((n) => [n.hash, n.parents]))
  assert.deepEqual(byHash.get(H('a')), [H('b')], 'the visible commit is authoritative for its own hash')
  assert.deepEqual(byHash.get(H('x')), [], 'a hidden node with a different hash still rides along')
  assert.equal(h.value.topology.filter((n) => n.hash === H('a')).length, 1, 'no duplicate node for a visible hash')
  h.unmount()
})

test('useHistory caps the hidden topology cache without dropping a visible commit', async () => {
  const hidden = (i) => `f${i.toString(16).padStart(39, '0')}`
  const many = Array.from({ length: 20050 }, (_, i) => ({ hash: hidden(i), parents: [] }))
  const remote = historyRemote(() => ({
    commits: [{ hash: H('a'), parents: [] }],
    total: 1,
    topology: [{ hash: H('a'), parents: [] }, ...many],
  }))
  const props = { remote, sid: 's', filter: FILTERED, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
  await h.settle()
  const nodes = h.value.topology
  assert.equal(nodes.length, 20001, 'visible node + the 20000 hidden budget')
  assert.equal(nodes.some((n) => n.hash === H('a')), true, 'the visible commit is never dropped')
  assert.equal(new Set(nodes.map((n) => n.hash)).size, nodes.length, 'no duplicate hashes')
  assert.equal(nodes.some((n) => n.hash === hidden(20049)), true, 'newest hidden node kept')
  assert.equal(nodes.some((n) => n.hash === hidden(0)), false, 'oldest hidden node dropped past the cap')
  h.unmount()
})

test('useHistory lets a newer hidden record replace an earlier empty one', async () => {
  // Page 0 can only see a shallow boundary for 'b' (no parents); page 1 has the
  // real links. A first-wins merge would freeze the empty record and truncate
  // the path.
  const remote = historyRemote((q) => q.skip === 0
    ? {
      commits: [{ hash: H('a'), parents: [H('b')] }], total: 2,
      topology: [{ hash: H('a'), parents: [H('b')] }, { hash: H('b'), parents: [] }],
    }
    : { commits: [{ hash: H('c'), parents: [] }], total: 2, topology: [{ hash: H('b'), parents: [H('d')] }] })
  const props = { remote, sid: 's', filter: FILTERED, queryKey: [0] }
  const h = mount(() => useHistory(props.remote, props.sid, props.filter, props.queryKey, () => {}))
  await h.settle()
  assert.deepEqual(new Map(h.value.topology.map((n) => [n.hash, n.parents])).get(H('b')), [], 'page 0 saw a boundary')
  h.value.loadMore()
  await h.settle()
  const byHash = new Map(h.value.topology.map((n) => [n.hash, n.parents]))
  assert.deepEqual(byHash.get(H('b')), [H('d')], 'the newer page completes the path')
  assert.equal(h.value.topology.filter((n) => n.hash === H('b')).length, 1, 'still a single node for the hash')
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

test('useCommitDetail hover writes go through the same LRU cap (no unbounded growth)', async () => {
  const counter = { n: 0 }
  const remote = showRemote(counter)
  const h = mount(() => useCommitDetail(remote, 's'))
  // 55 hovers each fetch once and populate the cache via the hover path. The
  // hover fetch is debounced (~260ms), so wait past it before settling.
  const past = () => new Promise((r) => setTimeout(r, 300))
  for (let i = 0; i < 55; i++) {
    h.value.onHoverEnter({ hash: 'h' + i }, 0, 0)
    await past()
    await h.settle()
    h.value.onHoverLeave()
    await h.settle()
  }
  assert.equal(counter.n, 55)
  // The most recent hover (h54) stays cached → no refetch on select.
  h.value.select({ hash: 'h54' }); await h.settle()
  assert.equal(counter.n, 55, 'recent hover entry is cached')
  // The oldest hover (h0) must have been evicted by the cap → it refetches,
  // proving the hover path shares the bounded cache instead of growing it.
  h.value.select({ hash: 'h0' }); await h.settle()
  assert.equal(counter.n, 56, 'oldest hover entry was evicted past the cap')
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
  const h = mount(() => useBranchTree(remote, 's', [0]))
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

test('useCommitDetail keeps the host truncation flag through select and cache', async () => {
  const remote = {
    query: async (req) => req.query.kind === 'show'
      ? { ok: true, value: { kind: 'show', ref: req.query.ref, commit: { hash: req.query.ref }, body: 'b', stats: [], insertions: 0, deletions: 0, truncated: true } }
      : { ok: true, value: { kind: req.query.kind } },
  }
  const h = mount(() => useCommitDetail(remote, 's'))
  h.value.select({ hash: 'a1' })
  await h.settle()
  assert.equal(h.value.detail.truncated, true, 'the pane can say the numbers are partial')
  h.value.select({ hash: 'a2' }); await h.settle()
  h.value.select({ hash: 'a1' }); await h.settle()
  assert.equal(h.value.detail.truncated, true, 'the cached record keeps the flag too')
  h.unmount()
})
