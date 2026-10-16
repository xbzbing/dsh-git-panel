import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mount } from './_hook-harness.mjs'
import { GitController, useControllerQuerySignal } from '../../lib/hookkit.mjs'

const value = { root: '/fixture', checkedAt: 1, refreshIntervalMs: 30_000, stateFingerprint: 'same', changes: [] }
const visiblePage = { isVisible: () => true, subscribe: () => () => {} }
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

function fixture(t, root = '/fixture') {
  const controller = new GitController({ snapshot: async () => ({ ok: true, value: { ...value, root } }) }, 's', visiblePage)
  let subscribers = 0
  const subscribe = controller.subscribeQueries.bind(controller)
  controller.subscribeQueries = (fn) => {
    subscribers++
    const off = subscribe(fn)
    return () => { subscribers--; off() }
  }
  t.after(() => controller.dispose())
  return { controller, get subscribers() { return subscribers } }
}

test('query hook subscribes only while enabled and activation consumes the latest signal', async (t) => {
  const f = fixture(t)
  let enabled = false
  const h = mount(() => useControllerQuerySignal(f.controller, enabled))
  t.after(() => h.unmount())
  f.controller.ensure(); await drain(); await h.settle()
  assert.equal(f.subscribers, 0)
  enabled = true; h.rerender()
  assert.equal(f.subscribers, 1)
  assert.equal(h.value.tick, 1)
  assert.equal(h.value.ready, true)
  enabled = false; h.rerender()
  assert.equal(f.subscribers, 0)
  f.controller.accept({ ...value, checkedAt: 2 })
  enabled = true; h.rerender()
  assert.equal(h.value.sampledAt, 2)
  assert.equal(h.value.tick, 2)
  assert.equal(f.subscribers, 1)
  enabled = false; h.rerender()
  assert.equal(f.subscribers, 0)
})

test('a query notification schedules a leaf render without manual rerender or settle', async (t) => {
  const f = fixture(t)
  f.controller.ensure(); await drain()
  let renders = 0
  const h = mount(() => {
    renders++
    return useControllerQuerySignal(f.controller, true)
  }, { autoRender: true })
  t.after(() => h.unmount())
  const before = renders
  f.controller.accept({ ...value, checkedAt: 7 })
  await drain()
  assert.equal(renders, before + 1)
  assert.equal(h.value.sampledAt, 7)
  assert.equal(h.value.tick, 2)
  h.unmount()
  f.controller.accept({ ...value, checkedAt: 8 })
  await drain()
  assert.equal(renders, before + 1, 'unmounted subscribers do not render')
})

test('query hook reads the new controller synchronously on session switch', async (t) => {
  const old = fixture(t, '/old'), next = fixture(t, '/next')
  old.controller.ensure(); next.controller.ensure(); await drain()
  let controller = old.controller
  const h = mount(() => useControllerQuerySignal(controller, true))
  t.after(() => h.unmount())
  assert.equal(h.value.root, '/old')
  controller = next.controller; h.rerender()
  assert.equal(h.value.root, '/next')
  assert.equal(old.subscribers, 0)
  assert.equal(next.subscribers, 1)
  controller = undefined; h.rerender()
  assert.equal(h.value.ready, false)
  assert.equal(h.value.root, null)
  assert.equal(next.subscribers, 0)
})

test('query hook closes the render-to-subscribe gap without leaking listeners', async (t) => {
  const f = fixture(t)
  f.controller.ensure(); await drain()
  const subscribe = f.controller.subscribeQueries.bind(f.controller)
  let injected = false
  f.controller.subscribeQueries = (fn) => {
    if (!injected) {
      injected = true
      f.controller.accept({ ...value, checkedAt: 99 })
    }
    return subscribe(fn)
  }
  const h = mount(() => useControllerQuerySignal(f.controller, true), { autoRender: true })
  await drain()
  assert.equal(h.value.sampledAt, 99)
  assert.equal(h.value.tick, 2)
  assert.equal(f.subscribers, 1)
  h.unmount()
  assert.equal(f.subscribers, 0)
})
