/**
 * Image-zoom math. A Mac trackpad pinch reaches the page as a ctrl+wheel
 * event (Chromium, Firefox, Safari ≥15) with browser-specific delta units, or
 * as Safari's proprietary gesture events; these helpers normalize that input,
 * turn it into a scale factor, and keep the point under the cursor fixed while
 * the native scroll container resizes. Mouse drag-to-pan shares the module: its
 * press/drag threshold and the content-follows-pointer offset conversion live
 * here as well. Pure functions — unit-tested through lib/testkit.mjs.
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
  readonly deltaY: number
  readonly deltaMode: number
}

/**
 * Normalize a wheel event's vertical delta: scale line/page modes into pixels
 * and clamp it, so one oversized tick zooms in a bounded step instead of
 * teleporting.
 */
export function normalizeWheel(e: WheelLike): number {
  const mul = e.deltaMode === DELTA_MODE_LINE ? LINE_TO_PX : e.deltaMode === DELTA_MODE_PAGE ? PAGE_TO_PX : 1
  return Math.sign(e.deltaY) * Math.min(DELTA_CLAMP, Math.abs(e.deltaY * mul))
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

/** Pointer travel (px) that turns a press into a drag instead of a click. */
export const DRAG_THRESHOLD = 3

/**
 * A press counts as a drag once the pointer travels past DRAG_THRESHOLD.
 * Squared comparison, so no hypot on every pointermove.
 */
export function isDragGesture(dx: number, dy: number): boolean {
  return dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD
}

/**
 * Scroll offsets for a mouse drag: the content follows the pointer, so a
 * rightward / downward drag decreases the offsets. Out-of-range values are
 * clamped by the scroll container itself.
 */
export function panScroll(left: number, top: number, dx: number, dy: number): { left: number; top: number } {
  return { left: left - dx, top: top - dy }
}
