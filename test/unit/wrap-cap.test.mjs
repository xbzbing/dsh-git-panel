/**
 * The wrap caps decide whether a source view may leave its virtualized grid for
 * flow layout — the difference between mounting a screenful of rows and
 * mounting every line of a file. Both caps are conjunctive: either one exceeded
 * keeps the grid.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wrapCapOk, MAX_WRAP_LINES, MAX_WRAP_BYTES } from '../../lib/testkit.mjs'

/** Content of `bytes` characters, all on one line. */
const contentOf = (bytes) => 'x'.repeat(bytes)

test('wrapping needs both the line count and the size under their caps', () => {
  assert.equal(wrapCapOk(contentOf(10), 10), true, 'an ordinary file wraps')
  assert.equal(wrapCapOk(contentOf(10), MAX_WRAP_LINES), true, 'exactly at the line cap still wraps')
  assert.equal(wrapCapOk(contentOf(MAX_WRAP_BYTES), 10), true, 'exactly at the byte cap still wraps')
  assert.equal(wrapCapOk(contentOf(10), MAX_WRAP_LINES + 1), false, 'one line over the cap refuses — a long file would mount whole')
  assert.equal(wrapCapOk(contentOf(MAX_WRAP_BYTES + 1), 10), false, 'one byte over refuses — 5000-char lines cost the same layout work')
})

test('a huge file that is also huge stays refused (no accidental escape)', () => {
  assert.equal(wrapCapOk(contentOf(MAX_WRAP_BYTES + 1), MAX_WRAP_LINES + 1), false)
})
