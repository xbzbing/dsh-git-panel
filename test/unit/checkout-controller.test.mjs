import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CheckoutController, selectedRepo, selectRepo, hasRepoPick, PICKS_KEY, parsePicks } from '../../lib/testkit.mjs'

const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
let nextId = 0

function row(path, root, role = 'linked', extra = {}) {
  return { path, root, role, name: root.split('/').at(-1), kind: path === '' ? 'workspace' : 'nested', ...extra }
}
const MAIN = row('', '/repo', 'main')
const A = row('.agents/worktrees/a', '/repo/.agents/worktrees/a')
const B = row('.agents/worktrees/b', '/repo/.agents/worktrees/b')
const C = row('.agents/worktrees/c', '/repo/.agents/worktrees/c')
const D = row('.agents/worktrees/d', '/repo/.agents/worktrees/d')
const SITE = row('site', '/repo/site', 'repo')
const ROWS = [MAIN, A, B, SITE]
const listed = (repos = ROWS, extra = {}) => ({ ok: true, value: { kind: 'repo-list', cwd: MAIN.root, repos, worktrees: 'ok', ...extra } })

/** Deliberately lets an aborted request reply, to test the owner's generation guard. */
function setup(t, config = {}, { installStorage = true, signalReady = true } = {}) {
  const sessionId = `checkout-controller-${++nextId}`
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const stored = new Map()
  const storage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => { stored.set(key, value) },
    removeItem: (key) => { stored.delete(key) },
  }
  if (installStorage) Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true })
  let snapshot = { root: MAIN.root, changes: [], checkedAt: 1, detectCheckouts: true, repoLimit: 50, followSessionCheckout: true, ...config }
  let view = { state: 'ready', snapshot }
  let signal = { ready: signalReady, tick: 1, root: snapshot.root, sampledAt: snapshot.checkedAt }
  let repo = ''
  let sampled = ''
  const listeners = new Set()
  const queryListeners = new Set()
  const switches = []
  const requests = []
  const git = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    subscribeQueries(listener) { queryListeners.add(listener); return () => queryListeners.delete(listener) },
    getSnapshot: () => view,
    getQuerySignal: () => signal,
    getRepo: () => repo,
    sampledRepo: () => sampled,
    setRepo(path) { repo = path; switches.push(path); return Promise.resolve() },
  }
  const remote = {
    query(request, signal) {
      assert.deepEqual(request, { sessionId, query: { kind: 'repo-list' } }, 'discovery is session-scoped, not tagged with the selected checkout')
      let resolve, reject
      const promise = new Promise((yes, no) => { resolve = yes; reject = no })
      requests.push({ request, signal, resolve, reject })
      return promise
    },
  }
  const checkout = new CheckoutController(remote, sessionId, git)
  t.after(() => {
    checkout.dispose()
    if (installStorage) {
      if (storageDescriptor === undefined) delete globalThis.sessionStorage
      else Object.defineProperty(globalThis, 'sessionStorage', storageDescriptor)
    }
  })
  const publish = (next, selector = repo, fresh = true) => {
    view = next
    sampled = selector
    const ready = fresh && next.state === 'ready' && next.stale !== true
    signal = { ready, tick: signal.tick + (ready ? 1 : 0), root: next.snapshot?.root ?? null, sampledAt: next.snapshot?.checkedAt ?? 0 }
    for (const listener of [...listeners]) listener()
    for (const listener of [...queryListeners]) listener()
  }
  return {
    sessionId, checkout, git, requests, switches, storage,
    observe: (owner, directory, active = true, discover = true) => checkout.observe(owner, active, directory, discover),
    pick: (path) => selectRepo(sessionId, path),
    get selected() { return selectedRepo(sessionId) },
    get record() { return parsePicks(storage.getItem(PICKS_KEY)).get(sessionId) },
    publish,
    config(next) {
      snapshot = { ...snapshot, checkedAt: snapshot.checkedAt + 1, ...next }
      publish({ state: 'ready', snapshot })
    },
    async answer(index, repos = ROWS, extra = {}) { await drain(); requests[index].resolve(listed(repos, extra)); await drain() },
  }
}

