/**
 * The repository switcher's client-side search (issue #161).
 *
 * The list a workspace offers can run to a hundred rows, so the block filters
 * what the host already listed instead of asking for another scan: the rows
 * are the same objects, in the same order, with the same disabled reasons —
 * only the rendering is narrowed. That boundary is the point: a search that
 * re-scanned the workspace would answer with repositories the panel cannot
 * certify, and one that re-ranked them would move rows out from under a
 * pointer already travelling the list.
 *
 * Matching is plain and predictable: the query splits on whitespace, every
 * term must appear somewhere in the row (name, workspace-file label, relative
 * path, absolute root), case-insensitively. No fuzzy spelling, no regex, no
 * wildcards — a query that means nothing matches nothing, and the empty state
 * says so instead of guessing.
 *
 * Kept pure so the term rules, the highlight ranges and the path-fragment
 * fallback are unit-tested rather than living in render code.
 */
import type { RepoChoice } from './repo-list.js'
import { repoDetail, repoLabel } from './repo-list.js'

/** One run of a rendered line: `hit` marks the part a query term covered. */
export interface RepoSearchSegment {
  readonly text: string
  readonly hit: boolean
}

/** Split a query into lowercase terms; blank input yields none. */
export function repoSearchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter((token) => token !== '')
}

/**
 * Whether one row satisfies a query: every term must land somewhere in the
 * row's identity — display name, workspace-file label, relative selector and
 * absolute root. The fields join with newlines so a term can never match
 * across a boundary that is not actually text (`…pe` + `site…` must not make
 * `pesite`).
 */
export function repoSearchMatch(choice: RepoChoice, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true
  const hay = `${choice.name}\n${choice.label ?? ''}\n${choice.path}\n${choice.root}`.toLowerCase()
  return tokens.every((token) => hay.includes(token))
}

/** The rows a query keeps, in list order; disabled rows stay among them. */
export function filterRepoChoices(choices: readonly RepoChoice[], tokens: readonly string[]): readonly RepoChoice[] {
  if (tokens.length === 0) return choices
  return choices.filter((choice) => repoSearchMatch(choice, tokens))
}

/**
 * Split a line into hit / non-hit runs for highlighting.
 *
 * A few Unicode characters change length when lowercased (`İ` → `i̇`), which
 * would shift every index past them; matching still works on such a line, so
 * the fallback is a single unhighlighted run rather than wrong ranges.
 */
export function repoSearchHighlight(text: string, tokens: readonly string[]): readonly RepoSearchSegment[] {
  const plain: readonly RepoSearchSegment[] = [{ text, hit: false }]
  if (tokens.length === 0 || text === '') return plain
  const lower = text.toLowerCase()
  if (lower.length !== text.length) return plain
  const marked = new Array<boolean>(text.length).fill(false)
  for (const token of tokens) {
    let at = lower.indexOf(token)
    while (at !== -1) {
      for (let i = at; i < at + token.length; i += 1) marked[i] = true
      at = lower.indexOf(token, at + 1)
    }
  }
  const segments: RepoSearchSegment[] = []
  let start = 0
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || marked[i] !== marked[start]) {
      segments.push({ text: text.slice(start, i), hit: marked[start] })
      start = i
    }
  }
  return segments.length > 0 ? segments : plain
}

/**
 * The row's grey line under a query: the detail the row already prints when
 * its terms are visible there, otherwise a fragment of the absolute root that
 * carries the first term the visible text hides — a match can come from the
 * root alone (the path line only states the relative selector), and a row
 * that matched must show where from.
 */
export function repoSearchDetail(choice: RepoChoice, tokens: readonly string[]): string {
  const detail = repoDetail(choice)
  if (tokens.length === 0) return detail
  const visible = `${repoLabel(choice)}\n${detail}`.toLowerCase()
  const hidden = tokens.filter((token) => !visible.includes(token))
  if (hidden.length === 0) return detail
  const root = choice.root
  const lowerRoot = root.toLowerCase()
  if (lowerRoot.length !== root.length) return detail
  for (const token of hidden) {
    const at = lowerRoot.indexOf(token)
    if (at === -1) continue
    const from = Math.max(0, at - 16)
    const to = Math.min(root.length, at + token.length + 24)
    return `${from > 0 ? '…' : ''}${root.slice(from, to)}${to < root.length ? '…' : ''}`
  }
  return detail
}
