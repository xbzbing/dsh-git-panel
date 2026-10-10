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

test('issue #9: a second child of an already-awaited parent adds no phantom lane or per-row hooks', () => {
  // Real topology from ivanant/dsh-simple-remote: the root has two children
  // (Finish 1.0.0 merges [root, Finish init]; Finish init merges [root, side]),
  // then a linear side chain back into the root. Before the fix the root was
  // double-booked onto two lanes, widening the graph to 3 and painting a
  // spurious hook on every row until the root landed.
  const rows = layoutGraph([
    commit('m1', ['root', 'fi']),
    commit('fi', ['root', 'c1']),
    commit('c1', ['c2']),
    commit('c2', ['c3']),
    commit('c3', ['c4']),
    commit('c4', ['c5']),
    commit('c5', ['root']),
    commit('root', []),
  ])
  assert.equal(graphWidth(rows), 2, 'matches `git log --graph` (2 lanes, not 3)')
  assert.deepEqual(rows.map((r) => r.lane), [0, 1, 1, 1, 1, 1, 1, 0])
  // The side chain's end converges once into the root lane…
  const converge = rows.find((r) => r.commit.hash === 'c5')
  assert.ok(converge.edges.some((e) => e.fromLane === 1 && e.toLane === 0), 'chain end converges into lane 0')
  // …and no identical non-straight edge repeats across consecutive rows
  // (empty signatures are gaps, not repeats).
  let prev = ''
  for (const r of rows) {
    const sig = r.edges.filter((e) => e.fromLane !== e.toLane).map((e) => `${e.fromLane}→${e.toLane}·${e.color}`).sort().join(',')
    if (sig !== '') assert.notEqual(sig, prev, `repeated hook signature on row ${r.commit.hash}`)
    prev = sig
  }
})

test('a linear chain is a single lane color (no per-commit recolor)', () => {
  const rows = layoutGraph([commit('c', ['b']), commit('b', ['a']), commit('a', [])])
  const colors = new Set(rows.map((r) => r.color))
  assert.equal(colors.size, 1, 'one continuous line keeps one color')
  // Every edge on the chain also carries that one color.
  const edgeColors = new Set(rows.flatMap((r) => r.edges.map((e) => e.color)))
  assert.equal(edgeColors.size, 1)
})

test('issue #9: main line stays leftmost in lane 0 and the side chain is one color', () => {
  // Real dsh-simple-remote topology: HEAD merges [root, side-head]; a second
  // merge does the same; the side chain rejoins root at the bottom.
  const rows = layoutGraph([
    commit('m1', ['root', 'fi']),
    commit('fi', ['root', 'c1']),
    commit('c1', ['c2']),
    commit('c2', ['c3']),
    commit('c3', ['c4']),
    commit('c4', ['c5']),
    commit('c5', ['root']),
    commit('root', []),
  ])
  // Main line (first-parent chain of HEAD) stays in lane 0 at top and bottom.
  const byHash = Object.fromEntries(rows.map((r) => [r.commit.hash, r]))
  assert.equal(byHash.m1.lane, 0)
  assert.equal(byHash.root.lane, 0)
  // Lane 0 is one color end to end; the side chain is a single, different color.
  assert.equal(byHash.m1.color, byHash.root.color, 'main line keeps one color')
  const chain = ['fi', 'c1', 'c2', 'c3', 'c4', 'c5']
  const chainColors = new Set(chain.map((h) => byHash[h].color))
  assert.equal(chainColors.size, 1, 'side chain keeps one color')
  assert.notEqual([...chainColors][0], byHash.root.color, 'main and side differ')
  // Exactly two colors across the whole graph (not a per-commit rainbow).
  assert.equal(new Set(rows.map((r) => r.color)).size, 2)
})

test('parallel style keeps each merge first-parent in its own lane, converging at the ancestor (VSCode)', () => {
  // Same dsh-simple-remote topology. In parallel style the shared root is NOT
  // merged early: both merges' first-parent lines and the chain's tail run as
  // parallel columns and converge only at the root node.
  const rows = layoutGraph([
    commit('m1', ['root', 'fi']),
    commit('fi', ['root', 'c1']),
    commit('c1', ['c2']),
    commit('c2', ['c3']),
    commit('c3', ['c4']),
    commit('c4', ['c5']),
    commit('c5', ['root']),
    commit('root', []),
  ], 'parallel')
  const byHash = Object.fromEntries(rows.map((r) => [r.commit.hash, r]))
  // Three parallel columns (vs two in compact): main + two merge-ancestor lines.
  assert.equal(graphWidth(rows), 3)
  assert.deepEqual(rows.map((r) => r.lane), [0, 1, 2, 2, 2, 2, 2, 0])
  // The root node collects an into-edge from every lane that was heading to it.
  const rootEdges = byHash.root.edges.filter((e) => e.kind === 'into')
  assert.equal(rootEdges.length, 3, 'three parallel lines converge at the root')
  // Each parallel line is its own color; three lanes → three colors.
  assert.equal(new Set(rows.map((r) => r.color)).size, 3)
  // Main line still leftmost (lane 0) at top and bottom.
  assert.equal(byHash.m1.lane, 0)
  assert.equal(byHash.root.lane, 0)
})

test('compact is the default style', () => {
  const topo = [
    commit('m1', ['root', 'fi']),
    commit('fi', ['root', 'c1']),
    commit('c1', ['root']),
    commit('root', []),
  ]
  assert.equal(graphWidth(layoutGraph(topo)), graphWidth(layoutGraph(topo, 'compact')))
})

test('date-order input (parent listed before child) still yields one lane per chain', () => {
  // A parent appearing above its child must not strand the child on a new
  // lane forever: the child reuses the lane already awaiting it.
  const rows = layoutGraph([
    commit('p', []),
    commit('c', ['p']),
  ])
  assert.equal(graphWidth(rows), 1)
})

test('edge kinds anchor at the node: into targets the row lane, out originates from it', () => {
  // The renderer draws into edges top→node, out edges node→bottom and pass
  // edges full-height; the anchors are what keep a lane's stub from trailing
  // below its last commit (the "tail protrusion").
  const rows = layoutGraph([
    commit('m', ['a', 'b']),
    commit('b', ['a']),
    commit('a', []),
  ])
  for (const r of rows) {
    for (const e of r.edges) {
      if (e.kind === 'into') assert.equal(e.toLane, r.lane, `into edge must end at the node on ${r.commit.hash}`)
      if (e.kind === 'out') assert.equal(e.fromLane, r.lane, `out edge must start at the node on ${r.commit.hash}`)
    }
  }
  // The chain tail (b, whose parent sits on the merge's lane) converges with
  // a single out edge instead of a full-height cross.
  const tail = rows.find((r) => r.commit.hash === 'b')
  const conv = tail.edges.find((e) => e.fromLane === 1 && e.toLane === 0)
  assert.equal(conv?.kind, 'out')
})
