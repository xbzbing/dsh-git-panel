/**
 * Branch / tag surfaces of the overview: the scrolling list, its rows and the
 * compact bottom sheet. Split out of OverviewTab so the tree rendering and the
 * sheet's overlay contract sit in one place.
 */
import { createElement as h } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import type { GitBranch } from './types.js'
import type { GitKey } from './locales.js'
import { BranchCurrentIcon, BranchIcon, BranchPrimaryIcon, BranchSyncIcon, ChevronIcon, CloseIcon, FolderIcon, TagIcon } from './icons.js'
import type { BranchTreeNode } from './branch-tree.js'
import { OVERLAY_ATTR } from './dialog-focus.js'
import { useRowSlider } from './row-slider.js'
import type { BranchOption } from './branch-options.js'
import type { BranchTree } from './overview-hooks.js'

/** Row geometry of the branch/tag list; the compact sheet indents the same way. */
export const BRANCH_BASE = 22
export const BRANCH_INDENT = 24

export interface BranchCbs {
  onFilter: (ref: string | null) => void
  /** Switch targets by row key; a row without one (current branch, tags) has no switch button. */
  switchOptions: ReadonlyMap<string, BranchOption>
  /** Opens the switch confirm; the row click itself stays the history filter. */
  onSwitch: (option: BranchOption) => void
  onToggle: (section: string) => void
  onRetry: () => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Folded trees for the three ref sections, built once per snapshot. */
export interface BranchTrees {
  readonly local: readonly BranchTreeNode[]
  readonly localPinned: readonly GitBranch[]
  readonly localPrimary: string | null
  readonly remotePrimary: string | null
  readonly remote: readonly BranchTreeNode[]
  readonly tags: readonly BranchTreeNode[]
}

export interface BranchScrollProps {
  readonly tree: BranchTree | null
  readonly treeError: boolean
  readonly activeRef: string | null
  readonly closed: ReadonlySet<string>
  readonly cbs: BranchCbs
  readonly trees: BranchTrees
}

/** The branch tree's scroller, with the panel's travelling fill behind the
 * history filter row (see row-slider.tsx): picking another ref slides the
 * highlight instead of repainting two rows in a single frame. With no filter
 * there is no fill; the checked-out branch carries its own mark (HEAD chip and
 * icon colour), so the two never compete for the same cue. Folding a section
 * moves the rows below it, so the fold set is part of what the fill is
 * measured from. */
export function BranchScroll({ tree, treeError, activeRef, closed, cbs, trees }: BranchScrollProps): JSX.Element {
  const slider = useRowSlider({ activeSelector: '.gp-branch-row--active', deps: [activeRef, tree, trees, closed] })
  return h('div', { className: 'gp-col-left__scroll', ref: slider.ref }, [
    slider.slider,
    renderBranchList(tree, treeError, activeRef, closed, cbs, trees),
  ])
}

export function renderBranchList(tree: BranchTree | null, treeError: boolean, activeRef: string | null, closed: ReadonlySet<string>, cb: BranchCbs, trees: BranchTrees): JSX.Element {
  if (treeError) {
    return h('div', { className: 'gp-empty' }, [
      h('span', { key: 'm' }, cb.t('overview.branchesError')),
      h('button', { key: 'r', type: 'button', className: 'gp-btn', style: { marginTop: 8 }, onClick: cb.onRetry }, cb.t('common.retry')),
    ])
  }
  if (tree === null) return h('div', { className: 'gp-empty' }, cb.t('common.loading'))
  /** One branch row. `label` is the last path segment; `title` keeps the full ref. */
  const branchRow = (b: GitBranch, label: string, depth: number, sectionKey: string, icon: JSX.Element): JSX.Element => {
    const ref = b.name
    const isCurrent = sectionKey === 'local' && tree.current === b.name
    const isPrimary = (sectionKey === 'local' && trees.localPrimary === b.name) || (sectionKey === 'remote' && trees.remotePrimary === b.name)
    const cls = `gp-branch-row${activeRef === ref ? ' gp-branch-row--active' : ''}${isCurrent ? ' gp-branch-row--current' : ''}${isPrimary ? ' gp-branch-row--primary' : ''}`
    const target = cb.switchOptions.get(`${sectionKey}:${b.name}`)
    const roleLabel = [isCurrent ? cb.t('overview.currentBranch') : '', isPrimary ? cb.t('overview.primaryBranch') : ''].filter(Boolean).join(' · ')
    const rowIcon = isCurrent ? h(BranchCurrentIcon, { size: 14 }) : isPrimary ? h(BranchPrimaryIcon, { size: 14 }) : icon
    const sync = (direction: 'ahead' | 'behind', count: number | undefined): JSX.Element | null => count && count > 0
      ? h('span', { key: direction, className: 'gp-branch-row__sync', title: cb.t(direction === 'ahead' ? 'overview.branchAhead' : 'overview.branchBehind', { n: count }), 'aria-label': cb.t(direction === 'ahead' ? 'overview.branchAhead' : 'overview.branchBehind', { n: count }) }, [
          h(BranchSyncIcon, { key: 'icon', size: 12, direction }),
          h('span', { key: 'count' }, count),
        ])
      : null
    return h('div', {
      key: b.name, className: cls, style: { paddingLeft: BRANCH_BASE + depth * BRANCH_INDENT }, title: b.name,
      'data-current': isCurrent ? 'true' : undefined, 'data-primary': isPrimary ? 'true' : undefined,
      onClick: () => cb.onFilter(activeRef === ref ? null : ref),
    }, [
      h('span', { key: 'i', className: `gp-branch-row__ic${isCurrent ? ' gp-branch-row__ic--current' : isPrimary ? ' gp-branch-row__ic--primary' : ''}`, title: roleLabel || undefined, 'aria-label': roleLabel || undefined }, rowIcon),
      h('span', { key: 'n', className: 'gp-tree-name' }, label),
      (b.ahead || b.behind) ? h('span', { key: 't', className: 'gp-branch-row__track' }, [sync('ahead', b.ahead), sync('behind', b.behind)]) : null,
      // The checked-out branch: the icon already names the role for assistive
      // tech, so the chip is visual only.
      isCurrent ? h('span', { key: 'head', className: 'gp-branch-row__head', 'aria-hidden': 'true' }, 'HEAD') : null,
      // Shown on hover (always on touch); stops propagation so switching
      // never also toggles the row's history filter.
      target === undefined ? null : h('button', {
        key: 'sw', type: 'button', className: 'gp-branch-row__switch',
        title: cb.t(target.createFrom === undefined ? 'switch.rowTitle' : 'switch.rowTitleTrack', { name: target.name, ref: target.label }),
        onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); cb.onSwitch(target) },
      }, cb.t('switch.action')),
    ])
  }
  /** Slash-delimited refs fold into directories: `feat/a` + `feat/b` → `feat/`. */
  const walk = (list: readonly BranchTreeNode[], depth: number, sectionKey: string, icon: JSX.Element, rows: JSX.Element[]): void => {
    for (const node of list) {
      if (node.kind === 'leaf') { rows.push(branchRow(node.branch, node.label, depth, sectionKey, icon)); continue }
      const dirKey = `${sectionKey}:${node.path}`
      // Membership means "the user toggled this row away from its default":
      // sections and top-level dirs start open, deeper dirs start closed so a
      // remote with many `origin/feat/*` refs does not unfold the whole tree.
      const defaultOpen = depth === 0
      const open = closed.has(dirKey) ? !defaultOpen : defaultOpen
      rows.push(h('div', {
        key: dirKey,
        className: 'gp-branch-row gp-branch-row--dir',
        style: { paddingLeft: BRANCH_BASE + depth * BRANCH_INDENT },
        title: node.path,
        role: 'button',
        tabIndex: 0,
        'aria-expanded': open,
        onClick: () => cb.onToggle(dirKey),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cb.onToggle(dirKey) }
        },
      }, [
        h('span', { key: 'c', className: 'gp-branch-row__chev' }, h(ChevronIcon, { size: 11, open })),
        h('span', { key: 'i', className: 'gp-branch-row__ic gp-branch-row__ic--folder' }, h(FolderIcon, { size: 13 })),
        h('span', { key: 'n', className: 'gp-tree-name' }, node.label),
      ]))
      if (!open) continue
      // A branch whose name equals the dir path renders as its first child.
      if (node.self !== null) rows.push(branchRow(node.self, node.path, depth + 1, sectionKey, icon))
      walk(node.children, depth + 1, sectionKey, icon, rows)
    }
  }
  const section = (key: string, labelKey: GitKey, count: number, icon: JSX.Element, nodes: readonly BranchTreeNode[], pinned: readonly GitBranch[] = []): JSX.Element => {
    const rows: JSX.Element[] = []
    if (!closed.has(key)) {
      for (const branch of pinned) rows.push(branchRow(branch, branch.name, 0, key, icon))
      walk(nodes, 0, key, icon, rows)
    }
    return h('div', { key, className: 'gp-branch-group' }, [
      h('div', { key: 'head', className: 'gp-branch-group__head', onClick: () => cb.onToggle(key) }, [
        h(ChevronIcon, { key: 'c', size: 11, open: !closed.has(key) }),
        `${cb.t(labelKey)} (${count})`,
      ]),
      ...rows,
    ])
  }
  return h('div', {}, [
    h('div', { key: 'head-row', className: 'gp-branch-row', style: { fontWeight: 600, justifyContent: 'center', padding: '4px 10px' }, onClick: () => cb.onFilter(null) }, cb.t('overview.head')),
    section('local', 'overview.local', tree.local.length, h(BranchIcon, { size: 13 }), trees.local, trees.localPinned),
    section('remote', 'overview.remote', tree.remote.length, h(BranchIcon, { size: 13 }), trees.remote),
    section('tags', 'overview.tags', tree.tags.length, h(TagIcon, { size: 13 }), trees.tags),
  ])
}

