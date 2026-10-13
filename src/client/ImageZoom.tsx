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
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { GitKey } from './locales'
import { CloseIcon } from './icons'
import { anchoredScroll, clampScale, normalizeWheel, wheelZoomFactor, ZOOM_STEP } from './zoom.js'

type T = (key: GitKey, params?: Record<string, string | number>) => string

/** 'fit' = constrain to the viewport (CSS-driven); a number = scale vs natural size. */
type ZoomMode = 'fit' | number

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
  /** Click-to-fullscreen and the fullscreen control; off inside the lightbox. */
  readonly fullscreen?: boolean
}

export function ZoomableImage({ src, alt, t, viewportClass, fullscreen = true }: ZoomableImageProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [mode, setMode] = useState<ZoomMode>('fit')
  const [fitPct, setFitPct] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  // Scroll correction applied after the next layout: content point under the
  // cursor stays put while the image resizes by `ratio`.
  const anchorRef = useRef<{ x: number; y: number; ratio: number } | null>(null)
  // Safari gesture baseline: scale captured when the gesture started.
  const gestureRef = useRef<{ base: number; x: number; y: number } | null>(null)
  const clickTimer = useRef<number | null>(null)

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

  // Apply the pending scroll anchor once the resized layout is committed.
  useLayoutEffect(() => {
    const a = anchorRef.current
    anchorRef.current = null
    const vp = scrollRef.current
    if (a === null || vp === null) return
    vp.scrollLeft = anchoredScroll(vp.scrollLeft, a.x, a.ratio)
    vp.scrollTop = anchoredScroll(vp.scrollTop, a.y, a.ratio)
  }, [mode])

  // One-time listeners on the wrapper (bubbling covers img + bar). Registered
  // with refs so handlers never need re-registering mid-gesture.
  useEffect(() => {
    const root = scrollRef.current?.parentElement
    if (root === null || root === undefined) return

    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return // plain wheel = native pan
      const img = imgRef.current
      if (img === null || !img.complete || img.naturalWidth === 0) return
      if (e.cancelable) e.preventDefault() // stop the browser's page zoom
      const [, dy] = normalizeWheel(e)
      const cur = displayed()
      if (cur === null) return
      zoomTo(cur * wheelZoomFactor(dy), e.clientX, e.clientY)
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

  // Keep the fit-percentage label honest while the viewport resizes.
  useEffect(() => {
    const vp = scrollRef.current
    if (vp === null || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const img = imgRef.current
      if (img === null || img.naturalWidth === 0 || img.clientWidth === 0) return
      setFitPct(Math.round((img.clientWidth / img.naturalWidth) * 100))
    })
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])

  const onLoaded = useCallback((e: { currentTarget: HTMLImageElement }): void => {
    const img = e.currentTarget
    setNat({ w: img.naturalWidth, h: img.naturalHeight })
    setFitPct(img.clientWidth > 0 ? Math.round((img.clientWidth / img.naturalWidth) * 100) : null)
  }, [])

  // Single click opens fullscreen — but wait briefly so a double click can
  // claim it for zoom-to-100% instead of flashing the lightbox open.
  const onClick = useCallback((): void => {
    if (!fullscreen) return
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current)
    clickTimer.current = window.setTimeout(() => { clickTimer.current = null; setOpen(true) }, 260)
  }, [fullscreen])
  const onDoubleClick = useCallback((): void => {
    if (clickTimer.current !== null) { window.clearTimeout(clickTimer.current); clickTimer.current = null }
    if (mode === 'fit') toActual()
    else toFit()
  }, [mode, toActual, toFit])
  useEffect(() => () => { if (clickTimer.current !== null) window.clearTimeout(clickTimer.current) }, [])

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
      h('button', { key: 'pct', type: 'button', className: 'gp-zoom__btn gp-zoom__pct', 'aria-label': t('files.zoomActual'), title: t('files.zoomActual'), onClick: toActual }, label),
      h('button', { key: 'in', type: 'button', className: 'gp-zoom__btn', 'aria-label': t('files.zoomIn'), title: t('files.zoomIn'), onClick: () => step(ZOOM_STEP) }, '+'),
      h('button', { key: 'fit', type: 'button', className: 'gp-zoom__btn gp-zoom__btn--text', 'aria-pressed': mode === 'fit', onClick: toFit }, t('files.zoomFit')),
      fullscreen
        ? h('button', { key: 'fs', type: 'button', className: 'gp-zoom__btn', 'aria-label': t('files.zoomFullscreen'), title: t('files.zoomFullscreen'), onClick: () => setOpen(true) }, '\u2921')
        : null,
    ])
    : null

  return h('div', { className: 'gp-zoom' }, [
    h('div', { key: 'vp', className: `gp-zoom__scroll ${viewportClass}`, ref: scrollRef }, h('img', {
      key: 'img', ref: imgRef, className: 'gp-zoom__img', src, alt, style: imgStyle,
      onLoad: onLoaded, onClick, onDoubleClick,
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
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        closeRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      restoreRef.current?.focus()
    }
  }, [onClose])

  return createPortal(
    h('div', { className: 'gp-zl-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('files.zoomFullscreen') }, [
      h('div', { key: 'stage', className: 'gp-zl-stage' }, [
        h('div', { key: 'mask', className: 'gp-zl-mask', 'aria-hidden': 'true', onMouseDown: onClose }),
        h('div', { key: 'frame', className: 'gp-zl-frame' }, h(ZoomableImage, { src, alt, t, viewportClass: 'gp-zl-viewport', fullscreen: false })),
        h('button', {
          key: 'close', ref: closeRef, type: 'button', className: 'gp-zl-close',
          'aria-label': t('common.close'), onClick: onClose,
        }, h(CloseIcon, { size: 16 })),
      ]),
    ]),
    document.body,
  )
}
