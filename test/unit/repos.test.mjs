/**
 * Nested-repository discovery (issue #83): the cwd scan, the cwd-relative
 * selector resolution, and the host endpoints that expose them. Directories are
 * real (temp dir); git calls use a child-process stand-in like the host
 * integration test, so the assertions run against production wiring.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import './_tmp-ceiling.mjs'
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import { listSessionRepos, resolveBrowseRoot, resolveWorkspace } from '../../lib/host/core.js'
import { repoDirFor, scanRepos } from '../../lib/host/repos.js'
import { DEFAULT_CONFIG, createGitRunner, runQuery, snapshotForSession } from '../../lib/host/index.js'

/** child_process-backed subprocess service matching SubprocessLike. */
const subprocess = {
  spawn(spec) {
    const child = nodeSpawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd })
    if (typeof spec.stdio.stdin === 'object') child.stdin.end(spec.stdio.stdin.data)
    else child.stdin.end()
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    const done = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
    })
    return {
      done,
      collected: {
        stdout: { readFrom: () => ({ text: out, lossy: false }) },
        stderr: { readFrom: () => ({ text: err, lossy: false }) },
      },
    }
  },
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const c = nodeSpawn('git', args, { cwd })
    let err = ''
    c.stderr.on('data', (d) => { err += d })
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error('git ' + args.join(' ') + ': ' + err))))
  })
}

/** A deps face locked to `dir`, using the production wiring. */
function depsAt(dir) {
  return {
    run: createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes),
    fs: createFsDeps(),
    sessions: { liveCwd: () => dir, persistedMeta: async () => undefined },
  }
}

const SID = 'test-session'
let tmp
let ws
let outer
let wtRepo

before(async () => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'gp-repos-')))
  ws = join(tmp, 'ws')
  // A plain workspace directory holding repositories instead of being one.
  for (const dir of ['site', 'api', 'group/deep', 'node_modules/pkg', 'a/b/c/d']) {
    mkdirSync(join(ws, dir, '.git'), { recursive: true })
  }
  mkdirSync(join(ws, 'plain'), { recursive: true })

  outer = join(tmp, 'outer')
  mkdirSync(outer)
  await runGit(outer, ['init', '-q'])
  await runGit(outer, ['config', 'user.email', 't@t.co'])
  await runGit(outer, ['config', 'user.name', 'Tester'])
  await runGit(outer, ['commit', '--allow-empty', '-qm', 'init'])
  mkdirSync(join(outer, 'sub'))
  await runGit(join(outer, 'sub'), ['init', '-q'])

  // Scenario B: a repository that owns the cwd and has more checkouts — one
  // inside the cwd (selectable), one outside it (visible but disabled), plus an
  // unrelated repository nested below for the mixed case.
  wtRepo = join(tmp, 'wt-repo')
  mkdirSync(join(wtRepo, '.agents', 'worktrees'), { recursive: true })
  await runGit(wtRepo, ['init', '-q', '-b', 'main'])
  await runGit(wtRepo, ['config', 'user.email', 't@t.co'])
  await runGit(wtRepo, ['config', 'user.name', 'Tester'])
  await runGit(wtRepo, ['commit', '--allow-empty', '-qm', 'init'])
  mkdirSync(join(wtRepo, 'vendor', 'lib', '.git'), { recursive: true })
  await runGit(wtRepo, ['worktree', 'add', '-q', '-b', 'wt-a', join(wtRepo, '.agents', 'worktrees', 'feat-a')])
  await runGit(wtRepo, ['worktree', 'add', '-q', '-b', 'wt-out', join(tmp, 'wt-outside')])
})

after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

test('scanRepos lists repository roots below the cwd and skips dependency dirs', async () => {
  const found = await scanRepos(createFsDeps(), ws)
  assert.deepEqual(found.map((r) => r.path), ['api', 'group/deep', 'site'])
  assert.equal(found[0].name, 'api')
  assert.equal(found[0].root, realpathSync(join(ws, 'api')))
})

test('scanRepos stops at the depth ceiling', async () => {
  // a/b/c/d/.git sits four levels down: the default scan (depth 3) never
  // reaches it, so a deep-but-unrelated tree cannot slow every panel mount.
  const shallow = await scanRepos(createFsDeps(), ws)
  assert.equal(shallow.some((r) => r.path.includes('c/d')), false)
  const deep = await scanRepos(createFsDeps(), ws, { depth: 6 })
  assert.equal(deep.some((r) => r.path === 'a/b/c/d'), true)
})

