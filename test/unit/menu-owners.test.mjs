/**
 * Menu ownership: contributions resolve actions against the panel instance that
 * raised the gesture, and an unmounted owner contributes nothing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MENU_KINDS, registerMenuOwner, menuOwner, disposeMenuOwners } from '../../lib/testkit.mjs'
import { registerGitMenus, MENU_CONTRIBUTION_IDS } from '../../lib/testkit.mjs'

function reset() {
  disposeMenuOwners()
}

test('registerMenuOwner publishes and disposes one owner', () => {
  reset()
  const owner = { observe: () => [], actionsFor: () => [] }
  const dispose = registerMenuOwner('p1', owner)
  assert.equal(menuOwner('p1'), owner)
  dispose()
  assert.equal(menuOwner('p1'), undefined)
})

test('a stale dispose (owner replaced) does not remove the replacement', () => {
  reset()
  const first = { observe: () => [], actionsFor: () => [] }
  const second = { observe: () => [], actionsFor: () => [] }
  const disposeFirst = registerMenuOwner('p1', first)
  registerMenuOwner('p1', second)
  disposeFirst()
  assert.equal(menuOwner('p1'), second, 'the second mount keeps its registration')
})

test('two owners never answer for each other', () => {
  reset()
  registerMenuOwner('a', { observe: () => [], actionsFor: () => [{ id: 'a', label: 'A' }] })
  registerMenuOwner('b', { observe: () => [], actionsFor: () => [{ id: 'b', label: 'B' }] })
  const a = menuOwner('a')
  const b = menuOwner('b')
  assert.deepEqual(a.actionsFor('gitPanel.file', {}, new AbortController().signal), [{ id: 'a', label: 'A' }])
  assert.deepEqual(b.actionsFor('gitPanel.file', {}, new AbortController().signal), [{ id: 'b', label: 'B' }])
})

test('registerGitMenus contributes one entry per declared kind', () => {
  reset()
  const registered = []
  const menus = { register: (c) => { registered.push(c); return () => {} } }
  const release = registerGitMenus(menus)
  assert.deepEqual(registered.map((c) => c.target), MENU_KINDS.slice())
  for (const contribution of registered) {
    assert.equal(contribution.id, MENU_CONTRIBUTION_IDS[contribution.target])
    assert.equal(contribution.order, 100)
  }
  release()
})

test('resolve walks the captured owner id back to its panel', async () => {
  reset()
  let asked = null
  const owner = {
    observe: () => [],
    actionsFor: (kind, value) => { asked = { kind, value }; return [{ id: 'x', label: 'X' }] },
  }
  registerMenuOwner('panel-7', owner)
  const registered = []
  registerGitMenus({ register: (c) => { registered.push(c); return () => {} } })
  const file = registered.find((c) => c.target === 'gitPanel.file')
  const value = { sessionId: 's', owner: 'panel-7', repo: '', path: 'a.ts', root: '/w', ignored: false }
  const actions = await file.resolve(value, new AbortController().signal)
  assert.deepEqual(actions, [{ id: 'x', label: 'X' }])
  assert.equal(asked.kind, 'gitPanel.file')
  assert.equal(asked.value, value)
})

test('an unmounted owner resolves to no actions (no surviving copy answers)', async () => {
  reset()
  registerMenuOwner('gone', { observe: () => [], actionsFor: () => [{ id: 'x', label: 'X' }] })
  const registered = []
  registerGitMenus({ register: (c) => { registered.push(c); return () => {} } })
  const file = registered.find((c) => c.target === 'gitPanel.file')
  const value = { sessionId: 's', owner: 'other-panel', repo: '', path: 'a.ts', root: '/w', ignored: false }
  assert.deepEqual(await file.resolve(value, new AbortController().signal), [])
})

test('observe follows the captured owner, not every panel', () => {
  reset()
  const source = { subscribe: () => () => {} }
  const sources = [source]
  registerMenuOwner('with', { observe: () => sources, actionsFor: () => [] })
  registerMenuOwner('without', { observe: () => [], actionsFor: () => [] })
  const registered = []
  registerGitMenus({ register: (c) => { registered.push(c); return () => {} } })
  const file = registered.find((c) => c.target === 'gitPanel.file')
  assert.deepEqual(file.observe({ owner: 'with' }), sources)
  assert.deepEqual(file.observe({ owner: 'without' }), [])
  assert.deepEqual(file.observe({ owner: 'unmounted' }), [])
})
