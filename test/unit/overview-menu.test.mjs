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
    openBranchDelete: (value) => log.push(['delete', value.name]),
    openRemoteBranchDelete: (value) => log.push(['deleteRemote', value.ref]),
    openBranchCreate: (target) => log.push(['create', target.start, target.label]),
    openBranchMerge: (target) => log.push(['merge', target.start, target.label]),
    openCherryPick: (value) => log.push(['pick', value.hash]),
    openRevert: (value) => log.push(['revert', value.hash]),
    openReset: (value) => log.push(['reset', value.hash]),
    openCheckout: (value) => log.push(['checkout', value.hash]),
    openFlowStart: (flow, base) => log.push(base === undefined ? ['flowStart', flow] : ['flowStart', flow, base]),
    openFlowFinish: (flow, branchName) => log.push(['flowFinish', flow, branchName]),
    openFlowIntegrate: () => log.push(['flowIntegrate']),
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

test('a host with the branch-delete capability offers the delete for a local row', () => {
  const log = []
  const actions = branchMenuActions(branch, env(), commands(log), { busy: false, branchDelete: true })
  assert.deepEqual(actions.map((a) => a.id), ['switch-branch', 'show-history', 'copy-branch', 'delete-branch'])
  const del = actions[3]
  assert.equal(del.danger, true)
  assert.equal(del.separatorBefore, true, 'the delete sits below its own separator')
  assert.equal(del.disabled, false)
  void del.run()
  assert.deepEqual(log, [['delete', 'main']], 'the entry only opens the confirmation')
})

test('the branch-delete entry is gated on the host capability', () => {
  const actions = branchMenuActions(branch, env(), commands([]), { busy: false })
  assert.ok(!actions.some((a) => a.id === 'delete-branch'))
})

test('the checked-out branch and remote rows offer no delete', () => {
  const current = branchMenuActions({ ...branch, isCurrent: true }, env(), commands([]), { busy: false, branchDelete: true })
  assert.ok(!current.some((a) => a.id === 'delete-branch'), 'git refuses deleting the checked-out branch')
  const remote = branchMenuActions({ ...branch, isRemote: true }, env(), commands([]), { busy: false, branchDelete: true })
  assert.ok(!remote.some((a) => a.id === 'delete-branch'), 'the panel never deletes a remote ref')
})

test('a busy overview disables the branch delete too', () => {
  const actions = branchMenuActions(branch, env(), commands([]), { busy: true, branchDelete: true })
  assert.equal(actions.find((a) => a.id === 'delete-branch').disabled, true)
})

test('a remote row offers the remote delete only with the capability and its full ref', () => {  const remote = { ...branch, isRemote: true, ref: 'refs/remotes/origin/feature/x' }
  const log = []
  const actions = branchMenuActions(remote, env(), commands(log), { busy: false, remoteBranchDelete: true })
  assert.deepEqual(actions.map((a) => a.id), ['switch-branch', 'show-history', 'copy-branch', 'delete-remote-branch'])
  const del = actions[3]
  assert.equal(del.danger, true)
  assert.equal(del.separatorBefore, true)
  void del.run()
  assert.deepEqual(log, [['deleteRemote', 'refs/remotes/origin/feature/x']], 'the entry only opens the confirmation')
})

test('the remote delete is gated on its capability and on the tracking ref', () => {
  const withRef = { ...branch, isRemote: true, ref: 'refs/remotes/origin/feature/x' }
  for (const facts of [{ busy: false }, { busy: false, remoteBranchDelete: true }]) {
    const actions = branchMenuActions(withRef, env(), commands([]), facts)
    const offered = actions.some((a) => a.id === 'delete-remote-branch')
    assert.equal(offered, facts.remoteBranchDelete === true, 'capability gates the entry')
  }
  const noRef = branchMenuActions({ ...branch, isRemote: true }, env(), commands([]), { busy: false, remoteBranchDelete: true })
  assert.ok(!noRef.some((a) => a.id === 'delete-remote-branch'), 'an older host without ref offers no entry')
  const local = branchMenuActions({ ...branch, ref: 'refs/heads/main' }, env(), commands([]), { busy: false, remoteBranchDelete: true })
  assert.ok(!local.some((a) => a.id === 'delete-remote-branch'), 'a local row uses the local entry instead')
})

