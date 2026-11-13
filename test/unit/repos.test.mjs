/**
 * Nested-repository discovery (issue #83): the cwd scan, the cwd-relative
 * selector resolution, and the host endpoints that expose them. Directories are
 * real (temp dir); git calls use a child-process stand-in like the host
 * integration test, so the assertions run against production wiring.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import './_tmp-ceiling.mjs'
import { linkOrSkip } from './_fs-helpers.mjs'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import { listSessionRepos, resolveBrowseRoot, resolveWorkspace } from '../../lib/host/core.js'
import { repoDirCertified, repoDirExternal, repoDirFor, scanRepos } from '../../lib/host/repos.js'
import { DEFAULT_CONFIG, normalizeConfig, runAction, runQuery, snapshotForSession } from '../../lib/host/index.js'
import { gitRunner, runGit } from './_git-fixture.mjs'

/** A deps face locked to `dir`, using the production wiring. */
function depsAt(dir) {
  return {
    run: gitRunner(),
    fs: createFsDeps(),
    sessions: { liveCwd: () => dir, persistedMeta: async () => undefined },
  }
}

const SID = 'test-session'
let tmp
let ws
let outer
let wtRepo
let hub

before(async () => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gp-repos-')))
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

  // Scenario C (issue #121): a hub directory whose project model is a
  // `.code-workspace` file naming repositories beside it. `other` is a sibling
  // the file does not name, so it must stay unreachable.
  hub = join(tmp, 'hub')
  mkdirSync(hub, { recursive: true })
  mkdirSync(join(hub, 'inner'), { recursive: true })
  await runGit(join(hub, 'inner'), ['init', '-q'])
  mkdirSync(join(tmp, 'other'), { recursive: true })
  await runGit(join(tmp, 'other'), ['init', '-q'])
  writeFileSync(join(hub, 'hub.code-workspace'), JSON.stringify({
    folders: [
      { path: '../outer', name: 'api' },
      { path: '../wt-repo' },
      { path: 'inner' },
      { path: '..' },
    ],
  }))
})

after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

test('scanRepos lists repository roots below the cwd and skips dependency dirs', async () => {
  const found = await scanRepos(createFsDeps(), ws)
  assert.deepEqual(found.map((r) => r.path), ['api', 'group/deep', 'site'])
  assert.equal(found[0].name, 'api')
  assert.equal(found[0].root, realpathSync.native(join(ws, 'api')))
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
  assert.deepEqual(await repoDirFor(fs, ws, 'site'), { ok: true, dir: realpathSync.native(join(ws, 'site')) })
  for (const bad of ['', '.', '..', '../outside', 'site/.git', join(ws, 'site'), 'missing']) {
    assert.deepEqual(await repoDirFor(fs, ws, bad), { ok: false }, 'must reject ' + JSON.stringify(bad))
  }
})

