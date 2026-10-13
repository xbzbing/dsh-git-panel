/**
 * Zoomable image: native-scroll pan + pinch zoom + a floating zoom bar +
 * click-to-fullscreen and double-click ↔ 100%.
 *
 * Pinch input: Chromium/Firefox/Safari≥15 deliver the trackpad pinch as a
 * ctrl+wheel event (must be preventDefault-ed or the whole page zooms); older
 * Safari uses the proprietary gesturestart/gesturechange events, which carry a
 * precomputed cumulative scale. Listeners are registered once with
 * { passive:false } — React's synthetic onWheel is passive and cannot cancel.
 *
 * Rendering follows option A: the image is sized explicitly against its
 * natural dimensions and the viewport keeps native scrolling, so panning,
 * scrollbars, and overscroll containment stay browser-native. Flex centering
 * uses margin:auto — justify-content:center would make the overflow side of an
 * oversized image unreachable.
 *
 * The fullscreen lightbox mirrors the platform ImageLightbox contract
 * (body portal, Esc / backdrop / close control, focus restore) but adds zoom,
 * which the official component does not expose.
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { GitKey } from './locales'
import { CloseIcon } from './icons'
import { anchoredScroll, clampScale, isDragGesture, normalizeWheel, panScroll, wheelZoomFactor, ZOOM_STEP } from './zoom.js'

type T = (key: GitKey, params?: Record<string, string | number>) => string

/** 'fit' = constrain to the viewport (CSS-driven); a number = scale vs natural size. */
type ZoomMode = 'fit' | number

/** A double click this soon after a pan is the pan's own click plus a new press. */
const POST_DRAG_CLICK_GUARD_MS = 300

/** Minimal shape of Safari's non-standard GestureEvent. */
interface GestureLike {
  readonly scale: number
  readonly clientX: number
  readonly clientY: number
  readonly cancelable: boolean
  preventDefault(): void
}

interface ZoomableImageProps {
  readonly src: string
  readonly alt: string
  readonly t: T
  /** Class for the scroll viewport; supplies background, padding, overflow. */
  readonly viewportClass: string
  /** Fullscreen control in the zoom bar; off inside the lightbox. */
  readonly fullscreen?: boolean
  /** Press on the viewport's empty area (lightbox backdrop press-to-close). */
  readonly onEmptyAreaMouseDown?: () => void
}

