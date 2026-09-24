/**
 * Main Git panel shell: an internal tab bar (Overview / Changes) over the
 * conversation.view slot. Consumes the one-shot sub-tab focus request the
 * input-bar pill records.
 */
import { createElement as h, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { gitPanelRemoteOf, type ClientCtx } from './rpc'
import { useGitView } from './registry'
import { controllerFor } from './registry'
import { takeSubTab, type SubTab } from './jump'
import { OverviewTab } from './OverviewTab'
import { ChangesTab } from './ChangesTab'
import { CommitIcon, DiffIcon } from './icons'
import type { GitAction } from './types'
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
    if (tab === 'overview') return h(OverviewTab, { remote, sessionId, refreshKey, t })
    return h(ChangesTab, { remote, sessionId, snapshot: view.snapshot, refreshKey, onAction, t })
  })()

  return h('div', { className: 'gp-panel' }, [
    h('div', { key: 'tabs', className: 'gp-tabbar', role: 'tablist' }, tabs.map((tb) =>
      h('button', {
        key: tb.key, type: 'button', role: 'tab',
        'aria-selected': tab === tb.key,
        className: `gp-tab${tab === tb.key ? ' gp-tab--active' : ''}`,
        onClick: () => setTab(tb.key),
      }, [h('span', { key: 'i', className: 'gp-tab__icon' }, tb.icon), tb.label]))),
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
