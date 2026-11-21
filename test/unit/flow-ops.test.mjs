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

function depsAt(dir, runner = gitRunner()) {
  return {
    run: runner,
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

test('flow-start publishes the new branch with its upstream and refuses an unknown remote first', async () => {
  const dir = await freshRepo('gp-flow-start-push-')
  const remote = mkdtempSync(join(tmpdir(), 'gp-flow-start-push-bare-'))
  try {
    await runGit(remote, ['init', '-q', '--bare'])
    await withDevelop(dir)
    await runGit(dir, ['remote', 'add', 'origin', remote])
    await runGit(dir, ['push', '-q', 'origin', 'main', 'develop'])

    const started = await run(dir, {
      kind: 'flow-start', flow: 'feature', branch: 'feature/remote', base: 'develop', pushRemote: 'origin',
    })
    assert.equal(started.ok, true, JSON.stringify(started))
    assert.equal(
      out(remote, ['rev-parse', 'refs/heads/feature/remote']),
      out(dir, ['rev-parse', 'feature/remote']),
      'the new branch is published',
    )
    assert.equal(
      out(dir, ['for-each-ref', '--format=%(upstream:short)', 'refs/heads/feature/remote']),
      'origin/feature/remote',
      'the publish sets the branch upstream',
    )

    const refused = await run(dir, {
      kind: 'flow-start', flow: 'feature', branch: 'feature/nope', base: 'develop', pushRemote: 'missing',
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'invalid-name', 'an unconfigured remote is refused before the checkout')
    assert.equal(branchExists(dir, 'feature/nope'), false)
    assert.equal(out(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/remote', 'the checkout did not move')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})

test('flow-start publishes release and hotfix branches too, not only features', async () => {
  const dir = await freshRepo('gp-flow-start-push-kinds-')
  const remote = mkdtempSync(join(tmpdir(), 'gp-flow-start-push-kinds-bare-'))
  try {
    await runGit(remote, ['init', '-q', '--bare'])
    await withDevelop(dir)
    await runGit(dir, ['remote', 'add', 'origin', remote])
    await runGit(dir, ['push', '-q', 'origin', 'main', 'develop'])

    // Every flow shares the same start path, so the remote branch must be
    // created and tracked for release and hotfix exactly as it is for feature.
    for (const [flow, branch, base] of [
      ['release', 'release/1.0.0', 'develop'],
      ['hotfix', 'hotfix/1.0.1', 'main'],
    ]) {
      const started = await run(dir, { kind: 'flow-start', flow, branch, base, pushRemote: 'origin' })
      assert.equal(started.ok, true, `${flow}: ${JSON.stringify(started)}`)
      assert.equal(
        out(remote, ['rev-parse', `refs/heads/${branch}`]),
        out(dir, ['rev-parse', branch]),
        `${flow}: the missing remote branch is created by the start`,
      )
      assert.equal(
        out(dir, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`]),
        `origin/${branch}`,
        `${flow}: the created remote branch becomes the upstream`,
      )
      assert.equal(started.snapshot.branch, branch, `${flow}: the start ends on the new branch`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
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

test('flow-finish (release) lands on the main line, tags it and merges it back into develop', async () => {
  const dir = await freshRepo('gp-flow-finish-release-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'release', branch: 'release/1.2.0', base: 'develop' })
    writeFileSync(join(dir, 'bump.txt'), '1.2.0\n')
    await runGit(dir, ['add', 'bump.txt'])
    await runGit(dir, ['commit', '-qm', 'chore: 1.2.0'])
    const releaseHead = out(dir, ['rev-parse', 'HEAD'])

    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'release', branch: 'release/1.2.0', target: 'main',
      strategy: 'merge', message: 'release 1.2.0', deleteBranch: true, tag: 'v1.2.0',
    })
    assert.equal(finished.ok, true, JSON.stringify(finished))
    assert.equal(finished.snapshot.branch, 'develop', 'the release back-merges into develop and ends there')
    assert.ok(out(dir, ['merge-base', '--is-ancestor', releaseHead, 'develop']) === '')
    assert.ok(out(dir, ['merge-base', '--is-ancestor', releaseHead, 'main']) === '')
    assert.ok(tagExists(dir, 'v1.2.0'), 'the release tag exists')
    assert.equal(out(dir, ['cat-file', '-t', 'refs/tags/v1.2.0']), 'tag', 'the tag is annotated')
    assert.equal(out(dir, ['rev-list', '-n', '1', 'v1.2.0']), out(dir, ['rev-parse', 'main']), 'the tag points at the main-line merge')
    assert.ok(out(dir, ['merge-base', '--is-ancestor', 'v1.2.0', 'develop']) === '', 'develop contains the tagged main-line merge')
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
      kind: 'flow-finish', flow: 'release', branch: 'release/1.2.0', target: 'main',
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

test('flow-finish can chain a release start from the updated develop', async () => {
  const dir = await freshRepo('gp-flow-finish-release-start-')
  const remote = mkdtempSync(join(tmpdir(), 'gp-flow-finish-release-start-bare-'))
  try {
    await runGit(remote, ['init', '-q', '--bare'])
    await withDevelop(dir)
    await runGit(dir, ['remote', 'add', 'origin', remote])
    await runGit(dir, ['push', '-q', 'origin', 'main', 'develop'])
    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/next', base: 'develop' })
    writeFileSync(join(dir, 'next.txt'), 'next\n')
    await runGit(dir, ['add', 'next.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: next'])
    const featureHead = out(dir, ['rev-parse', 'HEAD'])

    // A taken release name is refused before the integration moves develop.
    await runGit(dir, ['branch', 'release/9.9.9'])
    const developBefore = out(dir, ['rev-parse', 'develop'])
    const refused = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/next', target: 'develop',
      strategy: 'merge', message: 'finish next', deleteBranch: true, startRelease: 'release/9.9.9',
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'branch-exists')
    assert.equal(out(dir, ['rev-parse', 'develop']), developBefore, 'nothing was integrated')
    assert.equal(out(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/next', 'the checkout did not move')

    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/next', target: 'develop',
      strategy: 'merge', message: 'finish next', deleteBranch: true,
      startRelease: 'release/1.4.0', pushRemote: 'origin', releasePushRemote: 'origin',
    })
    assert.equal(finished.ok, true, JSON.stringify(finished))
    assert.equal(finished.snapshot.branch, 'release/1.4.0', 'the finish ends on the chained release branch')
    assert.ok(branchExists(dir, 'release/1.4.0'))
    assert.equal(out(dir, ['rev-parse', 'release/1.4.0']), out(dir, ['rev-parse', 'develop']), 'the release starts at the updated develop')
    assert.ok(out(dir, ['merge-base', '--is-ancestor', featureHead, 'release/1.4.0']) === '', 'the feature is in the release')
    assert.equal(
      out(remote, ['rev-parse', 'refs/heads/release/1.4.0']),
      out(dir, ['rev-parse', 'release/1.4.0']),
      'the new release branch is published by the same push',
    )
    assert.equal(
      out(dir, ['for-each-ref', '--format=%(upstream:short)', 'refs/heads/release/1.4.0']),
      'origin/release/1.4.0',
      'the chained release tracks the branch it just published',
    )
    assert.equal(out(remote, ['rev-parse', 'refs/heads/develop']), out(dir, ['rev-parse', 'develop']), 'develop was pushed')
    // The chained start is a feature-only decision.
    const wrongFlow = await run(dir, {
      kind: 'flow-finish', flow: 'release', branch: 'release/1.4.0', target: 'main',
      strategy: 'merge', message: 'nope', tag: '1.4.0', startRelease: 'release/1.5.0',
    })
    assert.equal(wrongFlow.ok, false)
    assert.equal(wrongFlow.error.code, 'invalid-name')
    const orphanPush = await run(dir, {
      kind: 'flow-finish', flow: 'release', branch: 'release/1.4.0', target: 'main',
      strategy: 'merge', message: 'nope', releasePushRemote: 'origin',
    })
    assert.equal(orphanPush.ok, false)
    assert.equal(orphanPush.error.code, 'invalid-name', 'a release push without a chained release start is refused')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})

test('flow-finish creates a remote branch that did not exist yet', async () => {
  const dir = await freshRepo('gp-flow-finish-missing-remote-')
  const remote = mkdtempSync(join(tmpdir(), 'gp-flow-finish-missing-remote-bare-'))
  try {
    await runGit(remote, ['init', '-q', '--bare'])
    await withDevelop(dir)
    await runGit(dir, ['remote', 'add', 'origin', remote])
    // Only the main line exists on the remote; develop is local-only for now.
    await runGit(dir, ['push', '-q', 'origin', 'main'])
    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/new-remote', base: 'develop' })
    writeFileSync(join(dir, 'new-remote.txt'), 'x\n')
    await runGit(dir, ['add', 'new-remote.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: new remote'])

    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/new-remote', target: 'develop',
      strategy: 'merge', message: 'finish new remote', deleteBranch: true, pushRemote: 'origin',
    })
    assert.equal(finished.ok, true, JSON.stringify(finished))
    assert.equal(
      out(remote, ['rev-parse', 'refs/heads/develop']),
      out(dir, ['rev-parse', 'develop']),
      'the push created the missing remote develop branch',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
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

    // A release publishes both branches it moved: the tagged main line and the
    // develop it was merged back into.
    await run(dir, { kind: 'flow-start', flow: 'release', branch: 'release/1.3.0', base: 'develop' })
    writeFileSync(join(dir, 'rel.txt'), '1.3.0\n')
    await runGit(dir, ['add', 'rel.txt'])
    await runGit(dir, ['commit', '-qm', 'chore: 1.3.0'])
    const released = await run(dir, {
      kind: 'flow-finish', flow: 'release', branch: 'release/1.3.0', target: 'main',
      strategy: 'merge', message: 'release 1.3.0', deleteBranch: true, tag: 'v1.3.0', pushRemote: 'origin',
    })
    assert.equal(released.ok, true, JSON.stringify(released))
    assert.equal(out(remote, ['rev-parse', 'refs/heads/main']), out(dir, ['rev-parse', 'main']), 'the main line was pushed')
    assert.equal(out(remote, ['rev-parse', 'refs/heads/develop']), out(dir, ['rev-parse', 'develop']), 'the develop back-merge was pushed')
    assert.equal(out(remote, ['cat-file', '-t', 'refs/tags/v1.3.0']), 'tag', 'the release tag was pushed as annotated tag')
    assert.equal(out(remote, ['rev-parse', 'refs/tags/v1.3.0^{}']), out(dir, ['rev-parse', 'refs/tags/v1.3.0^{}']), 'the remote tag points at the local tag target')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})


test('flow-finish host enforces tags, strategy and force-delete invariants', async () => {
  const dir = await freshRepo('gp-flow-finish-invariants-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'release', branch: 'release/1.5.0', base: 'develop' })
    writeFileSync(join(dir, 'release-invariant.txt'), 'release\n')
    await runGit(dir, ['add', 'release-invariant.txt'])
    await runGit(dir, ['commit', '-qm', 'release invariant'])

    const emptyTag = await run(dir, {
      kind: 'flow-finish', flow: 'release', branch: 'release/1.5.0', target: 'main',
      strategy: 'merge', message: 'release invariant', deleteBranch: false, tag: '',
    })
    assert.equal(emptyTag.ok, false)
    assert.equal(emptyTag.error.code, 'invalid-name')

    const releaseRebase = await run(dir, {
      kind: 'flow-finish', flow: 'release', branch: 'release/1.5.0', target: 'main',
      strategy: 'rebase', message: 'release invariant', deleteBranch: false, tag: 'v1.5.0',
    })
    assert.equal(releaseRebase.ok, false)
    assert.equal(releaseRebase.error.code, 'invalid-name')

    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/force', base: 'develop' })
    writeFileSync(join(dir, 'force.txt'), 'force\n')
    await runGit(dir, ['add', 'force.txt'])
    await runGit(dir, ['commit', '-qm', 'force invariant'])
    const forceOnMerge = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/force', target: 'develop',
      strategy: 'merge', message: 'force invariant', deleteBranch: true, forceDelete: true,
    })
    assert.equal(forceOnMerge.ok, false)
    assert.equal(forceOnMerge.error.code, 'invalid-name')

    const customDevelop = await run(dir, { kind: 'flow-integrate', develop: 'main' })
    assert.equal(customDevelop.ok, false)
    assert.equal(customDevelop.error.code, 'invalid-name')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test('flow-finish refuses deleting an upstream that advanced remotely', async () => {
  const dir = await freshRepo('gp-flow-remote-advanced-')
  const remote = mkdtempSync(join(tmpdir(), 'gp-flow-remote-advanced-bare-'))
  const collaborator = mkdtempSync(join(tmpdir(), 'gp-flow-remote-advanced-collab-'))
  try {
    await runGit(remote, ['init', '-q', '--bare'])
    await withDevelop(dir)
    await runGit(dir, ['remote', 'add', 'origin', remote])
    await runGit(dir, ['push', '-q', 'origin', 'main', 'develop'])
    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/advanced', base: 'develop', pushRemote: 'origin' })
    writeFileSync(join(dir, 'advanced.txt'), 'a\n')
    await runGit(dir, ['add', 'advanced.txt'])
    await runGit(dir, ['commit', '-qm', 'feature A'])
    await runGit(dir, ['push', '-q', '-u', 'origin', 'feature/advanced'])

    await runGit(collaborator, ['clone', '-q', remote, '.'])
    await runGit(collaborator, ['checkout', '-q', 'feature/advanced'])
    await runGit(collaborator, ['config', 'user.email', 'collab@t.co'])
    await runGit(collaborator, ['config', 'user.name', 'Collaborator'])
    writeFileSync(join(collaborator, 'collaborator.txt'), 'b\n')
    await runGit(collaborator, ['add', 'collaborator.txt'])
    await runGit(collaborator, ['commit', '-qm', 'feature B'])
    await runGit(collaborator, ['push', '-q', 'origin', 'feature/advanced'])

    const developBefore = out(dir, ['rev-parse', 'develop'])
    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/advanced', target: 'develop',
      strategy: 'merge', message: 'finish advanced', deleteBranch: true, deleteRemote: true,
    })
    assert.equal(finished.ok, false, JSON.stringify(finished))
    assert.equal(finished.error.code, 'upstream-changed', JSON.stringify(finished))
    assert.equal(out(dir, ['rev-parse', 'develop']), developBefore, 'the target did not move')
    assert.ok(branchExists(dir, 'feature/advanced'), 'the local flow branch remains available')
    assert.equal(out(remote, ['rev-parse', 'refs/heads/feature/advanced']), out(collaborator, ['rev-parse', 'HEAD']), 'the advanced remote branch remains intact')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
    rmSync(collaborator, { recursive: true, force: true })
  }
})


test('concurrent flow actions on one repository are rejected while the first runs', async () => {
  const dir = await freshRepo('gp-flow-lock-')
  let enteredResolve
  const entered = new Promise((resolve) => { enteredResolve = resolve })
  let releaseResolve
  const release = new Promise((resolve) => { releaseResolve = resolve })
  const base = gitRunner()
  let blocked = false
  const runner = {
    run: async (argv, options) => {
      if (!blocked && argv[1] === 'checkout' && argv[2] === '-b') {
        blocked = true
        enteredResolve()
        await release
      }
      return base.run(argv, options)
    },
  }
  try {
    const first = runFlowAction(depsAt(dir, runner), DEFAULT_CONFIG, {
      sessionId: SID,
      action: { kind: 'flow-start', flow: 'feature', branch: 'feature/one', base: 'main' },
    })
    await entered
    const second = await runFlowAction(depsAt(dir), DEFAULT_CONFIG, {
      sessionId: SID,
      action: { kind: 'flow-start', flow: 'feature', branch: 'feature/two', base: 'main' },
    })
    assert.equal(second.ok, false)
    assert.equal(second.error.code, 'operation-in-progress')
    releaseResolve()
    const started = await first
    assert.equal(started.ok, true, JSON.stringify(started))
    assert.ok(branchExists(dir, 'feature/one'))
    assert.equal(branchExists(dir, 'feature/two'), false)
  } finally {
    releaseResolve()
    rmSync(dir, { recursive: true, force: true })
  }
})


test('flow-start preserves local and remote state when a push result is uncertain', async () => {
  const dir = await freshRepo('gp-flow-start-unknown-')
  const remote = mkdtempSync(join(tmpdir(), 'gp-flow-start-unknown-bare-'))
  try {
    await runGit(remote, ['init', '-q', '--bare'])
    await withDevelop(dir)
    await runGit(dir, ['remote', 'add', 'origin', remote])
    await runGit(dir, ['checkout', '-q', '-b', 'remote-seed', 'develop'])
    writeFileSync(join(dir, 'remote-seed.txt'), 'remote\n')
    await runGit(dir, ['add', 'remote-seed.txt'])
    await runGit(dir, ['commit', '-qm', 'remote seed'])
    await runGit(dir, ['push', '-q', 'origin', 'remote-seed:refs/heads/feature/orphan'])
    await runGit(dir, ['checkout', '-q', 'main'])

    const started = await run(dir, {
      kind: 'flow-start', flow: 'feature', branch: 'feature/orphan', base: 'develop', pushRemote: 'origin',
    })
    assert.equal(started.ok, false)
    assert.equal(started.error.code, 'flow-partial')
    assert.ok(branchExists(dir, 'feature/orphan'), 'the local branch remains for inspection')
    assert.ok(branchExists(remote, 'feature/orphan') || out(remote, ['show-ref', '--verify', '--quiet', 'refs/heads/feature/orphan']) === '', 'the remote branch remains intact')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})


test('release finish can resume after integration and tag but push failure', async () => {
  const dir = await freshRepo('gp-flow-resume-')
  const remote = mkdtempSync(join(tmpdir(), 'gp-flow-resume-bare-'))
  const collaborator = mkdtempSync(join(tmpdir(), 'gp-flow-resume-collab-'))
  try {
    await runGit(remote, ['init', '-q', '--bare'])
    await withDevelop(dir)
    await runGit(dir, ['remote', 'add', 'origin', remote])
    await runGit(dir, ['push', '-q', 'origin', 'main', 'develop'])
    await run(dir, { kind: 'flow-start', flow: 'release', branch: 'release/2.0.0', base: 'develop' })
    writeFileSync(join(dir, 'release.txt'), '2.0.0\n')
    await runGit(dir, ['add', 'release.txt'])
    await runGit(dir, ['commit', '-qm', 'release 2.0.0'])

    await runGit(collaborator, ['clone', '-q', remote, '.'])
    await runGit(collaborator, ['checkout', '-q', 'main'])
    await runGit(collaborator, ['config', 'user.email', 'collab@t.co'])
    await runGit(collaborator, ['config', 'user.name', 'Collaborator'])
    writeFileSync(join(collaborator, 'remote.txt'), 'remote\n')
    await runGit(collaborator, ['add', 'remote.txt'])
    await runGit(collaborator, ['commit', '-qm', 'remote main moved'])
    const baseRunner = gitRunner()
    const racingRunner = {
      run: async (argv, options) => {
        if (argv[1] === 'push' && argv.includes('refs/heads/main:refs/heads/main')) {
          await runGit(collaborator, ['push', '-q', 'origin', 'main'])
        }
        return baseRunner.run(argv, options)
      },
    }

    const partialFinish = await runFlowAction(depsAt(dir, racingRunner), DEFAULT_CONFIG, { sessionId: SID, action: {
      kind: 'flow-finish', flow: 'release', branch: 'release/2.0.0', target: 'main',
      strategy: 'merge', message: 'release 2.0.0', deleteBranch: true, tag: 'v2.0.0', pushRemote: 'origin',
    }})
    assert.equal(partialFinish.ok, false)
    assert.equal(partialFinish.error.code, 'flow-partial')
    assert.ok(tagExists(dir, 'v2.0.0'))
    assert.ok(branchExists(dir, 'release/2.0.0'))

    const resumed = await run(dir, {
      kind: 'flow-finish', flow: 'release', branch: 'release/2.0.0', target: 'main',
      strategy: 'merge', message: 'release 2.0.0', deleteBranch: true, tag: 'v2.0.0',
    })
    assert.equal(resumed.ok, true, JSON.stringify(resumed))
    assert.equal(branchExists(dir, 'release/2.0.0'), false)
    assert.equal(out(dir, ['rev-parse', 'refs/tags/v2.0.0^{}']), out(dir, ['rev-parse', 'main']))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
    rmSync(collaborator, { recursive: true, force: true })
  }
})


test('flow-finish rejects a remote target that is ahead before integrating', async () => {
  const dir = await freshRepo('gp-flow-target-ahead-')
  const remote = mkdtempSync(join(tmpdir(), 'gp-flow-target-ahead-bare-'))
  const collaborator = mkdtempSync(join(tmpdir(), 'gp-flow-target-ahead-collab-'))
  try {
    await runGit(remote, ['init', '-q', '--bare'])
    await withDevelop(dir)
    await runGit(dir, ['remote', 'add', 'origin', remote])
    await runGit(dir, ['push', '-q', 'origin', 'main', 'develop'])
    await runGit(collaborator, ['clone', '-q', remote, '.'])
    await runGit(collaborator, ['checkout', '-q', 'develop'])
    await runGit(collaborator, ['config', 'user.email', 'collab@t.co'])
    await runGit(collaborator, ['config', 'user.name', 'Collaborator'])
    writeFileSync(join(collaborator, 'ahead.txt'), 'remote ahead\n')
    await runGit(collaborator, ['add', 'ahead.txt'])
    await runGit(collaborator, ['commit', '-qm', 'remote develop moved'])
    await runGit(collaborator, ['push', '-q', 'origin', 'develop'])

    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/target-ahead', base: 'develop' })
    writeFileSync(join(dir, 'feature.txt'), 'feature\n')
    await runGit(dir, ['add', 'feature.txt'])
    await runGit(dir, ['commit', '-qm', 'feature target ahead'])
    const developBefore = out(dir, ['rev-parse', 'develop'])
    const finished = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/target-ahead', target: 'develop',
      strategy: 'merge', message: 'finish target ahead', deleteBranch: true, pushRemote: 'origin',
    })
    assert.equal(finished.ok, false)
    assert.equal(finished.error.code, 'push-rejected')
    assert.equal(out(dir, ['rev-parse', 'develop']), developBefore)
    assert.equal(out(dir, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/target-ahead')
    assert.ok(branchExists(dir, 'feature/target-ahead'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
    rmSync(collaborator, { recursive: true, force: true })
  }
})


test('feature finish can resume after a chained release push failure', async () => {
  const dir = await freshRepo('gp-flow-chain-resume-')
  const remote = mkdtempSync(join(tmpdir(), 'gp-flow-chain-resume-bare-'))
  try {
    await runGit(remote, ['init', '-q', '--bare'])
    await withDevelop(dir)
    await runGit(dir, ['remote', 'add', 'origin', remote])
    await runGit(dir, ['push', '-q', 'origin', 'main', 'develop'])
    await runGit(dir, ['checkout', '-q', '-b', 'release-seed', 'main'])
    writeFileSync(join(dir, 'seed.txt'), 'seed\n')
    await runGit(dir, ['add', 'seed.txt'])
    await runGit(dir, ['commit', '-qm', 'remote release seed'])
    await runGit(dir, ['push', '-q', 'origin', 'release-seed:refs/heads/release/3.0.0'])
    await runGit(dir, ['checkout', '-q', 'main'])

    await run(dir, { kind: 'flow-start', flow: 'feature', branch: 'feature/chain-resume', base: 'develop' })
    writeFileSync(join(dir, 'feature.txt'), 'feature\n')
    await runGit(dir, ['add', 'feature.txt'])
    await runGit(dir, ['commit', '-qm', 'feature chain resume'])
    const partialFinish = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/chain-resume', target: 'develop',
      strategy: 'merge', message: 'finish chain resume', deleteBranch: true,
      startRelease: 'release/3.0.0', pushRemote: 'origin', releasePushRemote: 'origin',
    })
    assert.equal(partialFinish.ok, false)
    assert.equal(partialFinish.error.code, 'flow-partial')
    assert.ok(branchExists(dir, 'release/3.0.0'))
    assert.ok(branchExists(dir, 'feature/chain-resume'))

    const resumed = await run(dir, {
      kind: 'flow-finish', flow: 'feature', branch: 'feature/chain-resume', target: 'develop',
      strategy: 'merge', message: 'finish chain resume', deleteBranch: true,
      startRelease: 'release/3.0.0',
    })
    assert.equal(resumed.ok, true, JSON.stringify(resumed))
    assert.equal(resumed.snapshot.branch, 'release/3.0.0')
    assert.equal(branchExists(dir, 'feature/chain-resume'), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})


test('flow-finish does not resume from a lightweight tag', async () => {
  const dir = await freshRepo('gp-flow-lightweight-tag-')
  try {
    await withDevelop(dir)
    await run(dir, { kind: 'flow-start', flow: 'release', branch: 'release/3.1.0', base: 'develop' })
    await runGit(dir, ['tag', 'v3.1.0', 'main'])
    const refused = await run(dir, {
      kind: 'flow-finish', flow: 'release', branch: 'release/3.1.0', target: 'main',
      strategy: 'merge', message: 'release 3.1.0', deleteBranch: true, tag: 'v3.1.0',
    })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'tag-exists')
    assert.ok(branchExists(dir, 'release/3.1.0'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
