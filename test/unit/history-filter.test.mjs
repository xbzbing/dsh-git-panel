/**
 * The debounced search publish.
 *
 * The tick after a mount publishes the same empty text the filter already holds.
 * It must be a no-op: a file-history chip applied at mount is exclusive with the
 * search filter, so a publish that "writes the same thing" would take the chip
 * down and start an unfiltered history request behind it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchPublish } from '../../lib/testkit.mjs'

const filter = (overrides = {}) => ({ ref: null, search: '', author: '', since: '', ...overrides })

test('an unchanged text publishes nothing', () => {
  assert.equal(searchPublish(filter(), '', ''), null, 'the mount tick')
  assert.equal(searchPublish(filter({ search: 'fix' }), 'fix', ''), null, 'a re-render with the same value')
})

test('an unchanged text keeps the chip', () => {
  // The scenario that matters: the chip is up and the search box publishes its
  // own unchanged value. Nothing is written, so the chip stays.
  assert.equal(searchPublish(filter({ exactPath: 'src/a.ts' }), '', ''), null)
})

test('a changed text publishes and drops the chip', () => {
  assert.deepEqual(searchPublish(filter(), 'fix', ''), { search: 'fix', pathSearch: '', dropsChip: false })
  assert.deepEqual(searchPublish(filter({ exactPath: 'src/a.ts' }), 'fix', ''), { search: 'fix', pathSearch: '', dropsChip: true })
})

test('switching scope is a real change even with the same characters', () => {
  assert.deepEqual(searchPublish(filter({ search: 'abc' }), '', 'abc'), { search: '', pathSearch: 'abc', dropsChip: false })
  assert.deepEqual(searchPublish(filter({ pathSearch: 'abc' }), 'abc', ''), { search: 'abc', pathSearch: '', dropsChip: false })
})

test('a missing pathSearch reads as empty, not as a change', () => {
  assert.equal(searchPublish({ search: '', exactPath: undefined }, '', ''), null)
  assert.deepEqual(searchPublish({ search: '', pathSearch: 'x', exactPath: undefined }, '', ''), { search: '', pathSearch: '', dropsChip: false })
})
