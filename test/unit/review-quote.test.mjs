/**
 * Diff line comments (ADR-0038): hunk parsing, the picking rules, the quote
 * text and its numbering. The quote shape mirrors the platform's
 * local-changes review tab heading for heading, so these assertions pin the
 * exact text an agent receives.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseReviewHunks, reviewHunkIndex, pickReviewLine, reviewRangeHas, reviewSnippet, reviewRangeLabel,
  formatReviewQuote, nextReviewIndex, reviewQuoteSummary, reviewSnippetCurrent,
} from '../../lib/testkit.mjs'

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,5 @@ export function a() {',
  ' line 1',
  '-old 2',
  '+new 2',
  '+new 3',
  ' line 4',
  ' line 5',
  '@@ -20,2 +21,3 @@',
  ' ctx 20',
  '+add 22',
  ' ctx 21',
  '\\ No newline at end of file',
].join('\n')

const hunks = parseReviewHunks(DIFF)

test('hunks come from the headers, bodies keep patch marks and the missing-newline line', () => {
  assert.equal(hunks.length, 2)
  assert.deepEqual(hunks.map((h) => [h.oldStart, h.oldLines, h.newStart, h.newLines]), [[1, 4, 1, 5], [20, 2, 21, 3]])
  assert.deepEqual(hunks[1].lines, [' ctx 20', '+add 22', ' ctx 21', '\\ No newline at end of file'])
})

test('a header without counts means one line', () => {
  const [hunk] = parseReviewHunks('@@ -3 +3 @@\n-a\n+b')
  assert.deepEqual([hunk.oldLines, hunk.newLines], [1, 1])
})

test('a binary or header-less diff has no hunks', () => {
  assert.deepEqual(parseReviewHunks('Binary files a/x.png and b/x.png differ'), [])
  assert.deepEqual(parseReviewHunks(''), [])
})

test('lines map to the hunk of their side', () => {
  assert.equal(reviewHunkIndex(hunks, 'R', 1), 0)
  assert.equal(reviewHunkIndex(hunks, 'R', 5), 0)
  assert.equal(reviewHunkIndex(hunks, 'R', 6), -1, 'past the first hunk')
  assert.equal(reviewHunkIndex(hunks, 'R', 23), 1)
  assert.equal(reviewHunkIndex(hunks, 'L', 21), 1)
  assert.equal(reviewHunkIndex(hunks, 'L', 22), -1)
})

test('Shift grows a range inside one hunk and one side', () => {
  const first = pickReviewLine(null, hunks, 'R', 3, false)
  assert.deepEqual(first, { side: 'R', anchor: 3, start: 3, end: 3 })
  const grown = pickReviewLine(first, hunks, 'R', 1, true)
  assert.deepEqual(grown, { side: 'R', anchor: 3, start: 1, end: 3 }, 'grows upward from the anchor')
  const regrown = pickReviewLine(grown, hunks, 'R', 5, true)
  assert.deepEqual(regrown, { side: 'R', anchor: 3, start: 3, end: 5 }, 'the anchor stays put')
})

test('a pick across hunks, sides or outside every hunk starts over at the clicked line', () => {
  const first = pickReviewLine(null, hunks, 'R', 3, false)
  assert.deepEqual(pickReviewLine(first, hunks, 'R', 22, true), { side: 'R', anchor: 22, start: 22, end: 22 })
  assert.deepEqual(pickReviewLine(first, hunks, 'L', 2, true), { side: 'L', anchor: 2, start: 2, end: 2 })
  const outside = pickReviewLine(null, hunks, 'R', 10, false)
  assert.deepEqual(pickReviewLine(outside, hunks, 'R', 11, true), { side: 'R', anchor: 11, start: 11, end: 11 })
  assert.deepEqual(pickReviewLine(first, hunks, 'R', 4, false), { side: 'R', anchor: 4, start: 4, end: 4 }, 'a plain click replaces')
})

test('range membership is per side', () => {
  const range = { side: 'R', anchor: 2, start: 2, end: 4 }
  assert.equal(reviewRangeHas(range, 'R', 3), true)
  assert.equal(reviewRangeHas(range, 'L', 3), false)
  assert.equal(reviewRangeHas(range, 'R', null), false)
  assert.equal(reviewRangeHas(null, 'R', 3), false)
})

test('a range quotes its lines with three context lines and a rebuilt header', () => {
  // A whole hunk is wider than the quote: a comment on line 4 of a 20-line
  // hunk drags three lines on each side, not the section the change rewrote.
  const wide = parseReviewHunks([
    '@@ -1,20 +1,20 @@',
    ...Array.from({ length: 20 }, (_, i) => ` line ${i + 1}`),
  ].join('\n'))
  const snippet = reviewSnippet(wide, { side: 'R', anchor: 10, start: 10, end: 10 }, () => undefined)
  assert.equal(snippet.kind, 'hunk')
  assert.equal(snippet.text.split('\n').length, 8, 'header + three lines + pick + three lines')
  assert.equal(snippet.text.split('\n')[0], '@@ -7,7 +7,7 @@')
  assert.match(snippet.text, /^@@ -7,7 \+7,7 @@\n line 7\n line 8\n line 9\n line 10\n line 11\n line 12\n line 13$/)

  // Neither edge of the hunk can overrun: a pick near its start keeps what exists.
  const head = reviewSnippet(wide, { side: 'R', anchor: 2, start: 2, end: 2 }, () => undefined)
  assert.equal(head.text.split('\n')[0], '@@ -1,5 +1,5 @@')

  // Deleted lines count on their own side, so a pick on new-side text keeps the
  // old side's numbers straight.
  const narrow = reviewSnippet(hunks, { side: 'R', anchor: 2, start: 2, end: 3 }, () => undefined)
  assert.equal(narrow.kind, 'hunk')
  assert.equal(narrow.text, ['@@ -1,4 +1,5 @@', ' line 1', '-old 2', '+new 2', '+new 3', ' line 4', ' line 5'].join('\n'))
})

test('a window of pure additions names the line it follows on the untouched side', () => {
  const adds = parseReviewHunks([
    '@@ -2,2 +2,9 @@',
    ' ctx a',
    '+x1',
    '+x2',
    '+x3',
    '+x4',
    '+x5',
    '+x6',
    '+x7',
    ' ctx b',
  ].join('\n'))
  // Seven additions in a row: the window holds no old-side line, so the old
  // side is written the way git writes it — the line the additions follow.
  const snippet = reviewSnippet(adds, { side: 'R', anchor: 6, start: 6, end: 6 }, () => undefined)
  const [header, ...body] = snippet.text.split('\n')
  assert.equal(header, '@@ -2,0 +3,7 @@')
  assert.equal(body.length, 7)
  assert.ok(body.every((line) => line.startsWith('+')), 'only the additions it picked around')
})

test('a range this hunk does not actually carry keeps the whole hunk', () => {
  // A header git would not print: old lines promised, none in the body.
  const broken = parseReviewHunks(['@@ -1,2 +1,3 @@', '+a', '+b', '+c'].join('\n'))
  assert.equal(reviewHunkIndex(broken, 'L', 1), 0, 'the header still claims old lines')
  const snippet = reviewSnippet(broken, { side: 'L', anchor: 1, start: 1, end: 1 }, () => undefined)
  assert.equal(snippet.text, ['@@ -1,2 +1,3 @@', '+a', '+b', '+c'].join('\n'))
})

test('revealed context quotes the picked line as code, and an unknown line quotes nothing', () => {
  const text = (side, line) => (side === 'R' && line === 10 ? 'const ten = 10' : undefined)
  assert.deepEqual(reviewSnippet(hunks, { side: 'R', anchor: 10, start: 10, end: 10 }, text), { kind: 'code', text: 'const ten = 10' })
  assert.equal(reviewSnippet(hunks, { side: 'R', anchor: 11, start: 11, end: 11 }, text), null)
})

test('range labels match the platform review tab', () => {
  assert.equal(reviewRangeLabel({ side: 'R', start: 12, end: 12 }), 'R12')
  assert.equal(reviewRangeLabel({ side: 'L', start: 3, end: 5 }), 'L3\u20135')
})

test('the quote carries repository, file, side, lines, source, hunk and comment', () => {
  const range = { side: 'R', anchor: 2, start: 2, end: 3 }
  const snippet = reviewSnippet(hunks, range, () => undefined)
  const text = formatReviewQuote({
    repository: '/work/repo', path: 'src/a.ts', range, source: { kind: 'local', scope: 'unstaged' }, snippet,
    body: '  Reuse the existing validator.  ',
  }, 3)
  assert.equal(text, [
    '## User Comment 3',
    'Repository: /work/repo',
    'File: src/a.ts',
    'Side: R',
    'Lines: 2-3',
    'Source: Local (unstaged)',
    'Diff hunk:',
    '```diff',
    snippet.text,
    '```',
    'Comment:',
    'Reuse the existing validator.',
  ].join('\n'))
})

test('commit and revision sources name what was compared', () => {
  const range = { side: 'L', anchor: 2, start: 2, end: 2 }
  const snippet = { kind: 'hunk', text: '@@ -2,1 +2,1 @@\n-a\n+b' }
  const commit = formatReviewQuote({ path: 'a', range, source: { kind: 'commit', hash: 'abc123' }, snippet, body: 'x' }, 1)
  assert.match(commit, /\nSource: Local \(commit\)\nCommit: abc123\n/)
  assert.doesNotMatch(commit, /Repository:/, 'no root, no line')
  const rev = formatReviewQuote({ path: 'a', range, source: { kind: 'rev', rev: 'v1.2.0' }, snippet, body: 'x' }, 1)
  assert.match(rev, /\nSource: Local \(working tree\)\nBase: v1\.2\.0\n/)
  assert.match(rev, /\nLines: 2\n/, 'a single line prints one number')
})

test('code outside every hunk is fenced as plain code, and the fence outgrows quoted backticks', () => {
  const range = { side: 'R', anchor: 9, start: 9, end: 9 }
  const text = formatReviewQuote({ path: 'a.md', range, source: { kind: 'local', scope: 'staged' }, snippet: { kind: 'code', text: 'see ```js' }, body: 'x' }, 1)
  assert.match(text, /\nCode:\n````\nsee ```js\n````\nComment:/)
})

test('numbering continues after the comments already in the draft, quoted or not', () => {
  assert.equal(nextReviewIndex(undefined), 1)
  assert.equal(nextReviewIndex(undefined, 2), 3, 'an unreadable draft numbers on from what this panel added')
  assert.equal(nextReviewIndex('## User Comment 4\n', 9), 5, 'a readable draft decides')
  assert.equal(nextReviewIndex(''), 1)
  assert.equal(nextReviewIndex('> ## User Comment 2\n> File: a\n\nmore\n> ## User Comment 7\n'), 8)
  assert.equal(nextReviewIndex('## User Comment 4\nFile: a'), 5)
  assert.equal(nextReviewIndex('text ## User Comment 9 inline'), 1, 'a heading only counts at a line start')
})

test('the composer chip shows the file name and range, titled by the path', () => {
  assert.deepEqual(reviewQuoteSummary('src/deep/a.ts', { side: 'R', anchor: 4, start: 4, end: 6 }, ' Check this '), {
    label: 'a.ts R4\u20136', title: 'src/deep/a.ts', detail: 'R4\u20136', body: 'Check this',
  })
})

test('a refreshed diff keeps a comment current only while its hunk reads the same', () => {
  const range = { side: 'R', anchor: 2, start: 2, end: 2 }
  const snippet = reviewSnippet(hunks, range, () => undefined)
  assert.equal(reviewSnippetCurrent(snippet, hunks, range, () => undefined), true)
  const changed = parseReviewHunks(DIFF.replace('+new 2', '+newer 2'))
  assert.equal(reviewSnippetCurrent(snippet, changed, range, () => undefined), false)
  assert.equal(reviewSnippetCurrent(snippet, [], range, () => undefined), false, 'the hunk is gone')
})

test('a side the whole hunk leaves empty keeps its own start in a window', () => {
  // A new file, a deleted file and a zero-context insertion: git already
  // writes that side's start as the line before, so the window must not
  // subtract one again.
  const added = parseReviewHunks(['@@ -0,0 +1,20 @@', ...Array.from({ length: 20 }, (_, i) => `+n${i + 1}`)].join('\n'))
  assert.equal(reviewSnippet(added, { side: 'R', anchor: 10, start: 10, end: 10 }, () => undefined).text.split('\n')[0], '@@ -0,0 +7,7 @@')
  assert.equal(reviewSnippet(added, { side: 'R', anchor: 1, start: 1, end: 1 }, () => undefined).text.split('\n')[0], '@@ -0,0 +1,4 @@')
  const deleted = parseReviewHunks(['@@ -1,20 +0,0 @@', ...Array.from({ length: 20 }, (_, i) => `-o${i + 1}`)].join('\n'))
  assert.equal(reviewSnippet(deleted, { side: 'L', anchor: 10, start: 10, end: 10 }, () => undefined).text.split('\n')[0], '@@ -7,7 +0,0 @@')
  const inserted = parseReviewHunks(['@@ -5,0 +6,12 @@', ...Array.from({ length: 12 }, (_, i) => `+x${i + 1}`)].join('\n'))
  assert.equal(reviewSnippet(inserted, { side: 'R', anchor: 12, start: 12, end: 12 }, () => undefined).text.split('\n')[0], '@@ -5,0 +9,7 @@')
})

test('expanded context keeps a comment current while the quoted window reads the same', () => {
  const small = parseReviewHunks(['@@ -1,3 +1,4 @@', ' a1', '+b2', ' c3', ' d4'].join('\n'))
  const range = { side: 'R', anchor: 2, start: 2, end: 2 }
  const snippet = reviewSnippet(small, range, () => undefined)
  assert.equal(snippet.text.split('\n')[0], '@@ -1,3 +1,4 @@', 'the whole small hunk, under git\'s header')
  const tail = Array.from({ length: 7 }, (_, i) => ` t${i + 5}`)
  const wide = parseReviewHunks(['@@ -1,10 +1,11 @@', ' a1', '+b2', ' c3', ' d4', ...tail].join('\n'))
  assert.equal(reviewSnippetCurrent(snippet, wide, range, () => undefined), true, 'a wider hunk still holds the window')
  const edited = parseReviewHunks(['@@ -1,10 +1,11 @@', ' a1', '+b2', ' c3-edited', ' d4', ...tail].join('\n'))
  assert.equal(reviewSnippetCurrent(snippet, edited, range, () => undefined), false, 'a quoted context line changed')
  const shifted = parseReviewHunks(['@@ -1,11 +1,12 @@', ' z0', ' a1', '+b2', ' c3', ' d4', ...tail].join('\n'))
  assert.equal(reviewSnippetCurrent(snippet, shifted, { ...range, anchor: 3, start: 3, end: 3 }, () => undefined), false, 'the same text at other numbers')

  // A rebuilt window survives the hunk growing around it, too.
  const long = parseReviewHunks(['@@ -1,20 +1,20 @@', ...Array.from({ length: 20 }, (_, i) => ` line ${i + 1}`)].join('\n'))
  const mid = { side: 'R', anchor: 10, start: 10, end: 10 }
  const frozen = reviewSnippet(long, mid, () => undefined)
  const longer = parseReviewHunks(['@@ -1,40 +1,40 @@', ...Array.from({ length: 40 }, (_, i) => ` line ${i + 1}`)].join('\n'))
  assert.equal(reviewSnippetCurrent(frozen, longer, mid, () => undefined), true)

  // Revealed context compares the picked lines wherever they are rendered now.
  const code = { kind: 'code', text: 'const ten = 10' }
  const at10 = { side: 'R', anchor: 10, start: 10, end: 10 }
  assert.equal(reviewSnippetCurrent(code, longer, at10, (side, line) => (side === 'R' && line === 10 ? 'const ten = 10' : undefined)), true)
  assert.equal(reviewSnippetCurrent(code, longer, at10, () => 'other'), false)
  assert.equal(reviewSnippetCurrent(code, longer, at10, () => undefined), false, 'no longer rendered')
})
