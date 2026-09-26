/**
 * Commit-graph lane layout. Independent implementation: given commits in
 * topological (newest-first) order with parent links, assign each commit a
 * lane column and compute the passing edges for that row, so a canvas/SVG
 * layer can draw nodes and connecting lines.
 */
import type { GraphCommit } from './types'

export interface GraphEdge {
  /** Lane the edge occupies at the top of the row. */
  readonly fromLane: number
  /** Lane the edge occupies at the bottom of the row. */
  readonly toLane: number
  readonly color: number
}

export interface GraphRow {
  readonly commit: GraphCommit
  /** Lane index of this commit's node. */
  readonly lane: number
  readonly color: number
  /** Edges passing through this row (including this node's outgoing edges). */
  readonly edges: readonly GraphEdge[]
  /** Whether the node is a merge (2+ parents). */
  readonly merge: boolean
}

/** Total lane count used across all rows (for width sizing). */
export function graphWidth(rows: readonly GraphRow[]): number {
  let max = 0
  for (const row of rows) {
    max = Math.max(max, row.lane + 1)
    for (const e of row.edges) max = Math.max(max, e.fromLane + 1, e.toLane + 1)
  }
  return max
}

/**
 * Assign lanes. `lanes[i]` holds the commit hash the lane is currently waiting
 * to place (its next expected commit). We walk commits newest→oldest, place
 * each commit into the first lane awaiting it (or a new lane), then replace
 * that lane's expectation with the commit's first parent and open new lanes
 * for extra parents.
 */
export function layoutGraph(commits: readonly GraphCommit[]): GraphRow[] {
  const rows: GraphRow[] = []
  // Each active lane awaits a specific commit hash (its child already placed).
  let lanes: (string | null)[] = []
  const colorOf = new Map<string, number>()
  let nextColor = 0
  const colorFor = (hash: string): number => {
    let c = colorOf.get(hash)
    if (c === undefined) {
      c = nextColor++
      colorOf.set(hash, c)
    }
    return c
  }

  for (const commit of commits) {
    // Place a hash into the lane already awaiting it, else the first free lane,
    // else a freshly opened one; returns the chosen lane index.
    const assignLane = (hash: string): number => {
      let lane = lanes.findIndex((h) => h === hash)
      if (lane === -1) {
        lane = lanes.findIndex((h) => h === null)
        if (lane === -1) { lane = lanes.length; lanes.push(null) }
        lanes[lane] = hash
      }
      return lane
    }

    const lane = assignLane(commit.hash)
    const color = colorFor(commit.hash)

    // Snapshot lanes before mutation (top of the row).
    const before = [...lanes]

    // This lane now awaits the first parent; extra parents open new lanes.
    const parents = commit.parents
    const merge = parents.length >= 2
    // Any other lane also awaiting this same commit collapses (fast-forward merge target).
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === commit.hash) lanes[i] = null
    }
    if (parents.length === 0) {
      lanes[lane] = null
    } else {
      lanes[lane] = parents[0]!
      colorFor(parents[0]!)
      for (let p = 1; p < parents.length; p++) {
        const parent = parents[p]!
        assignLane(parent)
        colorFor(parent)
      }
    }

    // Edges: for every lane active before, connect its top position to where
    // its awaited commit sits after mutation.
    const edges: GraphEdge[] = []
    const after = lanes
    for (let i = 0; i < before.length; i++) {
      const awaited = before[i]
      if (awaited === null) continue
      if (awaited === commit.hash) {
        // Edge flowing into this node.
        edges.push({ fromLane: i, toLane: lane, color: colorFor(commit.hash) })
      } else {
        // Lane continues awaiting the same commit; find its post position.
        const toLane = after.findIndex((h) => h === awaited)
        if (toLane !== -1) edges.push({ fromLane: i, toLane, color: colorFor(awaited) })
      }
    }
    // Outgoing edges to parents (node → parent lanes).
    for (const parent of parents) {
      const toLane = after.findIndex((h) => h === parent)
      if (toLane !== -1) edges.push({ fromLane: lane, toLane, color: colorFor(parent) })
    }

    rows.push({ commit, lane, color, edges, merge })
    // Trim trailing null lanes to keep width tight.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes = lanes.slice(0, -1)
  }
  return rows
}

