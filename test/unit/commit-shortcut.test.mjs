/**
 * `isCommitShortcut`: the chord behind the split commit button's accelerator
 * (issue #152). Ctrl or ⌘ plus Alt plus K fires; Shift does not.
 *
 * The important evidence is the macOS one: Option+K does not produce "k", it
 * produces "˚", so the match has to read `code` and must not compare only
 * characters. The `key` branch stays as the fallback for synthetic events that
 * omit `code`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCommitShortcut } from '../../lib/testkit.mjs'

const chord = (overrides = {}) => ({
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  code: 'KeyK', key: 'k', ...overrides,
})

test('Ctrl or ⌘ plus Alt plus K is the accelerator', () => {
  assert.equal(isCommitShortcut(chord({ ctrlKey: true, altKey: true })), true)
  assert.equal(isCommitShortcut(chord({ metaKey: true, altKey: true })), true)
  assert.equal(isCommitShortcut(chord({ ctrlKey: true, metaKey: true, altKey: true })), true)
})

test('the chord is matched by code, so macOS Option+K still fires', () => {
  assert.equal(isCommitShortcut(chord({ metaKey: true, altKey: true, key: '˚' })), true, 'Option+K types "˚", not "k"')
  assert.equal(isCommitShortcut(chord({ ctrlKey: true, altKey: true, code: '', key: 'k' })), true, 'a host without code falls back to the character')
  assert.equal(isCommitShortcut(chord({ ctrlKey: true, altKey: true, code: '', key: 'K' })), true, 'the character is case-insensitive')
})

test('near misses never fire', () => {
  for (const [label, keys] of [
    ['Shift makes it a different chord', chord({ ctrlKey: true, altKey: true, shiftKey: true })],
    ['Alt alone', chord({ altKey: true })],
    ['Ctrl alone', chord({ ctrlKey: true })],
    ['Ctrl+Alt+J', chord({ ctrlKey: true, altKey: true, code: 'KeyJ', key: 'j' })],
    ['plain K', chord()],
  ]) {
    assert.equal(isCommitShortcut(keys), false, label)
  }
})
