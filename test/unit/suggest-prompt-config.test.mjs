import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GitPanelService } from '../../lib/host/index.js'
import {
  supportsSuggestPrompt, promptUtf8Bytes, normalizePrompt, savedPrompt, savedPromptLanguage,
  samePromptIdentity, parsePromptPreview, promptEditorInitial, promptEditorDirty, promptEditorReduce,
} from '../../lib/testkit.mjs'

const MAX = 16 * 1024
const preview = (prompt = '', languageSetting = 'auto', view = 'effective') => ({
  ok: true,
  value: {
    kind: 'suggest-prompt', view, source: prompt === '' ? 'default' : 'custom', configuredPrompt: prompt, languageSetting,
    variants: { zh: { system: '中文系统\n原文', userReminder: '中文提醒' }, en: { system: 'English system\noriginal', userReminder: 'English reminder' } },
  },
})
const clone = (value) => JSON.parse(JSON.stringify(value))

test('prompt edit support is an exact schema declaration, never a value or description', () => {
  for (const schema of [undefined, null, [], {}, { value: { suggestPrompt: '' } }, { description: 'suggestPrompt' }, { dict: [] }, { dict: { suggestPromptOther: {} } }]) {
    assert.equal(supportsSuggestPrompt(schema), false)
  }
  assert.equal(supportsSuggestPrompt({ dict: { suggestPrompt: {} } }), true)
  assert.equal(supportsSuggestPrompt({ dict: Object.create({ suggestPrompt: {} }) }), false)
})

test('actual host Config.toJSON serialization declares prompt support without hydrating callbacks', () => {
  const serialized = GitPanelService.Config.toJSON()
  assert.equal(supportsSuggestPrompt(serialized), true)
  const old = clone(serialized)
  delete old.refs[old.uid].dict.suggestPrompt
  assert.equal(supportsSuggestPrompt(old), false)
  const graph = { uid: 4, refs: { 1: { type: 'boolean' }, 3: { type: 'any' }, 4: { type: 'object', dict: { showInputPill: 1, suggestPrompt: 3 } } } }
  assert.equal(supportsSuggestPrompt(graph), true)
  for (const invalid of [
    { uid: 7, refs: graph.refs }, { uid: '4', refs: graph.refs }, { uid: -1, refs: graph.refs },
    { uid: 4, refs: [] }, { uid: 4, refs: null }, { uid: 4, refs: { 4: { type: 'object', dict: { suggestPrompt: 3 } } } },
    { uid: 4, refs: { 4: { type: 'union', dict: { suggestPrompt: 3 } }, 3: {} } },
    { uid: 4, refs: { 4: { type: 'object', dict: { suggestPrompt: '3' } }, 3: {} } },
    { uid: 4, refs: { 4: { type: 'object', dict: { suggestPrompt: 3 } }, 3: null } },
    { uid: 4, refs: { 4: { type: 'object', description: 'suggestPrompt' }, 3: { type: 'any' } } },
    { uid: 4, refs: { 4: { type: 'object', dict: {} }, 3: { type: 'object', dict: { suggestPrompt: 4 } } } },
  ]) assert.equal(supportsSuggestPrompt(invalid), false)
  graph.refs[3].callback = () => { throw new Error('callback must not execute') }
  assert.equal(supportsSuggestPrompt(graph), true)
})

test('UTF-8 ceiling counts bytes, including emoji and isolated surrogates', () => {
  for (const text of ['ascii', '中文', '😀', '\ud800', '\udc00', 'a😀中']) {
    assert.equal(promptUtf8Bytes(text), Buffer.byteLength(text, 'utf8'))
  }
  assert.equal(savedPrompt('😀'.repeat(MAX / 4)), '😀'.repeat(MAX / 4))
  assert.equal(savedPrompt('😀'.repeat(MAX / 4) + 'a'), null)
  assert.equal(savedPrompt('a'.repeat(MAX)), 'a'.repeat(MAX))
  assert.equal(savedPrompt('a'.repeat(MAX + 1)), null)
  assert.equal(savedPrompt(42), null)
  assert.equal(savedPrompt(null), null)
})

test('fallback byte counting is the TextEncoder equivalent', () => {
  const encoder = globalThis.TextEncoder
  try {
    globalThis.TextEncoder = undefined
    assert.equal(promptUtf8Bytes('a😀中\ud800\udc00\ud800'), Buffer.byteLength('a😀中\ud800\udc00\ud800'))
  } finally {
    globalThis.TextEncoder = encoder
  }
})

test('blank defaults normalize while non-empty rules preserve every original character', () => {
  assert.equal(savedPrompt(undefined), '')
  assert.equal(normalizePrompt(' \t\n\r\u3000'), '')
  assert.equal(savedPrompt(' \t\n\r\u3000'), '')
  assert.equal(savedPrompt(' '.repeat(MAX + 1)), '', 'arbitrary whitespace is always the default')
  assert.equal(normalizePrompt('  title\n\tbody  '), '  title\n\tbody  ')
  assert.equal(savedPromptLanguage('zh'), 'zh')
  assert.equal(savedPromptLanguage('en'), 'en')
  assert.equal(savedPromptLanguage('unknown'), 'auto')
})

