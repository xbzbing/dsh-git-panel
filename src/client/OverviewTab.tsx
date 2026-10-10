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
import { queryAs } from './rpc'
import type { GitAction, GitBranch, GitSnapshot, GraphCommit, ResetMode } from './types'
import type { GitKey } from './locales'
import { ArrowLeftIcon, BranchIcon, ChevronIcon, CloseIcon, CommitIcon, DownloadIcon, FileIcon, FilterIcon, GitHubIcon, RefreshIcon, ResetIcon, RevertIcon, SyncIcon, TagIcon } from './icons'
import { layoutGraph, graphWidth, type GraphRow } from './git-graph'
import { buildFileTree } from './file-tree'
import { absoluteDateTime, absoluteTime, timeAgo } from './time'
import { statusChar, statusClass } from './status'
import { DiffView, diffSummary, type DiffMode } from './DiffView'
import { useBranchTree, useCommitDetail, useHistory, type BranchTree, type HistoryFilter } from './overview-hooks'
import { useResizableColumn } from './resizable'
import { segButtons } from './seg'
import { opErrorText, renderConfirmModal } from './ops-modals'
import { renderResetModal, renderTagCreateModal } from './overview-modals'
import type { DiffViewMode } from './types'

type PullPreview = { commits: number; files: number; insertions: number; deletions: number }

/** The incoming fast-forward scope, highlighted + bold in the pull confirm.
 * The ±line counts are colored like a diffstat; the `+N / −N` token is split
 * out of the interpolated string (identical in every locale) so only the
 * numbers carry the add/del color. */
function pullScopeNode(preview: 'loading' | PullPreview | null, t: (key: GitKey, params?: Record<string, string | number>) => string): JSX.Element {
  if (preview === 'loading' || preview === null) {
    return h('div', { className: 'gp-pullscope gp-pullscope--loading' }, t('status.pullScopeLoading'))
  }
  const line = t('status.pullScope', { commits: preview.commits, files: preview.files, ins: preview.insertions, del: preview.deletions })
  const m = line.match(/(\+\d+)\s*\/\s*([-−]\d+)/)
  if (m === null) return h('div', { className: 'gp-pullscope' }, line)
  const start = line.indexOf(m[0])
  return h('div', { className: 'gp-pullscope' }, [
    line.slice(0, start),
    h('span', { key: 'add', className: 'gp-pullscope__add' }, m[1]),
    ' / ',
    h('span', { key: 'del', className: 'gp-pullscope__del' }, m[2]),
    line.slice(start + m[0].length),
  ])
}

interface OverviewProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  /** Snapshot checkedAt; bumps drive a history/tree reload (commit landed / poll). */
  readonly refreshKey: number
  /** Default diff layout new file-diff overlays open with. */
  readonly defaultDiffView: DiffViewMode
  /** Live snapshot — the dirty flag + change list feed the reset/revert guards. */
  readonly snapshot: GitSnapshot
  /** HEAD-moving write path (revert/reset) routed through the controller so the
   * fresh snapshot refreshes the panel; tag ops bypass it (work tree untouched). */
  readonly onAction: (action: GitAction) => Promise<{ ok: boolean; error?: string }>
  /** Force an immediate snapshot refresh (used to re-pull the reset lost-file
   * list on dialog open, cutting the TOCTOU window against the shared AI). */
  readonly onResync: () => void
  /** Compact (single-column drill-in) layout for a narrow panel. */
  readonly compact: boolean
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

const LANE_W = 14
const ROW_H = 30

/** Shallow equality of two ref lists by kind/name/head (ignores array identity). */
function refsEqual(a: readonly GraphCommit['refs'][number][], b: readonly GraphCommit['refs'][number][]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.kind !== b[i]!.kind || a[i]!.name !== b[i]!.name || a[i]!.head !== b[i]!.head) return false
  }
  return true
}
/** Taller commit row in compact so each is a comfortable touch target and the
 * subject + meta can stack on two lines. The graph svg stretches to match it so
 * lane edges still connect between consecutive rows. */
const ROW_H_COMPACT = 46
/** Toolbar width below which the search placeholder drops its "(message / hash)"
 * hint — a placeholder is a DOM attribute CSS can't rewrite, so swap it here.
 * Measured on the toolbar (not the input): flex-wrap keeps the input's own
 * width nearly constant while the toolbar's width is the real space signal. */
const SEARCH_HINT_MIN_W = 260