test('scanRepos honors the result ceiling', async () => {
  const one = await scanRepos(createFsDeps(), ws, { resultLimit: 1 })
  assert.equal(one.length, 1)
})

test('repoDirFor accepts safe cwd-relative paths only', async () => {
  const fs = createFsDeps()
  assert.deepEqual(await repoDirFor(fs, ws, 'site'), { ok: true, dir: realpathSync(join(ws, 'site')) })
  for (const bad of ['', '.', '..', '../outside', 'site/.git', join(ws, 'site'), 'missing']) {
    assert.deepEqual(await repoDirFor(fs, ws, bad), { ok: false }, 'must reject ' + JSON.stringify(bad))
  }
})

test('listSessionRepos reports the workspace repository plus nested ones', async () => {
  const listed = await listSessionRepos(depsAt(outer), SID, true)
  assert.equal(listed.ok, true)
  assert.equal(listed.value.cwd, realpathSync(outer))
  const entries = listed.value.repos.map((r) => [r.path, r.kind, r.name])
  assert.deepEqual(entries, [
    ['', 'workspace', 'outer'],
    ['sub', 'nested', 'sub'],
  ])
})

test('a cwd outside any repository reports only nested repositories', async () => {
  const listed = await listSessionRepos(depsAt(ws), SID, true)
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.repos.map((r) => r.kind), ['nested', 'nested', 'nested'])
})

test('detectCheckouts off skips both probes: the list is the cwd repository alone', async () => {
  const deps = depsAt(wtRepo)
  const runs = []
  const inner = deps.run.run.bind(deps.run)
  deps.run = { run: async (argv, opts) => { runs.push([...argv]); return inner(argv, opts) } }
  const listed = await listSessionRepos(deps, SID, false)
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.repos.map((r) => [r.path, r.kind]), [['', 'workspace']])
  assert.equal(runs.some((argv) => argv.includes('worktree')), false, 'git worktree list never runs')
})

test('detectCheckouts off in a plain workspace lists no repositories at all', async () => {
  const listed = await listSessionRepos(depsAt(ws), SID, false)
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.repos, [], 'the filesystem scan is off, so nothing is offered')
})

test('the repo-list endpoint obeys the probe switch', async () => {
  const off = await runQuery(depsAt(wtRepo), { ...DEFAULT_CONFIG, detectCheckouts: false }, {
    sessionId: SID,
    query: { kind: 'repo-list' },
  })
  assert.equal(off.ok, true)
  assert.deepEqual(off.value.repos.map((r) => r.path), [''])
})

test('repo-list is served by the query endpoint', async () => {
  const res = await runQuery(depsAt(outer), DEFAULT_CONFIG, {
    sessionId: SID,
    query: { kind: 'repo-list' },
  })
  assert.equal(res.ok, true)
  assert.equal(res.value.kind, 'repo-list')
  assert.deepEqual(res.value.repos.map((r) => r.path), ['', 'sub'])
})

test('a snapshot samples the selected nested repository', async () => {
  const snap = await snapshotForSession(depsAt(outer), DEFAULT_CONFIG, SID, { repo: 'sub' })
  assert.equal(snap.ok, true)
  assert.equal(snap.value.root, realpathSync(join(outer, 'sub')))
})

test('an unknown or escaping selector fails as invalid-repo', async () => {
  for (const repo of ['missing', '../outer/sub', join(outer, 'sub')]) {
    const resolved = await resolveWorkspace(depsAt(outer), SID, repo)
    assert.equal(resolved.ok, false, 'must reject ' + JSON.stringify(repo))
    assert.equal(resolved.failure.error.code, 'invalid-repo')
    const snap = await snapshotForSession(depsAt(outer), DEFAULT_CONFIG, SID, { repo })
    assert.equal(snap.ok, false)
    assert.equal(snap.error.code, 'invalid-repo')
  }
})

test('a directory that is not a repository fails as invalid-repo', async () => {
  mkdirSync(join(outer, 'plain'), { recursive: true })
  const snap = await snapshotForSession(depsAt(outer), DEFAULT_CONFIG, SID, { repo: 'plain' })
  assert.equal(snap.ok, false)
  assert.equal(snap.error.code, 'invalid-repo')
})

