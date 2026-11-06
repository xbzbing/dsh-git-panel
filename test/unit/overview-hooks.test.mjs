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
      return { ok: true, value: { kind: 'history', commits: p.commits, total: p.total, ...(p.topology !== undefined ? { topology: p.topology } : {}), ...(p.pathSearchSupported === true ? { pathSearchSupported: true } : {}) } }
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

function controlledHistory() {
  const requests = []
  const remote = { query: (request) => new Promise((resolve, reject) => requests.push({ ...request, resolve, reject })) }
  return { remote, requests }
}

function historyResult(commits = [], total = commits.length, capable = true, topology) {
  return { ok: true, value: { kind: 'history', commits, total,
    ...(capable ? { pathSearchSupported: true } : {}),
    ...(topology !== undefined ? { topology } : {}),
  } }
}

test('useHistory learns capability only from successful current queries, including empty histories', async (t) => {
  const { remote, requests } = controlledHistory()
  const props = { key: 0 }
  const h = mount(() => useHistory(remote, 's', F, [props.key], () => {}))
  t.after(() => h.unmount())
  assert.equal(h.value.pathSearchSupport, 'unknown')
  requests[0].resolve({ ok: false, error: { code: 'git-error' } })
  await h.settle()
  assert.equal(h.value.pathSearchSupport, 'unknown', 'failure does not identify an old host')
  props.key++; h.rerender()
  requests[1].resolve(historyResult([], 0, false))
  await h.settle()
  assert.equal(h.value.pathSearchSupport, 'unsupported')
  assert.equal(h.value.pathSearchUnsupported, false, 'ordinary queries do not show a refused-path notice')
  props.key++; h.rerender()
  requests[2].resolve(historyResult())
  await h.settle()
  assert.equal(h.value.pathSearchSupport, 'supported', 'empty success declares support')
  props.key++; h.rerender()
  requests[3].reject(new Error('disconnected'))
  await h.settle()
  assert.equal(h.value.pathSearchSupport, 'supported', 'rejection preserves known capability')
})

test('useHistory reissues unchanged query on remote rebuild and drops old capability responses', async (t) => {
  const old = controlledHistory(), fresh = controlledHistory()
  const props = { remote: old.remote, key: 0 }
  const h = mount(() => useHistory(props.remote, 's', F, [props.key], () => {}))
  t.after(() => h.unmount())
  old.requests[0].resolve(historyResult([{ hash: 'original' }], 5))
  await h.settle()
  assert.equal(h.value.pathSearchSupport, 'supported')
  props.key++; h.rerender()
  props.remote = fresh.remote; h.rerender()
  assert.equal(fresh.requests.length, 1, 'remote identity must change the serialized request key')
  assert.equal(h.value.pathSearchSupport, 'unknown', 'new remote has no inherited capability')
  const previous = h.value.commits
  old.requests[1].resolve(historyResult([{ hash: 'stale' }], 1, false))
  await h.settle()
  assert.equal(h.value.pathSearchSupport, 'unknown', 'old success cannot identify the new remote')
  assert.equal(h.value.commits, previous)
  assert.equal(h.value.loading, true, 'stale completion cannot release the new request guard')
  fresh.requests[0].resolve(historyResult([], 0, false))
  await h.settle()
  assert.equal(h.value.pathSearchSupport, 'unsupported')
  assert.deepEqual(h.value.commits, [])
})

for (const staleCapable of [false, true]) {
  test(`useHistory ignores stale ${staleCapable ? 'supported' : 'unsupported'} capability after a newer response`, async (t) => {
    const { remote, requests } = controlledHistory()
    const props = { filter: F }
    const h = mount(() => useHistory(remote, 's', props.filter, [0], () => {}))
    t.after(() => h.unmount())
    props.filter = { ...F, search: 'current' }; h.rerender()
    requests[1].resolve(historyResult([{ hash: 'current' }], 1, !staleCapable))
    await h.settle()
    const expectedSupport = staleCapable ? 'unsupported' : 'supported'
    assert.equal(h.value.pathSearchSupport, expectedSupport)
    requests[0].resolve(historyResult([{ hash: 'stale' }], 1, staleCapable))
    await h.settle()
    assert.equal(h.value.pathSearchSupport, expectedSupport)
    assert.deepEqual(h.value.commits.map((commit) => commit.hash), ['current'])
    assert.equal(h.value.pathSearchUnsupported, false)
  })
}

