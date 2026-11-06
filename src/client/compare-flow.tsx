/**
 * The two comparison pickers: 「与分支或标签比较」 (branches, remote-tracking
 * branches and tags, grouped) and 「与修订版本比较」 (this file's commits on the
 * current branch). Picking one opens the revision diff through the panel (a
 * `rev` comparison: that revision against the work tree).
 *
 * The shell (backdrop, Escape, focus) is the shared `renderModalShell`. The
 * filter box owns the keyboard: ↑/↓ move a cursor over the pickable rows and
 * Enter compares against it, so the list itself never takes focus. The list is
 * virtualized (`use-viewport` + `virtual-list`): a repository with hundreds of
 * branches does not mount them all, which is also why the cursor is revealed by
 * offset (`revealOffset`) rather than by `scrollIntoView`.
 */
import { createElement as h, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitKey } from './locales.js'
import { renderModalShell, type ModalShellProps } from './ops-modals.js'
import {
  compareRowHeight, compareRows, filterCandidates, moveCursor, pickedLabel, revealOffset,
  type CompareRef, type CompareRow,
} from './compare-refs.js'
import { buildTops, windowRange } from './virtual-list.js'
import { useViewportTracker } from './use-viewport.js'
import { BranchCurrentIcon, BranchIcon, CommitIcon, FileIcon, HistoryIcon, SearchIcon, TagIcon } from './icons.js'
import { absoluteTime, timeAgo } from './time.js'

