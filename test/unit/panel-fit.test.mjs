/**
 * isCramped: the combined width+height gate for height-saving UI, and
 * panelMode: which of the three pane arrangements the box gets.
 *
 * The panel trades content away (the commit editor folds, the change timestamps
 * are dropped) only when both axes are scarce. Width alone decides the layout
 * mode; height alone never triggers anything. These cases pin that separation —
 * a squeezed desktop column and a large phone must keep the full UI, which is
 * the whole point of judging both dimensions together.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isCramped, panelMode, COMPACT_BP, SHORT_BP, SIDEBAR_WIDE_BP, STACKED_TIGHT_BP } from '../../lib/testkit.mjs'

const layout = (compact, short, width = 900) => ({ compact, short, width })

test('cramped only when the panel is narrow and short at the same time', () => {
  assert.equal(isCramped(layout(true, true)), true)
  assert.equal(isCramped(layout(true, false)), false, 'narrow but tall keeps the full UI')
  assert.equal(isCramped(layout(false, true)), false, 'short but wide keeps the full UI')
  assert.equal(isCramped(layout(false, false)), false)
})

test('a desktop column squeezed by a sidebar is narrow yet tall: not cramped', () => {
  // 400px wide (compact) in a 900px-tall panel: the case this rule exists for.
  assert.equal(isCramped(layout(400 <= COMPACT_BP, 900 <= SHORT_BP)), false)
})

test('a landscape phone window is narrow and short: cramped', () => {
  // 390px wide, 420px tall panel: genuinely no room, so the fold is correct.
  assert.equal(isCramped(layout(390 <= COMPACT_BP, 420 <= SHORT_BP)), true)
})

test('a portrait phone panel is narrow but tall enough to keep the editor', () => {
  // 390x690 panel: the change list can afford the editor and the timestamps.
  assert.equal(isCramped(layout(390 <= COMPACT_BP, 690 <= SHORT_BP)), false)
})

test('a wide desktop panel is never cramped, however short', () => {
  assert.equal(isCramped(layout(1200 <= COMPACT_BP, 300 <= SHORT_BP)), false, 'the wide layout has its own structure')
})

test('the breakpoints keep the documented relationship', () => {
  // Both are container measures and both are positive; the exact values are a
  // product decision, so only their ordering contract is pinned here.
  assert.ok(COMPACT_BP > 0 && SHORT_BP > 0)
  assert.equal(COMPACT_BP, 620)
  assert.equal(SHORT_BP, 520)
  assert.equal(SIDEBAR_WIDE_BP, 760)
  assert.ok(SIDEBAR_WIDE_BP > COMPACT_BP, 'the stacked→wide flip sits above the compact bar')
  assert.equal(STACKED_TIGHT_BP, 380)
  assert.ok(STACKED_TIGHT_BP < 420, 'the default sidebar width keeps the full tab bar')
  assert.ok(STACKED_TIGHT_BP > 320, 'a minimum-width (~320px) sidebar lands inside the tight mode')
})

test('panelMode: wide whenever the conversation panel has width', () => {
  assert.equal(panelMode(layout(false, false, 900), 'conversation'), 'wide')
  assert.equal(panelMode(layout(false, true, 900), 'conversation'), 'wide')
  assert.equal(panelMode(layout(false, false, 700), 'conversation'), 'wide', 'the sidebar threshold does not apply to conversations')
  assert.equal(panelMode(layout(true, false, 400), 'conversation'), 'compact')
  assert.equal(panelMode(layout(true, true, 400), 'conversation'), 'compact')
})

test('panelMode: a tall narrow sidebar stacks instead of drilling', () => {
  assert.equal(panelMode(layout(true, false, 420), 'sidebar'), 'stacked')
})

test('panelMode: narrow and short sidebar falls back to drill-in', () => {
  assert.equal(panelMode(layout(true, true, 420), 'sidebar'), 'compact')
})

test('panelMode: a sidebar stays stacked until it clears SIDEBAR_WIDE_BP', () => {
  // The three-column layout only becomes comfortable above the raised bar;
  // at COMPACT_BP..SIDEBAR_WIDE_BP a sidebar keeps the stacked arrangement.
  assert.equal(panelMode(layout(false, false, 700), 'sidebar'), 'stacked')
  assert.equal(panelMode(layout(false, false, SIDEBAR_WIDE_BP), 'sidebar'), 'stacked', 'the threshold is exclusive')
  assert.equal(panelMode(layout(false, false, SIDEBAR_WIDE_BP + 1), 'sidebar'), 'wide')
  assert.equal(panelMode(layout(false, true, 900), 'sidebar'), 'wide', 'width, not height, decides above the bar')
})

test('panelMode: an unmeasured sidebar starts stacked, never flashes wide', () => {
  // width 0 = the first render before useLayoutEffect measures: the
  // three-column layout must not paint for a frame.
  assert.equal(panelMode(layout(false, false, 0), 'sidebar'), 'stacked')
})

test('panelMode: the drill-in→stacked flip sits exactly at COMPACT_BP, and only height can still take it back', () => {
  // The caller derives `compact` from the measured width, so spell that out:
  // the boundary cases are the ones a refactor would get wrong.
  const at = (width, short) => panelMode({ width, compact: width <= COMPACT_BP, short }, 'sidebar')
  assert.equal(at(COMPACT_BP - 1, false), 'stacked', '619px, tall: merely narrow stacks')
  assert.equal(at(COMPACT_BP - 1, true), 'compact', '619px and short: both axes scarce → drill in')
  assert.equal(at(COMPACT_BP, false), 'stacked', '620px is still outside the wide bar')
  assert.equal(at(COMPACT_BP, true), 'compact', '620px and short: the compact bar is inclusive')
  assert.equal(at(COMPACT_BP + 1, false), 'stacked', '621px: past the bar but under 760 → stacked')
  assert.equal(at(COMPACT_BP + 1, true), 'stacked', '621px and short still stacks — the two-band split absorbs a short window')
})

test('panelMode: 621–760 stacks for every height, short included', () => {
  const at = (width, short) => panelMode({ width, compact: width <= COMPACT_BP, short }, 'sidebar')
  for (const width of [COMPACT_BP + 1, 690, SIDEBAR_WIDE_BP - 1]) {
    assert.equal(at(width, false), 'stacked', `${width}px tall stays stacked`)
    assert.equal(at(width, true), 'stacked', `${width}px short stays stacked too — height never flips this band`)
  }
  assert.equal(at(SIDEBAR_WIDE_BP, true), 'stacked', '760px itself is still stacked — the bar is exclusive')
  assert.equal(at(SIDEBAR_WIDE_BP + 1, true), 'wide', 'above the bar width alone decides, height is moot')
})
