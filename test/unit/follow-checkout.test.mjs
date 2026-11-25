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
import { checkoutForDirectory } from '../../lib/testkit.mjs'

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
