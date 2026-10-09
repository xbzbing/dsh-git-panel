/**
 * Panel layout mode: observe the panel's own width and report whether it should
 * switch to the compact (single-column, drill-in) layout used on phones and
 * narrow splits. Width-driven via ResizeObserver (the GitPill.useCompactMarker
 * pattern), so the panel expands back to the three-column layout as soon as it
 * widens — a phone turned landscape, or a sidebar closing, recovers the full UI.
 *
 * The breakpoint is a container width, not the viewport, so a right sidebar that
 * squeezes the panel benefits too, and an iPad in portrait (768) keeps the wide
 * layout. 620 is aligned with GitPill's COMPACT_WIDTH so the two markers agree.
 */
import { useEffect, useState } from 'react'

/** Panel width (px) at or below which the compact single-column layout kicks in. */
export const COMPACT_BP = 620

/** True once the observed element is measured and at or below COMPACT_BP wide. */
export function usePanelLayout(el: HTMLElement | null): boolean {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    if (el === null || typeof ResizeObserver === 'undefined') return
    const measure = (): void => setCompact(el.clientWidth > 0 && el.clientWidth <= COMPACT_BP)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return compact
}
