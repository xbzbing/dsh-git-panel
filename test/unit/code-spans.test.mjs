import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitHighlightSpans } from '../../lib/testkit.mjs'

test('word emphasis splits syntax tokens at both boundaries without losing text or style', () => {
  const blue = { color: 'var(--shiki-blue)' }
  const red = { color: 'var(--shiki-red)' }
  const result = splitHighlightSpans([
    { text: 'const', style: blue }, { text: ' user', style: red }, { text: 'Name', style: blue },
  ], [7, 12])
  assert.deepEqual(result.map((part) => part.map((s) => s.text).join('')), ['const u', 'serNa', 'me'])
  assert.deepEqual(result[1].map((s) => s.style), [red, blue])
})

test('word emphasis uses UTF-16 offsets and leaves untrusted text intact', () => {
  const source = '😀<script>alert(1)</script>'
  const spans = [{ text: '😀<script>', style: { color: 'red' } }, { text: 'alert(1)</script>', style: { color: 'blue' } }]
  const sections = splitHighlightSpans(spans, [2, 10])
  assert.equal(sections.flat().map((span) => span.text).join(''), source)
  assert.deepEqual(sections.map((part) => part.map((span) => span.text).join('')), ['😀', '<script>', 'alert(1)</script>'])
})

test('word emphasis handles zero-width ranges and full-line changes', () => {
  const spans = [{ text: 'abc', style: { color: 'blue' } }]
  assert.deepEqual(splitHighlightSpans(spans, [1, 1]).map((part) => part.map((s) => s.text).join('')), ['a', '', 'bc'])
  assert.deepEqual(splitHighlightSpans(spans, [0, 3]).map((part) => part.map((s) => s.text).join('')), ['', 'abc', ''])
})
