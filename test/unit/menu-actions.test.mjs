/**
 * The file browser's own menu entries and the trigger binding the rows use.
 *
 * The platform group is passed in by the caller (menu-proxy.test.mjs pins its
 * projection); these tests pin what the panel adds and in what order, plus the
 * fallback that keeps the native menu on hosts without the menu package.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NO_MENU, menuTriggerFactory, fileMenuActions, directoryMenuActions } from '../../lib/testkit.mjs'

function stubNavigator() {
  const writes = []
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async (text) => { writes.push(text) } } },
    configurable: true,
    writable: true,
  })
  return writes
}

const t = (key) => key

function value(overrides = {}) {
  return { sessionId: 's', owner: 'o', repo: '', path: 'src/a.ts', root: '/work', ignored: false, ...overrides }
}

const platform = [{ id: 'open-in-app.file/float', label: 'Float' }]

test('the platform group comes first, then the browser entries', () => {
  const actions = fileMenuActions(value(), { t, menus: undefined }, platform)
  assert.deepEqual(actions.map((a) => a.id), ['open-in-app.file/float', 'copy-relative-path'])
  assert.deepEqual(actions.map((a) => a.label), ['Float', 'menu.copyRelativePath'])
})

test('the root row has no relative path to copy', () => {
  const actions = directoryMenuActions(value({ path: '' }), { t, menus: undefined }, [])
  assert.deepEqual(actions, [])
})

test('a directory row offers its relative path', () => {
  const actions = directoryMenuActions(value({ path: 'src/ui' }), { t, menus: undefined }, [])
  assert.deepEqual(actions.map((a) => a.id), ['copy-relative-path'])
})

test('copying the relative path writes the tree path and confirms through the toast', async () => {
  const writes = stubNavigator()
  const notices = []
  const menus = { notify: (text, success) => { notices.push({ text, success }) } }
  const actions = fileMenuActions(value(), { t, menus }, [])
  await actions[0].run()
  assert.deepEqual(writes, ['src/a.ts'])
  assert.deepEqual(notices, [{ text: 'menu.copied', success: true }])
})

test('a rejected copy surfaces through the action failure label', async () => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async () => { throw new Error('denied') } } },
    configurable: true,
    writable: true,
  })
  const actions = fileMenuActions(value(), { t, menus: undefined }, [])
  assert.equal(actions[0].failureLabel, 'menu.copyFailed')
  await assert.rejects(() => actions[0].run(), /denied/)
})

test('NO_MENU hands the row its own handlers back untouched', () => {
  const onClick = () => {}
  const handlers = { tabIndex: -1, onKeyDown: onClick }
  assert.deepEqual(NO_MENU.bind('gitPanel.file', value(), handlers), handlers)
  assert.deepEqual(NO_MENU.bind('gitPanel.file', value()), {})
})

test('the factory without the platform hook is the no-menu fallback', () => {
  assert.equal(menuTriggerFactory(undefined), NO_MENU)
  assert.equal(menuTriggerFactory(() => ({})), NO_MENU)
})

test('the factory binds the captured kind and value and keeps the row handlers', () => {
  const seen = []
  const factory = menuTriggerFactory(() => ({
    getTriggerProps: (target, handlers) => { seen.push({ target, handlers }); return { ...handlers, tabIndex: 0 } },
  }))
  const handlers = { tabIndex: -1 }
  const bound = factory.bind('gitPanel.directory', value({ path: 'src' }), handlers)
  assert.deepEqual(seen[0].target, {
    kind: 'gitPanel.directory',
    value: value({ path: 'src' }),
  })
  assert.equal(seen[0].handlers, handlers)
  assert.equal(bound.tabIndex, 0, 'the platform decides the final tab stop')
})
