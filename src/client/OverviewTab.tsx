/**
 * Git overview tab (IDE-style three-column):
 *  left   = branch/tag list (click to filter history)
 *  middle = commit history graph + search (message / hash / author / date)
 *  right  = selected commit's changed files + message (comment)
 */
import { createElement as h, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import type { GitPanelRemote } from './rpc'
import type { GitBranch, GraphCommit } from './types'
import type { GitKey } from './locales'
import { BranchIcon, ChevronIcon, CloseIcon, CommitIcon, FileIcon, RefreshIcon, TagIcon } from './icons'
import { layoutGraph, graphWidth, type GraphRow } from './git-graph'
import { buildFileTree } from './file-tree'
import { absoluteTime, timeAgo } from './time'
import { statusChar, statusClass } from './status'
import { DiffView, diffSummary, type DiffMode } from './DiffView'
import { useBranchTree, useCommitDetail, useHistory, type BranchTree, type HistoryFilter } from './overview-hooks'

interface OverviewProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  /** Snapshot checkedAt; bumps drive a history/tree reload (commit landed / poll). */
  readonly refreshKey: number
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

const LANE_W = 14
const ROW_H = 30

export function OverviewTab({ remote, sessionId, refreshKey, t }: OverviewProps): JSX.Element {
  const [filter, setFilter] = useState<HistoryFilter>({ ref: null, search: '', author: '', since: '' })
  const [searchInput, setSearchInput] = useState('')
  const [closedSections, setClosedSections] = useState<ReadonlySet<string>>(new Set(['tags', 'remote']))

  const { tree, treeError, authors, reload: reloadTree } = useBranchTree(remote, sessionId, refreshKey)
  const detail = useCommitDetail(remote, sessionId)
  const { commits, loading, listError, hasMore, listRef, loadMore } = useHistory(
    remote, sessionId, filter, refreshKey, detail.clearSelection,
  )

  // Search debounce → filter change (which reloads history from page 0).
  useEffect(() => {
    const timer = setTimeout(() => setFilter((prev) => (prev.search === searchInput ? prev : { ...prev, search: searchInput })), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const searching = filter.search !== ''
  const rows: GraphRow[] = useMemo(() => (searching ? commits.map((c) => ({ commit: c, lane: 0, color: 0, edges: [], merge: false })) : layoutGraph(commits)), [commits, searching])
  const laneCount = useMemo(() => (searching ? 0 : graphWidth(rows)), [rows, searching])
  const graphW = searching ? 12 : Math.max(LANE_W, laneCount * LANE_W)
  const gridTpl = `${graphW}px minmax(120px,1fr) 72px 120px 96px`

  const onScroll = (): void => {
    const el = listRef.current
    if (el === null || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) loadMore()
  }

  const now = useMemo(() => Date.now(), [commits])
  const fileTree = useMemo(() => (detail.detail === null ? [] : buildFileTree(detail.detail.stats.map((s) => ({ path: s.path, meta: s.status })))), [detail.detail])
  const selected = detail.selected

  return h('div', { className: 'gp-overview' }, [
    // file-diff modal (click a changed file in the right column)
    renderFileDiffModal(detail.fileDiff, {
      text: detail.fileDiffText,
      error: detail.fileDiffError,
      mode: detail.fileDiffMode,
      onMode: detail.setFileDiffMode,
      expanded: detail.fileDiffExpanded,
      onExpand: (expand) => { if (detail.fileDiff !== null) detail.openFileDiff(detail.fileDiff.path, detail.fileDiff.hash, detail.fileDiff.shortHash, expand) },
      onClose: detail.closeFileDiff,
      remote,
      sessionId,
      t,
    }),
    // left: branches
    h('div', { key: 'left', className: 'gp-col gp-col--left' }, renderBranchList(tree, treeError, filter.ref, closedSections, {
      onFilter: (ref) => setFilter((prev) => ({ ...prev, ref })),
      onToggle: (section) => setClosedSections((prev) => { const n = new Set(prev); if (n.has(section)) n.delete(section); else n.add(section); return n }),
      onRetry: reloadTree,
      t,
    })),
    // middle: history
    h('div', { key: 'mid', className: 'gp-col gp-col--mid gp-history' }, [
      h('div', { key: 'tb', className: 'gp-toolbar' }, [
        h('input', {
          key: 'search', className: 'gp-search', placeholder: t('overview.search'), value: searchInput,
          onChange: (e: { target: { value: string } }) => setSearchInput(e.target.value),
        }),
        h('select', {
          key: 'author', className: 'gp-select', value: filter.author,
          onChange: (e: { target: { value: string } }) => setFilter((prev) => ({ ...prev, author: e.target.value })),
        }, [
          h('option', { key: '', value: '' }, t('overview.allUsers')),
          ...authors.map((a) => h('option', { key: a, value: a }, a)),
        ]),
        h('select', {
          key: 'since', className: 'gp-select', value: filter.since,
          onChange: (e: { target: { value: string } }) => setFilter((prev) => ({ ...prev, since: e.target.value })),
        }, [
          h('option', { key: '', value: '' }, t('overview.allTime')),
          h('option', { key: 'today', value: '1 day ago' }, t('overview.today')),
          h('option', { key: '7d', value: '7 days ago' }, t('overview.last7d')),
          h('option', { key: '30d', value: '30 days ago' }, t('overview.last30d')),
        ]),
        h('button', { key: 'fetch', type: 'button', className: 'gp-icon-btn', title: t('overview.fetch'), onClick: () => { void remote.run({ sessionId, action: { kind: 'fetch' } }).then(() => reloadTree()) } }, h(RefreshIcon, { size: 14 })),
      ]),
      h('div', { key: 'list', className: 'gp-history__list', ref: listRef, onScroll },
        commits.length === 0
          ? h('div', { className: 'gp-empty' }, loading ? t('common.loading') : listError ? t('overview.loadFailed') : t('overview.noResults'))
          : rows.map((row) => renderCommitRow(row, {
            selected: selected?.hash === row.commit.hash,
            gridTpl, graphW, laneCount, searching, now,
            onSelect: () => void detail.select(row.commit),
            onHoverEnter: detail.onHoverEnter, onHoverLeave: detail.onHoverLeave,
            t,
          }))),
    ]),
    // right: detail
    h('div', { key: 'right', className: 'gp-col gp-col--right gp-detail' },
      selected === null
        ? h('div', { className: 'gp-empty' }, [h(CommitIcon, { key: 'i', size: 20 }), t('overview.selectCommit')])
        : [
          h('div', { key: 'files', className: 'gp-detail__files' },
            detail.detail === null
              ? h('div', { className: 'gp-empty' }, detail.detailError ? t('overview.detailFailed') : t('common.loading'))
              : renderFileTree(fileTree, {
                activePath: detail.fileDiff?.path ?? null,
                openTitle: t('overview.openFileDiff'),
                onOpen: (path) => { if (selected !== null) void detail.openFileDiff(path, selected.hash, selected.shortHash) },
              })),
          h('div', { key: 'msg', className: 'gp-detail__msg' }, [
            h('div', { key: 'subj', className: 'gp-detail__subject' }, selected.subject),
            h('div', { key: 'meta', className: 'gp-detail__meta' }, [
              h('span', { key: 'h', className: 'gp-commit-hash' }, selected.shortHash),
              h('span', { key: 'a' }, selected.author),
              h('span', { key: 't', title: absoluteTime(selected.dateIso) }, timeAgo(selected.dateIso, now, t)),
            ]),
            detail.detail !== null && detail.detail.body !== '' ? h('pre', { key: 'body', className: 'gp-detail__body' }, detail.detail.body) : h('div', { key: 'nb', className: 'gp-empty' }, t('overview.noMessage')),
          ]),
        ]),
    // hover card: full commit message (comment) of the pointed-at commit
    renderHoverCard(detail.hover, detail.hoverBody, t),
  ])
}

interface HoverCardCbs {
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Floating card showing a commit's full message (comment), anchored near the pointer. */
function renderHoverCard(
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
    ]),
    body === null
      ? h('div', { key: 'l', className: 'gp-hovercard__loading' }, t('common.loading'))
      : body === ''
        ? h('div', { key: 'e', className: 'gp-hovercard__loading' }, t('overview.noMessage'))
        : h('pre', { key: 'body', className: 'gp-hovercard__body' }, body),
  ])
  return createPortal(card, document.body, 'commit-hovercard')
}

interface BranchCbs {
  onFilter: (ref: string | null) => void
  onToggle: (section: string) => void
  onRetry: () => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

function renderBranchList(tree: BranchTree | null, treeError: boolean, activeRef: string | null, closed: ReadonlySet<string>, cb: BranchCbs): JSX.Element {
  if (treeError) {
    return h('div', { className: 'gp-empty' }, [
      h('span', { key: 'm' }, cb.t('overview.branchesError')),
      h('button', { key: 'r', type: 'button', className: 'gp-btn', style: { marginTop: 8 }, onClick: cb.onRetry }, cb.t('common.retry')),
    ])
  }
  if (tree === null) return h('div', { className: 'gp-empty' }, cb.t('common.loading'))
  const section = (key: string, labelKey: GitKey, items: readonly GitBranch[], icon: JSX.Element, prefix = ''): JSX.Element =>
    h('div', { key, className: 'gp-branch-group' }, [
      h('div', { key: 'head', className: 'gp-branch-group__head', onClick: () => cb.onToggle(key) }, [
        h(ChevronIcon, { key: 'c', size: 11, open: !closed.has(key) }),
        `${cb.t(labelKey)} (${items.length})`,
      ]),
      closed.has(key) ? null : items.map((b) => {
        const ref = prefix + b.name
        const isCurrent = tree.current === b.name
        const cls = `gp-branch-row${activeRef === ref ? ' gp-branch-row--active' : ''}${isCurrent ? ' gp-branch-row--current' : ''}`
        return h('div', { key: b.name, className: cls, title: b.name, onClick: () => cb.onFilter(activeRef === ref ? null : ref) }, [
          h('span', { key: 'i', style: { display: 'inline-flex', width: 14 } }, icon),
          h('span', { key: 'n', className: 'gp-tree-name' }, b.name),
          (b.ahead || b.behind) ? h('span', { key: 't', className: 'gp-branch-row__track' }, `${b.ahead ? `↑${b.ahead}` : ''}${b.behind ? `↓${b.behind}` : ''}`) : null,
        ])
      }),
    ])
  return h('div', {}, [
    h('div', { key: 'head-row', className: 'gp-branch-row', style: { fontWeight: 600, paddingLeft: 10 }, onClick: () => cb.onFilter(null) }, cb.t('overview.head')),
    section('local', 'overview.local', tree.local, h(BranchIcon, { size: 13 })),
    section('remote', 'overview.remote', tree.remote, h(BranchIcon, { size: 13 })),
    section('tags', 'overview.tags', tree.tags, h(TagIcon, { size: 13 })),
  ])
}

interface RowCbs {
  selected: boolean
  gridTpl: string
  graphW: number
  laneCount: number
  searching: boolean
  now: number
  onSelect: () => void
  onHoverEnter: (commit: GraphCommit, x: number, y: number) => void
  onHoverLeave: () => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

function renderCommitRow(row: GraphRow, cb: RowCbs): JSX.Element {
  const c = row.commit
  return h('div', {
    key: c.hash,
    className: `gp-commit-row${cb.selected ? ' gp-commit-row--active' : ''}`,
    style: { gridTemplateColumns: cb.gridTpl },
    onClick: cb.onSelect,
    onMouseEnter: (e: { clientX: number; clientY: number }) => cb.onHoverEnter(c, e.clientX, e.clientY),
    onMouseLeave: cb.onHoverLeave,
  }, [
    h('div', { key: 'g', className: 'gp-graph-cell' }, cb.searching ? null : renderGraphCell(row, cb.laneCount)),
    h('div', { key: 's', className: 'gp-commit-subject' }, [
      ...c.refs.map((r) => h('span', {
        key: r.name,
        className: `gp-ref-chip${r.head ? ' gp-ref-chip--head' : ''}${r.kind === 'remote' ? ' gp-ref-chip--remote' : ''}${r.kind === 'tag' ? ' gp-ref-chip--tag' : ''}`,
      }, r.name)),
      c.subject,
    ]),
    h('div', { key: 'h', className: 'gp-commit-hash' }, c.shortHash),
    h('div', { key: 'a', className: 'gp-commit-author' }, c.author),
    h('div', { key: 'd', className: 'gp-commit-date', title: absoluteTime(c.dateIso) }, timeAgo(c.dateIso, cb.now, cb.t)),
  ])
}

const PALETTE = ['#4e9bff', '#3fb950', '#e0982e', '#d05ce3', '#e5534b', '#2dc6c6', '#d29922', '#8b949e']

function renderGraphCell(row: GraphRow, laneCount: number): JSX.Element {
  const w = Math.max(LANE_W, laneCount * LANE_W)
  const cx = (lane: number): number => lane * LANE_W + LANE_W / 2
  const els: JSX.Element[] = []
  for (const e of row.edges) {
    const color = PALETTE[e.color % PALETTE.length]
    els.push(h('path', {
      key: `e${e.fromLane}-${e.toLane}-${e.color}`,
      d: `M ${cx(e.fromLane)} 0 C ${cx(e.fromLane)} ${ROW_H / 2}, ${cx(e.toLane)} ${ROW_H / 2}, ${cx(e.toLane)} ${ROW_H}`,
      stroke: color, strokeWidth: 1.6, fill: 'none',
    }))
  }
  els.push(h('circle', { key: 'node', cx: cx(row.lane), cy: ROW_H / 2, r: row.merge ? 4 : 3.2, fill: PALETTE[row.color % PALETTE.length], stroke: 'var(--dsw-alias-bg-layer-1)', strokeWidth: 1 }))
  return h('svg', { className: 'gp-graph-svg', width: w, height: ROW_H }, els)
}

interface FileTreeCbs {
  activePath: string | null
  openTitle: string
  onOpen: (path: string) => void
}

function renderFileTree(nodes: ReturnType<typeof buildFileTree>, cb: FileTreeCbs): JSX.Element {
  const rows: JSX.Element[] = []
  const walk = (list: ReturnType<typeof buildFileTree>, depth: number): void => {
    for (const node of list) {
      if (node.dir) {
        rows.push(h('div', { key: node.path, className: 'gp-tree-row', style: { paddingLeft: 10 + depth * 14 } }, [
          h(ChevronIcon, { key: 'c', size: 11, open: true }),
          h('span', { key: 'n', className: 'gp-tree-name' }, node.name),
        ]))
        walk(node.children, depth + 1)
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

interface FileDiffModalCbs {
  text: string | null
  error: boolean
  mode: DiffMode
  onMode: (mode: DiffMode) => void
  expanded: boolean
  onExpand: (expand: boolean) => void
  onClose: () => void
  remote: GitPanelRemote
  sessionId: string
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Centered dialog showing a file's diff within the selected commit. Portaled
 * to document.body so it floats above the whole panel; Esc / backdrop click /
 * the close button dismiss it (Esc is wired by the caller). */
function renderFileDiffModal(
  fileDiff: { path: string; hash: string; shortHash: string } | null,
  cb: FileDiffModalCbs,
): JSX.Element | null {
  if (fileDiff === null || typeof document === 'undefined') return null
  const { text, error, mode, onMode, expanded, onExpand, onClose, remote, sessionId, t } = cb
  const modal = h('div', {
    className: 'gp-modal-backdrop',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) onClose() },
  }, h('div', { className: 'gp-modal', role: 'dialog', 'aria-modal': true }, [
    h('div', { key: 'bar', className: 'gp-modal__bar' }, [
      h('span', { key: 'fileicon', className: 'gp-modal__fileicon' }, h(FileIcon, { size: 15 })),
      h('span', { key: 'path', className: 'gp-modal__path', title: fileDiff.path }, renderPathParts(fileDiff.path)),
      h('span', { key: 'hash', className: 'gp-modal__hash' }, fileDiff.shortHash),
      text !== null && text !== '' ? (() => { const s = diffSummary(text); return h('span', { key: 'sum', className: 'gp-modal__sum' }, [h('span', { key: 'a', className: 'gp-stats__add' }, `+${s.add}`), h('span', { key: 'd', className: 'gp-stats__del' }, `\u2212${s.del}`)]) })() : null,
      h('button', {
        key: 'expand', type: 'button',
        className: `gp-seg__btn gp-diff__expand${expanded ? ' gp-seg__btn--active' : ''}`,
        disabled: mode !== 'split',
        title: t(expanded ? 'diff.collapse' : 'diff.expandAll'),
        onClick: () => onExpand(!expanded),
      }, t(expanded ? 'diff.collapse' : 'diff.expandAll')),
      h('div', { key: 'seg', className: 'gp-seg' }, (['split', 'before', 'after'] as DiffMode[]).map((m) =>
        h('button', { key: m, type: 'button', className: `gp-seg__btn${mode === m ? ' gp-seg__btn--active' : ''}`, onClick: () => onMode(m) }, t(`diff.${m}` as GitKey)))),
      h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-modal__close', title: t('common.close'), onClick: onClose }, h(CloseIcon, { size: 15 })),
    ]),
    h('div', { key: 'scroll', className: 'gp-modal__scroll' },
      text === null
        ? h('div', { className: 'gp-empty' }, error ? t('overview.diffFailed') : t('common.loading'))
        : h(DiffView, { text, mode, path: fileDiff.path, remote, sessionId, imageSpec: { base: 'commit', commit: fileDiff.hash }, t })),
  ]))
  return createPortal(modal, document.body, 'file-diff-modal')
}

/** Split a path into a dimmed directory prefix + emphasized file name. */
function renderPathParts(path: string): JSX.Element[] {
  const slash = path.lastIndexOf('/')
  if (slash < 0) return [h('span', { key: 'n', className: 'gp-modal__name' }, path)]
  return [
    h('span', { key: 'd', className: 'gp-modal__dir' }, path.slice(0, slash + 1)),
    h('span', { key: 'n', className: 'gp-modal__name' }, path.slice(slash + 1)),
  ]
}
