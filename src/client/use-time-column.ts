/**
 * Locale-aware width for the history list's relative-time column.
 *
 * Measures the longest label the active locale can print with the font the date
 * cell inherits, once per label set. The canvas is deliberate: it reports
 * unzoomed CSS pixels, exactly what the grid track is written in, while a DOM
 * probe would report the panel's zoomed pixels and need the font zoom divided
 * back out. `time-column.ts` holds the policy.
 */
import { useLayoutEffect, useState } from 'react'
import type { GitKey } from './locales.js'
import { fitTimeColumnWidth, TIME_COLUMN_MAX, TIME_FONT_PX, timeColumnLabels } from './time-column.js'

type T = (key: GitKey, params?: Record<string, string | number>) => string

/**
 * @param t - the panel's translate function
 * @param listEl - the history scroller, or null while it is unmounted. Its
 *   computed font is the date cell's inherited font; depending on the element
 *   itself (not a ref) is what re-measures after it comes back from a compact
 *   pane swap, when the locale may have changed in the meantime.
 */
export function useTimeColumnWidth(t: T, listEl: HTMLElement | null): number {
  // Before the first effect the column keeps the widest width it ever had; the
  // layout effect repaints with the measured one before the browser paints.
  const [width, setWidth] = useState(TIME_COLUMN_MAX)
  // `locale.bind` hands back one stable function that reads the active language
  // when it is called, so a language switch cannot be seen in `t`'s identity.
  // The rendered labels are the signal instead; they travel through the effect
  // key as one string because a fresh array per render never compares equal.
  const labels = timeColumnLabels(t)
  const signature = labels.join('\u0000')
  useLayoutEffect(() => {
    if (listEl === null) return
    const context = document.createElement('canvas').getContext('2d')
    if (context === null) return
    const family = getComputedStyle(listEl).fontFamily
    if (family === '') return
    // A font string the canvas cannot parse is dropped silently, leaving its
    // default 10px sans-serif: the column would then be sized from the wrong
    // face for every label. Detect the rejection and keep the fallback width.
    const requested = `${TIME_FONT_PX}px ${family}`
    context.font = requested
    if (context.font === '' || context.font === '10px sans-serif') return
    setWidth(fitTimeColumnWidth(signature === '' ? [] : signature.split('\u0000'), (text) => context.measureText(text).width))
  }, [signature, listEl])
  return width
}
