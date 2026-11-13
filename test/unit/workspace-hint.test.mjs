/**
 * The workspace-file hint's wording.
 *
 * `repo-list` reports *which* check refused an unusable workspace file; the two
 * places that render it (the switcher's hint row and the browser's notice bar)
 * go through this one mapping, so they cannot drift apart. The load-bearing
 * properties: every reason maps to its own message — one sentence for all six
 * would only say that something is wrong — an older host that sends no reason
 * keeps the generic text instead of guessing, and every key the mapping can
 * return exists in the dictionary.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DICTIONARIES, workspaceInvalidKey } from '../../lib/testkit.mjs'

const REASONS = ['name', 'link', 'not-file', 'size', 'read', 'parse']

test('every reason has its own message', () => {
  const keys = REASONS.map((reason) => workspaceInvalidKey(reason))
  assert.deepEqual(keys, [
    'repos.workspaceInvalidName',
    'repos.workspaceInvalidLink',
    'repos.workspaceInvalidNotFile',
    'repos.workspaceInvalidSize',
    'repos.workspaceInvalidRead',
    'repos.workspaceInvalidParse',
  ])
  assert.equal(new Set(keys).size, REASONS.length, 'no two reasons share a message')
})

test('an older host without a reason keeps the generic message', () => {
  // `invalid` alone does not say whether the setting or the file is at fault,
  // so naming one of them would be a guess the host never made.
  assert.equal(workspaceInvalidKey(undefined), 'repos.workspaceInvalid')
})

test('a reason this build does not know falls back instead of inventing text', () => {
  // A newer host may add a check; the panel then says the honest generic thing.
  assert.equal(workspaceInvalidKey('encoding'), 'repos.workspaceInvalid')
})

test('every message the mapping returns is in the dictionary', () => {
  for (const reason of [...REASONS, undefined, 'encoding']) {
    const key = workspaceInvalidKey(reason)
    assert.ok(key in DICTIONARIES.zh, `${String(reason)}: ${key} must exist`)
  }
})

test('the file-naming messages take a {file} placeholder, the setting one does not', () => {
  // The setting value is not a path this build can name: there is no file to
  // substitute, so that message must not promise one.
  assert.equal(DICTIONARIES.zh['repos.workspaceInvalidName'].includes('{file}'), false)
  for (const key of [
    'repos.workspaceInvalidLink',
    'repos.workspaceInvalidNotFile',
    'repos.workspaceInvalidSize',
    'repos.workspaceInvalidRead',
    'repos.workspaceInvalidParse',
  ]) {
    assert.ok(DICTIONARIES.zh[key].includes('{file}'), `${key} names the file`)
  }
})
