/**
 * Action-plan tests: GitAction → git command sequences, including amend and
 * per-path commit, plus path-safety guards.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSafePath, isSafeRev, isSafeBranchName, planAction, classifyActionFailure } from '../../lib/testkit.mjs'

test('isSafePath rejects absolute paths and .. traversal', () => {
  // POSIX assumptions: dsh runs on POSIX, so `C:\x` is a relative name here
  // (backslash is a normal path char) and passes; `.git/config` is in-repo and
  // low-risk. The rules that matter — absolute, empty, `..` escape — are covered.
  assert.equal(isSafePath('src/a.ts'), true)
  assert.equal(isSafePath('dir with spaces/файл.txt'), true)
  assert.equal(isSafePath(''), false)
  assert.equal(isSafePath('/etc/passwd'), false)
  assert.equal(isSafePath('../outside'), false)
  assert.equal(isSafePath('a/../../b'), false)
})

test('isSafeRev rejects option-injection and rev metacharacters', () => {
  assert.equal(isSafeRev('main'), true)
  assert.equal(isSafeRev('feature/x'), true)
  assert.equal(isSafeRev('0a1b2c3d'), true)
  assert.equal(isSafeRev(''), false)
  assert.equal(isSafeRev('--output=/tmp/pwn'), false, 'dash-prefixed → git option')
  assert.equal(isSafeRev('-f'), false)
  assert.equal(isSafeRev('a b'), false, 'whitespace')
  assert.equal(isSafeRev('HEAD~1'), false)
  assert.equal(isSafeRev('a..b'), false, 'rev range')
  assert.equal(isSafeRev('HEAD@{0}'), false)
  assert.equal(isSafeRev('a:b'), false)
  assert.equal(isSafeRev('a*'), false)
})

test('isSafeBranchName adds the leading-slash rule on top of isSafeRev', () => {
  assert.equal(isSafeBranchName('main'), true)
  assert.equal(isSafeBranchName('/abs'), false)
  assert.equal(isSafeBranchName('-f'), false)
})

test('commit without paths is a single git commit', () => {
  const plan = planAction({ kind: 'commit', message: 'hello' }, false)
  assert.deepEqual(plan.argv, [['git', 'commit', '-m', 'hello']])
})

test('commit --amend carries the amend flag', () => {
  const plan = planAction({ kind: 'commit', message: 'fixed', amend: true }, false)
  assert.deepEqual(plan.argv, [['git', 'commit', '--amend', '-m', 'fixed']])
})

test('amend with an empty message reuses the previous message via --no-edit', () => {
  const plan = planAction({ kind: 'commit', message: '', amend: true }, false)
  assert.deepEqual(plan.argv, [['git', 'commit', '--amend', '--no-edit']])
})

test('empty non-amend commit is rejected', () => {
  const plan = planAction({ kind: 'commit', message: '  ' }, false)
  assert.equal(plan.error, 'empty-message')
})

test('per-path commit stages then commits the chosen paths', () => {
  const plan = planAction({ kind: 'commit', message: 'm', paths: ['a.txt', 'b.txt'] }, false)
  assert.deepEqual(plan.argv, [
    ['git', 'add', '--', 'a.txt', 'b.txt'],
    ['git', 'commit', '-m', 'm', '--', 'a.txt', 'b.txt'],
  ])
})

test('unsafe path in a commit is rejected', () => {
  const plan = planAction({ kind: 'commit', message: 'm', paths: ['../evil'] }, false)
  assert.equal(plan.error, 'invalid-path')
})

test('unstage uses rm --cached when unborn, restore otherwise', () => {
  const unborn = planAction({ kind: 'unstage', paths: ['a.txt'] }, true)
  assert.deepEqual(unborn.argv, [['git', 'rm', '--cached', '-r', '--', 'a.txt']])
  const born = planAction({ kind: 'unstage', paths: ['a.txt'] }, false)
  assert.deepEqual(born.argv, [['git', 'restore', '--staged', '--', 'a.txt']])
})

test('stage-all / fetch produce their fixed commands', () => {
  assert.deepEqual(planAction({ kind: 'stage-all' }, false).argv, [['git', 'add', '-A']])
  assert.deepEqual(planAction({ kind: 'fetch' }, false).argv, [['git', 'fetch', '--all', '--prune']])
})

test('stage / discard produce path-scoped commands', () => {
  assert.deepEqual(planAction({ kind: 'stage', paths: ['a.txt'] }, false).argv, [['git', 'add', '--', 'a.txt']])
  assert.deepEqual(planAction({ kind: 'discard', paths: ['a.txt'] }, false).argv, [['git', 'restore', '--', 'a.txt']])
  assert.equal(planAction({ kind: 'stage', paths: ['../evil'] }, false).error, 'invalid-path')
})

test('unstage-all uses rm --cached . when unborn, restore --staged . otherwise', () => {
  assert.deepEqual(planAction({ kind: 'unstage-all' }, true).argv, [['git', 'rm', '--cached', '-r', '--', '.']])
  assert.deepEqual(planAction({ kind: 'unstage-all' }, false).argv, [['git', 'restore', '--staged', '--', '.']])
})

test('branch-checkout guards the name and passes it after --end-of-options', () => {
  assert.deepEqual(
    planAction({ kind: 'branch-checkout', name: 'feature/x' }, false).argv,
    [['git', 'checkout', '--end-of-options', 'feature/x']],
  )
  assert.equal(planAction({ kind: 'branch-checkout', name: '-f' }, false).error, 'invalid-name')
  assert.equal(planAction({ kind: 'branch-checkout', name: '/abs' }, false).error, 'invalid-name')
})

test('tag-create builds a lightweight tag and guards name + commit', () => {
  assert.deepEqual(
    planAction({ kind: 'tag-create', name: 'v1.0', commit: 'abc123' }, false).argv,
    [['git', 'tag', '--end-of-options', 'v1.0', 'abc123']],
  )
  assert.equal(planAction({ kind: 'tag-create', name: '-f', commit: 'abc123' }, false).error, 'invalid-name')
  assert.equal(planAction({ kind: 'tag-create', name: 'v1', commit: '--output=x' }, false).error, 'invalid-name')
})

test('tag-create with a message builds an annotated tag (-a -m)', () => {
  assert.deepEqual(
    planAction({ kind: 'tag-create', name: 'v1.0', commit: 'abc123', message: 'release' }, false).argv,
    [['git', 'tag', '-a', '-m', 'release', '--end-of-options', 'v1.0', 'abc123']],
  )
  // A blank/whitespace message degrades to a lightweight tag (no -a).
  assert.deepEqual(
    planAction({ kind: 'tag-create', name: 'v1.0', commit: 'abc123', message: '   ' }, false).argv,
    [['git', 'tag', '--end-of-options', 'v1.0', 'abc123']],
  )
})

test('tag-delete guards the name and passes it after --end-of-options', () => {
  assert.deepEqual(planAction({ kind: 'tag-delete', name: 'v1.0' }, false).argv, [['git', 'tag', '-d', '--end-of-options', 'v1.0']])
  assert.equal(planAction({ kind: 'tag-delete', name: '-d' }, false).error, 'invalid-name')
})

test('stash-push builds push with/without a message', () => {
  assert.deepEqual(planAction({ kind: 'stash-push' }, false).argv, [['git', 'stash', 'push']])
  assert.deepEqual(planAction({ kind: 'stash-push', message: 'wip' }, false).argv, [['git', 'stash', 'push', '-m', 'wip']])
  assert.deepEqual(planAction({ kind: 'stash-push', message: '  ' }, false).argv, [['git', 'stash', 'push']])
})

test('stash apply/pop/drop reference stash@{N} from a validated integer index', () => {
  assert.deepEqual(planAction({ kind: 'stash-apply', index: 0, sha: 'x' }, false).argv, [['git', 'stash', 'apply', '--end-of-options', 'stash@{0}']])
  assert.deepEqual(planAction({ kind: 'stash-pop', index: 2, sha: 'x' }, false).argv, [['git', 'stash', 'pop', '--end-of-options', 'stash@{2}']])
  assert.deepEqual(planAction({ kind: 'stash-drop', index: 1, sha: 'x' }, false).argv, [['git', 'stash', 'drop', '--end-of-options', 'stash@{1}']])
  assert.equal(planAction({ kind: 'stash-drop', index: -1, sha: 'x' }, false).error, 'invalid-index')
  assert.equal(planAction({ kind: 'stash-apply', index: 1.5, sha: 'x' }, false).error, 'invalid-index')
})

test('classifyActionFailure orders conflict before nothing-to-commit, and maps codes', () => {
  // A stash pop conflict prints BOTH "CONFLICT" and "no changes added to commit";
  // conflict must win (git keeps the stash → recoverable).
  const popConflict = classifyActionFailure('Auto-merging a\nCONFLICT (content): Merge conflict in a\nno changes added to commit', '', 1)
  assert.equal(popConflict.code, 'conflict')
  assert.equal(classifyActionFailure('', 'fatal: Unable to create .git/index.lock: File exists', 128).code, 'index-busy')
  assert.equal(classifyActionFailure('nothing to commit, working tree clean', '', 1).code, 'git-error')
  assert.equal(classifyActionFailure('', "error: tag 'nope' not found.", 1).code, 'not-found')
  assert.equal(classifyActionFailure('', 'is not a valid reference', 1).code, 'not-found')
  assert.equal(classifyActionFailure('', 'error: Your local changes to the following files would be overwritten by merge', 1).code, 'local-changes-block')
  assert.equal(classifyActionFailure('', 'something else entirely', 1).code, 'git-error')
})
