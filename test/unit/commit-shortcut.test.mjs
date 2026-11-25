/**
 * `isCommitShortcut` / `ownsTypedText`: what the split commit button's
 * accelerator accepts (issue #152). Ctrl or ⌘ plus Alt plus K fires; Shift does
 * not, and three inputs must never turn into a write.
 *
 * The evidence that matters:
 *   - macOS: Option+K types "˚", so the chord is matched by `code`, not by the
 *     character;
 *   - a held key auto-repeats, and by then the box is empty — a second write
 *     would report "the message is empty" right after a successful commit;
 *   - AltGr is Ctrl+Alt on Windows, so AltGr+K on a layout that types with it
 *     would otherwise commit;
 *   - the Amend checkbox is an `input` but not a text field: swallowing the
 *     chord there left the accelerator dead while the main button was enabled.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCommitShortcut, isTextInputType, ownsTypedText } from '../../lib/testkit.mjs'

const chord = (overrides = {}) => ({
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  code: 'KeyK', key: 'k', repeat: false, altGraph: false, ...overrides,
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

test('a held key never fires a second write', () => {
  assert.equal(isCommitShortcut(chord({ ctrlKey: true, altKey: true, repeat: true })), false)
  assert.equal(isCommitShortcut(chord({ metaKey: true, altKey: true, repeat: true })), false)
})

test('AltGr is never the accelerator', () => {
  // Windows reports AltGr as Ctrl+Alt; a layout that types a character with
  // AltGr+K would otherwise commit while the user is typing.
  assert.equal(isCommitShortcut(chord({ ctrlKey: true, altKey: true, altGraph: true })), false)
  assert.equal(isCommitShortcut(chord({ metaKey: true, altKey: true, altGraph: true })), false)
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

test('only text-entry input types own typed characters', () => {
  for (const type of ['text', 'search', 'url', 'tel', 'email', 'password', 'number', 'date', 'time', 'TEXT']) {
    assert.equal(isTextInputType(type), true, `${type} takes typed text`)
  }
  assert.equal(isTextInputType(null), true, 'an INPUT without a type attribute is a text field')
  assert.equal(isTextInputType(''), true)
  for (const type of ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'hidden']) {
    assert.equal(isTextInputType(type), false, `${type} takes no typed text`)
  }
})

/** The three DOM facts `ownsTypedText` reads, without a document. */
const fake = (tagName, { type = null, contenteditable = null } = {}) => ({
  tagName,
  getAttribute: (name) => (name === 'type' ? type : contenteditable),
  // Mirrors `[contenteditable]:not([contenteditable="false"])`.
  closest: () => (contenteditable !== null && contenteditable !== 'false' ? { contenteditable } : null),
})

test('a text field owns its keystrokes; the Amend checkbox does not', () => {
  assert.equal(ownsTypedText(fake('TEXTAREA')), true, 'the review comment box')
  assert.equal(ownsTypedText(fake('INPUT', { type: 'search' })), true, 'the diff find field')
  assert.equal(ownsTypedText(fake('INPUT', { type: null })), true, 'an untyped input is text')
  assert.equal(ownsTypedText(fake('DIV', { contenteditable: 'true' })), true, 'a contenteditable editor')
  assert.equal(ownsTypedText(fake('INPUT', { type: 'checkbox' })), false, 'the Amend checkbox keeps the accelerator alive')
  assert.equal(ownsTypedText(fake('INPUT', { type: 'radio' })), false)
  assert.equal(ownsTypedText(fake('BUTTON')), false, 'a toolbar button')
  assert.equal(ownsTypedText(fake('DIV', { contenteditable: 'false' })), false, 'contenteditable="false" is not an editor')
})
