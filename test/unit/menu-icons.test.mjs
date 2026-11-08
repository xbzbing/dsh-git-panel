/**
 * The icons the plugin's menu entries name.
 *
 * The platform paints an action by looking its `icon.key` up in the
 * `contextMenu.icon` slot, and has no fallback: a key nobody registered is an
 * entry that silently loses its glyph. These tests pin the two halves together —
 * every action's key is declared, and every declared key gets a component.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MENU_ICONS, menuIcon, registerMenuIcons, fileMenuActions, directoryMenuActions, branchMenuActions,
  commitMenuActions, changeMenuActions, changeDirMenuActions, stashMenuActions,
  repoRowMenuActions, pillMenuActions,
} from '../../lib/testkit.mjs'

const t = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)
const FACTS = { isGit: true, revDiff: true, pathHistory: true, canQuote: true }
const CALLBACKS = { compareRevision: () => {}, compareRef: () => {}, showHistory: () => {}, quote: () => {} }
const env = { t, menus: { notify: () => {} }, writeClipboard: async () => true, facts: FACTS, callbacks: CALLBACKS }
const identity = { sessionId: 's', owner: 'o', repo: '' }
const value = { ...identity, path: 'src/a.ts', root: '/work', ignored: false }

const overviewCommands = { switchBranch: () => {}, filterRef: () => {}, openTagCreate: () => {}, openBranchDelete: () => {}, openRemoteBranchDelete: () => {}, openBranchCreate: () => {}, openBranchMerge: () => {}, openCherryPick: () => {}, openRevert: () => {}, openReset: () => {}, quote: () => {} }
const changesCommands = { openDiff: () => {}, stage: () => {}, openDiscard: () => {}, stashApply: () => {}, stashPop: () => {}, openStashDrop: () => {} }
const reposCommands = { fetch: () => {} }
const pillCommands = { openTab: () => {}, fetch: () => {} }

/** Every menu this plugin can offer, kept as separate families: the position of
 * an entry is only meaningful inside the menu it belongs to. */
function everyMenu() {
  return [
    ['file', fileMenuActions(value, env, [{ id: 'open-in-app.file/float', label: 'x' }])],
    ['directory', directoryMenuActions(value, env, [])],
    ['branch', branchMenuActions({ ...identity, name: 'main', isCurrent: false, isRemote: false }, env, overviewCommands, { busy: false, branchDelete: true, branchCreate: true, branchMerge: true, currentBranch: 'main' })],
    ['branch-remote', branchMenuActions({ ...identity, name: 'origin/x', isCurrent: false, isRemote: true, ref: 'refs/remotes/origin/x' }, env, overviewCommands, { busy: false, remoteBranchDelete: true, branchCreate: true, branchMerge: true, currentBranch: 'main' })],
    ['commit', commitMenuActions({ ...identity, hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 's' }, env, overviewCommands, { busy: false, branchCreate: true, cherryPick: true, currentBranch: 'main' })],
    ['change', changeMenuActions({ ...identity, path: 'a.ts', staged: false }, env, changesCommands, { busy: false }, new Set())],
    ['changeDir', changeDirMenuActions({ ...identity, path: 'src', staged: false, paths: ['src/a.ts'], discardable: ['src/a.ts'] }, env, changesCommands, { busy: false })],
    ['stash', stashMenuActions({ ...identity, sha: 'abc', label: 'WIP' }, env, changesCommands, { busy: false })],
    ['repos', repoRowMenuActions({ ...identity, root: '/work' }, env, [], reposCommands, { canFetch: true })],
    ['pill', pillMenuActions({ ...identity, root: '/work', branch: 'main' }, env, pillCommands, { canFetch: true })],
  ]
}

/** Every action this plugin can offer, across all families. */
function everyAction() {
  return everyMenu().flatMap(([, actions]) => actions.flatMap((action) => [action, ...(action.children ?? [])]))
}

test('every entry that copies, navigates or writes carries a glyph', () => {
  // The platform's own entries arrive with their icons from the platform; only
  // this plugin's have to declare one.
  const animated = everyAction()
    .filter((action) => !action.id.includes('/'))
    .filter((action) => action.icon === undefined)
  assert.deepEqual(animated.map((a) => a.id), [], 'an entry without an icon would sit in a menu of icons')
})

