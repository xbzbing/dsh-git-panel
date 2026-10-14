/**
 * Diff tests: unified-diff → side-by-side rows, summary, and file-kind guards.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSideBySide, retargetTrailingGap, summarize, isBinaryDiff, extractAddedContent, extractDeletedContent, isImagePath, isSvgPath, intraLineDiff, spliceGap, contextRowsFromLines, flattenToUnified, GAP_STEP } from '../../lib/testkit.mjs'

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
  const rows = buildSideBySide(MODIFY, 2)
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
  const rows = buildSideBySide(MODIFY, 2)
  const mod = rows.find((r) => r.kind === 'mod')
  assert.ok(mod)
  // "old" vs "new": no shared prefix/suffix → whole line, so no word range.
  assert.equal(mod.leftWord, undefined)
})

test('flattenToUnified splits a mod row into del above add, keeping word ranges', () => {
  // A mid-token edit so the mod row carries word ranges on both sides.
  const src = `diff --git a/x b/x
index 1..2 100644
--- a/x
+++ b/x
@@ -1,1 +1,1 @@
-const x = 1
+const x = 2
`
  const rows = buildSideBySide(src, 1)
  const mod = rows.find((r) => r.kind === 'mod')
  assert.ok(mod, 'a mod row exists in split layout')
  assert.ok(mod.leftWord && mod.rightWord, 'mod carries word ranges')
  const uni = flattenToUnified(rows)
  const di = uni.findIndex((r) => r.kind === 'del' && r.leftText === 'const x = 1')
  assert.ok(di >= 0, 'deletion present')
  assert.equal(uni[di + 1].kind, 'add', 'addition immediately follows its deletion')
  assert.equal(uni[di + 1].rightText, 'const x = 2')
  // Word ranges survive onto the single-sided rows.
  assert.deepEqual(uni[di].leftWord, mod.leftWord)
  assert.deepEqual(uni[di + 1].rightWord, mod.rightWord)
  // No mod rows remain in the flattened sequence.
  assert.ok(!uni.some((r) => r.kind === 'mod'))
})

test('flattenToUnified passes context/add/del/hunk/gap rows through', () => {
  const rows = buildSideBySide(GAPPED, 32)
  const uni = flattenToUnified(rows)
  assert.ok(uni.some((r) => r.kind === 'hunk'))
  assert.ok(uni.some((r) => r.kind === 'gap'))
  assert.ok(uni.some((r) => r.kind === 'context'))
  // GAPPED's single change is a mod (old31/new31) → becomes del + add.
  assert.ok(uni.some((r) => r.kind === 'del' && r.leftText === 'old31'))
  assert.ok(uni.some((r) => r.kind === 'add' && r.rightText === 'new31'))
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
  // 40 new-side lines, hunk covers 30..32 → 29 hidden above, 8 below.
  const rows = buildSideBySide(GAPPED, 40)
  const lead = rows.find((r) => r.kind === 'gap' && r.gap.atStart)
  assert.ok(lead, 'leading gap present')
  assert.equal(lead.gap.rightStart, 1)
  assert.equal(lead.gap.count, 29, 'lines 1..29 hidden above hunk starting at 30')
  const trail = rows.find((r) => r.kind === 'gap' && r.gap.rightStart === 33)
  assert.equal(trail.gap.count, 8, 'lines 33..40 hidden below')
})

// Regression (the bug this change fixes): git caps trailing context at -U, so
// a full trailing run looks identical whether the hunk is mid-file or the file
// ends exactly there. Only the new-side line count can tell them apart.
test('buildSideBySide emits a trailing gap only when lines really follow the last hunk', () => {
  // GAPPED's hunk covers new lines 30..32; the file ends there → nothing below.
  const atEof = buildSideBySide(GAPPED, 32)
  assert.ok(!atEof.some((r) => r.kind === 'gap' && r.gap.rightStart === 33), 'no trailing gap at EOF')

  const midFile = buildSideBySide(GAPPED, 35)
  const trail = midFile.find((r) => r.kind === 'gap' && r.gap.rightStart === 33)
  assert.ok(trail, 'trailing gap present when lines follow')
  assert.equal(trail.gap.count, 3, 'count is exact, not EOF-probed')
})

test('buildSideBySide reports no trailing gap when the new-side count is unknown', () => {
  // 0 = host could not read the new side: hide the control rather than offer a
  // button that reveals nothing (the old dead-button behaviour).
  const rows = buildSideBySide(GAPPED, 0)
  assert.ok(!rows.some((r) => r.kind === 'gap' && !r.gap.atStart), 'no speculative trailing gap')
  assert.ok(rows.some((r) => r.kind === 'gap' && r.gap.atStart), 'leading gap unaffected')
})

test('buildSideBySide emits no trailing gap for an add-only or delete-only diff', () => {
  // Whole file shown: rightNo runs past the last line, so nothing can hide.
  const added = buildSideBySide(`diff --git a/n.txt b/n.txt
--- /dev/null
+++ b/n.txt
@@ -0,0 +1,2 @@
+a
+b
`, 2)
  assert.ok(!added.some((r) => r.kind === 'gap'), 'no gap in a new-file diff')

  const deleted = buildSideBySide(`diff --git a/d.txt b/d.txt
--- a/d.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-a
-b
`, 0)
  assert.ok(!deleted.some((r) => r.kind === 'gap'), 'no gap in a deleted-file diff')
})

test('contextRowsFromLines maps revealed new lines to both sides with delta', () => {
  // delta = oldLine - newLine; here old and new line up (delta 0).
  const rows = contextRowsFromLines(0, 5, ['e', 'f'])
  assert.deepEqual(rows.map((r) => [r.leftNo, r.rightNo, r.leftText]), [[5, 5, 'e'], [6, 6, 'f']])
})

test('spliceGap all replaces the gap with revealed context rows', () => {
  const rows = buildSideBySide(GAPPED, 40)
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
  const rows = buildSideBySide(big, 200)
  const lead = rows.find((r) => r.kind === 'gap' && r.gap.atStart)
  assert.equal(lead.gap.count, 99)
  const revealed = Array.from({ length: GAP_STEP }, (_, i) => `L${i + 1}`)
  const out = spliceGap(rows, lead.gap.rightStart, 'down', 1, revealed, false)
  const residual = out.find((r) => r.kind === 'gap' && r.gap.rightStart === 1 + GAP_STEP)
  assert.ok(residual, 'a residual gap remains')
  assert.equal(residual.gap.count, 99 - GAP_STEP)
})

test('spliceGap on a trailing gap reveals exactly its counted lines', () => {
  // The trailing gap's count is exact, so a full reveal consumes it with no
  // residual and no eof probe.
  const rows = buildSideBySide(GAPPED, 35)
  const trail = rows.find((r) => r.kind === 'gap' && r.gap.rightStart === 33)
  assert.equal(trail.gap.count, 3)
  const out = spliceGap(rows, 33, 'all', 33, ['t1', 't2', 't3'], true)
  assert.ok(!out.some((r) => r.kind === 'gap' && r.gap.rightStart === 33), 'consumed whole, no residual')
  assert.ok(out.some((r) => r.kind === 'context' && r.rightText === 't3'))
})

test('spliceGap down on a trailing gap keeps an exact residual when eof is not reached', () => {
  const rows = buildSideBySide(GAPPED, 60)
  const trail = rows.find((r) => r.kind === 'gap' && r.gap.rightStart === 33)
  assert.equal(trail.gap.count, 28)
  const out = spliceGap(rows, 33, 'down', 33, Array.from({ length: 20 }, (_, i) => `t${i}`), false)
  const residual = out.find((r) => r.kind === 'gap' && r.gap.rightStart === 53)
  assert.ok(residual, 'residual remains at the next unrevealed line')
  assert.equal(residual.gap.count, 8, 'exact remainder')
})

test('spliceGap down drops the residual when the host reports eof early', () => {
  // The file shrank between the diff query and the expansion: eof wins over
  // the stale count so no control is left pointing past the file end.
  const rows = buildSideBySide(GAPPED, 60)
  const out = spliceGap(rows, 33, 'down', 33, ['only'], true)
  assert.ok(!out.some((r) => r.kind === 'gap' && r.gap.rightStart > 33), 'no residual past the file end')
})

test('isBinaryDiff classifies correctly', () => {
  assert.equal(isBinaryDiff(BINARY), true)
  assert.equal(isBinaryDiff(MODIFY), false)
})

test('buildSideBySide treats a non-finite count as unknown', () => {
  // A caller that cannot state the count (or a JS caller that omits it) gets no
  // trailing control instead of a NaN-sized one.
  for (const bad of [undefined, NaN, -3, Infinity]) {
    const rows = buildSideBySide(GAPPED, bad)
    assert.ok(!rows.some((r) => r.kind === 'gap' && r.gap.rightStart === 33), `no trailing gap for ${String(bad)}`)
    assert.ok(rows.some((r) => r.kind === 'gap' && r.gap.atStart), 'leading gap unaffected')
  }
})

test('a trailing gap larger than one step offers up / all / down and keeps an exact remainder', () => {
  // 200-line file, last hunk ends at new line 32 → 168 hidden below.
  const rows = buildSideBySide(GAPPED, 200)
  const trail = rows.find((r) => r.kind === 'gap' && r.gap.rightStart === 33)
  assert.equal(trail.gap.count, 168)
  assert.equal(trail.gap.atStart, false)
  const down = spliceGap(rows, 33, 'down', 33, Array.from({ length: GAP_STEP }, (_, i) => `d${i}`), false)
  const residual = down.find((r) => r.kind === 'gap' && r.gap.rightStart === 33 + GAP_STEP)
  assert.ok(residual, 'residual below the revealed window')
  assert.equal(residual.gap.count, 168 - GAP_STEP)
  const up = spliceGap(rows, 33, 'up', 33 + 168 - GAP_STEP, Array.from({ length: GAP_STEP }, (_, i) => `u${i}`), true)
  const above = up.find((r) => r.kind === 'gap' && r.gap.rightStart === 33)
  assert.ok(above, 'residual above the revealed window')
  assert.equal(above.gap.count, 168 - GAP_STEP)
})

test('spliceGap up with nothing revealed consumes the gap instead of re-offering it', () => {
  // A stale count can ask for a range past the file end: the host answers with
  // no lines, and re-emitting the same gap would offer the same dead control
  // forever.
  const rows = buildSideBySide(GAPPED, 1e6)
  const out = spliceGap(rows, 33, 'up', 999981, [], true)
  assert.ok(!out.some((r) => r.kind === 'gap' && r.gap.rightStart === 33), 'gap consumed, no residual')
})

test('retargetTrailingGap follows a new count without resetting the rows', () => {
  const rows = buildSideBySide(GAPPED, 35)
  const trail = rows.find((r) => r.kind === 'gap' && r.gap.rightStart === 33)
  assert.equal(trail.gap.count, 3)

  // Same array identity when the count did not move (no needless re-render).
  assert.equal(retargetTrailingGap(rows, 35), rows)

  // Grew: the same gap reports more hidden lines, revealed rows untouched.
  const grown = retargetTrailingGap(rows, 41)
  assert.equal(grown.find((r) => r.kind === 'gap' && r.gap.rightStart === 33).gap.count, 9)
  assert.deepEqual(grown.map((r) => r.kind), rows.map((r) => r.kind), 'row shape unchanged')

  // Revealed context rows survive a retarget (this is what a reseed would drop).
  const revealed = spliceGap(rows, 33, 'all', 33, ['t1', 't2', 't3'], true)
  const after = retargetTrailingGap(revealed, 44)
  assert.ok(after.some((r) => r.kind === 'context' && r.rightText === 't2'), 'revealed row kept')
  assert.equal(after.at(-1).gap.count, 9, 'new gap below the revealed block (36..44)')
  assert.equal(after.at(-1).gap.rightStart, 36)

  // Shrank to "nothing below": the gap disappears.
  const gone = retargetTrailingGap(rows, 32)
  assert.ok(!gone.some((r) => r.kind === 'gap' && r.gap.rightStart === 33), 'gap removed at EOF')

  // Unknown count is the same as "nothing to reveal".
  assert.ok(!retargetTrailingGap(rows, 0).some((r) => r.kind === 'gap' && r.gap.rightStart === 33))

  // A gap that has to APPEAR below a context tail is created from that row's
  // own delta (the region below an unchanged line shares it).
  const noGap = buildSideBySide(GAPPED, 32)
  const appeared = retargetTrailingGap(noGap, 40)
  assert.equal(appeared.at(-1).gap.rightStart, 33)
  assert.equal(appeared.at(-1).gap.count, 8)

  // Below a one-sided addition the delta is not recoverable from the rows, so
  // the caller must reseed from the diff text instead.
  const addTail = buildSideBySide(`diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 line1
 line2
+line3
`, 3)
  assert.equal(retargetTrailingGap(addTail, 40), null)
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

test('isSvgPath matches only .svg (case-insensitive) as the suffix', () => {
  assert.equal(isSvgPath('icon.svg'), true)
  assert.equal(isSvgPath('dir/Logo.SVG'), true, 'case-insensitive')
  assert.equal(isSvgPath('a.png'), false)
  assert.equal(isSvgPath('a.svg.png'), false, 'must be the suffix')
  assert.equal(isSvgPath('svg'), false)
  assert.equal(isSvgPath('no-extension'), false)
})
