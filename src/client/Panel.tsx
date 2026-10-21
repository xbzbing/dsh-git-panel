/**
 * Main Git panel shell: Overview / Changes / Files over the conversation.view
 * slot. Snapshot state chooses the initial tab unless the input-bar pill
 * supplied a one-shot focus request.
 */
import { createElement as h, useEffect, useId, useRef, useState } from 'react'
import type { JSX } from 'react'
import { SegmentedTabs, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import { gitPanelRemoteOf, hasSession, type ClientCtx, type GitPanelRemote } from './rpc.js'
import { useGitView, controllerFor } from './registry.js'
import { takeSubTab, subscribeSubTab, stashSubTab, recentSubTab, type SubTab } from './jump.js'
import { OverviewTab } from './OverviewTab.js'
import { ChangesTab } from './ChangesTab.js'
import { FilesTab } from './FilesTab.js'
import { CommitIcon, DiffIcon, FilesIcon, RefreshIcon, StarIcon } from './icons.js'
import { usePanelLayout } from './layout.js'
import { isCramped, panelMode, STACKED_TIGHT_BP } from './panel-fit.js'
import { useHoverTip } from './tip.js'
import { hasConfigForms, writePanelConfigField } from './config-write.js'
import type { FontDelta, GitAction, GitVersionInfo } from './types.js'
import type { GitKey } from './locales.js'
import { opErrorText } from './ops-modals.js'
import { NoticeBar } from './notice.js'
import { usePageVisibility } from './use-page-visibility.js'

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
}