test('a busy overview disables the remote delete too', () => {
  const remote = { ...branch, isRemote: true, ref: 'refs/remotes/origin/x' }
  const actions = branchMenuActions(remote, env(), commands([]), { busy: true, remoteBranchDelete: true })
  assert.equal(actions.find((a) => a.id === 'delete-remote-branch').disabled, true)
})

test('a tag row shares the branch menu but offers no branch delete', () => {
  // Tags render through the branch row, so they reach this builder: a tag is
  // not a refs/heads entry and `git branch -d <tag>` would name a same-named
  // branch or fail, so the delete must not be offered for one.
  const actions = branchMenuActions({ ...branch, isTag: true }, env(), commands([]), { busy: false, branchDelete: true })
  assert.ok(!actions.some((a) => a.id === 'delete-branch'))
  assert.deepEqual(actions.map((a) => a.id), ['show-history', 'copy-branch'], 'neither branch-only entry is offered')
})

test('a commit row copies its identities, quotes it, then the write dialogs', () => {
  const log = []
  const actions = commitMenuActions(commit, env(true), commands(log), { busy: false, commitCheckout: true })
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
  assert.equal(actions[7].separatorBefore, undefined, 'reset shares that separator instead of adding a second one')
})

test('a host without commit-checkout offers no checkout entry', () => {
  const actions = commitMenuActions(commit, env(true), commands([]), { busy: false })
  assert.ok(!actions.some((a) => a.id === 'checkout'), 'the entry is only offered when the host implements the action')
  assert.ok(actions.some((a) => a.id === 'reset'), 'the other entries stay')
})

