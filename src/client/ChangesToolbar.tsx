/** Compact, single-row repository actions for the changes list. */
import { createElement as h, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitKey } from './locales.js'
import type { ChangesViewMode, GitSnapshot } from './types.js'
import { LinkIcon, ListIcon, RefreshIcon, StageAllIcon, StagePickedIcon, StashIcon, TrashAllIcon, TrashIcon, TreeIcon, UnstageAllIcon, UploadIcon } from './icons.js'
import { TipWrapper, useHoverTip } from './tip.js'
import { pushIntent } from './push-policy.js'

interface ChangesToolbarProps {
  readonly snapshot: GitSnapshot
  readonly busy: boolean
  readonly hasDiscardTargets: boolean
  /** Working-tree paths behind the checked rows; empty when nothing stageable is picked. */
  readonly stageTargets: readonly string[]
  /** Current changes-list presentation; the tail switch icon flips it. */
  readonly viewMode: ChangesViewMode
  readonly onPickView: (view: ChangesViewMode) => void
  readonly onStagePicked: (paths: readonly string[]) => void
  readonly onStageAll: () => void
  readonly onUnstageAll: () => void
  readonly onDiscard: () => void
  readonly onDiscardAll: () => void
  readonly onStash: () => void
  /** Ordinary push (`git push`) to the upstream. */
  readonly onPush: () => void
  /** Attach the branch to a same-named remote branch already at HEAD. */
  readonly onSetUpstream: () => void
  /** Publish a branch that only exists locally (`git push -u`). */
  readonly onPublish: () => void
  readonly onRefresh: () => Promise<void>
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function ChangesToolbar(props: ChangesToolbarProps): JSX.Element {
  const { snapshot, busy, t } = props
  const [refreshing, setRefreshing] = useState(false)
  const refreshFlight = useRef(false)
  const { tipProps, tipNode, hideTip } = useHoverTip({ placement: 'below' })
  useEffect(() => { hideTip() }, [snapshot, hideTip])
  const refresh = async (): Promise<void> => {
    if (refreshFlight.current) return
    refreshFlight.current = true
    setRefreshing(true)
    try { await props.onRefresh() }
    finally { refreshFlight.current = false; setRefreshing(false) }
  }
  const disabled = busy || refreshing
  // The upload control carries whichever remote write this branch can take: a
  // push when strictly ahead, a set-upstream when a remote already has the
  // same-named branch at HEAD, a publish when the branch has no upstream yet.
  // All intents are unavailable otherwise, so the button never reads as a dead
  // control on a freshly committed local-only branch (issue #63).
  const intent = pushIntent(snapshot)
  const remoteLabel: GitKey = intent === 'set-upstream'
    ? 'status.setUpstream'
    : intent === 'publish' ? 'status.publishTitle' : 'status.pushTitle'
  // An unavailable control keeps its action name (aria-label) and explains
  // itself on hover instead — the accessible name states what the control is,
  // the tip states why it is off (issue #61).
  const remoteTip = intent === null
    ? t('changes.noRemoteTarget')
    : intent === 'set-upstream'
      ? t('status.setUpstreamTitle')
      : t(remoteLabel)
  const remoteAction = (): void => {
    if (intent === 'set-upstream') props.onSetUpstream()
    else if (intent === 'publish') props.onPublish()
    else if (intent === 'push') props.onPush()
  }
  // Tip handlers live on a non-disabled wrapper: a `disabled` button swallows
  // mouse events, so hover would never reach the button itself (issue #61).
  const button = (key: string, label: GitKey, icon: JSX.Element, unavailable: boolean, onClick: () => void, extraClass = '', tipText?: string): JSX.Element => h(TipWrapper, {
    key, tipProps: tipProps(tipText ?? t(label)),
  }, h('button', {
    type: 'button', className: `gp-icon-btn gp-changes__${key}${extraClass}`,
    'aria-label': t(label), disabled: disabled || unavailable,
    ...(key === 'refresh' ? { 'aria-busy': refreshing } : {}),
    onClick: () => { hideTip(); onClick() },
  }, h('span', { 'aria-hidden': true }, icon)))
  // The list's presentation switch sits at the tail as one icon showing the view
  // in use (a list for flat, indented lines for tree); a click flips to the
  // other. It never disables with `busy`: it only changes how rows are laid out,
  // not the work tree. The container query in css/changes.ts takes it out of the
  // bar when the bar is compressed, so the actions keep their one row.
  const nextView: ChangesViewMode = props.viewMode === 'tree' ? 'flat' : 'tree'
  const viewName = (mode: ChangesViewMode): string => t(mode === 'tree' ? 'changes.viewTree' : 'changes.viewFlat')
  // The name states both the state and the action: the glyph alone cannot say
  // whether it is the current view or the one a click brings.
  const viewLabel = t('changes.viewSwitch', { current: viewName(props.viewMode), next: viewName(nextView) })
  const viewToggle = h(TipWrapper, { key: 'view', tipProps: tipProps(viewLabel), className: 'gp-changes__viewslot' }, h('button', {
    type: 'button',
    className: 'gp-icon-btn gp-changes__viewbtn',
    'aria-label': viewLabel,
    'data-view': props.viewMode,
    onClick: () => { hideTip(); props.onPickView(nextView) },
  }, h('span', { 'aria-hidden': true }, props.viewMode === 'tree' ? h(TreeIcon, { size: 16 }) : h(ListIcon, { size: 16 }))))
  return h('div', { className: 'gp-toolbar gp-changes__toolbar', role: 'group', 'aria-label': t('changes.actions') }, [
    // Stages only the checked working-tree rows — the batch form of each row's
    // own "+" (issue #82). Unavailable until a stageable row is picked, and
    // scoped to the picked paths so it never stages the rest of the work tree.
    button('stage-picked', 'changes.stagePicked', h(StagePickedIcon, { size: 16 }), props.stageTargets.length === 0, () => props.onStagePicked(props.stageTargets), '', t('changes.stagePickedTip')),
    button('stage-all', 'changes.stageAll', h(StageAllIcon, { size: 16 }), snapshot.changes.length === 0, props.onStageAll),
    button('unstage-all', 'changes.unstageAll', h(UnstageAllIcon, { size: 16 }), snapshot.staged === 0, props.onUnstageAll),
    button('discard-picked', 'changes.discardPicked', h(TrashIcon, { size: 16 }), !props.hasDiscardTargets, props.onDiscard),
    // Bulk "back to HEAD's work tree": no selection needed, works even when the
    // list is truncated (the host re-resolves the full change set itself).
    button('discard-all', 'changes.discardAll', h(TrashAllIcon, { size: 16 }), snapshot.modified === 0 && snapshot.untracked === 0, props.onDiscardAll),
    button('stash', 'changes.stash', h(StashIcon, { size: 16 }), snapshot.staged === 0 && snapshot.modified === 0, props.onStash),
    button('push', remoteLabel, h(intent === 'set-upstream' ? LinkIcon : UploadIcon, { size: 16 }), intent === null, remoteAction, '', remoteTip),
    button('refresh', 'changes.refresh', h(RefreshIcon, { size: 16 }), false, () => void refresh(), refreshing ? ' gp-changes__refresh--busy' : ''),
    viewToggle,
    tipNode,
  ])
}
