/**
 * Unified-diff parsing into side-by-side rows + summary. Self-contained;
 * no external diff library — a git unified diff is line-oriented and cheap
 * to walk. Hidden context between hunks becomes `gap` rows the view can
 * expand on demand (via a file-lines query), and modified line pairs carry
 * word-level change ranges for intra-line emphasis.
 */
import { imageMimeFor } from './types.js'

export type RowKind = 'context' | 'add' | 'del' | 'mod' | 'hunk' | 'gap' | 'meta'

/** A collapsed run of unchanged lines the view can reveal on demand. */
export interface GapInfo {
  /** First hidden new-side (right) line number. */
  readonly rightStart: number
  /** Hidden line count. Always exact: the trailing gap's count comes from the
   * host-reported new-side line count, so no gap is ever unbounded. */
  readonly count: number
  /** oldLine = newLine + delta across the unchanged gap region. */
  readonly delta: number
  /** No visible block above (leading gap at file start). */
  readonly atStart: boolean
}

export interface SideRow {
  readonly kind: RowKind
  /** Left (old) line number, null for added/gap/meta rows. */
  readonly leftNo: number | null
  /** Right (new) line number, null for deleted/gap/meta rows. */
  readonly rightNo: number | null
  readonly leftText: string | null
  readonly rightText: string | null
  /** For hunk/meta rows the raw header text. */
  readonly text?: string
  /** For gap rows: the hidden region descriptor. */
  readonly gap?: GapInfo
  /** For mod rows: [start,end) char range that changed on the left side. */
  readonly leftWord?: readonly [number, number]
  /** For mod rows: [start,end) char range that changed on the right side. */
  readonly rightWord?: readonly [number, number]
}

/** True when the diff is a binary-file marker. */
export function isBinaryDiff(unified: string): boolean {
  return /^Binary files .* differ$/m.test(unified) || /^GIT binary patch$/m.test(unified)
}

/** True when the path is one of the image types image-diff serves. */
export function isImagePath(path: string): boolean {
  return imageMimeFor(path) !== null
}

/** True for an SVG path — an image that is also text, so its diff view offers
 * both a rendered comparison and a source-text diff. */
export function isSvgPath(path: string): boolean {
  return /\.svg$/i.test(path)
}

function bodyLines(unified: string): string[] {
  const lines = unified.split('\n')
  const out: string[] = []
  let inHunk = false
  for (const line of lines) {
    if (line.startsWith('@@')) { inHunk = true; continue }
    if (!inHunk) continue
    if (line.startsWith('diff ') || line.startsWith('index ')) { inHunk = false; continue }
    if (line === '') continue
    out.push(line)
  }
  return out
}

/** Sum added/deleted line counts. */
export function summarize(unified: string): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const line of bodyLines(unified)) {
    if (line.startsWith('+')) add++
    else if (line.startsWith('-')) del++
  }
  return { add, del }
}

const HUNK_RE = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Parse a unified diff into aligned side-by-side rows with expandable gaps.
 * `newLines` is the new-side file's total line count (0 / non-finite when
 * unknown), which is the only fact that can tell whether hidden context follows
 * the last hunk: git caps trailing context at -U, so a full trailing run looks
 * identical whether the hunk is mid-file or the file ends exactly there.
 */
export function buildSideBySide(unified: string, newLines: number): SideRow[] {
  const rows: SideRow[] = []
  const lines = unified.split('\n')
  // Unknown count (0 or anything non-finite): no trailing gap at all, rather
  // than a speculative control that could reveal nothing.
  const newSideLines = Number.isFinite(newLines) && newLines > 0 ? newLines : 0
  let leftNo = 0
  let rightNo = 0
  let firstHunk = true
  let sawBody = false
  let i = 0
  // Skip the file header lines until the first hunk.
  for (; i < lines.length; i++) {
    if (lines[i]!.startsWith('@@')) break
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('@@')) {
      const m = HUNK_RE.exec(line)
      if (m) {
        const oldStart = Number(m[1])
        const newStart = Number(m[3])
        const delta = oldStart - newStart
        if (firstHunk) {
          // Leading gap: hidden new lines 1..newStart-1 above the first hunk.
          if (newStart > 1) {
            rows.push(gapRow({ rightStart: 1, count: newStart - 1, delta, atStart: true }))
          }
        } else {
          // Between-hunk gap: hidden new lines rightNo..newStart-1.
          const count = newStart - rightNo
          if (count > 0) {
            rows.push(gapRow({ rightStart: rightNo, count, delta, atStart: false }))
          }
        }
        leftNo = oldStart
        rightNo = newStart
        firstHunk = false
      }
      rows.push({ kind: 'hunk', leftNo: null, rightNo: null, leftText: null, rightText: null, text: line })
      continue
    }
    if (line.startsWith('\\')) continue // "\ No newline at end of file"
    const marker = line[0]
    const content = line.slice(1)
    if (marker === '+') {
      rows.push({ kind: 'add', leftNo: null, rightNo, leftText: null, rightText: content })
      rightNo++
      sawBody = true
    } else if (marker === '-') {
      rows.push({ kind: 'del', leftNo, rightNo: null, leftText: content, rightText: null })
      leftNo++
      sawBody = true
    } else if (marker === ' ') {
      rows.push({ kind: 'context', leftNo, rightNo, leftText: content, rightText: content })
      leftNo++
      rightNo++
      sawBody = true
    }
    // any other prefix (diff/index/---/+++) between hunks: ignore
  }
  // Trailing gap: new lines rightNo..newLines are hidden, exactly. The count is
  // known (not EOF-probed) whenever the host reported the length, so the
  // control is never a dead button — a non-positive count emits no gap at all
  // and an unknown length degrades to no control rather than a speculative one
  // that reveals nothing. `rightNo > 0` excludes a deleted file, whose new side
  // has no lines and whose newStart is 0.
  const trailing = newSideLines - rightNo + 1
  if (sawBody && !firstHunk && rightNo > 0 && trailing > 0) {
    rows.push(gapRow({ rightStart: rightNo, count: trailing, delta: leftNo - rightNo, atStart: false }))
  }
  return pairDeletionsWithAdditions(rows)
}

