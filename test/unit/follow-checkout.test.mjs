/**
 * Which repository row a live session directory belongs to (ADR-0041).
 *
 * The follow switch may only ever move the panel within the session's own
 * repository family. The load-bearing properties: the most specific row wins,
 * so a worktree nested in the main checkout is never mistaken for the main row;
 * a row the host refused (disabled) or a foreign checkout (`role: 'repo'`,
 * scanned nested repositories and `.code-workspace` roots) stops the walk
 * instead of falling back to an ancestor row; and a session created in a linked
 * worktree follows the workspace row it carries. Path comparison must survive
 * trailing separators, POSIX prefix lookalikes, and Windows drive-letter case.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkoutForDirectory, atCheckoutRoot, planFollow } from '../../lib/testkit.mjs'

/** A repository list row; only the fields the lookup reads. */
function row(path, root, extra = {}) {
  return { path, root, name: root.split('/').at(-1) || root, kind: path === '' ? 'workspace' : 'nested', ...extra }
}

const MAIN = row('', '/repo', { role: 'main' })
const LINKED = row('.agents/worktrees/feat/x', '/repo/.agents/worktrees/feat/x', { role: 'linked' })

test('a session in its own checkout follows the workspace row', () => {
  assert.equal(checkoutForDirectory('/repo', [MAIN, LINKED]), MAIN)
  assert.equal(checkoutForDirectory('/repo/src/deep', [MAIN, LINKED]), MAIN)
  assert.equal(checkoutForDirectory('/repo/', [MAIN, LINKED]), MAIN, 'a trailing separator is the same directory')
})

test('a linked worktree nested in the main checkout wins over the main row', () => {
  const rows = [LINKED, MAIN]
  assert.equal(checkoutForDirectory('/repo/.agents/worktrees/feat/x', rows), LINKED)
  assert.equal(checkoutForDirectory('/repo/.agents/worktrees/feat/x/src', rows), LINKED)
  assert.equal(checkoutForDirectory('/repo/.agents/worktrees/feat/x/', rows), LINKED)
})

test('the longest root wins regardless of row order', () => {
  const nested = row('.agents/worktrees/feat/x/a', '/repo/.agents/worktrees/feat/x/a', { role: 'linked' })
  assert.equal(checkoutForDirectory('/repo/.agents/worktrees/feat/x/a/src', [MAIN, LINKED, nested]), nested)
  assert.equal(checkoutForDirectory('/repo/.agents/worktrees/feat/x/src', [MAIN, LINKED, nested]), LINKED)
})

test('a session created in a linked worktree follows the workspace row it carries', () => {
  // The workspace row is the session's own checkout whatever git calls it;
  // the primary work tree is then just another row.
  const own = row('', '/repo/.agents/worktrees/feat/x', { role: 'linked' })
  const primary = row('../..', '/repo', { role: 'main' })
  assert.equal(checkoutForDirectory('/repo/.agents/worktrees/feat/x/src', [own, primary]), own)
  assert.equal(checkoutForDirectory('/repo/src', [own, primary]), primary)
})

test('a disabled row is never followed and never falls back to its parent', () => {
  const stale = row('gone', '/repo/gone', { role: 'linked', disabled: 'stale' })
  const outside = row('../spike', '/repo/spike', { role: 'linked', disabled: 'outside' })
  assert.equal(checkoutForDirectory('/repo/gone', [MAIN, stale]), undefined)
  assert.equal(checkoutForDirectory('/repo/gone/src', [MAIN, stale]), undefined)
  assert.equal(checkoutForDirectory('/repo/spike', [MAIN, outside]), undefined)
  // A disabled row elsewhere changes nothing.
  assert.equal(checkoutForDirectory('/repo/src', [MAIN, stale]), MAIN)
})

test('foreign checkouts are refused, not attributed to the enclosing repository', () => {
  const site = row('site', '/repo/site', { role: 'repo' })
  const external = row('/elsewhere/tools', '/elsewhere/tools', { kind: 'external', role: 'repo' })
  assert.equal(checkoutForDirectory('/repo/site/src', [MAIN, site]), undefined)
  assert.equal(checkoutForDirectory('/repo/site', [MAIN, site]), undefined)
  assert.equal(checkoutForDirectory('/elsewhere/tools/src', [external]), undefined)
  // Outside the foreign row, the session's own checkout still matches.
  assert.equal(checkoutForDirectory('/repo/src', [MAIN, site]), MAIN)
  // A row without a role is not proof of the session's family either.
  const roleless = row('libs/a', '/repo/libs/a')
  assert.equal(checkoutForDirectory('/repo/libs/a/src', [MAIN, roleless]), undefined)
})