export function Panel({ ctx, sessionId, t, host = 'conversation', visible }: PanelProps): JSX.Element {
  const pageVisible = usePageVisibility()
  const [fontPending, setFontPending] = useState<FontDelta | null>(null)
  // Monotonic token for the latest font write: a slow host set for an older
  // click must not clear (or race) a newer pending step.
  const fontWriteGen = useRef(0)
  const [selection, setSelection] = useState<{ sessionId: string; tab: SubTab } | null>(null)
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
  const gitMissingInRepo = gitUnavailable && view.state === 'error' && view.error.isGitRepo === true
  // Wait for the snapshot before mounting any git-backed pane. An explicit pill
  // jump takes priority; switching sessions resets the one-shot default.
  const activeTab = filesOnly ? 'files' : selection !== null && selection.sessionId === sessionId ? selection.tab : null
  const visited = useRef<{ sessionId?: string; tabs: Set<SubTab> }>({ tabs: new Set() })
  if (visited.current.sessionId !== sessionId) visited.current = { sessionId, tabs: new Set() }
  if (activeTab !== null) visited.current.tabs.add(activeTab)
  const filesVisited = visited.current.tabs.has('files')

  useEffect(() => {
    if (!hasSession(sessionId)) return
    if (filesOnly) { setSelection(null); return }
    if (selection?.sessionId === sessionId) return
    const pending = takeSubTab(sessionId)
    if (pending !== null) { setSelection({ sessionId, tab: pending }); return }
    // A quick return (within the sticky window) restores the last sub-tab
    // instead of recomputing the default entry; an explicit pill jump above
    // still wins.
    const recent = recentSubTab(sessionId)
    if (recent !== null) { setSelection({ sessionId, tab: recent }); return }
    if (view.state === 'ready') setSelection({ sessionId, tab: view.snapshot.dirty ? 'changes' : 'overview' })
  }, [sessionId, view, filesOnly, selection?.sessionId])

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

  const onAction = async (action: GitAction): Promise<{ ok: boolean; error?: string }> => {
    if (!hasSession(sessionId)) return { ok: false, error: t('error.noCwd') }
    const result = await remote.run({ sessionId, action })
    if (result.ok) {
      // The run already returned a fresh snapshot; feed it to the controller
      // instead of triggering another git round-trip.
      controllerFor(sessionId).accept(result.snapshot)
      if (action.kind === 'branch-checkout') setWorktreeGen((n) => n + 1)
      return { ok: true }
    }
    // A failed write may still have changed the work tree (e.g. a stash pop that
    // hit a conflict applies the diff but keeps the stash); resync so the panel
    // reflects the real state rather than the pre-action snapshot.
    if (action.kind === 'branch-checkout' && action.stashMessage !== undefined) setWorktreeGen((n) => n + 1)
    controllerFor(sessionId).resync()
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
  const allTabs: Array<{ key: SubTab; label: string; icon: JSX.Element }> = [
    { key: 'overview', label: t(shortLabels ? tabLabelKeys.overview.short : tabLabelKeys.overview.full), icon: h(CommitIcon, { size: 14 }) },
    { key: 'changes', label: t(shortLabels ? tabLabelKeys.changes.short : tabLabelKeys.changes.full), icon: h(DiffIcon, { size: 14 }) },
    { key: 'files', label: t(shortLabels ? tabLabelKeys.files.short : tabLabelKeys.files.full), icon: h(FilesIcon, { size: 14 }) },
  ]
  // A non-git directory exposes only the Files tab.
  const tabs = filesOnly ? allTabs.filter((tb) => tb.key === 'files') : allTabs
  // The switcher is the platform SegmentedTabs primitive: it owns the tablist
  // role, the sliding indicator and the keyboard walk; we own the panes and
  // wire them up with instance-scoped ids (a panel can be mounted per session).
  const tabsId = useId()
  const tabItems: Array<SegmentedTab> = tabs.map((tb) => ({
    value: tb.key,
    label: [
      h('span', { key: 'i', className: 'gp-tab__icon' }, tb.icon),
      h('span', { key: 'l', className: 'gp-tab__label' }, tb.label),
    ],
    id: `${tabsId}-${tb.key}`,
    panelId: `${tabsId}-${tb.key}-panel`,
  }))
  // SegmentedTabs requires the value to belong to items; before a snapshot lands
  // (cold/loading/no-cwd) there is no active pane, so show the first tab.
  const selectedTab: SubTab = activeTab ?? tabs[0]?.key ?? 'overview'

  // Every tab in `tabs` always gets its own role=tabpanel node — in the ready
  // view and in the loading / no-cwd / error / files-only states alike — so a
  // tab's aria-controls never dangles. While the body is a placeholder it lives
  // in the selected pane; pane *content* still mounts on first visit.
  const placeholder: JSX.Element | null = ((): JSX.Element | null => {
    if (!hasSession(sessionId) || view.state === 'no-cwd') return h('div', { className: 'gp-empty' }, t('error.noCwd'))
    if (filesOnly) return null
    if (view.state === 'error') return h('div', { className: 'gp-empty' }, t('pill.unavailable'))
    if (view.state === 'cold' || view.state === 'loading' || activeTab === null) return h('div', { className: 'gp-empty' }, t('common.loading'))
    return null
  })()

  const paneContent = (key: SubTab): JSX.Element | null => {
    // The state placeholder (loading / no-cwd / error, including no-session)
    // lives in the selected pane; the guard below only narrows sessionId for the
    // tab components.
    if (placeholder !== null) return key === selectedTab ? placeholder : null
    if (!hasSession(sessionId)) return null
    // A non-git directory still browses files (host resolves the cwd as root).
    if (filesOnly) {
      return filesVisited ? h(FilesTab, { key: sessionId, remote, sessionId, compact, stacked, worktreeGen, snapshot: null, t }) : null
    }
    if (view.state !== 'ready') return null
    const snapshot = view.snapshot
    if (key === 'overview') {
      return visited.current.tabs.has('overview')
        ? h(OverviewTab, { key: sessionId, remote, sessionId, visible: queryVisible && activeTab === 'overview', defaultDiffView: snapshot.defaultDiffView, snapshot, onAction, onResync: () => controllerFor(sessionId).resync(), compact, stacked, t })
        : null
    }
    if (key === 'changes') {
      return visited.current.tabs.has('changes')
        ? h(ChangesTab, { key: sessionId, remote, sessionId, visible: queryVisible && activeTab === 'changes', snapshot, onAction, onRefresh: () => controllerFor(sessionId).refresh(), onSetFullChanges: (full) => controllerFor(sessionId).setFullChanges(full), compact, stacked, cramped, t })
        : null
    }
    // Files tab mounts on first visit (keeps cold cost zero — no dir-list
    // until the user opens it), then stays mounted to retain its tree state.
    return filesVisited ? h(FilesTab, { key: sessionId, remote, sessionId, compact, stacked, worktreeGen, snapshot, t }) : null
  }

  const panes = tabs.map((tb) => h('div', {
    key: tb.key, id: `${tabsId}-${tb.key}-panel`, role: 'tabpanel', 'aria-labelledby': `${tabsId}-${tb.key}`,
    style: selectedTab === tb.key ? { display: 'contents' } : { display: 'none' },
  }, paneContent(tb.key)))

  // git-not-installed inside a repo: stack a notice above the browser.
  const body = gitMissingInRepo
    ? h('div', { className: 'gp-files-wrap' }, [
      gitNoticeClosed
        ? null
        : h(NoticeBar, { key: 'notice', text: t('files.gitNotInstalled'), closeLabel: t('common.close'), onClose: () => setGitNoticeClosed(true) }),
      ...panes,
    ])
    : h('div', { style: { display: 'contents' } }, panes)

  // `data-conversation-composer-overlay` opts the view into the shell's
  // full-height layout: the view area is fixed to the visible height with its
  // own overflow, and the composer/input bar floats over the bottom. Without
  // it the view grows with content and the whole conversation scrolls. The
  // sidebar has no composer under it, so it opts out.
  const overlay = host === 'conversation' ? { 'data-conversation-composer-overlay': '' } : {}
  return h('div', { className: 'gp-panel', ref: setRootEl, ...overlay, 'data-gp-host': host, 'data-font-delta': fontDelta, 'data-layout': mode }, [
    h('div', { key: 'tabs', className: 'gp-tabbar' }, [
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
        compact || stackedTight || !fontWritable
          ? null
          : h('div', { key: 'font', className: 'gp-font', role: 'group', 'aria-label': t('panel.fontSize') }, [
            h('button', { key: 'dec', type: 'button', className: 'gp-font__decrease', 'aria-pressed': fontDelta === -1, onClick: () => adjustFont(-1), 'aria-label': t('panel.fontDecrease') }, 'A−'),
            h('button', { key: 'reset', type: 'button', className: 'gp-font__reset', 'aria-pressed': fontDelta === 0, onClick: () => adjustFont(0), 'aria-label': t('panel.fontReset') }, 'A'),
            h('button', { key: 'inc', type: 'button', className: 'gp-font__increase', 'aria-pressed': fontDelta === 1, onClick: () => adjustFont(1), 'aria-label': t('panel.fontIncrease') }, 'A+'),
          ]),
        // The full cluster needs the wide bar's horizontal room. Stacked keeps
        // an icon-only form (the update check plus its release dot) so an
        // update notice still reaches a sidebar-mounted panel; the text row
        // would crowd the tabs. Compact — and stacked-tight, which already
        // drops to the phone's tab treatment — drops it entirely.
        compact || stackedTight ? null : h(VersionBar, { key: 'ver', remote, t, iconOnly: stacked }),
      ]),
    ]),
    h('div', { key: 'body', className: 'gp-body' }, body),
  ])
}

