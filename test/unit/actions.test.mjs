/**
 * Action-plan tests: GitAction → git command sequences, including amend and
 * per-path commit, plus path-safety guards.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSafePath, isSafeRev, isSafeBranchName, planAction } from '../../lib/testkit.mjs'

test('isSafePath rejects absolute paths and .. traversal', () => {
  assert.equal(isSafePath('src/a.ts'), true)
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
