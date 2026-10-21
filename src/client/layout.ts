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
import { COMPACT_BP, SHORT_BP, type PanelLayout } from './panel-fit.js'

const UNSQUEEZED: PanelLayout = { compact: false, short: false, width: 0 }

/** Measure the panel box; both flags stay false (and width 0) until measured. */
export function usePanelLayout(el: HTMLElement | null): PanelLayout {
  const [layout, setLayout] = useState<PanelLayout>(UNSQUEEZED)
  useLayoutEffect(() => {
    if (el === null || typeof ResizeObserver === 'undefined') return
    // A collapsed panel (0 wide or tall) has no room in that axis and reports
    // unsqueezed, so a transient 0 during mount cannot fold the editor before
    // the first real layout.
    const measure = (): void => setLayout((prev) => {
      const width = el.clientWidth
      const height = el.clientHeight
      const next: PanelLayout = {
        compact: width > 0 && width <= COMPACT_BP,
        short: height > 0 && height <= SHORT_BP,
        width,
      }
      return prev.compact === next.compact && prev.short === next.short && prev.width === next.width ? prev : next
    })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return layout
}
