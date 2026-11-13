/**
 * Main Git panel shell: Overview / Changes / Files over the conversation.view
 * slot, three sub-tabs in every layout (the browser alone for a cwd with no
 * checkout). Snapshot state chooses the initial tab unless the input-bar pill
 * supplied a one-shot focus request.
 *
 * The repository list has no page of its own: it leads the surface that holds
 * the branch tree (and, outside compact, the changes column), both copies
 * sharing one collapse state owned here. The panel also owns the per-session
 * checkout pick, the file browser's root selector, and the switch between
 * checkouts.
 */
import { createElement as h, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { inertAttr } from './inert.js'
import type { JSX } from 'react'
import { SegmentedTabs, StateDot, writeClipboard, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { gitPanelRemoteOf, hasSession, queryAs, type ClientCtx } from './rpc.js'
import { useGitView, controllerFor } from './registry.js'
import type { GitView } from './controller.js'
import { takeSubTab, subscribeSubTab, stashSubTab, recentSubTab, type SubTab } from './jump.js'
import { OverviewTab } from './OverviewTab.js'
import { ChangesTab } from './ChangesTab.js'
import { FilesTab } from './FilesTab.js'
import { filesRootRows, gitRepoForFilesRoot, repoChoices } from './repo-list.js'
import { CommitIcon, DiffIcon, FilesIcon } from './icons.js'
import { usePanelLayout } from './layout.js'
import { isCramped, panelMode, STACKED_TIGHT_BP } from './panel-fit.js'
import { hasConfigForms, writePanelConfigField } from './config-write.js'
import type { FontDelta, GitAction, GitRepoEntry, GitRepoList } from './types.js'
import type { RepoChoice } from './repo-list.js'
import type { GitKey } from './locales.js'
import { opErrorText, renderConfirmModal } from './ops-modals.js'
import { baseName } from './path-name.js'
import { discardUnsavedEdit, hasUnsavedEdit } from './edit-store.js'
import { NoticeBar } from './notice.js'
import { VersionBar } from './version-bar.js'
import { usePageVisibility } from './use-page-visibility.js'
import { clearFilesRootPin, clearRepoPick, filesRootPick, filesRootSelector, hasRepoPick, pickFilesRoot, knownFilesFollowConfig, resumeFilesRootFollow, selectedRepo, selectRepo, pinnedFilesRoot, subscribeRepoSelection, syncFilesFollowConfig, withRepo } from './repo-select.js'
import { PanelMenuContext } from './menu-context.js'
import { usePanelMenu } from './use-panel-menu.js'
import { contextMenusOf } from './menu-register.js'
import { insertSessionQuote } from './quote.js'
import { CompareHost, type CompareRequest } from './compare-host.js'
import { compareApplies } from './compare-refs.js'
import { runRemoteFetch } from './fetch-report.js'
import type { OverviewMenuCommands, OverviewMenuFacts } from './overview-menu.js'
import type { ChangesMenuCommands, ChangesMenuFacts } from './changes-menu.js'
import type { ReposMenuCommands, ReposMenuFacts } from './repos-menu.js'
import { MENU_KIND } from './menu-owners.js'
import type { TreeTargetValue } from './menu-owners.js'
import type { UseContextMenu } from './menu-types.js'
import type { MenuSource } from './menu-types.js'

/** No overview mounted: the branch/commit entries cannot act, and the owner is
 * only reachable from rows that overview renders. */
const EMPTY_OVERVIEW_COMMANDS: OverviewMenuCommands = {
  switchBranch: () => {},
  filterRef: () => {},
  openTagCreate: () => {},
  openBranchDelete: () => {},
  openRemoteBranchDelete: () => {},
  openBranchCreate: () => {},
  openBranchMerge: () => {},
  openCherryPick: () => {},
  openRevert: () => {},
  openReset: () => {},
  openCheckout: () => {},
  quote: () => {},
}

/** No changes tab mounted: its rows do not exist, so nothing can reach these. */
const EMPTY_CHANGES_COMMANDS: ChangesMenuCommands = {
  openDiff: () => {},
  stage: () => {},
  openDiscard: () => {},
  stashApply: () => {},
  stashPop: () => {},
  openStashDrop: () => {},
}

function coerceFontDelta(value: unknown): FontDelta {
  return value === -1 || value === 1 ? value : 0
}

/** Pre-migration localStorage key for the panel font step (removed from the
 * write path when fontDelta moved into the host config). */
const LEGACY_FONT_KEY = 'gp.panel.fontDelta'

interface PanelProps {
  readonly ctx: ClientCtx
  readonly sessionId?: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  /** Where the panel is mounted. The sidebar has no composer under it, so the
   * conversation view's overlay mode and its reserved height do not apply. */
  readonly host?: 'conversation' | 'sidebar'
  /** Whether the mounting surface is currently on screen. The sidebar reports
   * its own tab's visibility, so a hidden tab starts no queries. */
  readonly visible?: boolean
  /** The slot's injected menu bindings (dsh ≥ 0.2.2-alpha.3); absent on older
   * hosts, where rows keep the native context menu. */
  readonly useContextMenu?: UseContextMenu
}

export function Panel({ ctx, sessionId, t, host = 'conversation', visible, useContextMenu }: PanelProps): JSX.Element {
  const pageVisible = usePageVisibility()
  const [fontPending, setFontPending] = useState<FontDelta | null>(null)
  // Monotonic token for the latest font write: a slow host set for an older
  // click must not clear (or race) a newer pending step.
  const fontWriteGen = useRef(0)
  // The leaving sub-tab is restored in the initializer, not in an effect: an
  // effect lands after the first paint, so a return to the panel showed
  // `tabs[0]` for one frame before jumping to the page the user left.
  const [selection, setSelection] = useState<{ sessionId: string; tab: SubTab } | null>(() => {
    if (sessionId === undefined) return null
    const recent = recentSubTab(sessionId)
    return recent === null ? null : { sessionId, tab: recent }
  })
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  // Compact layout kicks in on a narrow panel (phone / squeezed split): the
  // three-column tabs collapse to single-column drill-in. Width-driven, so it
  // recovers the full layout as soon as the panel widens.
  const layout = usePanelLayout(rootEl)
  // The mode folds the width/height facts with the mount point: a tall narrow
  // right sidebar stacks its panes (PC height, no drilling), while phones and
  // squeezed conversation columns drill exactly as before (panel-fit.ts).
  const mode = panelMode(layout, host)
  const compact = mode === 'compact'
  const stacked = mode === 'stacked'
  // A sidebar dragged to its minimum cannot host the full tab labels plus the
  // font stepper; it drops to the phone's treatment instead (short labels,
  // stepper hidden). Below the threshold the row reads crushed, not merely
  // clipped — flex absorbs the width without any overflow to detect.
  const stackedTight = stacked && layout.width > 0 && layout.width <= STACKED_TIGHT_BP
  const shortLabels = compact || stackedTight
  // Narrow AND short is the only case that trades content away for room (the
  // commit editor's fold, the change timestamps): a big screen whose column a
  // sidebar narrowed keeps them, because it has the height to spare.
  const cramped = isCramped(layout)
  const view = useGitView(sessionId)
  const remote = gitPanelRemoteOf(ctx)
  // The font stepper writes through the settings form; without it the control
  // would silently no-op, so it is not rendered at all.
  const fontWritable = hasConfigForms(ctx)
  // git not installed degrades to the file browser too; inside a repo we add a
  // notice, outside one it is a silent fallback (same as not-a-git-repo).
  const gitUnavailable = view.state === 'error' && view.error.code === 'git-unavailable'
  const filesOnly = view.state === 'error' && (view.error.code === 'not-a-git-repo' || view.error.code === 'git-unavailable')
  // The absolute directory the browser is rooted at, for the Files status bar.
  // Only the failure carries it (the snapshot is null in the degrade); an
  // older host that omits the field degrades to a bar without a path rather
  // than a fabricated one.
  const browsePath = view.state === 'error' ? view.error.cwd : undefined
  const gitMissingInRepo = gitUnavailable && view.state === 'error' && view.error.isGitRepo === true
  // Wait for the snapshot before mounting any git-backed pane. An explicit pill
  // jump takes priority; switching sessions resets the one-shot default.
  const pickedTab = selection !== null && selection.sessionId === sessionId ? selection.tab : null
  // A cwd that is not a checkout has a single page — the browser — with no
  // repository menu of its own; every selection lands there.
  const activeTab: SubTab | null = filesOnly ? 'files' : pickedTab
  // A repository switch keeps the previous sample on screen while the new one
  // is in flight; this flag drives the dimmer and the tab-bar badge.
  const [repoSwitching, setRepoSwitching] = useState(false)
  const visited = useRef<{ sessionId?: string; tabs: Set<SubTab> }>({ tabs: new Set() })
  if (visited.current.sessionId !== sessionId) visited.current = { sessionId, tabs: new Set() }
  if (activeTab !== null) visited.current.tabs.add(activeTab)
  // The stored pick counts as a visit even while the browser overrides it: a
  // pick that lands on a checkout must find its page mounted once the new
  // sample arrives, not a placeholder counting as "never opened".
  if (pickedTab !== null) visited.current.tabs.add(pickedTab)
  const filesVisited = visited.current.tabs.has('files')

  useEffect(() => {
    if (!hasSession(sessionId)) return
    if (filesOnly) {
      // The browser is the only page here, so a pick of any other tab still
      // lands on it. A switch in flight is the exception: the pick may land on
      // a checkout, and its target tab must survive until the new sample says
      // whether it exists.
      if (selection?.sessionId === sessionId && selection.tab === 'files') return
      if (repoSwitching) return
      setSelection({ sessionId, tab: 'files' })
      return
    }
    // A pending pill jump outranks both the restored pick and the stored
    // selection: it is an explicit request, consumed once per mount.
    const pending = takeSubTab(sessionId)
    if (pending !== null) { setSelection({ sessionId, tab: pending }); return }
    if (selection?.sessionId === sessionId) return
    // A quick return (within the sticky window) restores the last sub-tab
    // instead of recomputing the default entry; an explicit pill jump above
    // still wins.
    const recent = recentSubTab(sessionId)
    if (recent !== null) { setSelection({ sessionId, tab: recent }); return }
    if (view.state === 'ready') setSelection({ sessionId, tab: view.snapshot.dirty ? 'changes' : 'overview' })
  }, [sessionId, view, filesOnly, repoSwitching, selection?.sessionId, selection?.tab])

  // While mounted, receive pill jumps live (a click when the panel is already
  // visible must still switch sub-tabs, not sit in the pending map).
  useEffect(() => {
    if (!hasSession(sessionId)) return
    return subscribeSubTab(sessionId, (requested) => setSelection({ sessionId, tab: requested }))
  }, [sessionId])

  // Stash the sub-tab the panel is leaving on so a quick return restores it.
  // A ref carries the latest value into the unmount-only cleanup.
  const leavingRef = useRef<{ sessionId?: string; tab: SubTab | null }>({ tab: null })
  leavingRef.current = { sessionId, tab: activeTab }
  useEffect(() => () => {
    const { sessionId: sid, tab } = leavingRef.current
    if (sid !== undefined && tab !== null) stashSubTab(sid, tab)
  }, [])

  // Visible leaf tabs subscribe to query ticks and the restore gate themselves;
  // a same-fingerprint catch-up must not require a Panel business notification.
  // In the sidebar the mount is only on screen while its tab is selected, so the
  // host's own visibility gates the queries too.
  const queryVisible = pageVisible && hasSession(sessionId) && visible !== false

  // Work-tree generation: bumped whenever the *contents* of the work tree are
  // replaced wholesale — a branch switch, or a switch that stashed the local
  // changes first (which removes files even when the checkout then fails). The
  // Files tab keeps a per-session directory cache that would otherwise serve
  // the previous branch's tree for up to a minute; this tells it to drop it.
  const [worktreeGen, setWorktreeGen] = useState(0)
  // The git-not-installed banner can be dismissed for this mount.
  const [gitNoticeClosed, setGitNoticeClosed] = useState(false)
  // The outage banner has its own latch: dismissal lives exactly as long as
  // the outage (a recovered view resets it, so the next outage announces
  // itself), and closing it must not silence the unrelated git-missing banner.
  const [staleNoticeClosed, setStaleNoticeClosed] = useState(false)
  useEffect(() => {
    if (view.state !== 'ready' || view.stale !== true) setStaleNoticeClosed(false)
  }, [view])
  // Manual file-root picks live in the module store (repo-select.ts); this
  // state exists only to re-render the panes when one changes.
  const [, setFilesRootBump] = useState(0)
  // A repository switch that would move the file browser away from an unsaved
  // edit waits here for the user's answer.
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)

  // Repository selection: '' follows the repository the session cwd belongs to
  // (walk-up), anything else follows a nested repository below that cwd. The
  // pick is remembered per session (repo-select.ts); carrying a state pair lets
  // a session switch derive the new session's pick instead of showing the
  // previous session's repository for one render.
  const [repos, setRepos] = useState<readonly GitRepoEntry[]>([])
  const [repoListReady, setRepoListReady] = useState(false)
  // Recognition state of the session's `.code-workspace` file: the switcher
  // turns `available` into an offer to switch the feature on (ADR-0035).
  const [repoWorkspace, setRepoWorkspace] = useState<GitRepoList['codeWorkspace']>()
  const [repoWorkspaceEnabling, setRepoWorkspaceEnabling] = useState(false)
  // A refused write is not a no-op: the row keeps the offer and says the write
  // did not land, otherwise the click reads as a dead control.
  const [repoWorkspaceFailed, setRepoWorkspaceFailed] = useState(false)
  // Enabling the setting writes plugin config, which rebuilds the host service;
  // the list is fetched again once that settles.
  const [repoListEpoch, setRepoListEpoch] = useState(0)
  // The scan's cwd: the project root the browser names when the cwd owns no
  // checkout of its own.
  const [repoCwd, setRepoCwd] = useState<string | null>(null)
  // The list block's collapsed state belongs to the panel, not the overview, so
  // it survives navigating between panes. It boots collapsed.
  const [reposCollapsed, setReposCollapsed] = useState(true)
  // The selection lives in the shared store, not in this component: a session
  // can have two panels mounted at once (conversation tab + sidebar copy) and
  // both write through it, so one instance must never hold its own copy of the
  // pick while the snapshot behind them comes from the shared controller.
  const repo = useSyncExternalStore(
    subscribeRepoSelection,
    () => (sessionId === undefined ? '' : selectedRepo(sessionId)),
  )
  // The list belongs to one session's cwd: drop it when the session changes so
  // the switcher cannot offer the previous workspace's repositories. The ready
  // flag separates "no answer yet" from "an answer with no repositories" — only
  // the latter may retire a remembered pick.
  useEffect(() => {
    setRepos([])
    setRepoListReady(false)
    setRepoCwd(null)
    // The recognition state describes one cwd, so it must not survive the
    // switch either: the next session would show this session's file offer
    // (and keep showing it if its own repo-list never answers).
    setRepoWorkspace(undefined)
    setRepoWorkspaceEnabling(false)
    setRepoWorkspaceFailed(false)
  }, [sessionId])
  // The switch is over once the controller publishes the next sample — a ready
  // view of another root, or the failure that explains why it is not coming.
  // The published view is the reference point: it does not change while the old
  // sample stays on screen, so a bare state check would end the switch before it
  // started.
  const switchBase = useRef<GitView | null>(null)
  useEffect(() => {
    if (!repoSwitching || view === switchBase.current) return
    setRepoSwitching(false)
  }, [view, repoSwitching])
  // The body goes inert for the switch (the sample on screen belongs to the
  // previous checkout while every write is already tagged with the next one),
  // which drops focus to the document; hand it back to the control that held
  // it once the body is live again.
  const switchFocus = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (repoSwitching) return
    const el = switchFocus.current
    switchFocus.current = null
    if (el === null || !el.isConnected) return
    if (document.activeElement !== null && document.activeElement !== document.body) return
    el.focus({ preventScroll: true })
  }, [repoSwitching])
  // Every repository-scoped call of the panes and of the write path goes
  // through this face: the tabs stay unaware of the selection.
  const repoRemote = useMemo(() => withRepo(remote, repo), [remote, repo])
  // The controller samples exactly one repository; keep it aligned with the
  // switcher. setRepo() keeps the previous sample published until the new one
  // lands; the body dims and goes inert meanwhile (repoSwitching).
  useEffect(() => {
    if (!hasSession(sessionId)) return
    const controller = controllerFor(sessionId)
    if (controller.getRepo() === repo) return
    void controller.setRepo(repo)
  }, [sessionId, repo])

  // A pick the host can no longer resolve is dropped back to the default
  // repository. Unlike chooseRepo this keeps the current page: the reset is a
  // repair of the selection, not a navigation, and the page was never the
  // problem. It also skips the dim-in-place switch — there is no next tree to
  // wait for, the default one is already resolved.
  const dropRepo = (): void => {
    if (!hasSession(sessionId)) return
    clearRepoPick(sessionId)
  }

  // Point the panel at another checkout without navigating. The panes keep the
  // previous sample until the new one lands; the body dims and the tab bar says
  // why, so the switch reads as one step rather than a collapse and a rebuild.
  // The current view is the reference point the completion effect compares
  // against.
  const switchRepo = (next: string): boolean => {
    if (!hasSession(sessionId) || next === repo) return false
    selectRepo(sessionId, next)
    // Hand the controller the new checkout in this same event rather than from
    // an effect: effects run after paint, and the first paint after the pick
    // already shows the next repository's name in the tab bar, so a write
    // dispatched from it would still be tagged with the previous one.
    const controller = controllerFor(sessionId)
    void controller.setRepo(next)
    // A checkout read before turns the page on the spot: its sample republishes
    // during the call above, so dimming the body here would be a flicker rather
    // than feedback on a wait.
    if (controller.showsRepo(next)) return true
    switchBase.current = view
    const active = document.activeElement
    switchFocus.current = active instanceof HTMLElement && active !== document.body ? active : null
    setRepoSwitching(true)
    return true
  }

  const chooseRepo = (next: string): void => {
    if (!hasSession(sessionId) || !switchRepo(next)) return
    // By default a pick leaves the block open: the rows stay where the pointer
    // left them, so switching again is one click. `collapseReposOnPick` folds it
    // instead, handing the column back to the branch tree. Both docked copies
    // share that state; a repeat pick of the current checkout returns above and
    // leaves the block alone.
    if (collapseOnPick) setReposCollapsed(true)
    // The pick comes from the list on the page in front — the overview's
    // branch surface (column, band, drawer or sheet) or the changes column — so
    // that page stays put; an entry that no longer resolves is the fall-through
    // to the browser.
    const target = repos.find((entry) => entry.path === next)
    const stay: SubTab = activeTab === 'changes' ? 'changes' : 'overview'
    setSelection({ sessionId, tab: target !== undefined ? stay : 'files' })
  }

  // The probe switch rides the snapshot, so a config write re-answers the list
  // in place; an older host omits the field → treated as on (list as before).
  // Sticky at the last ready answer: the view dropping to error (boot, a failed
  // sample) must not flip the dependency and re-answer the list for nothing.
  const detectRef = useRef(true)
  if (view.state === 'ready') detectRef.current = view.snapshot.detectCheckouts ?? true
  const detectCheckouts = detectRef.current

  // Whether a pick folds the repository list rides the snapshot too, sticky at
  // the last ready answer; an older host omits it → off, the list stays open.
  const collapseOnPickRef = useRef(false)
  if (view.state === 'ready') collapseOnPickRef.current = view.snapshot.collapseReposOnPick ?? false
  const collapseOnPick = collapseOnPickRef.current

  // The browser's follow switch rides the snapshot the same way, sticky at the
  // last ready answer (a view dip must not flip it); an older host omits the
  // field → off, the browser parks at the project root by default. It is only
  // the default: a session can override it either way from the root dropdown.
  // Before this panel's first ready sample it borrows the value another panel
  // already read: the config is host-wide.
  const filesFollowRef = useRef<boolean | null>(null)
  if (view.state === 'ready') filesFollowRef.current = view.snapshot.filesFollowRepo ?? false
  const filesFollow = filesFollowRef.current ?? knownFilesFollowConfig() ?? false
  // A config flip re-arms the default for every session: overrides belong to
  // the setting that was in force when they were made. The detection lives in
  // the module store, keyed on sample age, so a cold mount or a second panel
  // instance reading the value for the first time is not mistaken for a flip.
  // The bump re-renders the panes off the store.
  const readyFollow = view.state === 'ready' ? view.snapshot.filesFollowRepo ?? false : null
  const readyAt = view.state === 'ready' ? view.snapshot.checkedAt : null
  useEffect(() => {
    if (readyFollow === null || readyAt === null) return
    if (syncFilesFollowConfig(readyFollow, readyAt)) setFilesRootBump((n) => n + 1)
  }, [readyFollow, readyAt])
  // The browser runs under its own selector — an explicit root pick → the
  // follow opt-in → the config default (off: the project root, on: the
  // repository the panel follows). The generation bumps only when that
  // selector changes, so switching repositories while the browser is parked at
  // the project root keeps the tree the user is browsing.
  const filesSelector = sessionId === undefined ? '' : filesRootSelector(sessionId, filesFollow)
  const filesSelRef = useRef(filesSelector)
  useEffect(() => {
    if (filesSelRef.current === filesSelector) return
    filesSelRef.current = filesSelector
    setWorktreeGen((n) => n + 1)
  }, [filesSelector])
  const filesRemote = useMemo(() => withRepo(remote, filesSelector), [remote, filesSelector])
  // The edit switch is host-wide config riding the sample, sticky at the last
  // ready answer like the follow switch; an older host omits it → on (the
  // host still decides per read whether a file is editable).
  const allowEditRef = useRef(true)
  if (view.state === 'ready') allowEditRef.current = view.snapshot.allowFileEdit ?? true
  const allowFileEdit = allowEditRef.current
  // The package-folding switch is host-wide config riding the same sample;
  // sticky so a repository switch does not briefly flip the browser's shape.
  // An older host omits it → on, and the request flag is then ignored there.
  const compactPackagesRef = useRef(true)
  if (view.state === 'ready') compactPackagesRef.current = view.snapshot.compactPackages ?? true
  const compactPackages = compactPackagesRef.current
  // A root pick is a directory switch, and Git follows every directory switch:
  // a root that is a checkout moves the overview and changes with it (the
  // browser stays in front). The reverse is the follow setting's call.
  const applyFilesRootPick = (selector: string | null): void => {
    if (sessionId === undefined) return
    if (selector === null) resumeFilesRootFollow(sessionId)
    else pickFilesRoot(sessionId, selector)
    setFilesRootBump((n) => n + 1)
    const gitTarget = gitRepoForFilesRoot(selector, repos)
    if (gitTarget !== null) switchRepo(gitTarget)
  }

  useEffect(() => {
    if (!queryVisible) return
    let alive = true
    void (async () => {
      const listed = queryAs(
        await remote.query({ sessionId: sessionId as string, query: { kind: 'repo-list' } }),
        'repo-list',
      )
      if (!alive || listed === null) return
      // A reply without the list (an older host) degrades to "one repository"
      // rather than blanking the tab bar on a missing field.
      setRepos(Array.isArray(listed.repos) ? listed.repos : [])
      setRepoCwd(typeof listed.cwd === 'string' && listed.cwd !== '' ? listed.cwd : null)
      setRepoWorkspace(listed.codeWorkspace)
      setRepoListReady(true)
    })()
    return () => { alive = false }
    // The scan answers "which repositories does this cwd offer". Neither the pick
    // nor the sample's root can change that answer, and re-running on either
    // walks the tree again for a result that has already arrived. Visibility
    // stays in the list: coming back to the page is when a repository created
    // while the panel was hidden can be found. The probe switch changes the
    // answer itself, so it stays in the list. `repoListEpoch` is the explicit
    // refetch after the workspace setting changed.
  }, [remote, sessionId, queryVisible, detectCheckouts, repoListEpoch])

  // A remembered pick that disappeared from the scan (the directory is gone, or
  // it stopped being a repository) falls back to the default one. Waiting for a
  // finished scan is what keeps a fresh mount from retiring the pick the user
  // made in an earlier session before the answer is even in.
  useEffect(() => {
    if (!repoListReady || repo === '' || repos.some((entry) => entry.path === repo)) return
    dropRepo()
    // dropRepo only calls setters and the module-level selection store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoListReady, repos, repo])

  // The browser's own pin gets the same repair: a pinned checkout that left the
  // list (probe switched off, directory gone) or can no longer be chosen
  // returns the session to the config default — otherwise the address and its
  // dropdown would vanish with the root while the tree stayed on the old one.
  const pinnedRoot = sessionId === undefined ? undefined : pinnedFilesRoot(sessionId)
  useEffect(() => {
    if (!repoListReady || sessionId === undefined || pinnedRoot === undefined) return
    if (repos.some((entry) => entry.path === pinnedRoot && entry.disabled === undefined)) return
    clearFilesRootPin(sessionId)
    setFilesRootBump((n) => n + 1)
  }, [repoListReady, repos, pinnedRoot, sessionId])

  // A sample that rejects the pick is the other half of the same repair: the
  // selector stopped resolving (directory gone, no longer a work-tree top) or
  // nothing can verify it at all (git missing). Without this the panel would
  // keep the failure on screen with no way back.
  const repoRejected = view.state === 'error' && (view.error.code === 'invalid-repo' || view.error.code === 'git-unavailable')
  useEffect(() => {
    if (!hasSession(sessionId) || repo === '' || !repoRejected) return
    // The published view can still belong to the previous pick while a switch is
    // in flight; only the sample of the selected repository may reject it.
    if (controllerFor(sessionId).getRepo() !== repo) return
    dropRepo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoRejected, repo, sessionId])

  const onAction = async (action: GitAction): Promise<{ ok: boolean; error?: string }> => {
    if (!hasSession(sessionId)) return { ok: false, error: t('error.noCwd') }
    // The selection can move while the write is in flight; the reply carries a
    // snapshot of the work tree it started in. Handing that to a controller
    // that already switched repositories would both paint the old tree and
    // bump the generation, discarding the refresh the switch had started.
    const startedRepo = repo
    const result = await repoRemote.run({ sessionId, action })
    if (result.ok) {
      const controller = controllerFor(sessionId)
      if (controller.getRepo() !== startedRepo) {
        void controller.refresh()
        return { ok: true }
      }
      // The run already returned a fresh snapshot; feed it to the controller
      // instead of triggering another git round-trip.
      controller.accept(result.snapshot)
      if (action.kind === 'branch-checkout') setWorktreeGen((n) => n + 1)
      return { ok: true }
    }
    // A failed write may still have changed the work tree (e.g. a stash pop that
    // hit a conflict applies the diff but keeps the stash); resync so the panel
    // reflects the real state rather than the pre-action snapshot.
    if (action.kind === 'branch-checkout' && action.stashMessage !== undefined) setWorktreeGen((n) => n + 1)
    // Only this checkout can have changed: keep the other checkouts' remembered
    // samples replayable (that is what makes switching back instant).
    controllerFor(sessionId).refreshRepo()
    return { ok: false, error: opErrorText(result.error.code, result.error.message, t) }
  }

  const adjustFont = (delta: FontDelta): void => {
    if (delta === fontDelta) return
    const gen = ++fontWriteGen.current
    setFontPending(delta)
    void writePanelConfigField(ctx, 'fontDelta', delta).then((ok) => {
      // Ignore a write that lost the race to a newer click. A failed write
      // drops the optimistic step; a successful one keeps it until the
      // resynced snapshot catches up (effect below).
      if (fontWriteGen.current !== gen) return
      if (!ok) setFontPending(null)
    })
  }

  // Font step lives in the host config and rides every snapshot; a pending
  // write shows optimistically until the resync lands.
  const snapFont = view.state === 'ready' ? coerceFontDelta(view.snapshot.fontDelta) : 0
  const fontDelta = fontPending ?? snapFont
  useEffect(() => {
    if (fontPending !== null && snapFont === fontPending) setFontPending(null)
  }, [snapFont, fontPending])

  // One-shot bootstrap: a pre-migration localStorage step is written into the
  // host config (only while the config still reads the default) and the key is
  // dropped so a later reset is not resurrected from storage.
  const fontMigrated = useRef(false)
  useEffect(() => {
    if (fontMigrated.current || view.state !== 'ready' || snapFont !== 0) return
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(LEGACY_FONT_KEY)
    if (raw === null) return
    const legacy = coerceFontDelta(Number(raw))
    localStorage.removeItem(LEGACY_FONT_KEY)
    if (legacy === 0) return
    fontMigrated.current = true
    void writePanelConfigField(ctx, 'fontDelta', legacy)
  }, [ctx, view, snapFont])

  // Wide keeps the long labels; compact (phone / squeezed) and a minimum-width
  // stacked sidebar show the short pair so the three cells still read as words
  // next to the trailing controls.
  const tabLabelKeys: Record<SubTab, { full: GitKey; short: GitKey }> = {
    overview: { full: 'tab.overview', short: 'tab.overviewShort' },
    changes: { full: 'tab.changes', short: 'tab.changesShort' },
    files: { full: 'tab.files', short: 'tab.filesShort' },
  }
  const tabIcons: Record<SubTab, JSX.Element> = {
    overview: h(CommitIcon, { size: 14 }),
    changes: h(DiffIcon, { size: 14 }),
    files: h(FilesIcon, { size: 14 }),
  }
  const repoList = repoChoices(repos)
  // The browser's displayed root follows its own selector, not the sample: the
  // project root (the cwd's own checkout when it has one, else the scan's cwd),
  // a picked checkout's listed root, the snapshot's realpath for the followed
  // one. A sample of the same selector is authoritative — it answers even
  // before the list does (or when the host cannot answer it at all); the rest
  // resolves from the list, the error's cwd, or stays hidden.
  const projectRoot = repoList.find((c) => c.path === '')?.root ?? repoCwd ?? browsePath ?? null
  // Mid-switch the sample on screen is still the previous checkout's, so the
  // root comes off the list until the new one lands.
  const filesRoot = filesSelector === repo && view.state === 'ready' && !repoSwitching
    ? view.snapshot.root
    : filesSelector === ''
      ? projectRoot ?? (repo === '' && view.state === 'ready' ? view.snapshot.root : null)
      : repoList.find((c) => c.path === filesSelector)?.root ?? null

  // ── context menus ─────────────────────────────────────────────────────
  // Rows publish their menu through the panel's facade (use-panel-menu.ts):
  // the captured target carries this instance's id, so an action runs against
  // the copy that raised the gesture, and the browse root is read when the
  // gesture happens rather than when the row rendered.
  const filesRootRef = useRef<string | null>(null)
  filesRootRef.current = filesRoot
  // A Git group needs a checkout behind the browser's root. The snapshot is the
  // answer when the browser follows the panel's repository; otherwise the root
  // is a directory inside a checkout, which the file tree itself proves (its
  // entries carry ignore marks) but the snapshot does not. Until the panel can
  // tell, offering compare/history on paths git may not track would be a guess,
  // so the group waits for the same-root case.
  const viewRootIsGit = useRef(false)
  viewRootIsGit.current = !filesOnly && filesSelector === repo && view.state === 'ready'
  const capabilitiesRef = useRef<{ revDiff: boolean; pathHistory: boolean }>({ revDiff: false, pathHistory: false })
  if (view.state === 'ready') {
    capabilitiesRef.current = {
      revDiff: view.snapshot.capabilities?.revDiff === true,
      pathHistory: view.snapshot.capabilities?.pathHistory === true,
    }
  }
  const browseRootOf = useCallback((): string | null => filesRootRef.current, [])
  // Quote to the composer; a composer that is not there falls back to the
  // clipboard so the gesture never drops the text on the floor.
  const quoteRun = useCallback((text: string): void => {
    if (!hasSession(sessionId)) return
    if (insertSessionQuote(ctx, sessionId, text)) return
    // The composer is gone (unmounted, another session took it, an old host):
    // keep the text and say where it went instead of failing silently. The
    // primitives' clipboard face covers the non-secure-origin case that a bare
    // `navigator.clipboard` does not.
    const menus = contextMenusOf(ctx)
    void writeClipboard(text).then((ok) => {
      menus?.notify(ok ? t('menu.quoteFailed') : t('menu.copyFailed'), false)
    })
  }, [ctx, sessionId, t])
  const menuSources = useCallback(
    (): readonly MenuSource[] => (hasSession(sessionId) ? [controllerFor(sessionId)] : []),
    [sessionId],
  )
  // The comparison flows and the file-history filter are menu outcomes: the
  // request lives here so the picker reuses this panel's remote (and therefore
  // its repository tag), while compare-host.tsx owns the picker and overlay.
  const [compare, setCompare] = useState<CompareRequest | null>(null)
  // A one-shot request, not a filter: the sequence makes a repeat of the same
  // path a new request, and `repo` scopes it to the checkout it was raised on.
  const [historyRequest, setHistoryRequest] = useState<{ path: string; seq: number; repo: string; sessionId: string } | null>(null)
  const historySeq = useRef(0)
  const openCompare = useCallback((mode: CompareRequest['mode'], value: TreeTargetValue): void => {
    if (!hasSession(sessionId)) return
    setCompare({ mode, path: value.path, repo, sessionId })
  }, [repo, sessionId])
  // A request names one path in one checkout of one session: a panel that has
  // since moved must not consume it.
  const historyRequestApplies = (request: { sessionId: string; repo: string }, liveSession: string | undefined, liveRepo: string): boolean =>
    request.sessionId === liveSession && request.repo === liveRepo
  const showHistory = useCallback((value: TreeTargetValue): void => {
    // The history filter replaces the page, so the overview must be the visible
    // sub-tab before the chip can mean anything.
    historySeq.current += 1
    if (!hasSession(sessionId)) return
    setHistoryRequest({ path: value.path, seq: historySeq.current, repo, sessionId })
    if (hasSession(sessionId)) setSelection({ sessionId, tab: 'overview' })
  }, [sessionId, repo])
  // A comparison names a path inside one checkout. Switching repository (or
  // session) under an open picker must close it: the picker would otherwise
  // re-query the new checkout with the old path and show a diff that belongs to
  // neither.
  useEffect(() => { setCompare(null); setHistoryRequest(null) }, [sessionId, repo])
  const isGitRoot = useCallback((): boolean => filesRootRef.current !== null && viewRootIsGit.current, [])
  const capabilities = useCallback((): { revDiff: boolean; pathHistory: boolean } => capabilitiesRef.current, [])
  // The overview's own runs and busy flag are published by the tab into this
  // ref each render (it owns the switch map, the filter and the dialogs); the
  // menu owner reads them at resolve time.
  const overviewCommandsRef = useRef<OverviewMenuCommands | null>(null)
  const overviewStateRef = useRef<OverviewMenuFacts>({ busy: false })
  const overviewCommands = useCallback((): OverviewMenuCommands => overviewCommandsRef.current ?? EMPTY_OVERVIEW_COMMANDS, [])
  const overviewFacts = useCallback((): OverviewMenuFacts => overviewStateRef.current, [])
  // The changes tab publishes its runs, busy flag and checked set the same way.
  const changesCommandsRef = useRef<ChangesMenuCommands | null>(null)
  const changesStateRef = useRef<ChangesMenuFacts>({ busy: false })
  const changesPickRef = useRef<ReadonlySet<string>>(new Set())
  const changesCommands = useCallback((): ChangesMenuCommands => changesCommandsRef.current ?? EMPTY_CHANGES_COMMANDS, [])
  const changesFacts = useCallback((): ChangesMenuFacts => changesStateRef.current, [])
  const changesPick = useCallback((): ReadonlySet<string> => changesPickRef.current, [])
  // The repository rows' remote check. A row is usually not the checkout the
  // panes act on, so the fetch reports through the menu toast rather than a
  // status bar; the sampled checkout answers whether it has a remote at all,
  // and a row nobody sampled has to answer for itself (a failed fetch says so).
  const fetchClaimsRef = useRef<Set<string>>(new Set())
  const runRepoFetch = useCallback((live: string, repoTag: string): void => {
    runRemoteFetch(ctx, t, live, repoTag, fetchClaimsRef.current)
  }, [ctx, t])
  // Read through primitives so the menu owner is not re-registered on every
  // poll: the sample object changes identity each snapshot, its two facts do not.
  const sampleReady = view.state === 'ready'
  const sampleHasRemote = sampleReady && view.snapshot.remote !== null
  const reposFacts = useCallback((repoTag: string): ReposMenuFacts => {
    if (!hasSession(sessionId) || !sampleReady) return { canFetch: false }
    // The sampled checkout is the only one whose remote is known; a worktree
    // shares it, and a scanned foreign repository answers when asked.
    return { canFetch: repoTag === repo ? sampleHasRemote : true }
  }, [sessionId, repo, sampleReady, sampleHasRemote])
  const reposCommandsRef = useRef<ReposMenuCommands>({ fetch: () => {} })
  reposCommandsRef.current = { fetch: (repoTag: string): void => { if (hasSession(sessionId)) runRepoFetch(sessionId, repoTag) } }
  const reposCommands = useCallback((): ReposMenuCommands => reposCommandsRef.current, [])

  const panelMenu = usePanelMenu({
    ctx, t, sessionId, repo, browseRoot: browseRootOf, useContextMenu, observe: menuSources,
    isGit: isGitRoot, capabilities,
    overviewCommands,
    overviewFacts,
    changesCommands,
    changesFacts,
    changesPick,
    reposCommands,
    reposFacts,
    onCompareRevision: useCallback((value: TreeTargetValue) => openCompare('revision', value), [openCompare]),
    onCompareRef: useCallback((value: TreeTargetValue) => openCompare('ref', value), [openCompare]),
    onShowHistory: showHistory,
    onQuote: quoteRun,
  })
  // The browse-root dropdown exists whenever the list offers a second root,
  // follow config on or off: the config sets the session default, but the
  // dropdown is where a session opts the other way (park at a root while the
  // default follows, follow while the default parks). With one candidate the
  // address keeps its plain click-to-copy behaviour.
  const rootPick = sessionId === undefined ? null : filesRootPick(sessionId, filesFollow)
  const rootRows = projectRoot === null || !repoListReady
    ? []
    : filesRootRows(projectRoot, repoList, rootPick)
  const rootMenu = rootRows.length > 1
    ? { rows: rootRows, followActive: rootPick === null }
    : null
  // Every layout hosts the repository list where the branch tree lives (and,
  // outside compact, at the top of the changes column), so the bar never needs
  // a tab for it.
  const tabOrder: SubTab[] = ['overview', 'changes', 'files']
  const allTabs: Array<{ key: SubTab; label: string; icon: JSX.Element }> = tabOrder.map((key) => ({
    key,
    label: t(shortLabels ? tabLabelKeys[key].short : tabLabelKeys[key].full),
    icon: tabIcons[key],
  }))
  // A non-git directory exposes the browser alone: without a checkout behind
  // it the overview has no content to render.
  const tabs = filesOnly ? allTabs.filter((tb) => tb.key === 'files') : allTabs
  // The switcher is the platform SegmentedTabs primitive: it owns the tablist
  // role, the sliding indicator and the keyboard walk; we own the panes and
  // wire them up with instance-scoped ids (a panel can be mounted per session).
  const tabsId = useId()
  const tabItems: Array<SegmentedTab> = tabs.map((tb) => ({
    value: tb.key,
    label: [
      h('span', { key: 'i', className: 'gp-tab__icon' }, tb.icon),
      // data-label feeds the hidden bold copy that reserves the selected width
      // (css/base.ts), so the track does not resize as the selection moves.
      h('span', { key: 'l', className: 'gp-tab__label', 'data-label': tb.label }, tb.label),
    ],
    id: `${tabsId}-${tb.key}`,
    panelId: `${tabsId}-${tb.key}-panel`,
  }))
  // SegmentedTabs requires the value to belong to items; before a snapshot lands
  // (cold/loading/no-cwd) there is no active pane, so show the first tab. The
  // tab set can also shrink under the selection (a cwd turning files-only),
  // and a value that belongs to no item would leave every pane hidden.
  const tabKeys = tabs.map((tb) => tb.key)
  const selectedTab: SubTab = activeTab !== null && tabKeys.includes(activeTab)
    ? activeTab
    : tabs[0]?.key ?? 'overview'
  // Keep the stored selection on a tab that exists.
  const tabKeyList = tabKeys.join(' ')
  useEffect(() => {
    if (!hasSession(sessionId) || selection?.sessionId !== sessionId) return
    // A pick may target a page the current sample cannot offer yet (a cwd
    // without a checkout picking one of its nested repositories). Clamping now
    // would undo the pick before the new sample says the page exists.
    if (repoSwitching) return
    const keys = tabKeyList === '' ? [] : tabKeyList.split(' ')
    if (keys.includes(selection.tab)) return
    const fallback = keys[0]
    if (fallback !== undefined) setSelection({ sessionId, tab: fallback as SubTab })
  }, [sessionId, tabKeyList, selection?.sessionId, selection?.tab, repoSwitching])

  // Every tab in `tabs` always gets its own role=tabpanel node — in the ready
  // view and in the loading / no-cwd / error / files-only states alike — so a
  // tab's aria-controls never dangles. While the body is a placeholder it lives
  // in the selected pane; pane *content* still mounts on first visit.
  const placeholder: JSX.Element | null = ((): JSX.Element | null => {
    if (!hasSession(sessionId) || view.state === 'no-cwd') return h('div', { className: 'gp-empty' }, t('error.noCwd'))
    if (filesOnly) return null
    // The copy names which repair applies: an unresolvable pick is the picker's
    // own stale state, a lost connection is not a missing git either.
    if (view.state === 'error') {
      const label = view.error.code === 'invalid-repo'
        ? t('error.invalidRepo')
        : view.error.code === 'transport' ? t('error.transport') : t('pill.unavailable')
      return h('div', { className: 'gp-empty' }, label)
    }
    if (view.state === 'cold' || view.state === 'loading' || activeTab === null) return h('div', { className: 'gp-empty' }, t('common.loading'))
    return null
  })()

  // A cwd that is not a checkout opens straight into its first sub-repository
  // when this session has never picked anything: the root itself has no git
  // view behind it. Only `not-a-git-repo` counts (git being missing would
  // reject every pick); one attempt per session keeps a pick the host then
  // rejects from ping-ponging.
  const autoPickedSession = useRef<string | null>(null)
  useEffect(() => {
    if (!hasSession(sessionId) || !repoListReady || !filesOnly) return
    if (view.state !== 'error' || view.error.code !== 'not-a-git-repo') return
    if (repo !== '' || hasRepoPick(sessionId)) return
    if (autoPickedSession.current === sessionId) return
    const target = repoList.find((choice) => choice.path !== '' && choice.disabled === undefined)
    if (target === undefined) return
    autoPickedSession.current = sessionId
    chooseRepo(target.path)
    // chooseRepo only reads state this effect already guards on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, repoListReady, filesOnly, view, repo, repoList])

  // One shared list block: the overview's branch surface and the changes
  // column both dock it, so collapse state and the choice wiring stay in sync
  // across the panes. Compact docks it in the overview's branch filter only:
  // the single-column changes page keeps its height for the change list.
  // A pick moves the file browser too when it follows the Git selection; an
  // unsaved edit there is confirmed away first (the browser's own root menu
  // asks the same question in the files tab).
  const chooseRepoGuarded = (next: string): void => {
    if (hasSession(sessionId) && next !== repo && filesRootPick(sessionId, filesFollow) === null && hasUnsavedEdit(sessionId)) {
      setPendingLeave(() => () => chooseRepo(next))
      return
    }
    chooseRepo(next)
  }
  const leaveEditModal = pendingLeave === null || !hasSession(sessionId)
    ? null
    : renderConfirmModal({
      title: t('files.editDiscardTitle'),
      body: t('files.editDiscardBody'),
      confirmLabel: t('files.editDiscard'),
      danger: true,
      error: null,
      onClose: () => setPendingLeave(null),
      onConfirm: () => {
        const proceed = pendingLeave
        setPendingLeave(null)
        discardUnsavedEdit(sessionId)
        proceed()
      },
      t,
    })

  // A row's menu: reveal and copy the checkout's absolute root (the platform's
  // directory family, resolved per row) plus the remote check. The row names its
  // own checkout — the menu must not follow the panel's later switch.
  const repoRowMenu = panelMenu === undefined
    ? undefined
    : (choice: RepoChoice): Record<string, unknown> =>
      panelMenu.bind(MENU_KIND.repos, { repo: choice.path, root: choice.root })
  // Turning the workspace file on from the list itself. The write is
  // plugin-wide (the row says so), so every session gains the setting; the host
  // rebuilds its service around the new config, and the list is read again
  // after that hand-over. Two reads: the first for the common case, the second
  // for a slow rebuild. Both are cancelled with the panel — a refetch that
  // lands after the session switched would ask with the new session's cwd about
  // the old one's setting.
  const workspaceTimers = useRef<readonly ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => {
    for (const timer of workspaceTimers.current) clearTimeout(timer)
    workspaceTimers.current = []
  }, [sessionId])
  const enableWorkspace = (): void => {
    if (repoWorkspaceEnabling) return
    setRepoWorkspaceFailed(false)
    setRepoWorkspaceEnabling(true)
    void writePanelConfigField(ctx, 'codeWorkspace', 'auto').then((ok) => {
      setRepoWorkspaceEnabling(false)
      if (!ok) {
        setRepoWorkspaceFailed(true)
        return
      }
      workspaceTimers.current = [400, 1500].map((delay) =>
        setTimeout(() => { setRepoListEpoch((n) => n + 1) }, delay))
    })
  }
  const repositories = hasSession(sessionId)
    ? {
      choices: repoList,
      current: repo,
      onChoose: chooseRepoGuarded,
      collapsed: reposCollapsed,
      onToggleCollapse: () => setReposCollapsed((v) => !v),
      rowMenu: repoRowMenu,
      workspaceHint: repoWorkspace,
      onEnableWorkspace: hasConfigForms(ctx) ? enableWorkspace : undefined,
      workspaceEnabling: repoWorkspaceEnabling,
      workspaceFailed: repoWorkspaceFailed,
    }
    : undefined

  // The overview hosts the list above the branch tree, so a pick never hides
  // the branches or the commit list.
  const overviewPane = (): JSX.Element | null => {
    const live = hasSession(sessionId) ? sessionId : undefined
    const snapshot = live !== undefined && view.state === 'ready' ? view.snapshot : null
    const mounted = snapshot !== null && visited.current.tabs.has('overview')
    const overview = mounted && snapshot !== null && live !== undefined
      ? h(OverviewTab, {
      key: live,
      remote: repoRemote,
      sessionId: live,
      // Only the pane's own page keeps it live: a hidden pane must start no
      // queries.
      visible: queryVisible && selectedTab === 'overview',
      defaultDiffView: snapshot.defaultDiffView,
      snapshot,
      onAction,
      onResync: () => controllerFor(live).resync(),
      compact,
      stacked,
      tight: stackedTight,
      phone: layout.phone ?? false,
      repositories,
      // Only the checkout the request was raised on may consume it: a
      // repository switch drops the request instead of filtering the new tree by
      // a path from the old one.
      exactPath: historyRequest !== null && historyRequestApplies(historyRequest, sessionId, repo) ? historyRequest.path : undefined,
      exactPathSeq: historyRequest !== null && historyRequestApplies(historyRequest, sessionId, repo) ? historyRequest.seq : undefined,
      onClearExactPath: () => setHistoryRequest(null),
      panelMenu,
      menuCommandsRef: overviewCommandsRef,
      menuFactsRef: overviewStateRef,
      onQuote: quoteRun,
      t,
      })
      : undefined
    return overview ?? placeholder
  }

  const paneOwner = (key: SubTab): boolean => key === selectedTab

  const paneContent = (key: SubTab): JSX.Element | null => {
    if (key === 'overview') return overviewPane()
    // The state placeholder (loading / no-cwd / error, including no-session)
    // lives in the selected pane; the guard below only narrows sessionId for the
    // tab components.
    if (placeholder !== null) return paneOwner(key) ? placeholder : null
    if (!hasSession(sessionId)) return null
    // A non-git directory still browses files (host resolves the cwd as root).
    if (filesOnly) {
      return filesVisited
        ? h(FilesTab, { key: sessionId, remote: filesRemote, editBaseRemote: remote, sessionId, compact, stacked, worktreeGen, snapshot: null, browseRoot: filesRoot, rootKey: filesSelector, allowEdit: allowFileEdit, compactPackages, rootMenu, onPickRoot: applyFilesRootPick, t })
        : null
    }
    if (view.state !== 'ready') return null
    const snapshot = view.snapshot
    if (key === 'changes') {
      return visited.current.tabs.has('changes')
        ? h(ChangesTab, { key: sessionId, remote: repoRemote, sessionId, visible: queryVisible && activeTab === 'changes', snapshot, onAction, onRefresh: () => controllerFor(sessionId).refresh(), onSetFullChanges: (full) => controllerFor(sessionId).setFullChanges(full), onSetChangesView: (view) => writePanelConfigField(ctx, 'changesView', view), compact, stacked, cramped, repositories: compact ? undefined : repositories, panelMenu, menuCommandsRef: changesCommandsRef, menuFactsRef: changesStateRef, menuPickRef: changesPickRef, t })
        : null
    }
    // Files tab mounts on first visit (keeps cold cost zero — no dir-list
    // until the user opens it), then stays mounted to retain its tree state.
    // The sample describes the browser's files only when both sides sit on the
    // same checkout and it is not the previous one's mid-switch.
    const filesSnapshot = filesSelector === repo && !repoSwitching ? snapshot : null
    return filesVisited ? h(FilesTab, { key: sessionId, remote: filesRemote, editBaseRemote: remote, sessionId, compact, stacked, worktreeGen, snapshot: filesSnapshot, browseRoot: filesRoot, rootKey: filesSelector, allowEdit: allowFileEdit, compactPackages, rootMenu, onPickRoot: applyFilesRootPick, t }) : null
  }

  // One panel per tab, so every tab's aria-controls resolves.
  const paneKeys: SubTab[] = tabKeys
  const panes = paneKeys.map((key) => h('div', {
    key, id: `${tabsId}-${key}-panel`, role: 'tabpanel',
    'aria-labelledby': `${tabsId}-${key}`,
    style: paneOwner(key) ? { display: 'contents' } : { display: 'none' },
  }, paneContent(key)))

  // A lost connection keeps the last sample on screen: say so above it rather
  // than letting the numbers read as current.
  const staleNotice = view.state === 'ready' && view.stale === true && !staleNoticeClosed
    ? h(NoticeBar, { key: 'stale', text: t('error.transport'), closeLabel: t('common.close'), onClose: () => setStaleNoticeClosed(true) })
    : null
  // git-not-installed inside a repo: stack a notice above the browser.
  // A cwd with no checkout of its own hides every Git pane, so the switcher's
  // workspace offer has nowhere to land: the browser carries it instead. This is
  // the hub layout the feature exists for — the offer has to be reachable before
  // anything is enabled, and a file that cannot be used has to explain the empty
  // list after (ADR-0035).
  const workspaceNotice = ((): JSX.Element | null => {
    if (!filesOnly) return null
    if (repoWorkspaceFailed) {
      return h('div', { key: 'wsnotice', className: 'gp-notice gp-notice--warn' }, [
        h('span', { key: 'tx', className: 'gp-notice__text' }, t('repos.workspaceEnableFailed')),
      ])
    }
    if (repoWorkspace === undefined) return null
    // `applied` is normally silent — the rows are the evidence — but a file that
    // yielded no root at all leaves nothing to see, and a bare file browser
    // reads as "this feature does nothing". The host reports how many roots the
    // file produced; an older host sends no count, and claiming the empty state
    // there would be a guess.
    if (repoWorkspace.state === 'applied') {
      if (repoWorkspace.roots !== 0) return null
      return h('div', { key: 'wsnotice', className: 'gp-notice gp-notice--warn' }, [
        h('span', { key: 'tx', className: 'gp-notice__text' }, t('repos.workspaceEmpty')),
      ])
    }
    const name = repoWorkspace.file === undefined ? '' : baseName(repoWorkspace.file)
    const count = repoWorkspace.count ?? (repoWorkspace.file === undefined ? 0 : 1)
    // An unknown state is silence, not a guess: a future state must not be
    // rendered as `ambiguous`, which would state a reason the host never gave.
    let text: string
    let canEnable = false
    if (repoWorkspace.state === 'available') {
      text = count > 1 ? t('repos.workspaceMany', { n: count }) : t('repos.workspaceAvailable', { file: name })
      canEnable = count === 1 && hasConfigForms(ctx)
    } else if (repoWorkspace.state === 'missing') {
      text = t('repos.workspaceMissing', { file: name })
    } else if (repoWorkspace.state === 'invalid') {
      text = t('repos.workspaceInvalid')
    } else if (repoWorkspace.state === 'ambiguous') {
      text = t('repos.workspaceAmbiguous')
    } else {
      return null
    }
    return h('div', { key: 'wsnotice', className: `gp-notice${repoWorkspace.state === 'available' ? '' : ' gp-notice--warn'}` }, [
      h('span', { key: 'tx', className: 'gp-notice__text' }, text),
      canEnable
        ? h('button', {
          key: 'go', type: 'button', className: 'gp-notice__act',
          disabled: repoWorkspaceEnabling,
          onClick: enableWorkspace,
        }, repoWorkspaceEnabling ? t('repos.workspaceEnabling') : t('repos.workspaceEnable'))
        : null,
    ])
  })()
  // The notices stack above the panes in one wrapper, and the wrapper only
  // exists when something has to be said: an extra element around a
  // `display: contents` pane would change the flex chain the panes rely on.
  const notices = [
    workspaceNotice,
    gitMissingInRepo && !gitNoticeClosed
      ? h(NoticeBar, { key: 'notice', text: t('files.gitNotInstalled'), closeLabel: t('common.close'), onClose: () => setGitNoticeClosed(true) })
      : null,
    staleNotice,
  ].filter((node) => node !== null) as JSX.Element[]
  const body = notices.length === 0
    ? h('div', { style: { display: 'contents' } }, panes)
    : h('div', { className: 'gp-files-wrap' }, [...notices, ...panes])

  // `data-conversation-composer-overlay` opts the view into the shell's
  // full-height layout: the view area is fixed to the visible height with its
  // own overflow, and the composer/input bar floats over the bottom. Without
  // it the view grows with content and the whole conversation scrolls. The
  // sidebar has no composer under it, so it opts out.
  const overlay = host === 'conversation' ? { 'data-conversation-composer-overlay': '' } : {}
  return h('div', { className: 'gp-panel', ref: setRootEl, ...overlay, 'data-gp-host': host, 'data-font-delta': fontDelta, 'data-layout': mode, ...(repoSwitching ? { 'data-repo-switching': 'true' } : {}) }, [
    // data-tab-count reports how many cells the bar carries (three, or the
    // browser alone); no rule reads it — tests and diagnostics do.
    // browser alone for a cwd without a checkout).
    leaveEditModal,
    h('div', { key: 'tabs', className: 'gp-tabbar', 'data-tab-count': tabs.length }, [
      h(SegmentedTabs, {
        key: 'switcher',
        // A lone tab (non-git directory → Files only) has nothing to switch
        // between, so it must not stretch across the compact bar.
        className: `gp-tabbar__tabs${tabs.length === 1 ? ' gp-tabbar__tabs--single' : ''}`,
        label: t('panel.tabs'),
        items: tabItems,
        value: selectedTab,
        // The primitive hands back a plain string; accept only one of our tabs.
        onChange: (next: string) => {
          const picked = tabs.find((tb) => tb.key === next)
          if (picked !== undefined && hasSession(sessionId)) setSelection({ sessionId, tab: picked.key })
        },
      }),
      // Trailing cluster (font stepper + version bar). `display:contents` in the
      // wide layout keeps it transparent to the tab-bar flex (identical to the
      // flat layout). Compact drops both: the font step lives on the plugin
      // config page, and the version cluster would cost a second tab-bar row.
      // The stepper also requires the settings form (configForms) to write
      // back; without it the control would silently no-op.
      h('div', { key: 'trailing', className: 'gp-tabbar__trailing' }, [
        // The body keeps the previous sample while a switch is in flight; this
        // badge is what tells the dimmed panes apart from a stuck panel.
        repoSwitching
          ? h('span', { key: 'switching', className: 'gp-tabbar__switching', role: 'status' }, [
            h(StateDot, { key: 'dot', state: 'ongoing', size: 12 }),
            h('span', { key: 'label', className: 'gp-tabbar__switching-label' }, t('repo.switching')),
          ])
          : null,
        compact || stackedTight || !fontWritable
          ? null
          : h('div', { key: 'font', className: 'gp-font', role: 'group', 'aria-label': t('panel.fontSize') }, [
            h('button', { key: 'dec', type: 'button', className: 'gp-font__decrease', 'aria-pressed': fontDelta === -1, onClick: () => adjustFont(-1), 'aria-label': t('panel.fontDecrease') }, 'A−'),
            h('button', { key: 'reset', type: 'button', className: 'gp-font__reset', 'aria-pressed': fontDelta === 0, onClick: () => adjustFont(0), 'aria-label': t('panel.fontReset') }, 'A'),
            h('button', { key: 'inc', type: 'button', className: 'gp-font__increase', 'aria-pressed': fontDelta === 1, onClick: () => adjustFont(1), 'aria-label': t('panel.fontIncrease') }, 'A+'),
          ]),
        // The version cluster needs the wide bar's horizontal room, so every
        // narrow mode drops it. Compact has no spare row at all; stacked spends
        // its row on the tabs plus the font stepper, and an icon-only pill there
        // reads as "refresh this panel" rather than "check for a new version".
        // The check therefore stays a wide-layout control.
        compact || stacked ? null : h(VersionBar, { key: 'ver', remote, t }),
      ]),
    ]),
    // Inert while a switch is in flight: the panes still show the previous
    // checkout, but every request is tagged with the next one, so a stage or a
    // discard clicked on the old list would land on the new work tree.
    compare !== null && sessionId !== undefined && compareApplies(compare, sessionId, repo)
      ? h(CompareHost, {
        // Re-keyed on the checkout so a switch tears the flow down even when the
        // effect above has not run yet. The gate is the render-time half: the
        // child's effects run before this panel's cleanup, so a request that no
        // longer names the current checkout must never reach the tree at all.
        key: `compare:${sessionId}:${repo}`, remote: repoRemote, sessionId, request: compare,
        compact, defaultDiffView: view.state === 'ready' ? view.snapshot.defaultDiffView : 'unified',
        onClose: () => setCompare(null), t,
      })
      : null,
    h('div', { key: 'body', className: 'gp-body', ...inertAttr(repoSwitching), ...(repoSwitching ? { 'aria-busy': 'true' } : {}) },
      h(PanelMenuContext.Provider, { value: panelMenu }, body)),
  ])
}
