/**
 * Git overview tab (IDE-style three-column):
 *  left   = branch/tag list (click to filter history; a row's switch button
 *           checks the branch out after a confirm)
 *  middle = commit history graph + search (message / hash / author / date)
 *  right  = selected commit's changed files + message (comment)
 */
import { createElement as h, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { Menu, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { queryAs, type GitPanelRemote } from './rpc.js'
import { selectTrigger } from './select-trigger.js'
import { OVERLAY_ATTR, hasOverlay } from './dialog-focus.js'
import { renderBranchDrawer } from './overview-drawer.js'
import type { GitAction, GitBranch, GitDiffPayload, GitSnapshot, GraphCommit, ResetMode, DiffViewMode } from './types.js'
import type { GitKey } from './locales.js'
import { ArrowLeftIcon, BranchIcon, BranchCurrentIcon, BranchPrimaryIcon, BranchSyncIcon, ChevronIcon, CloseIcon, ExpandAllIcon, CommitIcon, FileIcon, FilterIcon, FolderIcon, RefreshIcon, ResetIcon, RevertIcon, TagIcon } from './icons.js'
import { layoutGraph, graphWidth, type GraphRow } from './git-graph.js'
import { layoutFilteredGraph } from './filtered-graph.js'
import { CommitGraph, GRAPH_LANE_W } from './CommitGraph.js'
import { isHistoryFiltered } from './types.js'
import { buildBranchTree, buildLocalBranchSection, pinPrimaryFirst, primaryBranchName, primaryRemoteRef, type BranchTreeNode } from './branch-tree.js'
import { buildFileTree } from './file-tree.js'
import { absoluteDateTime, absoluteTime, timeAgo } from './time.js'
import { statusChar, statusClass } from './status.js'
import { DiffView, diffSummary, type DiffMode } from './DiffView.js'
import { useBranchTree, useCommitDetail, useHistory, type BranchTree, type HistoryFilter } from './overview-hooks.js'
import { useCopyFeedback, type CopyFeedback } from './copy-feedback.js'
import { pathCopyButton } from './path-copy-button.js'
import { useResizableColumn, useStackedSplit } from './resizable.js'
import { segButtons } from './seg.js'
import { opErrorText, renderConfirmModal } from './ops-modals.js'
import { renderResetModal, renderTagCreateModal } from './overview-modals.js'
import { renderBranchSwitchConfirm } from './branch-switch.js'
import { buildBranchOptions, isSelectable, type BranchOption } from './branch-options.js'
import { pullScopeNode, renderStatusBar } from './overview-statusbar.js'
import { RepoBar } from './overview-repobar.js'
import { PushModal } from './PushModal.js'
import { PublishModal } from './PublishModal.js'
import { ReposSection, type RepositoriesHost } from './ReposSection.js'
import { useRowSlider } from './row-slider.js'
import { canPush } from './push-policy.js'
import { useGitQuerySignal } from './registry.js'
import type { QueryKey } from './query-key.js'

/** Stable empty collapsed-dirs set; shared so a fully-expanded tree never allocates. */
const EMPTY_DIRS: ReadonlySet<string> = new Set()

/** Branch-tree geometry (px): the left padding of a depth-0 row and the step per
 * level. A dir row starts exactly where a leaf row of the same depth starts and
 * spends its extra width on the chevron column, so the step must exceed that
 * column for a nested label to stay right of its dir's label. */
const BRANCH_BASE = 22
const BRANCH_INDENT = 24

/** Time-filter rows: git's relative date value → its locale key. One source for
 * both the menu items and the trigger label, so they cannot drift apart. */
const SINCE_OPTIONS: ReadonlyArray<readonly [string, GitKey]> = [
  ['', 'overview.allTime'],
  ['1 day ago', 'overview.today'],
  ['7 days ago', 'overview.last7d'],
  ['30 days ago', 'overview.last30d'],
]

interface OverviewProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly visible?: boolean
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
  /** Stacked layout: a tall narrow right sidebar — two columns in the top band
   * (branch list + history), commit detail spanning the width below. */
  readonly stacked: boolean
  /** Stacked sidebar at or below STACKED_TIGHT_BP: the top band's left column
   * (branch list + status bar) leaves the flex flow and becomes a drawer over
   * the history, collapsed by default (Panel measures; panel-fit.ts). */
  readonly tight?: boolean
  /** The DEVICE screen is phone-sized (panel-fit.ts): the compact branch
   * filter is the same left drawer the tight stacked sidebar uses, not the
   * bottom sheet a squeezed desktop column pops. */
  readonly phone?: boolean
  /** Repository list leading the branch tree's surface (left column, stacked
   * band or drawer, compact drawer or sheet), so a pick never hides the
   * branches or the commit list. */
  readonly repositories?: RepositoriesHost
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

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
/** Two-line rows in the stacked sidebar at pointer density: enough for subject
 * + meta without compact's touch padding. */
const ROW_H_STACKED = 40
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

export function OverviewTab({ remote, sessionId, visible = true, defaultDiffView, snapshot, onAction, onResync, compact, stacked, tight = false, phone = false, repositories, t }: OverviewProps): JSX.Element {
  const { signal: querySignal, queryVisible, queryKey } = useGitQuerySignal(sessionId, visible, snapshot.root)
  const [filter, setFilter] = useState<HistoryFilter>({ ref: null, search: '', author: '', since: '' })
  const [searchInput, setSearchInput] = useState('')
  /** Menu open state per filter: Menu is controlled and never closes itself. */
  const [authorOpen, setAuthorOpen] = useState(false)
  const [sinceOpen, setSinceOpen] = useState(false)
  const [searchEl, setSearchEl] = useState<HTMLElement | null>(null)
  const searchNarrow = useNarrow(searchEl, SEARCH_HINT_MIN_W)
  /** Compact-only: the secondary filters (author / since / refresh) hide behind
   * one chevron so the first row keeps the branch filter, search and the toggle. */
  const [moreOpen, setMoreOpen] = useState(false)
  const moreId = useId()
  /** Rows whose open state differs from its default (sections and top-level ref
   * dirs open, deeper dirs closed); `onToggle` flips membership. */
  const [closedSections, setClosedSections] = useState<ReadonlySet<string>>(new Set(['tags', 'remote']))
  // One toggle for every surface that lists branches (left column, stacked band,
  // compact drawer, bottom sheet): a section opens or closes the same way no
  // matter where it is drawn, so the four call sites share one stable function.
  const toggleSection = useCallback((section: string): void => {
    setClosedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }, [])
  // Tag write ops (create/delete) don't change the work tree, so they never bump
  // the business snapshot; a local counter folds into the query key so the
  // history graph and branch/tag list pick up the new ref set.
  const [opBump, setOpBump] = useState(0)
  const overviewQueryKey: QueryKey = [...queryKey, opBump]
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
  const [syncError, setSyncError] = useState<string | null>(null)
  const [pullBusy, setPullBusy] = useState(false)
  const [pullConfirm, setPullConfirm] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushConfirm, setPushConfirm] = useState(false)
  const [publishBusy, setPublishBusy] = useState(false)
  const [publishConfirm, setPublishConfirm] = useState(false)
  // Incoming fast-forward scope shown in the pull confirm: null = not loaded,
  // 'loading' while the query runs, else the diffstat preview.
  const [pullPreview, setPullPreview] = useState<'loading' | { commits: number; files: number; insertions: number; deletions: number } | null>(null)
  // Compact drill-in: 'list' shows the history, 'detail' the selected commit.
  // Ignored by the wide layout, which renders both columns at once.
  const [pane, setPane] = useState<'list' | 'detail'>('list')
  // Branch switch: the row target awaiting confirmation, and an in-flight
  // guard (a checkout moves the whole work tree).
  const [switchTarget, setSwitchTarget] = useState<BranchOption | null>(null)
  const [switchBusy, setSwitchBusy] = useState(false)
  // Compact branch/ref filter lives in a bottom sheet (a side column has no room
  // on a phone); the wide layout keeps the always-visible left column instead.
  const [sheetOpen, setSheetOpen] = useState(false)
  // A phone's compact overview takes the branch filter as the same left drawer
  // the tight stacked sidebar uses; a squeezed desktop column keeps the sheet.
  const branchDrawer = compact && phone === true
  // Escape dismisses the sheet, matching the file-diff modal's dialog contract.
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setSheetOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheetOpen])
  // The sheet is a compact-only surface; widening the panel (or a phone taking
  // the drawer instead) dismisses it so it never hangs over the layout.
  useEffect(() => {
    if ((!compact || branchDrawer) && sheetOpen) setSheetOpen(false)
  }, [compact, branchDrawer, sheetOpen])
  // Tight stacked sidebar, or a phone's compact overview: the branch list is a
  // drawer over the history, collapsed by default so the graph gets the full
  // width until the branch list is asked for (Panel passes tight ⇔ width ≤
  // STACKED_TIGHT_BP; the phone flag ⇔ device screen ≤ PHONE_SCREEN_BP).
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerId = useId()
  const drawerRootRef = useRef<HTMLDivElement | null>(null)
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null)
  const drawerToggleRef = useRef<HTMLButtonElement | null>(null)
  // Focus enters the drawer and returns to the toolbar toggle through the shared
  // dialog hook (overview-drawer.tsx). Escape yields to a dialog open above it:
  // that layer's own listener closes it in the same dispatch, so claiming the
  // keystroke here would dismiss both at once.
  useEffect(() => {
    if (!drawerOpen || !visible) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || hasOverlay()) return
      setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawerOpen, visible])
  // Leaving the tier that owns the drawer (tight stacked sidebar, phone
  // compact) re-attaches the column inline; the overlay state would otherwise
  // outlive the drawer it belongs to.
  useEffect(() => {
    if (!tight && !branchDrawer && drawerOpen) setDrawerOpen(false)
  }, [tight, branchDrawer, drawerOpen])

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

  const { tree, treeError, authors, reload: reloadTree } = useBranchTree(remote, sessionId, overviewQueryKey, queryVisible)
  // Switch targets keyed like the branch rows (`local:<name>` / `remote:<ref>`);
  // only rows with a selectable target get a switch button.
  const switchOptions = useMemo(() => {
    const map = new Map<string, BranchOption>()
    if (tree === null) return map
    for (const o of buildBranchOptions(tree)) if (isSelectable(o, tree.current)) map.set(o.key, o)
    return map
  }, [tree])
  // Primary remote's name, shared by the pin selection and the row switch keys.
  const remoteName = snapshot.remote?.name ?? null
  // Section trees: pinning and folding read every ref name, so they run once per
  // snapshot — a render that only moves selection, expand state or a filter draft
  // reuses these arrays instead of refolding the list.
  const branchTrees: BranchTrees = useMemo(() => {
    const local = tree?.local ?? []
    const remote = tree?.remote ?? []
    const defaultBranch = tree?.defaultBranch ?? null
    const localPrimary = primaryBranchName(local, defaultBranch)
    const remotePrimary = primaryRemoteRef(remote, remoteName, defaultBranch)
    const localSection = buildLocalBranchSection(local, tree?.current ?? null, localPrimary)
    return {
      local: localSection.nodes,
      localPinned: localSection.pinned,
      localPrimary,
      remotePrimary,
      remote: buildBranchTree(pinPrimaryFirst(remote, remotePrimary)),
      tags: buildBranchTree(tree?.tags ?? []),
    }
  }, [tree, remoteName])
  const openSwitch = (option: BranchOption): void => { setOpError(null); setSwitchTarget(option) }
  const detail = useCommitDetail(remote, sessionId, defaultDiffView, queryVisible)
  const { commits, topology, appliedFilter, loading, listError, hasMore, listRef, loadMore } = useHistory(
    remote, sessionId, filter, overviewQueryKey, detail.clearSelection, queryVisible,
  )

  // Search debounce → filter change (which reloads history from page 0).
  useEffect(() => {
    const timer = setTimeout(() => setFilter((prev) => (prev.search === searchInput ? prev : { ...prev, search: searchInput })), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  // The published topology signals projection mode. An older host may omit it;
  // use the shared query predicate as a conservative fallback for those rows.
  // Pending controls must not reinterpret the last successful history page.
  const filtered = topology !== undefined || isHistoryFiltered(appliedFilter)
  const rows: GraphRow[] = useMemo(() => filtered
    ? layoutFilteredGraph(commits, topology ?? [], snapshot.graphStyle)
    : layoutGraph(commits, snapshot.graphStyle), [commits, topology, filtered, snapshot.graphStyle])
  const laneCount = useMemo(() => graphWidth(rows), [rows])
  const graphW = Math.max(GRAPH_LANE_W, laneCount * GRAPH_LANE_W)
  const rowH = compact ? ROW_H_COMPACT : stacked ? ROW_H_STACKED : ROW_H
  // Wide: graph | subject | hash | author | date. Compact and stacked: graph |
  // stacked text — the stacked top band's history column is too narrow for the
  // five-column grid, but its rows are pointer targets, not touch ones.
  const gridTpl = compact || stacked ? `${graphW}px minmax(0,1fr)` : `${graphW}px minmax(120px,1fr) 72px 120px 96px`

  const onScroll = (): void => {
    const el = listRef.current
    if (el === null || !hasMore) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) loadMore()
  }

  const selectCommit = (commit: GraphCommit): void => {
    void detail.select(commit)
    if (compact) setPane('detail')
  }

  // Relative-time baseline: `commits` (a fresh array per history query) and
  // `querySignal.sampledAt` are deliberate triggers — neither is read in the
  // body — so every poll re-stamps `now` and the displayed relative times
  // never drift behind the row refresh that follows the same query.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [commits, querySignal.sampledAt])
  const fileTree = useMemo(() => (detail.detail === null ? [] : buildFileTree(detail.detail.stats.map((s) => ({ path: s.path, meta: s.status })))), [detail.detail])
  const selected = detail.selected

  // Changed-file tree folders collapse on click. The collapsed set is stamped
  // with the commit hash it belongs to and derived during render, so switching
  // commits paints fully expanded on the first frame (even for an LRU-cached
  // commit that shares a folder path) without a post-paint reset.
  const selectedHash = selected?.hash ?? null
  const [collapseState, setCollapseState] = useState<{ hash: string | null; dirs: ReadonlySet<string> }>({ hash: null, dirs: EMPTY_DIRS })
  const collapsedDirs = collapseState.hash === selectedHash ? collapseState.dirs : EMPTY_DIRS
  const toggleDir = useCallback((path: string): void => {
    setCollapseState((prev) => {
      const base = prev.hash === selectedHash ? prev.dirs : EMPTY_DIRS
      const next = new Set(base)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { hash: selectedHash, dirs: next }
    })
  }, [selectedHash])

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
    // `detail` is the stable hook face: listing it would re-run this on every
    // render, and the only inputs that change are the commit list and the
    // selection (refresh keys stay structured, not object identity — ADR-0010).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commits, selected])

  // Left branch column + right detail column are drag-resizable; the middle
  // history column takes the remaining space. Widths persist per column.
  const leftCol = useResizableColumn({ storageKey: 'gp.overview.left', initial: 200, min: 130, reserve: 360, edge: 'end', resetTitle: t('resizer.resetWidth') })
  const rightCol = useResizableColumn({ storageKey: 'gp.overview.right', initial: 340, min: 190, reserve: 360, edge: 'start', resetTitle: t('resizer.resetWidth') })
  // Stacked only reads it here (hooks run unconditionally); the wide layout
  // ignores the value. The split is shared across the three stacked surfaces.
  const split = useStackedSplit(t('resizer.resetHeight'))

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
  // (controller accepts the fresh snapshot → query signal advances → history
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

  // Branch switch. It moves HEAD *and* the whole work tree, so it goes through
  // `onAction` (the fresh snapshot feeds the controller → query signal advances →
  // history, branch list, changes and Files caches all reload). `stash` is the
  // user's explicit choice in the confirm dialog for a dirty work tree.
  // The new branch tracks a different upstream, and the ahead/behind counts are
  // only as fresh as the last fetch: check the remote state right away so the
  // status bar cannot keep claiming "up to date" from stale remote-tracking refs
  // (silent — the switch itself must not surface a network failure).
  const runBranchSwitch = async (stash: boolean): Promise<void> => {
    if (switchTarget === null || switchBusy) return
    setOpError(null)
    setSwitchBusy(true)
    try {
      const res = await onAction({
        kind: 'branch-checkout',
        name: switchTarget.name,
        ...(switchTarget.createFrom === undefined ? {} : { createFrom: switchTarget.createFrom }),
        ...(stash ? { stashMessage: t('switch.stashMessage', { branch: switchTarget.name }) } : {}),
      })
      if (res.ok) {
        setSwitchTarget(null)
        void runCheckSync(true)
      } else setOpError(res.error ?? t('error.generic'))
    } finally { setSwitchBusy(false) }
  }

  // Sync check = `git fetch` routed through onAction so the fresh snapshot
  // (updated ahead/behind) feeds straight back into the panel; the branch/tag
  // list reloads too. Pull = `git pull --ff-only`, also through onAction.
  // `silent` (the automatic check after a branch switch) leaves the status bar's
  // error slot alone: a background check that fails must not put an alert in
  // front of the user, and the last known state stays valid.
  const runCheckSync = async (silent = false): Promise<void> => {
    if (syncBusy || snapshot.remote === null) return
    if (!silent) setSyncError(null)
    setSyncBusy(true)
    try {
      const res = await onAction({ kind: 'fetch' })
      if (res.ok) setSyncError(null)
      else if (!silent) setSyncError(res.error ?? t('error.generic'))
    } catch (e) {
      if (!silent) setSyncError(e instanceof Error ? e.message : t('error.generic'))
    } finally { setSyncBusy(false) }
  }
  const runPullFf = async (): Promise<void> => {
    if (pullBusy) return
    setOpError(null)
    setPullBusy(true)
    try {
      const res = await onAction({ kind: 'pull-ff' })
      if (res.ok) setPullConfirm(false)
      else setOpError(res.error ?? t('error.generic'))
    } finally { setPullBusy(false) }
  }
  // One status-bar callback set, shared by the wide and compact placements.
  const statusCbs = {
    syncBusy, syncError, pullBusy, pushBusy, publishBusy,
    onCheck: () => void runCheckSync(),
    onPull: () => { setOpError(null); setPullConfirm(true) },
    onPush: () => { if (canPush(snapshot) && !pushBusy) setPushConfirm(true) },
    onPublish: () => { setOpError(null); setPublishConfirm(true) },
    t,
    // Narrow panels drop the repo link: the compact footer and the tight
    // drawer spend the row on the sync state; wide and stacked 381–760 keep it.
    hideRepo: compact || tight,
  }

  // The modal header path doubles as its copy control (the changes toolbar
  // works the same way): click writes the relative path; the confirmation
  // shows in place as a check mark + tint — the visible text never swaps to
  // the phrase, it rides aria-label / feedback-period title / live region.
  const pathCopy = useCopyFeedback(detail.fileDiff === null ? null : detail.fileDiff.path)
  const fileDiffModal = renderFileDiffModal(detail.fileDiff, {
    visible: queryVisible,
    data: detail.fileDiffData,
    error: detail.fileDiffError,
    mode: detail.fileDiffMode,
    onMode: detail.setFileDiffMode,
    expanded: detail.fileDiffExpanded,
    onExpand: (expand) => { if (detail.fileDiff !== null) detail.openFileDiff(detail.fileDiff.path, detail.fileDiff.hash, detail.fileDiff.shortHash, expand) },
    onClose: detail.closeFileDiff,
    pathFeedback: pathCopy.feedback,
    onCopyPath: pathCopy.copy,
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
    pushConfirm ? h(PushModal, {
      key: 'push',
      remote,
      sessionId,
      snapshot,
      onAction,
      onClose: () => setPushConfirm(false),
      onBusyChange: setPushBusy,
      t,
    }) : null,
    publishConfirm ? h(PublishModal, {
      key: 'publish',
      snapshot,
      onAction,
      onClose: () => setPublishConfirm(false),
      onBusyChange: setPublishBusy,
      t,
    }) : null,
    switchTarget !== null ? renderBranchSwitchConfirm(switchTarget, {
      from: snapshot.branch,
      // The stash choice only makes sense when there is something to stash; the
      // file count matches the changes page's own header.
      dirty: snapshot.dirty ? Math.max(1, snapshot.stats.fileCount) : 0,
      busy: switchBusy,
      error: opError,
      onConfirm: (stash) => void runBranchSwitch(stash),
      onClose: () => setSwitchTarget(null),
      t,
    }) : null,
  ]

  // The history middle column: a toolbar (search / author / since / fetch, plus
  // a filter trigger in compact) over the scrolling commit list.
  // The two filters are the platform Menu — the same dropdown surface the shell
  // uses for its own selectors (trigger via select-trigger.js) — instead of a
  // native <select>. Menu never closes itself, so onSelect closes.
  const authorItems: readonly MenuItem[] = [
    { id: '', label: t('overview.allUsers') },
    ...authors.map((a) => ({ id: a, label: a })),
  ]
  const sinceItems: readonly MenuItem[] = SINCE_OPTIONS.map(([value, key]) => ({ id: value, label: t(key) }))
  const sinceLabel = t(SINCE_OPTIONS.find(([value]) => value === filter.since)?.[1] ?? 'overview.allTime')
  const authorLabel = filter.author === '' ? t('overview.allUsers') : filter.author

  // The refresh action leaves the compact first row with everything else that
  // is not needed for the common "pick a branch, search" flow.
  const moreToggle = compact ? h('button', {
    key: 'more', type: 'button',
    className: `gp-btn gp-toolbar__more-toggle${filter.author !== '' || filter.since !== '' ? ' gp-btn--primary' : ''}`,
    title: t('overview.moreFilters'), 'aria-label': t('overview.moreFilters'),
    'aria-expanded': moreOpen,
    // Only name the panel while it exists: a dangling IDREF is an ARIA error.
    ...(moreOpen ? { 'aria-controls': moreId } : {}),
    onClick: () => setMoreOpen((v) => !v),
  }, h('span', {
    key: 'c', className: `gp-toolbar__chev${moreOpen ? ' gp-toolbar__chev--up' : ''}`,
  }, h(ChevronIcon, { size: 14, open: true }))) : null
  const fetchButton = h('button', { key: 'fetch', type: 'button', className: 'gp-icon-btn', title: t('overview.fetch'), disabled: syncBusy, onClick: () => void runCheckSync() }, h(RefreshIcon, { size: 14 }))
  const authorMenu = h(Menu, {
    key: 'author',
    open: authorOpen,
    onClose: () => setAuthorOpen(false),
    items: authorItems,
    selectedId: filter.author,
    onSelect: (id: string) => {
      setAuthorOpen(false)
      setFilter((prev) => ({ ...prev, author: id }))
    },
    align: 'start',
    portal: true,
    className: 'gp-filter',
    anchor: selectTrigger(authorOpen, authorLabel, () => setAuthorOpen((v) => !v)),
  })
  const sinceMenu = h(Menu, {
    key: 'since',
    open: sinceOpen,
    onClose: () => setSinceOpen(false),
    items: sinceItems,
    selectedId: filter.since,
    onSelect: (id: string) => {
      setSinceOpen(false)
      setFilter((prev) => ({ ...prev, since: id }))
    },
    align: 'start',
    portal: true,
    className: 'gp-filter',
    anchor: selectTrigger(sinceOpen, sinceLabel, () => setSinceOpen((v) => !v)),
  })
  const searchInputEl = h('input', {
    key: 'search', className: 'gp-search', placeholder: t(searchNarrow || compact ? 'overview.searchShort' : 'overview.search'), value: searchInput,
    onChange: (e: { target: { value: string } }) => setSearchInput(e.target.value),
  })
  const secondaryFilters: JSX.Element[] = [authorMenu, sinceMenu, fetchButton]
  // Tight stacked: the left column does not occupy the band, so its only entry
  // is the toolbar's leftmost button — the drawer slides out over the history.
  const drawerToggle = tight
    ? h('button', {
      key: 'branches', type: 'button', ref: drawerToggleRef,
      className: 'gp-icon-btn gp-toolbar__branches',
      title: t('overview.filterBranch'), 'aria-label': t('overview.filterBranch'),
      'aria-expanded': drawerOpen, 'aria-controls': drawerId,
      onClick: () => setDrawerOpen((v) => !v),
    }, h(FilterIcon, { size: 14 }))
    : null
  // Compact hides the secondary filters behind the more chevron so the first
  // row fits the branch trigger + search; wide and stacked show everything —
  // stacked wraps it into two clean rows (search full width over the filters)
  // via its toolbar class rather than hiding anything.
  //
  // Tight stacked keeps the drawer toggle and the search on one row. They share
  // a nowrap row instead of relying on a `calc(100% - 34px)` budget: the touch
  // media query grows icon buttons to 34px, so any arithmetic that assumes the
  // desktop 28px + gap strands the search on a row of its own.
  const toolbarChildren: JSX.Element[] = compact
    ? [
      h('button', {
        key: 'filter', type: 'button', ref: branchDrawer ? drawerToggleRef : null,
        className: `gp-btn${filter.ref !== null ? ' gp-btn--primary' : ''}`,
        title: t('overview.filterBranch'),
        // A phone opens the left drawer; a squeezed desktop column pops the
        // bottom sheet. Same button, same label, different surface.
        ...(branchDrawer
          ? { 'aria-expanded': drawerOpen, 'aria-controls': drawerId, onClick: () => setDrawerOpen((v) => !v) }
          : { onClick: () => setSheetOpen(true) }),
      }, [h(FilterIcon, { key: 'ic', size: 13 }), h('span', { key: 'l', className: 'gp-btn__label' }, filter.ref ?? t('overview.filterBranch'))]),
      searchInputEl,
      ...(moreToggle === null ? [] : [moreToggle]),
      ...(moreOpen
        ? [h('div', { key: 'more', id: moreId, className: 'gp-toolbar__more' }, secondaryFilters)]
        : []),
    ]
    : [
      ...(drawerToggle === null
        ? [searchInputEl]
        : [h('div', { key: 'row', className: 'gp-toolbar__row' }, [drawerToggle, searchInputEl])]),
      ...secondaryFilters,
    ]

  // The history list shares its scroller with paging, so the fill borrows the
  // ref the list already owns instead of nesting another node (see row-slider.tsx).
  const commitSlider = useRowSlider({
    activeSelector: '.gp-commit-row--active',
    deps: [selected?.hash ?? null, commits, compact, stacked],
    host: listRef,
  })
  const historyCol = h('div', { key: 'mid', className: 'gp-col gp-col--mid gp-history' }, [
    // Tight stacked only: the left column — repo list plus branch tree — names
    // the checkout whenever it stays in the band, so the bar would only repeat
    // it; the tier that moves the column behind the drawer needs this line.
    stacked && tight ? h(RepoBar, { key: 'repobar', snapshot, t }) : null,
    h('div', { key: 'tb', className: `gp-toolbar${stacked ? ' gp-toolbar--stacked' : ''}${tight ? ' gp-toolbar--drawer' : ''}`, ref: setSearchEl }, toolbarChildren),
    h('div', { key: 'list', className: 'gp-history__list', ref: listRef, onScroll }, [
      commitSlider.slider,
      commits.length === 0
        ? h('div', { key: 'empty', className: 'gp-empty' }, loading ? t('common.loading') : listError ? t('overview.loadFailed') : t('overview.noResults'))
        : rows.map((row) => renderCommitRow(row, {
          selected: selected?.hash === row.commit.hash,
          // snapshot.head is Git's unique abbreviation; history uses full hashes.
          current: !snapshot.unborn && snapshot.head !== null && snapshot.head !== '' && row.commit.hash.startsWith(snapshot.head),
          gridTpl, laneCount, now, compact, stacked, rowH,
          onSelect: () => selectCommit(row.commit),
          onHoverEnter: detail.onHoverEnter, onHoverLeave: detail.onHoverLeave,
          t,
        })),
    ]),
  ])

  // Changed-file summary (file count + colored +/- counts). Wide puts it above
  // the changed-file tree inside the detail column; compact has no room for a
  // second header row, so it rides the drill-in back bar instead — the caller
  // picks the class and the node is absent until the commit detail lands.
  const renderDetailSummary = (className: string): JSX.Element | null =>
    detail.detail !== null && detail.detail.stats.length > 0
      ? h('div', { className }, [
        h('span', { key: 'f' }, t('overview.changeSummary', { files: detail.detail.stats.length })),
        h('span', { key: 'sep', className: 'gp-detail__summary-sep' }, '·'),
        h('span', { key: 'a', className: 'gp-stats__add' }, `+${detail.detail.insertions}`),
        h('span', { key: 'd', className: 'gp-stats__del' }, `\u2212${detail.detail.deletions}`),
      ])
      : null

  // The right detail column body (changed files + message, or a placeholder) as
  // a keyed child array. Shared by the wide right column and the compact detail
  // pane. The container (.gp-detail) is supplied by each caller.
  // The changed-file rows travel between files like the other lists (see
  // row-slider.tsx); folding a directory moves them, so the tree is a dep.
  const detailSlider = useRowSlider({
    activeSelector: '.gp-tree-row--active',
    deps: [detail.fileDiff, fileTree],
  })
  const detailBody: JSX.Element[] = selected === null
    ? [h('div', { key: 'empty', className: 'gp-empty' }, [h(CommitIcon, { key: 'i', size: 20 }), t('overview.selectCommit')])]
    : [
      h('div', { key: 'files', className: 'gp-detail__files', ref: detailSlider.ref }, [
        detailSlider.slider,
        detail.detail === null
          ? h('div', { key: 'empty', className: 'gp-empty' }, detail.detailError ? t('overview.detailFailed') : t('common.loading'))
          : [
            compact ? null : renderDetailSummary('gp-detail__summary'),
            renderFileTree(fileTree, {
              activePath: detail.fileDiff?.path ?? null,
              openTitle: t('overview.openFileDiff'),
              onOpen: (path) => { if (selected !== null) void detail.openFileDiff(path, selected.hash, selected.shortHash) },
              collapsed: collapsedDirs,
              onToggleDir: toggleDir,
              expandLabel: t('overview.expandDir'),
              collapseLabel: t('overview.collapseDir'),
            }),
          ],
      ]),
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

  // Stacked: a tall narrow sidebar spends its height instead of drilling. The
  // top band keeps the wide layout's first two columns — the complete branch
  // list (filter + switch + browse) beside the history — and the commit detail
  // spans the full width below. Selecting a row updates the detail in place.
  // Tight (≤ STACKED_TIGHT_BP): the branch column leaves the flex flow for a
  // drawer over the history — collapsed by default, so the history gets the
  // whole band until the toggle, the backdrop or Escape brings the column back.
  // The repository list leads whichever surface carries the branch tree — the
  // wide left column, the stacked band (or its drawer), the compact drawer or
  // sheet — so every layout switches checkouts from the same place.
  const reposBlock = repositories === undefined
    ? null
    : h(ReposSection, { key: 'repos', choices: repositories.choices, current: repositories.current, snapshot, onChoose: repositories.onChoose, collapsed: repositories.collapsed ?? false, onToggleCollapse: repositories.onToggleCollapse, t })

  if (stacked) {
    const branchList = h(BranchScroll, { key: 'scroll', tree, treeError, activeRef: filter.ref, closed: closedSections, cbs: {
      onFilter: (ref) => setRef(ref),
      switchOptions,
      onSwitch: openSwitch,
      onToggle: toggleSection,
      onRetry: reloadTree,
      t,
    }, trees: branchTrees })
    const status = renderStatusBar(snapshot, statusCbs)
    const leftChildren: JSX.Element[] = [
      reposBlock,
      branchList,
      status,
    ].filter((node): node is JSX.Element => node !== null)
    const topChildren: JSX.Element[] = tight
      ? [
        // Backdrop first (click the blank band to dismiss), then the drawer
        // above it, then the history it covers — z-index lives in stacked.ts.
        ...renderBranchDrawer({
          open: drawerOpen, id: drawerId, className: 'gp-col gp-col--left gp-drawer',
          rootRef: drawerRootRef, closeRef: drawerCloseRef, toggleRef: drawerToggleRef,
          onClose: () => setDrawerOpen(false), children: leftChildren, t,
        }),
        historyCol,
      ]
      : [h('div', { key: 'left', className: 'gp-col gp-col--left' }, leftChildren), historyCol]
    return h('div', { className: 'gp-overview gp-overview--stacked' }, [
      fileDiffModal,
      ...opModals,
      h('div', { key: 'top', className: 'gp-overview__top', style: { flex: `0 0 ${split.pct}%` } }, topChildren),
      h('div', {
        key: 'split', className: 'gp-resizer gp-resizer--row', role: 'separator',
        'aria-orientation': 'horizontal',
        ...split.dividerProps,
      }),
      h('div', { key: 'detail', className: 'gp-col gp-col--mid gp-detail' }, detailBody),
    ])
  }

  // Compact: a single column that drills from the history list into the commit
  // detail; the branch filter is a bottom sheet on a desktop-sized screen and
  // the left drawer on a phone (branchDrawer). No hover card (tap drills in).
  // The header spends its row on the back button + the change summary: the
  // short hash it used to carry is already in the commit-row meta and in the
  // message meta below, so repeating it here only cost the second row.
  if (compact) {
    // The phone's drawer overlays the whole tab: the compact root is its
    // containing block, so it covers the status-bar footer too. Picking a ref or
    // a switch target closes it and returns to the filtered history at once.
    const drawerChildren: JSX.Element[] = branchDrawer
      ? renderBranchDrawer({
        open: drawerOpen, id: drawerId, className: 'gp-col gp-drawer',
        rootRef: drawerRootRef, closeRef: drawerCloseRef, toggleRef: drawerToggleRef,
        onClose: () => setDrawerOpen(false),
        children: [
          ...(reposBlock === null ? [] : [reposBlock]),
          h(BranchScroll, { key: 'scroll', tree, treeError, activeRef: filter.ref, closed: closedSections, cbs: {
            onFilter: (ref) => { setRef(ref); setDrawerOpen(false) },
            switchOptions,
            onSwitch: (option) => { setDrawerOpen(false); openSwitch(option) },
            onToggle: toggleSection,
            onRetry: reloadTree,
            t,
          }, trees: branchTrees }),
        ],
        t,
      })
      : []
    return h('div', { className: 'gp-overview gp-overview--compact' }, [
      fileDiffModal,
      ...opModals,
      pane === 'detail'
        ? h('div', { key: 'detail', className: 'gp-col gp-col--mid gp-detail' }, [
          h('div', { key: 'back', className: 'gp-subhead' }, [
            h('button', { key: 'b', type: 'button', className: 'gp-subhead__back', onClick: () => setPane('list') }, [h(ArrowLeftIcon, { key: 'i', size: 14 }), t('overview.backToList')]),
            renderDetailSummary('gp-detail__summary gp-detail__summary--inline'),
          ]),
          ...detailBody,
        ])
        : historyCol,
      renderStatusBar(snapshot, statusCbs),
      ...drawerChildren,
      sheetOpen ? renderBranchSheet(tree, treeError, filter.ref, closedSections, {
        onFilter: (ref) => { setRef(ref); setSheetOpen(false) },
        switchOptions,
        onSwitch: (option) => { setSheetOpen(false); openSwitch(option) },
        onToggle: toggleSection,
        onRetry: reloadTree,
        onClose: () => setSheetOpen(false),
        t,
      }, branchTrees, reposBlock) : null,
    ])
  }

  return h('div', { className: 'gp-overview' }, [
    // file-diff modal (click a changed file in the right column)
    fileDiffModal,
    ...opModals,
    // left: branches (scroll) + a fixed status bar footer (repo link + sync)
    h('div', { key: 'left', className: 'gp-col gp-col--left', style: { flex: `0 0 ${leftCol.width}px` } }, [
      reposBlock,
      h(BranchScroll, { key: 'scroll', tree, treeError, activeRef: filter.ref, closed: closedSections, cbs: {
        onFilter: (ref) => setRef(ref),
        switchOptions,
        onSwitch: openSwitch,
        onToggle: toggleSection,
        onRetry: reloadTree,
        t,
      }, trees: branchTrees }),
      renderStatusBar(snapshot, statusCbs),
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
  /** Switch targets by row key; a row without one (current branch, tags) has no switch button. */
  switchOptions: ReadonlyMap<string, BranchOption>
  /** Opens the switch confirm; the row click itself stays the history filter. */
  onSwitch: (option: BranchOption) => void
  onToggle: (section: string) => void
  onRetry: () => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Folded trees for the three ref sections, built once per snapshot. */
interface BranchTrees {
  readonly local: readonly BranchTreeNode[]
  readonly localPinned: readonly GitBranch[]
  readonly localPrimary: string | null
  readonly remotePrimary: string | null
  readonly remote: readonly BranchTreeNode[]
  readonly tags: readonly BranchTreeNode[]
}

interface BranchScrollProps {
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
function BranchScroll({ tree, treeError, activeRef, closed, cbs, trees }: BranchScrollProps): JSX.Element {
  const slider = useRowSlider({ activeSelector: '.gp-branch-row--active', deps: [activeRef, tree, trees, closed] })
  return h('div', { className: 'gp-col-left__scroll', ref: slider.ref }, [
    slider.slider,
    renderBranchList(tree, treeError, activeRef, closed, cbs, trees),
  ])
}

function renderBranchList(tree: BranchTree | null, treeError: boolean, activeRef: string | null, closed: ReadonlySet<string>, cb: BranchCbs, trees: BranchTrees): JSX.Element {
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

interface BranchSheetCbs extends BranchCbs {
  onClose: () => void
}

/** Compact branch/ref filter: a bottom sheet carrying the same branch list,
 * portaled over the panel, led by the repository list when there is one.
 * Selecting a ref applies the filter and closes it; the backdrop and the close
 * button dismiss it. */
function renderBranchSheet(tree: BranchTree | null, treeError: boolean, activeRef: string | null, closed: ReadonlySet<string>, cb: BranchSheetCbs, trees: BranchTrees, lead: JSX.Element | null): JSX.Element | null {
  if (typeof document === 'undefined') return null
  const sheet = h('div', {
    className: 'gp-sheet-backdrop',
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

interface RowCbs {
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

interface FileTreeCbs {
  activePath: string | null
  openTitle: string
  onOpen: (path: string) => void
  collapsed: ReadonlySet<string>
  onToggleDir: (path: string) => void
  expandLabel: string
  collapseLabel: string
}

function renderFileTree(nodes: ReturnType<typeof buildFileTree>, cb: FileTreeCbs): JSX.Element {
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

interface FileDiffModalCbs {
  visible: boolean
  /** Diff text + new-side line count from the same query (null while loading). */
  data: GitDiffPayload | null
  error: boolean
  mode: DiffMode
  onMode: (mode: DiffMode) => void
  expanded: boolean
  onExpand: (expand: boolean) => void
  onClose: () => void
  /** Click-to-copy state of the header path: idle until the user copies. */
  pathFeedback: CopyFeedback
  /** Writes the open diff's relative path (`copy()` defaults to it). */
  onCopyPath: () => void
  remote: GitPanelRemote
  sessionId: string
  compact: boolean
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Centered dialog showing a commit's file diff. Portaled to document.body so
 * it floats above the whole panel; Esc / backdrop click / the close button
 * dismiss it (Esc is wired by the caller). */
function renderFileDiffModal(
  fileDiff: { path: string; hash: string; shortHash: string } | null,
  cb: FileDiffModalCbs,
): JSX.Element | null {
  if (fileDiff === null || typeof document === 'undefined') return null
  const { visible, data, error, mode, onMode, expanded, onExpand, onClose, pathFeedback, onCopyPath, remote, sessionId, compact, t } = cb
  // Compact drops the side-by-side mode (no room on a phone) and renders split
  // as unified instead; the preference itself is left untouched.
  const modes: DiffMode[] = compact ? ['unified', 'before', 'after'] : ['unified', 'split', 'before', 'after']
  const effMode: DiffMode = compact && mode === 'split' ? 'unified' : mode
  const sumEl = data !== null && data.text !== '' ? (() => { const s = diffSummary(data.text); return h('span', { key: 'sum', className: 'gp-modal__sum' }, [h('span', { key: 'a', className: 'gp-stats__add' }, `+${s.add}`), h('span', { key: 'd', className: 'gp-stats__del' }, `\u2212${s.del}`)]) })() : null
  // Icon-only, matching the changes pane's toolbar: the label rides title/aria,
  // the pressed state marks the expansion.
  const expandLabel = t(expanded ? 'diff.collapse' : 'diff.expandAll')
  const expandEl = h('button', {
    key: 'expand', type: 'button',
    className: 'gp-icon-btn gp-diff__expand',
    disabled: effMode !== 'split' && effMode !== 'unified',
    title: expandLabel,
    'aria-label': expandLabel,
    'aria-pressed': expanded,
    onClick: () => onExpand(!expanded),
  }, h(ExpandAllIcon, { size: 14 }))
  const segEl = h('div', { key: 'seg', className: 'gp-seg' },
    segButtons<DiffMode>(modes, effMode, onMode, (m) => t(`diff.${m}` as GitKey)))
  const closeEl = h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-modal__close', title: t('common.close'), onClick: onClose }, h(CloseIcon, { size: 15 }))
  // The header path doubles as its copy control, in the same shape as the
  // changes pane's and the files toolbar's (path-copy-button.tsx). `--copy`
  // carries the button affordance because the bare `.gp-modal__path` class is
  // shared with plain titles.
  const pathEl = pathCopyButton({
    elementKey: 'path',
    path: fileDiff.path,
    feedback: pathFeedback,
    onCopy: onCopyPath,
    t,
    rootClass: 'gp-modal__path',
    extraClass: 'gp-modal__path--copy',
    dirClass: 'gp-modal__dir',
    nameClass: 'gp-modal__name',
    checkSize: 12,
    separator: 'attached',
  })
  const barHead = [
    h('span', { key: 'fileicon', className: 'gp-modal__fileicon' }, h(FileIcon, { size: 15 })),
    pathEl,
    h('span', { key: 'hash', className: 'gp-modal__hash' }, fileDiff.shortHash),
    sumEl,
    expandEl,
  ]
  // Compact mirrors the changes-pane toolbar: one row cannot fit header +
  // mode seg + close at phone widths, so the seg and a bordered close button
  // move to a dedicated second row (close at its far right).
  const barChildren = compact
    ? [
      h('div', { key: 'brow1', className: 'gp-modal__bar-row' }, barHead),
      h('div', { key: 'brow2', className: 'gp-modal__bar-row gp-modal__bar-row--controls' }, [segEl, closeEl]),
    ]
    : [...barHead, segEl, closeEl]
  const modal = h('div', {
    className: 'gp-modal-backdrop',
    // Declares this dialog as an overlay above the page, so the branch drawer's
    // Escape handler yields the keystroke instead of closing both layers.
    [OVERLAY_ATTR]: '',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) onClose() },
  }, h('div', { className: 'gp-modal', role: 'dialog', 'aria-modal': true }, [
    h('div', { key: 'bar', className: 'gp-modal__bar' }, barChildren),
    h('div', { key: 'scroll', className: 'gp-modal__scroll' },
      data === null
        ? h('div', { className: 'gp-empty' }, error ? t('overview.diffFailed') : t('common.loading'))
        : h(DiffView, { key: 'diff', visible, text: data.text, mode: effMode, path: fileDiff.path, remote, sessionId, base: 'commit', commit: fileDiff.hash, expanded, truncated: data.truncated === true, newLines: data.newLines, t })),
  ]))
  return createPortal(modal, document.body, 'file-diff-modal')
}

