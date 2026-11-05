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
import type { GitKey } from './locales.js'
import { renderModalShell, type ModalShellProps } from './ops-modals.js'
import {
  COMPARE_ROW_H, compareRows, filterCandidates, type CompareRef,
} from './compare-refs.js'
import { buildTops, windowRange } from './virtual-list.js'
import { useViewportTracker } from './use-viewport.js'

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
