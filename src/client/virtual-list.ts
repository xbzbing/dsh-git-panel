/**
 * Fixed-height-per-row virtual-list window math (pure, no React).
 *
 * A list of items, each with a known height, is laid out at ascending top
 * offsets; only the items overlapping the viewport (plus an overscan margin)
 * need to mount. Kept pure so the window arithmetic is unit-tested directly.
 */

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