test('every glyph a menu names is declared', () => {
  const declared = new Set(Object.values(MENU_ICONS))
  for (const action of everyAction()) {
    if (action.icon === undefined) continue
    assert.ok(declared.has(action.icon.key), `${action.id} names a declared key (${action.icon.key})`)
  }
})

test('each family uses its own glyph, not one shared blob', () => {
  const icons = new Map(everyAction().map((a) => [a.id, a.icon?.key]))
  assert.equal(icons.get('compare-revision'), MENU_ICONS.compare)
  assert.equal(icons.get('compare-ref'), MENU_ICONS.compare)
  assert.equal(icons.get('show-history'), MENU_ICONS.history)
  assert.equal(icons.get('quote-path'), MENU_ICONS.quote)
  assert.equal(icons.get('switch-branch'), MENU_ICONS.branch)
  assert.equal(icons.get('delete-branch'), MENU_ICONS.delete)
  assert.equal(icons.get('delete-remote-branch'), MENU_ICONS.delete)
  assert.equal(icons.get('create-tag'), MENU_ICONS.tag)
  // Issue #118: create reuses the branch glyph, merge and pick draw their own.
  assert.equal(icons.get('create-branch'), MENU_ICONS.branch)
  assert.equal(icons.get('merge-branch'), MENU_ICONS.merge)
  assert.equal(icons.get('cherry-pick'), MENU_ICONS.pick)
  assert.equal(icons.get('reset'), MENU_ICONS.reset)
  assert.equal(icons.get('discard'), MENU_ICONS.discard)
  assert.equal(icons.get('stash-apply'), MENU_ICONS.stash)
  assert.equal(icons.get('fetch-remote'), MENU_ICONS.fetch)
})

test('every declared glyph is registered into the platform icon slot', () => {
  const registrations = []
  const ctx = {
    slots: {
      inject: (_name, thunk) => thunk(),
      register: (reg, component) => { registrations.push({ reg, component }); return () => {} },
    },
  }
  const released = registerMenuIcons(ctx)
  const keys = Object.values(MENU_ICONS)
  assert.equal(registrations.length, keys.length, 'one registration per declared key')
  assert.deepEqual(registrations.map((r) => r.reg.key).sort(), [...keys].sort(), 'the slot receives exactly the declared keys')
  for (const { reg, component } of registrations) {
    assert.equal(reg.name, 'contextMenu.icon', 'the platform slot this plugin fills')
    assert.equal(typeof component, 'function', 'a glyph, not a placeholder')
  }
  // A shell that predates the icon slot must not take the menu down with it.
  const bare = { slots: { inject: () => { throw new Error('no slot'); }, register: () => {} } }
  const noop = registerMenuIcons(bare)
  assert.doesNotThrow(() => noop())
  released()
})

test('the keys are namespaced and unique', () => {
  const keys = Object.values(MENU_ICONS)
  assert.equal(new Set(keys).size, keys.length, 'no two names share a key')
  for (const key of keys) assert.match(key, /^git-panel\./, `${key} cannot collide with a platform key`)
  assert.deepEqual(menuIcon('copy'), { key: 'git-panel.copy' })
})

test('every menu family builds at least one entry', () => {
  // The icon and separator sweeps below walk whatever the builders return; an
  // empty family would make them silently pass without covering it.
  for (const [family, actions] of everyMenu()) {
    assert.ok(actions.length > 0, `${family} builds a menu for this fixture`)
  }
})

test('each menu fences its destructive band with one separator', () => {
  let fenced = 0
  for (const [family, actions] of everyMenu()) {
    const first = actions.findIndex((a) => a.danger === true)
    if (first === -1) continue
    fenced += 1
    assert.notEqual(first, 0, `${family}: the destructive band never opens the menu`)
    assert.equal(actions[first].separatorBefore, true, `${family}: a separator opens the destructive band`)
    // One separator covers the band: a second one would split the rewrites
    // instead of fencing them off together.
    for (const action of actions.slice(first + 1)) {
      assert.equal(action.separatorBefore, undefined, `${family}: ${action.id} adds no second separator`)
    }
    for (const action of actions.slice(0, first)) {
      assert.equal(action.separatorBefore, undefined, `${family}: ${action.id} is not set off from the entry above`)
    }
  }
  assert.ok(fenced >= 3, 'commit, change, changeDir and stash carry destructive entries')
  // The separator never rides on the entry that merely opens a diff.
  assert.equal(everyAction().find((a) => a.id === 'open-diff')?.separatorBefore, undefined)
})
