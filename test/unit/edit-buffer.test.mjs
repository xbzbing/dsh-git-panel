/**
 * Editor helpers: language and indent inference, the LF editor buffer, the
 * pre-save JSON / XML / YAML checks, and the edit button state. The YAML cases
 * mirror the `yaml` 2.9.1 probe recorded in the design (custom tags are
 * warnings, real syntax problems are errors with a line and column).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  editorLanguageFor, isJsoncName, checkedLanguageFor, toEditBuffer, inferIndentUnit, lineColumnAt,
  checkJson, checkXml, editAvailability, editBlockKey, validateYaml,
  registerEditMount, hasUnsavedEdit, hasStashedUnsavedEdit, discardUnsavedEdit, stashDraft, takeStashedDraft, resetEditStore,
} from '../../lib/testkit.mjs'

test('editor language per allow-listed file', () => {
  assert.equal(editorLanguageFor('a/b.JSON'), 'json')
  assert.equal(editorLanguageFor('pom.xml'), 'xml')
  assert.equal(editorLanguageFor('README.md'), 'markdown')
  assert.equal(editorLanguageFor('notes.markdown'), 'markdown')
  assert.equal(editorLanguageFor('ci.yml'), 'yaml')
  assert.equal(editorLanguageFor('Cargo.toml'), 'toml')
  for (const name of ['app.properties', 'setup.cfg', 'php.ini', '.editorconfig', 'sub/.env']) assert.equal(editorLanguageFor(name), 'properties', name)
  for (const name of ['a.txt', 'nginx.conf', '.gitignore', '.gitattributes']) assert.equal(editorLanguageFor(name), 'text', name)
})

test('JSONC names skip the JSON check; XML and YAML are checked', () => {
  for (const name of ['tsconfig.json', 'tsconfig.build.json', 'jsconfig.json', '.vscode/settings.json', 'x/.devcontainer.json', 'devcontainer.json', '.eslintrc.json', 'pkg/babel.config.json', 'deno.json']) {
    assert.equal(isJsoncName(name), true, name)
    assert.equal(checkedLanguageFor(name), null, name)
  }
  assert.equal(checkedLanguageFor('package.json'), 'json')
  assert.equal(checkedLanguageFor('a.xml'), 'xml')
  assert.equal(checkedLanguageFor('a.yaml'), 'yaml')
  assert.equal(checkedLanguageFor('a.toml'), null)
})

test('editor buffer drops the BOM and folds CRLF / CR to LF', () => {
  assert.equal(toEditBuffer('\uFEFFa\r\nb\rc\n'), 'a\nb\nc\n')
  assert.equal(toEditBuffer('plain'), 'plain')
})

test('indent unit follows the file', () => {
  assert.equal(inferIndentUnit('a:\n\tb: 1\n'), '\t')
  assert.equal(inferIndentUnit('{\n    "a": {\n        "b": 1\n    }\n}\n'), '    ')
  assert.equal(inferIndentUnit('a:\n  b:\n    c: 1\n'), '  ')
  assert.equal(inferIndentUnit('no indent\n'), '  ')
})

test('JSON check reports a 1-based line and column', () => {
  assert.equal(checkJson('{"a": 1}'), null)
  const issue = checkJson('{\n  "a": 1,\n  "b": \n}')
  assert.ok(issue !== null)
  assert.equal(issue.line, 4)
  assert.equal(issue.column, 1)
  assert.equal(issue.count, 1)
  assert.match(issue.message, /unexpected "}"/)
  assert.deepEqual(lineColumnAt('ab\ncd', 4), { line: 2, column: 2 })
  // A character that prints as nothing is named by its code point.
  assert.match(checkJson('\uFEFF{}').message, /U\+FEFF/)
  const cases = [
    ['{"a": 1,}', 1, 9], ['[1, 2', 1, 6], ['{"a" 1}', 1, 6], ['"a\\u12"', 1, 3], ['{"a": tru}', 1, 7],
    ['{"a": 01}', 1, 8], ['{"a": 1}\nx', 2, 1], ['{"a": "x\ny"}', 1, 9],
  ]
  for (const [text, line, column] of cases) {
    const found = checkJson(text)
    assert.ok(found !== null, text)
    assert.deepEqual([found.line, found.column], [line, column], text)
  }
})

test('XML check reads the parser error location, ignoring a document element named parsererror', () => {
  const parser = (...elements) => ({ parseFromString: () => ({ getElementsByTagName: () => elements }) })
  assert.equal(checkXml('<a/>', parser()), null)
  const chromium = parser({ namespaceURI: 'http://www.w3.org/1999/xhtml', textContent: 'This page contains the following errors:error on line 3 at column 5: Opening and ending tag mismatch' })
  const issue = checkXml('<a>\n<b>\n</a>', chromium)
  assert.equal(issue.line, 3)
  assert.equal(issue.column, 5)
  const firefox = parser({ namespaceURI: 'http://www.mozilla.org/newlayout/xml/parsererror.xml', textContent: 'XML Parsing Error: mismatched tag\nLine Number 2, Column 3:' })
  assert.equal(checkXml('x', firefox).line, 2)
  assert.equal(checkXml('<r><parsererror/></r>', parser({ namespaceURI: null, textContent: '' })), null)
})

test('YAML check: custom tags pass, real errors carry their position', () => {
  assert.equal(validateYaml('Resources:\n  Bucket:\n    Name: !Ref Name\n    Arn: !GetAtt Bucket.Arn\n'), null)
  assert.equal(validateYaml('test:\n  script:\n    - !reference [.setup, script]\n'), null)
  assert.equal(validateYaml('a: 1\nb:\n  - x\n'), null)
  const duplicate = validateYaml('a: 1\na: 2\n')
  assert.deepEqual([duplicate.line, duplicate.column], [2, 1])
  const tab = validateYaml('a:\n\tb: 1\n')
  assert.deepEqual([tab.line, tab.column], [2, 1])
  const quote = validateYaml('a: "open\nb: 2\n')
  assert.ok(quote !== null && quote.line >= 1)
  // An error in the second document of a multi-document stream is still found.
  const second = validateYaml('a: 1\n---\nb: [1, 2\nc: 3\n')
  assert.ok(second !== null && second.line >= 3, JSON.stringify(second))
})

test('edit button: hidden without host edit facts, disabled with a reason, ready otherwise', () => {
  assert.deepEqual(editAvailability({ kind: 'text', content: '', lines: 0, path: 'a.js' }), { state: 'hidden' })
  assert.deepEqual(editAvailability({ kind: 'binary', path: 'a.bin' }), { state: 'hidden' })
  assert.deepEqual(editAvailability({ kind: 'text', path: 'a.md', sha256: 'x', edit: { ok: true, eol: 'lf', bom: false } }), { state: 'ready' })
  assert.deepEqual(editAvailability({ kind: 'text', path: 'a.md', edit: { ok: false, reason: 'encoding' } }), { state: 'disabled', reason: 'files.editBlockedEncoding' })
  assert.deepEqual(editAvailability({ kind: 'tooLarge', path: 'a.json', edit: { ok: false, reason: 'too-large' } }), { state: 'disabled', reason: 'files.editBlockedTooLarge' })
  assert.deepEqual(editAvailability({ kind: 'text', path: 'a.json', edit: { ok: false, reason: 'read-only' } }), { state: 'disabled', reason: 'files.editBlockedReadOnly' })
  assert.equal(editBlockKey('mixed-eol'), 'files.editBlockedMixedEol')
})

const draft = (dirty, path = 'a.md') => ({ id: 1, path, dirty, text: '', baseline: '', baseSha256: 'x', eol: 'lf', bom: false, rootKey: '', rootPath: null })

test('edit store: a session is unsaved while any of its mounts or its stash is', () => {
  resetEditStore()
  const a = registerEditMount('s1', () => undefined)
  const b = registerEditMount('s1', () => undefined)
  a.setDirty(true)
  // A second panel of the same session mounting clean does not clear the first.
  b.setDirty(false)
  assert.equal(hasUnsavedEdit('s1'), true)
  assert.equal(hasUnsavedEdit('s2'), false)
  a.setDirty(false)
  assert.equal(hasUnsavedEdit('s1'), false)
  // The unmount parks the draft; it still counts until a mount takes it.
  a.release()
  stashDraft('s1', draft(true))
  assert.equal(hasUnsavedEdit('s1'), true)
  assert.equal(hasStashedUnsavedEdit('s1'), true)
  // A clean draft from the other panel never replaces a parked unsaved one.
  b.release()
  stashDraft('s1', null)
  stashDraft('s1', draft(false))
  assert.equal(takeStashedDraft('s1').dirty, true)
  assert.equal(takeStashedDraft('s1'), null, 'taken once')
  assert.equal(hasUnsavedEdit('s1'), false)
})

test('edit store: a discard reaches every mount of the session and the stash', () => {
  resetEditStore()
  const dropped = []
  const a = registerEditMount('s1', () => dropped.push('a'))
  registerEditMount('s1', () => dropped.push('b'))
  registerEditMount('s2', () => dropped.push('c'))
  a.setDirty(true)
  stashDraft('s1', draft(true))
  discardUnsavedEdit('s1')
  assert.deepEqual(dropped.sort(), ['a', 'b'])
  assert.equal(takeStashedDraft('s1'), null, 'a discarded draft cannot come back from the stash')
  assert.equal(hasUnsavedEdit('s1'), false)
  resetEditStore()
})
