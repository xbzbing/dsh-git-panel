/**
 * Width of the history list's relative-time column.
 *
 * The date is the last fixed track of the commit grid, and one width cannot fit
 * every locale: "3 天前" is half the width of "vor 3 T." or "3 дн. назад". A
 * fixed track therefore either leaves a band of empty space (CJK) or clips the
 * long locales. The width is measured from the locale's own labels, with the
 * font the cell actually renders in, so every language gets the track it needs.
 *
 * Pure except for the injected `measure`, so the policy stays unit-testable;
 * `use-time-column.ts` owns the canvas that measures.
 */
import type { GitKey } from './locales.js'

type T = (key: GitKey, params?: Record<string, string | number>) => string

/**
 * Size of `.gp-commit-date` (css/overview.ts). The canvas is not affected by
 * the panel's font zoom, and neither is the grid track written from its
 * result — zoom scales text and track together. A unit test pins the two.
 */
export const TIME_FONT_PX = 11

/** Floor: a very short locale must not collapse the column into the author's. */
export const TIME_COLUMN_MIN = 56

/**
 * Ceiling: the widest track this column may take. It keeps the row's minimum
 * width predictable, and no shipped locale reaches it (the widest, Russian,
 * needs 88px).
 */
export const TIME_COLUMN_MAX = 96

/** Slack so a label never touches the next track; the row's own padding-right
 * already keeps it off the panel edge. */
const SLACK_PX = 4

/**
 * Longest label each unit can produce, in the order `timeAgo` selects them.
 * Four-digit days cover any real commit (27 years), and the samples are fixed
 * rather than derived from the loaded page: the track must not resize as
 * history pages load.
 */
const SAMPLES: ReadonlyArray<readonly [GitKey, number | null]> = [
  ['time.justNow', null],
  ['time.minutesAgo', 59],
  ['time.hoursAgo', 23],
  ['time.daysAgo', 9999],
]

/** The strings the column must fit in the current locale. */
export function timeColumnLabels(t: T): string[] {
  return SAMPLES.map(([key, n]) => (n === null ? t(key) : t(key, { n })))
}

/** Track width in CSS px: the widest label plus slack, clamped. */
export function fitTimeColumnWidth(labels: readonly string[], measure: (text: string) => number): number {
  let widest = 0
  for (const label of labels) widest = Math.max(widest, measure(label))
  // No usable measurement (no canvas, empty labels): fall back to the width the
  // column had before it was measured, rather than collapsing it to its floor.
  if (!(widest > 0)) return TIME_COLUMN_MAX
  return Math.min(TIME_COLUMN_MAX, Math.max(TIME_COLUMN_MIN, Math.ceil(widest) + SLACK_PX))
}
