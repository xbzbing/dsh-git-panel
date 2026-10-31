/**
 * Panel layout hook: observe the panel's own box and report the two container
 * facts the UI adapts to. The breakpoints and how they combine live in
 * `panel-fit.ts`; this module is only the measurement adapter.
 *
 * Width drives the layout mode: at or below COMPACT_BP the three-column layout
 * collapses to the single-column, drill-in one used on phones and narrow
 * splits, and it recovers as soon as the panel widens (a phone turned
 * landscape, a sidebar closing). On a sidebar the flip back to three columns
 * is delayed to SIDEBAR_WIDE_BP — the mode policy lives in `panel-fit.ts`;
 * the raw width rides along because that threshold needs the number itself.
 *
 * Height drives nothing on its own — it only becomes interesting together with
 * width (see `isCramped`). A desktop panel squeezed by a sidebar, or a large
 * phone, is narrow yet tall: it keeps the full commit editor and the change
 * timestamps, because squeezing the column must not cost content the screen can
 * afford.
 *
 * The breakpoints are container measures, not viewport ones, so a right sidebar
 * that squeezes the panel benefits too. 620 matches GitPill's COMPACT_WIDTH
 * value (the two observe different elements, so only the threshold — not the
 * exact boundary pixel — is shared).
 *
 * Uses useLayoutEffect so the first measurement commits before the first paint:
 * a phone mounting at 390px never flashes the three-column layout for a frame.
 * If ResizeObserver is unavailable the panel stays wide and unsqueezed
 * (single-column drill-in and the height-saving folds are lost, but nothing
 * breaks) — all modern engines ship it.
 */
import { useLayoutEffect, useState } from 'react'
import { COMPACT_BP, isPhoneScreen, SHORT_BP, type PanelLayout } from './panel-fit.js'

const UNSQUEEZED: PanelLayout = { compact: false, short: false, width: 0 }

/**
 * Whether this DEVICE is a phone: a phone-sized screen driven by a coarse
 * pointer. Read from `screen`, not the window, so squeezing a desktop window to
 * sidebar width does not turn it into a phone (and a phone stays one after
 * rotating). The pointer half keeps a scaled desktop out: its screen short edge
 * is reported in CSS pixels and a 1366×768 laptop at 125% reads 614.
 */
function readPhone(): boolean {
  if (typeof window === 'undefined' || typeof window.screen === 'undefined') return false
  // No matchMedia (older engines, test stubs): fall back to the screen size
  // alone, which is the behavior a device without the query already had.
  const coarse = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)').matches : true
  return isPhoneScreen({ width: window.screen.width || 0, height: window.screen.height || 0 }, coarse)
}

/** Measure the panel box; both flags stay false (and width 0) until measured. */
export function usePanelLayout(el: HTMLElement | null): PanelLayout {
  const [layout, setLayout] = useState<PanelLayout>(UNSQUEEZED)
  // The screen fact is independent of the panel box; orientation changes can
  // swap the screen's width/height, so re-read it on resize.
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    const apply = (): void => setLayout((prev) => {
      const phone = readPhone()
      return prev.phone === phone ? prev : { ...prev, phone }
    })
    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
    }
  }, [])
  useLayoutEffect(() => {
    if (el === null || typeof ResizeObserver === 'undefined') return
    // A collapsed panel (0 wide or tall) has no room in that axis and reports
    // unsqueezed, so a transient 0 during mount cannot fold the editor before
    // the first real layout.
    const measure = (): void => setLayout((prev) => {
      // Quantized: a sidebar drag reports a new width on every pixel, and each
      // one re-renders the whole panel (three tabs, one shared tree). Every
      // consumer compares this value against breakpoints that are tens of
      // pixels apart, so an 8 px bucket changes no decision while cutting the
      // render count by an order of magnitude.
      const width = Math.round(el.clientWidth / 8) * 8
      const height = el.clientHeight
      const next: PanelLayout = {
        compact: width > 0 && width <= COMPACT_BP,
        short: height > 0 && height <= SHORT_BP,
        width,
        // Carried through: the box measure must not erase the screen fact.
        phone: prev.phone ?? readPhone(),
      }
      return prev.compact === next.compact && prev.short === next.short
        && prev.width === next.width && prev.phone === next.phone ? prev : next
    })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return layout
}
