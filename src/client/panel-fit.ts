/**
 * Panel fit policy: the two container breakpoints and how they combine.
 *
 * Pure on purpose — no React, no platform — so the rule that decides whether
 * the panel may spend vertical space is unit-testable on its own, and the hook
 * that measures the box stays a thin adapter.
 */

/** Panel width (px) at or below which the compact single-column layout kicks in. */
export const COMPACT_BP = 620

/**
 * Panel height (px) at or below which vertical room is scarce. Only meaningful
 * together with `compact`: the panel must be narrow *and* short before content
 * is traded for room. 520 catches small phones and short windows while leaving
 * a typical portrait phone panel (~690) and a laptop column (~660) their full
 * editor and timestamps.
 */
export const SHORT_BP = 520

export interface PanelLayout {
  /** The panel is at or below COMPACT_BP wide. */
  readonly compact: boolean
  /** The panel is at or below SHORT_BP tall. */
  readonly short: boolean
  /** Raw measured width in px (0 until the first measurement). The sidebar's
   * stacked→wide switch sits ABOVE COMPACT_BP and needs the number itself —
   * see `SIDEBAR_WIDE_BP`. */
  readonly width: number
}

/**
 * Both axes are scarce at once. This is the single gate for features that trade
 * a control or a row for room (the commit editor's fold, the change
 * timestamps): a wide screen whose column a sidebar narrowed has the height to
 * spare and keeps them, and so does a large phone.
 */
export function isCramped(layout: PanelLayout): boolean {
  return layout.compact && layout.short
}

/**
 * Sidebar width (px) strictly above which the right sidebar abandons the
 * stacked layout for the full three-column one. COMPACT_BP (620) only marks
 * where three columns become *possible*; at 621–760 they are possible but
 * cramped — the left branch column (~200) plus the detail column (~340) would
 * leave the history a token width. Conversation panels are unaffected: they
 * flip at COMPACT_BP as always.
 */
export const SIDEBAR_WIDE_BP = 760

/**
 * Stacked sidebar width (px) at or below which the tab bar drops to the
 * phone's treatment — short tab labels and no font stepper. The full zh
 * labels (Git 总览 / 变更记录 / 文件浏览) plus the stepper need ~360px of
 * row before the cells read as words; flex compresses below that without any
 * overflow signal (the row looks crushed, not clipped). 380 sits above the
 * sidebar's minimum (a ~300–340px column must land inside) and below the
 * common 420 default, which keeps the full bar.
 */
export const STACKED_TIGHT_BP = 380

/** How the panel arranges its panes: see `panelMode`. */
export type PanelMode = 'wide' | 'stacked' | 'compact'

/**
 * The three layout modes and the gate that separates them.
 *
 * - `wide`: room above COMPACT_BP — the full three-column layout. On a sidebar
 *   that bar is raised to SIDEBAR_WIDE_BP: below it a tall sidebar stays
 *   stacked, because three columns only become comfortable wider than that.
 * - `stacked`: mounted in the right sidebar and narrow — panes keep their
 *   side-by-side order in a top band and stack the third pane below,
 *   spending the sidebar's PC height instead of drilling.
 * - `compact`: narrow and otherwise — the single-column drill-in. Phones stay
 *   here even when tall (a portrait phone panel is not short): the stacked
 *   arrangement is a PC-pointer interaction, while drill-in gives a touch
 *   device the whole width per step.
 *
 * The host gate keeps every conversation-mounted panel on today's behavior
 * (a split squeezed below COMPACT_BP drills exactly as before). On a sidebar,
 * drill-in is the both-axes case only (≤ COMPACT_BP × ≤ SHORT_BP): merely
 * narrow stacks, and 621–760 stacks even when short — past COMPACT_BP the
 * sidebar is no longer the narrow column drill-in is for, and the two-band
 * split absorbs a short window (the bands share the height). Width 0 (not yet
 * measured) reads as stacked on a sidebar, so the first paint never flashes
 * the three-column layout.
 */
export function panelMode(layout: PanelLayout, host: 'conversation' | 'sidebar'): PanelMode {
  if (host === 'sidebar') {
    if (layout.compact) return layout.short ? 'compact' : 'stacked'
    return layout.width > SIDEBAR_WIDE_BP ? 'wide' : 'stacked'
  }
  return layout.compact ? 'compact' : 'wide'
}
