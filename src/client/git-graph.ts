/**
 * Commit-graph lane layout. Independent implementation: given commits in
 * topological (newest-first) order with parent links, assign each commit a
 * lane column and compute the passing edges for that row, so a canvas/SVG
 * layer can draw nodes and connecting lines.
 */
import type { GraphCommit, GraphStyle } from './types'

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
 * lane with the commit's first parent, and open new lanes for extra parents.
 * Each lane carries one color for its whole run.
 *
 * `style` controls how a first parent already reached by another lane is drawn:
 *  - `compact` (git log --graph): the two lanes converge into the leftmost one
 *    right away, so the shared ancestor keeps a single column (fewer lanes).
 *  - `parallel` (VSCode / GUI tools): each merge's first parent continues in its
 *    own lane, so a shared ancestor shows as parallel lines that converge only
 *    at the ancestor node (wider, straighter lines).
 */
export function layoutGraph(commits: readonly GraphCommit[], style: GraphStyle = 'compact'): GraphRow[] {
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
    // chain straight in a single column; extra parents open new lanes to the
    // right. In `compact` a first parent already awaited by another lane
    // converges into the leftmost of the two (so the main line stays left and
    // never drifts right, issue #9); in `parallel` it keeps its own lane.
    const parents = commit.parents
    const merge = parents.length >= 2
    // A commit with several displayed children is awaited by more than one lane;
    // the extras converge into this node (drawn below as into-edges).
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === commit.hash) { freeColor(laneColor[i]); lanes[i] = null; laneColor[i] = null }
    }
    let contLane = -1 // lane the first parent continues in (-1 = chain ends here)
    const extraLanes: number[] = [] // lanes opened for a merge's 2nd+ parents
    if (parents.length === 0) {
      freeColor(laneColor[lane]); lanes[lane] = null; laneColor[lane] = null
    } else {
      const fp = parents[0]!
      const other = style === 'compact' ? lanes.findIndex((h, i) => h === fp && i !== lane) : -1
      if (other === -1) {
        lanes[lane] = fp // lane keeps its color across the continuation
        contLane = lane
      } else {
        // Compact only: two lanes want the same parent — keep the leftmost.
        const keep = Math.min(lane, other)
        const drop = Math.max(lane, other)
        lanes[keep] = fp
        freeColor(laneColor[drop]); lanes[drop] = null; laneColor[drop] = null
        contLane = keep
      }
      for (let p = 1; p < parents.length; p++) extraLanes.push(assignLane(parents[p]!))
    }

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
        // A lane still awaiting the same commit stays in place (parallel lines
        // never collapse onto the first matching slot); otherwise follow it.
        const toLane = lanes[i] === awaited ? i : after.findIndex((h) => h === awaited)
        if (toLane !== -1) edges.push({ fromLane: i, toLane, color: beforeColor[i]!, kind: 'pass' })
      }
    }
    if (contLane !== -1) edges.push({ fromLane: lane, toLane: contLane, color: laneColor[contLane]!, kind: 'out' })
    for (const lp of extraLanes) edges.push({ fromLane: lane, toLane: lp, color: laneColor[lp]!, kind: 'out' })

    rows.push({ commit, lane, color, edges, merge })
    // Trim trailing null lanes to keep width tight.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) { lanes = lanes.slice(0, -1); laneColor = laneColor.slice(0, -1) }
  }
  return rows
}