export interface BranchSheetCbs extends BranchCbs {
  onClose: () => void
}

/** Compact branch/ref filter: a bottom sheet carrying the same branch list,
 * portaled over the panel, led by the repository list when there is one.
 * Selecting a ref applies the filter and closes it; the backdrop and the close
 * button dismiss it. */
export function renderBranchSheet(tree: BranchTree | null, treeError: boolean, activeRef: string | null, closed: ReadonlySet<string>, cb: BranchSheetCbs, trees: BranchTrees, lead: JSX.Element | null): JSX.Element | null {
  if (typeof document === 'undefined') return null
  const sheet = h('div', {
    className: 'gp-sheet-backdrop',
    // Declares its stacking identity like every other overlay, so a dialog
    // opened from inside the sheet (confirm / tag form) is the layer Escape
    // closes instead of both at once.
    [OVERLAY_ATTR]: '',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) cb.onClose() },
  }, h('div', { className: 'gp-sheet', role: 'dialog', 'aria-modal': true }, [
    h('div', { key: 'bar', className: 'gp-sheet__bar' }, [
      h('span', { key: 'title', className: 'gp-sheet__title' }, cb.t('overview.filterBranch')),
      h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-sheet__close', title: cb.t('common.close'), 'aria-label': cb.t('common.close'), onClick: cb.onClose }, h(CloseIcon, { size: 15 })),
    ]),
    h('div', { key: 'body', className: 'gp-sheet__body' }, [
      lead,
      h('div', { key: 'branches' }, renderBranchList(tree, treeError, activeRef, closed, cb, trees)),
    ]),
  ]))
  return createPortal(sheet, document.body, 'branch-filter-sheet')
}

