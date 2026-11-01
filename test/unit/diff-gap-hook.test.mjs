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
