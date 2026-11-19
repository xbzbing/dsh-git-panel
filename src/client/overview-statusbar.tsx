/**
 * Git overview left-column footer status bar.
 * Split out of OverviewTab so the composition layer stays focused on data
 * wiring; this module owns the status-bar presentation only.
 *
 * Steady states are a glyph with a count (`✓`, `↑2`, `↓3`, `↓3 ↑2`, `HEAD`),
 * never a sentence (issue #131). The bar lives in the overview's left column,
 * which is 200px at its default and can be dragged to 130 — after the row's own
 * chrome (padding, repo link, check and action controls, ~140px) the state cell
 * gets 40–60px. Measured at the same 11px label font, the sentences need 66px
 * (`已与远程同步`) to 143px (`游离 HEAD，无分支同步状态`) in zh, and 107px
 * (`No upstream branch`) to 210px in en, so prose could only ever be an
 * ellipsis. The sentence is not dropped: it is the cell's accessible name and
 * its hover tip, and it survives at every width.
 *
 * Two width-driven degradations keep that budget (thresholds in panel-fit.ts,
 * measured on the bar itself): `data-narrow` drops the repository link, and
 * `data-dense` lets pull/push/publish keep only their icon (label, tooltip and
 * accessible name unchanged).
 *
 * Dropping the repository link is a deliberate trade, not an oversight: it is a
 * convenience jump, and the status glyph is what the row exists to show. It is
 * also the only `remote.webUrl` consumer in the client, so a narrow bar has no
 * other way to that page — accepted, because the alternative was a status cell
 * that never fits.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type { GitSnapshot } from './types.js'
import type { GitKey } from './locales.js'
import { DownloadIcon, GitHubIcon, LinkIcon, SyncIcon, UploadIcon } from './icons.js'
import { TipWrapper, useHoverTip } from './tip.js'
import { pushIntent as pushIntentOf } from './push-policy.js'
import { useElementWidth } from './use-element-width.js'
import { STATUSBAR_ACTION_BP, STATUSBAR_REPO_BP } from './panel-fit.js'

type Translate = (key: GitKey, params?: Record<string, string | number>) => string

export interface StatusBarCbs {
  readonly syncBusy: boolean
  readonly syncError: string | null
  readonly pullBusy: boolean
  readonly pushBusy: boolean
  readonly publishBusy: boolean
  readonly setUpstreamBusy: boolean
  readonly switchBusy: boolean
  readonly onCheck: () => void
  readonly onPull: () => void
  readonly onPush: () => void
  readonly onPublish: () => void
  readonly onSetUpstream: () => void
  readonly t: Translate
  /** The caller's own tiers also drop the repository link (a compact footer,
   * the tight drawer). That decision and the bar's own measured width are
   * ORed, so either one is enough to hide it. */
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
 * right. A detached HEAD or an untracked branch shows the state glyph only (no
 * pull); a strictly-behind branch is the one case that offers the pull.
 */
export function renderStatusBar(snapshot: GitSnapshot, cb: StatusBarCbs): JSX.Element {
  return h(StatusBar, { snapshot, cb })
}

