import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount } from './_hook-harness.mjs'
import { bindContext, controllerFor, disposeAll, pageVisibility, useGitQuerySignal, useGitView } from '../../lib/hookkit.mjs'

const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const IDLE_MS = 60_000

function setup(t) {
  disposeAll()
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  let subscriptions = 0
  const subscribe = pageVisibility.subscribe
  pageVisibility.subscribe = (listener) => {
    subscriptions++
    const unsubscribe = subscribe(listener)
    return () => { subscriptions--; unsubscribe() }
  }
  bindContext({ get: () => ({ rpc: {
    call: async (_, endpoint, { args: { request } }) => {
      assert.equal(endpoint, 'gitPanel/snapshot')
      calls++
      return { ok: true, value: { ok: true, value: {
        root: `/${request.sessionId}`, checkedAt: calls, stateFingerprint: 'same',
        refreshIntervalMs: 300_000, changes: [],
      } } }
    },
  } }) })
  const mounts = []
  t.after(() => {
    for (const h of mounts) h.unmount()
    disposeAll()
    pageVisibility.subscribe = subscribe
    t.mock.timers.reset()
  })
  return {
    get calls() { return calls },
    get subscriptions() { return subscriptions },
    mount(hook) { const h = mount(hook, { autoRender: true }); mounts.push(h); return h },
    async advance(ms) { t.mock.timers.tick(ms); await drain() },
  }
}

test('a visible query leaf alone starts and retains its controller beyond the idle deadline', async (t) => {
  const f = setup(t)
  const h = f.mount(() => useGitQuerySignal('s', true, '/s'))
  const controller = controllerFor('s')
  await drain()
  assert.equal(f.calls, 1, 'query hook does not depend on a Panel business subscription')
  assert.equal(h.value.queryVisible, true)
  assert.equal(h.value.signal.tick, 1)
  await f.advance(IDLE_MS * 2)
  assert.equal(controllerFor('s'), controller)
  h.unmount()
  await f.advance(IDLE_MS - 1)
  assert.equal(controllerFor('s'), controller)
  await f.advance(1)
  assert.notEqual(controllerFor('s'), controller, 'last subscriber releases the controller after the grace period')
})

test('visible toggles cancel idle disposal and hidden leaves release their reference', async (t) => {
  const f = setup(t)
  let visible = true
  const h = f.mount(() => useGitQuerySignal('s', visible, '/s'))
  await drain()
  const controller = controllerFor('s')
  visible = false; h.rerender()
  await f.advance(IDLE_MS - 1)
  visible = true; h.rerender()
  await f.advance(IDLE_MS)
  assert.equal(controllerFor('s'), controller, 'reactivation cancels the earlier idle timer')
  visible = false; h.rerender()
  await f.advance(IDLE_MS)
  assert.notEqual(controllerFor('s'), controller, 'hidden query leaf no longer retains the controller')
})

test('inactive leaves do not create orphan controllers before activation or after idle disposal', async (t) => {
  const f = setup(t)
  let visible = false
  const h = f.mount(() => useGitQuerySignal('s', visible, '/s'))
  await drain()
  assert.equal(f.subscriptions, 0, 'initial hidden leaf creates no controller visibility subscription')
  assert.equal(f.calls, 0)
  h.rerender(); await drain()
  assert.equal(f.subscriptions, 0)
  visible = true; h.rerender(); await drain()
  assert.equal(f.subscriptions, 1)
  assert.equal(f.calls, 1)
  visible = false; h.rerender()
  await f.advance(IDLE_MS)
  assert.equal(f.subscriptions, 0, 'idle controller releases its visibility subscription')
  h.rerender(); await drain()
  assert.equal(f.subscriptions, 0, 'hidden rerender cannot recreate an unretained controller')
  assert.equal(f.calls, 1)
  visible = true; h.rerender(); await drain()
  assert.equal(f.subscriptions, 1)
  assert.equal(f.calls, 2, 'activation starts exactly one replacement controller')
})

test('query and business subscribers share one fetch and balance their references independently', async (t) => {
  const f = setup(t)
  const view = f.mount(() => useGitView('s'))
  const query = f.mount(() => useGitQuerySignal('s', true, '/s'))
  await drain()
  assert.equal(f.calls, 1, 'two mounting hooks do not queue a duplicate initial snapshot')
  const controller = controllerFor('s')
  query.unmount()
  await f.advance(IDLE_MS)
  assert.equal(controllerFor('s'), controller, 'business subscriber still retains the controller')
  view.unmount()
  await f.advance(IDLE_MS)
  assert.notEqual(controllerFor('s'), controller)
})

test('switching session releases the old controller and retains only the new session', async (t) => {
  const f = setup(t)
  let sid = 'old'
  const h = f.mount(() => useGitQuerySignal(sid, true, `/${sid}`))
  await drain()
  const old = controllerFor('old')
  sid = 'next'; h.rerender(); await drain()
  const next = controllerFor('next')
  assert.equal(h.value.signal.root, '/next')
  await f.advance(IDLE_MS)
  assert.notEqual(controllerFor('old'), old)
  assert.equal(controllerFor('next'), next)
})

test('plugin teardown clears idle timers and stale hook cleanup cannot release a replacement controller', async (t) => {
  const f = setup(t)
  const idle = f.mount(() => useGitQuerySignal('idle', true, '/idle'))
  const stale = f.mount(() => useGitQuerySignal('s', true, '/s'))
  await drain()
  idle.unmount()
  disposeAll()
  const replacementIdle = controllerFor('idle')
  const current = f.mount(() => useGitQuerySignal('s', true, '/s'))
  await drain()
  const replacement = controllerFor('s')
  stale.unmount()
  await f.advance(IDLE_MS * 2)
  assert.equal(controllerFor('idle'), replacementIdle, 'teardown cancels an old idle callback')
  assert.equal(controllerFor('s'), replacement, 'stale cleanup cannot decrement the replacement reference')
  assert.equal(current.value.queryVisible, true)
})
