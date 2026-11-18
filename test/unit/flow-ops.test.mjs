/**
 * Git Flow host execution: the multi-step sequences behind `flow-start`,
 * `flow-finish` and `flow-integrate`, run against throwaway repositories with
 * the production runner and fs wiring.
 *
 * The tests pin the behaviour the dialogs promise: a first feature start
 * creates develop, a finish integrates with the chosen strategy and cleans up,
 * release / hotfix add the tag and the extra merge, and a conflict is aborted
 * back to the pre-op checkout instead of parking the shared work tree.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import './_tmp-ceiling.mjs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, runFlowAction } from '../../lib/host/index.js'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import { gitRunner, runGit } from './_git-fixture.mjs'

const SID = 'flow-session'

function depsAt(dir) {
  return {
    run: gitRunner(),
    fs: createFsDeps(),
    sessions: { liveCwd: () => dir, persistedMeta: async () => undefined },
  }
}

function out(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

function branchExists(dir, name) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd: dir, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function tagExists(dir, name) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${name}`], { cwd: dir, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function clean(dir) {
  return out(dir, ['status', '--porcelain']) === ''
}

function midMerge(dir) {
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: dir, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** A repository on `main` with one commit and a deterministic identity. */
async function freshRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  await runGit(dir, ['init', '-q'])
  await runGit(dir, ['config', 'user.email', 't@t.co'])
  await runGit(dir, ['config', 'user.name', 'Tester'])
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  await runGit(dir, ['add', 'a.txt'])
  await runGit(dir, ['commit', '-qm', 'init'])
  await runGit(dir, ['branch', '-m', 'main'])
  return dir
}

/** `develop` created at the current main tip and checked out, then main again:
 * the long-lived pair most flows start from. */
async function withDevelop(dir) {
  await runGit(dir, ['branch', 'develop'])
}

function run(dir, action) {
  return runFlowAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action })
}

