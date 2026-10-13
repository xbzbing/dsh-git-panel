/**
 * Image-zoom math. A Mac trackpad pinch reaches the page as a ctrl+wheel
 * event (Chromium, Firefox, Safari ≥15) with browser-specific delta units, or
 * as Safari's proprietary gesture events; these helpers normalize that input,
 * turn it into a scale factor, and keep the point under the cursor fixed while
 * the native scroll container resizes. Pure functions — unit-tested through
 * lib/testkit.mjs.
 */

/** WheelEvent.DOM_DELTA_LINE / DOM_DELTA_PAGE (pixel mode = 0). */
const DELTA_MODE_LINE = 1
const DELTA_MODE_PAGE = 2
/** Convert line/page wheel deltas into the shared pixel-ish unit. */
const LINE_TO_PX = 8
const PAGE_TO_PX = 24
/** Pinch deltas read as percent changes; cap them so a page tick can't teleport the zoom. */
export const DELTA_CLAMP = 24
/** Pinch strength multiplier (eyeballed 1.5–3 across browsers; 2 feels native). */
const WHEEL_SCALE_SPEEDUP = 2

export interface WheelLike {
  readonly deltaX: number
  readonly deltaY: number
  readonly deltaMode: number
  readonly shiftKey: boolean
}

/**
 * Normalize a wheel event to `[dx, dy]`: swap a shift-only vertical delta into
 * the horizontal axis (Chrome encodes it that way), scale line/page modes into
 * pixels, and clamp `dy` so oversized ticks zoom in bounded steps.
 */
export function normalizeWheel(e: WheelLike): [number, number] {
  let dx = e.deltaX
  let dy = e.deltaY
  if (dx === 0 && e.shiftKey && dy !== 0) { dx = dy; dy = 0 }
  const mul = e.deltaMode === DELTA_MODE_LINE ? LINE_TO_PX : e.deltaMode === DELTA_MODE_PAGE ? PAGE_TO_PX : 1
  dx *= mul
  dy = Math.sign(dy) * Math.min(DELTA_CLAMP, Math.abs(dy * mul))
  return [dx, dy]
}

/**
 * Scale factor for one pinch-encoded wheel delta (`dy` ≤ DELTA_CLAMP): negative
 * zooms in, positive zooms out. The positive branch is inverted so zooming out
 * by N undoes zooming in by N instead of drifting — browsers encode the two
 * directions asymmetrically.
 */
export function wheelZoomFactor(deltaY: number): number {
  const dy = Math.sign(deltaY) * Math.min(DELTA_CLAMP, Math.abs(deltaY))
  return dy <= 0 ? 1 - (WHEEL_SCALE_SPEEDUP * dy) / 100 : 1 / (1 + (WHEEL_SCALE_SPEEDUP * dy) / 100)
}

/** Zoom range relative to the image's natural size, and the toolbar step. */
export const SCALE_MIN = 0.1
export const SCALE_MAX = 8
export const ZOOM_STEP = 1.25

/** Clamp a requested scale into the valid range (non-finite input falls back to 1). */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, scale))
}

/**
 * Scroll offset that keeps the content point under the cursor fixed while the
 * content resizes by `ratio`: the point sits at `(scroll + cursor)` in old
 * rendered pixels, so after the resize it lands at `(scroll + cursor) * ratio`,
 * and subtracting `cursor` re-places it under the same screen point. The
 * browser clamps the result into the scrollable range.
 */
export function anchoredScroll(prevScroll: number, cursor: number, ratio: number): number {
  return (prevScroll + cursor) * ratio - cursor
}
