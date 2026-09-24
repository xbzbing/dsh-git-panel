/**
 * Main Git panel shell: an internal tab bar (Overview / Changes) over the
 * conversation.view slot. Consumes the one-shot sub-tab focus request the
 * input-bar pill records.
 */
import { createElement as h, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { gitPanelRemoteOf, type ClientCtx } from './rpc'
import type { GitPanelRemote } from './rpc'
import { useGitView } from './registry'
import { controllerFor } from './registry'
import { takeSubTab, type SubTab } from './jump'
import { OverviewTab } from './OverviewTab'
import { ChangesTab } from './ChangesTab'
import { CommitIcon, DiffIcon, RefreshIcon } from './icons'
import type { GitAction, GitVersionInfo } from './types'
import type { GitKey } from './locales'

interface PanelProps {
  readonly ctx: ClientCtx
  readonly sessionId?: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function Panel({ ctx, sessionId, t }: PanelProps): JSX.Element {
  const [tab, setTab] = useState<SubTab>('overview')
  const [refreshKey, setRefreshKey] = useState(0)
  const view = useGitView(sessionId)
  const remote = gitPanelRemoteOf(ctx)

  // Consume a pending focus request (pill click) on mount / session change.
  useEffect(() => {
    if (sessionId === undefined || sessionId === '') return
    const pending = takeSubTab(sessionId)
    if (pending !== null) setTab(pending)
    else if (view.state === 'ready') setTab(view.snapshot.dirty ? 'changes' : 'overview')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Poll: bump refreshKey when the snapshot's checkedAt advances.
  const checkedAt = view.state === 'ready' ? view.snapshot.checkedAt : 0
  useEffect(() => { setRefreshKey((k) => k + 1) }, [checkedAt])

  const onAction = async (action: GitAction): Promise<{ ok: boolean; error?: string }> => {
    if (sessionId === undefined) return { ok: false, error: t('error.noCwd') }
    const result = await remote.run({ sessionId, action })
    if (result.ok) {
      controllerFor(sessionId).resync()
      return { ok: true }
    }
    return { ok: false, error: errorText(result.error.code, result.error.message, t) }
  }

  const tabs: Array<{ key: SubTab; label: string; icon: JSX.Element }> = [
    { key: 'overview', label: t('tab.overview'), icon: h(CommitIcon, { size: 14 }) },
    { key: 'changes', label: t('tab.changes'), icon: h(DiffIcon, { size: 14 }) },
  ]

  const body = ((): JSX.Element => {
    if (sessionId === undefined || sessionId === '') return h('div', { className: 'gp-empty' }, t('error.noCwd'))
    if (view.state === 'no-cwd') return h('div', { className: 'gp-empty' }, t('error.noCwd'))
    if (view.state === 'error') {
      return h('div', { className: 'gp-empty' }, view.error.code === 'not-a-git-repo' ? t('error.notARepo') : t('pill.unavailable'))
    }
    if (view.state === 'cold' || view.state === 'loading') return h('div', { className: 'gp-empty' }, t('common.loading'))
    // Both tabs stay mounted; visibility toggles. Switching tabs then keeps the
    // Overview's loaded commits/tree/detail cache instead of re-fetching, and
    // preserves the Changes selection/scroll — the same state-retention idiom
    // an IDE Git tool uses.
    const snapshot = view.snapshot
    return h('div', { style: { display: 'contents' } }, [
      h('div', { key: 'overview', style: tab === 'overview' ? { display: 'contents' } : { display: 'none' } },
        h(OverviewTab, { remote, sessionId, t })),
      h('div', { key: 'changes', style: tab === 'changes' ? { display: 'contents' } : { display: 'none' } },
        h(ChangesTab, { remote, sessionId, snapshot, refreshKey, onAction, t })),
    ])
  })()

  // `data-conversation-composer-overlay` opts the view into the shell's
  // full-height layout: the view area is fixed to the visible height with its
  // own overflow, and the composer/input bar floats over the bottom. Without
  // it the view grows with content and the whole conversation scrolls.
  return h('div', { className: 'gp-panel', 'data-conversation-composer-overlay': '' }, [
    h('div', { key: 'tabs', className: 'gp-tabbar', role: 'tablist' }, [
      ...tabs.map((tb) =>
        h('button', {
          key: tb.key, type: 'button', role: 'tab',
          'aria-selected': tab === tb.key,
          className: `gp-tab${tab === tb.key ? ' gp-tab--active' : ''}`,
          onClick: () => setTab(tb.key),
        }, [h('span', { key: 'i', className: 'gp-tab__icon' }, tb.icon), tb.label])),
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
  ])
}
