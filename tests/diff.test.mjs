/**
 * Diff tests: unified-diff → side-by-side rows, summary, and file-kind guards.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSideBySide, summarize, isBinaryDiff, isAddOnlyDiff, isDeleteOnlyDiff, extractAddedContent, extractDeletedContent } from '../lib/testkit.mjs'

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
  // old→new paired into one row (left old, right new)
  const paired = rows.find((r) => r.leftText === 'old' && r.rightText === 'new')
  assert.ok(paired, 'deletion and addition align on one row')
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
