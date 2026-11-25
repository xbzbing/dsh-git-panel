/**
 * `commitModeFor` / `rememberCommitMode`: the split commit button's session
 * scope (issue #152). The mode is a workflow preference that must survive tab
 * switches inside one DSH session, stay independent between sessions, and never
 * outlive the page (it is not written to the plugin config).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commitModeFor, rememberCommitMode } from '../../lib/testkit.mjs'

test('a session starts on plain commit', () => {
  assert.equal(commitModeFor('session-default'), 'commit')
})

test('a chosen mode is remembered for that session only', () => {
  rememberCommitMode('session-a', 'commit-push')
  assert.equal(commitModeFor('session-a'), 'commit-push')
  assert.equal(commitModeFor('session-b'), 'commit', 'another conversation keeps its own choice')
})

test('choosing plain commit again drops the stored choice', () => {
  rememberCommitMode('session-c', 'commit-push')
  rememberCommitMode('session-c', 'commit')
  assert.equal(commitModeFor('session-c'), 'commit')
})

test('the choice is idempotent', () => {
  rememberCommitMode('session-d', 'commit-push')
  rememberCommitMode('session-d', 'commit-push')
  assert.equal(commitModeFor('session-d'), 'commit-push')
})