test('pill and multiple panels share one initial list and repeated views do not rescan', async (t) => {
  const f = setup(t)
  const pill = Symbol('pill'), panel = Symbol('panel'), sidebar = Symbol('sidebar')
  const seenPill = [], seenPanel = []
  t.after(f.checkout.subscribe(() => seenPill.push(f.checkout.getSnapshot().list)))
  t.after(f.checkout.subscribe(() => seenPanel.push(f.checkout.getSnapshot().list)))
  f.observe(pill, A.root, true, false)
  f.observe(panel, A.root)
  f.observe(sidebar, A.root)
  await drain()
  assert.equal(f.requests.length, 1, 'all surfaces join the initial scan')
  await f.answer(0)
  assert.equal(f.selected, A.path)
  assert.deepEqual(f.switches, [A.path], 'one owner applies the follow, not one per observer')
  assert.equal(seenPill.length, 1)
  assert.equal(seenPanel.length, 1)
  assert.equal(seenPill[0], seenPanel[0], 'every consumer receives the same list instance')
  const list = f.checkout.getSnapshot().list
  for (let i = 0; i < 6; i++) {
    f.config({})
    f.observe(panel, A.root)
    f.observe(sidebar, A.root)
  }
  await drain()
  assert.equal(f.requests.length, 1, 'checkedAt and new view identities are not discovery keys')
  assert.equal(f.checkout.getSnapshot().list, list)
  assert.equal(hasRepoPick(f.sessionId), false, 'automatic following is not a manual pick')
  assert.equal(f.record, undefined, 'following never writes the tab record')
})

test('exact known checkout enter and exit change selectors without rescanning', async (t) => {
  const f = setup(t), pill = Symbol('pill')
  f.observe(pill, MAIN.root, true, false)
  await f.answer(0)
  for (const target of [A, B, MAIN, A, MAIN]) {
    f.observe(pill, target.root, true, false)
    assert.equal(f.selected, target.path)
    assert.equal(f.git.getRepo(), target.path)
  }
  await drain()
  assert.equal(f.requests.length, 1, 'projection updates do not release/reacquire discovery')
  assert.deepEqual(f.switches, [A.path, B.path, '', A.path, ''])
})

test('a session created in a linked checkout follows the main selector and returns to its own empty selector', async (t) => {
  const f = setup(t), pill = Symbol('pill')
  const own = row('', A.root, 'linked')
  const main = row('../../..', MAIN.root, 'main')
  f.observe(pill, own.root, true, false)
  await f.answer(0, [own, main])
  f.observe(pill, main.root, true, false)
  assert.equal(f.selected, main.path)
  f.observe(pill, own.root, true, false)
  assert.equal(f.selected, '')
  assert.deepEqual(f.switches, [main.path, ''])
  await drain()
  assert.equal(f.requests.length, 1)
})

test('a missing nested target gates the old parent rows until one fresh list answers', async (t) => {
  const f = setup(t), pill = Symbol('pill')
  f.observe(pill, A.root, true, false)
  await f.answer(0)
  f.observe(pill, C.root, true, false)
  await drain()
  assert.equal(f.requests.length, 2)
  assert.equal(f.selected, A.path, 'the main row is not followed before checking for the new worktree')
  assert.equal(f.checkout.getSnapshot().ready, false, 'a new scan suspends the cached list verdict')
  f.config({}); f.observe(pill, C.root, true, false)
  await drain()
  assert.equal(f.requests.length, 2, 'repeated views join the missing-target scan')
  assert.deepEqual(f.switches, [A.path])
  await f.answer(1, [...ROWS, C])
  assert.equal(f.selected, C.path)
  assert.deepEqual(f.switches, [A.path, C.path], 'there is no transient switch through the enclosing main checkout')
})

test('rapid missing directories only follow the latest projection, with one scan at a time', async (t) => {
  const f = setup(t), pill = Symbol('pill')
  f.observe(pill, A.root, true, false)
  await f.answer(0)
  f.observe(pill, C.root, true, false)
  f.observe(pill, D.root, true, false)
  await drain()
  assert.equal(f.requests.length, 2)
  await f.answer(1, [...ROWS, C])
  assert.equal(f.selected, A.path, 'the answer for C cannot follow C or its parent after moving to D')
  await drain()
  assert.equal(f.requests.length, 3, 'the latest missing directory gets its own bounded check')
  await f.answer(2, [...ROWS, C, D])
  assert.equal(f.selected, D.path)
  assert.deepEqual(f.switches, [A.path, D.path])
  f.config({}); f.observe(pill, D.root, true, false)
  await drain()
  assert.equal(f.requests.length, 3)
})