test('useHistory restarts at page zero on only pathSearch changes and forwards all filters to pagination', async (t) => {
  const calls = []
  const remote = { query: async (req) => {
    calls.push(req.query)
    return historyResult([{ hash: `${req.query.pathSearch}:${req.query.skip}`, parents: [] }], 3)
  } }
  const props = { filter: { ...F, ref: 'feature', pathSearch: 'src/', author: 'Tester', since: '2020-01-01' } }
  let resets = 0
  const h = mount(() => useHistory(remote, 's', props.filter, [0], () => { resets++ }))
  t.after(() => h.unmount())
  await h.settle()
  h.value.loadMore(); await h.settle()
  assert.deepEqual(calls.map((q) => [q.pathSearch, q.skip]), [['src/', 0], ['src/', 1]])
  assert.equal(calls[1].search, undefined)
  assert.equal(calls[1].ref, 'feature')
  assert.equal(calls[1].author, 'Tester')
  assert.equal(calls[1].since, '2020-01-01')
  props.filter = { ...props.filter, pathSearch: 'abcdef1' }; h.rerender(); await h.settle()
  assert.equal(calls.at(-1).skip, 0)
  assert.equal(calls.at(-1).pathSearch, 'abcdef1', 'hex-shaped paths stay in the path field')
  assert.equal(h.value.appliedFilter, props.filter)
  assert.deepEqual(h.value.commits.map((c) => c.hash), ['abcdef1:0'])
  assert.equal(resets, 1)
  h.value.loadMore(); await h.settle()
  assert.deepEqual(calls.at(-1), { kind: 'history', limit: 100, skip: 1, ref: 'feature', pathSearch: 'abcdef1', author: 'Tester', since: '2020-01-01' })
})

test('useHistory rejects every path response missing capability and blocks further pagination', async (t) => {
  const { remote, requests } = controlledHistory()
  const props = { filter: F, key: 0 }
  const h = mount(() => useHistory(remote, 's', props.filter, [props.key], () => {}))
  t.after(() => h.unmount())
  requests[0].resolve(historyResult([{ hash: 'original', parents: [] }], 10))
  await h.settle()
  const previous = h.value
  props.filter = { ...F, pathSearch: 'src/' }; h.rerender()
  requests[1].resolve(historyResult([{ hash: 'unfiltered' }], 100, false))
  await h.settle()
  assert.equal(h.value.pathSearchSupport, 'unsupported')
  assert.equal(h.value.pathSearchUnsupported, true)
  assert.equal(h.value.listError, true)
  assert.equal(h.value.commits, previous.commits)
  assert.equal(h.value.appliedFilter, F)
  assert.equal(h.value.total, previous.total)
  assert.equal(h.value.hasMore, false)
  h.value.loadMore(); await h.settle()
  assert.equal(requests.length, 2)
  props.key++; h.rerender()
  requests[2].resolve(historyResult([{ hash: 'match', parents: [] }], 10, true, [{ hash: 'hidden', parents: [] }]))
  await h.settle()
  assert.equal(h.value.pathSearchUnsupported, false)
  assert.equal(h.value.pathSearchSupport, 'supported')
  const pathPage = h.value
  h.value.loadMore()
  requests[3].resolve(historyResult([{ hash: 'unfiltered-append' }], 100, false))
  await h.settle()
  assert.equal(h.value.commits, pathPage.commits)
  assert.equal(h.value.topology, pathPage.topology)
  assert.equal(h.value.total, pathPage.total)
  assert.equal(h.value.appliedFilter, props.filter)
  assert.equal(h.value.pathSearchUnsupported, true, 'every append also requires capability')
  h.value.loadMore(); await h.settle()
  assert.equal(requests.length, 4, 'missing capability revokes append readiness even after a valid page zero')
})

test('a capability refusal survives a poll whose reply is pending or has failed', async (t) => {
  const { remote, requests } = controlledHistory()
  const props = { filter: F, key: 0 }
  const h = mount(() => useHistory(remote, 's', props.filter, [props.key], () => {}))
  t.after(() => h.unmount())
  requests[0].resolve(historyResult([{ hash: 'original', parents: [] }], 10))
  await h.settle()
  const retained = h.value.commits
  props.filter = { ...F, pathSearch: 'src/' }; h.rerender()
  requests[1].resolve(historyResult([], 100, false))
  await h.settle()
  assert.equal(h.value.pathSearchUnsupported, true)
  props.key++; h.rerender()
  await h.settle()
  assert.equal(h.value.pathSearchUnsupported, true, 'the refusal stays while the same path query is retried')
  requests[2].reject(new Error('transport'))
  await h.settle()
  assert.equal(h.value.pathSearchUnsupported, true, 'a failed retry must not drop the explanation')
  assert.deepEqual(h.value.commits, retained, 'the retained rows stay on screen')
  props.filter = { ...F }; props.key++; h.rerender()
  requests[3].resolve(historyResult([], 0))
  await h.settle()
  assert.equal(h.value.pathSearchUnsupported, false, 'leaving path mode clears the refusal')
})

