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

/** A clipboard supplier the panel supplies in the real wiring. */
function stubClipboard(result = true) {
  const writes = []
  const write = async (text) => { writes.push(text); return result }
  return { writes, write }
}

const t = (key) => key

const FACTS = { isGit: false, revDiff: false, pathHistory: false }
const CALLBACKS = { compareRevision: () => {}, compareRef: () => {}, showHistory: () => {}, quote: () => {} }
const envWith = (menus, facts = FACTS, writeClipboard = stubClipboard().write) => ({ t, menus, facts, callbacks: CALLBACKS, writeClipboard })

function value(overrides = {}) {
  return { sessionId: 's', owner: 'o', repo: '', path: 'src/a.ts', root: '/work', ignored: false, ...overrides }
}

const platform = [{ id: 'open-in-app.file/float', label: 'Float' }]

test('without a composer the browser adds nothing of its own', () => {
  // The absolute "copy path" is the platform's; a second, relative copy of the
  // same path was removed as a duplicate. What is left is the composer entry,
  // which the platform cannot offer.
  const actions = fileMenuActions(value(), envWith(undefined), platform)
  assert.deepEqual(actions.map((a) => a.id), ['open-in-app.file/float'])
})

test('the root row and a directory have no browser entries of their own', () => {
  assert.deepEqual(directoryMenuActions(value({ path: '' }), envWith(undefined), []), [])
  assert.deepEqual(directoryMenuActions(value({ path: 'src/ui' }), envWith(undefined), []), [])
})

test('the composer entry hands the path to the panel, not to the clipboard', async () => {
  const quoted = []
  const clipboard = stubClipboard()
  const env = envWith(undefined, { ...FACTS, canQuote: true }, clipboard.write)
  env.callbacks = { ...CALLBACKS, quote: (text) => quoted.push(text) }
  const [quote] = fileMenuActions(value(), env, [])
  await quote.run()
  assert.deepEqual(quoted, ['src/a.ts'])
  assert.deepEqual(clipboard.writes, [], 'the entry is not a copy')
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

test('a thunk value is handed to the platform as a function target', () => {
  const seen = []
  const factory = menuTriggerFactory(() => ({
    getTriggerProps: (target) => { seen.push(target); return {} },
  }))
  factory.bind('gitPanel.file', () => ({ sessionId: 's', owner: 'o', repo: '', path: 'a.ts', root: null, ignored: false }))
  assert.equal(typeof seen[0], 'function', 'the platform must be able to defer the capture')
  assert.deepEqual(seen[0](), {
    kind: 'gitPanel.file',
    value: { sessionId: 's', owner: 'o', repo: '', path: 'a.ts', root: null, ignored: false },
  })
})

test('a composer on the host adds the quote entry after the platform group', () => {
  const quoted = []
  const env = envWith(undefined, { ...FACTS, canQuote: true })
  env.callbacks = { ...CALLBACKS, quote: (text) => quoted.push(text) }
  const actions = fileMenuActions(value(), env, platform)
  assert.deepEqual(actions.map((a) => a.id), ['open-in-app.file/float', 'quote-path'])
  void actions[1].run()
  assert.deepEqual(quoted, ['src/a.ts'])
})

test('without a composer the quote entry is absent (not disabled)', () => {
  const actions = fileMenuActions(value(), envWith(undefined), platform)
  assert.ok(!actions.some((a) => a.id === 'quote-path'))
})

test('the root row quotes nothing: it has no path', () => {
  const env = envWith(undefined, { ...FACTS, canQuote: true })
  const actions = directoryMenuActions(value({ path: '' }), env, [])
  assert.deepEqual(actions, [])
})
