/**
 * Unified-diff parsing into side-by-side rows + summary. Self-contained;
 * no external diff library — a git unified diff is line-oriented and cheap
 * to walk. Hidden context between hunks becomes `gap` rows the view can
 * expand on demand (via a file-lines query), and modified line pairs carry
 * word-level change ranges for intra-line emphasis.
 */
import { imageMimeFor } from './types'

export type RowKind = 'context' | 'add' | 'del' | 'mod' | 'hunk' | 'gap' | 'meta'

/** A collapsed run of unchanged lines the view can reveal on demand. */
export interface GapInfo {
  /** First hidden new-side (right) line number. */
  readonly rightStart: number
  /** Hidden line count; null when unbounded (trailing gap → EOF unknown). */
  readonly count: number | null
  /** oldLine = newLine + delta across the unchanged gap region. */
  readonly delta: number
  /** No visible block above (leading gap at file start). */
  readonly atStart: boolean
  /** No visible block below (trailing gap; count is null). */
  readonly atEnd: boolean
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

/** True when the diff only adds lines (new file). */
export function isAddOnlyDiff(unified: string): boolean {
  const body = bodyLines(unified)
  if (body.length === 0) return false
  return body.every((l) => l.startsWith('+') || l.startsWith(' ')) && body.some((l) => l.startsWith('+'))
    && /^\+\+\+ /m.test(unified) && /--- \/dev\/null/m.test(unified)
}

/** True when the diff only deletes lines (removed file). */
export function isDeleteOnlyDiff(unified: string): boolean {
  const body = bodyLines(unified)
  if (body.length === 0) return false
  return body.every((l) => l.startsWith('-') || l.startsWith(' ')) && body.some((l) => l.startsWith('-'))
    && /^\+\+\+ \/dev\/null/m.test(unified)
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

/** Parse a unified diff into aligned side-by-side rows with expandable gaps. */
export function buildSideBySide(unified: string): SideRow[] {
  const rows: SideRow[] = []
  const lines = unified.split('\n')
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
            rows.push(gapRow({ rightStart: 1, count: newStart - 1, delta, atStart: true, atEnd: false }))
          }
        } else {
          // Between-hunk gap: hidden new lines rightNo..newStart-1.
          const count = newStart - rightNo
          if (count > 0) {
            rows.push(gapRow({ rightStart: rightNo, count, delta, atStart: false, atEnd: false }))
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
  // Trailing gap: there may be unchanged lines below the last hunk. The diff
  // does not carry the file length, so the count is unknown (EOF-probed on
  // expand). Skip it for add/delete-only diffs where the whole file is shown.
  if (sawBody && !firstHunk && !isAddOnlyDiff(unified) && !isDeleteOnlyDiff(unified)) {
    rows.push(gapRow({ rightStart: rightNo, count: null, delta: leftNo - rightNo, atStart: false, atEnd: true }))
  }
  return pairDeletionsWithAdditions(rows)
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

  if (gap.atEnd) {
    // Trailing gap: reveal below the last hunk, keep a trailing gap unless EOF.
    replacement.push(...revealed)
    if (!eof && lines.length > 0) {
      replacement.push(gapRow({
        rightStart: revealedStart + lines.length,
        count: null, delta: gap.delta, atStart: false, atEnd: true,
      }))
    }
    return [...rows.slice(0, idx), ...replacement, ...rows.slice(idx + 1)]
  }

  const total = gap.count ?? lines.length
  if (direction === 'all' || lines.length >= total) {
    replacement.push(...revealed)
  } else if (direction === 'down') {
    // Revealed the top slice; a smaller gap remains below.
    replacement.push(...revealed)
    const remaining = total - lines.length
    replacement.push(gapRow({
      rightStart: gap.rightStart + lines.length,
      count: remaining, delta: gap.delta, atStart: false, atEnd: false,
    }))
  } else {
    // 'up': revealed the bottom slice; a smaller gap remains above.
    const remaining = total - lines.length
    replacement.push(gapRow({
      rightStart: gap.rightStart,
      count: remaining, delta: gap.delta, atStart: gap.atStart, atEnd: false,
    }))
    replacement.push(...revealed)
  }
  return [...rows.slice(0, idx), ...replacement, ...rows.slice(idx + 1)]
}
