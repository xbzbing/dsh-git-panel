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
  /**
   * Vertical span within the row: `into` flows top → node (drawn to ROW_H/2),
   * `out` flows node → bottom (drawn from ROW_H/2), `pass` crosses the whole
   * row. Into/out edges meeting at the node keep a lane's stub from trailing
   * below its last commit and keep a converging curve from being overdrawn
   * by a full-height straight.
   */
  readonly kind: 'into' | 'out' | 'pass'
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
 * each commit into the first lane awaiting it (or a new lane), continue that
 * lane with the commit's first parent (converging leftward when the parent is
 * already awaited elsewhere, so the main line stays left), and open new lanes
 * for extra parents. Each lane carries one color for its whole run.
 */
export function layoutGraph(commits: readonly GraphCommit[]): GraphRow[] {
  const rows: GraphRow[] = []
  // Each active lane awaits a specific commit hash (its child already placed)
  // and carries a color for its whole run, so a continuous line keeps one color
  // (VSCode-style, issue #9) instead of recoloring at every commit. A lane's
  // color is freed when the lane closes and reused lowest-first to keep the
  // palette tight.
  let lanes: (string | null)[] = []
  let laneColor: (number | null)[] = []
  const freed: number[] = []
  let nextColor = 0
  const openColor = (): number => (freed.length > 0 ? freed.splice(freed.indexOf(Math.min(...freed)), 1)[0]! : nextColor++)
  const freeColor = (c: number | null): void => { if (c !== null && !freed.includes(c)) freed.push(c) }

  for (const commit of commits) {
    // Place a hash into the lane already awaiting it, else the first free lane,
    // else a freshly opened one; returns the chosen lane index.
    const assignLane = (hash: string): number => {
      let lane = lanes.findIndex((h) => h === hash)
      if (lane === -1) {
        lane = lanes.findIndex((h) => h === null)
        if (lane === -1) { lane = lanes.length; lanes.push(null); laneColor.push(null) }
        lanes[lane] = hash
        laneColor[lane] = openColor()
      }
      return lane
    }

    const lane = assignLane(commit.hash)
    const color = laneColor[lane]!

    // Snapshot lanes + their colors before mutation (top of the row).
    const before = [...lanes]
    const beforeColor = [...laneColor]

    // This lane continues with the commit's FIRST parent, keeping a first-parent
    // chain (the main line) straight in a single column; extra parents open new
    // lanes to the right. When the first parent is already awaited by another
    // lane the two converge into the leftmost of them, so the main line is
    // pulled left and never drifts right (issue #9).
    const parents = commit.parents
    const merge = parents.length >= 2
    // A commit with several displayed children is awaited by more than one lane;
    // the extras converge into this node (drawn below as into-edges).
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === commit.hash) { freeColor(laneColor[i]); lanes[i] = null; laneColor[i] = null }
    }
    if (parents.length === 0) {
      freeColor(laneColor[lane]); lanes[lane] = null; laneColor[lane] = null
    } else {
      const fp = parents[0]!
      const other = lanes.findIndex((h, i) => h === fp && i !== lane)
      if (other === -1) {
        lanes[lane] = fp // lane keeps its color across the continuation
      } else {
        // Two lanes want the same parent: keep the leftmost, close the other.
        const keep = Math.min(lane, other)
        const drop = Math.max(lane, other)
        lanes[keep] = fp
        freeColor(laneColor[drop]); lanes[drop] = null; laneColor[drop] = null
      }
      for (let p = 1; p < parents.length; p++) assignLane(parents[p]!)
    }

    // Edges: for every lane active before, connect its top position to where
    // its awaited commit sits after mutation.
    // Edge color is the color of the line it represents: an into/pass edge keeps
    // the incoming lane's color up to the node; an out edge takes the color of
    // the lane it lands in (the continuation, or the target line of a merge).
    const edges: GraphEdge[] = []
    const after = lanes
    for (let i = 0; i < before.length; i++) {
      const awaited = before[i]
      if (awaited === null) continue
      if (awaited === commit.hash) {
        edges.push({ fromLane: i, toLane: lane, color: beforeColor[i]!, kind: 'into' })
      } else {
        const toLane = after.findIndex((h) => h === awaited)
        if (toLane !== -1) edges.push({ fromLane: i, toLane, color: beforeColor[i]!, kind: 'pass' })
      }
    }
    for (const parent of parents) {
      const toLane = after.findIndex((h) => h === parent)
      if (toLane !== -1) edges.push({ fromLane: lane, toLane, color: laneColor[toLane]!, kind: 'out' })
    }

    rows.push({ commit, lane, color, edges, merge })
    // Trim trailing null lanes to keep width tight.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) { lanes = lanes.slice(0, -1); laneColor = laneColor.slice(0, -1) }
  }
  return rows
}