/**
 * Re-derive the trailing gap from a freshly reported new-side line count while
 * keeping the rows as they are: the diff text did not change, but the file may
 * have grown or shrunk since it was fetched, so only the gap below the last
 * visible line can be stale. Returns the input array unchanged when nothing
 * needs retargeting, and null when the gap cannot be re-derived from the rows
 * (a new trailing gap needs the parser's old/new counters — the caller reseeds
 * from the diff text instead).
 */
export function retargetTrailingGap(rows: readonly SideRow[], newLines: number): readonly SideRow[] | null {
  const end = rows[rows.length - 1]
  const lastIsGap = end !== undefined && end.kind === 'gap'
  const current = lastIsGap ? end.gap : undefined
  const above = lastIsGap ? rows[rows.length - 2] : end
  const aboveRight = above === undefined ? null : above.rightNo
  const shown = aboveRight !== null && aboveRight > 0 ? aboveRight : 0
  const count = Number.isFinite(newLines) ? newLines - shown : 0
  const next = count > 0 ? count : 0
  if (current === undefined) {
    if (next === 0 || shown === 0) return rows
    // A revealed tail carries both sides on its last row, so the delta for the
    // region below it is `left - right`; a one-sided add/del tail does not, and
    // there the caller has to reseed from the diff text.
    const left = above === undefined ? null : above.leftNo
    if (left === null) return null
    return [...rows, gapRow({ rightStart: shown + 1, count: next, delta: left - shown, atStart: false })]
  }
  if (current.rightStart === shown + 1 && current.count === next) return rows
  if (next === 0) return rows.slice(0, -1)
  return [
    ...rows.slice(0, -1),
    gapRow({ rightStart: shown + 1, count: next, delta: current.delta, atStart: false }),
  ]
}

function gapRow(gap: GapInfo): SideRow {
  return { kind: 'gap', leftNo: null, rightNo: null, leftText: null, rightText: null, gap }
}

/**
 * Merge a run of deletions immediately followed by additions into paired rows
 * (IDE-style side-by-side alignment). A row with both sides is a modification
 * (`mod`) and carries word-level change ranges; leftover deletions/additions
 * stay single-sided.
 */
function pairDeletionsWithAdditions(rows: SideRow[]): SideRow[] {
  const out: SideRow[] = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]!
    if (row.kind === 'del') {
      const dels: SideRow[] = []
      let j = i
      while (j < rows.length && rows[j]!.kind === 'del') { dels.push(rows[j]!); j++ }
      const adds: SideRow[] = []
      while (j < rows.length && rows[j]!.kind === 'add') { adds.push(rows[j]!); j++ }
      const pairs = Math.max(dels.length, adds.length)
      for (let k = 0; k < pairs; k++) {
        const d = dels[k]
        const a = adds[k]
        if (d && a) {
          const w = intraLineDiff(d.leftText ?? '', a.rightText ?? '')
          out.push({
            kind: 'mod',
            leftNo: d.leftNo, rightNo: a.rightNo,
            leftText: d.leftText, rightText: a.rightText,
            ...(w !== null ? { leftWord: w.left, rightWord: w.right } : {}),
          })
        } else if (d) {
          out.push({ kind: 'del', leftNo: d.leftNo, rightNo: null, leftText: d.leftText, rightText: null })
        } else if (a) {
          out.push({ kind: 'add', leftNo: null, rightNo: a.rightNo, leftText: null, rightText: a.rightText })
        }
      }
      i = j
    } else {
      out.push(row)
      i++
    }
  }
  return out
}

