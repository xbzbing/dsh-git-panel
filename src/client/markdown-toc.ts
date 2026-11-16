/**
 * The reader's Markdown outline: the numbers behind the floating table of
 * contents. The rows themselves are read off the rendered document (the
 * platform's `MarkdownText` owns heading markup, so its anchors are not ours to
 * mint), which keeps this module DOM-free — label cleanup, nesting depth, which
 * row is current, and the cap that stops a heading-heavy document from mounting
 * thousands of buttons all live here.
 */

/** One outline row: the heading's depth, its rendered label, and where it sits
 * inside the scroll box's content. */
export interface TocEntry {
  readonly level: number
  readonly text: string
  readonly top: number
}

/** Above this the outline is truncated: an outline longer than the document's
 * own scrollbar helps nobody, and every row is a button in the DOM. */
export const TOC_MAX_ENTRIES = 200

/** Deepest nesting the outline indents for; h5 / h6 share h4's depth so a
 * document using all six levels does not walk off a narrow panel. */
export const TOC_MAX_DEPTH = 4

/** How far above a heading still counts as "the current section": the top of a
 * scrolling article reads badly if a heading only becomes current once it
 * reaches the very top edge of the box. */
export const TOC_ACTIVE_SLACK = 32

/** Heading text as the outline shows it: inline whitespace collapsed, and the
 * trailing `#`s of an ATX heading dropped (a renderer normally strips them —
 * this only matters when the heading's own text ends in `#`). */
export function normalizeHeadingText(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/(?:^|\s)#+\s*$/, '').trim()
}

/** Zero-based indent for `level` (h1…h6), clamped to {@link TOC_MAX_DEPTH}. */
export function tocIndent(level: number): number {
  const depth = Number.isFinite(level) ? Math.trunc(level) : 1
  return Math.min(Math.max(depth, 1), TOC_MAX_DEPTH) - 1
}

/** The rows the outline actually draws: labelled headings only (an empty
 * heading makes a blank row nothing can be read from), capped in order. */
export function tocEntries(rows: readonly TocEntry[]): TocEntry[] {
  const out: TocEntry[] = []
  for (const row of rows) {
    const text = normalizeHeadingText(row.text)
    if (text === '') continue
    out.push({ level: row.level, text, top: Number.isFinite(row.top) ? Math.max(0, row.top) : 0 })
    if (out.length >= TOC_MAX_ENTRIES) break
  }
  return out
}

/**
 * Which row is current for a scroll position.
 *
 * Every `top` is compared with the same `scrollTop`, and the answer is the last
 * heading that has passed the reading line (the top edge plus
 * {@link TOC_ACTIVE_SLACK}). A box parked at its very top answers with the first
 * heading — that is the beginning of the document, and the outline would
 * otherwise open with nothing marked. A box parked inside a long preamble
 * (scrolled, but not yet past the first heading) answers -1: the outline must
 * not claim a section the reader has not reached.
 *
 * `maxScrollTop` is the box's own ceiling (scrollHeight - clientHeight); the
 * bottom pin needs it to tell "scrolled to the end" from "there is nowhere to
 * scroll", and those two are answered differently.
 */
export function activeTocIndex(
  tops: readonly number[],
  scrollTop: number,
  slack = TOC_ACTIVE_SLACK,
  maxScrollTop = Number.POSITIVE_INFINITY,
): number {
  // A box nobody has measured yet reports NaN / -Infinity: claim no section.
  if (!Number.isFinite(scrollTop)) return -1
  const line = scrollTop + slack
  let found = -1
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= line) found = i
  }
  if (tops.length === 0) return -1
  // The ends of the box pin to the nearest anchor. At the top the reader is at
  // the document's beginning; at the bottom every remaining heading is on
  // screen but none of them can pass the reading line, so without this the
  // outline would stop one or two sections short of where the reader is.
  if (found === -1 && scrollTop <= 0) return 0
  // A box that cannot scroll (`maxScrollTop === 0`: the document is shorter
  // than the viewport) is at both ends at once — the top rule has already
  // decided it, and its answer must not be overwritten by the bottom pin.
  if (maxScrollTop > 0 && found < tops.length - 1 && scrollTop >= maxScrollTop - 1) return tops.length - 1
  return found
}

/**
 * Scroll offset that puts row `index` at the top of the box. A heading near the
 * end of a short document cannot reach the top edge, so the caller's own
 * `maxScrollTop` clamps the target: without it the box lands on its maximum and
 * the outline reads a step behind the section it marks as current.
 */
export function tocScrollTarget(tops: readonly number[], index: number, maxScrollTop: number, margin = 8): number {
  const top = tops[index]
  if (top === undefined || !Number.isFinite(top)) return 0
  const ceiling = Number.isFinite(maxScrollTop) ? Math.max(0, maxScrollTop) : 0
  return Math.min(Math.max(0, Math.round(top - margin)), ceiling)
}