export interface ComparePickerProps {
  /** Which picker: refs (grouped) or this file's commits. */
  readonly mode: 'ref' | 'revision'
  /** Bar title, either picker's own. */
  readonly title: string
  /** The file the comparison is about, shown under the bar. */
  readonly path: string
  /** The candidates, or null while the first page is loading. */
  readonly candidates: readonly CompareRef[] | null
  readonly loading: boolean
  readonly failed: boolean
  /** Extra row appended after the list (the revisions picker's "load more"). */
  readonly footer?: JSX.Element | null
  readonly onPick: (rev: string, label: string) => void
  readonly onClose: () => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Overscan in px: a few rows past either edge so a fast scroll never shows a gap. */
const OVERSCAN_PX = 240
/** The list's vertical padding (`.gp-compare__list`): rows sit this far below
 * the scroller's own top, which the reveal math has to account for. */
const LIST_INSET = 4

/** The dialog: file line, filter box, the virtualized list and the key hints. */
export function ComparePicker({ mode, title, path, candidates, loading, failed, footer, onPick, onClose, t }: ComparePickerProps): JSX.Element | null {
  const [needle, setNeedle] = useState('')
  const [cursor, setCursor] = useState(0)
  // One clock per mount: relative times do not tick while the picker is open.
  const [now] = useState(() => Date.now())
  const listId = useId()
  const filtered = useMemo(() => filterCandidates(candidates ?? [], needle), [candidates, needle])
  const rows = useMemo(() => compareRows(filtered), [filtered])
  const tops = useMemo(() => buildTops(rows.map(compareRowHeight)), [rows])
  // Row position of each pickable index, for revealing the cursor.
  const rowOfPick = useMemo(() => {
    const out: number[] = []
    rows.forEach((row, at) => { if (row.kind === 'ref') out.push(at) })
    return out
  }, [rows])
  const tracker = useViewportTracker()
  const { viewport } = tracker
  const range = windowRange(tops, viewport.top, viewport.height, OVERSCAN_PX)
  const total = tops[rows.length] ?? 0
  const first = Math.max(0, Math.min(range.first, rows.length))
  const last = Math.max(first, Math.min(range.last, rows.length))
  const active = filtered.length === 0 ? -1 : Math.min(cursor, filtered.length - 1)

  // A new needle is a new list: start at its top, cursor on the first match.
  const listRef = useRef<HTMLDivElement | null>(null)
  const setListEl = tracker.setEl
  useEffect(() => {
    setCursor(0)
    if (listRef.current !== null) listRef.current.scrollTop = 0
  }, [needle])

  // Keep the keyboard cursor on screen. Only keyboard moves set `revealRef`:
  // a pointer hovering a half-visible row must not scroll the list under it.
  const revealRef = useRef(false)
  useEffect(() => {
    if (!revealRef.current) return
    revealRef.current = false
    const el = listRef.current
    const row = rowOfPick[active]
    if (el === null || row === undefined) return
    // Rows live LIST_INSET below the scroller's top, and the bottom padding
    // should stay visible under the last revealed row.
    const next = revealOffset(tops, row, el.scrollTop - LIST_INSET, el.clientHeight - LIST_INSET * 2)
    if (next !== null) el.scrollTop = next + LIST_INSET
  }, [active, rowOfPick, tops])

  const pick = (ref: CompareRef): void => onPick(ref.rev, pickedLabel(ref))

  const renderRow = (row: CompareRow): JSX.Element => {
    if (row.kind === 'heading') {
      return h('div', {
        key: `h:${row.title}`, className: 'gp-compare__heading', role: 'presentation',
        style: { height: compareRowHeight(row) },
      }, [
        h('span', { key: 't', className: 'gp-compare__heading-title' }, t(row.title)),
        h('span', { key: 'n', className: 'gp-compare__count' }, String(row.count)),
      ])
    }
    const { ref, index } = row
    const isActive = index === active
    const common = {
      key: ref.rev,
      id: `${listId}-${index}`,
      role: 'option',
      'aria-selected': isActive,
      className: `gp-compare__row${ref.group === 'commit' ? ' gp-compare__row--commit' : ''}${isActive ? ' gp-compare__row--active' : ''}`,
      style: { height: compareRowHeight(row) },
      onMouseMove: () => { if (index !== active) setCursor(index) },
      // A press on a row must not pull focus out of the filter box: the box is
      // what the keyboard talks to.
      onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault(),
      onClick: () => pick(ref),
    }
    if (ref.group === 'commit') {
      const when = ref.dateIso === undefined ? '' : timeAgo(ref.dateIso, now, t)
      return h('div', { ...common, title: ref.dateIso === undefined ? undefined : absoluteTime(ref.dateIso) }, [
        h('span', { key: 'i', className: 'gp-compare__icon' }, h(CommitIcon, { size: 14 })),
        h('span', { key: 'b', className: 'gp-compare__body' }, [
          h('span', { key: 'l', className: 'gp-compare__label' }, ref.label),
          h('span', { key: 'm', className: 'gp-compare__meta' }, [
            h('span', { key: 'h', className: 'gp-compare__hash' }, ref.shortHash ?? ''),
            ref.author === undefined || ref.author === '' ? null : h('span', { key: 'a', className: 'gp-compare__author' }, ref.author),
            when === '' ? null : h('span', { key: 'w', className: 'gp-compare__when' }, when),
          ]),
        ]),
      ])
    }
    const icon = ref.group === 'tag'
      ? h(TagIcon, { size: 14 })
      : ref.current === true ? h(BranchCurrentIcon, { size: 14 }) : h(BranchIcon, { size: 14 })
    return h('div', common, [
      h('span', { key: 'i', className: `gp-compare__icon${ref.current === true ? ' gp-compare__icon--current' : ''}` }, icon),
      h('span', { key: 'l', className: 'gp-compare__label' }, ref.label),
      ref.current === true ? h('span', { key: 'c', className: 'gp-branch-row__head gp-compare__badge' }, 'HEAD') : null,
      ref.shortHash === undefined || ref.shortHash === null || ref.shortHash === ''
        ? null
        : h('span', { key: 'h', className: 'gp-compare__hash gp-compare__hash--end' }, ref.shortHash),
    ])
  }

  const state = (key: string, text: string, busy = false): JSX.Element => h('div', { key, className: 'gp-compare__state' }, [
    busy ? h(StateDot, { key: 'd', state: 'ongoing', size: 16 }) : null,
    h('span', { key: 't' }, text),
  ])
  const revision = mode === 'revision'
  const content: JSX.Element | JSX.Element[] = loading && candidates === null
    ? state('loading', t('common.loading'), true)
    : failed && candidates === null
      ? state('failed', t(revision ? 'menu.revisionsFailed' : 'menu.compareFailed'))
      : (candidates ?? []).length === 0 && revision
        ? state('empty', t('menu.revisionsEmpty'))
        : rows.length === 0
          ? state('none', t(revision ? 'menu.revisionsNoMatch' : 'menu.compareNoMatch'))
          : [
            h('div', { key: 'pad', style: { height: tops[first] ?? 0 } }),
            ...rows.slice(first, last).map(renderRow),
            h('div', { key: 'tail', style: { height: Math.max(0, total - (tops[last] ?? 0)) } }),
            footer === undefined || footer === null ? h('span', { key: 'no-footer' }) : footer,
          ]

  const slash = path.lastIndexOf('/')
  const counted = needle.trim() !== '' && candidates !== null
  const props: ModalShellProps = {
    onClose,
    title,
    icon: h(revision ? HistoryIcon : BranchIcon, { size: 15 }),
    portalKey: 'compare-picker',
    variant: 'gp-modal--picker',
    body: [
      h('div', { key: 'head', className: 'gp-compare__head' }, [
        h('div', { key: 'file', className: 'gp-compare__file', title: path }, [
          h('span', { key: 'i', className: 'gp-compare__file-icon' }, h(FileIcon, { size: 13 })),
          slash < 0 ? null : h('span', { key: 'd', className: 'gp-compare__dir' }, path.slice(0, slash + 1)),
          h('span', { key: 'n', className: 'gp-compare__name' }, path.slice(slash + 1)),
        ]),
        h('label', { key: 'search', className: 'gp-compare__search' }, [
          h('span', { key: 'i', className: 'gp-compare__search-icon' }, h(SearchIcon, { size: 14 })),
          h('input', {
            key: 'filter', className: 'gp-compare__filter', type: 'text', autoFocus: true,
            role: 'combobox', 'aria-expanded': true, 'aria-controls': listId, 'aria-autocomplete': 'list',
            ...(active >= 0 ? { 'aria-activedescendant': `${listId}-${active}` } : {}),
            'aria-label': t(revision ? 'menu.revisionsFilter' : 'menu.compareFilter'),
            placeholder: t(revision ? 'menu.revisionsFilter' : 'menu.compareFilter'),
            value: needle, spellCheck: false, autoComplete: 'off',
            onInput: (event: { currentTarget: { value: string } }) => setNeedle(event.currentTarget.value),
            onKeyDown: (event: { key: string; preventDefault: () => void; nativeEvent?: { isComposing?: boolean } }) => {
              if (event.nativeEvent?.isComposing === true) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                revealRef.current = true
                setCursor((at) => moveCursor(Math.min(at, filtered.length - 1), event.key === 'ArrowDown' ? 1 : -1, filtered.length))
                return
              }
              if (event.key !== 'Enter') return
              const target = filtered[active]
              if (target === undefined) return
              event.preventDefault()
              pick(target)
            },
          }),
          counted ? h('span', { key: 'n', className: 'gp-compare__total' }, `${filtered.length} / ${(candidates ?? []).length}`) : null,
        ]),
      ]),
      h('div', {
        key: 'list', id: listId, role: 'listbox', 'aria-label': title, className: 'gp-compare__list',
        ref: (el: HTMLDivElement | null): void => { listRef.current = el; setListEl(el) },
      }, content as JSX.Element),
      h('div', { key: 'keys', className: 'gp-compare__keys', 'aria-hidden': 'true' }, t('menu.compareKeys')),
    ],
    footer: null,
    t,
  }
  return renderModalShell(props)
}