test('prefix lookalikes are not descendants', () => {
  assert.equal(checkoutForDirectory('/repo-extra', [MAIN]), undefined)
  assert.equal(checkoutForDirectory('/repo-extra/src', [MAIN]), undefined)
  assert.equal(checkoutForDirectory('/repository', [MAIN]), undefined)
})

test('windows paths compare case-insensitively and by either separator', () => {
  const win = row('.agents/worktrees/x', 'C:\\Work\\Repo\\.agents\\worktrees\\x', { role: 'linked' })
  const main = row('', 'C:\\Work\\Repo', { role: 'main' })
  assert.equal(checkoutForDirectory('c:/work/repo/.agents/worktrees/x/src', [main, win]), win)
  assert.equal(checkoutForDirectory('C:/WORK/REPO/src', [main, win]), main)
  assert.equal(checkoutForDirectory('C:/Work/Repo-extra', [main]), undefined)
  // POSIX is case-sensitive.
  assert.equal(checkoutForDirectory('/Repo', [MAIN]), undefined)
})

test('an empty or missing directory follows nothing', () => {
  assert.equal(checkoutForDirectory(null, [MAIN]), undefined)
  assert.equal(checkoutForDirectory(undefined, [MAIN]), undefined)
  assert.equal(checkoutForDirectory('', [MAIN]), undefined)
  assert.equal(checkoutForDirectory('/repo', []), undefined)
})

test('atCheckoutRoot separates the exact root from a subdirectory', () => {
  const row = { path: '', root: '/repo', name: 'repo', kind: 'workspace', role: 'main' }
  assert.equal(atCheckoutRoot('/repo', row), true)
  assert.equal(atCheckoutRoot('/repo/', row), true, 'a trailing separator still names the root')
  assert.equal(atCheckoutRoot('/repo/sub', row), false, 'a subdirectory is not the root')
  const windows = { path: 'C:\\Repo', root: 'C:\\Repo', name: 'repo', kind: 'workspace', role: 'main' }
  assert.equal(atCheckoutRoot('c:/repo', windows), true, 'Windows paths compare case-insensitively')
  assert.equal(atCheckoutRoot(null, row), false)
})

const SITE = row('site', '/repo/site', { role: 'repo' })

const FOLLOW_READY = { enabled: true, known: true, cwd: null, pending: null, refetched: null, force: false, manual: null, released: null }

function plan(overrides = {}) {
  return planFollow({
    sessionDirectory: LINKED.root,
    repos: [MAIN, LINKED, SITE],
    repo: '',
    followSession: true,
    followSessionKnown: true,
    hasRepoPick: false,
    repoListReady: true,
    repoProbeFailed: false,
    state: { ...FOLLOW_READY },
    ...overrides,
  })
}

test('planFollow follows an exact checkout on the first run', () => {
  const decision = plan()
  assert.deepEqual(decision.action, { kind: 'follow', path: LINKED.path })
  assert.equal(decision.state.cwd, LINKED.root)
  assert.equal(decision.state.pending, null)
})

test('planFollow keeps a manual pick on the first run of a mount', () => {
  const decision = plan({ repo: SITE.path, hasRepoPick: true })
  assert.deepEqual(decision.action, { kind: 'none' })
  assert.equal(decision.state.manual, SITE.path, 'the pick is recorded as the protected selection')
  assert.equal(decision.state.pending, LINKED.root, 'the directory stays pending as the fallback target')
})

test('planFollow keeps the manual pick on later runs of the same directory', () => {
  // Without the explicit record the second run would fall through to the
  // follow: `first` is false and the pending window alone is not a promise.
  const state = { ...FOLLOW_READY, cwd: LINKED.root, pending: LINKED.root, manual: SITE.path }
  const decision = plan({ repos: [MAIN, LINKED, SITE], repo: SITE.path, hasRepoPick: true, state })
  assert.deepEqual(decision.action, { kind: 'none' })
  assert.equal(decision.state.manual, SITE.path)
})

test('planFollow re-arms the follow when the host refuses the manual pick', () => {
  // The repair cleared the selection (repo is back to '', nothing is recorded
  // as picked). The pending directory is what lets the same mount follow it.
  const state = { ...FOLLOW_READY, cwd: LINKED.root, pending: LINKED.root, manual: SITE.path }
  const decision = plan({ repos: [MAIN, LINKED, SITE], repo: '', hasRepoPick: false, state })
  assert.deepEqual(decision.action, { kind: 'follow', path: LINKED.path })
  assert.equal(decision.state.manual, null, 'the released pick is no longer protected')
  assert.equal(decision.state.pending, null)
})

