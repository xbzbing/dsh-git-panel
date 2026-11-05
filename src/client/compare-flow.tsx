/**
 * The「与分支或标签比较」picker: a filter box over the repository's branches and
 * tags, grouped as local / remote / tag. Picking one opens the revision diff
 * through the panel (a `rev` comparison: that ref against the work tree).
 *
 * The shell (backdrop, Escape, focus) is the shared `renderModalShell`; the list
 * is virtualized through `vue-viewport` + `virtual-list` so a repository with
 * hundreds of branches does not mount them all.
 */
import { createElement as h, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitPanelRemote } from './rpc.js'
import { queryAs } from './rpc.js'
import type { GitBranch } from './types.js'
import type { GitKey } from './locales.js'
import { renderModalShell, type ModalShellProps } from './ops-modals.js'
import { buildTops, windowRange } from './virtual-list.js'
import { useViewportTracker } from './use-viewport.js'

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
  return [
    ...branches.local.map((b: GitBranch) => ({ rev: `refs/heads/${b.name}`, label: b.name, group: 'local' as const })),
    ...branches.remote.map((b: GitBranch) => ({ rev: `refs/remotes/${b.name}`, label: b.name, group: 'remote' as const })),
    ...tags.tags.map((tag: GitBranch) => ({ rev: `refs/tags/${tag.name}`, label: tag.name, group: 'tag' as const })),
  ]
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

/** Flatten candidates into rows, one heading per non-empty group. */
export function compareRows(candidates: readonly CompareRef[]): readonly CompareRow[] {
  const rows: CompareRow[] = []
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

export interface ComparePickerProps {
  /** Bar title, either picker's own. */
  readonly title: string
  /** The file the comparison is about, shown under the bar. */
  readonly path: string
  /** Candidate rows already grouped / filtered per row's `group`. */
  readonly candidates: readonly CompareRef[] | null
  readonly loading: boolean
  readonly failed: boolean
  /** Extra row appended after the list (the revisions picker's "load more"). */
  readonly footer?: JSX.Element | null
  readonly onPick: (rev: string, label: string) => void
  readonly onClose: () => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** The dialog: filter box, then the virtualized grouped list. */
export function ComparePicker({ title, path, candidates, loading, failed, footer, onPick, onClose, t }: ComparePickerProps): JSX.Element | null {
  const [needle, setNeedle] = useState('')
  const filtered = useMemo(() => filterCandidates(candidates ?? [], needle), [candidates, needle])
  const rows = useMemo(() => compareRows(filtered), [filtered])
  const tops = useMemo(() => buildTops(rows.map(() => COMPARE_ROW_H)), [rows])
  const tracker = useViewportTracker()
  const { viewport } = tracker
  const range = windowRange(tops, viewport.top, viewport.height, COMPARE_ROW_H * 8)
  const total = tops[rows.length] ?? 0
  const first = Math.max(0, Math.min(range.first, rows.length))
  const last = Math.max(first, Math.min(range.last, rows.length))
  const slice = rows.slice(first, last)

  // A new needle is a new list: start at its top.
  const listRef = useRef<HTMLDivElement | null>(null)
  const setListEl = tracker.setEl
  useEffect(() => {
    if (listRef.current !== null) listRef.current.scrollTop = 0
  }, [needle])

  const empty: JSX.Element | JSX.Element[] = loading && candidates === null
    ? h('div', { key: 'loading', className: 'gp-empty' }, t('common.loading'))
    : failed
      ? h('div', { key: 'failed', className: 'gp-empty' }, t('menu.compareFailed'))
      : rows.length === 0
        ? h('div', { key: 'none', className: 'gp-empty' }, t('menu.compareNoMatch'))
        : [
          h('div', { key: 'pad', style: { height: tops[first] ?? 0 } }),
          ...slice.map(({ ref, heading }) => h('button', {
            key: ref.rev, type: 'button', className: 'gp-compare__row', style: { height: COMPARE_ROW_H },
            onClick: () => onPick(ref.rev, ref.label),
          }, [
            heading === null
              ? h('span', { key: 'h' })
              : h('span', { key: 'h', className: 'gp-compare__group' }, t(heading)),
            h('span', { key: 'l', className: 'gp-compare__label' }, ref.label),
          ])),
          h('div', { key: 'tail', style: { height: Math.max(0, total - (tops[last] ?? 0)) } }),
          footer === undefined || footer === null ? h('span', { key: 'no-footer' }) : footer,
        ]

  const props: ModalShellProps = {
    onClose,
    title,
    portalKey: 'compare-picker',
    body: [
      h('div', { key: 'path', className: 'gp-compare__path' }, path),
      h('input', {
        key: 'filter', className: 'gp-input gp-compare__filter', type: 'text', autoFocus: true,
        'aria-label': t('menu.compareFilter'),
        placeholder: t('menu.compareFilter'), value: needle,
        onInput: (event: { currentTarget: { value: string } }) => setNeedle(event.currentTarget.value),
        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          if (event.key !== 'Enter' || filtered.length !== 1) return
          event.preventDefault()
          onPick(filtered[0].rev, filtered[0].label)
        },
      }),
      h('div', {
        key: 'list', className: 'gp-compare__list',
        ref: (el: HTMLDivElement | null): void => { listRef.current = el; setListEl(el) },
      }, empty as JSX.Element),
    ],
    footer: null,
    t,
  }
  return renderModalShell(props)
}

/** The revisions picker's rows: one row per commit of this file's history. The
 * heading is suppressed (a single group), and the label carries the short hash
 * next to the subject so two same-titled commits stay distinguishable. */
export function revisionCandidates(commits: readonly import('./types.js').GraphCommit[]): readonly CompareRef[] {
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