test('a manual pick during the missing-target scan wins when its answer arrives', async (t) => {
  const f = setup(t), panel = Symbol('panel')
  f.observe(panel, A.root)
  await f.answer(0)
  f.observe(panel, C.root)
  f.pick(SITE.path)
  assert.equal(f.git.getRepo(), SITE.path, 'manual intent aligns the snapshot owner while discovery is pending')
  await f.answer(1, [...ROWS, C])
  f.config({}); f.observe(panel, C.root)
  assert.equal(f.selected, SITE.path)
  assert.equal(hasRepoPick(f.sessionId), true)
  assert.equal(f.record.repo, SITE.path)
  assert.deepEqual(f.switches, [A.path, SITE.path])
  f.observe(panel, B.root)
  assert.equal(f.selected, B.path, 'a later real directory change rearms follow')
  assert.equal(f.record.repo, SITE.path, 'the automatic rearm does not overwrite the manual record')
})

test('a manual pick after a rapid projection change is not overwritten by a pending scan', async (t) => {
  const f = setup(t), pill = Symbol('pill')
  f.observe(pill, MAIN.root, true, false)
  await f.answer(0)
  f.observe(pill, C.root, true, false)
  f.observe(pill, B.root, true, false)
  f.pick(SITE.path)
  assert.equal(f.git.getRepo(), SITE.path)
  await f.answer(1, [...ROWS, C])
  assert.equal(f.selected, SITE.path, 'the click happened after the last actual directory change')
  assert.equal(hasRepoPick(f.sessionId), true)
  assert.equal(f.record.repo, SITE.path)
  assert.deepEqual(f.switches, [SITE.path], 'the held scan cannot reinterpret the later click as old intent')
  f.config({}); f.observe(pill, B.root, true, false)
  assert.equal(f.selected, SITE.path)
  f.observe(pill, A.root, true, false)
  assert.equal(f.selected, A.path, 'only a subsequent directory change releases the manual pick')
})

test('a post-move manual pick can deliberately return to the selector released by that move', async (t) => {
  const f = setup(t), panel = Symbol('panel')
  f.pick(SITE.path)
  f.observe(panel, MAIN.root)
  await f.answer(0)
  assert.equal(f.selected, SITE.path, 'the initial mount protects the older manual pick')
  f.observe(panel, C.root)
  await drain()
  assert.equal(f.requests.length, 2)
  f.pick('')
  f.pick(SITE.path)
  assert.equal(f.selected, SITE.path)
  await f.answer(1, [...ROWS, C])
  assert.equal(f.selected, SITE.path, 'returning to the same selector is fresh post-move intent, not the released older pick')
  assert.equal(f.git.getRepo(), SITE.path)
  assert.equal(hasRepoPick(f.sessionId), true)
  assert.equal(f.record.repo, SITE.path)
  assert.deepEqual(f.switches, [SITE.path, '', SITE.path])
  f.config({}); f.observe(panel, C.root)
  assert.equal(f.selected, SITE.path)
})

test('failed missing-target reads do not use the cached parent as evidence', async (t) => {
  const failures = [
    ['transport', (request) => request.resolve({ ok: false, error: { code: 'transport' } })],
    ['business failure', (request) => request.resolve({ ok: false, error: { code: 'git-timeout' } })],
    ['wrong query kind', (request) => request.resolve({ ok: true, value: { kind: 'branches', branches: [] } })],
    ['rejection', (request) => request.reject(new Error('disconnected'))],
  ]
  for (const [label, fail] of failures) {
    await t.test(label, async (t) => {
      const f = setup(t), pill = Symbol('pill')
      f.observe(pill, A.root, true, false)
      await f.answer(0)
      const previous = f.checkout.getSnapshot().list
      f.observe(pill, C.root, true, false)
      await drain()
      fail(f.requests[1]); await drain()
      assert.equal(f.checkout.getSnapshot().list, previous, 'a failed query leaves the published list intact')
      assert.equal(f.checkout.getSnapshot().ready, false, 'cached rows are visible but no longer authoritative')
      assert.equal(f.selected, A.path, 'failure does not confirm the enclosing parent checkout')
      f.config({}); f.observe(pill, C.root, true, false)
      assert.equal(f.selected, A.path, 'a repeated view cannot convert failure into evidence')
      await drain()
      assert.equal(f.requests.length, 2, 'failure does not spin a retry loop')
      f.checkout.refetch()
      await f.answer(2, [...ROWS, C])
      assert.equal(f.selected, C.path, 'explicit recovery can complete the still-pending follow')
      assert.deepEqual(f.switches, [A.path, C.path])
    })
  }
})