/** Observe an element's width; true once it is measured and below `min`. */
function useNarrow(el: HTMLElement | null, min: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (el === null || typeof ResizeObserver === 'undefined') return
    const measure = (): void => setNarrow(el.clientWidth > 0 && el.clientWidth < min)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, min])
  return narrow
}

export function OverviewTab({ remote, sessionId, refreshKey, defaultDiffView, snapshot, onAction, onResync, compact, t }: OverviewProps): JSX.Element {
  const [filter, setFilter] = useState<HistoryFilter>({ ref: null, search: '', author: '', since: '' })
  const [searchInput, setSearchInput] = useState('')
  const [searchEl, setSearchEl] = useState<HTMLElement | null>(null)
  const searchNarrow = useNarrow(searchEl, SEARCH_HINT_MIN_W)
  const [closedSections, setClosedSections] = useState<ReadonlySet<string>>(new Set(['tags', 'remote']))
  // Tag write ops (create/delete) don't change the work tree, so they never bump
  // the snapshot's refreshKey; a local counter folds into the reload key so the
  // history graph and branch/tag list pick up the new ref set.
  const [opBump, setOpBump] = useState(0)
  const effRefresh = refreshKey + opBump
  const afterTagOp = (): void => setOpBump((n) => n + 1)
  // Tag create modal (anchored to a commit) and tag delete confirm.
  const [tagForm, setTagForm] = useState<{ hash: string; shortHash: string } | null>(null)
  const [tagToDelete, setTagToDelete] = useState<string | null>(null)
  // Commit-undo targets (revert confirm + reset mode dialog), each a selected commit.
  const [revertTarget, setRevertTarget] = useState<{ hash: string; shortHash: string; subject: string } | null>(null)
  const [resetTarget, setResetTarget] = useState<{ hash: string; shortHash: string; subject: string } | null>(null)
  const [opError, setOpError] = useState<string | null>(null)
  // In-flight guard so a double-click on confirm can't fire two tag RPCs.
  const [opBusy, setOpBusy] = useState(false)
  // Left-column status bar: a sync check (fetch) and a fast-forward pull, each
  // with its own in-flight guard; the pull is gated behind a confirm dialog.
  const [syncBusy, setSyncBusy] = useState(false)
  const [pullBusy, setPullBusy] = useState(false)
  const [pullConfirm, setPullConfirm] = useState(false)
  // Incoming fast-forward scope shown in the pull confirm: null = not loaded,
  // 'loading' while the query runs, else the diffstat preview.
  const [pullPreview, setPullPreview] = useState<'loading' | { commits: number; files: number; insertions: number; deletions: number } | null>(null)
  // Compact drill-in: 'list' shows the history, 'detail' the selected commit.
  // Ignored by the wide layout, which renders both columns at once.
  const [pane, setPane] = useState<'list' | 'detail'>('list')
  // Compact branch/ref filter lives in a bottom sheet (a side column has no room
  // on a phone); the wide layout keeps the always-visible left column instead.
  const [sheetOpen, setSheetOpen] = useState(false)
  // Escape dismisses the sheet, matching the file-diff modal's dialog contract.
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setSheetOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheetOpen])
  // The sheet is a compact-only surface; widening the panel dismisses it so it
  // never hangs over the three-column layout.
  useEffect(() => {
    if (!compact && sheetOpen) setSheetOpen(false)
  }, [compact, sheetOpen])

  // When the pull confirm opens, load the incoming fast-forward scope (local
  // diffstat HEAD..@{upstream}) so the dialog can show commits/files/±lines;
  // closing the dialog clears it. A generation guard drops a stale response.
  useEffect(() => {
    if (!pullConfirm) { setPullPreview(null); return }
    let alive = true
    setPullPreview('loading')
    void remote.query({ sessionId, query: { kind: 'pull-preview' } }).then((res) => {
      if (!alive) return
      const pv = queryAs(res, 'pull-preview')
      setPullPreview(pv !== null && pv.hasUpstream ? { commits: pv.commits, files: pv.files, insertions: pv.insertions, deletions: pv.deletions } : null)
    })
    return () => { alive = false }
  }, [pullConfirm, remote, sessionId])

  const { tree, treeError, authors, reload: reloadTree } = useBranchTree(remote, sessionId, effRefresh)
  const detail = useCommitDetail(remote, sessionId, defaultDiffView)
  const { commits, loading, listError, hasMore, listRef, loadMore } = useHistory(
    remote, sessionId, filter, effRefresh, detail.clearSelection,
  )

  // Search debounce → filter change (which reloads history from page 0).
  useEffect(() => {
    const timer = setTimeout(() => setFilter((prev) => (prev.search === searchInput ? prev : { ...prev, search: searchInput })), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const searching = filter.search !== ''
  const rows: GraphRow[] = useMemo(() => (searching ? commits.map((c) => ({ commit: c, lane: 0, color: 0, edges: [], merge: false })) : layoutGraph(commits, snapshot.graphStyle)), [commits, searching, snapshot.graphStyle])
  const laneCount = useMemo(() => (searching ? 0 : graphWidth(rows)), [rows, searching])
  const graphW = searching ? 12 : Math.max(LANE_W, laneCount * LANE_W)
  const rowH = compact ? ROW_H_COMPACT : ROW_H
  // Wide: graph | subject | hash | author | date. Compact: graph | stacked text.
  const gridTpl = compact ? `${graphW}px minmax(0,1fr)` : `${graphW}px minmax(120px,1fr) 72px 120px 96px`

  const onScroll = (): void => {
    const el = listRef.current
    if (el === null || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) loadMore()
  }

  const selectCommit = (commit: GraphCommit): void => {
    void detail.select(commit)
    if (compact) setPane('detail')
  }

  const now = useMemo(() => Date.now(), [commits])
  const fileTree = useMemo(() => (detail.detail === null ? [] : buildFileTree(detail.detail.stats.map((s) => ({ path: s.path, meta: s.status })))), [detail.detail])
  const selected = detail.selected

  // Keep the selected row's `refs` fresh: a tag create/delete reloads `commits`
  // (via opBump), but `selected` still points at the pre-reload object, so its
  // tag chips would go stale. When the matching hash reappears with different
  // refs, swap in the fresh row (no detail refetch).
  useEffect(() => {
    if (selected === null) return
    const fresh = commits.find((c) => c.hash === selected.hash)
    if (fresh !== undefined && fresh !== selected && !refsEqual(fresh.refs, selected.refs)) {
      detail.resyncSelected(fresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commits, selected])

  // Left branch column + right detail column are drag-resizable; the middle
  // history column takes the remaining space. Widths persist per column.
  const leftCol = useResizableColumn({ storageKey: 'gp.overview.left', initial: 200, min: 130, reserve: 360, edge: 'end' })
  const rightCol = useResizableColumn({ storageKey: 'gp.overview.right', initial: 340, min: 190, reserve: 360, edge: 'start' })

  const setRef = (ref: string | null): void => setFilter((prev) => ({ ...prev, ref }))

  // Tag write ops go straight through `run` (the work tree is untouched, so no
  // snapshot is needed); afterTagOp reloads the history graph + branch/tag list.
  const runTagCreate = async (name: string, message: string): Promise<void> => {
    if (tagForm === null || opBusy) return
    setOpError(null)
    setOpBusy(true)
    try {
      const res = await remote.run({ sessionId, action: { kind: 'tag-create', name, commit: tagForm.hash, ...(message.trim() !== '' ? { message } : {}) } })
      if (res.ok) { setTagForm(null); afterTagOp() }
      else setOpError(opErrorText(res.error.code, res.error.message, t))
    } finally { setOpBusy(false) }
  }
  const runTagDelete = async (name: string): Promise<void> => {
    if (opBusy) return
    setOpError(null)
    setOpBusy(true)
    try {
      const res = await remote.run({ sessionId, action: { kind: 'tag-delete', name } })
      if (res.ok) { setTagToDelete(null); afterTagOp() }
      else setOpError(opErrorText(res.error.code, res.error.message, t))
    } finally { setOpBusy(false) }
  }

  // Revert / reset move HEAD or the work tree, so they go through `onAction`
  // (controller feeds the fresh snapshot back → refreshKey advances → history
  // reloads). The returned error is already localized by Panel's opErrorText.
  const runRevert = async (): Promise<void> => {
    if (revertTarget === null || opBusy) return
    setOpError(null)
    setOpBusy(true)
    try {
      const res = await onAction({ kind: 'revert', commit: revertTarget.hash })
      if (res.ok) setRevertTarget(null)
      else setOpError(res.error ?? t('error.generic'))
    } finally { setOpBusy(false) }
  }
  const runReset = async (mode: ResetMode): Promise<void> => {
    if (resetTarget === null || opBusy) return
    setOpError(null)
    setOpBusy(true)
    try {
      const res = await onAction({ kind: 'reset', commit: resetTarget.hash, mode })
      if (res.ok) setResetTarget(null)
      else setOpError(res.error ?? t('error.generic'))
    } finally { setOpBusy(false) }
  }

  // Sync check = `git fetch` routed through onAction so the fresh snapshot
  // (updated ahead/behind) feeds straight back into the panel; the branch/tag
  // list reloads too. Pull = `git pull --ff-only`, also through onAction.
  const runCheckSync = async (): Promise<void> => {
    if (syncBusy) return
    setOpError(null)
    setSyncBusy(true)
    try {
      const res = await onAction({ kind: 'fetch' })
      if (res.ok) reloadTree()
      else setOpError(res.error ?? t('error.generic'))
    } finally { setSyncBusy(false) }
  }
  const runPullFf = async (): Promise<void> => {
    if (pullBusy) return
    setOpError(null)
    setPullBusy(true)
    try {
      const res = await onAction({ kind: 'pull-ff' })
      if (res.ok) { setPullConfirm(false); reloadTree() }
      else setOpError(res.error ?? t('error.generic'))
    } finally { setPullBusy(false) }
  }

  const fileDiffModal = renderFileDiffModal(detail.fileDiff, {
    text: detail.fileDiffText,
    error: detail.fileDiffError,
    mode: detail.fileDiffMode,
    onMode: detail.setFileDiffMode,
    expanded: detail.fileDiffExpanded,
    onExpand: (expand) => { if (detail.fileDiff !== null) detail.openFileDiff(detail.fileDiff.path, detail.fileDiff.hash, detail.fileDiff.shortHash, expand) },
    onClose: detail.closeFileDiff,
    remote,
    sessionId,
    compact,
    t,
  })

  // Tag create modal + delete confirm, plus commit-undo dialogs (revert confirm
  // and the reset mode dialog), portaled; included in both layouts.
  // `git reset --hard` discards tracked changes only (untracked files survive),
  // so the hard-reset "will be discarded" list must exclude untracked entries
  // and de-dup the staged/modified split of a path (MM/AM yields two entries).
  const lostTracked = useMemo(
    () => [...new Set(snapshot.changes.filter((c) => c.status !== 'untracked').map((c) => c.path))],
    [snapshot.changes],
  )
  const opModals: (JSX.Element | null)[] = [
    tagForm !== null ? renderTagCreateModal(tagForm, { onClose: () => setTagForm(null), onCreate: runTagCreate, error: opError, compact, t }) : null,
    tagToDelete !== null ? renderConfirmModal({
      title: t('tag.deleteTitle'),
      body: t('tag.deleteConfirm', { name: tagToDelete }),
      confirmLabel: t('tag.deleteTitle'),
      danger: true,
      error: opError,
      confirmBusy: opBusy,
      onConfirm: () => void runTagDelete(tagToDelete),
      onClose: () => setTagToDelete(null),
      t,
    }) : null,
    revertTarget !== null ? renderConfirmModal({
      title: t('revert.title'),
      // Revert keeps the work tree, but a dirty tree can make it conflict/refuse;
      // the dirty note (if any) rides in the body so the pre-wrap text shows it.
      body: t('revert.body', { ref: `${revertTarget.shortHash} ${revertTarget.subject}` })
        + (snapshot.dirty ? `\n\n${t('ops.dirtyWarn')}` : ''),
      confirmLabel: t('revert.confirm'),
      danger: false,
      error: opError,
      confirmBusy: opBusy,
      onConfirm: () => void runRevert(),
      onClose: () => setRevertTarget(null),
      t,
    }) : null,
    resetTarget !== null ? renderResetModal(resetTarget, {
      from: snapshot.head ?? resetTarget.shortHash,
      dirty: snapshot.dirty,
      lostFiles: lostTracked,
      lostTotal: lostTracked.length,
      lostTruncated: snapshot.truncated,
      busy: opBusy,
      error: opError,
      onReset: runReset,
      onClose: () => setResetTarget(null),
      t,
    }) : null,
    pullConfirm ? renderConfirmModal({
      title: t('status.pullConfirmTitle'),
      body: t('status.pullConfirmBody', { branch: snapshot.branch ?? 'HEAD', behind: snapshot.behind }),
      extra: pullScopeNode(pullPreview, t),
      confirmLabel: t('status.pullConfirm'),
      danger: false,
      error: opError,
      confirmBusy: pullBusy,
      busyLabel: t('status.pulling'),
      onConfirm: () => void runPullFf(),
      onClose: () => setPullConfirm(false),
      t,
    }) : null,
  ]

  // The history middle column: a toolbar (search / author / since / fetch, plus
  // a filter trigger in compact) over the scrolling commit list.
  const historyCol = h('div', { key: 'mid', className: 'gp-col gp-col--mid gp-history' }, [
    h('div', { key: 'tb', className: 'gp-toolbar', ref: setSearchEl }, [
      compact ? h('button', {
        key: 'filter', type: 'button',
        className: `gp-btn${filter.ref !== null ? ' gp-btn--primary' : ''}`,
        title: t('overview.filterBranch'), onClick: () => setSheetOpen(true),
      }, [h(FilterIcon, { key: 'ic', size: 13 }), filter.ref ?? t('overview.filterBranch')]) : null,
      h('input', {
        key: 'search', className: 'gp-search', placeholder: t(searchNarrow || compact ? 'overview.searchShort' : 'overview.search'), value: searchInput,
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
          gridTpl, graphW, laneCount, searching, now, compact, rowH,
          onSelect: () => selectCommit(row.commit),
          onHoverEnter: detail.onHoverEnter, onHoverLeave: detail.onHoverLeave,
          t,
        }))),
  ])

  // The right detail column body (changed files + message, or a placeholder) as
  // a keyed child array. Shared by the wide right column and the compact detail
  // pane. The container (.gp-detail) is supplied by each caller.
  const detailBody: JSX.Element[] = selected === null
    ? [h('div', { key: 'empty', className: 'gp-empty' }, [h(CommitIcon, { key: 'i', size: 20 }), t('overview.selectCommit')])]
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
          h('span', { key: 't' }, absoluteDateTime(selected.dateIso)),
        ]),
        // Commit action area (low-frequency ops; shown only with a selection).
        // Tags get their own wrapping row of deletable chips, rendered only when
        // the commit carries any; the revert / reset / create-tag buttons sit on
        // a separate row below so many or long tags never crowd the actions.
        h('div', { key: 'ops', className: 'gp-detail__ops' }, (() => {
          const tagRefs = selected.refs.filter((r) => r.kind === 'tag')
          return [
            tagRefs.length > 0 ? h('div', { key: 'tags', className: 'gp-detail__tags' }, tagRefs.map((r) => h('span', { key: `tag-${r.name}`, className: 'gp-ref-chip gp-ref-chip--tag gp-ref-chip--del', title: r.name }, [
              h(TagIcon, { key: 'i', size: 11 }),
              h('span', { key: 'n', className: 'gp-detail__tagname' }, r.name),
              h('button', { key: 'x', type: 'button', className: 'gp-ref-chip__x', title: t('tag.deleteOne', { name: r.name }), onClick: () => { setOpError(null); setTagToDelete(r.name) } }, h(CloseIcon, { size: 11 })),
            ]))) : null,
            h('div', { key: 'actions', className: 'gp-detail__actions' }, [
              h('button', { key: 'revert', type: 'button', className: 'gp-btn gp-btn--sm', title: t('overview.revert'), onClick: () => { setOpError(null); setRevertTarget({ hash: selected.hash, shortHash: selected.shortHash, subject: selected.subject }) } }, [h(RevertIcon, { key: 'i', size: 12 }), t('overview.revert')]),
              h('button', { key: 'reset', type: 'button', className: 'gp-btn gp-btn--sm', title: t('overview.reset'), onClick: () => { setOpError(null); onResync(); setResetTarget({ hash: selected.hash, shortHash: selected.shortHash, subject: selected.subject }) } }, [h(ResetIcon, { key: 'i', size: 12 }), t('overview.reset')]),
              h('button', { key: 'addtag', type: 'button', className: 'gp-btn gp-btn--sm', title: t('overview.createTag'), onClick: () => { setOpError(null); setTagForm({ hash: selected.hash, shortHash: selected.shortHash }) } }, [h(TagIcon, { key: 'i', size: 12 }), t('overview.createTag')]),
            ]),
          ]
        })()),
        detail.detail !== null && detail.detail.body !== '' ? h('pre', { key: 'body', className: 'gp-detail__body' }, detail.detail.body) : h('div', { key: 'nb', className: 'gp-empty' }, t('overview.noMessage')),
      ]),
    ]

  // Compact: a single column that drills from the history list into the commit
  // detail; the branch filter is a bottom sheet. No hover card (tap drills in).
  if (compact) {
    return h('div', { className: 'gp-overview gp-overview--compact' }, [
      fileDiffModal,
      ...opModals,
      pane === 'detail'
        ? h('div', { key: 'detail', className: 'gp-col gp-col--mid gp-detail' }, [
          h('div', { key: 'back', className: 'gp-subhead' }, [
            h('button', { key: 'b', type: 'button', className: 'gp-subhead__back', onClick: () => setPane('list') }, [h(ArrowLeftIcon, { key: 'i', size: 14 }), t('overview.backToList')]),
            selected !== null ? h('span', { key: 'h', className: 'gp-subhead__title gp-commit-hash' }, selected.shortHash) : null,
          ]),
          ...detailBody,
        ])
        : historyCol,
      renderStatusBar(snapshot, { syncBusy, pullBusy, onCheck: () => void runCheckSync(), onPull: () => { setOpError(null); setPullConfirm(true) }, t }),
      sheetOpen ? renderBranchSheet(tree, treeError, filter.ref, closedSections, {
        onFilter: (ref) => { setRef(ref); setSheetOpen(false) },
        onToggle: (section) => setClosedSections((prev) => { const n = new Set(prev); if (n.has(section)) n.delete(section); else n.add(section); return n }),
        onRetry: reloadTree,
        onClose: () => setSheetOpen(false),
        t,
      }) : null,
    ])
  }

  return h('div', { className: 'gp-overview' }, [
    // file-diff modal (click a changed file in the right column)
    fileDiffModal,
    ...opModals,
    // left: branches (scroll) + a fixed status bar footer (repo link + sync)
    h('div', { key: 'left', className: 'gp-col gp-col--left', style: { flex: `0 0 ${leftCol.width}px` } }, [
      h('div', { key: 'scroll', className: 'gp-col-left__scroll' }, renderBranchList(tree, treeError, filter.ref, closedSections, {
        onFilter: (ref) => setRef(ref),
        onToggle: (section) => setClosedSections((prev) => { const n = new Set(prev); if (n.has(section)) n.delete(section); else n.add(section); return n }),
        onRetry: reloadTree,
        t,
      })),
      renderStatusBar(snapshot, { syncBusy, pullBusy, onCheck: () => void runCheckSync(), onPull: () => { setOpError(null); setPullConfirm(true) }, t }),
    ]),
    leftCol.divider,
    // middle: history
    historyCol,
    rightCol.divider,
    // right: detail
    h('div', { key: 'right', className: 'gp-col gp-col--right gp-detail', style: { flex: `0 0 ${rightCol.width}px` } }, detailBody),
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

interface StatusBarCbs {
  readonly syncBusy: boolean
  readonly pullBusy: boolean
  readonly onCheck: () => void
  readonly onPull: () => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Repo-page web link (last two path segments, e.g. `owner/repo`). */
function repoLabel(webUrl: string): string {
  const path = webUrl.replace(/^https?:\/\/[^/]+\//, '').replace(/\/+$/, '')
  const parts = path.split('/')
  return parts.length >= 2 ? parts.slice(-2).join('/') : path
}

/**
 * Left-column footer status bar: the repository's remote (GitHub mark or a
 * generic external-link icon, opening the repo page in a new tab) on the left,
 * and the current branch's sync state with a fetch-check and a fast-forward
 * pull on the right. A detached HEAD or an untracked branch shows the state
 * text only (no pull); a strictly-behind branch is the one case that offers the
 * pull.
 */
function renderStatusBar(snapshot: GitSnapshot, cb: StatusBarCbs): JSX.Element {
  const { t } = cb
  // Tolerate a snapshot predating these fields (older host / cached snapshot):
  // a missing remote reads as "no remote", a missing upstream flag as false.
  const remote = snapshot.remote ?? null
  const hasUpstream = snapshot.hasUpstream === true

  // ── left: repo link, shown only for GitHub projects (icon only; path in title) ──
  const repoNode = ((): JSX.Element | null => {
    // Non-GitHub remotes (gitlab/gitee/other) and repos with no remote show nothing.
    if (remote === null || remote.hostKind !== 'github') return null
    const icon = h(GitHubIcon, { size: 14 })
    if (remote.webUrl === null) {
      // A GitHub remote we couldn't turn into a web URL: icon only, URL in the title.
      return h('span', { key: 'r', className: 'gp-statusbar__repo gp-statusbar__repo--none', title: remote.url }, h('span', { className: 'gp-statusbar__ic' }, icon))
    }
    const title = remote.host !== null ? t('status.openRepoOn', { host: remote.host }) : t('status.openRepo')
    return h('a', {
      key: 'r', className: 'gp-statusbar__repo', href: remote.webUrl, target: '_blank', rel: 'noreferrer',
      title: `${repoLabel(remote.webUrl)} · ${title}`, 'aria-label': `${repoLabel(remote.webUrl)} · ${title}`,
    }, h('span', { className: 'gp-statusbar__ic' }, icon))
  })()

  // ── right: sync state + actions ──
  const { ahead, behind, branch } = snapshot
  const canPull = hasUpstream && behind > 0 && ahead === 0
  const stateNode = ((): JSX.Element => {
    let text: string
    let tone = ''
    if (branch === null) { text = t('status.detached') }
    else if (!hasUpstream) { text = t('status.noUpstream') }
    else if (ahead === 0 && behind === 0) { text = t('status.synced'); tone = ' gp-statusbar__state--ok' }
    else if (ahead > 0 && behind > 0) { text = t('status.diverged', { ahead, behind }); tone = ' gp-statusbar__state--warn' }
    else if (behind > 0) { text = t('status.behind', { n: behind }); tone = ' gp-statusbar__state--warn' }
    else { text = t('status.ahead', { n: ahead }) }
    return h('span', { key: 's', className: `gp-statusbar__state${tone}` }, text)
  })()

  const actions: (JSX.Element | null)[] = [
    // Fetch-check is offered whenever a remote exists (even without an upstream,
    // a fetch can populate the tracking refs the first time).
    remote !== null ? h('button', {
      key: 'check', type: 'button', className: 'gp-icon-btn gp-statusbar__btn',
      disabled: cb.syncBusy, title: t('status.check'), 'aria-label': t('status.check'),
      onClick: cb.onCheck,
    }, h(SyncIcon, { size: 13 })) : null,
    canPull ? h('button', {
      key: 'pull', type: 'button', className: 'gp-btn gp-btn--sm gp-statusbar__pull',
      disabled: cb.pullBusy, title: t('status.pullTitle'),
      onClick: cb.onPull,
    }, [h(DownloadIcon, { key: 'i', size: 12 }), t('status.pull')]) : null,
  ]

  return h('div', { key: 'statusbar', className: `gp-statusbar${cb.syncBusy ? ' gp-statusbar--busy' : ''}` }, [
    repoNode,
    h('div', { key: 'sync', className: 'gp-statusbar__sync' }, [stateNode, ...actions]),
  ])
}

interface BranchSheetCbs extends BranchCbs {
  onClose: () => void
}

/** Compact branch/ref filter: a bottom sheet carrying the same branch list,
 * portaled over the panel. Selecting a ref applies the filter and closes it;
 * the backdrop and the close button dismiss it. */
function renderBranchSheet(tree: BranchTree | null, treeError: boolean, activeRef: string | null, closed: ReadonlySet<string>, cb: BranchSheetCbs): JSX.Element | null {
  if (typeof document === 'undefined') return null
  const sheet = h('div', {
    className: 'gp-sheet-backdrop',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) cb.onClose() },
  }, h('div', { className: 'gp-sheet', role: 'dialog', 'aria-modal': true }, [
    h('div', { key: 'bar', className: 'gp-sheet__bar' }, [
      h('span', { key: 'title', className: 'gp-sheet__title' }, cb.t('overview.filterBranch')),
      h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-sheet__close', title: cb.t('common.close'), onClick: cb.onClose }, h(CloseIcon, { size: 15 })),
    ]),
    h('div', { key: 'body', className: 'gp-sheet__body' },
      renderBranchList(tree, treeError, activeRef, closed, cb)),
  ]))
  return createPortal(sheet, document.body, 'branch-filter-sheet')
}

interface RowCbs {
  selected: boolean
  gridTpl: string
  graphW: number
  laneCount: number
  searching: boolean
  now: number
  compact: boolean
  rowH: number
  onSelect: () => void
  onHoverEnter: (commit: GraphCommit, x: number, y: number) => void
  onHoverLeave: () => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

function renderCommitRow(row: GraphRow, cb: RowCbs): JSX.Element {
  const c = row.commit
  const refChips = c.refs.map((r) => h('span', {
    key: r.name,
    className: `gp-ref-chip${r.head ? ' gp-ref-chip--head' : ''}${r.kind === 'remote' ? ' gp-ref-chip--remote' : ''}${r.kind === 'tag' ? ' gp-ref-chip--tag' : ''}`,
  }, r.name))
  const graphCell = h('div', { key: 'g', className: 'gp-graph-cell' }, cb.searching ? null : renderGraphCell(row, cb.laneCount, cb.rowH))
  // Compact: two stacked lines (subject / hash·author·time) beside the graph,
  // taller rows for touch, and no hover handlers (tap drills into the detail).
  if (cb.compact) {
    return h('div', {
      key: c.hash,
      className: `gp-commit-row gp-commit-row--compact${cb.selected ? ' gp-commit-row--active' : ''}`,
      style: { gridTemplateColumns: cb.gridTpl, height: `${cb.rowH}px` },
      onClick: cb.onSelect,
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
    onClick: cb.onSelect,
    onMouseEnter: (e: { clientX: number; clientY: number }) => cb.onHoverEnter(c, e.clientX, e.clientY),
    onMouseLeave: cb.onHoverLeave,
  }, [
    graphCell,
    h('div', { key: 's', className: 'gp-commit-subject' }, [...refChips, c.subject]),
    h('div', { key: 'h', className: 'gp-commit-hash' }, c.shortHash),
    h('div', { key: 'a', className: 'gp-commit-author' }, c.author),
    h('div', { key: 'd', className: 'gp-commit-date', title: absoluteTime(c.dateIso) }, timeAgo(c.dateIso, cb.now, cb.t)),
  ])
}

const PALETTE = ['#4e9bff', '#3fb950', '#e0982e', '#d05ce3', '#e5534b', '#2dc6c6', '#d29922', '#8b949e']

function renderGraphCell(row: GraphRow, laneCount: number, rowH: number = ROW_H): JSX.Element {
  const w = Math.max(LANE_W, laneCount * LANE_W)
  const cx = (lane: number): number => lane * LANE_W + LANE_W / 2
  const mid = rowH / 2
  const els: JSX.Element[] = []
  for (const e of row.edges) {
    const color = PALETTE[e.color % PALETTE.length]
    // Vertical span per edge kind: into stops at the node, out starts there,
    // pass crosses the whole row. Control points sit at each span's midpoint,
    // so both halves leave/join the node on a vertical tangent.
    const y0 = e.kind === 'out' ? mid : 0
    const y1 = e.kind === 'into' ? mid : rowH
    const cy = (y0 + y1) / 2
    els.push(h('path', {
      key: `e${e.kind}-${e.fromLane}-${e.toLane}-${e.color}`,
      d: `M ${cx(e.fromLane)} ${y0} C ${cx(e.fromLane)} ${cy}, ${cx(e.toLane)} ${cy}, ${cx(e.toLane)} ${y1}`,
      stroke: color, strokeWidth: 1.6, fill: 'none',
    }))
  }
  els.push(h('circle', { key: 'node', cx: cx(row.lane), cy: mid, r: row.merge ? 4 : 3.2, fill: PALETTE[row.color % PALETTE.length], stroke: 'var(--dsw-alias-bg-layer-1)', strokeWidth: 1 }))
  return h('svg', { className: 'gp-graph-svg', width: w, height: rowH }, els)
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
  compact: boolean
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
  const { text, error, mode, onMode, expanded, onExpand, onClose, remote, sessionId, compact, t } = cb
  // Compact drops the side-by-side mode (no room on a phone) and renders split
  // as unified instead; the preference itself is left untouched.
  const modes: DiffMode[] = compact ? ['unified', 'before', 'after'] : ['unified', 'split', 'before', 'after']
  const effMode: DiffMode = compact && mode === 'split' ? 'unified' : mode
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
        disabled: effMode !== 'split' && effMode !== 'unified',
        title: t(expanded ? 'diff.collapse' : 'diff.expandAll'),
        onClick: () => onExpand(!expanded),
      }, t(expanded ? 'diff.collapse' : 'diff.expandAll')),
      h('div', { key: 'seg', className: 'gp-seg' },
        segButtons<DiffMode>(modes, effMode, onMode, (m) => t(`diff.${m}` as GitKey))),
      h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-modal__close', title: t('common.close'), onClick: onClose }, h(CloseIcon, { size: 15 })),
    ]),
    h('div', { key: 'scroll', className: 'gp-modal__scroll' },
      text === null
        ? h('div', { className: 'gp-empty' }, error ? t('overview.diffFailed') : t('common.loading'))
        : h(DiffView, { text, mode: effMode, path: fileDiff.path, remote, sessionId, imageSpec: { base: 'commit', commit: fileDiff.hash }, t })),
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
