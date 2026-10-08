/**
 * Sub-tab stickiness: a panel left and re-entered within the window restores
 * its last sub-tab; past the window the entry expires and the default entry
 * logic takes over again.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stashSubTab, recentSubTab } from '../../lib/testkit.mjs'

test('recentSubTab restores a freshly stashed sub-tab', () => {
  stashSubTab('sticky-fresh', 'changes')
  assert.equal(recentSubTab('sticky-fresh'), 'changes')
})

test('recentSubTab returns null for a session that was never stashed', () => {
  assert.equal(recentSubTab('sticky-unknown'), null)
})

test('recentSubTab keeps an entry at the window edge and drops it past the edge', () => {
  const realNow = Date.now
  try {
    const t0 = 1_000_000
    Date.now = () => t0
    stashSubTab('sticky-edge', 'files')
    Date.now = () => t0 + 60_000 // exactly one minute later → still valid
    assert.equal(recentSubTab('sticky-edge'), 'files')
    Date.now = () => t0 + 60_001 // just past the minute → expired
    assert.equal(recentSubTab('sticky-edge'), null)
    // the expired entry is dropped, so a second read is still null
    assert.equal(recentSubTab('sticky-edge'), null)
  } finally {
    Date.now = realNow
  }
})

test('a later stash refreshes the window for the same session', () => {
  const realNow = Date.now
  try {
    const t0 = 2_000_000
    Date.now = () => t0
    stashSubTab('sticky-refresh', 'overview')
    Date.now = () => t0 + 59_000
    stashSubTab('sticky-refresh', 'changes') // re-stash resets leftAt
    Date.now = () => t0 + 118_000 // 59s after the second stash → still valid
    assert.equal(recentSubTab('sticky-refresh'), 'changes')
  } finally {
    Date.now = realNow
  }
})
