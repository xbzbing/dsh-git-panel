/**
 * Git overview left-column footer status bar.
 * Split out of OverviewTab so the composition layer stays focused on data
 * wiring; this module owns the status-bar presentation only.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type { GitSnapshot } from './types.js'
import type { GitKey } from './locales.js'
import { DownloadIcon, GitHubIcon, SyncIcon, UploadIcon } from './icons.js'
import { TipWrapper, useHoverTip } from './tip.js'
import { pushIntent as pushIntentOf } from './push-policy.js'

type Translate = (key: GitKey, params?: Record<string, string | number>) => string

export interface StatusBarCbs {
  readonly syncBusy: boolean
  readonly syncError: string | null
  readonly pullBusy: boolean
  readonly pushBusy: boolean
  readonly publishBusy: boolean
  readonly switchBusy: boolean
  readonly onCheck: () => void
  readonly onPull: () => void
  readonly onPush: () => void
  readonly onPublish: () => void
  readonly t: Translate
  /** Drop the GitHub repo link: a narrow panel (compact footer, the tight
   * tier's drawer) spends the row on the sync state instead. */
  readonly hideRepo?: boolean
}

/** Repo-page web link (last two path segments, e.g. `owner/repo`). */
function repoLabel(webUrl: string): string {
  const path = webUrl.replace(/^https?:\/\/[^/]+\//, '').replace(/\/+$/, '')
  const parts = path.split('/')
  return parts.length >= 2 ? parts.slice(-2).join('/') : path
}

/**
 * Left-column footer status bar: the repository's remote link (shown only for
 * GitHub projects, opening the repo page in a new tab) on the left, and the
 * current branch's sync state with a fetch-check and a fast-forward pull on the
 * right. A detached HEAD or an untracked branch shows the state text only (no
 * pull); a strictly-behind branch is the one case that offers the pull.
 */
export function renderStatusBar(snapshot: GitSnapshot, cb: StatusBarCbs): JSX.Element {
  return h(StatusBar, { snapshot, cb })
}

function StatusBar({ snapshot, cb }: { snapshot: GitSnapshot; cb: StatusBarCbs }): JSX.Element {
  const { t } = cb
  // Snappy tooltip anchored above the footer controls (shared hook).
  const { tipProps, tipNode, hideTip } = useHoverTip({ placement: 'above' })

  // Tolerate a snapshot predating these fields (older host / cached snapshot):
  // a missing remote reads as "no remote", a missing upstream flag as false.
  const remote = snapshot.remote ?? null
  const hasUpstream = snapshot.hasUpstream === true

  // ── left: repo link, shown only for GitHub projects (icon only; path in tooltip) ──
  const repoNode = ((): JSX.Element | null => {
    // Narrow panels skip the link outright — the sync state keeps the row.
    if (cb.hideRepo === true) return null
    // Non-GitHub remotes (gitlab/gitee/other) and repos with no remote show nothing.
    if (remote === null || remote.hostKind !== 'github') return null
    const icon = h(GitHubIcon, { size: 14 })
    if (remote.webUrl === null) {
      // A GitHub remote we couldn't turn into a web URL: icon only, URL in the tooltip.
      return h('span', { key: 'r', className: 'gp-statusbar__repo gp-statusbar__repo--none', 'aria-label': remote.url, ...tipProps(remote.url) }, h('span', { className: 'gp-statusbar__ic' }, icon))
    }
    const title = remote.host !== null ? t('status.openRepoOn', { host: remote.host }) : t('status.openRepo')
    const label = `${repoLabel(remote.webUrl)} · ${title}`
    return h('a', {
      key: 'r', className: 'gp-statusbar__repo', href: remote.webUrl, target: '_blank', rel: 'noreferrer',
      'aria-label': label, ...tipProps(label),
    }, h('span', { className: 'gp-statusbar__ic' }, icon))
  })()

  // ── right: sync state + actions ──
  const { ahead, behind, branch } = snapshot
  const canPull = hasUpstream && behind > 0 && ahead === 0
  // Push is offered only when strictly ahead (ahead>0, behind=0): the push can
  // only fast-forward the remote. A diverged branch (both ahead and behind) is
  // deliberately not offered — the user must reconcile first.
  // A branch with no upstream yet is published instead (push -u): creating a
  // same-named remote branch cannot overwrite anything, so it needs no
  // ahead/behind reconciliation. One control, one intent, never both.
  const intent = pushIntentOf(snapshot)
  const stateNode = ((): JSX.Element => {
    let text: string
    let tone = ''
    if (branch === null) { text = t('status.detached') }
    else if (!hasUpstream) { text = t('status.noUpstream') }
    else if (ahead === 0 && behind === 0) { text = t('status.synced'); tone = ' gp-statusbar__state--ok' }
    else if (ahead > 0 && behind > 0) { text = t('status.diverged', { ahead, behind }); tone = ' gp-statusbar__state--warn' }
    else if (behind > 0) { text = t('status.behind', { n: behind }); tone = ' gp-statusbar__state--warn' }
    else { text = t('status.ahead', { n: ahead }) }
    if (cb.switchBusy || cb.pullBusy || cb.pushBusy) {
      const text = cb.switchBusy ? t('status.switching') : cb.pullBusy ? t('status.pulling') : t('status.pushing')
      // The whole bar already marks the busy window with `aria-busy`, and the
      // check button spins for exactly as long (`.gp-statusbar--busy`): a second
      // loader next to the label would say the same thing twice, one of them
      // only 12px wide. The label is what names the operation.
      return h('span', { key: 'busy', className: 'gp-statusbar__state gp-statusbar__state--busy', role: 'status' },
        h('span', { key: 'label', className: 'gp-statusbar__state-label' }, text))
    }
    if (cb.syncError !== null) {
      return h('span', { key: 'error', className: 'gp-statusbar__state gp-statusbar__state--warn', role: 'alert', title: cb.syncError }, cb.syncError)
    }
    return h('span', { key: 's', className: `gp-statusbar__state${tone}` }, text)
  })()

  // Tip handlers live on a non-disabled wrapper so a busy (`disabled`) control
  // still explains itself on hover (issue #61).
  const actions: (JSX.Element | null)[] = [
    // Fetch-check is offered whenever a remote exists (even without an upstream,
    // a fetch can populate the tracking refs the first time).
    remote !== null ? h(TipWrapper, {
      key: 'check', tipProps: tipProps(t('status.checkTitle')),
    }, h('button', {
      type: 'button', className: 'gp-icon-btn gp-statusbar__btn',
      disabled: cb.syncBusy, 'aria-label': t('status.check'),
      onClick: () => { hideTip(); cb.onCheck() },
    }, h(SyncIcon, { size: 13 }))) : null,
    canPull ? h(TipWrapper, {
      key: 'pull', tipProps: tipProps(t('status.pullTitle')),
    }, h('button', {
      type: 'button', className: 'gp-btn gp-btn--sm gp-statusbar__pull',
      disabled: cb.pullBusy, 'aria-label': t('status.pullTitle'),
      onClick: () => { hideTip(); cb.onPull() },
    }, [h(DownloadIcon, { key: 'i', size: 12 }), t('status.pull')])) : null,
    intent === 'push' ? h(TipWrapper, {
      key: 'push', tipProps: tipProps(t('status.pushTitle')),
    }, h('button', {
      type: 'button', className: 'gp-btn gp-btn--sm gp-statusbar__pull',
      disabled: cb.pushBusy, 'aria-label': t('status.pushTitle'),
      onClick: () => { hideTip(); cb.onPush() },
    }, [h(UploadIcon, { key: 'i', size: 12 }), t('status.push')])) : null,
    intent === 'publish' ? h(TipWrapper, {
      key: 'publish', tipProps: tipProps(t('status.publishTitle')),
    }, h('button', {
      type: 'button', className: 'gp-btn gp-btn--sm gp-statusbar__pull',
      disabled: cb.publishBusy, 'aria-label': t('status.publishTitle'),
      onClick: () => { hideTip(); cb.onPublish() },
    }, [h(UploadIcon, { key: 'i', size: 12 }), t('status.publish')])) : null,
  ]

  return h('div', { key: 'statusbar', className: `gp-statusbar${cb.syncBusy || cb.pullBusy || cb.pushBusy || cb.switchBusy ? ' gp-statusbar--busy' : ''}`, 'aria-busy': cb.syncBusy || cb.pullBusy || cb.pushBusy || cb.switchBusy }, [
    repoNode,
    h('div', { key: 'sync', className: 'gp-statusbar__sync' }, [stateNode, ...actions]),
    tipNode,
  ])
}
