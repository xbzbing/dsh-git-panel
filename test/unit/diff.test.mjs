/**
 * Diff tests: unified-diff → side-by-side rows, summary, and file-kind guards.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSideBySide, summarize, isBinaryDiff, isAddOnlyDiff, isDeleteOnlyDiff, extractAddedContent, extractDeletedContent, isImagePath, intraLineDiff, spliceGap, contextRowsFromLines, GAP_STEP } from '../../lib/testkit.mjs'

const MODIFY = `diff --git a/a.txt b/a.txt
index a29bdeb..c0d0fb4 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,2 @@
 line1
-old
+new
`

const NEWFILE = `diff --git a/d.txt b/d.txt
new file mode 100644
index 0000000..5a72eb2
--- /dev/null
+++ b/d.txt
@@ -0,0 +1,2 @@
+alpha
+beta
`

const DELFILE = `diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 5a72eb2..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-alpha
-beta
`

const BINARY = `diff --git a/img.png b/img.png
Binary files a/img.png and b/img.png differ
`

test('summarize counts additions and deletions', () => {
  assert.deepEqual(summarize(MODIFY), { add: 1, del: 1 })
  assert.deepEqual(summarize(NEWFILE), { add: 2, del: 0 })
  assert.deepEqual(summarize(DELFILE), { add: 0, del: 2 })
})

test('buildSideBySide pairs a deletion with the following addition', () => {
  const rows = buildSideBySide(MODIFY)
  const hunk = rows.find((r) => r.kind === 'hunk')
  assert.ok(hunk, 'a hunk header row is present')
  // context line1 present on both sides
  const ctx = rows.find((r) => r.leftText === 'line1' && r.rightText === 'line1')
  assert.ok(ctx)
  // old→new paired into one modification row (left old, right new)
  const paired = rows.find((r) => r.leftText === 'old' && r.rightText === 'new')
  assert.ok(paired, 'deletion and addition align on one row')
  assert.equal(paired.kind, 'mod', 'a both-sided pair is a modification row')
})

test('intraLineDiff isolates the changed middle after common prefix/suffix', () => {
  // "DateTime" → "DateTimeZone": shared prefix, appended suffix.
  const a = intraLineDiff('import org.joda.time.DateTime;', 'import org.joda.time.DateTimeZone;')
  assert.ok(a)
  assert.equal('import org.joda.time.DateTime;'.slice(a.left[0], a.left[1]), '')
  assert.equal('import org.joda.time.DateTimeZone;'.slice(a.right[0], a.right[1]), 'Zone')
  // Mid-token change.
  const b = intraLineDiff('const x = 1', 'const x = 2')
  assert.deepEqual([b.left, b.right], [[10, 11], [10, 11]])
  // Whole line differs → no useful word range.
  assert.equal(intraLineDiff('abc', 'xyz'), null)
  // Identical → empty middle both sides.
  const c = intraLineDiff('same', 'same')
  assert.deepEqual([c.left, c.right], [[4, 4], [4, 4]])
})

test('modification rows carry word-level change ranges', () => {
  const rows = buildSideBySide(MODIFY)
  const mod = rows.find((r) => r.kind === 'mod')
  assert.ok(mod)
  // "old" vs "new": no shared prefix/suffix → whole line, so no word range.
  assert.equal(mod.leftWord, undefined)
})

const GAPPED = `diff --git a/f.txt b/f.txt
index 1111111..2222222 100644
--- a/f.txt
+++ b/f.txt
@@ -30,3 +30,3 @@
 ctx30
-old31
+new31
 ctx32
`

test('buildSideBySide emits a leading gap for hidden lines above the first hunk', () => {
  const rows = buildSideBySide(GAPPED)
  const lead = rows.find((r) => r.kind === 'gap' && r.gap.atStart)
  assert.ok(lead, 'leading gap present')
  assert.equal(lead.gap.rightStart, 1)
  assert.equal(lead.gap.count, 29, 'lines 1..29 hidden above hunk starting at 30')
  const trail = rows.find((r) => r.kind === 'gap' && r.gap.atEnd)
  assert.ok(trail, 'trailing gap present (unknown count)')
  assert.equal(trail.gap.count, null)
})

test('contextRowsFromLines maps revealed new lines to both sides with delta', () => {
  // delta = oldLine - newLine; here old and new line up (delta 0).
  const rows = contextRowsFromLines(0, 5, ['e', 'f'])
  assert.deepEqual(rows.map((r) => [r.leftNo, r.rightNo, r.leftText]), [[5, 5, 'e'], [6, 6, 'f']])
})

test('spliceGap all replaces the gap with revealed context rows', () => {
  const rows = buildSideBySide(GAPPED)
  const lead = rows.find((r) => r.kind === 'gap' && r.gap.atStart)
  const revealed = Array.from({ length: 29 }, (_, i) => `line${i + 1}`)
  const out = spliceGap(rows, lead.gap.rightStart, 'all', 1, revealed, false)
  assert.ok(!out.some((r) => r.kind === 'gap' && r.gap.atStart), 'leading gap consumed')
  const first = out[0]
  assert.equal(first.kind, 'context')
  assert.equal(first.rightText, 'line1')
})

test('spliceGap down on a large gap keeps a smaller residual gap below', () => {
  // Fabricate a large leading gap by starting the hunk far down.
  const big = GAPPED.replace('@@ -30,3 +30,3 @@', '@@ -100,3 +100,3 @@').replace('ctx30', 'ctx100').replace('old31', 'old101').replace('new31', 'new101').replace('ctx32', 'ctx102')
  const rows = buildSideBySide(big)
  const lead = rows.find((r) => r.kind === 'gap' && r.gap.atStart)
  assert.equal(lead.gap.count, 99)
  const revealed = Array.from({ length: GAP_STEP }, (_, i) => `L${i + 1}`)
  const out = spliceGap(rows, lead.gap.rightStart, 'down', 1, revealed, false)
  const residual = out.find((r) => r.kind === 'gap' && !r.gap.atEnd)
  assert.ok(residual, 'a residual gap remains')
  assert.equal(residual.gap.count, 99 - GAP_STEP)
  assert.equal(residual.gap.rightStart, 1 + GAP_STEP)
})

test('spliceGap on a trailing gap keeps expanding until eof', () => {
  const rows = buildSideBySide(GAPPED)
  const trail = rows.find((r) => r.kind === 'gap' && r.gap.atEnd)
  const out1 = spliceGap(rows, trail.gap.rightStart, 'down', trail.gap.rightStart, ['t1', 't2'], false)
  assert.ok(out1.some((r) => r.kind === 'gap' && r.gap.atEnd), 'trailing gap persists when not eof')
  const out2 = spliceGap(out1, trail.gap.rightStart + 2, 'down', trail.gap.rightStart + 2, ['t3'], true)
  assert.ok(!out2.some((r) => r.kind === 'gap' && r.gap.atEnd), 'trailing gap gone at eof')
})

test('isAddOnlyDiff / isDeleteOnlyDiff / isBinaryDiff classify correctly', () => {
  assert.equal(isAddOnlyDiff(NEWFILE), true)
  assert.equal(isAddOnlyDiff(MODIFY), false)
  assert.equal(isDeleteOnlyDiff(DELFILE), true)
  assert.equal(isDeleteOnlyDiff(MODIFY), false)
  assert.equal(isBinaryDiff(BINARY), true)
  assert.equal(isBinaryDiff(MODIFY), false)
})

test('extract added / deleted content', () => {
  assert.equal(extractAddedContent(NEWFILE), 'alpha\nbeta')
  assert.equal(extractDeletedContent(DELFILE), 'alpha\nbeta')
})

test('isImagePath gates on the shared image extension list', () => {
  assert.equal(isImagePath('docs/a.PNG'), true, 'case-insensitive')
  assert.equal(isImagePath('dir/photo.jpeg'), true)
  assert.equal(isImagePath('icon.svg'), true)
  assert.equal(isImagePath('anim.tiff'), true)
  assert.equal(isImagePath('notes.txt'), false)
  assert.equal(isImagePath('no-extension'), false)
  assert.equal(isImagePath('archive.png.bak'), false, 'extension must be the suffix')
  assert.equal(isImagePath('png'), false)
})