test('a stale selector fails instead of browsing the workspace', async () => {
  // The file tree follows the panel: a selector the host rejects must not decay
  // into "browse the cwd" — that tree is a different one, and the list would
  // still mark another entry as current.
  mkdirSync(join(outer, 'plain'), { recursive: true })
  const browsed = await resolveBrowseRoot(depsAt(outer), SID, 'plain')
  assert.equal(browsed.ok, false)
  assert.equal(browsed.error.code, 'invalid-repo')
})

test('without git, file listings fall back to the cwd even with a selector', async () => {
  // Nothing can confirm a selector when git never runs; rejecting every listing
  // would leave the browser dead with no way back to the default repository.
  // The selector cannot make this worse than the unselected case, so both fall
  // back to the plain cwd.
  const deps = depsAt(outer)
  deps.run = { run: async () => { throw new Error('spawn git ENOENT') } }
  for (const repo of [undefined, 'sub']) {
    const browsed = await resolveBrowseRoot(deps, SID, repo)
    assert.equal(browsed.ok, true, 'must browse with repo ' + JSON.stringify(repo))
    assert.equal(browsed.root, realpathSync(outer))
    assert.equal(browsed.isGitRepo, false)
  }
})

test('a symlink escaping the workspace cannot become a repository', async (t) => {
  // repoDirFor is the one door from a wire path to a directory git runs in: a
  // link must be resolved and rejected when its real target is outside the cwd,
  // or the panel would read (and write) a work tree the session never owned.
  const outside = join(tmp, 'outside')
  mkdirSync(join(outside, '.git'), { recursive: true })
  const link = join(ws, 'escape')
  try {
    symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip('symlinks are unavailable here: ' + error.message)
    return
  }
  try {
    const fs = createFsDeps()
    // The scan cannot offer it: the entry is not a directory to descend into,
    // and its real target is not inside the cwd.
    const scanned = await scanRepos(fs, ws)
    assert.equal(scanned.some((r) => r.path === 'escape'), false)
    // A hand-written selector cannot reach it either.
    assert.deepEqual(await repoDirFor(fs, ws, 'escape'), { ok: false })
    const resolved = await resolveWorkspace(depsAt(ws), SID, 'escape')
    assert.equal(resolved.ok, false)
    assert.equal(resolved.failure.error.code, 'invalid-repo')
    const snap = await snapshotForSession(depsAt(ws), DEFAULT_CONFIG, SID, { repo: 'escape' })
    assert.equal(snap.ok, false)
    assert.equal(snap.error.code, 'invalid-repo')
  } finally {
    rmSync(link, { recursive: true, force: true })
  }
})

test('a repository lists its family: workspace, worktrees inside, worktrees outside, foreign repos', async () => {
  const listed = await listSessionRepos(depsAt(wtRepo), SID, true)
  assert.equal(listed.ok, true)
  const rows = listed.value.repos
  assert.deepEqual(rows.map((r) => r.path), ['', '.agents/worktrees/feat-a', '../wt-outside', 'vendor/lib'])

  // The workspace row carries the family identity git reported for it.
  assert.equal(rows[0].kind, 'workspace')
  assert.equal(rows[0].role, 'main')
  assert.equal(rows[0].branch, 'main')

  // Inside the cwd: selectable, with the branch for free — the reason scenario
  // B does not depend on the filesystem scan's depth ceiling.
  assert.equal(rows[1].kind, 'nested')
  assert.equal(rows[1].role, 'linked')
  assert.equal(rows[1].branch, 'wt-a')
  assert.equal(rows[1].disabled, undefined)

  // Outside the cwd subtree: visible so the user can see it exists, disabled so
  // its selector (a ../ path) can never be sent, with the branch still shown.
  assert.equal(rows[2].disabled, 'outside')
  assert.equal(rows[2].role, 'linked')
  assert.equal(rows[2].branch, 'wt-out')
  assert.equal(rows[2].path, '../wt-outside')

  // An unrelated repository below the cwd keeps the old behavior: kind nested,
  // no branch claim (nobody sampled it).
  assert.equal(rows[3].kind, 'nested')
  assert.equal(rows[3].role, 'repo')
  assert.equal(rows[3].branch, undefined)
})

test('a worktree directory is claimed once, never re-listed as a nested repository', async () => {
  const listed = await listSessionRepos(depsAt(wtRepo), SID, true)
  assert.equal(listed.ok, true)
  const same = listed.value.repos.filter((r) => r.path === '.agents/worktrees/feat-a')
  assert.equal(same.length, 1, 'the scanner reads a worktree .git file, but git already owns that row')
})

