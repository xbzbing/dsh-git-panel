/**
 * Action-plan tests: GitAction → git command sequences, including amend and
 * per-path commit, plus path-safety guards.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSafePath, planAction } from '../lib/testkit.mjs'

test('isSafePath rejects absolute paths and .. traversal', () => {
  assert.equal(isSafePath('src/a.ts'), true)
  assert.equal(isSafePath(''), false)
  assert.equal(isSafePath('/etc/passwd'), false)
  assert.equal(isSafePath('../outside'), false)
  assert.equal(isSafePath('a/../../b'), false)
})

test('commit without paths is a single git commit', () => {
  const plan = planAction({ kind: 'commit', message: 'hello' }, false)
  assert.deepEqual(plan.argv, [['git', 'commit', '-m', 'hello']])
})

test('commit --amend carries the amend flag', () => {
  const plan = planAction({ kind: 'commit', message: 'fixed', amend: true }, false)
  assert.deepEqual(plan.argv, [['git', 'commit', '--amend', '-m', 'fixed']])
})

test('amend with an empty message is allowed (reuse previous message)', () => {
  const plan = planAction({ kind: 'commit', message: '', amend: true }, false)
  assert.deepEqual(plan.argv, [['git', 'commit', '--amend']])
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
