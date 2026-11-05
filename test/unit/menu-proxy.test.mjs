/**
 * Platform action proxy: the whitelist decides which of the platform's own menu
 * entries appear under a git-panel target, and a click is forwarded by id to a
 * fresh resolution (the platform disposes the occurrence that built the menu
 * before it runs the action).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DIRECTORY_VIEWS, FILE_VIEWS, IMAGE_VIEWS, platformActions } from '../../lib/testkit.mjs'

/** A stand-in `contextMenus` service holding one canned action list. */
function fakeService(views, options = {}) {
  const calls = { resolve: 0, select: [], dispose: 0 }
  const service = {
    register: () => () => {},
    notify: () => {},
    close: () => {},
    resolve: (target) => {
      calls.resolve += 1
      const state = { target, views: typeof views === 'function' ? views(calls.resolve) : views }
      return {
        source: { getSnapshot: () => state.views },
        ready: options.ready ?? Promise.resolve(),
        select: (id) => { calls.select.push({ id, target: state.target, views: state.views }) },
        dispose: () => { calls.dispose += 1 },
      }
    },
  }
  return { service, calls }
}

const target = { kind: 'file', value: { sessionId: 's', path: '/work/a.ts' } }

test('platformActions keeps the whitelisted ids and drops the rest', async () => {
  const { service } = fakeService([
    { id: 'open-in-app.file/sidebar', label: 'Open in sidebar' },
    { id: 'open-in-app.file/float', label: 'Open in floating pane' },
    { id: 'open-in-app.file/copyPath', label: 'Copy path' },
    { id: 'file-actions.file/download', label: 'Download' },
  ])
  const actions = await platformActions(service, target, FILE_VIEWS, new AbortController().signal)
  assert.deepEqual(actions.map((a) => a.id), [
    'open-in-app.file/float',
    'open-in-app.file/copyPath',
    'file-actions.file/download',
  ])
})

test('the file whitelist never carries "open in sidebar"', () => {
  assert.ok(!FILE_VIEWS.includes('open-in-app.file/sidebar'))
  // Every kept id belongs to a contribution the platform registers for `file`.
  for (const id of FILE_VIEWS) assert.match(id, /^(?:open-in-app\.file|file-actions\.file)\//)
  for (const id of DIRECTORY_VIEWS) assert.match(id, /^open-in-app\.directory\//)
  for (const id of IMAGE_VIEWS) assert.match(id, /^file-actions\.image\//)
})

test('platformActions copies the label, icon, disabled and danger flags', async () => {
  const { service } = fakeService([
    { id: 'open-in-app.file/open', label: 'Open with Code', disabled: true, danger: true, icon: { key: 'open-in-app.application', src: 'data:image/png;base64,AA' } },
  ])
  const [action] = await platformActions(service, target, FILE_VIEWS, new AbortController().signal)
  assert.equal(action.label, 'Open with Code')
  assert.equal(action.disabled, true)
  assert.equal(action.danger, true)
  assert.deepEqual(action.icon, { key: 'open-in-app.application', src: 'data:image/png;base64,AA' })
})

test('a click dispatches through the occurrence that built the menu', async () => {
  const controller = new AbortController()
  const { service, calls } = fakeService([{ id: 'open-in-app.file/float', label: 'Float' }])
  const [action] = await platformActions(service, target, FILE_VIEWS, controller.signal)
  await action.run()
  assert.deepEqual(calls.select.map((s) => s.id), ['open-in-app.file/float'])
  // One resolution for the menu and none for the click: the platform's whole
  // face (workspace stat, application probe) is not asked twice.
  assert.equal(calls.resolve, 1)
  // The occurrence is released once the click has been dispatched.
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(calls.dispose, 1)
})

test('a click after the menu is gone resolves again and reports a withdrawn id', async () => {
  const controller = new AbortController()
  let n = 0
  const { service, calls } = fakeService(() => (++n === 1 ? [{ id: 'open-in-app.file/float', label: 'Float' }] : []))
  const [action] = await platformActions(service, target, FILE_VIEWS, controller.signal)
  controller.abort()
  await assert.rejects(() => action.run(), /menu action unavailable/)
  assert.equal(calls.resolve, 2, 'the released occurrence is replaced for the click')
})

test('platformActions returns what is ready when the platform misses the budget', async () => {
  const never = new Promise(() => {})
  const aborted = new AbortController()
  const { service, calls } = fakeService([], { ready: never })
  const started = Date.now()
  const actions = await platformActions(service, target, FILE_VIEWS, aborted.signal, 20)
  assert.deepEqual(actions, [])
  assert.ok(Date.now() - started < 500, 'the budget bounds the wait')
  // The occurrence is held for a possible click and released with the menu; a
  // list nobody opens must not leak one.
  aborted.abort()
  assert.equal(calls.dispose, 1, 'the released occurrence is disposed with the menu')
})

test('an aborted lifetime returns no actions', async () => {
  const { service } = fakeService([{ id: 'open-in-app.file/float', label: 'Float' }])
  const aborted = new AbortController()
  aborted.abort()
  assert.deepEqual(await platformActions(service, target, FILE_VIEWS, aborted.signal), [])
})

test('a rejected preparation degrades to no platform group', async () => {
  const { service } = fakeService([], { ready: Promise.reject(new Error('boom')) })
  assert.deepEqual(await platformActions(service, target, FILE_VIEWS, new AbortController().signal), [])
})

test('a submenu is kept whole under a whitelisted parent', async () => {
  const { service } = fakeService([{
    id: 'open-in-app.file/open',
    label: 'Open with…',
    children: [{ id: 'open-in-app.file/open/code', label: 'Code' }],
  }])
  const [action] = await platformActions(service, target, FILE_VIEWS, new AbortController().signal)
  assert.equal(action.label, 'Open with…')
  assert.deepEqual(action.children.map((c) => c.id), ['open-in-app.file/open/code'])
})