test('listSessionRepos reports the workspace repository plus nested ones', async () => {
  const listed = await listSessionRepos(depsAt(outer), SID, true)
  assert.equal(listed.ok, true)
  assert.equal(listed.value.cwd, realpathSync.native(outer))
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

test('repo-list spends the configured ceiling', async () => {
  // Twelve repository roots so the normalized minimum (10) is observable: this
  // pins config.repoLimit through the whole endpoint, not just the raw
  // argument, while normalizeConfig (host-integration) owns the 10–100 clamp.
  const many = join(tmp, 'many')
  for (let i = 0; i < 12; i += 1) mkdirSync(join(many, `r${String(i).padStart(2, '0')}`, '.git'), { recursive: true })
  const capped = await runQuery(depsAt(many), normalizeConfig({ repoLimit: 10 }), {
    sessionId: SID,
    query: { kind: 'repo-list' },
  })
  assert.equal(capped.ok, true)
  assert.equal(capped.value.repos.length, 10, 'the list stops at the configured ceiling')
  const full = await runQuery(depsAt(many), DEFAULT_CONFIG, {
    sessionId: SID,
    query: { kind: 'repo-list' },
  })
  assert.equal(full.ok, true)
  assert.equal(full.value.repos.length, 12, 'the default ceiling leaves this workspace whole')
})

test('a snapshot samples the selected nested repository', async () => {
  const snap = await snapshotForSession(depsAt(outer), DEFAULT_CONFIG, SID, { repo: 'sub' })
  assert.equal(snap.ok, true)
  assert.equal(snap.value.root, realpathSync.native(join(outer, 'sub')))
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
    assert.equal(browsed.root, realpathSync.native(outer))
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
  if (!linkOrSkip(t, outside, link, 'dir')) return
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
  // Every row is selectable now (ADR-0035), so the family sorts by path: the
  // workspace row first, then the checkouts git listed, then the scan's.
  assert.deepEqual(rows.map((r) => r.path), ['', '../wt-outside', '.agents/worktrees/feat-a', 'vendor/lib'])

  const byPath = new Map(rows.map((row) => [row.path, row]))

  // The workspace row carries the family identity git reported for it.
  const workspaceRow = byPath.get('')
  assert.equal(workspaceRow.kind, 'workspace')
  assert.equal(workspaceRow.role, 'main')
  assert.equal(workspaceRow.branch, 'main')

  // Inside the cwd: selectable, with the branch for free — the reason scenario
  // B does not depend on the filesystem scan's depth ceiling.
  const inside = byPath.get('.agents/worktrees/feat-a')
  assert.equal(inside.kind, 'nested')
  assert.equal(inside.role, 'linked')
  assert.equal(inside.branch, 'wt-a')
  assert.equal(inside.disabled, undefined)

  // Outside the cwd: a checkout of this same repository, so its record
  // certifies it and the row is choosable — with the branch for free.
  const outside = byPath.get('../wt-outside')
  assert.equal(outside.disabled, undefined, 'a worktree of the own repository is choosable')
  assert.equal(outside.role, 'linked')
  assert.equal(outside.branch, 'wt-out')

  // An unrelated repository below the cwd keeps the old behavior: kind nested,
  // no branch claim (nobody sampled it).
  const foreign = byPath.get('vendor/lib')
  assert.equal(foreign.kind, 'nested')
  assert.equal(foreign.role, 'repo')
  assert.equal(foreign.branch, undefined)
})

test('a worktree session lists the repository root as a choosable row', async () => {
  // The session moved into the linked worktree, so the workspace row is the
  // worktree itself and the main checkout sits above the cwd. That one row is
  // what keeps the panel from being stranded; every other checkout outside the
  // cwd stays unchoosable (it is one hop from the root).
  const inWorktree = join(wtRepo, '.agents', 'worktrees', 'feat-a')
  const listed = await listSessionRepos(depsAt(inWorktree), SID, true)
  assert.equal(listed.ok, true)
  const rows = listed.value.repos
  assert.deepEqual(rows.map((r) => r.path), ['', '../../..', '../../../../wt-outside'])

  const own = rows[0]
  assert.equal(own.kind, 'workspace')
  assert.equal(own.role, 'linked', 'the session checkout is the linked worktree')

  const root = rows[1]
  assert.equal(root.role, 'main')
  assert.equal(root.name, 'wt-repo')
  assert.equal(root.disabled, undefined, 'the repository root is choosable')

  const sibling = rows[2]
  assert.equal(sibling.role, 'linked')
  assert.equal(sibling.disabled, undefined, 'a sibling checkout is a record of the same repository')
})

test('a selector may leave the cwd for any checkout git reports', async () => {
  // The session's own checkout is the worktree; the primary work tree is its
  // parent. Selecting it is what lets a worktree session go back — and it is
  // the only directory a selector may reach from outside the cwd.
  const inWorktree = join(wtRepo, '.agents', 'worktrees', 'feat-a')
  const deps = depsAt(inWorktree)

  const back = await resolveWorkspace(deps, SID, '../../..')
  assert.equal(back.ok, true, 'the repository root is reachable from a linked worktree')
  assert.equal(back.root, realpathSync.native(wtRepo))

  // From the root the family is inside its cwd again — the way down needs no
  // second door. The one checkout above the root stays unchoosable from there
  // too: it is outside every cwd the panel ever holds.
  const fromRoot = depsAt(wtRepo)
  const down = await resolveWorkspace(fromRoot, SID, '.agents/worktrees/feat-a')
  assert.equal(down.ok, true, 'a worktree below the root is an ordinary nested selector')
  assert.equal(down.root, realpathSync.native(inWorktree))
  const above = await resolveWorkspace(fromRoot, SID, '../wt-outside')
  assert.equal(above.ok, true, 'a sibling worktree is a record of the same repository')
  assert.equal(above.root, realpathSync.native(join(tmp, 'wt-outside')))

  // Everything else stays refused: an unrelated repository, the plain parent
  // directory, an absolute path, and a traversal on nothing.
  const outside = [
    '../../../../group',            // a plain directory above the repository
    '../../../../../',              // the temp root
    '../..',                        // the repository's own .agents directory
    join(wtRepo),                   // absolute paths are not selectors
    'missing',
  ]
  for (const bad of outside) {
    const ws = await resolveWorkspace(deps, SID, bad)
    assert.equal(ws.ok, false, 'must refuse ' + JSON.stringify(bad))
    assert.equal(ws.failure.error.code, 'invalid-repo', JSON.stringify(bad))
  }
})

test('repoDirCertified itself refuses a selector landing inside the cwd', async () => {
  // resolveWorkspace asks repoDirFor first, so an inside-cwd path is claimed by
  // that door before the certified one sees it. This calls the certified door
  // directly to pin its own guarantee: a selector resolving inside the cwd is
  // refused there too — the two doors partition the path space, they do not
  // overlap.
  const inWorktree = join(wtRepo, '.agents', 'worktrees', 'feat-a')
  const fs = createFsDeps()
  const root = realpathSync.native(wtRepo)
  const sibling = realpathSync.native(join(tmp, 'wt-outside'))
  const roots = [root, sibling]
  for (const inside of ['subdir', '..', '../..']) {
    const res = await repoDirCertified(fs, inWorktree, inside, roots)
    assert.equal(res.ok, false, 'must refuse ' + JSON.stringify(inside))
  }
  const admitted = await repoDirCertified(fs, inWorktree, '../../..', roots)
  assert.equal(admitted.ok, true, 'the repository root itself is admitted')
  assert.equal(admitted.dir, root)
  const other = await repoDirCertified(fs, inWorktree, '../../../../wt-outside', roots)
  assert.equal(other.ok, true, 'so is any other checkout git listed for the repository')
  assert.equal(other.dir, sibling)
  // An empty set admits nothing: the door has no source of truth to compare to.
  const none = await repoDirCertified(fs, inWorktree, '../../..', [])
  assert.equal(none.ok, false)
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


// ── external roots from a .code-workspace file (issue #121, ADR-0030) ──────

/** The hub config: the workspace file is discovered, not named. */
const HUB_CONFIG = { ...DEFAULT_CONFIG, codeWorkspace: 'auto' }

test('repoDirExternal admits only an allow-listed directory outside the cwd', async () => {
  const fs = createFsDeps()
  const allow = [realpathSync.native(outer), realpathSync.native(wtRepo)]
  assert.deepEqual(await repoDirExternal(fs, hub, '../outer', allow), { ok: true, dir: realpathSync.native(outer) })
  for (const bad of ['', '.', '..', 'inner', '../other', '../outer/sub', join(outer), realpathSync.native(outer), '../outer/.git']) {
    assert.deepEqual(
      await repoDirExternal(fs, hub, bad, allow),
      { ok: false },
      'must refuse ' + JSON.stringify(bad),
    )
  }
})

test('the workspace file adds external rows the scan cannot reach', async () => {
  const listed = await listSessionRepos(depsAt(hub), SID, true, undefined, 'auto')
  assert.equal(listed.ok, true)
  const rows = listed.value.repos.map((r) => [r.path, r.kind])
  assert.deepEqual(rows, [
    ['inner', 'nested'],
    ['../outer', 'external'],
    ['../wt-repo', 'external'],
  ])
  const api = listed.value.repos.find((r) => r.path === '../outer')
  assert.equal(api.label, 'api', 'folders[].name becomes the row label')
  assert.equal(api.role, 'repo')
  assert.equal(api.name, 'outer')
})

test('repo-list reports how the workspace file was recognised', async () => {
  const applied = await listSessionRepos(depsAt(hub), SID, true, undefined, 'auto')
  assert.equal(applied.ok, true)
  assert.deepEqual(applied.value.codeWorkspace, {
    state: 'applied',
    file: realpathSync.native(join(hub, 'hub.code-workspace')),
    // How many roots the file produced. The client needs it because a root the
    // list already carries (a worktree of the session's own repository) merges
    // into that row instead of adding an `external` one, so the rows alone
    // cannot tell "names nothing" from "names something already listed".
    roots: 2,
  })

  // `off` with a workspace file in the cwd is no longer silent: the switcher
  // offers to turn the feature on instead of hiding that the file exists
  // (ADR-0035). Nothing is enabled by the state itself.
  const off = await listSessionRepos(depsAt(hub), SID, true, undefined, 'off')
  assert.equal(off.ok, true)
  assert.deepEqual(off.value.codeWorkspace, {
    state: 'available',
    file: realpathSync.native(join(hub, 'hub.code-workspace')),
    count: 1,
  })
  assert.equal(off.value.repos.some((row) => row.kind === 'external'), false, 'an offer adds no roots')

  // A cwd with no workspace file stays silent under `off`: there is nothing to
  // offer, and "not configured" is not a failure.
  const silent = await listSessionRepos(depsAt(ws), SID, true, undefined, 'off')
  assert.equal(silent.ok, true)
  assert.equal(silent.value.codeWorkspace, undefined)

  const missing = await listSessionRepos(depsAt(hub), SID, true, undefined, 'typo.code-workspace')
  assert.equal(missing.ok, true)
  assert.equal(missing.value.codeWorkspace?.state, 'missing')
  assert.equal(missing.value.codeWorkspace?.file, join(realpathSync.native(hub), 'typo.code-workspace'))

  const invalid = await listSessionRepos(depsAt(hub), SID, true, undefined, '../outside.code-workspace')
  assert.equal(invalid.ok, true)
  assert.equal(invalid.value.codeWorkspace?.state, 'invalid')
  assert.equal(invalid.value.codeWorkspace?.file, undefined)
})

test('the repo-list query carries the recognition state to the client', async () => {
  // `runQuery` is the only path the panel fetches repo-list through: a field
  // dropped while rebuilding the value never reaches anyone.
  const applied = await runQuery(depsAt(hub), HUB_CONFIG, { sessionId: SID, query: { kind: 'repo-list' } })
  assert.equal(applied.ok, true)
  assert.equal(applied.value.kind, 'repo-list')
  assert.equal(applied.value.codeWorkspace?.state, 'applied')
  assert.equal(applied.value.codeWorkspace?.file, realpathSync.native(join(hub, 'hub.code-workspace')))
  assert.equal(applied.value.repos.some((row) => row.kind === 'external'), true)

  const typo = await runQuery(depsAt(hub), { ...DEFAULT_CONFIG, codeWorkspace: 'typo.code-workspace' }, {
    sessionId: SID,
    query: { kind: 'repo-list' },
  })
  assert.equal(typo.ok, true)
  assert.equal(typo.value.codeWorkspace?.state, 'missing')
})

test('the setting keeps a malformed value so the session can report it', () => {
  assert.equal(normalizeConfig({}).codeWorkspace, 'off')
  assert.equal(normalizeConfig({ codeWorkspace: 'auto' }).codeWorkspace, 'auto')
  assert.equal(normalizeConfig({ codeWorkspace: '  hub.code-workspace ' }).codeWorkspace, 'hub.code-workspace')
  assert.equal(normalizeConfig({ codeWorkspace: 'hub.json' }).codeWorkspace, 'hub.json', 'a typo is reported, not coerced to off')
  assert.equal(normalizeConfig({ codeWorkspace: '' }).codeWorkspace, 'off')
})

test('the workspace file stays off by default', async () => {
  const listed = await listSessionRepos(depsAt(hub), SID, true)
  assert.deepEqual(listed.value.repos.map((r) => [r.path, r.kind]), [['inner', 'nested']])
})

test('an external root is selectable only when the setting is on', async () => {
  const on = await snapshotForSession(depsAt(hub), HUB_CONFIG, SID, { repo: '../outer' })
  assert.equal(on.ok, true)
  assert.equal(on.value.root, realpathSync.native(outer))

  const off = await snapshotForSession(depsAt(hub), DEFAULT_CONFIG, SID, { repo: '../outer' })
  assert.equal(off.ok, false)
  assert.equal(off.error.code, 'invalid-repo')
})

test('the allow-list is compared by realpath equality, not by prefix', async () => {
  // `outer-extra` shares the `outer` prefix: a startsWith-based membership test
  // would admit it. The door must not.
  const near = join(tmp, 'outer-extra')
  mkdirSync(near, { recursive: true })
  await runGit(near, ['init', '-q'])
  const allow = [realpathSync.native(outer)]
  assert.deepEqual(await repoDirExternal(createFsDeps(), hub, '../outer-extra', allow), { ok: false })
})

test('a sibling the workspace file does not name stays unreachable', async () => {
  // `other` exists next to the hub and is a repository, but no folder entry
  // names it: the selector must fail rather than let a `..` guess a directory.
  const snap = await snapshotForSession(depsAt(hub), HUB_CONFIG, SID, { repo: '../other' })
  assert.equal(snap.ok, false)
  assert.equal(snap.error.code, 'invalid-repo')
})

test('a symlink inside the cwd cannot stand in for an external selector', async (t) => {
  if (!linkOrSkip(t, join(tmp, 'other'), join(hub, 'linked'), 'dir')) return
  for (const repo of ['linked', '../linked']) {
    const snap = await snapshotForSession(depsAt(hub), HUB_CONFIG, SID, { repo })
    assert.equal(snap.ok, false, 'must refuse ' + repo)
    assert.equal(snap.error.code, 'invalid-repo')
  }
})

test('the file browser follows an external root', async () => {
  writeFileSync(join(outer, 'notes.md'), '# notes\n')
  const browsed = await resolveBrowseRoot(depsAt(hub), SID, '../outer', 'auto')
  assert.equal(browsed.ok, true)
  assert.equal(browsed.root, realpathSync.native(outer))
  assert.equal(browsed.isGitRepo, true)

  const listed = await runQuery(depsAt(hub), HUB_CONFIG, {
    sessionId: SID,
    repo: '../outer',
    query: { kind: 'dir-list', path: '' },
  })
  assert.equal(listed.ok, true)
  assert.ok(listed.value.entries.some((entry) => entry.name === 'notes.md'))
})

test('a file inside an external root is readable, a traversal path is not', async () => {
  const ok = await runQuery(depsAt(hub), HUB_CONFIG, {
    sessionId: SID,
    repo: '../outer',
    query: { kind: 'file-content', path: 'notes.md' },
  })
  assert.equal(ok.ok, true)
  assert.match(ok.value.content, /notes/)

  for (const path of ['../other/notes.md', join(tmp, 'other', 'notes.md')]) {
    const bad = await runQuery(depsAt(hub), HUB_CONFIG, {
      sessionId: SID,
      repo: '../outer',
      query: { kind: 'file-content', path },
    })
    assert.equal(bad.ok, false, 'must refuse ' + path)
    assert.equal(bad.error.code, 'invalid-path')
  }
})

test('the endpoint drops an external row once the workspace file stops naming it', async () => {
  const deps = depsAt(hub)
  deps.codeWorkspaceCache = new Map()
  const before = await listSessionRepos(deps, SID, true, undefined, 'auto')
  assert.equal(before.ok, true)
  assert.equal(before.value.repos.some((r) => r.path === '../outer'), true)

  writeFileSync(join(hub, 'hub.code-workspace'), JSON.stringify({ folders: [{ path: '../wt-repo' }] }))
  const after = await listSessionRepos(deps, SID, true, undefined, 'auto')
  assert.equal(after.ok, true)
  assert.equal(after.value.repos.some((r) => r.path === '../outer'), false, 'the removed entry is gone')
  const rejected = await snapshotForSession(deps, HUB_CONFIG, SID, { repo: '../outer' })
  assert.equal(rejected.ok, false)
  assert.equal(rejected.error.code, 'invalid-repo')

  // Restore for the tests that follow.
  writeFileSync(join(hub, 'hub.code-workspace'), JSON.stringify({
    folders: [{ path: '../outer', name: 'api' }, { path: '../wt-repo' }, { path: 'inner' }, { path: '..' }],
  }))
})

test('a commit inside an external repository goes through the selected root', async () => {
  writeFileSync(join(outer, 'committed.txt'), 'external work\n')
  const staged = await runAction(depsAt(hub), HUB_CONFIG, {
    sessionId: SID,
    repo: '../outer',
    action: { kind: 'stage', paths: ['committed.txt'] },
  })
  assert.equal(staged.ok, true)
  const committed = await runAction(depsAt(hub), HUB_CONFIG, {
    sessionId: SID,
    repo: '../outer',
    action: { kind: 'commit', message: 'chore: external commit', paths: ['committed.txt'] },
  })
  assert.equal(committed.ok, true)
  const snap = await snapshotForSession(depsAt(hub), HUB_CONFIG, SID, { repo: '../outer' })
  assert.equal(snap.ok, true)
  assert.equal(snap.value.lastCommit?.subject, 'chore: external commit')
  assert.equal(
    snap.value.changes.some((change) => change.path === 'committed.txt'),
    false,
    'the committed file left the change list',
  )
})

test('the off setting offers every workspace file the cwd holds, and names none of several', async () => {
  const two = join(tmp, 'two-candidates')
  mkdirSync(two, { recursive: true })
  writeFileSync(join(two, 'a.code-workspace'), '{"folders":[]}')
  writeFileSync(join(two, 'b.code-workspace'), '{"folders":[]}')
  const listed = await listSessionRepos(depsAt(two), SID, true, undefined, 'off')
  assert.equal(listed.ok, true)
  assert.deepEqual(listed.value.codeWorkspace, { state: 'available', count: 2 }, 'no single file to name')
  // A directory named like a workspace file is not one: the shape is the same
  // rule discovery applies, so the offer cannot advertise a directory.
  rmSync(join(two, 'b.code-workspace'))
  mkdirSync(join(two, 'b.code-workspace'))
  const one = await listSessionRepos(depsAt(two), SID, true, undefined, 'off')
  assert.equal(one.value.codeWorkspace?.count, 1)
  assert.equal(one.value.codeWorkspace?.state, 'available')
})

test('a workspace file label lands on the worktree row it names', async () => {
  const root = join(tmp, 'label-fixture')
  const app = join(root, 'app')
  const wt = join(root, 'wt')
  mkdirSync(app, { recursive: true })
  await runGit(app, ['init', '-q', '-b', 'main'])
  await runGit(app, ['config', 'user.email', 't@t.co'])
  await runGit(app, ['config', 'user.name', 'Tester'])
  await runGit(app, ['commit', '--allow-empty', '-qm', 'init'])
  await runGit(app, ['worktree', 'add', '-q', '-b', 'wt', wt])
  writeFileSync(join(app, 'app.code-workspace'), JSON.stringify({ folders: [{ path: '../wt', name: 'FEATURE' }] }))

  const listed = await listSessionRepos(depsAt(app), SID, true, undefined, 'auto')
  assert.equal(listed.ok, true)
  const row = listed.value.repos.find((entry) => entry.root === realpathSync.native(wt))
  assert.ok(row, 'the worktree is one row')
  assert.equal(row.role, 'linked', 'it stays a checkout of the session repository')
  assert.equal(row.kind, 'nested', 'the list says where it came from; not a foreign repository')
  assert.equal(row.label, 'FEATURE', 'the editor name wins over the directory name')
  const duplicates = listed.value.repos.filter((entry) => entry.root === realpathSync.native(wt))
  assert.equal(duplicates.length, 1, 'one root is one row, whichever sources name it')
})

test('the certified set is read once per window, not per request', async () => {
  const deps = { ...depsAt(wtRepo), worktreeCache: new Map() }
  const spawns = []
  const inner = deps.run.run.bind(deps.run)
  deps.run = { run: async (argv, opts) => { if (argv[1] === 'worktree') spawns.push([...argv]); return inner(argv, opts) } }
  const first = await resolveWorkspace(deps, SID, '../wt-outside')
  assert.equal(first.ok, true)
  const second = await resolveWorkspace(deps, SID, '../wt-outside')
  assert.equal(second.ok, true)
  assert.equal(spawns.length, 1, 'the second resolve serves the cached set')

  // Without the cache the answer is the same; only the spawn count differs.
  const uncached = depsAt(wtRepo)
  const again = await resolveWorkspace(uncached, SID, '../wt-outside')
  assert.equal(again.ok, true)
  assert.equal(again.root, first.root)
})

test('a workspace file that is a symlink out of the cwd is not offered', async (t) => {
  const root = join(tmp, 'link-offer')
  mkdirSync(root, { recursive: true })
  const outside = join(tmp, 'outside.code-workspace')
  writeFileSync(outside, '{"folders":[]}')
  const link = join(root, 'sneaky.code-workspace')
  const linked = linkOrSkip(t, outside, link)
  if (linked) {
    const listed = await listSessionRepos(depsAt(root), SID, true, undefined, 'off')
    assert.equal(listed.value.codeWorkspace, undefined, 'a link out of the cwd is not a candidate')
  }
  // The real file next to it still is: the offer is per file, not all-or-nothing.
  writeFileSync(join(root, 'real.code-workspace'), '{"folders":[]}')
  const again = await listSessionRepos(depsAt(root), SID, true, undefined, 'off')
  assert.equal(again.value.codeWorkspace?.state, 'available')
  assert.equal(again.value.codeWorkspace?.count, 1)
})

// ── Certification identity (ADR-0035) ─────────────────────────────────────────
// A record is not evidence: `git worktree list` replays the path a plain writable
// file names. These pin what makes a checkout this repository's own.

/** A deps face with the two caches the host wires in production. */
function cachedDepsAt(dir) {
  return { ...depsAt(dir), worktreeCache: new Map(), rootNegCache: new Map() }
}

/** A path as git writes it in a `gitdir:` line or a record: forward slashes,
 * on every platform. */
function gitPath(path) {
  return path.split(sep).join('/')
}

/** Replace a record git owns. git marks its `gitdir` records read-only, which
 * Windows refuses to open for writing — clearing the write bit first is exactly
 * what a hand-edit (or a copy that landed on another machine) does. */
function overwriteGitFile(path, text) {
  chmodSync(path, 0o644)
  writeFileSync(path, text)
}

/** Point a repository record at another directory, the way a hand-written or
 * copied `.git/worktrees/<id>/gitdir` does. */
function repointRecord(commonDir, id, targetDir) {
  overwriteGitFile(join(commonDir, 'worktrees', id, 'gitdir'), gitPath(join(targetDir, '.git')) + '\n')
}

test('a record naming another repository is not certified', async () => {
  const root = join(tmp, 'identity')
  const repo = join(root, 'repo')
  const victim = join(root, 'victim')
  const worktree = join(root, 'wt')
  mkdirSync(repo, { recursive: true })
  await runGit(repo, ['init', '-q', '-b', 'main'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'init'])
  mkdirSync(victim, { recursive: true })
  await runGit(victim, ['init', '-q', '-b', 'main'])
  await runGit(repo, ['worktree', 'add', '-q', '--detach', worktree])

  // The attack: a record claims a directory this repository does not own. git
  // replays whatever the record says, so `git worktree list` names the victim;
  // the checkout's own `.git` is a plain clone's directory, not a record under
  // this repository's `worktrees/`, so the identity check refuses it.
  repointRecord(join(repo, '.git'), basename(worktree), victim)
  const deps = cachedDepsAt(repo)
  const rows = (await listSessionRepos(deps, SID, true, undefined, 'off')).value.repos
  const claimed = rows.find((entry) => entry.root === realpathSync.native(victim))
  // git may decline to replay a record whose target it cannot accept on this
  // platform; the security property is the refusal below, which holds either way.
  if (claimed !== undefined) {
    assert.equal(claimed.disabled, 'uncertified', 'the row states why the door will refuse it')
  }
  assert.equal((await resolveWorkspace(deps, SID, '../victim')).ok, false, 'the door refuses a repository this one does not own')

  // The same substitution from the other side: the record is genuine, the
  // checkout's `.git` was rewritten to point at the other repository. The row
  // is still listed by git and must be unchoosable.
  const repo2 = join(root, 'repo2')
  mkdirSync(repo2, { recursive: true })
  await runGit(repo2, ['init', '-q', '-b', 'main'])
  await runGit(repo2, ['config', 'user.email', 't@t.co'])
  await runGit(repo2, ['config', 'user.name', 'Tester'])
  await runGit(repo2, ['commit', '--allow-empty', '-qm', 'init'])
  const wt2 = join(root, 'wt2')
  await runGit(repo2, ['worktree', 'add', '-q', '--detach', wt2])
  // git marks a worktree's `.git` read-only, and Windows refuses to open such a
  // file for writing even after clearing the bit. Rebuild the directory instead:
  // the record survives, the checkout now names the other repository.
  rmSync(wt2, { recursive: true, force: true })
  mkdirSync(wt2, { recursive: true })
  writeFileSync(join(wt2, '.git'), `gitdir: ${gitPath(join(victim, '.git'))}\n`)
  const deps2 = cachedDepsAt(repo2)
  const rows2 = (await listSessionRepos(deps2, SID, true, undefined, 'off')).value.repos
  const rewritten = rows2.find((entry) => entry.root === realpathSync.native(wt2))
  assert.ok(rewritten, 'git still lists the recorded checkout')
  // `uncertified` is the reason: the entry no longer points into this
  // repository. A platform that marked the record prunable reports `stale`
  // instead, and either way the row must not promise a switch the door refuses.
  assert.notEqual(rewritten.disabled, undefined, 'a repointed checkout is not selectable')
  assert.ok(
    rewritten.disabled === 'uncertified' || rewritten.disabled === 'stale',
    'the row states why it cannot be chosen, got ' + String(rewritten.disabled),
  )
  assert.equal((await resolveWorkspace(deps2, SID, '../wt2')).ok, false)
})

test('a copied repository does not inherit the original checkouts', async () => {
  const root = join(tmp, 'copied')
  const repo = join(root, 'repo')
  const worktree = join(root, 'wt')
  mkdirSync(repo, { recursive: true })
  await runGit(repo, ['init', '-q', '-b', 'main'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'init'])
  await runGit(repo, ['worktree', 'add', '-q', '-b', 'feat', worktree])
  // `cp -R` of a repository carries `.git/worktrees`, and those records keep the
  // machine-absolute paths they were written with: the copy then lists a
  // checkout it has no claim to.
  const copy = join(root, 'copy')
  cpSync(repo, copy, { recursive: true, verbatimSymlinks: true })

  const copyDeps = cachedDepsAt(copy)
  const rows = (await listSessionRepos(copyDeps, SID, true, undefined, 'off')).value.repos
  const copied = rows.find((entry) => entry.root === realpathSync.native(worktree))
  assert.ok(copied, 'the copied record still names the original checkout')
  assert.equal(copied.disabled, 'uncertified', 'the copy does not own it: the .git entry points elsewhere')
  assert.equal((await resolveWorkspace(copyDeps, SID, copied.path)).ok, false)

  // The original repository still owns it: the check is about identity, not
  // about copied records being suspicious on principle.
  const originDeps = cachedDepsAt(repo)
  const originalRow = (await listSessionRepos(originDeps, SID, true, undefined, 'off')).value.repos
    .find((entry) => entry.root === realpathSync.native(worktree))
  assert.equal(originalRow.disabled, undefined)
  assert.equal((await resolveWorkspace(originDeps, SID, originalRow.path)).ok, true)
})

test('the certified ceiling keeps the list honest', async () => {
  const root = join(tmp, 'many')
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  await runGit(repo, ['init', '-q', '-b', 'main'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'init'])
  // 69 real checkouts: the ceiling is 64 (primary included), so six rows fall
  // past it. Built with git rather than by hand so the record format is git's
  // own on every platform; a detached HEAD keeps each add cheap.
  for (let i = 0; i < 69; i++) {
    await runGit(repo, ['worktree', 'add', '-q', '--detach', join(root, `w${i}`)])
  }

  const deps = cachedDepsAt(repo)
  const rows = (await listSessionRepos(deps, SID, true, undefined, 'off')).value.repos
    .filter((entry) => entry.path !== '')
  const selectable = rows.filter((entry) => entry.disabled === undefined)
  const uncertified = rows.filter((entry) => entry.disabled === 'uncertified')
  assert.equal(rows.length, 69, 'every record is a row')
  assert.equal(selectable.length, 63, 'the ceiling is 64 checkouts including the primary')
  assert.equal(uncertified.length, 6, 'the rest say they cannot be chosen instead of promising it')

  // The door is the authority: every row claiming selectable is admitted by it,
  // and every row marked unchoosable is refused.
  const cached = deps.worktreeCache.values().next().value
  assert.equal(cached.checkouts.length, 64, 'the certified set is capped, not the rows')
  for (const row of [...selectable.slice(0, 3), ...selectable.slice(-2)]) {
    assert.equal((await resolveWorkspace(deps, SID, row.path)).ok, true, row.path + ' is selectable and reaches git')
  }
  for (const row of uncertified) {
    assert.equal((await resolveWorkspace(deps, SID, row.path)).ok, false, row.path + ' is refused')
  }
})

test('a cancelled worktree read is not remembered as "no worktrees"', async () => {
  const deps = cachedDepsAt(wtRepo)
  const inner = deps.run.run.bind(deps.run)
  let cancels = 2 // the -z attempt and, if it were reached, the fallback
  deps.run = {
    run: async (argv, opts) => {
      if (argv[1] === 'worktree' && argv[2] === 'list' && cancels > 0) {
        cancels -= 1
        return { exitCode: 0, stdout: '', stderr: '', cancelled: true, timedOut: false }
      }
      return inner(argv, opts)
    },
  }
  assert.equal((await resolveWorkspace(deps, SID, '../wt-outside')).ok, false, 'this request has no answer')
  // The next request runs git again: a cancelled read is "unknown", not "the
  // repository has no worktrees", and caching it would refuse every such row
  // for a whole window.
  assert.equal((await resolveWorkspace(deps, SID, '../wt-outside')).ok, true)
})

test('a worktree added after the window opened is selectable on the first click', async () => {
  const deps = cachedDepsAt(wtRepo)
  const row = '../wt-outside'
  assert.equal((await resolveWorkspace(deps, SID, row)).ok, true, 'warm the window')
  const late = join(tmp, 'wt-late')
  await runGit(wtRepo, ['worktree', 'add', '-q', '-b', 'wt-late', late])
  // The row is in the list immediately (it comes from git, not from the cache);
  // a click inside the window re-reads once instead of reporting invalid-repo.
  assert.equal((await resolveWorkspace(deps, SID, '../wt-late')).ok, true)
})

test('a path reused by another repository is refused inside the window', async () => {
  const root = join(tmp, 'reuse')
  const repo = join(root, 'repo')
  const worktree = join(root, 'wt')
  mkdirSync(repo, { recursive: true })
  await runGit(repo, ['init', '-q', '-b', 'main'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'init'])
  await runGit(repo, ['worktree', 'add', '-q', '-b', 'feat', worktree])
  const deps = cachedDepsAt(repo)
  assert.equal((await resolveWorkspace(deps, SID, '../wt')).ok, true)
  // Remove the worktree and turn the same path into an unrelated repository.
  await runGit(repo, ['worktree', 'remove', '--force', worktree])
  await runGit(repo, ['worktree', 'prune'])
  rmSync(worktree, { recursive: true, force: true })
  mkdirSync(worktree, { recursive: true })
  await runGit(worktree, ['init', '-q', '-b', 'other'])
  // Same path, but its `.git` entry no longer resolves into this repository's
  // records: the cached entry is re-verified, not trusted because the string
  // matches.
  assert.equal((await resolveWorkspace(deps, SID, '../wt')).ok, false)
})
