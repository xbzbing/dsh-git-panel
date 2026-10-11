/**
 * Git overview left-column footer status bar and the sync-scope preview nodes.
 * Split out of OverviewTab so the composition layer stays focused on data
 * wiring; this module owns the status-bar presentation only.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type { GitSnapshot } from './types'
import type { GitKey } from './locales'
import { DownloadIcon, GitHubIcon, SyncIcon, UploadIcon } from './icons'
import { useHoverTip } from './tip'

type Translate = (key: GitKey, params?: Record<string, string | number>) => string

export type PullPreview = { commits: number; files: number; insertions: number; deletions: number }

/** A fast-forward scope line (pull or push), highlighted + bold in the confirm.
 * The ±line counts are colored like a diffstat; the `+N / −N` token is split
 * out of the interpolated string (identical in every locale) so only the
 * numbers carry the add/del color. `keys` pick the direction's copy. */
function scopeNode(preview: 'loading' | PullPreview | null, t: Translate, keys: { line: GitKey; loading: GitKey }): JSX.Element {
  if (preview === 'loading' || preview === null) {
    return h('div', { className: 'gp-pullscope gp-pullscope--loading' }, t(keys.loading))
  }
  const line = t(keys.line, { commits: preview.commits, files: preview.files, ins: preview.insertions, del: preview.deletions })
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

/** Incoming fast-forward scope shown in the pull confirm. */
export function pullScopeNode(preview: 'loading' | PullPreview | null, t: Translate): JSX.Element {
  return scopeNode(preview, t, { line: 'status.pullScope', loading: 'status.pullScopeLoading' })
}

/** Outgoing scope shown in the push confirm. */
export function pushScopeNode(preview: 'loading' | PullPreview | null, t: Translate): JSX.Element {
  return scopeNode(preview, t, { line: 'status.pushScope', loading: 'status.pushScopeLoading' })
}

export interface StatusBarCbs {
  readonly syncBusy: boolean
  readonly pullBusy: boolean
  readonly pushBusy: boolean
  readonly publishBusy: boolean
  readonly onCheck: () => void
  readonly onPull: () => void
  readonly onPush: () => void
  readonly onPublish: () => void
  readonly t: Translate
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
  const canPush = hasUpstream && ahead > 0 && behind === 0
  // A branch with no upstream yet can be published (push -u) when a remote
  // exists to publish to.
  const canPublish = !hasUpstream && branch !== null && remote !== null
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
      disabled: cb.syncBusy, 'aria-label': t('status.check'), ...tipProps(t('status.checkTitle')),
      onClick: () => { hideTip(); cb.onCheck() },
    }, h(SyncIcon, { size: 13 })) : null,
    canPull ? h('button', {
      key: 'pull', type: 'button', className: 'gp-btn gp-btn--sm gp-statusbar__pull',
      disabled: cb.pullBusy, 'aria-label': t('status.pullTitle'), ...tipProps(t('status.pullTitle')),
      onClick: () => { hideTip(); cb.onPull() },
    }, [h(DownloadIcon, { key: 'i', size: 12 }), t('status.pull')]) : null,
    canPush ? h('button', {
      key: 'push', type: 'button', className: 'gp-btn gp-btn--sm gp-statusbar__pull',
      disabled: cb.pushBusy, 'aria-label': t('status.pushTitle'), ...tipProps(t('status.pushTitle')),
      onClick: () => { hideTip(); cb.onPush() },
    }, [h(UploadIcon, { key: 'i', size: 12 }), t('status.push')]) : null,
    canPublish ? h('button', {
      key: 'publish', type: 'button', className: 'gp-btn gp-btn--sm gp-statusbar__pull',
      disabled: cb.publishBusy, 'aria-label': t('status.publishTitle'), ...tipProps(t('status.publishTitle')),
      onClick: () => { hideTip(); cb.onPublish() },
    }, [h(UploadIcon, { key: 'i', size: 12 }), t('status.publish')]) : null,
  ]

  return h('div', { key: 'statusbar', className: `gp-statusbar${cb.syncBusy ? ' gp-statusbar--busy' : ''}` }, [
    repoNode,
    h('div', { key: 'sync', className: 'gp-statusbar__sync' }, [stateNode, ...actions]),
    tipNode,
  ])
}
