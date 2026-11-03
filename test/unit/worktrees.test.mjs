/**
 * Worktree discovery: parsing `git worktree list --porcelain` and
 * converting its records into switcher rows. The trust rules under test are the
 * ones the selector cannot re-check on its own: a directory outside the cwd
 * stays visible but unchoosable, a lost directory reports itself instead of
 * pretending to be a repository, and the record naming the session's own
 * checkout keeps the selector's '' identity whatever its primary/linked role.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWorktreePorcelain, worktreeCheckouts } from '../../lib/host/worktrees.js'

const FIXTURE = [
  'worktree /w/main',
  'HEAD 111111',
  'branch refs/heads/main',
  '',
  'worktree /w/linked',
  'HEAD 222222',
  'branch refs/heads/feat/x',
  'locked need a rest',
  '',
  'worktree /w/detached',
  'HEAD 333333',
  'detached',
  '',
  'worktree /w/gone',
  'HEAD 444444',
  'branch refs/heads/old',
  'prunable gitdir points nowhere',
  '',
].join('\n')

test('porcelain parsing reads every record and its markers', () => {
  const rows = parseWorktreePorcelain(FIXTURE)
  assert.equal(rows.length, 4)
  assert.deepEqual(rows[0], { path: '/w/main', head: '111111', branch: 'main', locked: false, prunable: false, bare: false })
  assert.equal(rows[1].branch, 'feat/x', 'refs/heads/ is stripped once, not per segment')
  assert.equal(rows[1].locked, true, 'a reason after the key belongs to the key')
  assert.equal(rows[1].prunable, false)
  assert.equal(rows[2].branch, null, 'detached HEAD is null, i.e. a reported state')
  assert.equal(rows[3].prunable, true)
  assert.equal(rows[3].locked, false)
})

test('porcelain parsing handles a bare worktree, the -z form and CRLF', () => {
  const bare = parseWorktreePorcelain('worktree /srv/git.git\nbare\n')
  assert.equal(bare.length, 1)
  assert.equal(bare[0].bare, true)
  assert.equal(bare[0].branch, null)

  // git prints paths verbatim; only -z keeps a newline inside a path.
  const nul = parseWorktreePorcelain('worktree /w/docs\nevil\0HEAD aaaa\0branch refs/heads/x\0\0worktree /w/"q"\0HEAD bbbb\0detached\0\0')
  assert.equal(nul.length, 2, 'records split on the empty attribute, not on the newline')
  assert.equal(nul[0].path, '/w/docs\nevil', 'a newline stays inside the path')
  assert.equal(nul[0].branch, 'x')
  assert.equal(nul[1].path, '/w/"q"', 'quotes are never unescaped: git does not add them')
  assert.equal(nul[1].branch, null)

  const crlf = parseWorktreePorcelain('worktree /w/a\r\nHEAD aaaa\r\nbranch refs/heads/x\r\n\r\n')
  assert.equal(crlf.length, 1)
  assert.equal(crlf[0].path, '/w/a')
})

/** A RepoFs face over a lookup table; unknown paths do not exist. */
function fsOf(realpaths) {
  return {
    async realpath(path) {
      const hit = realpaths.get(path)
      if (hit === undefined) throw new Error('ENOENT ' + path)
      return hit
    },
    async stat() { throw new Error('not used') },
    async readdir() { throw new Error('not used') },
  }
}

function info(path, extra = {}) {
  return { path, head: 'h', branch: 'main', locked: false, prunable: false, bare: false, ...extra }
}

test("the record naming the session checkout keeps the empty selector", async () => {
  const fs = fsOf(new Map([['/w/main', '/w/main']]))
  const rows = await worktreeCheckouts(fs, '/w/main', '/w/main', [info('/w/main')])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].path, '')
  assert.equal(rows[0].role, 'main')
  assert.equal(rows[0].disabled, undefined, 'the workspace checkout stays choosable')
})

test('a worktree inside the cwd becomes a selectable relative row', async () => {
  const fs = fsOf(new Map([
    ['/w/main', '/w/main'],
    ['/w/main/.agents/worktrees/review/pr-85', '/w/main/.agents/worktrees/review/pr-85'],
  ]))
  const rows = await worktreeCheckouts(
    fs,
    '/w/main',
    '/w/main',
    [info('/w/main'), info('/w/main/.agents/worktrees/review/pr-85', { branch: 'review/pr-85' })],
  )
  assert.equal(rows[1].path, '.agents/worktrees/review/pr-85', 'depth does not matter: git reported it')
  assert.equal(rows[1].role, 'linked')
  assert.equal(rows[1].branch, 'review/pr-85')
  assert.equal(rows[1].disabled, undefined)
})

test('a sibling worktree outside the cwd stays visible but unchoosable', async () => {
  const fs = fsOf(new Map([
    ['/w/main', '/w/main'],
    ['/tmp/spike', '/tmp/spike'],
  ]))
  const rows = await worktreeCheckouts(fs, '/w/main', '/w/main', [info('/w/main'), info('/tmp/spike')])
  assert.equal(rows[1].disabled, 'outside', 'only the repository root escapes the cwd')
  assert.equal(rows[1].root, '/tmp/spike', 'the row still shows where it lives')
  assert.ok(rows[1].path.startsWith('../'), 'its selector path is inert: ../ never resolves to a repository')
  assert.equal(rows[1].role, 'linked')
})

test('a prunable row and a vanished directory both report themselves as stale', async () => {
  const fs = fsOf(new Map([['/w/main', '/w/main']]))
  const rows = await worktreeCheckouts(
    fs,
    '/w/main',
    '/w/main',
    [
      info('/w/main'),
      info('/w/main/gone', { prunable: true, branch: 'old' }),
      info('/w/main/vanished'),
    ],
  )
  assert.equal(rows[1].disabled, 'stale', 'prunable must be a disabled row, never a selectable invalid-repo trap')
  assert.equal(rows[1].path, 'gone')
  assert.equal(rows[2].disabled, 'stale', 'listed but gone is the same story')
})

test('bare records are not checkouts', async () => {
  const rows = await worktreeCheckouts(fsOf(new Map()), '/w/main', '/w/main', [info('/srv/git.git', { bare: true, branch: null })])
  assert.deepEqual(rows, [])
})

test('cwd inside a linked worktree: that record is the workspace row, the primary is outside', async () => {
  const fs = fsOf(new Map([
    ['/w/main', '/w/main'],
    ['/w/main/.agents/worktrees/feat/x', '/w/main/.agents/worktrees/feat/x'],
    ['/tmp/spike', '/tmp/spike'],
  ]))
  const rows = await worktreeCheckouts(
    fs,
    '/w/main/.agents/worktrees/feat/x',
    '/w/main/.agents/worktrees/feat/x',
    [info('/w/main'), info('/w/main/.agents/worktrees/feat/x', { branch: 'feat/x' }), info('/tmp/spike')],
  )
  assert.equal(rows[1].path, '', 'the session checkout is whatever the selector resolves to')
  assert.equal(rows[1].role, 'linked', 'it is genuinely a linked worktree, not the primary')
  // The primary is the one directory a selector may reach from outside the cwd,
  // so a stranded worktree session always has a way back.
  assert.equal(rows[0].disabled, undefined, 'the repository root is selectable')
  assert.equal(rows[0].path, '../../../..', 'addressed by its relative path')
  assert.equal(rows[0].role, 'main')
  // A sibling is not: the root is one hop away and lists it inside its own cwd.
  assert.equal(rows[2].disabled, 'outside', 'a sibling checkout stays unchoosable here')
  assert.equal(rows[2].role, 'linked')
})
