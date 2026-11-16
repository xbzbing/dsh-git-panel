/**
 * markdown-toc: the numbers behind the reader's floating outline. The rows are
 * read off the rendered document, so what is pinned here is everything that
 * happens to them afterwards — label cleanup, indentation depth, which row is
 * current at a scroll position, and where a row's heading is scrolled to.
 *
 * The cap and the heading-less document are the two cases the DOM cannot tell
 * us about: a document with one heading has no outline worth drawing, and a
 * document with thousands has one worth truncating.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeHeadingText, tocIndent, tocEntries, activeTocIndex, tocScrollTarget,
  TOC_MAX_ENTRIES, TOC_MAX_DEPTH, TOC_ACTIVE_SLACK,
} from '../../lib/testkit.mjs'

const row = (level, text, top) => ({ level, text, top })

test('heading labels collapse whitespace and drop a trailing hash run', () => {
  assert.equal(normalizeHeadingText('  Install\n  the  thing  '), 'Install the thing')
  assert.equal(normalizeHeadingText('Release notes ##'), 'Release notes')
  assert.equal(normalizeHeadingText('C#'), 'C#')
  assert.equal(normalizeHeadingText('C#  '), 'C#')
  assert.equal(normalizeHeadingText('#'), '')
})

test('indent follows the heading depth and stops at the deepest drawn one', () => {
  assert.equal(tocIndent(1), 0)
  assert.equal(tocIndent(2), 1)
  assert.equal(tocIndent(TOC_MAX_DEPTH), TOC_MAX_DEPTH - 1)
  assert.equal(tocIndent(6), TOC_MAX_DEPTH - 1, 'h5/h6 share h4 depth instead of walking off the card')
  assert.equal(tocIndent(0), 0, 'a level below h1 clamps rather than drawing a negative inset')
  assert.equal(tocIndent(Number.NaN), 0)
})

test('label-less headings are dropped and labels are normalized in place', () => {
  const entries = tocEntries([row(1, 'Intro', 0), row(2, '   ', 40), row(2, 'Usage  ##', 120)])
  assert.deepEqual(entries, [row(1, 'Intro', 0), row(2, 'Usage', 120)])
})

test('a negative or unmeasured offset reads as the top of the document', () => {
  assert.deepEqual(tocEntries([row(1, 'A', -20), row(1, 'B', Number.NaN)]), [row(1, 'A', 0), row(1, 'B', 0)])
})

test('the outline is truncated, keeping the first entries in document order', () => {
  const many = Array.from({ length: TOC_MAX_ENTRIES + 25 }, (_, i) => row(2, `Section ${i}`, i * 40))
  const entries = tocEntries(many)
  assert.equal(entries.length, TOC_MAX_ENTRIES)
  assert.equal(entries[0].text, 'Section 0')
  assert.equal(entries.at(-1).text, `Section ${TOC_MAX_ENTRIES - 1}`)
})

test('the very top of the document marks the first heading', () => {
  // The overview opens with something marked: at scrollTop 0 the reader is at
  // the document's beginning, which the first heading anchors.
  assert.equal(activeTocIndex([120, 300, 640], 0), 0)
  assert.equal(activeTocIndex([120, 300, 640], -3), 0, 'a rubber-band overscroll still reads as the top')
})

test('a long preamble marks nothing until the first heading is reached', () => {
  const tops = [300, 640]
  assert.equal(activeTocIndex(tops, 100), -1, 'scrolled into the preamble, no section is current yet')
  // The reading line is scrollTop + slack, so a heading becomes current once it
  // is that close to the top edge, not only when it touches it.
  assert.equal(activeTocIndex(tops, 300 - TOC_ACTIVE_SLACK), 0)
  assert.equal(activeTocIndex(tops, 300 - TOC_ACTIVE_SLACK - 1), -1)
})

test('the current row is the last heading that passed the reading line', () => {
  const tops = [0, 120, 300, 640]
  assert.equal(activeTocIndex(tops, 0), 0)
  assert.equal(activeTocIndex(tops, 130), 1)
  // A heading becomes current while it is still a slack-width below the top
  // edge; one pixel earlier the previous section still is.
  assert.equal(activeTocIndex(tops, 300 - TOC_ACTIVE_SLACK), 2)
  assert.equal(activeTocIndex(tops, 300 - TOC_ACTIVE_SLACK - 1), 1)
  assert.equal(activeTocIndex(tops, 10_000), 3, 'past the end the final heading stays current')
  assert.equal(activeTocIndex([], 400), -1, 'an empty outline has no current row')
})

test('a document shorter than the viewport is at the top, not at the end', () => {
  // maxScrollTop 0 means the box cannot scroll at all: it is at both ends at
  // once, and the top rule has to win — otherwise a short document opens with
  // its LAST section marked current. Real renderers commonly zero the first
  // heading's margin, which is what puts this on the opening screen.
  assert.equal(activeTocIndex([16, 88, 153], 0, TOC_ACTIVE_SLACK, 0), 0)
  assert.equal(activeTocIndex([16, 60], 0, TOC_ACTIVE_SLACK, 0), 0)
  // A one-pixel scroll (rubber band) still reads as the top of that box.
  assert.equal(activeTocIndex([16, 88, 153], -2, TOC_ACTIVE_SLACK, 0), 0)
})

test('the bottom of the box marks the last heading', () => {
  const tops = [0, 120, 300, 640]
  // Scrolled to the maximum the box can reach, the last heading is on screen
  // but its top is below the reading line: the outline still has to point at
  // it, or it would stop a section short of where the reader is.
  assert.equal(activeTocIndex(tops, 800, TOC_ACTIVE_SLACK, 800), 3)
  assert.equal(activeTocIndex(tops, 799, TOC_ACTIVE_SLACK, 800), 3, 'one pixel short still counts as the end')
  assert.equal(activeTocIndex(tops, 600, TOC_ACTIVE_SLACK, 800), 2, 'short of the end the reading line decides')
  assert.equal(activeTocIndex(tops, 50, TOC_ACTIVE_SLACK, Number.POSITIVE_INFINITY), 0, 'no maximum means no bottom pin')
  assert.equal(activeTocIndex([], 0, TOC_ACTIVE_SLACK, 0), -1, 'an empty outline marks nothing at either end')
})

test('an unmeasured scroll position claims no section', () => {
  const tops = [0, 120]
  assert.equal(activeTocIndex(tops, Number.NaN), -1)
  assert.equal(activeTocIndex(tops, -Infinity), -1)
})

test('a row scrolls to its heading, clamped to what the box can actually scroll', () => {
  const tops = [0, 120, 980]
  assert.equal(tocScrollTarget(tops, 1, 400), 112, 'the heading lands at the top, minus its margin')
  assert.equal(tocScrollTarget(tops, 2, 400), 400, 'a heading near the end clamps to the scroll maximum')
  assert.equal(tocScrollTarget(tops, 0, 400), 0, 'the first heading cannot scroll above the top')
  assert.equal(tocScrollTarget(tops, 99, 400), 0, 'an index the outline does not have is a no-op')
  assert.equal(tocScrollTarget(tops, 2, Number.NaN), 0)
})
