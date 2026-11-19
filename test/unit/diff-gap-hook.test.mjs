/**
 * Gap expansion walk: one "expand all" click must chain host-sized batches
 * until the gap is consumed (the loop is generation-guarded by the diff seed,
 * not by the row list — a rows-keyed guard would abort after the first batch,
 * because every splice mints a new rows array), and a refused reveal must
 * surface its reason instead of swallowing it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { mount } from './_hook-harness.mjs'
import { useGapExpander } from '../../lib/hookkit.mjs'
import { buildSideBySide } from '../../lib/testkit.mjs'

const TEXT = ['@@ -1,3 +1,3 @@', ' a', '-b', '+c', ' d'].join('\n')
const FILE_LINES = 100

/** Host stand-in that answers every request with at most 20 lines — a bounded
 * reply the way FILE_LINES_MAX_LINES bounds the real one. */
function batchRemote(log) {
  return {
    query: async ({ query }) => {
      log.push(query.start)
      const start = query.start
      const last = Math.min(start + 19, FILE_LINES)
      const lines = []
      for (let i = start; i <= last; i++) lines.push(`L${i}`)
      return { ok: true, value: { kind: 'file-lines', path: query.path, start, lines, eof: last >= FILE_LINES } }
    },
  }
}

function mountExpander(remote) {
  const rows0 = buildSideBySide(TEXT, FILE_LINES)
  return mount(() => {
    const [rows, setRows] = React.useState(rows0)
    return { rows, gap: useGapExpander(setRows, remote, 's', 'a.txt', 'commit', 'abc123', TEXT, FILE_LINES) }
  }, { autoRender: true })
}

test('one expand-all click walks the whole gap in bounded batches', async () => {
  const log = []
  const h = mountExpander(batchRemote(log))
  await h.settle()
  const gap = h.value.rows.find((r) => r.kind === 'gap')
  assert.ok(gap, 'the fixture starts with a trailing gap')
  assert.ok(gap.gap.count > 20, 'a gap larger than one batch is the point of the walk')

  h.value.gap.run(gap.gap, 'all')
  await h.settle()

  assert.ok(log.length >= 4, `one click must chain batches (requests: ${JSON.stringify(log)})`)
  assert.deepEqual([...log].sort((a, b) => a - b), log, 'the walk moves forward only')
  assert.ok(!h.value.rows.some((r) => r.kind === 'gap'), 'the whole gap is revealed in one gesture')
  assert.equal(h.value.gap.busy, null, 'the walk settles its own busy state')
  assert.equal(h.value.gap.failed, null)
  h.unmount()
})

test('a refused reveal surfaces the reason and leaves the gap in place', async () => {
  const remote = {
    query: async () => ({ ok: false, error: { code: 'git-error', message: 'worktree file exceeds the read limit: big.txt' } }),
  }
  const h = mountExpander(remote)
  await h.settle()
  const gap = h.value.rows.find((r) => r.kind === 'gap')

  h.value.gap.run(gap.gap, 'all')
  await h.settle()

  assert.equal(h.value.gap.failed, 'worktree file exceeds the read limit: big.txt')
  assert.equal(h.value.gap.busy, null, 'a failure still releases the busy state')
  assert.ok(h.value.rows.some((r) => r.kind === 'gap'), 'the gap is not silently consumed')
  h.unmount()
})

// A hunk at line 41 of a 100-line file: a leading gap (new lines 1..40) above
// it and a trailing one below. Neither reply has to reach EOF to be spliced.
const LEAD_TEXT = ['@@ -41,3 +41,3 @@', ' a41', '-b42', '+c42', ' a43'].join('\n')

/** Host stand-in that answers exactly the requested range and reports EOF only
 * when that range reached the last line — the mid-file shape the walk lives in. */
function rangeRemote(log, fileLines) {
  return {
    query: async ({ query }) => {
      log.push({ start: query.start, end: query.end })
      const stop = Math.min(query.end, fileLines)
      const lines = []
      for (let i = query.start; i <= stop; i++) lines.push(`L${i}`)
      return { ok: true, value: { kind: 'file-lines', path: query.path, start: query.start, lines, eof: stop >= fileLines } }
    },
  }
}

function mountRows(text, remote, fileLines) {
  const rows0 = buildSideBySide(text, fileLines)
  return mount(() => {
    const [rows, setRows] = React.useState(rows0)
    return { rows, gap: useGapExpander(setRows, remote, 's', 'a.txt', 'commit', 'abc123', text, fileLines) }
  }, { autoRender: true })
}

test('a leading gap expands all of its lines, not just the ones below the first hunk', async () => {
  const log = []
  const h = mountRows(LEAD_TEXT, rangeRemote(log, FILE_LINES), FILE_LINES)
  await h.settle()
  const lead = h.value.rows.find((r) => r.kind === 'gap' && r.gap.rightStart === 1)
  assert.ok(lead, 'the fixture starts with the 40 hidden lines above the first hunk')

  h.value.gap.run(lead.gap, 'all')
  await h.settle()

  assert.deepEqual(log, [{ start: 1, end: 40 }], 'the hidden region above the hunk is what gets asked for')
  assert.equal(h.value.rows[0]?.kind, 'context', 'the revealed lines take the gap’s place at the top')
  assert.equal(h.value.rows[0]?.rightNo, 1, 'starting at line 1 of the file')
  assert.ok(!h.value.rows.some((r) => r.kind === 'gap' && r.gap.rightStart === 1), 'the leading gap is consumed')
  assert.ok(h.value.rows.some((r) => r.kind === 'gap' && r.gap.rightStart === 44), 'the trailing gap is untouched')
  h.unmount()
})

test('expand-up addresses the gap, not the slice it asks for', async () => {
  const log = []
  const h = mountRows(LEAD_TEXT, rangeRemote(log, FILE_LINES), FILE_LINES)
  await h.settle()
  // The gap below the hunk: new lines 44..100.
  const trail = h.value.rows.find((r) => r.kind === 'gap' && r.gap.rightStart === 44)
  assert.ok(trail, 'the fixture ends with a gap larger than one step')

  h.value.gap.run(trail.gap, 'up')
  await h.settle()

  assert.deepEqual(log, [{ start: 81, end: 100 }], 'the bottom window of the gap is requested')
  const last = h.value.rows[h.value.rows.length - 1]
  assert.equal(last?.rightNo, 100, 'the revealed lines reach the last line of the file')
  const residual = h.value.rows.find((r) => r.kind === 'gap' && r.gap.rightStart === 44)
  assert.ok(residual, 'the rest of the gap stays clickable above the revealed tail, under the same rightStart')
  assert.equal(residual.gap.count, 100 - 44 + 1 - 20, 'with only the revealed twenty lines taken off')
  h.unmount()
})
