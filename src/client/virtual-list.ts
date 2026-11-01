/**
 * Fixed-height-per-row virtual-list window math (pure, no React).
 *
 * A list of items, each with a known height, is laid out at ascending top
 * offsets; only the items overlapping the viewport (plus an overscan margin)
 * need to mount. Kept pure so the window arithmetic is unit-tested directly.
 */

/** Viewport height assumed before the first layout measurement, so the initial
 * paint mounts a bounded window instead of the whole list. */
export const VIEWPORT_FALLBACK = 600

/** Rows mounted beyond each edge of the window (scroll slack), in rows — each
 * list multiplies it by its own row height. One shared value keeps the lists
 * from drifting apart window by window. */
export const VOVERSCAN = 8

/** Ascending prefix-sum of item heights; `tops.length === heights.length + 1`. */
export function buildTops(heights: readonly number[]): number[] {
  const tops = new Array<number>(heights.length + 1)
  tops[0] = 0
  for (let i = 0; i < heights.length; i++) tops[i + 1] = tops[i]! + heights[i]!
  return tops
}

/**
 * Largest index `i` with `tops[i] <= y` (tops is ascending), clamped to
 * `[0, tops.length - 1]`. Used to find the first item at/above an offset.
 */
export function lowerBound(tops: readonly number[], y: number): number {
  let lo = 0
  let hi = tops.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (tops[mid]! <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * `[first, last)` item indices overlapping the viewport `[top, top + height]`,
 * padded by `overscanPx` on each side and clamped to the item count. `last` is
 * exclusive and never exceeds the number of items.
 */
export function windowRange(
  tops: readonly number[],
  top: number,
  height: number,
  overscanPx: number,
): { first: number; last: number } {
  const count = tops.length - 1
  if (count <= 0) return { first: 0, last: 0 }
  // lowerBound already clamps to >= 0, so no extra Math.max is needed.
  const first = lowerBound(tops, top - overscanPx)
  const last = Math.min(count, lowerBound(tops, top + height + overscanPx) + 1)
  return { first, last }
}

/**
 * Window to mount for an active Find match. Inside the current window the match
 * is already mounted, so only the overscan margin extends it; outside, SNAP onto
 * the match's neighbourhood instead of spanning the gap — a span would mount
 * every row between the viewport and the match in a single commit, which is the
 * very freeze virtualization exists to remove. `activeRow < 0` (no active match)
 * leaves the window as it is.
 */
export function findWindowRange(
  range: { first: number; last: number },
  activeRow: number,
  count: number,
  overscanRows: number,
): { first: number; last: number } {
  if (activeRow < 0) return range
  const inside = activeRow >= range.first && activeRow < range.last
  if (!inside) return { first: Math.max(0, activeRow - overscanRows), last: Math.min(count, activeRow + overscanRows) }
  return {
    first: Math.min(range.first, Math.max(0, activeRow - overscanRows)),
    last: Math.max(range.last, Math.min(count, activeRow + overscanRows)),
  }
}
