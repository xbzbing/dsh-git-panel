/**
 * Diff line comments quoted into the composer (issue #123, ADR-0039).
 *
 * A reader picks consecutive lines on one side of a diff, writes a comment and
 * adds it to the session's composer as one atomic quote; nothing is sent until
 * the reader sends the draft. The quote text follows the platform's own
 * local-changes review tab (`@deepseek-ai/dsh-experimental-client-ui-forge`,
 * `formatReviewComment`) heading for heading — `## User Comment N`, `File`,
 * `Side`, `Lines`, `Source`, `Diff hunk`, `Comment` — so comments from both
 * surfaces number on in one draft and reach the agent in one shape. This
 * plugin adds a `Repository` line: its diffs can come from a checkout other
 * than the session cwd.
 *
 * One deliberate difference: the platform quotes the whole hunk it displays,
 * always three context lines around the change; this panel can reveal far more
 * context (and a rewritten section is one hunk), so the quote keeps only the
 * picked lines and {@link REVIEW_CONTEXT_LINES} beside them.
 *
 * Pure: no DOM, no React. The diff text is the source of truth for hunks; the
 * rendered rows only supply the text of lines picked outside every hunk
 * (revealed context), which carry a plain `Code` block instead of a hunk.
 */

/** Old (`L`) or new (`R`) side of a diff. */
export type ReviewSide = 'L' | 'R'

/** One hunk of a unified diff, as git printed it. */
export interface ReviewHunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  /** Body lines in patch form (` `, `+`, `-`, `\`). */
  readonly lines: readonly string[]
}

/** A picked line range; `anchor` is the line the range grows from. */
export interface ReviewLineRange {
  readonly side: ReviewSide
  readonly start: number
  readonly end: number
  readonly anchor: number
}

/** Which diff the comment was written on. */
export type ReviewSource =
  /** Working tree against the index (`unstaged`) or the index against HEAD (`staged`). */
  | { readonly kind: 'local'; readonly scope: 'unstaged' | 'staged' }
  /** One commit against its first parent. */
  | { readonly kind: 'commit'; readonly hash: string }
  /** The working tree against a chosen revision. */
  | { readonly kind: 'rev'; readonly rev: string }

/** The snippet frozen when the range was picked: what the reader saw. */
export type ReviewSnippet =
  | { readonly kind: 'hunk'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }

/** Everything one quote carries. */
export interface ReviewQuoteInput {
  /** Absolute repository root, or undefined when unknown. */
  readonly repository?: string
  /** Repository-relative path (the new path of a rename). */
  readonly path: string
  readonly range: ReviewLineRange
  readonly source: ReviewSource
  readonly snippet: ReviewSnippet
  readonly body: string
}

/** The composer's display of a quote (the platform's `QuoteSummary`). */
export interface ReviewQuoteSummary {
  readonly label: string
  readonly title: string
  readonly detail: string
  readonly body: string
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Parse the hunks of a single-file unified diff.
 * @param text - `git diff` / `git show` output for one path.
 * @returns hunks in order; a header-less or binary diff yields none.
 */
export function parseReviewHunks(text: string): ReviewHunk[] {
  const hunks: ReviewHunk[] = []
  let current: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] } | null = null
  for (const line of text.split('\n')) {
    const header = HUNK_HEADER.exec(line)
    if (header !== null) {
      if (current !== null) hunks.push(current)
      current = {
        oldStart: Number(header[1]), oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]), newLines: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      }
      continue
    }
    if (current === null) continue
    // A second file header ends the hunk (combined output never reaches here,
    // but a stray one must not be read as body text).
    if (line.startsWith('diff ')) { hunks.push(current); current = null; continue }
    const mark = line.charAt(0)
    if (mark === ' ' || mark === '+' || mark === '-' || mark === '\\') current.lines.push(line)
  }
  if (current !== null) hunks.push(current)
  return hunks
}

/**
 * The hunk covering one line of one side.
 * @returns the hunk index, or -1 for a line outside every hunk (revealed
 *   context, or a side the hunk does not touch).
 */
export function reviewHunkIndex(hunks: readonly ReviewHunk[], side: ReviewSide, line: number): number {
  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i]!
    const start = side === 'L' ? hunk.oldStart : hunk.newStart
    const count = side === 'L' ? hunk.oldLines : hunk.newLines
    if (line >= start && line < start + count) return i
  }
  return -1
}