test('preview identity uses both original prompt and language, without concatenation collisions', () => {
  assert.equal(samePromptIdentity({ configuredPrompt: 'en|auto', languageSetting: 'zh' }, { configuredPrompt: 'en|auto', languageSetting: 'zh' }), true)
  assert.equal(samePromptIdentity({ configuredPrompt: 'x', languageSetting: 'zh' }, { configuredPrompt: 'x', languageSetting: 'en' }), false)
  assert.equal(samePromptIdentity({ configuredPrompt: ' x', languageSetting: 'auto' }, { configuredPrompt: 'x', languageSetting: 'auto' }), false)
})

test('strict preview validation accepts both complete variants and correct view/source', () => {
  for (const language of ['auto', 'zh', 'en']) {
    assert.deepEqual(parsePromptPreview(preview('  custom\ntext  ', language), 'effective'), preview('  custom\ntext  ', language).value)
    assert.deepEqual(parsePromptPreview(preview('', language, 'default'), 'default'), preview('', language, 'default').value)
  }
  assert.equal(parsePromptPreview(preview('custom'), 'default'), null)
  assert.equal(parsePromptPreview({ ok: false, error: { code: 'transport' } }, 'effective'), null)
  assert.equal(parsePromptPreview({ ok: true, value: { ok: true, value: preview().value } }, 'effective'), null, 'transport envelope cannot masquerade as the business result')
  for (const data of [null, undefined, true, [], {}, { ok: true }, { ok: true, value: [] }]) assert.equal(parsePromptPreview(data, 'effective'), null)
})

test('every wire discriminator, field, type and bound is checked, including the hidden variant', () => {
  const mutations = [
    (v) => { delete v.kind }, (v) => { v.kind = 'model-catalog' }, (v) => { v.view = 'default' },
    (v) => { v.source = 'custom' }, (v) => { v.languageSetting = 'fr' }, (v) => { delete v.languageSetting },
    (v) => { v.configuredPrompt = 0 }, (v) => { delete v.configuredPrompt }, (v) => { v.configuredPrompt = ' \n' },
    (v) => { v.configuredPrompt = 'a'.repeat(MAX + 1); v.source = 'custom' },
    (v) => { delete v.variants }, (v) => { v.variants = [] }, (v) => { delete v.variants.en },
    (v) => { v.variants.zh = null }, (v) => { v.variants.en.userReminder = 1 },
    (v) => { v.variants.en.system = '' }, (v) => { delete v.variants.zh.userReminder },
    (v) => { v.variants.zh.system = '😀'.repeat(MAX / 2 + 1) },
  ]
  for (const mutate of mutations) {
    const response = clone(preview('', 'zh'))
    mutate(response.value)
    assert.equal(parsePromptPreview(response, 'effective'), null, mutate.toString())
  }
})

const reduce = promptEditorReduce
const edit = (state, text) => reduce(state, { type: 'edit', text })
const mirror = (state, value) => reduce(state, { type: 'mirror', value })

test('draft edits and unrelated mirrors never write or replace user text; failed save preserves draft', () => {
  let state = edit(promptEditorInitial('old'), 'new\nline')
  assert.equal(promptEditorDirty(state), true)
  assert.equal(mirror(state, 'old'), state)
  state = reduce(reduce(state, { type: 'start' }), { type: 'failure' })
  assert.equal(state.draft, 'new\nline')
  assert.equal(state.saved, 'old')
  assert.equal(state.result, 'failed')
  assert.equal(state.pending, null)
})

test('successful save holds captured text across old mirrors until acknowledgment', () => {
  let state = edit(promptEditorInitial('old'), '  next\ntext ')
  state = reduce(reduce(state, { type: 'start' }), { type: 'success' })
  assert.equal(state.draft, '  next\ntext ')
  assert.equal(state.saved, '  next\ntext ')
  assert.equal(promptEditorDirty(state), false)
  assert.equal(mirror(state, 'old'), state, 'no flashback to pre-save mirror')
  state = mirror(state, '  next\ntext ')
  assert.equal(state.pending, null)
  assert.equal(state.conflict, false)
})

test('mirror acknowledgment before set resolves is not an edit conflict', () => {
  let state = reduce(edit(promptEditorInitial('old'), 'new'), { type: 'start' })
  state = mirror(state, 'new')
  assert.equal(state.conflict, false)
  state = reduce(state, { type: 'success' })
  state = mirror(state, 'new')
  assert.equal(state.pending, null)
  assert.equal(state.draft, 'new')
})

test('external changes during editing or saving demand explicit reload; never silently overwrite', () => {
  let state = edit(promptEditorInitial('old'), 'draft')
  state = mirror(state, 'external')
  assert.equal(state.conflict, true)
  assert.equal(state.draft, 'draft')
  assert.equal(state.saved, 'external')
  state = reduce(state, { type: 'reload', value: 'external' })
  assert.deepEqual(state, promptEditorInitial('external'))
  state = reduce(edit(state, 'next'), { type: 'start' })
  state = mirror(state, 'other')
  state = reduce(state, { type: 'success' })
  assert.equal(state.conflict, true)
  assert.equal(state.saved, 'other')
  assert.equal(state.draft, 'next')
})

test('clear remains a draft operation, and blank save restores normalized default only on success', () => {
  let state = edit(promptEditorInitial('custom'), ' \n\t')
  assert.equal(state.saved, 'custom')
  assert.equal(promptEditorDirty(state), true)
  state = reduce(reduce(state, { type: 'start' }), { type: 'success' })
  assert.equal(state.draft, '')
  assert.equal(state.saved, '')
  assert.equal(mirror(state, 'custom'), state)
  assert.equal(mirror(state, '').pending, null)
})