test('an initial failed query cannot prune a remembered manual pick', async (t) => {
  const f = setup(t), panel = Symbol('panel')
  f.pick(SITE.path)
  f.observe(panel, A.root)
  await drain()
  f.requests[0].reject(new Error('offline')); await drain()
  assert.equal(f.checkout.getSnapshot().list, null)
  assert.equal(f.selected, SITE.path)
  assert.equal(f.git.getRepo(), SITE.path)
  assert.equal(f.record.repo, SITE.path)
  assert.equal(hasRepoPick(f.sessionId), true)
})

test('failed worktree probing neither follows a covering parent nor prunes manual intent', async (t) => {
  const f = setup(t), panel = Symbol('panel')
  f.observe(panel, A.root)
  await f.answer(0)
  f.observe(panel, C.root)
  await f.answer(1, [MAIN, A], { worktrees: 'failed' })
  assert.equal(f.selected, A.path, 'incomplete probing is not proof that C belongs to MAIN')
  f.pick(SITE.path)
  f.config({})
  assert.equal(f.selected, SITE.path, 'a manual row missing from an incomplete list stays selected')
  assert.equal(f.record.repo, SITE.path)
  f.checkout.refetch()
  await f.answer(2, [...ROWS, C])
  assert.equal(f.selected, SITE.path, 'successful recovery still respects the intervening pick')
  f.observe(panel, B.root)
  assert.equal(f.selected, B.path)
})

test('adopting the first configuration sample does not repeat the discovery', async (t) => {
  // A visible panel reads the list before the first snapshot can tell it the host's
  // detectCheckouts / repoLimit. The host applied its own setting to that scan, so
  // learning the value afterwards is not a flip and must not scan again.
  const f = setup(t, { detectCheckouts: false }, { signalReady: false })
  const panel = Symbol('panel')
  f.observe(panel, A.root)
  await drain()
  assert.equal(f.requests.length, 1, 'discovery starts while the configuration is still unknown')
  f.config({})
  await drain()
  assert.equal(f.requests.length, 1, 'the first observation adopts the value without rescanning')
  f.config({ detectCheckouts: true })
  await drain()
  assert.equal(f.requests.length, 2, 'a genuine change re-answers the list')
})

test('a pill alone waits for the configuration before its first scan', async (t) => {
  const f = setup(t, {}, { signalReady: false })
  const pill = Symbol('pill')
  f.observe(pill, A.root, true, false)
  await drain()
  assert.equal(f.requests.length, 0, 'no follow setting, no scan')
  f.config({})
  await drain()
  assert.equal(f.requests.length, 1, 'the known setting starts exactly one scan')
  await f.answer(0)
  assert.equal(f.selected, A.path)
})

