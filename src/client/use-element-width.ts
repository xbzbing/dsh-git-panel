/**
 * Client width of a scrolling element, for layouts that have to decide how many
 * columns fit.
 *
 * The overview's history column is flexible: the same panel serves a phone, a
 * squeezed sidebar and a wide desktop, so the row's column set is chosen from
 * the list's own width rather than the panel's tier. A ResizeObserver keeps it
 * current; the first render returns 0, which the caller treats as "not
 * measured yet".
 */
import { useCallback, useRef, useState } from 'react'

export interface ElementWidth {
  /** Callback ref for the measured element. */
  readonly setEl: (el: HTMLElement | null) => void
  readonly width: number
}

export function useElementWidth(): ElementWidth {
  const [width, setWidth] = useState(0)
  const elRef = useRef<HTMLElement | null>(null)
  const observer = useRef<ResizeObserver | null>(null)

  const setEl = useCallback((el: HTMLElement | null): void => {
    if (elRef.current === el) return
    observer.current?.disconnect()
    observer.current = null
    elRef.current = el
    if (el === null) { setWidth(0); return }
    const sync = (): void => setWidth((prev) => (prev === el.clientWidth ? prev : el.clientWidth))
    sync()
    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(sync)
    observer.current.observe(el)
  }, [])

  return { setEl, width }
}