test('when git worktree list fails, discovery degrades to the plain scan', async () => {
  // An old git, a broken worktree admin dir or any other refusal must cost
  // exactly the worktree data — never the list itself (PR #85 behavior).
  const deps = depsAt(wtRepo)
  const inner = deps.run.run.bind(deps.run)
  deps.run = {
    run: async (argv, opts) => {
      if (argv.includes('worktree')) throw new Error('git worktree is unsupported here')
      return inner(argv, opts)
    },
  }
  const listed = await listSessionRepos(deps, SID, true)
  assert.equal(listed.ok, true)
  const rows = listed.value.repos
  const workspace = rows.find((r) => r.path === '')
  assert.equal(workspace.kind, 'workspace')
  assert.equal(workspace.role, undefined, 'no worktree data means no identity claim')
  assert.equal(workspace.branch, undefined)
  // The worktree directory falls back to what the scan sees — a nested row with
  // a .git file, selectable but carrying no family information.
  const degraded = rows.find((r) => r.path === '.agents/worktrees/feat-a')
  assert.equal(degraded.kind, 'nested')
  assert.equal(degraded.role, 'repo')
})

test('a git that refuses -z still reports its worktrees through the newline form', async () => {
  const deps = depsAt(wtRepo)
  const inner = deps.run.run.bind(deps.run)
  const seen = []
  deps.run = {
    run: async (argv, opts) => {
      if (argv.includes('worktree')) seen.push(argv.join(' '))
      if (argv.includes('worktree') && argv.includes('-z')) {
        return { exitCode: 129, stdout: '', stderr: 'error: unknown switch `z\'', timedOut: false, cancelled: false, stdoutLossy: false }
      }
      return inner(argv, opts)
    },
  }
  const listed = await listSessionRepos(deps, SID, true)
  assert.equal(listed.ok, true)
  assert.deepEqual(seen, ['git worktree list --porcelain -z', 'git worktree list --porcelain'], 'the NUL form first, the newline form as the fallback')
  const linked = listed.value.repos.find((r) => r.path === '.agents/worktrees/feat-a')
  assert.equal(linked.role, 'linked', 'the fallback keeps the family identity')
  assert.equal(linked.branch, 'wt-a')
})

test('a worktree path holding a newline is one row, not a phantom of its prefix', async (t) => {
  const odd = join(wtRepo, 'docs\nevil')
  try {
    await runGit(wtRepo, ['worktree', 'add', '-q', '-b', 'nl-b', odd])
  } catch {
    t.skip('this filesystem refuses a newline in a directory name')
    return
  }
  mkdirSync(join(wtRepo, 'docs'), { recursive: true })
  try {
    const listed = await listSessionRepos(depsAt(wtRepo), SID, true)
    assert.equal(listed.ok, true)
    const rows = listed.value.repos
    assert.equal(rows.some((r) => r.path === 'docs'), false, 'the plain docs directory is no worktree')
    const nl = rows.find((r) => r.path === 'docs\nevil')
    assert.equal(nl?.role, 'linked', 'the real worktree keeps its identity')
    assert.equal(nl?.branch, 'nl-b')
  } finally {
    await runGit(wtRepo, ['worktree', 'remove', '--force', odd])
    rmSync(join(wtRepo, 'docs'), { recursive: true, force: true })
  }
})

test('a shallow worktree does not use up the scan slot a deeper repository needs', async () => {
  const repo = join(tmp, 'quota-repo')
  mkdirSync(repo)
  await runGit(repo, ['init', '-q', '-b', 'main'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'init'])
  // BFS meets the worktree (depth 1) before the foreign repository (depth 2).
  await runGit(repo, ['worktree', 'add', '-q', '-b', 'wt', join(repo, 'a-wt')])
  mkdirSync(join(repo, 'z', 'lib', '.git'), { recursive: true })
  const listed = await listSessionRepos(depsAt(repo), SID, true, 2)
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.repos.map((r) => [r.path, r.role]), [['', 'main'], ['a-wt', 'linked'], ['z/lib', 'repo']],
    'one worktree row plus one scanned repository fill a ceiling of two')
  const tight = await listSessionRepos(depsAt(repo), SID, true, 1)
  assert.deepEqual(tight.value.repos.map((r) => r.path), ['', 'a-wt'], 'the worktree rows alone may fill the ceiling')
})
