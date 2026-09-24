/**
 * Commit-graph layout tests: lane assignment and width for linear and
 * branching histories.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layoutGraph, graphWidth } from '../../lib/testkit.mjs'

function commit(hash, parents) {
  return { hash, shortHash: hash.slice(0, 7), subject: hash, author: 'A', dateIso: 'D', parents, refs: [] }
}

test('linear history stays in one lane', () => {
  const rows = layoutGraph([
    commit('c', ['b']),
    commit('b', ['a']),
    commit('a', []),
  ])
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.lane === 0))
  assert.equal(graphWidth(rows), 1)
})

test('a merge commit is flagged and opens a second lane', () => {
  // m merges a and b; then b then a as roots.
  const rows = layoutGraph([
    commit('m', ['a', 'b']),
    commit('b', []),
    commit('a', []),
  ])
  const merge = rows.find((r) => r.commit.hash === 'm')
  assert.equal(merge.merge, true)
  assert.ok(graphWidth(rows) >= 2, 'branching widens the graph to >=2 lanes')
})

test('every row carries edges array', () => {
  const rows = layoutGraph([commit('b', ['a']), commit('a', [])])
  assert.ok(Array.isArray(rows[0].edges))
})
