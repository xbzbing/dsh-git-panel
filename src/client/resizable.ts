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

/** The stacked layout's default top-band share (% of the panel height). */
const SPLIT_INITIAL = 55
/** Stored ratio bounds: neither band may collapse below a usable pane. */
const SPLIT_MIN = 30
const SPLIT_MAX = 75
const SPLIT_KEY = 'gp.stacked.split'

// One stored ratio shared by all three stacked surfaces — dragging any of
// them moves every mounted one, which is what keeps the bands visually
// aligned (a per-tab key would let them drift apart again).
let splitPct = -1
const splitListeners = new Set<(pct: number) => void>()

function splitValue(): number {
  if (splitPct !== -1) return splitPct
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(SPLIT_KEY) : null
    const n = v === null ? NaN : Number(v)
    splitPct = Number.isFinite(n) ? clamp(n, SPLIT_MIN, SPLIT_MAX) : SPLIT_INITIAL
  } catch {
    splitPct = SPLIT_INITIAL
  }
  return splitPct
}

function setSplitValue(next: number): void {
  splitPct = clamp(next, SPLIT_MIN, SPLIT_MAX)
  for (const listener of splitListeners) listener(splitPct)
}

/**
 * The stacked mode's shared top/bottom split: the current top-band percentage
 * plus a pointer-down handler for a horizontal divider placed between the two
 * bands. Each stacked surface renders its own divider node from the same
 * props (they are plain descriptors), and a drag in one updates every mounted
 * surface through the shared store. The ratio persists across remounts.
 */
export function useStackedSplit(): { pct: number; dividerProps: { onPointerDown: (e: { clientY: number; preventDefault: () => void; currentTarget: EventTarget | null }) => void } } {
  const [pct, setPct] = useState<number>(() => splitValue())
  useEffect(() => {
    const listener = (next: number): void => setPct(next)
    splitListeners.add(listener)
    return () => { splitListeners.delete(listener) }
  }, [])

  const onPointerDown = useCallback((e: { clientY: number; preventDefault: () => void; currentTarget: EventTarget | null }) => {
    const container = (e.currentTarget as HTMLElement | null)?.parentElement
    const ch = container?.clientHeight ?? 0
    if (ch <= 0) return
    const startY = e.clientY
    const startPct = splitValue()
    e.preventDefault()
    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
    }
    const move = (ev: PointerEvent): void => {
      setSplitValue(startPct + ((ev.clientY - startY) / ch) * 100)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (typeof document !== 'undefined') {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(SPLIT_KEY, String(Math.round(splitValue())))
      } catch {
        /* storage unavailable — the ratio just won't persist */
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  return { pct, dividerProps: { onPointerDown } }
}
