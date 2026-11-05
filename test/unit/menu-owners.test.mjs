/**
 * Menu ownership: contributions resolve actions against the panel instance that
 * raised the gesture, and an unmounted owner contributes nothing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MENU_KINDS, registerMenuOwner, menuOwner, disposeMenuOwners } from '../../lib/testkit.mjs'
import { registerGitMenus, MENU_CONTRIBUTION_IDS, MENU_KIND } from '../../lib/testkit.mjs'

function reset() {
  disposeMenuOwners()
}

test('registerMenuOwner publishes and disposes one owner', () => {
  reset()
  const owner = { observe: () => [], own: () => [], borrowed: async () => [] }
  const dispose = registerMenuOwner('p1', owner)
  assert.equal(menuOwner('p1'), owner)
  dispose()
  assert.equal(menuOwner('p1'), undefined)
})

test('a stale dispose (owner replaced) does not remove the replacement', () => {
  reset()
  const first = { observe: () => [], own: () => [], borrowed: async () => [] }
  const second = { observe: () => [], own: () => [], borrowed: async () => [] }
  const disposeFirst = registerMenuOwner('p1', first)
  registerMenuOwner('p1', second)
  disposeFirst()
  assert.equal(menuOwner('p1'), second, 'the second mount keeps its registration')
})

test('two owners never answer for each other', () => {
  reset()
  registerMenuOwner('a', { observe: () => [], own: () => [{ id: 'a', label: 'A' }], borrowed: async () => [] })
  registerMenuOwner('b', { observe: () => [], own: () => [{ id: 'b', label: 'B' }], borrowed: async () => [] })
  const a = menuOwner('a')
  const b = menuOwner('b')
  assert.deepEqual(a.own('gitPanel.file', {}), [{ id: 'a', label: 'A' }])
  assert.deepEqual(b.own('gitPanel.file', {}), [{ id: 'b', label: 'B' }])
})

test('registerGitMenus contributes one own entry per kind, plus the borrowed groups', () => {
  reset()
  const registered = []
  const menus = { register: (c) => { registered.push(c); return () => {} } }
  const release = registerGitMenus(menus)
  const own = registered.filter((c) => c.id === MENU_CONTRIBUTION_IDS[c.target])
  assert.deepEqual(own.map((c) => c.target), MENU_KINDS.slice(), 'every declared kind has its own contribution')
  for (const contribution of own) assert.equal(contribution.order, 100)
  // The families that borrow the platform's entries carry a second, async
  // contribution so a slow platform cannot take the plugin's group down.
  const borrowed = registered.filter((c) => c.id !== MENU_CONTRIBUTION_IDS[c.target])
  assert.deepEqual(borrowed.map((c) => c.target).sort(), ['gitPanel.directory', 'gitPanel.file', 'gitPanel.image', 'gitPanel.repos'])
  for (const contribution of borrowed) {
    assert.ok(contribution.id < MENU_CONTRIBUTION_IDS[contribution.target], 'the borrowed group sorts first')
    assert.equal(contribution.order, 100)
    assert.equal(contribution.observe, undefined, 'the borrowed group does not follow the snapshot')
  }
  release()
})

test('only the stateful families follow the panel snapshot', () => {
  reset()
  const registered = []
  registerGitMenus({ register: (c) => { registered.push(c); return () => {} } })
  const withObserve = registered.filter((c) => c.observe !== undefined).map((c) => c.target).sort()
  assert.deepEqual(withObserve, [
    MENU_KIND.branch, MENU_KIND.change, MENU_KIND.changeDir, MENU_KIND.commit,
  ].concat([MENU_KIND.pill, MENU_KIND.stash]).sort(), 'a tree row does not re-resolve on a poll')
})

test('resolve walks the captured owner id back to its panel', async () => {
  reset()
  let asked = null
  const owner = {
    observe: () => [],
    own: (kind, value) => { asked = { kind, value }; return [{ id: 'x', label: 'X' }] },
    borrowed: async () => [],
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
  registerMenuOwner('gone', { observe: () => [], own: () => [{ id: 'x', label: 'X' }], borrowed: async () => [] })
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
  registerMenuOwner('with', { observe: () => sources, own: () => [], borrowed: async () => [] })
  registerMenuOwner('without', { observe: () => [], own: () => [], borrowed: async () => [] })
  const registered = []
  registerGitMenus({ register: (c) => { registered.push(c); return () => {} } })
  // A tree row no longer re-resolves on a poll, so the observed family here is
  // the branch list (its entries disable while a write is in flight).
  const observed = registered.find((c) => c.target === MENU_KIND.branch)
  assert.deepEqual(observed.observe({ owner: 'with' }), sources)
  assert.deepEqual(observed.observe({ owner: 'without' }), [])
  assert.deepEqual(observed.observe({ owner: 'unmounted' }), [])
})
