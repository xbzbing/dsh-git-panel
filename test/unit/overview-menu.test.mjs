/**
 * The Git overview's row menus: a branch row and a commit row. Pure builders,
 * asserted without React — the destructive entries must open the overview's
 * own dialogs (never act directly), and the busy flag disables the writes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MENU_KIND, branchMenuActions, commitMenuActions } from '../../lib/testkit.mjs'

const t = (key) => key
const CALLBACKS = { compareRevision: () => {}, compareRef: () => {}, showHistory: () => {}, quote: () => {} }
const env = (canQuote = false) => ({
  t,
  menus: undefined,
  facts: { isGit: true, revDiff: true, pathHistory: true, canQuote },
  callbacks: CALLBACKS,
})

function commands(log) {
  return {
    switchBranch: (value) => log.push(['switch', value.name]),
    filterRef: (ref) => log.push(['filter', ref]),
    openTagCreate: (value) => log.push(['tag', value.hash]),
    openRevert: (value) => log.push(['revert', value.hash]),
    openReset: (value) => log.push(['reset', value.hash]),
    openCheckout: (value) => log.push(['checkout', value.hash]),
    quote: (text) => log.push(['quote', text]),
  }
}

const identity = { sessionId: 's', owner: 'p', repo: '' }
const branch = { ...identity, name: 'main', isCurrent: false, isRemote: false }
const commit = { ...identity, hash: 'a1b2c3d4e5', shortHash: 'a1b2c3d', subject: 'fix: the thing' }

test('a branch row offers switch, history and the copy', () => {
  const log = []
  const actions = branchMenuActions(branch, env(), commands(log), { busy: false })
  assert.deepEqual(actions.map((a) => a.id), ['switch-branch', 'show-history', 'copy-branch'])
  void actions[0].run()
  void actions[1].run()
  assert.deepEqual(log, [['switch', 'main'], ['filter', 'main']])
})

test('the current branch has no switch entry', () => {
  const actions = branchMenuActions({ ...branch, isCurrent: true }, env(), commands([]), { busy: false })
  assert.deepEqual(actions.map((a) => a.id), ['show-history', 'copy-branch'])
})

test('a remote row switches through the tracking map, not as a local name', () => {
  const log = []
  const actions = branchMenuActions({ ...branch, isRemote: true }, env(), commands(log), { busy: false })
  assert.equal(actions[0].label, 'menu.switchToTracking')
  void actions[0].run()
  assert.deepEqual(log, [['switch', 'main']])
})

test('a busy overview offers the writes but disabled', () => {
  const actions = branchMenuActions(branch, env(), commands([]), { busy: true })
  assert.equal(actions[0].disabled, true)
})

test('a commit row copies its identities, quotes it, then the write dialogs', () => {
  const log = []
  const actions = commitMenuActions(commit, env(true), commands(log), { busy: false })
  assert.deepEqual(actions.map((a) => a.id), [
    'copy-hash', 'copy-short-hash', 'copy-subject', 'quote-commit', 'create-tag', 'checkout', 'revert', 'reset',
  ])
  void actions[3].run()
  assert.deepEqual(log, [['quote', 'a1b2c3d fix: the thing']], 'the quote carries the short hash and subject')
  // The dialog entries open dialogs, they never act on the row.
  void actions[5].run()
  void actions[6].run()
  void actions[7].run()
  assert.deepEqual(log.slice(1), [['checkout', 'a1b2c3d4e5'], ['revert', 'a1b2c3d4e5'], ['reset', 'a1b2c3d4e5']])
  assert.equal(actions[5].danger, undefined, 'checking a commit out keeps the work tree')
  assert.equal(actions[6].danger, true)
  assert.equal(actions[7].danger, true)
  assert.equal(actions[6].separatorBefore, true, 'the rewrites sit below one separator')
})

test('the commit HEAD already points at offers no checkout', () => {
  const actions = commitMenuActions(commit, env(true), commands([]), { busy: false, head: 'a1b2c3d4e5' })
  assert.ok(!actions.some((a) => a.id === 'checkout'), 'detaching a HEAD that is already there is a no-op')
  assert.ok(actions.some((a) => a.id === 'reset'), 'the other entries stay')
})

test('without a composer the commit row offers no quote entry', () => {
  const actions = commitMenuActions(commit, env(false), commands([]), { busy: false })
  assert.ok(!actions.some((a) => a.id === 'quote-commit'))
})

test('the commit menu names the kind it belongs to', () => {
  assert.equal(MENU_KIND.commit, 'gitPanel.commit')
})
