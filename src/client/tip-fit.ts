/**
 * Horizontal fitting for the shared hover tip.
 *
 * The tip is portaled to `document.body`, so without an explicit bound it is
 * clamped to the viewport only. A sidebar is narrower than the window and the
 * bubble would hang over the pane beside it. The panel that owns the control is
 * the real boundary: the bubble stays inside it, and a control near its right
 * edge shifts the bubble left instead of overflowing.
 */

export interface TipBounds {
  readonly left: number
  readonly right: number
}

/** Narrowest usable bubble; a panel below this cannot fit one anyway. */
export const TIP_MIN_WIDTH = 80
/** Gap kept between the bubble and the panel edge. */
export const TIP_MARGIN = 8

/** Widest a tip may be inside `bounds`, keeping the margin on both sides. */
export function fitTipWidth(preferred: number, bounds: TipBounds): number {
  const room = bounds.right - bounds.left - TIP_MARGIN * 2
  return Math.max(TIP_MIN_WIDTH, Math.min(preferred, room))
}

/**
 * Left anchor for a tip of `width`, kept inside `bounds`. A centred tip carries
 * its centre in `left` (the compact layout); every other tip carries its left
 * edge.
 */
export function fitTipLeft(left: number, width: number, bounds: TipBounds, center: boolean): number {
  const minLeft = center ? bounds.left + TIP_MARGIN + width / 2 : bounds.left + TIP_MARGIN
  const maxLeft = center ? bounds.right - TIP_MARGIN - width / 2 : bounds.right - TIP_MARGIN - width
  return Math.min(Math.max(left, minLeft), Math.max(minLeft, maxLeft))
}
