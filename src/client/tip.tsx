/**
 * Shared fast hover tooltip. The native `title` tooltip has a browser-controlled
 * delay (~500ms+) that cannot be shortened, so controls that want a snappier hint
 * use this instead: a short-delay tooltip portaled to document.body (so an
 * `overflow:hidden` ancestor — e.g. the overview left column — cannot clip it).
 * Keep each control's `aria-label` as its accessibility name; the tooltip is
 * purely visual.
 */
import { createElement as h, useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'

const DEFAULT_DELAY_MS = 140
const DEFAULT_MAX_W = 260

interface TipState { text: string; left: number; top?: number; bottom?: number }

export interface HoverTip {
  /** Spread onto a control to give it the tooltip on hover/focus. */
  readonly tipProps: (text: string) => Record<string, unknown>
  /** The portaled tooltip element (or null); render it once in the tree. */
  readonly tipNode: JSX.Element | null
  /** Dismiss immediately (e.g. right after a click triggers an action). */
  readonly hideTip: () => void
}

export function useHoverTip(opts?: { placement?: 'above' | 'below'; delayMs?: number; maxWidth?: number }): HoverTip {
  const placement = opts?.placement ?? 'above'
  const delayMs = opts?.delayMs ?? DEFAULT_DELAY_MS
  const maxWidth = opts?.maxWidth ?? DEFAULT_MAX_W
  const [tip, setTip] = useState<TipState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const hideTip = useCallback(() => {
    if (timer.current !== undefined) { clearTimeout(timer.current); timer.current = undefined }
    setTip(null)
  }, [])

  const showTip = useCallback((el: HTMLElement, text: string) => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.left, window.innerWidth - maxWidth - 8))
      // Anchor below the control (near the top of the panel) or above it
      // (the left-column footer), so the bubble never runs off-screen.
      if (placement === 'below') setTip({ text, left, top: r.bottom + 6 })
      else setTip({ text, left, bottom: Math.max(8, window.innerHeight - r.top + 6) })
    }, delayMs)
  }, [placement, delayMs, maxWidth])

  const tipProps = useCallback((text: string): Record<string, unknown> => ({
    onMouseEnter: (e: { currentTarget: HTMLElement }) => showTip(e.currentTarget, text),
    onMouseLeave: hideTip,
    onFocus: (e: { currentTarget: HTMLElement }) => showTip(e.currentTarget, text),
    onBlur: hideTip,
  }), [showTip, hideTip])

  const style: Record<string, number> = { left: tip?.left ?? 0, maxWidth }
  if (tip?.top !== undefined) style.top = tip.top
  if (tip?.bottom !== undefined) style.bottom = tip.bottom
  const tipNode = tip !== null && typeof document !== 'undefined'
    ? createPortal(h('div', { className: 'gp-tip gp-tip--sb', style }, tip.text), document.body)
    : null

  return { tipProps, tipNode, hideTip }
}
