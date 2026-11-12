/**
 * Column set of the wide commit row.
 *
 * The overview's history column is flexible, so it can be narrower than the five
 * columns want — a sidebar, a wide branch column or a narrow window is enough.
 * Two invariants keep the row inside its own box at any width:
 *  - every track that is not the subject's `1fr` has a `minmax(0, …)` min, so the
 *    graph and the date can give way instead of pushing the row past its right
 *    edge (`.gp-graph-cell` clips the graph to whatever it gets);
 *  - the column set follows the measured width, shedding the author (in the
 *    detail pane and the hover card), then the hash (also there). The graph, the
 *    subject and the date are always present.
 *
 * The thresholds are comfort levels, not fit checks: below one, the subject
 * would read as a sliver, so the next tier's dropped column buys it back.
 *
 * Pure: the caller passes the measured width, so the choice is unit-testable and
 * the component keeps no layout arithmetic. See ADR-0033.
 */

/** Width of the hash track (7 abbreviated chars in the mono face). */
export const COMMIT_HASH_W = 72
/** Width of the author track; the widest column that carries no unique data. */
export const COMMIT_AUTHOR_W = 120
/** Grid gap between tracks. */
export const COMMIT_GAP = 8
/** Row padding: 10px on each side. */
export const COMMIT_ROW_PAD = 20
/** Subject width the row wants before it drops a column instead. */
export const COMMIT_SUBJECT_COMFORT = 100

export interface CommitColumns {
  /** `grid-template-columns` for the row. */
  readonly template: string
  readonly showHash: boolean
  readonly showAuthor: boolean
}

/** Padding plus the gaps between `count` tracks. */
function chrome(count: number): number {
  return (count - 1) * COMMIT_GAP + COMMIT_ROW_PAD
}

/**
 * @param available - measured client width of the history list
 * @param graphW - width the commit graph wants (lanes × lane width)
 * @param timeW - measured width of the relative-time column (time-column.ts)
 */
export function commitColumns(available: number, graphW: number, timeW: number): CommitColumns {
  // `minmax(0, …)` on the graph: a repo whose first page keeps a dozen lanes
  // open may want more room than the column has. Shrinking it (and clipping the
  // SVG) is what lets the date stay inside the row.
  const graph = `minmax(0,${graphW}px)`
  const five = `${graph} minmax(0,1fr) ${COMMIT_HASH_W}px ${COMMIT_AUTHOR_W}px ${timeW}px`
  const four = `${graph} minmax(0,1fr) ${COMMIT_HASH_W}px ${timeW}px`
  const three = `${graph} minmax(0,1fr) ${timeW}px`
  // A list that has not been measured yet (first paint, a hidden tab) keeps the
  // full set: every width degrades from it.
  if (!(available > 0)) return { template: five, showHash: true, showAuthor: true }
  if (available >= graphW + COMMIT_SUBJECT_COMFORT + COMMIT_HASH_W + COMMIT_AUTHOR_W + timeW + chrome(5)) {
    return { template: five, showHash: true, showAuthor: true }
  }
  if (available >= graphW + COMMIT_SUBJECT_COMFORT + COMMIT_HASH_W + timeW + chrome(4)) {
    return { template: four, showHash: true, showAuthor: false }
  }
  return { template: three, showHash: false, showAuthor: false }
}