test('the commit HEAD already points at offers no checkout', () => {
  // The snapshot carries the short hash; the row carries the full one. Equality
  // never holds in production, so the check has to compare prefixes.
  const actions = commitMenuActions(commit, env(true), commands([]), { busy: false, head: 'a1b2c3d', commitCheckout: true })
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

// ── create branch / merge / cherry-pick (issue #118) ────────────────────────

test('a host with the create/merge capabilities offers both entries for a local row (#118)', () => {
  const log = []
  const facts = { busy: false, branchCreate: true, branchMerge: true, currentBranch: 'main', flow: true }
  const actions = branchMenuActions({ ...branch, name: 'feature/x', ref: 'refs/heads/feature/x' }, env(), commands(log), facts)
  assert.deepEqual(
    actions.map((a) => a.id),
    ['switch-branch', 'flow-finish', 'create-branch', 'merge-branch', 'show-history', 'copy-branch'],
    'the Git Flow finish and the two writes sit with the switch, above the history and copy entries',
  )
  // Both entries only open their dialogs — and both carry the full ref.
  void actions[2].run()
  void actions[3].run()
  assert.deepEqual(log, [
    ['create', 'refs/heads/feature/x', 'feature/x'],
    ['merge', 'refs/heads/feature/x', 'feature/x'],
  ])
})

test('the current branch keeps create but gets no merge entry (#118)', () => {
  const facts = { busy: false, branchCreate: true, branchMerge: true, currentBranch: 'main' }
  const actions = branchMenuActions({ ...branch, name: 'main', isCurrent: true, ref: 'refs/heads/main' }, env(), commands([]), facts)
  assert.ok(actions.some((a) => a.id === 'create-branch'), 'creating from the branch you are on is the common case')
  assert.ok(!actions.some((a) => a.id === 'merge-branch'), 'merging a branch into itself is a no-op')
})

test('a detached HEAD offers no merge entry (#118)', () => {
  const facts = { busy: false, branchCreate: true, branchMerge: true, currentBranch: null }
  const actions = branchMenuActions({ ...branch, name: 'feature/x', ref: 'refs/heads/feature/x' }, env(), commands([]), facts)
  assert.ok(actions.some((a) => a.id === 'create-branch'), 'a ref write needs no branch to land on')
  assert.ok(!actions.some((a) => a.id === 'merge-branch'), 'a merge needs somewhere to land')
})

test('create and merge are gated on the host capabilities (#118)', () => {
  for (const facts of [{ busy: false }, { busy: false, currentBranch: 'main' }, { busy: false, branchCreate: true }, { busy: false, branchMerge: true, currentBranch: 'main' }]) {
    const actions = branchMenuActions({ ...branch, name: 'feature/x', ref: 'refs/heads/feature/x' }, env(), commands([]), facts)
    assert.equal(actions.some((a) => a.id === 'create-branch'), facts.branchCreate === true, `create gating: ${JSON.stringify(facts)}`)
    assert.equal(actions.some((a) => a.id === 'merge-branch'), facts.branchMerge === true && facts.currentBranch != null, `merge gating: ${JSON.stringify(facts)}`)
  }
})

test('a remote row needs its full tracking ref for create and merge (#118)', () => {
  const facts = { busy: false, branchCreate: true, branchMerge: true, currentBranch: 'main' }
  const log = []
  const actions = branchMenuActions({ ...branch, name: 'origin/feature/x', isRemote: true, ref: 'refs/remotes/origin/feature/x' }, env(), commands(log), facts)
  const create = actions.find((a) => a.id === 'create-branch')
  const merge = actions.find((a) => a.id === 'merge-branch')
  assert.ok(create !== undefined && merge !== undefined)
  void create.run()
  void merge.run()
  assert.deepEqual(log, [
    ['create', 'refs/remotes/origin/feature/x', 'origin/feature/x'],
    ['merge', 'refs/remotes/origin/feature/x', 'origin/feature/x'],
  ], 'the remote row acts on the full tracking ref, not the short display name')
  const noRef = branchMenuActions({ ...branch, name: 'origin/feature/x', isRemote: true }, env(), commands([]), facts)
  assert.ok(!noRef.some((a) => a.id === 'create-branch'), 'a short origin/x is display text, not an address')
  assert.ok(!noRef.some((a) => a.id === 'merge-branch'), 'and merging it would guess at the ref')
})

test('a tag row gets no create or merge entry (#118)', () => {
  const facts = { busy: false, branchCreate: true, branchMerge: true, currentBranch: 'main' }
  const actions = branchMenuActions({ ...branch, isTag: true }, env(), commands([]), facts)
  assert.ok(!actions.some((a) => a.id === 'create-branch'))
  assert.ok(!actions.some((a) => a.id === 'merge-branch'))
})

test('a busy overview disables create and merge too (#118)', () => {
  const actions = branchMenuActions(branch, env(), commands([]), { busy: true, branchCreate: true, branchMerge: true, currentBranch: 'main' })
  assert.equal(actions.find((a) => a.id === 'create-branch').disabled, true)
  assert.equal(actions.find((a) => a.id === 'merge-branch').disabled, true)
})

test('a commit row offers create-branch and cherry-pick with the capabilities (#118)', () => {
  const log = []
  const facts = { busy: false, branchCreate: true, cherryPick: true, currentBranch: 'main' }
  const actions = commitMenuActions(commit, env(), commands(log), facts)
  assert.deepEqual(actions.map((a) => a.id), [
    'copy-hash', 'copy-short-hash', 'copy-subject', 'create-tag', 'create-branch', 'cherry-pick', 'revert', 'reset',
  ])
  void actions[4].run()
  void actions[5].run()
  assert.deepEqual(log, [
    ['create', 'a1b2c3d4e5', 'a1b2c3d'],
    ['pick', 'a1b2c3d4e5'],
  ], 'the create starts at the full hash; the pick only opens its dialog')
  assert.equal(actions[4].danger, undefined, 'a branch create rewrites nothing')
  assert.equal(actions[5].danger, undefined, 'a cherry-pick adds a commit; it rewrites nothing')
})

test('create-branch and cherry-pick are gated on capabilities and a current branch (#118)', () => {
  for (const facts of [
    { busy: false },
    { busy: false, currentBranch: 'main' },
    { busy: false, branchCreate: true, cherryPick: true },
  ]) {
    const actions = commitMenuActions(commit, env(), commands([]), facts)
    assert.equal(actions.some((a) => a.id === 'create-branch'), facts.branchCreate === true, `create gating: ${JSON.stringify(facts)}`)
    assert.equal(
      actions.some((a) => a.id === 'cherry-pick'),
      facts.cherryPick === true && facts.currentBranch != null,
      `pick gating: ${JSON.stringify(facts)}`,
    )
  }
  // Detached HEAD: the pick would land nowhere the user can follow.
  const detached = commitMenuActions(commit, env(), commands([]), { busy: false, branchCreate: true, cherryPick: true, currentBranch: null })
  assert.ok(detached.some((a) => a.id === 'create-branch'))
  assert.ok(!detached.some((a) => a.id === 'cherry-pick'))
})

/** Facts a branch row sees once the branch list has loaded a flow-shaped repo. */
const FLOW_FACTS = { busy: false, flow: true, flowDevelop: 'develop', flowMains: ['main', 'master'], currentBranch: 'feature/login' }

test('develop offers the two flow starts and integrate', () => {
  const log = []
  const develop = { ...branch, name: 'develop' }
  const actions = branchMenuActions(develop, env(), commands(log), FLOW_FACTS)
  assert.deepEqual(actions.map((a) => a.id), [
    'switch-branch', 'flow-start-feature', 'flow-start-release', 'flow-integrate', 'show-history', 'copy-branch',
  ])
  void actions[1].run()
  void actions[2].run()
  void actions[3].run()
  assert.deepEqual(log, [['flowStart', 'feature', 'develop'], ['flowStart', 'release', 'develop'], ['flowIntegrate']])
})

test('the main line offers the hotfix start', () => {
  const log = []
  const main = { ...branch, name: 'main' }
  const actions = branchMenuActions(main, env(), commands(log), FLOW_FACTS)
  assert.ok(actions.some((a) => a.id === 'flow-start-hotfix'))
  void actions.find((a) => a.id === 'flow-start-hotfix').run()
  assert.deepEqual(log, [['flowStart', 'hotfix', 'main']])
})

test('a repository that also keeps master offers the hotfix start on that row too', () => {
  const log = []
  const master = { ...branch, name: 'master' }
  const actions = branchMenuActions(master, env(), commands(log), FLOW_FACTS)
  const start = actions.find((a) => a.id === 'flow-start-hotfix')
  assert.ok(start !== undefined, 'master must carry the entry')
  void start.run()
  assert.deepEqual(log, [['flowStart', 'hotfix', 'master']], 'the clicked row is the base, not main')
})

test('a flow branch row offers its finish entry and names the branch', () => {
  const log = []
  const feature = { ...branch, name: 'feature/login', isCurrent: true }
  const actions = branchMenuActions(feature, env(), commands(log), FLOW_FACTS)
  const finish = actions.find((a) => a.id === 'flow-finish')
  assert.ok(finish !== undefined)
  assert.equal(finish.label, 'flow.menu.finishFeature')
  void finish.run()
  assert.deepEqual(log, [['flowFinish', 'feature', 'feature/login']])

  const release = branchMenuActions({ ...branch, name: 'release/1.2.0' }, env(), commands([]), FLOW_FACTS)
  assert.equal(release.find((a) => a.id === 'flow-finish').label, 'flow.menu.finishRelease')
  const hotfix = branchMenuActions({ ...branch, name: 'hotfix/1.2.1' }, env(), commands([]), FLOW_FACTS)
  assert.equal(hotfix.find((a) => a.id === 'flow-finish').label, 'flow.menu.finishHotfix')
})

test('integrate is disabled unless a feature branch is checked out', () => {
  const develop = { ...branch, name: 'develop' }
  for (const currentBranch of ['main', 'develop', 'release/1.2.0', 'hotfix/1.2.1', null]) {
    const actions = branchMenuActions(develop, env(), commands([]), { ...FLOW_FACTS, currentBranch })
    assert.equal(actions.find((a) => a.id === 'flow-integrate').disabled, true, `current=${currentBranch}`)
  }
  const onFeature = branchMenuActions(develop, env(), commands([]), FLOW_FACTS)
  assert.equal(onFeature.find((a) => a.id === 'flow-integrate').disabled, false)
})

test('flow entries stay off rows the convention does not know', () => {
  const actions = branchMenuActions({ ...branch, name: 'release-candidate' }, env(), commands([]), FLOW_FACTS)
  assert.ok(!actions.some((a) => a.id.startsWith('flow-')))
})

test('flow entries are hidden on a host without the flow capability', () => {
  const facts = { ...FLOW_FACTS, flow: false }
  const onDevelop = branchMenuActions({ ...branch, name: 'develop' }, env(), commands([]), facts)
  const onFeature = branchMenuActions({ ...branch, name: 'feature/login' }, env(), commands([]), facts)
  assert.ok(![...onDevelop, ...onFeature].some((a) => a.id.startsWith('flow-')), 'an older host has no flow actions to run')
})