export function ZoomableImage({ src, alt, t, viewportClass, fullscreen = true, onEmptyAreaMouseDown }: ZoomableImageProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [mode, setMode] = useState<ZoomMode>('fit')
  const [fitPct, setFitPct] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  // Latest mode for the async readers (ResizeObserver, onLoad); synced in the
  // layout effect below, which also runs before either can observe a change.
  const modeRef = useRef<ZoomMode>('fit')
  // Scroll correction applied after the next layout: content point under the
  // cursor stays put while the image resizes by `ratio`.
  const anchorRef = useRef<{ x: number; y: number; ratio: number } | null>(null)
  // Safari gesture baseline: scale captured when the gesture started.
  const gestureRef = useRef<{ base: number; x: number; y: number } | null>(null)
  // Mouse drag-to-pan state; `pan` is false when the content cannot scroll, and
  // the press is then only tracked to tell a drag from a click.
  const dragRef = useRef<{ id: number; x: number; y: number; left: number; top: number; pan: boolean; moved: boolean } | null>(null)
  // When the last drag ended, so a double click right after a pan is ignored.
  const postDragRef = useRef(0)

  /** Current scale read from the DOM — always what is actually on screen. */
  const displayed = useCallback((): number | null => {
    const img = imgRef.current
    if (img === null || img.naturalWidth === 0 || img.clientWidth === 0) return null
    return img.clientWidth / img.naturalWidth
  }, [])

  /** Resize the image to `target` keeping the content under (clientX, clientY) fixed. */
  const zoomTo = useCallback((target: number, clientX: number, clientY: number): void => {
    const vp = scrollRef.current
    const img = imgRef.current
    if (vp === null || img === null || img.naturalWidth === 0 || img.clientWidth === 0) return
    const cur = img.clientWidth / img.naturalWidth
    const next = clampScale(target)
    if (next === cur) return
    const rect = vp.getBoundingClientRect()
    anchorRef.current = { x: clientX - rect.left, y: clientY - rect.top, ratio: next / cur }
    setMode(next)
  }, [])

  /** Toolbar step: zoom around the viewport center. */
  const step = useCallback((mul: number): void => {
    const vp = scrollRef.current
    const cur = displayed()
    if (vp === null || cur === null) return
    const rect = vp.getBoundingClientRect()
    zoomTo(cur * mul, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }, [displayed, zoomTo])

  const toActual = useCallback((): void => {
    const vp = scrollRef.current
    if (vp === null) return
    const rect = vp.getBoundingClientRect()
    zoomTo(1, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }, [zoomTo])

  const toFit = useCallback((): void => { setMode('fit') }, [])

  /** Re-read the rendered scale as the fit percentage — only valid in 'fit' mode. */
  const measureFit = useCallback((): void => {
    const img = imgRef.current
    if (img === null || img.naturalWidth === 0 || img.clientWidth === 0) return
    setFitPct(Math.round((img.clientWidth / img.naturalWidth) * 100))
  }, [])

  // Apply the pending scroll anchor once the resized layout is committed, and
  // refresh the fit percentage on every mode change (entering 'fit' after a
  // resize or a zoom must re-measure, never report the numeric scale).
  useLayoutEffect(() => {
    modeRef.current = mode
    if (mode === 'fit') measureFit()
    const a = anchorRef.current
    anchorRef.current = null
    const vp = scrollRef.current
    if (a === null || vp === null) return
    vp.scrollLeft = anchoredScroll(vp.scrollLeft, a.x, a.ratio)
    vp.scrollTop = anchoredScroll(vp.scrollTop, a.y, a.ratio)
  }, [mode, measureFit])

  // A new src is a new image. A caller may swap src in place (an ImageCompare
  // pane fed a new URL) where React reuses this instance, so drop the previous
  // zoom level and fit label instead of carrying them over.
  useEffect(() => {
    modeRef.current = 'fit'
    anchorRef.current = null
    gestureRef.current = null
    setMode('fit')
    setNat(null)
    setFitPct(null)
  }, [src])

  // One-time listeners on the wrapper (bubbling covers img + bar). Registered
  // with refs so handlers never need re-registering mid-gesture.
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return // plain wheel = native pan
      // Cancel first: even before the image is measurable, ctrl+wheel over our
      // own viewport must not zoom the whole page.
      if (e.cancelable) e.preventDefault()
      const img = imgRef.current
      if (img === null || !img.complete || img.naturalWidth === 0) return
      const cur = displayed()
      if (cur === null) return
      zoomTo(cur * wheelZoomFactor(normalizeWheel(e)), e.clientX, e.clientY)
    }

    // Older Safari pinch: e.scale is cumulative from gesturestart.
    const onGestureStart = (ev: Event): void => {
      const e = ev as unknown as GestureLike
      const cur = displayed()
      if (cur === null) return
      if (e.cancelable) e.preventDefault() // stop Safari's pinch-to-tab-overview
      gestureRef.current = { base: cur, x: e.clientX, y: e.clientY }
    }
    const onGestureChange = (ev: Event): void => {
      const e = ev as unknown as GestureLike
      const g = gestureRef.current
      if (g === null) return
      if (e.cancelable) e.preventDefault()
      zoomTo(g.base * e.scale, g.x, g.y)
    }
    const onGestureEnd = (): void => { gestureRef.current = null }

    root.addEventListener('wheel', onWheel, { passive: false })
    root.addEventListener('gesturestart', onGestureStart, { passive: false })
    root.addEventListener('gesturechange', onGestureChange, { passive: false })
    root.addEventListener('gestureend', onGestureEnd)
    return () => {
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('gesturestart', onGestureStart)
      root.removeEventListener('gesturechange', onGestureChange)
      root.removeEventListener('gestureend', onGestureEnd)
    }
  }, [displayed, zoomTo])

  // Mouse drag-to-pan: the native scroll container follows the pointer, so a
  // plain mouse (no trackpad, no horizontal wheel) can still reach every corner
  // of a zoomed image. Touch and pen keep their native inertial scrolling — only
  // a mouse press is taken over. Following the resizer's convention there is no
  // pointer capture: window listeners keep a fast pan alive past the viewport
  // edge, and the press target stays untouched (fullscreen opens from the bar).
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || e.pointerType !== 'mouse') return
    const vp = scrollRef.current
    if (vp === null) return
    // A press on the scrollbar is the browser's own drag, not a pan: the
    // offsets below clientWidth/Height are the scrollbar gutter.
    const { offsetX, offsetY } = e.nativeEvent
    if (e.target === vp && (offsetX >= vp.clientWidth || offsetY >= vp.clientHeight)) return
    dragRef.current = {
      id: e.pointerId, x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop,
      pan: vp.scrollWidth > vp.clientWidth || vp.scrollHeight > vp.clientHeight,
      moved: false,
    }
  }, [])

  useEffect(() => {
    const finish = (id: number): void => {
      const d = dragRef.current
      if (d === null || id !== d.id) return
      // Remember when the pan ended: the click it produces must not pair with a
      // following press into a double click that toggles the zoom level.
      if (d.moved) postDragRef.current = performance.now()
      dragRef.current = null
      setDragging(false)
    }
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current
      if (d === null || e.pointerId !== d.id) return
      // The button was released outside the window (or a system dialog ate the
      // pointerup): without this the viewport would keep panning on hover.
      if (e.buttons === 0) { finish(e.pointerId); return }
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved) {
        if (!isDragGesture(dx, dy)) return
        d.moved = true
        setDragging(true)
      }
      const vp = scrollRef.current
      if (vp === null || !d.pan) return
      const next = panScroll(d.left, d.top, dx, dy)
      vp.scrollLeft = next.left
      vp.scrollTop = next.top
    }
    const onUp = (e: PointerEvent): void => { finish(e.pointerId) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  // Keep the fit-percentage label honest while the viewport resizes — but only
  // in fit mode: while zoomed the rendered size is the numeric scale, which
  // must never leak into the fit label.
  useEffect(() => {
    const vp = scrollRef.current
    if (vp === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (modeRef.current !== 'fit') return
      measureFit()
    })
    ro.observe(vp)
    return () => ro.disconnect()
  }, [measureFit])

  const onLoaded = useCallback((): void => {
    const img = imgRef.current
    if (img === null) return
    setNat({ w: img.naturalWidth, h: img.naturalHeight })
    if (modeRef.current === 'fit') measureFit()
  }, [measureFit])

  // Double click toggles fit <-> 100%. Fullscreen opens from the zoom bar: an
  // inline single-click entry cannot coexist with this toggle (the lightbox
  // would open on the first click of every double click).
  const onDoubleClick = useCallback((): void => {
    if (performance.now() - postDragRef.current < POST_DRAG_CLICK_GUARD_MS) return
    if (mode === 'fit') toActual()
    else toFit()
  }, [mode, toActual, toFit])

  const closeLightbox = useCallback(() => { setOpen(false) }, [])

  const label = mode === 'fit'
    ? (fitPct !== null ? `${fitPct}%` : '—')
    : `${Math.round(mode * 100)}%`

  const imgStyle = (mode !== 'fit' && nat !== null)
    ? { width: `${nat.w * mode}px`, maxWidth: 'none', maxHeight: 'none' }
    : undefined

  const bar = nat !== null
    ? h('div', { key: 'bar', className: 'gp-zoom__bar', role: 'group', 'aria-label': t('files.zoomBar') }, [
      h('button', { key: 'out', type: 'button', className: 'gp-zoom__btn', 'aria-label': t('files.zoomOut'), title: t('files.zoomOut'), onClick: () => step(1 / ZOOM_STEP) }, '\u2212'),
      h('button', { key: 'pct', type: 'button', className: 'gp-zoom__btn gp-zoom__pct', 'aria-label': `${label}，${t('files.zoomActual')}`, title: t('files.zoomActual'), onClick: toActual }, label),
      h('button', { key: 'in', type: 'button', className: 'gp-zoom__btn', 'aria-label': t('files.zoomIn'), title: t('files.zoomIn'), onClick: () => step(ZOOM_STEP) }, '+'),
      h('button', { key: 'fit', type: 'button', className: 'gp-zoom__btn gp-zoom__btn--text', 'aria-pressed': mode === 'fit', onClick: toFit }, t('files.zoomFit')),
      fullscreen
        ? h('button', { key: 'fs', type: 'button', className: 'gp-zoom__btn', 'aria-label': t('files.zoomFullscreen'), title: t('files.zoomFullscreen'), onClick: () => setOpen(true) }, '\u2921')
        : null,
    ])
    : null

  return h('div', {
    className: 'gp-zoom', ref: rootRef,
    'data-zoomed': mode === 'fit' ? undefined : 'true',
    'data-dragging': dragging ? 'true' : undefined,
  }, [
    h('div', {
      key: 'vp', className: `gp-zoom__scroll ${viewportClass}`, ref: scrollRef, onPointerDown,
      // Only the viewport's own padding hits this: a press on the img (or on the
      // zoom bar, which is a sibling) leaves the lightbox open.
      onMouseDown: onEmptyAreaMouseDown === undefined ? undefined : (e: { target: EventTarget; currentTarget: EventTarget }) => { if (e.target === e.currentTarget) onEmptyAreaMouseDown() },
    }, h('img', {
      key: 'img', ref: imgRef, className: 'gp-zoom__img', src, alt, style: imgStyle,
      draggable: false, onLoad: onLoaded, onDoubleClick,
    })),
    bar,
    open ? h(ZoomLightbox, { key: 'lb', src, alt, t, onClose: closeLightbox }) : null,
  ])
}

