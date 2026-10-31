/**
 * The travelling fill behind a list's active row.
 *
 * A list that paints the active row's background repaints two rows on every
 * switch. Drawing that fill once, behind the rows, and moving it turns the
 * repaint into a movement — the highlight travels to the row that was picked.
 *
 * The block is measured from the active row after every render that can move
 * it (a switch, a reorder, a fold) and never while the list is folded: a folded
 * list reports zero boxes, so the last position is kept and remeasured on the
 * way out. The slider is a child of the scrolling element itself, which is why
 * it scrolls with the rows and needs no scroll listener.
 *
 * Resizing is watched at two levels: the scroller (it changes size when the
 * panel is resized) and the active row itself (its height can change on its own
 * — a zoom step, a theme with taller rows — while the scroller keeps its box).
 * Callers put every value that moves the active row into `deps`; each entry
 * must be a stable value (state, a memoized list), since the effect re-measures
 * whenever one of them changes identity.
 *
 * Rects come back in visual pixels, while the slider's own offsets are laid
 * out in the host's CSS pixels: under the panel's CSS `zoom` (the font step)
 * the two differ, so measurements are divided by the host's effective zoom.
 *
 * Transitions stay off for the first frame the fill is shown — after mount, and
 * after the active row comes back from outside the DOM (a folded section, a
 * virtual window that slid past it): gliding in from a stale position would
 * read as a glitch, not as a movement. While the row is absent the last box is
 * kept and only hidden.
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'

interface RowSliderOptions {
  /** Selector of the active row, searched inside the scrolled node. */
  readonly activeSelector: string
  /** Values the active row's position depends on: a switch, a reorder, a fold. */
  readonly deps: readonly unknown[]
  /** Folded lists report zero boxes; the last position is kept until they unfold. */
  readonly collapsed?: boolean
  /** The scrolled node, when the caller already owns a ref to it (the history
   * list needs its own for paging). Omitted, the hook creates one. */
  readonly host?: RefObject<HTMLDivElement | null>
}

export interface RowSliderHandle {
  /** Attach to the scrolling element; it must be positioned (static is fine:
   * the slider is measured from its border box). */
  readonly ref: RefObject<HTMLDivElement | null>
  /** Ref callback for the same node, for lists that already own a ref of their
   * own: call this alongside theirs instead of passing `ref`. */
  readonly attach: (node: HTMLDivElement | null) => void
  readonly slider: JSX.Element
}

export function useRowSlider({ activeSelector, deps, collapsed = false, host: shared }: RowSliderOptions): RowSliderHandle {
  const own = useRef<HTMLDivElement | null>(null)
  const ref = shared ?? own
  // Ref types hand `current` out as readonly; the node this ref points at is
  // the hook's own, so it writes through a mutable view of it.
  const attach = useCallback((node: HTMLDivElement | null): void => {
    (ref as { current: HTMLDivElement | null }).current = node
  }, [ref])
  const [box, setBox] = useState<{ readonly top: number; readonly height: number } | null>(null)
  const [shown, setShown] = useState(false)
  const [settled, setSettled] = useState(false)
  const shownRef = useRef(false)

  const observed = useRef<Element | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)

  const measure = useCallback((): void => {
    const host = ref.current
    const active = host === null ? null : host.querySelector(activeSelector)
    // Follow the row the fill currently sits behind: its own box can change
    // while the scroller keeps its size, and the fill would keep the old height.
    const observer = observerRef.current
    if (observer !== null && observed.current !== active) {
      if (observed.current !== null) observer.unobserve(observed.current)
      if (active !== null) observer.observe(active)
      observed.current = active
    }
    if (host === null || collapsed) return
    if (active === null) {
      shownRef.current = false
      setShown(false)
      return
    }
    const base = host.getBoundingClientRect()
    const rect = active.getBoundingClientRect()
    const zoom = zoomOf(host, base.height)
    // Rects are viewport-relative; the slider lives in the scrolled content, so
    // add back what the container has scrolled away above it. clientTop and
    // scrollTop are already in the host's CSS pixels.
    const top = (rect.top - base.top) / zoom - host.clientTop + host.scrollTop
    const height = rect.height / zoom
    if (!shownRef.current) {
      shownRef.current = true
      setShown(true)
      setSettled(false)
    }
    setBox((prev) => (prev !== null && prev.top === top && prev.height === height ? prev : { top, height }))
  }, [activeSelector, collapsed, ref])

  // The dependency list is the caller's, by design: only the caller knows which
  // values move the active row.
  useLayoutEffect(measure, [...deps, measure])

  useEffect(() => {
    if (settled) return undefined
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [settled])

  useEffect(() => {
    const host = ref.current
    if (host === null || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => measure())
    observer.observe(host)
    const active = host.querySelector(activeSelector)
    if (active !== null) {
      observer.observe(active)
      observed.current = active
    }
    observerRef.current = observer
    return () => {
      observer.disconnect()
      observerRef.current = null
      observed.current = null
    }
  }, [activeSelector, measure, ref])

  const slider = h('span', {
    className: 'gp-rowslider'
      + (box === null || !shown ? ' gp-rowslider--off' : '')
      + (settled ? ' gp-rowslider--settled' : ''),
    style: box === null ? undefined : { transform: `translateY(${box.top}px)`, height: `${box.height}px` },
    'aria-hidden': 'true',
  })
  return { ref, attach, slider }
}

/** The effective CSS zoom on `host`: `currentCSSZoom` where the engine has it,
 * otherwise the ratio of its visual height to its layout height. */
function zoomOf(host: HTMLElement, visualHeight: number): number {
  const reported = (host as { currentCSSZoom?: number }).currentCSSZoom
  if (typeof reported === 'number' && reported > 0) return reported
  return host.offsetHeight > 0 && visualHeight > 0 ? visualHeight / host.offsetHeight : 1
}
