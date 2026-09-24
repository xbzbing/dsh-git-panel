/**
 * Unified-diff parsing into side-by-side rows + summary. Self-contained;
 * no external diff library — a git unified diff is line-oriented and cheap
 * to walk.
 */

export type RowKind = 'context' | 'add' | 'del' | 'hunk' | 'meta'

export interface SideRow {
  readonly kind: RowKind
  /** Left (old) line number, null for added/meta rows. */
  readonly leftNo: number | null
  /** Right (new) line number, null for deleted/meta rows. */
  readonly rightNo: number | null
  readonly leftText: string | null
  readonly rightText: string | null
  /** For hunk/meta rows the raw header text. */
  readonly text?: string
}

/** True when the diff is a binary-file marker. */
export function isBinaryDiff(unified: string): boolean {
  return /^Binary files .* differ$/m.test(unified) || /^GIT binary patch$/m.test(unified)
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

/** Parse a unified diff into aligned side-by-side rows. */
export function buildSideBySide(unified: string): SideRow[] {
  const rows: SideRow[] = []
  const lines = unified.split('\n')
  let leftNo = 0
  let rightNo = 0
  let i = 0
  // Skip the file header lines until the first hunk.
  for (; i < lines.length; i++) {
    if (lines[i]!.startsWith('@@')) break
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (m) {
        leftNo = Number(m[1])
        rightNo = Number(m[2])
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
    } else if (marker === '-') {
      rows.push({ kind: 'del', leftNo, rightNo: null, leftText: content, rightText: null })
      leftNo++
    } else if (marker === ' ') {
      rows.push({ kind: 'context', leftNo, rightNo, leftText: content, rightText: content })
      leftNo++
      rightNo++
    }
    // any other prefix (diff/index/---/+++) between hunks: ignore
  }
  return pairDeletionsWithAdditions(rows)
}

/**
 * Merge a run of deletions immediately followed by additions into paired rows
 * (IDE-style side-by-side alignment). Leftover deletions/additions stay
 * single-sided.
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
        out.push({
          kind: d && a ? 'context' : d ? 'del' : 'add',
          leftNo: d ? d.leftNo : null,
          rightNo: a ? a.rightNo : null,
          leftText: d ? d.leftText : null,
          rightText: a ? a.rightText : null,
        })
      }
      i = j
    } else {
      out.push(row)
      i++
    }
  }
  return out
}

/** Extract the added-side content (new-file view). */
export function extractAddedContent(unified: string): string {
  return bodyLines(unified).filter((l) => l.startsWith('+')).map((l) => l.slice(1)).join('\n')
}

/** Extract the deleted-side content (removed-file view). */
export function extractDeletedContent(unified: string): string {
  return bodyLines(unified).filter((l) => l.startsWith('-')).map((l) => l.slice(1)).join('\n')
}
