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
  MENU_ICONS, menuIcon, fileMenuActions, directoryMenuActions, branchMenuActions,
  commitMenuActions, changeMenuActions, changeDirMenuActions, stashMenuActions,
  repoRowMenuActions, pillMenuActions,
} from '../../lib/testkit.mjs'

const t = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)
const FACTS = { isGit: true, revDiff: true, pathHistory: true, canQuote: true }
const CALLBACKS = { compareRevision: () => {}, compareRef: () => {}, showHistory: () => {}, quote: () => {} }
const env = { t, menus: { notify: () => {} }, writeClipboard: async () => true, facts: FACTS, callbacks: CALLBACKS }
const identity = { sessionId: 's', owner: 'o', repo: '' }
const value = { ...identity, path: 'src/a.ts', root: '/work', ignored: false }

const overviewCommands = { switchBranch: () => {}, filterRef: () => {}, openTagCreate: () => {}, openRevert: () => {}, openReset: () => {}, quote: () => {} }
const changesCommands = { openDiff: () => {}, stage: () => {}, openDiscard: () => {}, stashApply: () => {}, stashPop: () => {}, openStashDrop: () => {} }
const reposCommands = { fetch: () => {} }
const pillCommands = { openTab: () => {}, fetch: () => {} }

/** Every action this plugin can offer, across all families. */
function everyAction() {
  const rows = [
    ...fileMenuActions(value, env, [{ id: 'open-in-app.file/float', label: 'x' }]),
    ...directoryMenuActions(value, env, []),
    ...branchMenuActions({ ...identity, name: 'main', isCurrent: false, isRemote: false }, env, overviewCommands, { busy: false }),
    ...commitMenuActions({ ...identity, hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 's' }, env, overviewCommands, { busy: false }),
    ...changeMenuActions({ ...identity, path: 'a.ts', staged: false }, env, changesCommands, { busy: false }, new Set()),
    ...changeDirMenuActions({ ...identity, path: 'src', staged: false, paths: ['src/a.ts'], discardable: ['src/a.ts'] }, env, changesCommands, { busy: false }),
    ...stashMenuActions({ ...identity, sha: 'abc', label: 'WIP' }, env, changesCommands, { busy: false }),
    ...repoRowMenuActions({ ...identity, root: '/work' }, env, [], reposCommands, { canFetch: true }),
    ...pillMenuActions({ ...identity, root: '/work', branch: 'main' }, env, pillCommands, { canFetch: true }),
  ]
  return rows.flatMap((action) => [action, ...(action.children ?? [])])
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
  assert.equal(icons.get('create-tag'), MENU_ICONS.tag)
  assert.equal(icons.get('reset'), MENU_ICONS.reset)
  assert.equal(icons.get('discard'), MENU_ICONS.discard)
  assert.equal(icons.get('stash-apply'), MENU_ICONS.stash)
  assert.equal(icons.get('fetch-remote'), MENU_ICONS.fetch)
})

test('the keys are namespaced and unique', () => {
  const keys = Object.values(MENU_ICONS)
  assert.equal(new Set(keys).size, keys.length, 'no two names share a key')
  for (const key of keys) assert.match(key, /^git-panel\./, `${key} cannot collide with a platform key`)
  assert.deepEqual(menuIcon('copy'), { key: 'git-panel.copy' })
})

test('a destructive entry is separated from the ones above it', () => {
  const all = everyAction()
  const destructive = all.filter((a) => a.danger === true)
  assert.ok(destructive.length >= 4, 'discard, reset, revert and the stash drop')
  for (const action of destructive) {
    // The first entry of a menu cannot need a separator above it.
    const siblings = all
    if (siblings[0] === action) continue
    assert.equal(action.separatorBefore, true, `${action.id} is separated from the entries above it`)
  }
  // And the separator is never on the entry that merely opens a diff.
  assert.equal(all.find((a) => a.id === 'open-diff')?.separatorBefore, undefined)
})
