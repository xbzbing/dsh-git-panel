/**
 * The `dbGitPanel` dictionaries: every locale DSH ships carries the full key set
 * of the zh source (the base dictionary the other seven translate from, per
 * AGENTS.md), with the same `{placeholders}` and no empty text. The platform
 * falls back to English per key, so a gap would not show a raw key — but it
 * would silently mix languages, which only this test catches.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DICTIONARIES } from '../../lib/testkit.mjs'

const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(',')

test('the namespace registers every language DSH ships', () => {
  assert.deepEqual(Object.keys(DICTIONARIES), ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])
})

test('every dictionary carries exactly the Chinese key set', () => {
  const keys = Object.keys(DICTIONARIES.zh)
  for (const [id, dict] of Object.entries(DICTIONARIES)) {
    assert.deepEqual(Object.keys(dict).filter((k) => !(k in DICTIONARIES.zh)), [], `${id}: no extra keys`)
    assert.deepEqual(keys.filter((k) => !(k in dict)), [], `${id}: no missing keys`)
  }
})

test('every translation keeps the placeholders and says something', () => {
  for (const [id, dict] of Object.entries(DICTIONARIES)) {
    for (const [key, source] of Object.entries(DICTIONARIES.zh)) {
      assert.equal(placeholders(dict[key]), placeholders(source), `${id} ${key}: placeholders`)
      if (source !== '') assert.notEqual(dict[key].trim(), '', `${id} ${key}: empty text`)
    }
  }
})
