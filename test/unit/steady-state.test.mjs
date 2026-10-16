import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GitController, createVisibilitySource } from '../../lib/testkit.mjs'

const snapshot = { root: '/fixture', refreshIntervalMs: 30_000, checkedAt: 1, changes: [] }
const ok = (value = snapshot) => ({ ok: true, value })
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup(t, hidden = false, response = async () => ok()) {
  let now = 0, id = 0, calls = 0, notifications = 0
  const timers = new Map()
  const events = new Set()
  const originalSet = globalThis.setTimeout
  const originalClear = globalThis.clearTimeout
  globalThis.setTimeout = (fn, delay = 0) => {
    const timer = ++id
    timers.set(timer, { at: now + delay, fn })
    return timer
  }
  globalThis.clearTimeout = (timer) => { timers.delete(timer) }
  const document = {
    hidden,
    addEventListener: (_, listener) => events.add(listener),
    removeEventListener: (_, listener) => events.delete(listener),
  }
  const visibility = createVisibilitySource(() => document)
  const remote = { snapshot: () => { calls++; return response(calls) } }
  const controller = new GitController(remote, 's', visibility)
  controller.subscribe(() => { notifications++ })
  t.after(() => {
    controller.dispose()
    globalThis.setTimeout = originalSet
    globalThis.clearTimeout = originalClear
  })
  return {
    controller, visibility, remote,
    get calls() { return calls },
    get notifications() { return notifications },
    get timers() { return timers.size },
    get eventListeners() { return events.size },
    hide() { document.hidden = true; for (const listener of [...events]) listener() },
    show() { document.hidden = false; for (const listener of [...events]) listener() },
    async advance(ms) {
      const end = now + ms
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = next[1].at
        timers.delete(next[0])
        next[1].fn()
        await drain()
      }
      now = end
    },
  }
}

test('controller defers initial hidden ensure/resync and restores with one request', async (t) => {
  const h = setup(t, true)
  h.controller.ensure()
  h.controller.resync()
  h.controller.resync()
  await h.advance(90_000)
  assert.equal(h.calls, 0)
  assert.equal(h.timers, 0)
  assert.equal(h.controller.getSnapshot().state, 'cold')
  h.show()
  await drain()
  assert.equal(h.calls, 1)
  assert.equal(h.controller.getSnapshot().state, 'ready')
  assert.equal(h.timers, 1)
  h.show() // Duplicate DOM notification is not another catch-up.
  await drain()
  assert.equal(h.calls, 1)
})

test('controller polls after completion, clears pending timers on manual resync and on hide', async (t) => {
  const h = setup(t)
  h.controller.ensure()
  await drain()
  await h.advance(30_000)
  assert.equal(h.calls, 2)
  h.controller.resync()
  await drain()
  assert.equal(h.calls, 3)
  assert.equal(h.timers, 1)
  h.hide()
  await h.advance(90_000)
  assert.equal(h.calls, 3)
  assert.equal(h.timers, 0)
  h.show()
  await drain()
  assert.equal(h.calls, 4)
})

test('controller does not start a queued trailing refresh when the in-flight request completes hidden', async (t) => {
  const gate = deferred()
  const h = setup(t, false, (n) => n === 1 ? gate.promise : Promise.resolve(ok()))
  h.controller.ensure()
  h.controller.resync()
  h.controller.resync()
  h.hide()
  gate.resolve(ok())
  await drain()
  assert.equal(h.calls, 1)
  assert.equal(h.timers, 0)
  assert.equal(h.controller.getSnapshot().state, 'ready')
  h.show()
  await drain()
  assert.equal(h.calls, 2)
  assert.equal(h.timers, 1)
})

test('controller coalesces restore during an old in-flight request into one trailing catch-up', async (t) => {
  const gate = deferred()
  const h = setup(t, false, (n) => n === 1 ? gate.promise : Promise.resolve(ok()))
  h.controller.ensure()
  h.hide()
  h.show()
  h.controller.resync()
  assert.equal(h.calls, 1)
  gate.resolve(ok())
  await drain()
  assert.equal(h.calls, 2)
  assert.equal(h.timers, 1)
})

test('accept publishes while hidden without scheduling or fetching', async (t) => {
  const h = setup(t, true)
  const accepted = { ...snapshot, checkedAt: 2 }
  h.controller.accept(accepted)
  assert.equal(h.controller.getSnapshot().snapshot, accepted)
  assert.equal(h.calls, 0)
  assert.equal(h.timers, 0)
  h.show()
  await drain()
  assert.equal(h.calls, 1)
})

test('hidden transport failure does not restart polling and recovers when visible', async (t) => {
  const gate = deferred()
  const h = setup(t, false, (n) => n === 1 ? gate.promise : Promise.resolve(ok()))
  h.controller.ensure()
  h.hide()
  gate.reject(new Error('connection lost'))
  await drain()
  assert.equal(h.controller.getSnapshot().state, 'error')
  assert.equal(h.timers, 0)
  h.show()
  await drain()
  assert.equal(h.controller.getSnapshot().state, 'ready')
  assert.equal(h.calls, 2)
})

test('no-cwd and cancelled responses do not escape visibility gating', async (t) => {
  const results = [
    { ok: false, error: { code: 'cwd-unavailable', sessionId: 's' } },
    { ok: false, error: { code: 'cancelled' } },
    ok(),
  ]
  const h = setup(t, false, async () => results.shift())
  h.controller.ensure()
  await drain()
  assert.equal(h.controller.getSnapshot().state, 'no-cwd')
  h.hide()
  h.controller.ensure()
  await h.advance(120_000)
  assert.equal(h.calls, 1)
  h.show()
  await drain()
  assert.equal(h.calls, 2)
  await h.advance(60_000)
  assert.equal(h.calls, 3)
  assert.equal(h.controller.getSnapshot().state, 'ready')
})

test('dispose clears visibility/timer subscriptions and ignores in-flight completion', async (t) => {
  const gate = deferred()
  const h = setup(t, false, () => gate.promise)
  h.controller.ensure()
  h.controller.resync()
  const before = h.notifications
  h.controller.dispose()
  h.hide()
  h.show()
  gate.resolve(ok())
  await drain()
  await h.advance(120_000)
  h.controller.resync()
  h.controller.accept(snapshot)
  assert.equal(h.calls, 1)
  assert.equal(h.notifications, before)
  assert.equal(h.timers, 0)
  assert.equal(h.eventListeners, 0)
})

test('visibility source shares one DOM listener and releases it after the last controller', async (t) => {
  const h = setup(t)
  const second = new GitController(h.remote, 'other', h.visibility)
  t.after(() => second.dispose())
  assert.equal(h.eventListeners, 1)
  second.dispose()
  assert.equal(h.eventListeners, 1)
  h.controller.dispose()
  assert.equal(h.eventListeners, 0)
})

test('visibility source without document remains visible and subscribes safely', () => {
  const source = createVisibilitySource(() => undefined)
  assert.equal(source.isVisible(), true)
  const unsubscribe = source.subscribe(() => assert.fail('no DOM events'))
  unsubscribe()
  unsubscribe()
})