test('message filters never send a path field', async (t) => {
  const { remote, requests } = controlledHistory()
  const h = mount(() => useHistory(remote, 's', { ...F, search: 'needle', pathSearch: '' }, [0], () => {}))
  t.after(() => h.unmount())
  assert.equal(Object.hasOwn(requests[0].query, 'pathSearch'), false)
  h.unmount()
})

test('useHistory publishes path filters atomically and rejects stale path pages and capability changes', async (t) => {
  const { remote, requests } = controlledHistory()
  const props = { filter: { ...F, pathSearch: 'old' } }
  const publications = []
  const h = mount(() => {
    const result = useHistory(remote, 's', props.filter, [0], () => {})
    publications.push({ commits: result.commits, topology: result.topology, filter: result.appliedFilter })
    return result
  }, { autoRender: true })
  t.after(() => h.unmount())
  const first = { hash: H('a'), parents: [] }
  requests[0].resolve(historyResult([first], 5, true, [first]))
  await h.settle()
  h.value.loadMore()
  props.filter = { ...F, pathSearch: 'new' }; h.rerender()
  await h.settle()
  assert.deepEqual(h.value.commits, [first])
  assert.equal(h.value.appliedFilter.pathSearch, 'old')
  requests[1].resolve(historyResult([{ hash: 'stale' }], 20, false))
  await h.settle()
  assert.equal(h.value.loading, true)
  assert.equal(h.value.pathSearchSupport, 'supported')
  assert.equal(h.value.pathSearchUnsupported, false)
  const fresh = { hash: H('b'), parents: [] }
  const start = publications.length
  requests[2].resolve(historyResult([fresh], 1, true, [fresh]))
  await h.settle()
  for (const publication of publications.slice(start)) {
    if (publication.commits[0]?.hash !== fresh.hash) continue
    assert.equal(publication.filter, props.filter)
    assert.deepEqual(publication.topology, [fresh])
  }
  assert.deepEqual(h.value.commits, [fresh])
  assert.equal(h.value.appliedFilter, props.filter)
  assert.equal(h.value.total, 1)
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

test('useCommitDetail raises no hover card while a menu is open', async () => {
  const remote = showRemote({ n: 0 })
  const state = { menuOpen: false }
  const h = mount(() => useCommitDetail(remote, 's', 'unified', true, state.menuOpen))
  const past = () => new Promise((r) => setTimeout(r, 300))
  h.value.onHoverEnter({ hash: H('a') }, 1, 1)
  await past(); await h.settle()
  assert.ok(h.value.hover, 'the card is up before any menu opens')

  state.menuOpen = true
  h.rerender(); await h.settle()
  assert.equal(h.value.hover, null, 'opening a menu drops the card already shown')

  h.value.onHoverEnter({ hash: H('b') }, 2, 2)
  await past(); await h.settle()
  assert.equal(h.value.hover, null, 'a row hovered under an open menu raises nothing')

  state.menuOpen = false
  h.rerender(); await h.settle()
  h.value.onHoverEnter({ hash: H('b') }, 2, 2)
  await past(); await h.settle()
  assert.ok(h.value.hover, 'the card returns once the menu closes')
  h.unmount()
})

test('useCommitDetail cancels a pending hover when the menu opens mid-debounce', async () => {
  const remote = showRemote({ n: 0 })
  const state = { menuOpen: false }
  const h = mount(() => useCommitDetail(remote, 's', 'unified', true, state.menuOpen))
  h.value.onHoverEnter({ hash: H('c') }, 1, 1)
  // Past the enter but well inside the 260ms debounce: the right-click that
  // opens the menu lands in this window.
  await new Promise((r) => setTimeout(r, 100))
  state.menuOpen = true
  h.rerender(); await h.settle()
  await new Promise((r) => setTimeout(r, 300))
  await h.settle()
  assert.equal(h.value.hover, null, 'the timer must not raise a card behind the menu')
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
