// A repository switch must not wait for the checkout it is leaving: the sample
// in flight is abandoned, and a checkout read before reopens on its own sample
// instantly. Both are about the controller's single-flight slot, so they are
// asserted at the controller level rather than through the panel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GitController, createVisibilitySource } from '../../lib/testkit.mjs'

const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const deferred = () => {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
// `at` is the wall clock the read happened at, in milliseconds — the same unit
// the host reports. A fixed low number would read as a sample from 1970, which
// the cache is right to treat as stale.
const snapshot = (at, root, fingerprint = String(at)) => ({
  root,
  refreshIntervalMs: 30_000,
  checkedAt: at,
  stateFingerprint: fingerprint,
  changes: [],
})
const ok = (value) => ({ ok: true, value })

function setup(t, handler) {
  const events = new Set()
  const document = {
    hidden: false,
    addEventListener: (_, listener) => events.add(listener),
    removeEventListener: (_, listener) => events.delete(listener),
  }
  const visibility = createVisibilitySource(() => document)
  const calls = []
  const remote = {
    snapshot: (request, signal) => {
      calls.push({ repo: request.repo ?? '', signal })
      return handler(calls.length, request, signal)
    },
  }
  const controller = new GitController(remote, 'repo-switch-cache', visibility, '')
  t.after(() => controller.dispose())
  return { controller, calls }
}

const rootOf = (controller) => {
  const view = controller.getSnapshot()
  return view.state === 'ready' ? view.snapshot.root : view.state
}

test('switching back republishes that checkout sample before the reply lands', async (t) => {
  const h = setup(t, async (n) => ok(snapshot(Date.now(), n === 2 ? '/ws/site' : '/ws')))
  h.controller.ensure()
  await drain()
  assert.equal(rootOf(h.controller), '/ws')

  await h.controller.setRepo('site')
  assert.equal(rootOf(h.controller), '/ws/site')

  const back = h.controller.setRepo('')
  // The cached sample is the one read at the start: the panel turns the page
  // immediately instead of showing the other checkout while the refresh runs.
  assert.equal(rootOf(h.controller), '/ws', 'the switch back is not a blank wait')
  await back
  assert.equal(h.calls.length, 3, 'the cached sample is still calibrated by a refresh')
  assert.equal(rootOf(h.controller), '/ws')
})

test('a switch abandons the sample in flight instead of queueing behind it', async (t) => {
  const first = deferred()
  const h = setup(t, async (n) => (n === 1 ? first.promise : ok(snapshot(Date.now(), '/ws/site'))))
  h.controller.ensure()
  await drain()
  assert.equal(h.calls.length, 1)

  const switching = h.controller.setRepo('site')
  assert.equal(h.calls.length, 2, 'the new checkout is read without waiting for the old answer')
  assert.equal(h.calls[0].signal.aborted, true, 'the abandoned sample is aborted')
  assert.equal(h.calls[1].repo, 'site')
  await switching
  assert.equal(rootOf(h.controller), '/ws/site')

  first.resolve(ok(snapshot(Date.now(), '/ws')))
  await drain()
  assert.equal(rootOf(h.controller), '/ws/site', 'a late answer cannot overwrite the new checkout')
})

test('the sample cache keeps only the most recent checkouts', async (t) => {
  const h = setup(t, async (n, request) => ok(snapshot(Date.now(), request.repo ? `/${request.repo}` : '/ws')))
  h.controller.ensure()
  await drain()
  // Eight slots, and the cwd's own sample holds the first one: the eighth nested
  // checkout pushes it out.
  for (let i = 1; i <= 8; i++) await h.controller.setRepo(`r${i}`)
  assert.equal(rootOf(h.controller), '/r8')

  const back = h.controller.setRepo('')
  // The cwd's own sample fell out of the cache, so there is no page turn to
  // make: the view stays on the checkout being left until the answer arrives.
  assert.equal(rootOf(h.controller), '/r8')
  await back
  assert.equal(rootOf(h.controller), '/ws')
})

test('a sample older than one poll interval is not republished', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 })
  const h = setup(t, async (n) => ok(snapshot(Date.now(), n === 2 ? '/ws/site' : '/ws')))
  h.controller.ensure()
  await drain()
  assert.equal(rootOf(h.controller), '/ws')

  await h.controller.setRepo('site')
  assert.equal(rootOf(h.controller), '/ws/site')

  // One poll interval later the cached sample can no longer speak for the work
  // tree: the panes keep the checkout being left until the reply lands, rather
  // than briefly showing a list that may already be a minute old.
  t.mock.timers.tick(30_001)
  const back = h.controller.setRepo('')
  assert.equal(rootOf(h.controller), '/ws/site', 'a stale sample is not shown before the reply')
  await back
  assert.equal(rootOf(h.controller), '/ws')
})

test('freshness is measured on this client clock, not the host checkedAt', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 })
  // Per call, how far the host clock reads from the browser's: 400 s ahead on
  // the first sample, 40 s behind on the third. Neither may decide freshness.
  const skew = [400_000, 0, -40_000, 0]
  const h = setup(t, async (n) => ok(snapshot(Date.now() + skew[n - 1], n % 2 === 0 ? '/ws/site' : '/ws')))
  h.controller.ensure()
  await drain()
  await h.controller.setRepo('site')

  t.mock.timers.tick(30_001)
  const stale = h.controller.setRepo('')
  assert.equal(rootOf(h.controller), '/ws/site', 'a sample received a poll interval ago is not replayed, however late the host clock reads')
  await stale
  await h.controller.setRepo('site')

  const fresh = h.controller.setRepo('')
  assert.equal(rootOf(h.controller), '/ws', 'a sample received just now is replayed, however early the host clock reads')
  assert.equal(h.controller.showsRepo(''), true)
  await fresh
})

test('a replayed sample does not start the sub-queries; the calibrating one does, once', async (t) => {
  const reply = { current: null }
  const h = setup(t, async (n) => (n === 3 ? reply.current.promise : ok(snapshot(Date.now(), n === 2 ? '/ws/site' : '/ws'))))
  h.controller.ensure()
  await drain()
  await h.controller.setRepo('site')
  const before = h.controller.getQuerySignal()

  reply.current = deferred()
  const back = h.controller.setRepo('')
  assert.equal(rootOf(h.controller), '/ws', 'the page turns on the replayed sample')
  assert.equal(h.controller.showsRepo(''), true)
  const replayed = h.controller.getQuerySignal()
  assert.equal(replayed.tick, before.tick, 'the replay does not advance the query tick')
  assert.equal(replayed.ready, false, 'queries wait for the calibrating sample')

  reply.current.resolve(ok(snapshot(Date.now(), '/ws')))
  await back
  const calibrated = h.controller.getQuerySignal()
  assert.equal(calibrated.tick, before.tick + 1, 'one batch of queries for the whole switch')
  assert.equal(calibrated.ready, true)
  assert.equal(calibrated.root, '/ws')
})

test('a resync drops every remembered sample', async (t) => {
  const h = setup(t, async (n, request) => ok(snapshot(Date.now(), request.repo ? '/ws/site' : '/ws')))
  h.controller.ensure()
  await drain()
  await h.controller.setRepo('site')
  // A config write (or a reconnect) resyncs: the sample remembered for the cwd
  // carries the old host-wide settings and must not come back.
  h.controller.resync()
  await drain()

  const back = h.controller.setRepo('')
  assert.equal(rootOf(h.controller), '/ws/site', 'no replay after a resync')
  assert.equal(h.controller.showsRepo(''), false)
  await back
  assert.equal(rootOf(h.controller), '/ws')
})