test('flow-start creates develop on the first feature start, then switches to the new branch', async () => {
  const dir = await freshRepo('gp-flow-start-')
  try {
    const mainHead = out(dir, ['rev-parse', 'HEAD'])
    const started = await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/login', base: 'main' })
    assert.equal(started.ok, true, JSON.stringify(started))
    assert.equal(started.snapshot.branch, 'feature/login', 'the action switches to the new branch')
    assert.ok(branchExists(dir, 'develop'), 'the first feature start creates develop')
    assert.equal(out(dir, ['rev-parse', 'develop']), mainHead, 'develop starts at the chosen base')
    assert.equal(out(dir, ['rev-parse', 'feature/login']), mainHead, 'the feature branches off develop')
    assert.equal(out(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/login')

    const taken = await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/login', base: 'main' })
    assert.equal(taken.ok, false)
    assert.equal(taken.error.code, 'branch-exists')

    const missing = await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/other', base: 'nope' })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'not-found')

    const mismatched = await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'hotfix/1.0.1', base: 'main' })
    assert.equal(mismatched.ok, false)
    assert.equal(mismatched.error.code, 'invalid-name')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flow-start branches a hotfix off the main line', async () => {
  const dir = await freshRepo('gp-flow-hotfix-start-')
  try {
    await withDevelop(dir)
    const mainHead = out(dir, ['rev-parse', 'main'])
    const started = await run(dir, { kind: 'flow-start', flow: 'hotfix', branch: 'hotfix/1.0.1', base: 'main' })
    assert.equal(started.ok, true, JSON.stringify(started))
    assert.equal(out(dir, ['rev-parse', 'hotfix/1.0.1']), mainHead)
    assert.equal(started.snapshot.branch, 'hotfix/1.0.1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flow-finish (merge) lands the feature on develop, deletes the branch and leaves no merge state', async () => {
  const dir = await freshRepo('gp-flow-finish-merge-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/login', base: 'develop' })
    writeFileSync(join(dir, 'login.txt'), 'login\n')
    await runGit(dir, ['add', 'login.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: login'])
    const featureHead = out(dir, ['rev-parse', 'HEAD'])
    const developBefore = out(dir, ['rev-parse', 'develop'])

    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/login', target: 'develop',
      strategy: 'merge', message: 'finish login', deleteBranch: true,
    })
    assert.equal(finished.ok, true, JSON.stringify(finished))
    assert.equal(finished.snapshot.branch, 'develop', 'the checkout lands on the target branch')
    assert.equal(branchExists(dir, 'feature/login'), false, 'the finished branch is deleted')
    assert.notEqual(out(dir, ['rev-parse', 'develop']), developBefore)
    assert.equal(out(dir, ['rev-parse', 'develop^2']), featureHead, 'the feature tip is the merge commit\'s second parent')
    assert.equal(out(dir, ['log', '-1', '--format=%s', 'develop']), 'finish login')
    assert.ok(clean(dir), 'the finish leaves no changes behind')
    assert.equal(midMerge(dir), false, 'no merge state survives')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flow-finish (squash) commits once and deletes only after the forced acknowledgement', async () => {
  const dir = await freshRepo('gp-flow-finish-squash-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/squash', base: 'develop' })
    writeFileSync(join(dir, 'sq.txt'), 'sq\n')
    await runGit(dir, ['add', 'sq.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: one'])
    writeFileSync(join(dir, 'sq2.txt'), 'sq2\n')
    await runGit(dir, ['add', 'sq2.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: two'])
    const developBefore = out(dir, ['rev-parse', 'develop'])

    const refused = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/squash', target: 'develop',
      strategy: 'squash', message: 'squash it', deleteBranch: true,
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'invalid-name', 'the forced delete needs its own acknowledgement')
    assert.equal(out(dir, ['rev-parse', 'develop']), developBefore, 'nothing ran before the refusal')

    const kept = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/squash', target: 'develop',
      strategy: 'squash', message: 'squash it', deleteBranch: false,
    })
    assert.equal(kept.ok, true, JSON.stringify(kept))
    assert.equal(out(dir, ['rev-list', '--count', `${developBefore}..develop`]), '1', 'the squash is one commit')
    assert.equal(out(dir, ['log', '-1', '--format=%s', 'develop']), 'squash it')
    assert.ok(branchExists(dir, 'feature/squash'), 'the branch is kept when deletion was not requested')
    assert.ok(existsSync(join(dir, 'sq2.txt')), 'the squashed content is in the work tree')

    const deleted = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/squash', target: 'develop',
      strategy: 'squash', message: 'squash again', deleteBranch: true, forceDelete: true,
    })
    assert.equal(deleted.ok, false, 'the second finish finds nothing new to commit')
    assert.equal(deleted.error.code, 'nothing-to-commit')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flow-finish (release) merges develop, lands on the main line and tags it', async () => {
  const dir = await freshRepo('gp-flow-finish-release-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'release', branch: 'release/1.2.0', base: 'develop' })
    writeFileSync(join(dir, 'bump.txt'), '1.2.0\n')
    await runGit(dir, ['add', 'bump.txt'])
    await runGit(dir, ['commit', '-qm', 'chore: 1.2.0'])
    const releaseHead = out(dir, ['rev-parse', 'HEAD'])

    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'release', branch: 'release/1.2.0', target: 'develop',
      strategy: 'merge', message: 'release 1.2.0', deleteBranch: true, tag: 'v1.2.0',
    })
    assert.equal(finished.ok, true, JSON.stringify(finished))
    assert.equal(finished.snapshot.branch, 'main', 'the release ends on the main line')
    assert.ok(out(dir, ['merge-base', '--is-ancestor', releaseHead, 'develop']) === '')
    assert.ok(out(dir, ['merge-base', '--is-ancestor', releaseHead, 'main']) === '')
    assert.ok(tagExists(dir, 'v1.2.0'), 'the release tag exists')
    assert.equal(out(dir, ['cat-file', '-t', 'refs/tags/v1.2.0']), 'tag', 'the tag is annotated')
    assert.equal(out(dir, ['rev-list', '-n', '1', 'v1.2.0']), out(dir, ['rev-parse', 'main']), 'the tag points at the main-line merge')
    assert.equal(branchExists(dir, 'release/1.2.0'), false)
    assert.ok(clean(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flow-finish (hotfix) tags the main line and merges it back into develop', async () => {
  const dir = await freshRepo('gp-flow-finish-hotfix-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'hotfix', branch: 'hotfix/1.2.1', base: 'main' })
    writeFileSync(join(dir, 'fix.txt'), 'fix\n')
    await runGit(dir, ['add', 'fix.txt'])
    await runGit(dir, ['commit', '-qm', 'fix: crash'])
    const fixHead = out(dir, ['rev-parse', 'HEAD'])

    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'hotfix', branch: 'hotfix/1.2.1', target: 'main',
      strategy: 'merge', message: 'hotfix 1.2.1', deleteBranch: true, tag: 'v1.2.1',
    })
    assert.equal(finished.ok, true, JSON.stringify(finished))
    assert.equal(finished.snapshot.branch, 'develop', 'the hotfix back-merges into develop')
    assert.equal(out(dir, ['merge-base', '--is-ancestor', fixHead, 'main']) === '', true)
    assert.equal(out(dir, ['merge-base', '--is-ancestor', fixHead, 'develop']) === '', true)
    assert.equal(out(dir, ['rev-list', '-n', '1', 'v1.2.1']), out(dir, ['rev-parse', 'main']), 'the tag sits on main')
    assert.equal(branchExists(dir, 'hotfix/1.2.1'), false)
    assert.ok(clean(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flow-finish refuses a taken tag before touching the branches', async () => {
  const dir = await freshRepo('gp-flow-finish-tag-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'release', branch: 'release/1.2.0', base: 'develop' })
    writeFileSync(join(dir, 'bump.txt'), '1.2.0\n')
    await runGit(dir, ['add', 'bump.txt'])
    await runGit(dir, ['commit', '-qm', 'chore: 1.2.0'])
    await runGit(dir, ['tag', 'v1.2.0'])
    const developBefore = out(dir, ['rev-parse', 'develop'])
    const mainBefore = out(dir, ['rev-parse', 'main'])

    const refused = await run(dir, {
      kind: 'flow-finish', flow: 'release', branch: 'release/1.2.0', target: 'develop',
      strategy: 'merge', message: 'release 1.2.0', deleteBranch: true, tag: 'v1.2.0',
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'tag-exists')
    assert.equal(out(dir, ['rev-parse', 'develop']), developBefore, 'nothing was integrated')
    assert.equal(out(dir, ['rev-parse', 'main']), mainBefore)
    assert.ok(branchExists(dir, 'release/1.2.0'), 'the flow branch is still there')
    assert.equal(out(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'release/1.2.0', 'the checkout did not move')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a hotfix can finish on master when the checkout also keeps main', async () => {
  const dir = await freshRepo('gp-flow-finish-master-')
  try {
    await withDevelop(dir)
    await runGit(dir, ['branch', 'master'])
    await run(dir, { kind: 'flow-start', flow: 'hotfix', branch: 'hotfix/1.0.1', base: 'master' })
    writeFileSync(join(dir, 'fix-master.txt'), 'fix\n')
    await runGit(dir, ['add', 'fix-master.txt'])
    await runGit(dir, ['commit', '-qm', 'fix: on master'])
    const fixHead = out(dir, ['rev-parse', 'HEAD'])
    const mainBefore = out(dir, ['rev-parse', 'main'])

    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'hotfix', branch: 'hotfix/1.0.1', target: 'master',
      strategy: 'merge', message: 'hotfix 1.0.1', deleteBranch: true, tag: 'v1.0.1',
    })
    assert.equal(finished.ok, true, JSON.stringify(finished))
    assert.equal(finished.snapshot.branch, 'develop')
    assert.equal(out(dir, ['merge-base', '--is-ancestor', fixHead, 'master']) === '', true, 'the chosen main line carries the fix')
    assert.equal(out(dir, ['merge-base', '--is-ancestor', fixHead, 'develop']) === '', true, 'develop still gets the back-merge')
    assert.equal(out(dir, ['rev-list', '-n', '1', 'v1.0.1']), out(dir, ['rev-parse', 'master']), 'the tag sits on the chosen line')
    assert.equal(out(dir, ['rev-parse', 'main']), mainBefore, 'the other main line is untouched')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flow-finish refuses a dirty work tree before touching anything', async () => {
  const dir = await freshRepo('gp-flow-finish-dirty-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/dirty', base: 'develop' })
    writeFileSync(join(dir, 'a.txt'), 'changed\n')
    const developBefore = out(dir, ['rev-parse', 'develop'])

    const refused = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/dirty', target: 'develop',
      strategy: 'merge', message: 'nope', deleteBranch: true,
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'local-changes-block')
    assert.equal(out(dir, ['rev-parse', 'develop']), developBefore)
    assert.ok(branchExists(dir, 'feature/dirty'))
    assert.equal(out(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/dirty', 'the checkout did not move')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flow-finish (rebase) replays the feature onto develop and fast-forwards it', async () => {
  const dir = await freshRepo('gp-flow-finish-rebase-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/rebased', base: 'develop' })
    writeFileSync(join(dir, 'feature.txt'), 'feature\n')
    await runGit(dir, ['add', 'feature.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: feature file'])
    const oldFeatureHead = out(dir, ['rev-parse', 'HEAD'])
    await runGit(dir, ['checkout', '-q', 'develop'])
    writeFileSync(join(dir, 'develop.txt'), 'develop\n')
    await runGit(dir, ['add', 'develop.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: develop moved'])
    await runGit(dir, ['checkout', '-q', 'feature/rebased'])

    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/rebased', target: 'develop',
      strategy: 'rebase', message: 'finish rebased', deleteBranch: true,
    })
    assert.equal(finished.ok, true, JSON.stringify(finished))
    assert.equal(out(dir, ['log', '-1', '--format=%s', 'develop']), 'feat: feature file', 'develop ends on the replayed commit')
    assert.notEqual(out(dir, ['rev-parse', 'HEAD']), oldFeatureHead, 'the feature commit was rewritten')
    assert.equal(branchExists(dir, 'feature/rebased'), false, 'the rebased branch is deleted')
    assert.ok(clean(dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a conflicting feature finish aborts back to the pre-op checkout', async () => {
  const dir = await freshRepo('gp-flow-finish-conflict-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/clash', base: 'develop' })
    writeFileSync(join(dir, 'a.txt'), 'feature-version\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'feature: rewrite a'])
    const startHead = out(dir, ['rev-parse', 'HEAD'])
    await runGit(dir, ['checkout', '-q', 'develop'])
    writeFileSync(join(dir, 'a.txt'), 'develop-version\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'develop: rewrite a'])
    const developBefore = out(dir, ['rev-parse', 'develop'])
    await runGit(dir, ['checkout', '-q', 'feature/clash'])

    const conflicted = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/clash', target: 'develop',
      strategy: 'merge', message: 'clash', deleteBranch: true,
    })
    assert.equal(conflicted.ok, false)
    assert.equal(conflicted.error.code, 'merge-conflict')
    assert.equal(out(dir, ['rev-parse', 'develop']), developBefore, 'develop is back to its pre-merge tip')
    assert.equal(out(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/clash', 'the checkout is back on the flow branch')
    assert.equal(out(dir, ['rev-parse', 'HEAD']), startHead, 'the flow branch tip did not move')
    assert.equal(midMerge(dir), false, 'no MERGE_HEAD survives the abort')
    assert.ok(clean(dir), 'the work tree is clean again')
    assert.ok(branchExists(dir, 'feature/clash'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flow-integrate merges develop into the feature branch and aborts a conflict', async () => {
  const dir = await freshRepo('gp-flow-integrate-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/dev', base: 'develop' })
    await runGit(dir, ['checkout', '-q', 'develop'])
    writeFileSync(join(dir, 'from-develop.txt'), 'x\n')
    await runGit(dir, ['add', 'from-develop.txt'])
    await runGit(dir, ['commit', '-qm', 'develop moves'])
    await runGit(dir, ['checkout', '-q', 'feature/dev'])

    const integrated = await run(dir, { kind: 'flow-integrate', develop: 'develop' })
    assert.equal(integrated.ok, true, JSON.stringify(integrated))
    assert.ok(existsSync(join(dir, 'from-develop.txt')), 'develop\'s commit is in the feature branch')
    assert.ok(clean(dir))

    // Conflict: both sides rewrite the same line after the integration.
    await runGit(dir, ['checkout', '-q', 'develop'])
    writeFileSync(join(dir, 'a.txt'), 'develop-wins\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'develop rewrites a'])
    await runGit(dir, ['checkout', '-q', 'feature/dev'])
    writeFileSync(join(dir, 'a.txt'), 'feature-wins\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'feature rewrites a'])
    const before = out(dir, ['rev-parse', 'HEAD'])

    const conflicted = await run(dir, { kind: 'flow-integrate', develop: 'develop' })
    assert.equal(conflicted.ok, false)
    assert.equal(conflicted.error.code, 'merge-conflict')
    assert.equal(out(dir, ['rev-parse', 'HEAD']), before, 'the abort restored the feature tip')
    assert.equal(midMerge(dir), false)
    assert.ok(clean(dir))

    await runGit(dir, ['checkout', '-q', 'main'])
    const onMain = await run(dir, { kind: 'flow-integrate', develop: 'develop' })
    assert.equal(onMain.ok, false)
    assert.equal(onMain.error.code, 'invalid-name', 'integration only applies on a feature branch')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('flow-finish deletes the remote branch and pushes the target to the configured remote', async () => {
  const dir = await freshRepo('gp-flow-remote-')
  const remote = mkdtempSync(join(tmpdir(), 'gp-flow-remote-bare-'))
  try {
    await runGit(remote, ['init', '-q', '--bare'])
    await withDevelop(dir)
    await runGit(dir, ['remote', 'add', 'origin', remote])
    await runGit(dir, ['push', '-q', 'origin', 'main', 'develop'])
    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/pushed', base: 'develop' })
    writeFileSync(join(dir, 'p.txt'), 'p\n')
    await runGit(dir, ['add', 'p.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: push me'])
    await runGit(dir, ['push', '-q', '-u', 'origin', 'feature/pushed'])

    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/pushed', target: 'develop',
      strategy: 'merge', message: 'finish pushed', deleteBranch: true, deleteRemote: true, pushRemote: 'origin',
    })
    assert.equal(finished.ok, true, JSON.stringify(finished))
    assert.equal(branchExists(dir, 'feature/pushed'), false)
    assert.equal(out(remote, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').includes('feature/pushed'), false, 'the remote branch is gone')
    assert.equal(out(remote, ['rev-parse', 'refs/heads/develop']), out(dir, ['rev-parse', 'develop']), 'the target was pushed')

    const unknownRemote = await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/again', base: 'develop' })
    assert.equal(unknownRemote.ok, true)
    const refusedPush = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/again', target: 'develop',
      strategy: 'merge', message: 'again', deleteBranch: false, pushRemote: 'nope',
    })
    assert.equal(refusedPush.ok, false)
    assert.equal(refusedPush.error.code, 'invalid-name', 'an unconfigured remote is refused before the integration')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})