function StatusBar({ snapshot, cb }: { snapshot: GitSnapshot; cb: StatusBarCbs }): JSX.Element {
  const { t } = cb
  // Snappy tooltip anchored above the footer controls (shared hook).
  const { tipProps, tipNode, hideTip } = useHoverTip({ placement: 'above' })
  // The bar's own width decides both degradations. The layout tier only
  // approximates it: the left column is user-resizable and the stacked band
  // clamps to 38%, so 0 (not measured yet) keeps the widest rendering rather
  // than hiding the link on a wide bar for one frame.
  const { setEl, width } = useElementWidth()
  const narrow = width > 0 && width <= STATUSBAR_REPO_BP
  const dense = width > 0 && width <= STATUSBAR_ACTION_BP

  // Tolerate a snapshot predating these fields (older host / cached snapshot):
  // a missing remote reads as "no remote", a missing upstream flag as false.
  const remote = snapshot.remote ?? null
  const hasUpstream = snapshot.hasUpstream === true

  // ── left: repo link, shown only for GitHub projects (icon only; path in tooltip) ──
  const repoNode = ((): JSX.Element | null => {
    // A narrow bar spends the row on the sync state; the caller's tiers do the
    // same for a compact footer or the tight drawer.
    if (cb.hideRepo === true || narrow) return null
    // Non-GitHub remotes (gitlab/gitee/other) and repos with no remote show nothing.
    if (remote === null || remote.hostKind !== 'github') return null
    const icon = h(GitHubIcon, { size: 14 })
    if (remote.webUrl === null) {
      // A GitHub remote we couldn't turn into a web URL: icon only, URL in the tooltip.
      return h('span', { key: 'r', className: 'gp-statusbar__repo gp-statusbar__repo--none', 'aria-label': remote.url, ...tipProps(remote.url) }, h('span', { className: 'gp-statusbar__ic' }, icon))
    }
    // `!= null` on purpose: an older host that predates `host` sends nothing,
    // and `!== null` would take that undefined into the string and label the
    // link "open the repository home on undefined". Same tolerance as `remote`
    // and `hasUpstream` above.
    const title = remote.host != null ? t('status.openRepoOn', { host: remote.host }) : t('status.openRepo')
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
  // A branch with no upstream yet either attaches the same-named remote branch
  // already at HEAD (set-upstream, config only) or is published (push -u). The
  // states are mutually exclusive: one control, one intent, never two.
  const intent = pushIntentOf(snapshot)
  // One glyph cell per steady state. `gp-statusbar__state` stays on it so the
  // existing queries keep finding the cell; the sentence rides the accessible
  // name (role=img, so the glyph itself is not read as punctuation) and the
  // shared hover tip.
  const symbol = (glyph: string, label: string, tone = ''): JSX.Element => h('span', {
    key: 'sym',
    className: `gp-statusbar__state gp-statusbar__state--symbol${tone}`,
    role: 'img',
    'aria-label': label,
    ...tipProps(label),
  }, glyph)
  const stateNode = ((): JSX.Element => {
    if (cb.switchBusy || cb.pullBusy || cb.pushBusy || cb.setUpstreamBusy) {
      const text = cb.switchBusy
        ? t('status.switching')
        : cb.pullBusy
          ? t('status.pulling')
          : cb.setUpstreamBusy ? t('status.settingUpstream') : t('status.pushing')
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
    if (branch === null) return symbol('HEAD', t('status.detached'))
    // No upstream: a bare `↑` (no count — there is no counterpart to count
    // against). It sits in the same family as `↑n`, so the row still reads as
    // "work waiting to go up", and it costs 9px in every language.
    //
    // A word was the obvious alternative and does not survive translation: the
    // cell has 60px at the 200px default column and 52px once the column is
    // dragged narrow, while `无上游` is 33px · `Sin subir` 46 · `Unpushed` 54 ·
    // `Ungepusht` 58 · `Non poussé` 62 · `Não enviado` 65 · `No upstream` 67 ·
    // `Нет upstream` 72. A label would put the ellipsis back for five of the
    // eight dictionaries. The sentence lives on as the accessible name and the
    // hover tip, and the publish / set-upstream control beside it names the
    // action (VS Code's status item does the same with a `cloud-upload` icon).
    if (!hasUpstream) return symbol('↑', t('status.noUpstream'))
    if (ahead === 0 && behind === 0) return symbol('✓', t('status.synced'), ' gp-statusbar__state--ok')
    // Behind first, like VS Code's `behind↓ ahead↑`: pulling is what blocks a
    // fast-forward, so the blocking half reads first.
    if (ahead > 0 && behind > 0) return symbol(`↓${behind} ↑${ahead}`, t('status.diverged', { ahead, behind }), ' gp-statusbar__state--warn')
    if (behind > 0) return symbol(`↓${behind}`, t('overview.branchBehind', { n: behind }), ' gp-statusbar__state--warn')
    return symbol(`↑${ahead}`, t('overview.branchAhead', { n: ahead }))
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
    }, [h(DownloadIcon, { key: 'i', size: 12 }), h('span', { key: 'l', className: 'gp-btn__label' }, t('status.pull'))])) : null,
    intent === 'push' ? h(TipWrapper, {
      key: 'push', tipProps: tipProps(t('status.pushTitle')),
    }, h('button', {
      type: 'button', className: 'gp-btn gp-btn--sm gp-statusbar__pull',
      disabled: cb.pushBusy, 'aria-label': t('status.pushTitle'),
      onClick: () => { hideTip(); cb.onPush() },
    }, [h(UploadIcon, { key: 'i', size: 12 }), h('span', { key: 'l', className: 'gp-btn__label' }, t('status.push'))])) : null,
    intent === 'set-upstream' ? h(TipWrapper, {
      key: 'set-upstream',
      tipProps: tipProps(t('status.setUpstreamTitle')),
    }, h('button', {
      type: 'button', className: 'gp-btn gp-btn--sm gp-statusbar__pull',
      disabled: cb.setUpstreamBusy, 'aria-label': t('status.setUpstream'),
      onClick: () => { hideTip(); cb.onSetUpstream() },
    }, [h(LinkIcon, { key: 'i', size: 12 }), h('span', { key: 'l', className: 'gp-btn__label' }, t('status.setUpstream'))])) : null,
    intent === 'publish' ? h(TipWrapper, {
      key: 'publish', tipProps: tipProps(t('status.publishTitle')),
    }, h('button', {
      type: 'button', className: 'gp-btn gp-btn--sm gp-statusbar__pull',
      disabled: cb.publishBusy, 'aria-label': t('status.publishTitle'),
      onClick: () => { hideTip(); cb.onPublish() },
    }, [h(UploadIcon, { key: 'i', size: 12 }), h('span', { key: 'l', className: 'gp-btn__label' }, t('status.publish'))])) : null,
  ]

  // The publish modal and the set-upstream chooser own their own in-flight
  // locks; their busy callbacks still drive the bar's busy state and label
  // while the write runs behind the overlay.
  const barBusy = cb.syncBusy || cb.pullBusy || cb.pushBusy || cb.setUpstreamBusy || cb.switchBusy
  return h('div', {
    key: 'statusbar',
    ref: setEl,
    className: `gp-statusbar${barBusy ? ' gp-statusbar--busy' : ''}`,
    'aria-busy': barBusy,
    ...(narrow ? { 'data-narrow': 'true' } : {}),
    ...(dense ? { 'data-dense': 'true' } : {}),
  }, [
    repoNode,
    h('div', { key: 'sync', className: 'gp-statusbar__sync' }, [stateNode, ...actions]),
    tipNode,
  ])
}