test('a re-pick of the refused row after its repair is new intent', async (t) => {
  const f = setup(t), pill = Symbol('pill')
  f.observe(pill, A.root, true, false)
  await f.answer(0)
  f.pick(SITE.path)
  assert.equal(f.git.getRepo(), SITE.path)
  f.observe(pill, C.root, true, false)
  await drain()
  assert.equal(f.requests.length, 2, 'the move releases the pick and asks for the new row')
  // The host refuses SITE, so the repair drops the selection (no new intent).
  f.publish({ state: 'error', error: { code: 'invalid-repo' } }, SITE.path)
  await drain()
  assert.equal(f.selected, '', 'the refused pick is gone')
  // The default checkout samples cleanly again: the refusal no longer describes
  // the published view, so the next click is judged on its own revision.
  f.config({})
  await drain()
  // Clicking the same row again is what the value comparison could not see.
  f.pick(SITE.path)
  assert.equal(f.selected, SITE.path)
  await f.answer(1, [...ROWS, C])
  assert.equal(f.selected, SITE.path, 'the move\'s answer cannot replay it over the newer click')
  f.config({}); f.observe(pill, C.root, true, false)
  assert.equal(f.selected, SITE.path)
  assert.equal(hasRepoPick(f.sessionId), true)
})
test('off to on overrides a restored manual pick even when a pill needed no initial scan', async (t) => {
  const f = setup(t, { followSessionCheckout: false }), pill = Symbol('pill')
  f.storage.setItem(PICKS_KEY, JSON.stringify({ v: 1, sessions: { [f.sessionId]: { repo: SITE.path, at: 1 } } }))
  f.observe(pill, A.root, true, false)
  await drain()
  assert.equal(f.requests.length, 0, 'follow-off pill does not discover selector rows')
  assert.equal(f.selected, SITE.path, 'mount honours the record')
  f.config({ followSessionCheckout: true })
  await drain()
  assert.equal(f.requests.length, 1)
  assert.equal(f.selected, SITE.path, 'restored intent is not displaced while the first list is pending')
  await f.answer(0)
  assert.equal(f.selected, A.path, 'the explicit config flip rearms follow after discovery')
  assert.equal(hasRepoPick(f.sessionId), false)
  assert.equal(f.record.repo, SITE.path, 'following is memory-only even after a config flip')
})

test('older and stale cached views cannot undo the newest config or invalidate its list', async (t) => {
  const f = setup(t), panel = Symbol('panel')
  f.observe(panel, A.root)
  await f.answer(0)
  f.config({ checkedAt: 20, followSessionCheckout: false })
  f.observe(panel, B.root)
  assert.equal(f.selected, A.path)
  f.config({ checkedAt: 10, followSessionCheckout: true, detectCheckouts: false, repoLimit: 1 })
  f.observe(panel, MAIN.root)
  assert.equal(f.selected, A.path, 'cached follow-on cannot undo the newer off value')
  await drain()
  assert.equal(f.requests.length, 1, 'old detection and limit values cannot invalidate discovery')
  f.publish({ state: 'ready', stale: true, snapshot: { checkedAt: 30, followSessionCheckout: true, detectCheckouts: false, repoLimit: 1 } })
  f.observe(panel, B.root)
  assert.equal(f.selected, A.path, 'transport-stale samples carry no config authority')
  await drain()
  assert.equal(f.requests.length, 1)
  f.config({ checkedAt: 21, followSessionCheckout: true, detectCheckouts: true, repoLimit: 50 })
  assert.equal(f.selected, B.path, 'a genuinely newer config can rearm follow')
})

test('the newest host-wide config wins across checkout-controller instances', async (t) => {
  const first = setup(t, { checkedAt: 100 })
  const second = setup(t, { checkedAt: 110 }, { installStorage: false })
  const firstPill = Symbol('first'), secondPill = Symbol('second')
  first.observe(firstPill, A.root, true, false)
  second.observe(secondPill, B.root, true, false)
  await first.answer(0); await second.answer(0)
  assert.equal(first.selected, A.path)
  assert.equal(second.selected, B.path)
  first.config({ checkedAt: 200, followSessionCheckout: false })
  second.observe(secondPill, MAIN.root, true, false)
  assert.equal(second.selected, B.path, 'another session inherits the newer host-wide off value')
  second.config({ checkedAt: 150, followSessionCheckout: true, detectCheckouts: false, repoLimit: 1 })
  first.observe(firstPill, B.root, true, false)
  second.observe(secondPill, MAIN.root, true, false)
  assert.equal(first.selected, A.path)
  assert.equal(second.selected, B.path, 'a different class cannot republish an older on value')
  await drain()
  assert.equal(first.requests.length, 1)
  await drain()
  assert.equal(second.requests.length, 1)
  second.config({ checkedAt: 201, followSessionCheckout: true, detectCheckouts: true, repoLimit: 50 })
  first.observe(firstPill, B.root, true, false)
  await drain()
  assert.equal(first.requests.length, 2)
  await drain()
  assert.equal(second.requests.length, 2)
  await first.answer(1); await second.answer(1)
  assert.equal(first.selected, B.path, 'the newer cross-session on value rearms the first lifecycle')
  assert.equal(second.selected, '')
})

