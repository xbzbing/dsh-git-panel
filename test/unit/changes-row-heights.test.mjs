/**
 * The change list's row heights are window-math inputs: ROW_H drives the
 * virtual offsets, and the stylesheet must pin every row kind to the box those
 * offsets assume. The pin is a selector list, so dropping one entry lets that
 * row grow to its content height while the window still spaces by the constant
 * — every assertion elsewhere stayed green while rows drifted (mutation:
 * delete `.gp-dir-row` from the pin → suite green, a 34px row in a 26px
 * window). This pins the text contract on both sides; the rendered geometry
 * (child fills its box, tops add up, content fits) is asserted in
 * test/e2e/changes-tree.mjs.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const clientDir = fileURLToPath(new URL('../../src/client/', import.meta.url))
const read = (name) => readFileSync(`${clientDir}${name}`, 'utf8')

test('the vrow height pin names every row kind the builder can emit', () => {
  const css = read('css/changes.ts')
  const rule = css.split('\n').find((line) => line.includes('.gp-changes__vrow>'))
  assert.ok(rule, 'the stylesheet pins .gp-changes__vrow children')
  for (const kind of ['.gp-file-row', '.gp-group-head', '.gp-dir-row']) {
    assert.ok(rule.includes(kind), `the height pin covers ${kind}`)
  }
  assert.ok(rule.includes('height:100%'), 'a pinned row follows its box, not its content')
})

test('the row model owns one height per kind and both consumers read it', () => {
  const model = read('changes-tree.ts')
  assert.match(
    model,
    /export const ROW_H[^=]*= \{ head: \d+, dir: \d+, file: \d+ \}/,
    'one table, one entry per row kind',
  )
  // The window math and the renderer must both come from that table: a
  // per-branch constant in the tab would let the two drift apart again.
  const tab = read('ChangesTab.tsx')
  assert.ok(
    tab.includes('buildTops(rows.map((row) => ROW_H[row.kind]))'),
    'the offsets are built from the shared table',
  )
  assert.ok(!/height: V(?:ROW|HEAD|DIR)_H/.test(tab), 'no per-row-kind height constant left in the tab')
  const rows = read('changes-rows.tsx')
  assert.ok(
    rows.includes('ROW_H[row.kind]'),
    'the renderer sizes its row boxes from the same table',
  )
})
