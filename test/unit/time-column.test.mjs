/**
 * Relative-time column: the labels a locale can print and the width policy that
 * fits them.
 *
 * The column used to be a fixed 96px track. These cases pin the two halves of
 * making it locale-aware: the samples must be the widest text each unit can
 * produce (otherwise a long-lived repo or an old commit clips), and the fit
 * must clamp so neither a short nor an extreme locale breaks the grid.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CSS_PARTS, DICTIONARIES, TIME_COLUMN_MAX, TIME_COLUMN_MIN, TIME_FONT_PX,
  fitTimeColumnWidth, timeColumnLabels,
} from '../../lib/testkit.mjs'

/** The dictionaries are flat key → text; substitute `{n}` like the panel does. */
function translate(dict) {
  return (key, params) => {
    const text = dict[key]
    if (text === undefined) throw new Error(`missing dictionary key: ${key}`)
    return params === undefined ? text : text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
}

test('every locale samples all four units with their widest counts', () => {
  for (const [id, dict] of Object.entries(DICTIONARIES)) {
    const labels = timeColumnLabels(translate(dict))
    assert.equal(labels.length, 4, `${id}: one label per unit (just now / minutes / hours / days)`)
    for (const label of labels) assert.ok(label.trim() !== '' && !label.startsWith('time.'), `${id}: resolved text, not a key`)
    // The numbers are the output of `timeAgo`'s own range: 59 minutes, 23 hours
    // and four-digit days. If a unit stops being sampled, its label loses the
    // number and the column is fitted to a shorter string than it can print.
    assert.match(labels[1], /59/, `${id}: minutes sample uses the 2-digit maximum`)
    assert.match(labels[2], /23/, `${id}: hours sample uses the 2-digit maximum`)
    assert.match(labels[3], /9999/, `${id}: days sample covers four digits`)
  }
})

test('the widest label decides the track, rounded up', () => {
  const measure = (text) => text.length * 10
  assert.equal(fitTimeColumnWidth(['abcde', 'abcdefgh'], measure), 84, '80px label + 4px slack')
  assert.equal(fitTimeColumnWidth(['abc'], measure), TIME_COLUMN_MIN, 'a short locale floors instead of collapsing')
  assert.equal(fitTimeColumnWidth(['a'.repeat(10)], measure), TIME_COLUMN_MAX, 'an extreme locale caps instead of squeezing the subject')
  assert.equal(fitTimeColumnWidth(['abcde'], () => 53.31), 54 + 4, 'fractional text width is rounded up before the slack')
})

test('no usable measurement keeps the previous fixed width', () => {
  // No canvas, or every label empty: a zero-width grid track would draw the
  // date over the author, which is worse than the old fixed column.
  assert.equal(fitTimeColumnWidth([], () => 10), TIME_COLUMN_MAX)
  assert.equal(fitTimeColumnWidth(['', ''], () => 0), TIME_COLUMN_MAX)
  assert.equal(fitTimeColumnWidth(['', ''], () => Number.NaN), TIME_COLUMN_MAX)
})

test('the floor never exceeds the ceiling', () => {
  assert.ok(TIME_COLUMN_MIN > 0)
  assert.ok(TIME_COLUMN_MIN < TIME_COLUMN_MAX)
})

test('the measured font size matches the date cell rule', () => {
  // The canvas is told `TIME_FONT_PX px`, while the cell's size comes from CSS.
  // Changing one without the other silently mis-fits every label, and neither
  // the type system nor the browser notices.
  const overview = CSS_PARTS.find(([name]) => name === 'overview')
  assert.ok(overview !== undefined, 'the overview module is part of the cascade')
  const rule = /\.gp-commit-date\{[^}]*font-size:(\d+)px/.exec(overview[1])
  assert.ok(rule !== null, '.gp-commit-date still declares its own font size')
  assert.equal(Number(rule[1]), TIME_FONT_PX)
})