test('a replayed ready view without a fresh query signal has no config authority', async (t) => {
  const f = setup(t, { checkedAt: 20, followSessionCheckout: false }), pill = Symbol('pill')
  f.observe(pill, A.root, true, false)
  await drain()
  assert.equal(f.requests.length, 0)
  f.publish({ state: 'ready', snapshot: { root: MAIN.root, checkedAt: 999, followSessionCheckout: true, detectCheckouts: false, repoLimit: 1 } }, '', false)
  f.observe(pill, B.root, true, false)
  await drain()
  assert.equal(f.requests.length, 0, 'a ready view alone cannot turn a pill scan back on')
  assert.equal(f.selected, '')
  f.config({ checkedAt: 21, followSessionCheckout: true })
  await drain()
  assert.equal(f.requests.length, 1, 'the next genuine sample establishes the real config')
  await f.answer(0)
  assert.equal(f.selected, B.path)
})

test('checkout invalidation fences discovery until a fresh post-reset query tick', async (t) => {
  const f = setup(t), pill = Symbol('pill')
  f.observe(pill, A.root, true, false)
  await f.answer(0)
  const list = f.checkout.getSnapshot().list
  f.checkout.invalidate()
  assert.equal(f.checkout.getSnapshot().list, list)
  assert.equal(f.checkout.getSnapshot().ready, false)
  await drain()
  assert.equal(f.requests.length, 1, 'reset does not immediately query under the old config')
  f.publish({ state: 'ready', snapshot: { root: MAIN.root, checkedAt: 1, followSessionCheckout: true } }, A.path, false)
  f.observe(pill, B.root, true, false)
  await drain()
  assert.equal(f.requests.length, 1, 'cache replay cannot release the reset fence')
  assert.equal(f.selected, A.path)
  f.config({})
  await drain()
  assert.equal(f.requests.length, 2, 'the next real sample releases exactly one list read')
  await f.answer(1)
  assert.equal(f.selected, B.path)
})

test('inactive copies and active surfaces without a projection cannot overwrite the active directory', async (t) => {
  const f = setup(t), pill = Symbol('pill'), hidden = Symbol('hidden'), unprojected = Symbol('unprojected')
  f.observe(pill, A.root, true, false)
  f.observe(hidden, B.root, false)
  f.observe(unprojected, null)
  await f.answer(0)
  assert.equal(f.selected, A.path)
  f.observe(hidden, MAIN.root, false)
  f.config({})
  assert.equal(f.selected, A.path)
  await drain()
  assert.equal(f.requests.length, 1)
  f.observe(pill, B.root, true, false)
  assert.equal(f.selected, B.path)
  f.checkout.release(hidden)
  f.checkout.release(unprojected)
  assert.equal(f.selected, B.path)
})

test('a mounted panel becoming visible invalidates discovery even while its pill stays active', async (t) => {
  const f = setup(t), pill = Symbol('pill'), panel = Symbol('panel')
  f.observe(pill, A.root, true, false)
  f.observe(panel, A.root)
  await f.answer(0)
  f.observe(panel, A.root, false)
  await drain()
  assert.equal(f.requests.length, 1, 'hiding a panel does not start a scan')
  f.observe(panel, A.root)
  await drain()
  assert.equal(f.requests.length, 2, 'returning to the selector refreshes rows independently of pill visibility')
  assert.equal(f.selected, A.path)
  await f.answer(1, [...ROWS, C])
  assert.equal(f.checkout.getSnapshot().list.repos.some((entry) => entry.path === C.path), true)
  f.observe(pill, C.root, true, false)
  assert.equal(f.selected, C.path)
  await drain()
  assert.equal(f.requests.length, 2, 'the newly discovered exact row needs no further scan')
})

