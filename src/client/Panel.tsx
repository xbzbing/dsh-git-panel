/**
 * Main Git panel shell: Overview / Changes / Files over the conversation.view
 * slot. Snapshot state chooses the initial tab unless the input-bar pill
 * supplied a one-shot focus request.
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { gitPanelRemoteOf, hasSession, type ClientCtx } from './rpc'
import type { GitPanelRemote } from './rpc'
import { useGitView, controllerFor } from './registry'
import { takeSubTab, subscribeSubTab, type SubTab } from './jump'
import { OverviewTab } from './OverviewTab'
import { ChangesTab } from './ChangesTab'
import { FilesTab } from './FilesTab'
import { CommitIcon, DiffIcon, FilesIcon, GitHubIcon, RefreshIcon } from './icons'
import type { GitAction, GitVersionInfo } from './types'
import type { GitKey } from './locales'

const FONT_DELTA_KEY = 'gp.panel.fontDelta'

type FontDelta = -1 | 0 | 1

function readFontDelta(): FontDelta {
  if (typeof localStorage === 'undefined') return 0
  const value = Number(localStorage.getItem(FONT_DELTA_KEY))
  return value === -1 || value === 1 ? value : 0
}

interface PanelProps {
  readonly ctx: ClientCtx
  readonly sessionId?: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function Panel({ ctx, sessionId, t }: PanelProps): JSX.Element {
  const [fontDelta, setFontDelta] = useState<FontDelta>(readFontDelta)
  const [selection, setSelection] = useState<{ sessionId: string; tab: SubTab } | null>(null)
  const view = useGitView(sessionId)
  const remote = gitPanelRemoteOf(ctx)
  const filesOnly = view.state === 'error' && view.error.code === 'not-a-git-repo'
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
    if (view.state === 'ready') setSelection({ sessionId, tab: view.snapshot.dirty ? 'changes' : 'overview' })
  }, [sessionId, view, filesOnly, selection?.sessionId])

  // While mounted, receive pill jumps live (a click when the panel is already
  // visible must still switch sub-tabs, not sit in the pending map).
  useEffect(() => {
    if (!hasSession(sessionId)) return
    return subscribeSubTab(sessionId, (requested) => setSelection({ sessionId, tab: requested }))
  }, [sessionId])

  // The snapshot's checkedAt drives child reloads directly (no extra state /
  // first-mount bump): OverviewTab/ChangesTab reload when it advances.
  const refreshKey = view.state === 'ready' ? view.snapshot.checkedAt : 0

  const onAction = async (action: GitAction): Promise<{ ok: boolean; error?: string }> => {
    if (!hasSession(sessionId)) return { ok: false, error: t('error.noCwd') }
    const result = await remote.run({ sessionId, action })
    if (result.ok) {
      // The run already returned a fresh snapshot; feed it to the controller
      // instead of triggering another git round-trip.
      controllerFor(sessionId).accept(result.snapshot)
      return { ok: true }
    }
    return { ok: false, error: errorText(result.error.code, result.error.message, t) }
  }

  const adjustFont = (delta: FontDelta): void => {
    setFontDelta(delta)
    if (typeof localStorage !== 'undefined') localStorage.setItem(FONT_DELTA_KEY, String(delta))
  }

  const allTabs: Array<{ key: SubTab; label: string; icon: JSX.Element }> = [
    { key: 'overview', label: t('tab.overview'), icon: h(CommitIcon, { size: 14 }) },
    { key: 'changes', label: t('tab.changes'), icon: h(DiffIcon, { size: 14 }) },
    { key: 'files', label: t('tab.files'), icon: h(FilesIcon, { size: 14 }) },
  ]
  // A non-git directory exposes only the Files tab.
  const tabs = filesOnly ? allTabs.filter((tb) => tb.key === 'files') : allTabs

  const body = ((): JSX.Element => {
    if (!hasSession(sessionId)) return h('div', { className: 'gp-empty' }, t('error.noCwd'))
    if (view.state === 'no-cwd') return h('div', { className: 'gp-empty' }, t('error.noCwd'))
    // A non-git directory still browses files (host resolves the cwd as root).
    if (filesOnly) {
      return h('div', { style: { display: 'contents' } },
        filesVisited ? h(FilesTab, { key: sessionId, remote, sessionId, t }) : null)
    }
    if (view.state === 'error') {
      return h('div', { className: 'gp-empty' }, t('pill.unavailable'))
    }
    if (view.state === 'cold' || view.state === 'loading' || activeTab === null) return h('div', { className: 'gp-empty' }, t('common.loading'))
    // Mount each git-only tab on first visit, then hide it to retain its state.
    // Keying on sessionId resets per-session caches and selection on a switch.
    const snapshot = view.snapshot
    return h('div', { style: { display: 'contents' } }, [
      visited.current.tabs.has('overview') ? h('div', { key: 'overview', style: activeTab === 'overview' ? { display: 'contents' } : { display: 'none' } },
        h(OverviewTab, { key: sessionId, remote, sessionId, refreshKey, defaultDiffView: snapshot.defaultDiffView, t })) : null,
      visited.current.tabs.has('changes') ? h('div', { key: 'changes', style: activeTab === 'changes' ? { display: 'contents' } : { display: 'none' } },
        h(ChangesTab, { key: sessionId, remote, sessionId, snapshot, onAction, t })) : null,
      // Files tab mounts on first visit (keeps cold cost zero — no dir-list
      // until the user opens it), then stays mounted to retain its tree state.
      filesVisited
        ? h('div', { key: 'files', style: activeTab === 'files' ? { display: 'contents' } : { display: 'none' } },
          h(FilesTab, { key: sessionId, remote, sessionId, t }))
        : null,
    ])
  })()

  // `data-conversation-composer-overlay` opts the view into the shell's
  // full-height layout: the view area is fixed to the visible height with its
  // own overflow, and the composer/input bar floats over the bottom. Without
  // it the view grows with content and the whole conversation scrolls.
  return h('div', { className: 'gp-panel', 'data-conversation-composer-overlay': '', 'data-font-delta': fontDelta }, [
    h('div', { key: 'tabs', className: 'gp-tabbar', role: 'tablist' }, [
      ...tabs.map((tb) =>
        h('button', {
          key: tb.key, type: 'button', role: 'tab',
          'aria-selected': activeTab === tb.key,
          className: `gp-tab${activeTab === tb.key ? ' gp-tab--active' : ''}`,
          onClick: () => { if (hasSession(sessionId)) setSelection({ sessionId, tab: tb.key }) },
        }, [h('span', { key: 'i', className: 'gp-tab__icon' }, tb.icon), tb.label])),
      h('div', { key: 'font', className: 'gp-font' }, [
        h('button', { key: 'dec', type: 'button', className: 'gp-font__decrease', onClick: () => adjustFont(-1), 'aria-label': t('panel.fontDecrease') }, 'A−'),
        h('button', { key: 'reset', type: 'button', className: 'gp-font__reset', onClick: () => adjustFont(0), 'aria-label': t('panel.fontReset') }, 'A'),
        h('button', { key: 'inc', type: 'button', className: 'gp-font__increase', onClick: () => adjustFont(1), 'aria-label': t('panel.fontIncrease') }, 'A+'),
      ]),
      h(VersionBar, { key: 'ver', remote, t }),
    ]),
    h('div', { key: 'body', className: 'gp-body' }, body),
  ])
}

function errorText(code: string, message: string | undefined, t: (key: GitKey) => string): string {
  switch (code) {
    case 'empty-message': return t('error.emptyMessage')
    case 'not-a-git-repo': return t('error.notARepo')
    case 'cwd-unavailable': return t('error.noCwd')
    case 'local-changes-block': return t('error.localChangesBlock')
    default: return message ?? t('error.generic')
  }
}

interface VersionBarProps {
  readonly remote: GitPanelRemote
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type VerState =
  | { kind: 'idle'; info?: GitVersionInfo }
  | { kind: 'checking'; info?: GitVersionInfo }

/** Trailing tab-bar cluster: current version + a user-triggered update check. */
function VersionBar({ remote, t }: VersionBarProps): JSX.Element {
  const [state, setState] = useState<VerState>({ kind: 'idle' })

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
      key: 'gh', className: 'gp-icon-btn gp-verbar__gh', href: info.repositoryUrl,
      target: '_blank', rel: 'noreferrer', title: t('version.openRepo'), 'aria-label': t('version.openRepo'),
    }, h(GitHubIcon, { size: 15 })) : null,
  ])
}
