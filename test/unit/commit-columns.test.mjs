/**
 * Column set of the wide commit row.
 *
 * Invariants: no tier overflows the measured width (the graph and subject tracks
 * are shrinkable), the row sheds the author before the hash, and the date track
 * closes every tier. The constants are checked against the CSS they mirror — a
 * drift makes every threshold wrong at once and nothing else would notice.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMMIT_AUTHOR_W, COMMIT_GAP, COMMIT_HASH_W, COMMIT_ROW_PAD, COMMIT_SUBJECT_COMFORT, CSS_PARTS,
  commitColumns,
} from '../../lib/testkit.mjs'

const GRAPH = 14
const TIME = 58
const five = GRAPH + COMMIT_SUBJECT_COMFORT + COMMIT_HASH_W + COMMIT_AUTHOR_W + TIME + 4 * COMMIT_GAP + COMMIT_ROW_PAD
const four = GRAPH + COMMIT_SUBJECT_COMFORT + COMMIT_HASH_W + TIME + 3 * COMMIT_GAP + COMMIT_ROW_PAD
/** Width the tracks claim when nothing shrinks. */
const claimed = (template) => template.split(' ').reduce((sum, part) => sum + (Number.parseFloat(part) || 0), 0)
  + (template.split(' ').length - 1) * COMMIT_GAP + COMMIT_ROW_PAD
const trackCount = (template) => template.split(' ').length

test('a wide enough list keeps all five columns', () => {
  const full = commitColumns(five, GRAPH, TIME)
  assert.deepEqual({ showHash: full.showHash, showAuthor: full.showAuthor }, { showHash: true, showAuthor: true })
  assert.equal(trackCount(full.template), 5)
  assert.equal(commitColumns(2000, GRAPH, TIME).showAuthor, true, 'a wide list is not degraded')
})

test('the author goes first, then the hash — the date never', () => {
  const mid = commitColumns(four, GRAPH, TIME)
  assert.deepEqual({ showHash: mid.showHash, showAuthor: mid.showAuthor }, { showHash: true, showAuthor: false })
  assert.equal(trackCount(mid.template), 4)

  const narrow = commitColumns(four - 1, GRAPH, TIME)
  assert.deepEqual({ showHash: narrow.showHash, showAuthor: narrow.showAuthor }, { showHash: false, showAuthor: false })
  assert.equal(trackCount(narrow.template), 3)
  assert.match(narrow.template, new RegExp(`${TIME}px$`), 'the date track closes every tier')
})

test('every tier fits the width that chose it, and its fixed tracks can give way', () => {
  // The bug was an overflowing grid: the date column ended up past the row's
  // right edge, outside the selection fill. Every tier must therefore (a) be
  // chosen only above its comfort width and (b) consist of shrinkable tracks, so
  // rounding or a wider graph cannot push the row out.
  // 150 is the CSS floor of the history column (`.gp-col--mid{min-width:150px}`),
  // tested against below.
  for (const available of [five, four, 460, 300, 240, 200, 150]) {
    const columns = commitColumns(available, GRAPH, TIME)
    assert.match(columns.template, /minmax\(0,1fr\)/, `${available}: the subject absorbs the remainder`)
    // `claimed` sums only the tracks that cannot shrink (the graph and the
    // subject parse as 0): that floor is the widest the row can be at its most
    // compressed, and it must still fit.
    assert.ok(claimed(columns.template) <= Math.max(available, COMMIT_ROW_PAD),
      `${available}: template ${columns.template} floors at ${claimed(columns.template)}`)
    if (columns.showAuthor) assert.ok(available >= five, `${available}: five columns only above their comfort width`)
    else if (columns.showHash) assert.ok(available >= four, `${available}: four columns only above their comfort width`)
  }
})

test('the graph track shrinks instead of pushing the date out', () => {
  // A repo whose first page keeps a dozen lanes open wants more room than the
  // column has; a fixed graph track used to overflow the row (and clipped the
  // date once the list stopped scrolling sideways).
  const wideGraph = 12 * GRAPH
  const columns = commitColumns(150, wideGraph, TIME)
  assert.match(columns.template, new RegExp(`minmax\\(0,${wideGraph}px\\)`), columns.template)
})

test('the row floor fits the narrowest history column the layout allows', () => {
  // The date and the hash cannot shrink below their tracks, so the compressed
  // row bottoms out at date + gaps + padding. That floor must still fit the
  // column's own minimum, or the narrowest legal panel would clip the date.
  const overview = CSS_PARTS.find(([name]) => name === 'overview')
  const mid = /\.gp-col--mid\{([^}]*)\}/.exec(overview[1])
  assert.ok(mid !== null, 'the history column still declares its floor')
  const floor = Number(/\.gp-col--mid\{[^}]*min-width:(\d+)px/.exec(overview[1])?.[1])
  assert.ok(floor > 0, 'min-width is a pixel value')
  assert.ok(claimed(commitColumns(floor, GRAPH, TIME).template) <= floor,
    `the three-column floor is ${claimed(commitColumns(floor, GRAPH, TIME).template)} in a ${floor}px column`)
  // A wide graph is what would break it: it must still fit at the floor.
  assert.ok(claimed(commitColumns(floor, 12 * GRAPH, TIME).template) <= floor, 'a twelve-lane graph fits the floor too')
})

test('an unmeasured list keeps the full set', () => {
  for (const available of [0, Number.NaN, -5]) {
    const columns = commitColumns(available, GRAPH, TIME)
    assert.equal(columns.showAuthor, true)
    assert.equal(trackCount(columns.template), 5)
  }
})

test('the track count matches the flags', () => {
  // Hand-editing a template without its flags would leave a track with no cell
  // (or a cell with no track), which the row renders as an empty column.
  for (const available of [2000, five, four, 300, 150, 0]) {
    const columns = commitColumns(available, GRAPH, TIME)
    assert.equal(trackCount(columns.template), 3 + Number(columns.showHash) + Number(columns.showAuthor), `${available}: ${columns.template}`)
  }
})

test('the constants match the row rule they mirror', () => {
  const overview = CSS_PARTS.find(([name]) => name === 'overview')
  assert.ok(overview !== undefined)
  // Anchor on the standalone rule: `.gp-history__vrow>.gp-commit-row` comes first
  // and carries neither the gap nor the table's padding.
  const row = /(?:^|\n)\.gp-commit-row\{([^}]*)\}/.exec(overview[1])
  assert.ok(row !== null, '.gp-commit-row is still declared')
  const gap = /gap:(\d+)px/.exec(row[1])
  const padding = /padding:0 (\d+)px/.exec(row[1])
  assert.ok(gap !== null && padding !== null, 'the row still sets its gap and horizontal padding')
  assert.equal(Number(gap[1]), COMMIT_GAP)
  assert.equal(Number(padding[1]) * 2, COMMIT_ROW_PAD)
})
