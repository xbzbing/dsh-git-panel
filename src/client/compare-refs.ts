/**
 * The ref candidates behind the「与分支或标签比较」picker, and the rows it draws.
 *
 * Pure: no React, no DOM. The dialog in compare-flow.tsx only renders what these
 * return, so the grouping, the filtering and the "single group carries no
 * heading" rule are asserted directly (test/unit/compare-refs.test.mjs).
 */
import type { GitPanelRemote } from './rpc.js'
import { queryAs } from './rpc.js'
import type { GitBranch, GraphCommit } from './types.js'
import type { GitKey } from './locales.js'

/** One candidate ref. */
export interface CompareRef {
  /** The revision handed to the host (a full ref name, so a branch and a tag
   * spelled the same never collide). */
  readonly rev: string
  /** The name shown, without the `refs/…` prefix. */
  readonly label: string
  readonly group: 'local' | 'remote' | 'tag'
}

/** Display order of the three groups. */
export const COMPARE_GROUPS = ['local', 'remote', 'tag'] as const

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
  const local = branches.local.map((b: GitBranch) => ({ rev: b.ref ?? `refs/heads/${b.name}`, label: b.name, group: 'local' as const }))
  const remote = branches.remote
    // A remote-tracking HEAD spells as its remote alone (`origin`), and an old
    // host has no `ref` to tell it apart, so the shape of the name is the only
    // signal left: a real remote-tracking branch always carries `<remote>/<name>`.
    .filter((b: GitBranch) => b.name.includes('/') && !b.name.endsWith('/HEAD'))
    .map((b: GitBranch) => ({ rev: b.ref ?? `refs/remotes/${b.name}`, label: b.name, group: 'remote' as const }))
  const tagRefs = tags.tags.map((tag: GitBranch) => ({ rev: tag.ref ?? `refs/tags/${tag.name}`, label: tag.name, group: 'tag' as const }))
  return [...local, ...remote, ...tagRefs]
}

/** Case-insensitive substring filter over the displayed label. */
export function filterCandidates(candidates: readonly CompareRef[], needle: string): readonly CompareRef[] {
  const query = needle.trim().toLowerCase()
  if (query === '') return candidates
  return candidates.filter((ref) => ref.label.toLowerCase().includes(query))
}

/** Rows to draw: each group's first candidate carries its heading. */
export interface CompareRow {
  readonly ref: CompareRef
  readonly heading: GitKey | null
}

/**
 * Flatten candidates into rows, one heading per non-empty group. A list that
 * holds a single group carries no headings at all: a lone「本地」above a list of
 * commits names nothing the dialog does not already say.
 */
export function compareRows(candidates: readonly CompareRef[]): readonly CompareRow[] {
  let groups = 0
  let seen: CompareRef['group'] | null = null
  for (const ref of candidates) {
    if (ref.group !== seen) { groups += 1; seen = ref.group }
  }
  const rows: CompareRow[] = []
  if (groups < 2) {
    for (const ref of candidates) rows.push({ ref, heading: null })
    return rows
  }
  let last: CompareRef['group'] | null = null
  for (const ref of candidates) {
    const heading = ref.group === last ? null : GROUP_LABEL[ref.group]
    rows.push({ ref, heading })
    last = ref.group
  }
  return rows
}

const GROUP_LABEL: Readonly<Record<CompareRef['group'], GitKey>> = {
  local: 'overview.local',
  remote: 'overview.remote',
  tag: 'overview.tags',
}

/** Row height, matching `.gp-compare__row`. */
export const COMPARE_ROW_H = 30

/** The revisions picker's rows: one row per commit of this file's history.
 * `compareRows` drops the heading for a single-group list, and the label
 * carries the short hash next to the subject so two same-titled commits stay
 * distinguishable. */
export function revisionCandidates(commits: readonly GraphCommit[]): readonly CompareRef[] {
  return commits.map((commit) => ({
    rev: commit.hash,
    label: `${commit.shortHash}  ${commit.subject}`,
    group: 'local' as const,
  }))
}

/** A commit its own revision comparison: the label shown in the overlay bar. */
export function revisionLabel(commit: { shortHash: string }): string {
  return commit.shortHash
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