/**
 * Pick a line, or grow the current range to it.
 *
 * A range stays on one side and inside one hunk — the quote carries that hunk,
 * and a range across hunks would quote code the reader never saw between them.
 * A line outside every hunk is picked alone. Anything else starts over at the
 * clicked line rather than silently picking something the reader did not ask
 * for.
 * @param previous - the current range, or null.
 * @param extend - true for Shift+click.
 */
export function pickReviewLine(
  previous: ReviewLineRange | null, hunks: readonly ReviewHunk[],
  side: ReviewSide, line: number, extend: boolean,
): ReviewLineRange {
  if (extend && previous !== null && previous.side === side) {
    const at = reviewHunkIndex(hunks, side, previous.anchor)
    if (at >= 0 && at === reviewHunkIndex(hunks, side, line)) {
      return { side, anchor: previous.anchor, start: Math.min(previous.anchor, line), end: Math.max(previous.anchor, line) }
    }
  }
  return { side, anchor: line, start: line, end: line }
}

/**
 * Whether a line of a side lies inside a range.
 */
export function reviewRangeHas(range: ReviewLineRange | null, side: ReviewSide, line: number | null): boolean {
  return range !== null && line !== null && range.side === side && line >= range.start && line <= range.end
}

/**
 * Context lines a quoted hunk keeps on either side of the picked range — the
 * same three lines `git diff` prints, so a comment on one line does not drag a
 * whole rewritten section into the draft.
 */
export const REVIEW_CONTEXT_LINES = 3

/** A hunk's body numbered: the counters each line starts at on either side. */
interface NumberedHunk {
  readonly hunk: ReviewHunk
  readonly oldBefore: readonly number[]
  readonly newBefore: readonly number[]
}

function numberHunk(hunk: ReviewHunk): NumberedHunk {
  // A `\` line occupies no number: it annotates the line before it.
  const oldBefore: number[] = []
  const newBefore: number[] = []
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart
  for (const line of hunk.lines) {
    oldBefore.push(oldNo)
    newBefore.push(newNo)
    const mark = line.charAt(0)
    if (mark === ' ' || mark === '-') oldNo++
    if (mark === ' ' || mark === '+') newNo++
  }
  return { hunk, oldBefore, newBefore }
}

/** Whether a body line holds a number on a side. */
function occupies(line: string, side: ReviewSide): boolean {
  const mark = line.charAt(0)
  return side === 'L' ? mark === ' ' || mark === '-' : mark === ' ' || mark === '+'
}