/**
 * Word-level change ranges between an old and new line: the changed middle
 * after stripping the common prefix and suffix. Returns null when the whole
 * line differs (no shared prefix/suffix) — marking it would just repeat the
 * row background. Character-granular, O(n): enough to spotlight a token edit
 * (`DateTime` → `DateTimeZone`) without a full LCS.
 */
export function intraLineDiff(a: string, b: string): { left: [number, number]; right: [number, number] } | null {
  const min = Math.min(a.length, b.length)
  let p = 0
  while (p < min && a[p] === b[p]) p++
  let s = 0
  while (s < min - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  // No shared prefix and no shared suffix → the whole line changed.
  if (p === 0 && s === 0) return null
  return { left: [p, a.length - s], right: [p, b.length - s] }
}

/** Extract the added-side content (new-file view). */
export function extractAddedContent(unified: string): string {
  return bodyLines(unified).filter((l) => l.startsWith('+')).map((l) => l.slice(1)).join('\n')
}

/** Extract the deleted-side content (removed-file view). */
export function extractDeletedContent(unified: string): string {
  return bodyLines(unified).filter((l) => l.startsWith('-')).map((l) => l.slice(1)).join('\n')
}

/** Build context rows from revealed new-side lines (gap expansion). */
export function contextRowsFromLines(delta: number, start: number, lines: readonly string[]): SideRow[] {
  return lines.map((text, k) => {
    const rightNo = start + k
    return { kind: 'context' as const, leftNo: rightNo + delta, rightNo, leftText: text, rightText: text }
  })
}

/** How many lines one "expand up/down" step reveals. */
export const GAP_STEP = 20

/**
 * Flatten side-by-side rows into a single-column (unified / inline) sequence:
 * a `mod` row splits back into its deletion above its addition, so the unified
 * view shows `-old` immediately followed by `+new` (GitHub inline style). The
 * word-level ranges carry onto the split rows so intra-line emphasis survives.
 * `context` / `add` / `del` / `hunk` / `gap` rows pass through unchanged.
 */
export function flattenToUnified(rows: readonly SideRow[]): SideRow[] {
  const out: SideRow[] = []
  for (const row of rows) {
    if (row.kind === 'mod') {
      out.push({
        kind: 'del', leftNo: row.leftNo, rightNo: null,
        leftText: row.leftText, rightText: null,
        ...(row.leftWord !== undefined ? { leftWord: row.leftWord } : {}),
      })
      out.push({
        kind: 'add', leftNo: null, rightNo: row.rightNo,
        leftText: null, rightText: row.rightText,
        ...(row.rightWord !== undefined ? { rightWord: row.rightWord } : {}),
      })
    } else {
      out.push(row)
    }
  }
  return out
}

/**
 * Splice a gap (identified by its rightStart) after revealing `lines` starting
 * at new-side line `revealedStart`. `direction` decides where a residual gap
 * remains: 'all' consumes the gap; 'down' reveals the top slice (residual
 * below); 'up' reveals the bottom slice (residual above). `eof` collapses a
 * trailing gap when the file end is reached.
 */
export function spliceGap(
  rows: readonly SideRow[],
  gapRightStart: number,
  direction: 'all' | 'up' | 'down',
  revealedStart: number,
  lines: readonly string[],
  eof: boolean,
): SideRow[] {
  const idx = rows.findIndex((r) => r.kind === 'gap' && r.gap?.rightStart === gapRightStart)
  if (idx < 0) return rows.slice()
  const gap = rows[idx]!.gap!
  const revealed = contextRowsFromLines(gap.delta, revealedStart, lines)
  const replacement: SideRow[] = []
  // Every gap carries an exact count (the trailing gap's comes from the host's
  // new-side line count), so "the window came back whole" is the same test
  // everywhere and no branch has to probe for EOF.
  const total = gap.count
  if (direction === 'all' || lines.length >= total) {
    replacement.push(...revealed)
  } else if (direction === 'down') {
    // Revealed the top slice; a smaller gap remains below.
    replacement.push(...revealed)
    // `eof` overrides the count when the file shrank since the diff was
    // fetched: nothing lies below the file end, so it must not be offered.
    if (!eof) {
      replacement.push(gapRow({
        rightStart: gap.rightStart + lines.length,
        count: total - lines.length, delta: gap.delta, atStart: false,
      }))
    }
  } else {
    // 'up': revealed the bottom slice; a smaller gap remains above. A host that
    // returned nothing (the count went stale — the range now lies past the file
    // end) has nothing left to reveal, so consume the gap instead of re-offering
    // the same buttons that would keep answering with nothing.
    if (lines.length === 0) return [...rows.slice(0, idx), ...rows.slice(idx + 1)]
    const remaining = total - lines.length
    replacement.push(gapRow({
      rightStart: gap.rightStart,
      count: remaining, delta: gap.delta, atStart: gap.atStart,
    }))
    replacement.push(...revealed)
  }
  return [...rows.slice(0, idx), ...replacement, ...rows.slice(idx + 1)]
}
