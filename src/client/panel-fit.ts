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
 * Device-screen shorter edge (px) at or below which the device counts as a
 * phone: both hosts drill in, and the sidebar never takes the stacked
 * arrangement. Keyed on the SCREEN, not the window or the panel box — a phone
 * stays drill-in after rotating or after a split narrows the panel, while a
 * desktop keeps stacked even when its window is squeezed to sidebar width.
 * 640 sits above the largest phones (430 CSS px portrait, ~930x430 landscape →
 * shorter edge 430) and below tablet short edges (768), so tablets count as
 * desktop and keep stacked.
 */
export const PHONE_SCREEN_BP = 640

/**
 * Whether a device counts as a phone: a phone-sized screen driven by a coarse
 * pointer. `screen` is reported in CSS pixels, so its shorter edge shrinks as
 * the OS display scale grows — a 1366×768 laptop at 125% reports 614 and would
 * read as a phone on size alone. The pointer half is what separates them: a
 * desktop's primary pointer stays fine even when the machine has a touchscreen.
 */
export function isPhoneScreen(screen: { readonly width: number; readonly height: number }, coarsePointer: boolean): boolean {
  if (!coarsePointer) return false
  const shortEdge = Math.min(screen.width, screen.height)
  return shortEdge > 0 && shortEdge <= PHONE_SCREEN_BP
}

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
  /** The DEVICE is a phone (phone-sized screen + coarse pointer — see
   * `isPhoneScreen`). Measured on the device, not the panel box: a phone never
   * takes the stacked arrangement no matter how the panel is sized, while a
   * desktop keeps it even after its window is squeezed. Tablets clear the
   * screen bar and count as desktop. */
  readonly phone?: boolean
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
 * phone's treatment — short tab labels and no font stepper — and the overview's
 * branch column leaves the top band for a drawer over the history (collapsed by
 * default; OverviewTab reads it as `tight`). The full zh
 * labels (Git 总览 / 变更记录 / 文件浏览) plus the stepper need ~360px of
 * row before the cells read as words; flex compresses below that without any
 * overflow signal (the row looks crushed, not clipped). 380 sits above the
 * sidebar's minimum (a ~300–340px column must land inside) and below the
 * common 420 default, which keeps the full bar.
 */
export const STACKED_TIGHT_BP = 380

/**
 * Status-bar width (px) at or below which the repository link makes way for the
 * sync state. The bar lives in the overview's left column, which is 200px at
 * its default (user-resizable down to 130) and `clamp(120px, 38%, 180px)` in the
 * stacked band — so the layout tier only approximates the room the row really
 * has, and the 145–215 band is where the state label used to be squeezed to
 * "未跟…". Measured on the bar itself, not inferred from the panel.
 *
 * The row's own numbers, at the platform's 11px label font: padding 16, repo
 * link 24, the three 6–8px gaps, the 24px check button and a 56px action label
 * add up to ~140px of chrome. Below 175 the link's 32px (24 + gap) is what the
 * state glyph needs; at 180 the row still holds both.
 */
export const STATUSBAR_REPO_BP = 175

/**
 * Status-bar width (px) at or below which pull/push/publish drop their label
 * and keep the icon (the tooltip and the accessible name still say the word —
 * the check button has always been icon-only for the same reason). Below this
 * even the glyph row needs the 32px the labels take: a 130px column leaves 54px
 * for the state instead of 22.
 */
export const STATUSBAR_ACTION_BP = 150

/** How the panel arranges its panes: see `panelMode`. */
export type PanelMode = 'wide' | 'stacked' | 'compact'

/**
 * The three layout modes and the gate that separates them.
 *
 * - `wide`: room above COMPACT_BP — the full three-column layout. On a sidebar
 *   that bar is raised to SIDEBAR_WIDE_BP: below it a tall sidebar stays
 *   stacked, because three columns only become comfortable wider than that.
 * - `stacked`: mounted in the right sidebar on a DESKTOP-sized screen and
 *   narrow — panes keep their side-by-side order in a top band and stack the
 *   third pane below, spending the sidebar's PC height instead of drilling. A
 *   phone never lands here on either host: the two bands and their resizers are
 *   a desktop arrangement. The bar is the device, not the panel box, so a phone
 *   stays out of it however the panel is sized — but its width still splits
 *   `compact` from `wide` like any other host (a landscape phone whose sidebar
 *   box clears COMPACT_BP genuinely has room for three columns).
 * - `compact`: narrow and otherwise — the single-column drill-in. A desktop
 *   sidebar takes it only when both axes are scarce.
 *
 * The host gate keeps every conversation-mounted panel on today's behavior
 * (a split squeezed below COMPACT_BP drills exactly as before). On a desktop
 * sidebar, drill-in is the both-axes case only (≤ COMPACT_BP × ≤ SHORT_BP):
 * merely narrow stacks, and 621–760 stacks even when short — past COMPACT_BP
 * the sidebar is no longer the narrow column drill-in is for, and the two-band
 * split absorbs a short window (the bands share the height). Width 0 (not yet
 * measured) reads as stacked on a desktop sidebar, so the first paint never
 * flashes the three-column layout.
 */
export function panelMode(layout: PanelLayout, host: 'conversation' | 'sidebar'): PanelMode {
  if (host === 'sidebar' && layout.phone !== true) {
    if (layout.compact) return layout.short ? 'compact' : 'stacked'
    return layout.width > SIDEBAR_WIDE_BP ? 'wide' : 'stacked'
  }
  // An unmeasured phone panel (0×0: `keepMounted` panes stay mounted at zero
  // size while another sidebar tab is selected) drills in rather than flashing
  // the three desktop columns.
  if (layout.phone === true && layout.width === 0) return 'compact'
  return layout.compact ? 'compact' : 'wide'
}