test('released or invisible owners ignore late replies and a replacement owner gets a fresh read', async (t) => {
  for (const mode of ['release', 'hide']) {
    await t.test(mode, async (t) => {
      const f = setup(t), owner = Symbol('old'), replacement = Symbol('new')
      let publications = 0
      t.after(f.checkout.subscribe(() => { publications++ }))
      f.observe(owner, A.root, true, false)
      await drain()
      if (mode === 'release') f.checkout.release(owner)
      else f.observe(owner, A.root, false, false)
      await drain()
      assert.equal(f.requests[0].signal.aborted, true)
      await f.answer(0)
      assert.equal(publications, 0)
      assert.equal(f.checkout.getSnapshot().list, null)
      assert.equal(f.selected, '')
      f.observe(replacement, B.root, true, false)
      await drain()
      assert.equal(f.requests.length, 2)
      await f.answer(1)
      assert.equal(f.selected, B.path)
      assert.equal(publications, 1)
    })
  }
})

test('disposal ignores late replies, new observations and selection notifications', async (t) => {
  const f = setup(t), pill = Symbol('pill')
  let publications = 0
  f.checkout.subscribe(() => { publications++ })
  f.observe(pill, A.root, true, false)
  await drain()
  f.checkout.dispose()
  await drain()
  assert.equal(f.requests[0].signal.aborted, true)
  await f.answer(0)
  f.config({}); f.pick(SITE.path)
  f.observe(Symbol('late'), B.root)
  f.checkout.refetch()
  await drain()
  assert.equal(f.requests.length, 1)
  assert.equal(f.checkout.getSnapshot().list, null)
  assert.equal(publications, 0)
  assert.deepEqual(f.switches, [], 'disposed owner no longer aligns or follows selections')
})

test('a detection config change supersedes in-flight discovery and ignores its late result', async (t) => {
  const f = setup(t), panel = Symbol('panel')
  f.observe(panel, A.root)
  await drain()
  f.config({ detectCheckouts: false })
  await drain()
  assert.equal(f.requests.length, 2)
  await drain()
  assert.equal(f.requests[0].signal.aborted, true)
  await f.answer(0, [MAIN])
  assert.equal(f.checkout.getSnapshot().list, null)
  assert.equal(f.selected, '')
  await f.answer(1)
  assert.equal(f.selected, A.path)
  f.config({ repoLimit: 2 })
  await drain()
  assert.equal(f.requests.length, 3, 'limit changes invalidate the shared list too')
  await f.answer(2)
  assert.deepEqual(f.switches, [A.path])
})

test('an error sampled for a previous selector cannot repair the current manual pick', async (t) => {
  const f = setup(t), panel = Symbol('panel')
  f.observe(panel, A.root)
  await f.answer(0)
  f.pick(SITE.path)
  f.publish({ state: 'error', error: { code: 'invalid-repo' } }, A.path)
  assert.equal(f.selected, SITE.path)
  assert.equal(f.record.repo, SITE.path)
  assert.equal(f.git.getRepo(), SITE.path)
  f.publish({ state: 'error', error: { code: 'transport' } }, SITE.path)
  assert.equal(f.selected, SITE.path, 'a current transport failure is not selector refusal either')
  assert.equal(f.record.repo, SITE.path)
})

test("another session's pick cannot revive the selection a directory move released", async (t) => {
  const f = setup(t), pill = Symbol('pill')
  f.observe(pill, MAIN.root, true, false)
  await f.answer(0)
  f.pick(SITE.path)
  await drain()
  assert.equal(f.git.getRepo(), SITE.path, 'the manual pick is applied')
  // The directory moves into a worktree the current list does not name yet: the
  // decision asks for one fresh list and keeps the pick meanwhile.
  f.observe(pill, C.root, true, false)
  await drain()
  assert.equal(f.requests.length, 2, 'the unknown directory asks for one fresh list')
  assert.equal(f.selected, SITE.path, 'the pick stays until the new list lands')
  // Another session clicks a row while this scan is in flight. The broadcast
  // reaches this controller, the intent does not.
  selectRepo('checkout-controller-other', 'other')
  await drain()
  await f.answer(1, [MAIN, A, B, C, SITE])
  assert.equal(f.selected, C.path, "another session's pick cannot keep this session on the released row")
  assert.equal(f.git.getRepo(), C.path, 'the follow reaches the controller')
})