test('planFollow clears the protected pick when the directory changes', () => {
  const state = { ...FOLLOW_READY, cwd: LINKED.root, pending: LINKED.root, manual: SITE.path }
  const decision = plan({
    sessionDirectory: MAIN.root,
    repos: [MAIN, LINKED, SITE],
    repo: SITE.path,
    hasRepoPick: true,
    state,
  })
  assert.deepEqual(decision.action, { kind: 'follow', path: MAIN.path })
  assert.equal(decision.state.manual, null)
})

test('planFollow lets a directory change re-arm the follow past a manual pick', () => {
  const decision = plan({
    sessionDirectory: MAIN.root,
    repo: SITE.path,
    hasRepoPick: true,
    state: { ...FOLLOW_READY, cwd: LINKED.root, pending: null },
  })
  assert.deepEqual(decision.action, { kind: 'follow', path: MAIN.path })
  assert.equal(decision.state.cwd, MAIN.root)
})

test('planFollow keeps a manual pick made while the list refetch is pending', () => {
  // The session entered a directory no row names yet; the one refetch is in
  // flight when the user picks another checkout. The pick must survive the
  // list that lands afterwards.
  const decision = plan({
    repos: [MAIN, SITE],
    repo: SITE.path,
    hasRepoPick: true,
    state: { ...FOLLOW_READY, cwd: LINKED.root, pending: LINKED.root, refetched: LINKED.root },
  })
  assert.deepEqual(decision.action, { kind: 'none' })
  assert.equal(decision.state.manual, SITE.path)
  assert.equal(decision.state.pending, LINKED.root, 'the directory stays pending behind the pick')
})

test('planFollow keeps a manual pick when the worktree probe failed', () => {
  const decision = plan({
    repos: [MAIN],
    repo: SITE.path,
    hasRepoPick: true,
    repoProbeFailed: true,
    state: { ...FOLLOW_READY, cwd: LINKED.root, pending: LINKED.root },
  })
  assert.deepEqual(decision.action, { kind: 'none' })
  assert.equal(decision.state.manual, SITE.path)
  assert.equal(decision.state.pending, LINKED.root, 'an incomplete list keeps the directory pending, not decided')
})

test('planFollow refetches once for a directory no row names', () => {
  const state = { ...FOLLOW_READY }
  const first = plan({ repos: [MAIN], state })
  assert.deepEqual(first.action, { kind: 'refetch' })
  assert.equal(first.state.refetched, LINKED.root)
  const second = plan({ repos: [MAIN], state: first.state })
  assert.deepEqual(second.action, { kind: 'none' })
})

test('planFollow waits out a failed probe and follows once the row arrives', () => {
  const state = { ...FOLLOW_READY, cwd: LINKED.root, pending: LINKED.root, refetched: LINKED.root }
  const failed = plan({ repos: [MAIN], repoProbeFailed: true, state })
  assert.deepEqual(failed.action, { kind: 'none' })
  assert.equal(failed.state.pending, LINKED.root)
  const recovered = plan({ repos: [MAIN, LINKED], repoProbeFailed: false, state: failed.state })
  assert.deepEqual(recovered.action, { kind: 'follow', path: LINKED.path })
  assert.equal(recovered.state.pending, null)
})

test('planFollow treats the first ready sample as an observation, not a flip', () => {
  const decision = plan({
    followSessionKnown: false,
    state: { ...FOLLOW_READY, known: false },
  })
  assert.deepEqual(decision.action, { kind: 'none' })
  assert.equal(decision.state.known, false)
  const observed = plan({ state: { ...FOLLOW_READY, known: false } })
  assert.deepEqual(observed.action, { kind: 'follow', path: LINKED.path })
  assert.equal(observed.state.known, true)
  assert.equal(observed.state.force, false)
})

test('planFollow follows past a manual pick when the setting is turned on', () => {
  const decision = plan({
    repo: SITE.path,
    hasRepoPick: true,
    state: { ...FOLLOW_READY, enabled: false, force: true },
  })
  assert.deepEqual(decision.action, { kind: 'follow', path: LINKED.path })
  assert.equal(decision.state.force, false)
})

test('planFollow does nothing with the setting off or the list unready', () => {
  assert.deepEqual(plan({ followSession: false }).action, { kind: 'none' })
  assert.deepEqual(plan({ repoListReady: false }).action, { kind: 'none' })
  assert.deepEqual(plan({ sessionDirectory: null }).action, { kind: 'none' })
})

test('planFollow does not switch to the checkout already selected', () => {
  const decision = plan({ sessionDirectory: MAIN.root, repo: '', repos: [MAIN] })
  assert.deepEqual(decision.action, { kind: 'none' })
  assert.equal(decision.state.pending, null)
})
