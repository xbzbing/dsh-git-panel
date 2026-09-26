/**
 * Drag-resizable column: a persisted pixel width plus a divider element to
 * place between two flex columns. Dragging the divider adjusts the width
 * (clamped to [min, container − reserve]); the value survives remounts via
 * localStorage. Mouse/pointer only — the divider is a thin hit area with a
 * hairline center.
 */
import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

function read(key: string, fallback: number): number {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
    const n = v === null ? NaN : Number(v)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function write(key: string, n: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(Math.round(n)))
  } catch {
    /* storage unavailable — width just won't persist */
  }
}

interface ResizableOptions {
  /** localStorage key the width persists under. */
  readonly storageKey: string
  /** Initial width in px when nothing is stored. */
  readonly initial: number
  /** Minimum width in px. */
  readonly min: number
  /** Space (px) reserved for the sibling columns when computing the max. */
  readonly reserve: number
  /** Which edge of the resized column the divider sits on: 'end' = right edge
   * (drag right grows it), 'start' = left edge (drag right shrinks it). */
  readonly edge: 'start' | 'end'
}

/** Returns the current column width and the divider element to render. */
export function useResizableColumn(opts: ResizableOptions): { width: number; divider: JSX.Element } {
  const { storageKey, initial, min, reserve, edge } = opts
  const [width, setWidth] = useState<number>(() => read(storageKey, initial))
  const ref = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ x: number; w: number; max: number } | null>(null)

  const onPointerDown = useCallback((e: { clientX: number; preventDefault: () => void }) => {
    const container = ref.current?.parentElement
    const cw = container?.clientWidth ?? Number.MAX_SAFE_INTEGER
    drag.current = { x: e.clientX, w: width, max: Math.max(min, cw - reserve) }
    e.preventDefault()
    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }
  }, [width, min, reserve])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const move = (ev: PointerEvent): void => {
      const s = drag.current
      if (s === null) return
      const dx = ev.clientX - s.x
      setWidth(clamp(s.w + (edge === 'end' ? dx : -dx), min, s.max))
    }
    const up = (): void => {
      if (drag.current === null) return
      drag.current = null
      if (typeof document !== 'undefined') {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      setWidth((w) => { write(storageKey, w); return w })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [edge, min, storageKey])

  const divider = h('div', {
    key: `rz-${storageKey}`,
    ref,
    className: 'gp-resizer',
    role: 'separator',
    'aria-orientation': 'vertical',
    onPointerDown,
  })
  return { width, divider }
}