interface VersionBarProps {
  readonly remote: GitPanelRemote
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  /** Icon-only form for the stacked layout: the check button plus the update
   * dot, no version/status text (a sidebar column has room for glyphs only). */
  readonly iconOnly?: boolean
}

type VerState =
  | { kind: 'idle'; info?: GitVersionInfo }
  | { kind: 'checking'; info?: GitVersionInfo }

/** Trailing tab-bar cluster: current version + a user-triggered update check.
 * In icon-only mode (stacked) it keeps the check glyph and the update dot —
 * the dot links to the release page, both carry their text on title/aria. */
function VersionBar({ remote, t, iconOnly = false }: VersionBarProps): JSX.Element {
  const [state, setState] = useState<VerState>({ kind: 'idle' })
  // Snappy tooltip for the star link, dropped below it (it sits at the panel top).
  const { tipProps, tipNode } = useHoverTip({ placement: 'below', maxWidth: 300 })

  // Fetch the local version once (no network); the remote check is manual.
  useEffect(() => {
    let alive = true
    void remote.version({}).then((res) => {
      if (alive && 'current' in res) setState((prev) => ({ ...prev, info: res }))
    })
    return () => { alive = false }
  }, [remote])

  const check = async (): Promise<void> => {
    setState((prev) => ({ kind: 'checking', info: prev.info }))
    const res = await remote.version({ check: true })
    setState({ kind: 'idle', info: 'current' in res ? res : undefined })
  }

  const info = state.info
  if (iconOnly) {
    const updateTitle = info !== undefined && info.updateAvailable && info.latest !== undefined
      ? t('version.updateAvailable', { latest: info.latest, current: info.current })
      : null
    const dot = updateTitle === null
      ? null
      : info?.releaseUrl !== undefined
        ? h('a', { key: 'dot', className: 'gp-verbar__dot', href: info.releaseUrl, target: '_blank', rel: 'noreferrer', title: updateTitle, 'aria-label': updateTitle })
        : h('span', { key: 'dot', className: 'gp-verbar__dot', role: 'img', title: updateTitle, 'aria-label': updateTitle })
    return h('div', { className: 'gp-verbar gp-verbar--icon' }, [
      h('button', {
        key: 'btn', type: 'button', className: 'gp-verbar__btn gp-verbar__btn--icon',
        disabled: state.kind === 'checking',
        title: info?.error !== undefined ? info.error : t('version.check'),
        'aria-label': t('version.check'),
        onClick: () => void check(),
      }, h('span', { key: 'i', className: 'gp-tab__icon' }, h(RefreshIcon, { size: 12 }))),
      dot,
    ])
  }
  const status = ((): JSX.Element | null => {
    if (state.kind === 'checking') return h('span', { className: 'gp-verbar__status' }, t('version.checking'))
    if (info === undefined || !info.checkedRemote) return null
    if (info.error !== undefined) {
      return h('span', { className: 'gp-verbar__status gp-verbar__status--err', title: info.error }, info.error === 'repository is not configured' ? t('version.noRepo') : t('version.error'))
    }
    if (info.updateAvailable && info.latest !== undefined) {
      return h('span', {}, [
        h('span', { key: 's', className: 'gp-verbar__status gp-verbar__status--new' }, t('version.updateAvailable', { latest: info.latest, current: info.current })),
        info.releaseUrl !== undefined ? h('a', { key: 'l', className: 'gp-verbar__link', href: info.releaseUrl, target: '_blank', rel: 'noreferrer', style: { marginLeft: 8 } }, t('version.viewRelease')) : null,
      ])
    }
    return h('span', { className: 'gp-verbar__status gp-verbar__status--ok' }, t('version.upToDate', { current: info.current }))
  })()

  return h('div', { className: 'gp-verbar' }, [
    info !== undefined ? h('span', { key: 'tag', className: 'gp-verbar__tag' }, `v${info.current}`) : null,
    status,
    h('button', {
      key: 'btn', type: 'button', className: 'gp-verbar__btn',
      disabled: state.kind === 'checking',
      onClick: () => void check(),
    }, [h('span', { key: 'i', className: 'gp-tab__icon' }, h(RefreshIcon, { size: 12 })), t('version.check')]),
    info?.repositoryUrl !== undefined ? h('a', {
      key: 'gh', className: 'gp-icon-btn gp-verbar__gh gp-verbar__gh--starred', href: info.repositoryUrl,
      target: '_blank', rel: 'noreferrer', 'aria-label': t('version.openRepo'), ...tipProps(t('version.openRepo')),
    }, h(StarIcon, { size: 15 })) : null,
    tipNode,
  ])
}
