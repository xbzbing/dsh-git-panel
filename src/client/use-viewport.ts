/**
 * Scroll-container viewport tracker for row virtualization.
 *
 * A callback ref attaches a scroll listener + ResizeObserver that keep the
 * container's top offset and client height current, and re-attaches them if the
 * element remounts (e.g. a compact-layout pane swap unmounts and remounts the
 * scroller). The window math lives in `virtual-list.ts`; this is only the React
 * glue, shared by every virtualized list so the pattern has one home.
 */
import { useCallback, useRef, useState } from 'react'

export interface ViewportRect {
  readonly top: number
  readonly height: number
}

export interface ViewportTracker {
  /** Callback ref to put on the scroll container. */
  readonly setEl: (el: HTMLElement | null) => void
  /** Live viewport rect (updates on scroll / resize). */
  readonly viewport: ViewportRect
  /** The current element, for callers that also need direct access. */
  readonly elRef: { current: HTMLElement | null }
}

export function useViewportTracker(): ViewportTracker {
  const [viewport, setViewport] = useState<ViewportRect>({ top: 0, height: 0 })
  const elRef = useRef<HTMLElement | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const setEl = useCallback((el: HTMLElement | null) => {
    if (cleanup.current !== null) { cleanup.current(); cleanup.current = null }
    elRef.current = el
    if (el === null) return
    // Returning `prev` when nothing changed skips the re-render a ResizeObserver
    // fire at identical dimensions would otherwise force.
    const sync = (): void => setViewport((prev) => {
      const top = el.scrollTop
      const height = el.clientHeight
      return prev.top === top && prev.height === height ? prev : { top, height }
    })
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    ro?.observe(el)
    cleanup.current = () => { el.removeEventListener('scroll', sync); ro?.disconnect() }
  }, [])
  return { setEl, viewport, elRef }
}
