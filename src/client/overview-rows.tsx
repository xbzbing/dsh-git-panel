/**
 * Rows of the overview surfaces: the commit row (history list), the changed-file
 * tree (detail pane) and the hover card that shows a commit's full message.
 * Split out of OverviewTab so the row memo and its props live next to the JSX
 * they guard, and the tab file keeps only orchestration.
 */
import { createElement as h, memo } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import type { GraphCommit } from './types.js'
import type { GitKey } from './locales.js'
import { ChevronIcon } from './icons.js'
import { CommitGraph } from './CommitGraph.js'
import type { GraphRow } from './git-graph.js'
import type { buildFileTree } from './file-tree.js'
import { absoluteDateTime, absoluteTime, timeAgo } from './time.js'
import { statusChar, statusClass } from './status.js'

export interface HoverCardCbs {
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Floating card showing a commit's full message (comment), anchored near the pointer. */
export function renderHoverCard(
  hover: { commit: GraphCommit; x: number; y: number } | null,
  body: string | null,
  t: HoverCardCbs['t'],
): JSX.Element | null {
  if (hover === null || typeof document === 'undefined') return null
  const maxW = 460
  const left = Math.min(hover.x + 16, (typeof window !== 'undefined' ? window.innerWidth : 1200) - maxW - 12)
  const top = hover.y + 14
  const card = h('div', { className: 'gp-hovercard', style: { left, top, maxWidth: maxW } }, [
    h('div', { key: 'subj', className: 'gp-hovercard__subject' }, hover.commit.subject),
    h('div', { key: 'meta', className: 'gp-hovercard__meta' }, [
      h('span', { key: 'h', className: 'gp-commit-hash' }, hover.commit.shortHash),
      h('span', { key: 'a' }, hover.commit.author),
      h('span', { key: 't' }, absoluteDateTime(hover.commit.dateIso)),
    ]),
    body === null
      ? h('div', { key: 'l', className: 'gp-hovercard__loading' }, t('common.loading'))
      : body === ''
        ? h('div', { key: 'e', className: 'gp-hovercard__loading' }, t('overview.noMessage'))
        : h('pre', { key: 'body', className: 'gp-hovercard__body' }, body),
  ])
  return createPortal(card, document.body, 'commit-hovercard')
}

export interface RowProps {
  row: GraphRow
  selected: boolean
  current: boolean
  gridTpl: string
  laneCount: number
  now: number
  compact: boolean
  /** Two-line rows without compact's touch padding; hover stays decorative (no
   * message card — the stacked layout shows the detail below the list). */
  stacked: boolean
  rowH: number
  /** Takes the row's commit rather than closing over it, so this props object
   * keeps a stable identity across renders and `memo` can skip the row. */
  onSelect: (commit: GraphCommit) => void
  onHoverEnter: (commit: GraphCommit, x: number, y: number) => void
  onHoverLeave: () => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

export const CommitRow = memo(function CommitRow({ row, ...cb }: RowProps): JSX.Element {
  const c = row.commit
  const refChips = c.refs.map((r) => h('span', {
    key: r.name,
    className: `gp-ref-chip${r.head ? ' gp-ref-chip--head' : ''}${r.kind === 'remote' ? ' gp-ref-chip--remote' : ''}${r.kind === 'tag' ? ' gp-ref-chip--tag' : ''}`,
  }, r.name))
  const graphCell = h('div', { key: 'g', className: 'gp-graph-cell' }, h(CommitGraph, { row, laneCount: cb.laneCount, rowH: cb.rowH, current: cb.current }))
  // Compact: two stacked lines (subject / hash·author·time) beside the graph,
  // taller rows for touch, and no hover handlers (tap drills into the detail).
  // Stacked reuses the two-line shape at pointer density with a CSS hover tint:
  // the message lives in the detail pane right below, so no card and no fetch.
  if (cb.compact || cb.stacked) {
    return h('div', {
      key: c.hash,
      className: `gp-commit-row gp-commit-row--compact${cb.selected ? ' gp-commit-row--active' : ''}`,
      style: { gridTemplateColumns: cb.gridTpl, height: `${cb.rowH}px` },
      onClick: () => cb.onSelect(c),
    }, [
      graphCell,
      h('div', { key: 'tx', className: 'gp-commit-lines' }, [
        h('div', { key: 's', className: 'gp-commit-subject' }, [...refChips, c.subject]),
        h('div', { key: 'm', className: 'gp-commit-sub' }, [
          h('span', { key: 'h', className: 'gp-commit-hash' }, c.shortHash),
          h('span', { key: 'a', className: 'gp-commit-author' }, c.author),
          h('span', { key: 'd', className: 'gp-commit-date' }, timeAgo(c.dateIso, cb.now, cb.t)),
        ]),
      ]),
    ])
  }
  return h('div', {
    key: c.hash,
    className: `gp-commit-row${cb.selected ? ' gp-commit-row--active' : ''}`,
    style: { gridTemplateColumns: cb.gridTpl },
    onClick: () => cb.onSelect(c),
    // Hover only for a real pointer: a tap synthesizes mouseenter and never
    // sends mouseleave, so on a touch screen the card would stay up until the
    // next row was tapped (the same rule `tip.tsx` applies).
    onPointerEnter: (e: { pointerType: string; clientX: number; clientY: number }) => {
      if (e.pointerType === 'mouse') cb.onHoverEnter(c, e.clientX, e.clientY)
    },
    onPointerLeave: (e: { pointerType: string }) => { if (e.pointerType === 'mouse') cb.onHoverLeave() },
  }, [
    graphCell,
    h('div', { key: 's', className: 'gp-commit-subject' }, [...refChips, c.subject]),
    h('div', { key: 'h', className: 'gp-commit-hash' }, c.shortHash),
    h('div', { key: 'a', className: 'gp-commit-author' }, c.author),
    h('div', { key: 'd', className: 'gp-commit-date', title: absoluteTime(c.dateIso) }, timeAgo(c.dateIso, cb.now, cb.t)),
  ])
})

export interface FileTreeCbs {
  activePath: string | null
  openTitle: string
  onOpen: (path: string) => void
  collapsed: ReadonlySet<string>
  onToggleDir: (path: string) => void
  expandLabel: string
  collapseLabel: string
}

export function renderFileTree(nodes: ReturnType<typeof buildFileTree>, cb: FileTreeCbs): JSX.Element {
  const rows: JSX.Element[] = []
  const walk = (list: ReturnType<typeof buildFileTree>, depth: number): void => {
    for (const node of list) {
      if (node.dir) {
        const isCollapsed = cb.collapsed.has(node.path)
        rows.push(h('div', {
          key: node.path,
          className: 'gp-tree-row gp-tree-row--dir',
          style: { paddingLeft: 10 + depth * 14 },
          title: isCollapsed ? cb.expandLabel : cb.collapseLabel,
          role: 'button',
          tabIndex: 0,
          'aria-expanded': !isCollapsed,
          onClick: () => cb.onToggleDir(node.path),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cb.onToggleDir(node.path) }
          },
        }, [
          h(ChevronIcon, { key: 'c', size: 11, open: !isCollapsed }),
          h('span', { key: 'n', className: 'gp-tree-name' }, node.name),
        ]))
        if (!isCollapsed) walk(node.children, depth + 1)
      } else {
        const status = String(node.meta ?? 'modified')
        const active = cb.activePath === node.path
        rows.push(h('div', {
          key: node.path,
          className: `gp-tree-row${active ? ' gp-tree-row--active' : ''}`,
          style: { paddingLeft: 10 + depth * 14 },
          title: cb.openTitle,
          onClick: () => cb.onOpen(node.path),
        }, [
          h('span', { key: 'st', className: `gp-status-badge ${statusClass(status)}` }, (statusChar[status] ?? status[0] ?? 'M').toUpperCase()),
          h('span', { key: 'n', className: 'gp-tree-name' }, node.name),
        ]))
      }
    }
  }
  walk(nodes, 0)
  return h('div', {}, rows)
}

