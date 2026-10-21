/**
 * The stylesheet's assembly, not its contents.
 *
 * The sheet is nine modules concatenated in a fixed order, and that order IS the
 * cascade: later modules deliberately override earlier ones. So dropping a
 * module from the array, reordering two of them, or changing the separator
 * silently changes which rule wins while every e2e runner stays green — geometry
 * assertions only cover the rules they happen to measure.
 *
 * This test pins the three things a refactor can break without any visual test
 * noticing: the parts exist, they are joined in the declared order, and the
 * assembly is exactly that join (nothing appended or dropped around them). It
 * deliberately does not hash the sheet — a golden hash would fail on every
 * legitimate rule edit and be updated mechanically, which trains the guard away.
 * Content regressions are covered by the e2e geometry assertions instead
 * (`changes-diff-modal` for the diff card, `sidebar-tab` for the stacked
 * divider, `stacked-detail-sticky` for the pinned summary).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CSS_PARTS, STYLESHEET } from '../../lib/testkit.mjs'

/** Cascade order: base first, layout overrides last. */
const ORDER = ['base', 'overview', 'changes', 'diff', 'modal', 'actions', 'config', 'layout', 'stacked']

test('the sheet is exactly the declared modules, in cascade order', () => {
  assert.deepEqual(CSS_PARTS.map(([name]) => name), ORDER)
})

test('every module carries rules and its own section boundary', () => {
  for (const [name, part] of CSS_PARTS) {
    assert.ok(part.trim().length > 0, `${name} must not be empty`)
    // Each module's literal starts and ends with a newline, which is what keeps
    // one blank line between sections after a plain join.
    assert.ok(part.startsWith('\n'), `${name} must start with a newline`)
    assert.ok(part.endsWith('\n'), `${name} must end with a newline`)
    assert.ok(ntrim(part).length === part.length - 2, `${name} must carry exactly one leading and one trailing newline`)
  }
})

test('the assembled sheet is the join of the parts, nothing around them', () => {
  assert.equal(STYLESHEET, CSS_PARTS.map(([, part]) => part).join(''))
  assert.ok(STYLESHEET.startsWith(CSS_PARTS[0][1]), 'the sheet starts with the first module')
  assert.ok(STYLESHEET.endsWith(CSS_PARTS[CSS_PARTS.length - 1][1]), 'and ends with the last one')
})

test('the module boundaries are the declared ones, with no overlap or gap', () => {
  // Walk the sheet: each module must start exactly where the previous ended.
  let at = 0
  for (const [name, part] of CSS_PARTS) {
    assert.equal(STYLESHEET.slice(at, at + part.length), part, `${name} must sit at offset ${at}`)
    at += part.length
  }
  assert.equal(at, STYLESHEET.length, 'the parts must cover the whole sheet')
})

test('a module cannot silently swallow another (each part appears once)', () => {
  for (const [name, part] of CSS_PARTS) {
    const needle = part.trim()
    const first = STYLESHEET.indexOf(needle)
    assert.ok(first >= 0, `${name}'s body must be in the sheet`)
    assert.equal(STYLESHEET.indexOf(needle, first + 1), -1, `${name}'s body must appear exactly once`)
  }
})

/** `part` with one leading and one trailing newline removed. */
function ntrim(part) {
  return part.slice(1, -1)
}
