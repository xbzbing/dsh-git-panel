/**
 * The candidates behind the two comparison pickers (「与分支或标签比较」 and
 * 「与修订版本比较」), and the rows they draw.
 *
 * Pure: no React, no DOM. The dialog in compare-flow.tsx only renders what these
 * return, so the grouping, the filtering, the row heights and the keyboard
 * cursor are asserted directly (test/unit/compare-refs.test.mjs).
 */
import type { GitPanelRemote } from './rpc.js'
import { queryAs } from './rpc.js'
import type { GitBranch, GraphCommit } from './types.js'
import type { GitKey } from './locales.js'

/** One candidate: a ref (branch / remote-tracking branch / tag) or a commit. */
export interface CompareRef {
  /** The revision handed to the host: a full ref name (so a branch and a tag
   * spelled the same never collide), or a commit's full hash. */
  readonly rev: string
  /** The name shown: the ref without its `refs/…` prefix, or a commit's subject. */
  readonly label: string
  readonly group: 'local' | 'remote' | 'tag' | 'commit'
  /** The abbreviated object the ref points at (absent when the host had none). */
  readonly shortHash?: string | null
  /** The branch HEAD is on. */
  readonly current?: boolean
  /** Commit rows only: who wrote it and when (ISO 8601). */
  readonly author?: string
  readonly dateIso?: string
}

/** Display order of the ref groups (the revisions picker is all `commit`). */
export const COMPARE_GROUPS = ['local', 'remote', 'tag'] as const

/** `refs/remotes/<remote>/HEAD` is the remote's symbolic default, not a branch. */
const SYMBOLIC_REMOTE_HEAD = /^refs\/remotes\/[^/]+\/HEAD$/

/**
 * The candidates a repository offers: every local branch, every remote-tracking
 * branch and every tag. Full ref names are used on the wire; the labels are the
 * short ones the rest of the panel shows.
 * @param branches - the `branches` query result.
 * @param tags - the `tags` query result.
 */
export function compareCandidates(
  branches: Extract<import('./types.js').GitQueryResult, { kind: 'branches' }>,
  tags: Extract<import('./types.js').GitQueryResult, { kind: 'tags' }>,
): readonly CompareRef[] {
  // The host reports each entry's full ref. Rebuilding it from the short name
  // is wrong in two everyday cases: a branch and a tag that share a name spell
  // as `heads/foo` / `tags/foo`, and a remote-tracking HEAD spells as its
  // remote (`origin`), which is not a ref at all. The prefix is only the
  // fallback for a host that predates the field.
  const local = branches.local.map((b: GitBranch): CompareRef => ({
    rev: b.ref ?? `refs/heads/${b.name}`, label: b.name, group: 'local', shortHash: b.shortHash,
    ...(b.name === branches.current ? { current: true } : {}),
  }))
  const remote = branches.remote
    // A remote-tracking HEAD spells as its remote alone (`origin`), and an old
    // host has no `ref` to tell it apart, so the shape of the name is the only
    // signal left: a real remote-tracking branch always carries `<remote>/<name>`.
    // New hosts also drop the symbolic row themselves; the exact `refs/remotes/
    // <remote>/HEAD` shape is the fallback, never a `/HEAD` name suffix — that
    // would hide a real branch called `feature/HEAD`.
    .filter((b: GitBranch) => b.name.includes('/')
      && (b.ref !== undefined
        ? !SYMBOLIC_REMOTE_HEAD.test(b.ref)
        : !b.name.endsWith('/HEAD')))
    .map((b: GitBranch): CompareRef => ({ rev: b.ref ?? `refs/remotes/${b.name}`, label: b.name, group: 'remote', shortHash: b.shortHash }))
  const tagRefs = tags.tags.map((tag: GitBranch): CompareRef => ({ rev: tag.ref ?? `refs/tags/${tag.name}`, label: tag.name, group: 'tag', shortHash: tag.shortHash }))
  return [...local, ...remote, ...tagRefs]
}

/** Case-insensitive substring filter. A ref matches on its name; a commit also
 * on its short hash and author, which is how people remember a revision. */
export function filterCandidates(candidates: readonly CompareRef[], needle: string): readonly CompareRef[] {
  const query = needle.trim().toLowerCase()
  if (query === '') return candidates
  return candidates.filter((ref) => [ref.label, ref.group === 'commit' ? ref.shortHash : null, ref.author]
    .some((field) => typeof field === 'string' && field.toLowerCase().includes(query)))
}

/** One drawn row: a group heading, or a pickable candidate. `index` counts
 * pickable rows only, so the keyboard cursor never lands on a heading. */