interface ZoomLightboxProps {
  readonly src: string
  readonly alt: string
  readonly t: T
  readonly onClose: () => void
}

/** Fullscreen zoom overlay; lifecycle mirrors the platform ImageLightbox. */
function ZoomLightbox({ src, alt, t, onClose }: ZoomLightboxProps): JSX.Element {
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const focusables = (): HTMLElement[] => {
      const root = backdropRef.current
      if (root === null) return []
      return [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      // Cycle focus through the dialog (close control + zoom bar) instead of
      // pinning it, so the zoom controls stay keyboard-reachable.
      const items = focusables()
      if (items.length === 0) return
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const idx = active === null ? -1 : items.indexOf(active)
      event.preventDefault()
      const delta = event.shiftKey ? -1 : 1
      const next = idx === -1
        ? (delta === -1 ? items.length - 1 : 0)
        : (idx + delta + items.length) % items.length
      items[next]?.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      restoreRef.current?.focus()
    }
  }, [onClose])

  return createPortal(
    h('div', { className: 'gp-zl-backdrop', ref: backdropRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': t('files.zoomFullscreen') }, [
      h('div', { key: 'stage', className: 'gp-zl-stage' }, [
        h('div', { key: 'mask', className: 'gp-zl-mask', 'aria-hidden': 'true', onMouseDown: onClose }),
        h('div', { key: 'frame', className: 'gp-zl-frame' }, h(ZoomableImage, { src, alt, t, viewportClass: 'gp-zl-viewport', fullscreen: false, onEmptyAreaMouseDown: onClose })),
        h('button', {
          key: 'close', ref: closeRef, type: 'button', className: 'gp-zl-close',
          'aria-label': t('common.close'), onClick: onClose,
        }, h(CloseIcon, { size: 16 })),
      ]),
    ]),
    document.body,
  )
}