/** A hunk as git printed it: its own header, its whole body. */
function wholeHunk(hunk: ReviewHunk): string {
  return [`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines].join('\n')
}

/**
 * Body lines `from..to` of a hunk under a header rebuilt from the numbers they
 * cover, without the trailing function-context label.
 */
function windowText({ hunk, oldBefore, newBefore }: NumberedHunk, from: number, to: number): string {
  const window = hunk.lines.slice(from, to + 1)
  let oldCount = 0
  let newCount = 0
  for (const line of window) {
    if (occupies(line, 'L')) oldCount++
    if (occupies(line, 'R')) newCount++
  }
  // An empty side names the line it follows, as git does. A side the whole
  // hunk leaves empty (a new or deleted file, `@@ -0,0`) already starts at that
  // line; any other side starts at the line after it.
  const startOf = (count: number, before: number, hunkLines: number): number =>
    count > 0 || hunkLines === 0 ? before : before - 1
  const oldStart = startOf(oldCount, oldBefore[from]!, hunk.oldLines)
  const newStart = startOf(newCount, newBefore[from]!, hunk.newLines)
  return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...window].join('\n')
}

/**
 * The window of a hunk a range quotes: the picked lines plus
 * {@link REVIEW_CONTEXT_LINES} on each side, with a header rebuilt from the
 * line numbers that window covers.
 */
function hunkWindow(hunk: ReviewHunk, range: ReviewLineRange): string {
  const numbered = numberHunk(hunk)
  const body = hunk.lines
  const numbers = range.side === 'L' ? numbered.oldBefore : numbered.newBefore
  let first = -1
  let last = -1
  for (let i = 0; i < body.length; i++) {
    if (!occupies(body[i]!, range.side)) continue
    const no = numbers[i]!
    if (no < range.start || no > range.end) continue
    if (first < 0) first = i
    last = i
  }
  const from = first < 0 ? 0 : Math.max(0, first - REVIEW_CONTEXT_LINES)
  const to = last < 0 ? body.length - 1 : Math.min(body.length - 1, last + REVIEW_CONTEXT_LINES)
  // A range this hunk does not carry, or one whose context already fills it,
  // keeps git's own header: rebuilding it there would only rewrite the numbers
  // the patch already states.
  if (first < 0 || (from === 0 && to === body.length - 1)) return wholeHunk(hunk)
  return windowText(numbered, from, to)
}

/**
 * Freeze the snippet a range quotes.
 * @param lineText - the rendered text of a line of the range's side, or
 *   undefined when it is not on screen (only consulted outside every hunk).
 * @returns the picked lines and their nearby context in patch form, the picked
 *   lines alone as plain code, or null when neither is available.
 */
export function reviewSnippet(
  hunks: readonly ReviewHunk[], range: ReviewLineRange,
  lineText: (side: ReviewSide, line: number) => string | undefined,
): ReviewSnippet | null {
  const at = reviewHunkIndex(hunks, range.side, range.start)
  if (at >= 0) return { kind: 'hunk', text: hunkWindow(hunks[at]!, range) }
  const lines: string[] = []
  for (let line = range.start; line <= range.end; line++) {
    const text = lineText(range.side, line)
    if (text === undefined) return null
    lines.push(text)
  }
  return { kind: 'code', text: lines.join('\n') }
}

/** `R12` or `L3–5`: the range label shown beside the form and in the composer. */
export function reviewRangeLabel(range: Pick<ReviewLineRange, 'side' | 'start' | 'end'>): string {
  return `${range.side}${range.start}${range.end === range.start ? '' : `\u2013${range.end}`}`
}

/** The `Source:` lines of a quote. */
function sourceLines(source: ReviewSource): string {
  if (source.kind === 'local') return `Source: Local (${source.scope})`
  if (source.kind === 'commit') return `Source: Local (commit)\nCommit: ${source.hash}`
  return `Source: Local (working tree)\nBase: ${source.rev}`
}

/** A fence longer than any backtick run inside, so quoted code cannot close it. */
function fenceFor(text: string): string {
  let longest = 0
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * Format one comment as the composer quote.
 * @param index - one-based number after the comments already in the draft.
 */
export function formatReviewQuote(input: ReviewQuoteInput, index: number): string {
  const { range, snippet } = input
  const lines = range.start === range.end ? String(range.start) : `${range.start}-${range.end}`
  const fence = fenceFor(snippet.text)
  const block = snippet.kind === 'hunk'
    ? `Diff hunk:\n${fence}diff\n${snippet.text}\n${fence}`
    : `Code:\n${fence}\n${snippet.text}\n${fence}`
  const repository = input.repository === undefined || input.repository === '' ? '' : `Repository: ${input.repository}\n`
  return `## User Comment ${index}\n${repository}File: ${input.path}\nSide: ${range.side}\nLines: ${lines}\n${sourceLines(input.source)}\n${block}\nComment:\n${input.body.trim()}`
}

const COMMENT_HEADING = /(?:^|\n)(?:> )?## User Comment (\d+)/g

/**
 * The number the next comment takes: one past the highest already in the
 * draft, so this plugin and the platform's review tab never reuse a number.
 * @param draft - the composer's current draft, or undefined when unreadable.
 * @param added - comments this panel has put into the session's composer; an
 *   unreadable draft numbers on from them instead of restarting at 1.
 */
export function nextReviewIndex(draft: string | undefined, added = 0): number {
  if (draft === undefined) return added + 1
  let highest = 0
  for (const match of draft.matchAll(COMMENT_HEADING)) highest = Math.max(highest, Number(match[1]))
  return highest + 1
}

/** The composer's chip for a quote: `name.ts R12`, titled by the path. */
export function reviewQuoteSummary(path: string, range: ReviewLineRange, body: string): ReviewQuoteSummary {
  const detail = reviewRangeLabel(range)
  return { label: `${path.slice(path.lastIndexOf('/') + 1)} ${detail}`, title: path, detail, body: body.trim() }
}

/**
 * Where a frozen snippet stands against the diff on screen: `current` (it still
 * reads the same at the same numbers), `changed` (the code there differs) or
 * `hidden` (the picked lines are not rendered now, e.g. collapsed context, so
 * nothing can be compared).
 */
export type ReviewSnippetState = 'current' | 'changed' | 'hidden'

/** Index of the body line holding `line` on `side`, or -1. */
function lineIndex(numbered: NumberedHunk, side: ReviewSide, line: number): number {
  const before = side === 'L' ? numbered.oldBefore : numbered.newBefore
  return numbered.hunk.lines.findIndex((text, i) => occupies(text, side) && before[i] === line)
}

/**
 * Whether the hunk now covering a range still holds the frozen window: aligned
 * on the first picked line, every frozen line the hunk spans reads the same and
 * the other side's numbers have not moved. Frozen context past the hunk's edges
 * (a narrower hunk after collapsing) is not on screen and is not compared, but
 * the picked lines must all be inside it.
 */
function windowHolds(frozen: NumberedHunk, now: NumberedHunk, range: ReviewLineRange): boolean {
  const first = lineIndex(frozen, range.side, range.start)
  const last = lineIndex(frozen, range.side, range.end)
  const at = lineIndex(now, range.side, range.start)
  if (first < 0 || last < 0 || at < 0) return false
  const shift = at - first
  if (last + shift >= now.hunk.lines.length) return false
  for (let i = 0; i < frozen.hunk.lines.length; i++) {
    const j = i + shift
    if (j < 0 || j >= now.hunk.lines.length) continue
    if (frozen.hunk.lines[i] !== now.hunk.lines[j]) return false
  }
  // A frozen window with no line on the other side states no number there to
  // keep (git names the line it follows); otherwise that side must not shift.
  const otherCount = range.side === 'L' ? frozen.hunk.newLines : frozen.hunk.oldLines
  if (otherCount === 0) return true
  const frozenOther = range.side === 'L' ? frozen.newBefore : frozen.oldBefore
  const nowOther = range.side === 'L' ? now.newBefore : now.oldBefore
  return frozenOther[first] === nowOther[at]
}

/** The picked lines' text in a frozen window, without patch marks. */
function pickedText(frozen: NumberedHunk, range: ReviewLineRange): string {
  const before = range.side === 'L' ? frozen.oldBefore : frozen.newBefore
  const lines: string[] = []
  frozen.hunk.lines.forEach((text, i) => {
    if (occupies(text, range.side) && before[i]! >= range.start && before[i]! <= range.end) lines.push(text.slice(1))
  })
  return lines.join('\n')
}

/**
 * Whether a frozen snippet still describes the diff now on screen. A hunk
 * snippet stays current while the hunk now covering the range holds the quoted
 * window at the same numbers: an edit elsewhere in the hunk, or a wider or
 * narrower hunk from switching the context, leaves the quote accurate. Picked
 * lines no longer inside one hunk (outside every hunk, or split across two),
 * and a code snippet, compare the rendered text of the picked lines; lines not
 * rendered at all are `hidden`, not `changed`.
 * A comment that is not current keeps its frozen snippet and asks the reader to
 * check it instead of re-pointing it at whatever the line numbers hold now.
 */
export function reviewSnippetState(
  snippet: ReviewSnippet, hunks: readonly ReviewHunk[], range: ReviewLineRange,
  lineText: (side: ReviewSide, line: number) => string | undefined,
): ReviewSnippetState {
  const rendered = (): string | null => {
    const lines: string[] = []
    for (let line = range.start; line <= range.end; line++) {
      const text = lineText(range.side, line)
      if (text === undefined) return null
      lines.push(text)
    }
    return lines.join('\n')
  }
  const compare = (expected: string): ReviewSnippetState => {
    const now = rendered()
    return now === null ? 'hidden' : now === expected ? 'current' : 'changed'
  }
  if (snippet.kind === 'code') return compare(snippet.text)
  const frozenHunk = parseReviewHunks(snippet.text)[0]
  if (frozenHunk === undefined) return 'changed'
  const frozen = numberHunk(frozenHunk)
  const at = reviewHunkIndex(hunks, range.side, range.start)
  if (at >= 0 && at === reviewHunkIndex(hunks, range.side, range.end)) {
    const hunk = hunks[at]!
    if (wholeHunk(hunk) === snippet.text) return 'current'
    return windowHolds(frozen, numberHunk(hunk), range) ? 'current' : 'changed'
  }
  return compare(pickedText(frozen, range))
}