export type CompareRow =
  | { readonly kind: 'heading'; readonly title: GitKey; readonly count: number }
  | { readonly kind: 'ref'; readonly ref: CompareRef; readonly index: number }

const GROUP_LABEL: Readonly<Record<CompareRef['group'], GitKey>> = {
  local: 'overview.local',
  remote: 'overview.remote',
  tag: 'overview.tags',
  commit: 'menu.revisionsGroup',
}

/**
 * Flatten candidates into rows, a heading above each non-empty group. A list
 * that holds a single group carries no heading at all: a lone「本地」above the
 * only list there is names nothing the dialog title does not already say.
 */
export function compareRows(candidates: readonly CompareRef[]): readonly CompareRow[] {
  const counts = new Map<CompareRef['group'], number>()
  for (const ref of candidates) counts.set(ref.group, (counts.get(ref.group) ?? 0) + 1)
  const headed = counts.size > 1
  const rows: CompareRow[] = []
  let last: CompareRef['group'] | null = null
  let index = 0
  for (const ref of candidates) {
    if (headed && ref.group !== last) rows.push({ kind: 'heading', title: GROUP_LABEL[ref.group], count: counts.get(ref.group) ?? 0 })
    last = ref.group
    rows.push({ kind: 'ref', ref, index })
    index += 1
  }
  return rows
}

/** Row heights in px, matching `.gp-compare__heading` / `__row` / `__row--commit`. */
export const COMPARE_ROW_HEIGHTS = { heading: 28, ref: 32, commit: 48 } as const

/** The height one row takes in the virtualized list. */
export function compareRowHeight(row: CompareRow): number {
  if (row.kind === 'heading') return COMPARE_ROW_HEIGHTS.heading
  return row.ref.group === 'commit' ? COMPARE_ROW_HEIGHTS.commit : COMPARE_ROW_HEIGHTS.ref
}

/** Move the keyboard cursor by `delta` pickable rows, clamped to the list.
 * An empty list has no cursor (-1). */
export function moveCursor(cursor: number, delta: number, count: number): number {
  if (count <= 0) return -1
  return Math.max(0, Math.min(count - 1, (cursor < 0 ? (delta > 0 ? -1 : count) : cursor) + delta))
}

/**
 * The scroll offset that brings one row fully into view, or null when it is
 * already visible. Used for the keyboard cursor: the list is virtualized, so
 * `scrollIntoView` on a row that is not mounted would do nothing.
 */
export function revealOffset(tops: readonly number[], row: number, viewTop: number, viewHeight: number): number | null {
  const top = tops[row]
  const bottom = tops[row + 1]
  if (top === undefined || bottom === undefined || viewHeight <= 0) return null
  if (top < viewTop) return top
  if (bottom > viewTop + viewHeight) return bottom - viewHeight
  return null
}

/** The revisions picker's rows: one per commit of this file's history, newest
 * first. The subject is the label; hash, author and date ride along for the
 * second line and for the filter. */
export function revisionCandidates(commits: readonly GraphCommit[]): readonly CompareRef[] {
  return commits.map((commit): CompareRef => ({
    rev: commit.hash,
    label: commit.subject,
    group: 'commit',
    shortHash: commit.shortHash,
    author: commit.author,
    dateIso: commit.dateIso,
  }))
}

/** What the comparison overlay calls the old side once a candidate is picked:
 * a ref by its name, a commit by its short hash (a subject is too long for the
 * bar and not unique). */
export function pickedLabel(ref: CompareRef): string {
  return ref.group === 'commit' ? (ref.shortHash ?? ref.rev.slice(0, 7)) : ref.label
}

/** Read the candidates for one session; null while loading or after a failure. */
export async function loadCompareCandidates(
  remote: GitPanelRemote, sessionId: string,
): Promise<readonly CompareRef[] | null> {
  const [branchesRes, tagsRes] = await Promise.all([
    remote.query({ sessionId, query: { kind: 'branches' } }),
    remote.query({ sessionId, query: { kind: 'tags' } }),
  ])
  const branches = queryAs(branchesRes, 'branches')
  const tags = queryAs(tagsRes, 'tags')
  if (branches === null || tags === null) return null
  return compareCandidates(branches, tags)
}

/** One comparison names a path in one checkout of one session: a panel that has
 * moved since must not run it against the new checkout. */
export function compareApplies(
  request: { readonly sessionId: string; readonly repo: string } | null,
  sessionId: string | undefined,
  repo: string,
): boolean {
  return request !== null && sessionId !== undefined && request.sessionId === sessionId && request.repo === repo
}
