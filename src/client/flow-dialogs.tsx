/**
 * Git Flow dialogs, opened from the branch list's `Git Flow` menu:
 *  - start: name a feature / hotfix / release and pick its base;
 *  - finish: pick how the current flow branch is integrated (merge commit,
 *    squash, rebase), the message, and whether the branch (and its remote) is
 *    deleted; pressing 完成 opens a confirmation of the steps, and a remote
 *    delete additionally needs an acknowledgement there;
 *  - integrate: merge `develop` into the current branch.
 *
 * The forms only decide: they emit a wire action (`flow-start` /
 * `flow-finish`) that the panel runs through `onAction`, and render the host's
 * error inside the dialog while it runs. Nothing here touches git.
 */
import { createElement as h, Fragment, useEffect, useId, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { KEYS_OWNER_ATTR, KEYS_OWNER_CLASS } from './dialog-focus.js'
import { FlowAboutDiagram, FlowPreviewDiagram } from './flow-diagram.js'
import { BranchIcon, MergeIcon } from './icons.js'
import { selectTrigger } from './select-trigger.js'
import { renderConfirmModal, renderModalFooter, renderModalShell, type OpT } from './ops-modals.js'
import {
  DEVELOP_BRANCH, FLOW_PREFIX, defaultTagName, flowBranchName, flowLane,
  finishFlowPreview, startFlowPreview,
  type FlowFinishRequest, type FlowFinishTargets, type FlowKind,
  type FlowStartRequest, type FlowStrategy,
} from './flow.js'

/** The convention's own vocabulary: these stay English in every UI, as in the
 * reference flow editor (`Feature 名称`), because they name branch prefixes. */
const KIND_LABEL: Record<FlowKind, string> = { feature: 'Feature', hotfix: 'Hotfix', release: 'Release' }
const KIND_SLUG: Record<FlowKind, string> = { feature: 'feature', hotfix: 'hotfix', release: 'release' }

const FEATURE_STRATEGIES: readonly FlowStrategy[] = ['merge', 'squash', 'rebase']
const RELEASE_STRATEGIES: readonly FlowStrategy[] = ['merge', 'squash']

function FlowBranchPicker({ id, label, value, branches, disabled, onChange }: {
  id: string
  label: string
  value: string
  branches: readonly string[]
  disabled: boolean
  onChange: (branch: string) => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const open = expanded && !disabled
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (open || disabled || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    event.preventDefault()
    setExpanded(true)
  }
  return h('div', { className: 'gp-flow__field' }, [
    h('label', { key: 'label', className: 'gp-flow__label', htmlFor: id }, label),
    h('div', { key: 'picker', className: 'gp-flow__branch-picker', onKeyDown, ...(open ? { [KEYS_OWNER_ATTR]: '' } : {}) },
      h(Menu, {
        open, autoFocus: true, portal: true, align: 'start',
        listClassName: KEYS_OWNER_CLASS,
        items: branches.map((branch) => ({ id: branch, label: branch })),
        selectedId: value,
        onClose: () => setExpanded(false),
        onSelect: (branch) => { setExpanded(false); onChange(branch) },
        anchor: selectTrigger(open, value, () => setExpanded((previous) => !previous), {
          id, ariaLabel: `${label} ${value}`, disabled, extraClass: 'gp-flow__select',
        }),
      })),
  ])
}

export interface FlowStartArgs {
  readonly flow: FlowKind
  /** Every local branch, offered as the base. */
  readonly branches: readonly string[]
  readonly defaultBase: string
  /** Branch names already in the checkout: a taken name is refused before
   * anything is sent. */
  readonly existing: readonly string[]
  /** Pre-filled name (a release / hotfix version derived from the tags). */
  readonly initialName?: string
  /** The checkout's remote: the new branch is published there by default. */
  readonly remoteName?: string | null
  /** Existing remote-tracking refs, so a push that creates the branch is marked
   * as new in the legend. */
  readonly remoteBranches?: readonly string[]
  /** Submit is disabled while a write runs. */
  readonly busy?: boolean
  /** The host's refusal, rendered in the form (the dialog stays open). */
  readonly error?: string | null
  readonly onSubmit: (request: FlowStartRequest) => void
  readonly onClose: () => void
  /** The Git panel root: the dialog is confined to it (see panel-root.ts). */
  readonly container?: Element | null
  readonly t: OpT
}

export function renderFlowStartModal(args: FlowStartArgs): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(FlowStartModal, args)
}

function FlowStartModal({ flow, branches, defaultBase, existing, initialName = '', remoteName = null, remoteBranches = [], busy = false, error = null, onSubmit, onClose, container, t }: FlowStartArgs): JSX.Element | null {
  const [name, setName] = useState(initialName)
  const [base, setBase] = useState(defaultBase)
  // Publishing the new branch is the expected end of a start, so the option is
  // on whenever a remote exists. Without one it is disabled and has no effect.
  const [push, setPush] = useState(remoteName !== null)
  // Two panels of one session can be mounted at once (conversation + sidebar),
  // so the label/field ids are per instance rather than fixed strings.
  const uid = useId()
  const nameId = `${uid}-name`
  const baseId = `${uid}-base`
  const branch = flowBranchName(flow, name)
  const taken = branch !== null && existing.includes(branch)
  const invalid = name.trim() !== '' && branch === null
  const kind = KIND_LABEL[flow]
  const hasDevelop = branches.includes(DEVELOP_BRANCH)
  // The dialog's own placeholder keeps the picture readable while the name is
  // still empty; the host still receives a real branch or nothing.
  const shownBranch = branch ?? `${FLOW_PREFIX[flow]}…`
  const pushRefs = remoteName !== null && push ? [`${remoteName}/${shownBranch}`] : null
  const preview = startFlowPreview({ flow, branch: shownBranch, base, hasDevelop, pushRefs })
  const errorText = taken
    ? t('flow.start.exists')
    : invalid ? t('flow.start.invalid') : null
  const intro = flow === 'feature' && !hasDevelop
    ? t('flow.start.initDevelop', { base })
    : t('flow.start.body', { kind: KIND_SLUG[flow], base })
  const confirmDisabled = busy || branch === null || taken || base === ''
  const submit = (): void => {
    if (confirmDisabled || branch === null) return
    onSubmit({
      kind: 'flow-start', flow, branch, base,
      ...(remoteName !== null && push ? { pushRemote: remoteName } : {}),
    })
  }
  return renderModalShell({
    onClose,
    title: t('flow.start.title', { kind }),
    icon: h(BranchIcon, { size: 15 }),
    portalKey: 'flow-start-modal',
    variant: 'gp-modal--flow',
    ...(container != null ? { container, contained: true, trapFocus: true } : {}),
    t,
    body: [
      h('div', { key: 'heading', className: 'gp-flow__heading' }, t('flow.start.heading', { kind: KIND_SLUG[flow] })),
      h('div', { key: 'txt', className: 'gp-modal__confirmtext' }, intro),
      h(FlowPreviewDiagram, { key: 'preview', preview, errorText, remoteName, remoteBranches, t }),
      h('div', { key: 'name', className: 'gp-flow__field' }, [
        h('label', { key: 'l', className: 'gp-flow__label', htmlFor: nameId }, t('flow.start.nameLabel', { kind })),
        h('input', {
          key: 'i', id: nameId, className: 'gp-input',
          placeholder: t('flow.start.namePlaceholder', { kind }),
          value: name, autoFocus: true,
          onChange: (e: { target: { value: string } }) => setName(e.target.value),
          onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') submit() },
        }),
      ]),
      h(FlowBranchPicker, {
        key: 'base', id: baseId, label: t('flow.start.base'), value: base,
        branches, disabled: busy, onChange: setBase,
      }),
      h('label', {
        key: 'push',
        className: `gp-modal__check${remoteName === null ? ' gp-flow__check--off' : ''}`,
        title: remoteName === null ? t('flow.start.pushDisabled') : t('flow.start.pushTitle', { ref: `${remoteName}/${shownBranch}` }),
      }, [
        h('input', {
          key: 'cb', type: 'checkbox', className: 'gp-check',
          checked: remoteName !== null && push, disabled: remoteName === null,
          onChange: () => setPush((v) => !v),
        }),
        t('flow.start.push'),
      ]),
      error !== null ? h('div', { key: 'error', className: 'gp-feedback' }, error) : null,
    ],
    footer: renderModalFooter({
      onClose, onConfirm: submit, confirmLabel: t('flow.start.confirm'),
      confirmDisabled, danger: false, t,
    }),
    ...(busy ? { busy: true, busyLabel: t('flow.start.busy', { kind }) } : {}),
  })
}

export interface FlowFinishArgs {
  readonly flow: FlowKind
  /** The checked-out flow branch (`feature/…`). */
  readonly branch: string
  /** The branch the flow lands on when finished (`develop` or a main line),
   * plus whether that is a choice (a hotfix between `main` and `master`). */
  readonly targets: FlowFinishTargets
  /** Whether the flow branch has an upstream: the remote cleanup is offered
   * only then (nothing would be deleted on the server otherwise). */
  readonly hasUpstream: boolean
  /** The checkout's remote and its tracking branch names, so the push option
   * can say which ref it would publish (and follow the chosen target). */
  readonly remote: { readonly name: string | null; readonly branches: readonly string[] }
  /** Full upstream ref for the finished branch, when the host can delete it. */
  readonly upstreamRef?: string | null
  /** Every local branch, so a chained release name is refused before it is sent. */
  readonly existing?: readonly string[]
  /** The next release version read off the tags (the chained release start). */
  readonly releaseInitialName?: string
  readonly busy?: boolean
  /** The host's refusal, rendered in the form (the dialog stays open). */
  readonly error?: string | null
  readonly onSubmit: (request: FlowFinishRequest) => void
  readonly onClose: () => void
  readonly container?: Element | null
  readonly t: OpT
}

export function renderFlowFinishModal(args: FlowFinishArgs): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(FlowFinishModal, args)
}

function FlowFinishModal({ flow, branch, targets, hasUpstream, remote, upstreamRef = null, existing = [], releaseInitialName = '', busy = false, error = null, onSubmit, onClose, container, t }: FlowFinishArgs): JSX.Element | null {
  const [strategy, setStrategy] = useState<FlowStrategy>('merge')
  const strategies = flow === 'feature' ? FEATURE_STRATEGIES : RELEASE_STRATEGIES
  // The default message is a commit subject, so it follows the UI language and
  // names the branch being finished: `完成 feature/login`, not a fixed
  // `完成 git-flow`.
  const [message, setMessage] = useState(t('flow.finish.messageDefault', { branch }))
  const [target, setTarget] = useState(targets.selected)
  const [deleteBranch, setDeleteBranch] = useState(true)
  // A squash finish leaves the flow branch outside the target's ancestry, so
  // deleting it needs git's forced `-D`. That is a second, explicit decision:
  // the host refuses the delete otherwise and leaves the branch in place.
  const [forceDelete, setForceDelete] = useState(false)
  // Finishing a flow normally means the short-lived branch is gone for good,
  // so the remote cleanup starts checked whenever there is an upstream to
  // delete; without one the option is disabled and the choice has no effect.
  const [deleteRemote, setDeleteRemote] = useState(hasUpstream)
  // Publishing the moved branches is the expected end of a finish, so the push
  // option starts checked; it falls back to off when the remote lacks one of
  // the branches (then the option is disabled anyway).
  const [push, setPush] = useState(true)
  const [tag, setTag] = useState(flow === 'feature' ? '' : defaultTagName(branch))
  // Finishing a feature can immediately start the next release from develop.
  // It is a separate decision, so it starts unchecked; checking it reveals the
  // release name pre-filled with the next version read off the tags.
  const [startRelease, setStartRelease] = useState(false)
  const [releaseName, setReleaseName] = useState(releaseInitialName)
  // The chained release is published separately, and starts checked like a
  // standalone release start: using the option is the decision, and an
  // unpublished release would immediately leave the checkout without a remote
  // counterpart. Without a remote it is disabled and has no effect.
  const [pushRelease, setPushRelease] = useState(true)
  // Finishing runs a multi-step, hard-to-undo sequence (it moves the long-lived
  // branches, tags, deletes and pushes), so 完成 only opens a confirmation that
  // lists the steps; the write itself starts from that confirmation. Deleting
  // the flow branch on the server is unrecoverable, so the confirmation adds an
  // acknowledgement that is what unlocks its button (the branch row's remote
  // delete has the same contract). The button stays disabled after a refusal
  // until the confirmation is dismissed and the form is adjusted.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [ack, setAck] = useState(false)
  const [confirmAttempted, setConfirmAttempted] = useState(false)
  const confirmGuard = useRef(false)
  // The tags query can land after the dialog opened. Keep filling the proposed
  // version until the user edits the name, so opening early does not leave the
  // field empty (and the preview can draw the real branch).
  const releaseEdited = useRef(false)
  useEffect(() => {
    if (!releaseEdited.current && releaseInitialName !== '') setReleaseName(releaseInitialName)
  }, [releaseInitialName])
  const uid = useId()
  const messageId = `${uid}-message`
  const tagId = `${uid}-tag`
  const targetId = `${uid}-target`
  const releaseId = `${uid}-release`
  const kind = KIND_LABEL[flow]
  const slug = KIND_SLUG[flow]
  const needsTag = flow !== 'feature'
  const releaseBranch = flowBranchName('release', releaseName)
  const releaseTaken = releaseBranch !== null && existing.includes(releaseBranch)
  const releaseInvalid = startRelease && (releaseBranch === null || releaseTaken)
  // The branches this finish publishes: the landing branch plus the long-lived
  // branch it is merged back into (a release / hotfix also moves `develop`).
  // A missing remote branch is no reason to disable the push — the same push
  // creates it — so only a checkout without a remote disables the choice.
  const pushBranches = [target, ...targets.backMerge]
  const movedPushRefs = remote.name !== null
    ? [
      ...pushBranches.map((name) => `${remote.name}/${name}`),
      ...(needsTag && tag.trim() !== '' ? [`refs/tags/${tag.trim()}`] : []),
    ]
    : null
  // The chained release branch is new, so its push only needs a configured
  // remote; it is its own checkbox and starts unchecked. The preview uses the
  // placeholder too, so checking the push shows a change before a version is
  // typed (the wire still only carries a real branch).
  const releasePushPreviewRef = flow === 'feature' && startRelease && remote.name !== null && pushRelease
    ? [`${remote.name}/${releaseBranch ?? 'release/…'}`]
    : null
  const releasePushRef = flow === 'feature' && startRelease && releaseBranch !== null && remote.name !== null && pushRelease
    ? [`${remote.name}/${releaseBranch}`]
    : null
  const previewPushRefs = [
    ...(movedPushRefs !== null && push ? movedPushRefs : []),
    ...(releasePushPreviewRef ?? []),
  ]
  const upstreamLabel = upstreamRef?.replace(/^refs\/remotes\//, '') ?? null
  const remoteLabel = upstreamLabel ?? (remote.name === null ? branch : `${remote.name}/${branch}`)
  // The remote cleanup is armed by the checkbox; the confirmation it needs is
  // part of the one finish confirmation, not a second layer.
  const remoteArmed = hasUpstream && deleteRemote
  const send = (): void => {
    onSubmit({
      kind: 'flow-finish', flow, branch, target, strategy, message: message.trim(), deleteBranch, deleteRemote,
      ...(movedPushRefs !== null && push ? { pushRemote: remote.name! } : {}),
      forceDelete: strategy === 'squash' && forceDelete,
      ...(needsTag ? { tag: tag.trim() } : {}),
      ...(flow === 'feature' && startRelease && releaseBranch !== null ? { startRelease: releaseBranch } : {}),
      ...(releasePushRef !== null ? { releasePushRemote: remote.name! } : {}),
    })
  }
  const submit = (): void => {
    if (busy) return
    confirmGuard.current = false
    setAck(false)
    setConfirmAttempted(false)
    setConfirmOpen(true)
  }
  const confirmFinish = (): void => {
    if (confirmGuard.current || busy) return
    confirmGuard.current = true
    setConfirmAttempted(true)
    send()
  }
  const strategyLabel: Record<FlowStrategy, string> = {
    merge: t('flow.finish.strategyMerge'),
    squash: t('flow.finish.strategySquash'),
    rebase: t('flow.finish.strategyRebase', { target }),
  }
  const releaseError = !startRelease
    ? null
    : releaseTaken ? t('flow.start.exists') : releaseName.trim() !== '' && releaseBranch === null ? t('flow.start.invalid') : null
  const errorText = needsTag && tag.trim() === '' ? t('flow.preview.tagRequired') : releaseError
  const preview = finishFlowPreview({
    flow,
    branch,
    target,
    backMerge: targets.backMerge,
    strategy,
    tag: needsTag ? tag : '',
    deleteBranch,
    deleteRemote: hasUpstream && deleteRemote,
    pushRefs: previewPushRefs.length > 0 ? previewPushRefs : null,
    remoteName: remote.name,
    remoteDeleteRef: upstreamRef,
    forceDelete: strategy === 'squash' && forceDelete,
    startRelease: flow === 'feature' && startRelease ? (releaseBranch ?? 'release/…') : null,
  })
  // The confirmation is the review the form cannot be: it restates the exact
  // steps the pressed 完成 will run, and after any refusal its error is the
  // only copy of the reason, so it stays open over the form.
  const confirmSteps: string[] = [
    strategy === 'merge'
      ? t('flow.finish.confirmMerge', { branch, target })
      : strategy === 'squash'
        ? t('flow.finish.confirmSquash', { branch, target })
        : t('flow.finish.confirmRebase', { branch, target }),
  ]
  if (needsTag && tag.trim() !== '') confirmSteps.push(t('flow.finish.confirmTag', { target, tag: tag.trim() }))
  if (needsTag && targets.backMerge.length > 0) {
    confirmSteps.push(t('flow.finish.confirmBackMerge', { target, back: targets.backMerge.join(' + ') }))
  }
  if (deleteBranch) confirmSteps.push(t('flow.finish.confirmDeleteBranch', { branch }))
  if (remoteArmed) confirmSteps.push(t('flow.finish.confirmDeleteRemote', { ref: remoteLabel }))
  if (movedPushRefs !== null && push) confirmSteps.push(t('flow.finish.confirmPush', { refs: movedPushRefs.join(' + ') }))
  if (flow === 'feature' && startRelease) {
    confirmSteps.push(t('flow.finish.confirmStartRelease', { develop: DEVELOP_BRANCH, release: releaseBranch ?? 'release/…' }))
  }
  if (releasePushRef !== null) confirmSteps.push(t('flow.finish.confirmPushRelease', { ref: releasePushRef[0]! }))
  const confirmBody = `${t('flow.finish.confirmBody', { branch })}\n\n${confirmSteps.map((step) => `• ${step}`).join('\n')}`
  const form = renderModalShell({
    onClose,
    title: t('flow.finish.title', { kind }),
    icon: h(MergeIcon, { size: 15 }),
    portalKey: 'flow-finish-modal',
    variant: 'gp-modal--flow',
    ...(container != null ? { container, contained: true, trapFocus: true } : {}),
    t,
    body: [
      h('div', { key: 'heading', className: 'gp-flow__heading' }, t('flow.finish.heading', { branch })),
      h(FlowPreviewDiagram, { key: 'preview', preview, errorText, remoteName: remote.name, remoteBranches: remote.branches, t }),
      h('div', { key: 'modes', className: 'gp-flow__modes', role: 'radiogroup', 'aria-label': t('flow.finish.strategy') }, strategies.map((value) =>
        h('label', { key: value, className: 'gp-flow__mode' }, [
          h('input', {
            key: 'r', type: 'radio', name: `${uid}-strategy`, className: 'gp-check',
            checked: strategy === value, onChange: () => setStrategy(value),
          }),
          h('span', { key: 'l' }, strategyLabel[value]),
        ]))),
      // Where the work lands. Only a hotfix can pick (a checkout keeping both
      // `main` and `master`); the legend already names a fixed target, so a
      // control that cannot change is not rendered.
      targets.editable
        ? h(FlowBranchPicker, {
          key: 'target', id: targetId, label: t('flow.finish.target'), value: target,
          branches: targets.options, disabled: busy || confirmOpen, onChange: setTarget,
        })
        : null,
      h('div', { key: 'msg', className: 'gp-flow__field gp-flow__field--stack' }, [
        h('label', { key: 'l', className: 'gp-flow__label', htmlFor: messageId }, t('flow.finish.message')),
        h('textarea', {
          key: 'i', id: messageId, className: 'gp-input gp-input--area',
          value: message, onChange: (e: { target: { value: string } }) => setMessage(e.target.value),
        }),
      ]),
      needsTag ? h('div', { key: 'tag', className: 'gp-flow__field' }, [
        h('label', { key: 'l', className: 'gp-flow__label', htmlFor: tagId }, t('flow.finish.tag')),
        h('input', {
          key: 'i', id: tagId, className: 'gp-input',
          placeholder: t('flow.finish.tagPlaceholder'),
          value: tag, onChange: (e: { target: { value: string } }) => setTag(e.target.value),
        }),
      ]) : null,
      h('label', { key: 'del', className: 'gp-modal__check' }, [
        h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: deleteBranch, onChange: () => setDeleteBranch((v) => !v) }),
        t('flow.finish.deleteBranch', { kind: slug }),
      ]),
      // Squash integration: the branch's commits are not in the target's
      // ancestry, so the delete is a forced `-D` and asks for its own
      // acknowledgement (the same contract as the branch-delete dialog).
      strategy === 'squash' && deleteBranch
        ? h('label', { key: 'force', className: 'gp-modal__check' }, [
          h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: forceDelete, onChange: () => setForceDelete((v) => !v) }),
          t('flow.finish.forceDelete'),
        ])
        : null,
      h('label', { key: 'remote', className: `gp-modal__check${hasUpstream ? '' : ' gp-flow__check--off'}`, title: hasUpstream ? undefined : t('flow.finish.remoteDisabled') }, [
        h('input', {
          key: 'cb', type: 'checkbox', className: 'gp-check',
          checked: hasUpstream && deleteRemote, disabled: !hasUpstream,
          onChange: () => setDeleteRemote((v) => !v),
        }),
        t('flow.finish.deleteRemote', { kind: slug }),
      ]),
      // Push the branches the finish moved to their remote. On by default:
      // finishing the flow is expected to publish the long-lived branches it
      // moved; unchecking keeps the finish local.
      h('label', { key: 'push', className: `gp-modal__check${movedPushRefs === null ? ' gp-flow__check--off' : ''}`, title: movedPushRefs === null ? t('flow.finish.pushDisabled') : undefined }, [
        h('input', {
          key: 'cb', type: 'checkbox', className: 'gp-check',
          checked: movedPushRefs !== null && push, disabled: movedPushRefs === null,
          onChange: () => setPush((v) => !v),
        }),
        t('flow.finish.push', { ref: movedPushRefs?.join(' + ') ?? target }),
      ]),
      // Starting the next release is an extra follow-up, so it sits last among
      // the finish choices. Only a feature has one: it lands on develop, which
      // is exactly where `release/…` branches from.
      flow === 'feature'
        ? h('label', { key: 'start-release', className: 'gp-modal__check' }, [
          h('input', {
            key: 'cb', type: 'checkbox', className: 'gp-check',
            checked: startRelease, onChange: () => setStartRelease((v) => !v),
          }),
          t('flow.finish.startRelease'),
        ])
        : null,
      flow === 'feature' && startRelease
        ? h('div', { key: 'release', className: 'gp-flow__field' }, [
          h('label', { key: 'l', className: 'gp-flow__label', htmlFor: releaseId }, t('flow.finish.releaseName')),
          h('input', {
            key: 'i', id: releaseId, className: 'gp-input',
            placeholder: t('flow.finish.releaseNamePlaceholder'),
            value: releaseName,
            onChange: (e: { target: { value: string } }) => {
              releaseEdited.current = true
              setReleaseName(e.target.value)
            },
          }),
        ])
        : null,
      flow === 'feature' && startRelease
        ? h('label', {
          key: 'push-release',
          className: `gp-modal__check${remote.name === null ? ' gp-flow__check--off' : ''}`,
          title: remote.name === null
            ? t('flow.start.pushDisabled')
            : t('flow.start.pushTitle', { ref: `${remote.name}/${releaseBranch ?? 'release/…'}` }),
        }, [
          h('input', {
            key: 'cb', type: 'checkbox', className: 'gp-check',
            checked: remote.name !== null && pushRelease,
            disabled: remote.name === null,
            onChange: () => setPushRelease((v) => !v),
          }),
          t('flow.finish.pushRelease'),
        ])
        : null,
      error !== null ? h('div', { key: 'error', className: 'gp-feedback' }, error) : null,
    ],
    footer: renderModalFooter({
      onClose, onConfirm: submit, confirmLabel: t('flow.finish.confirm'),
      confirmDisabled: busy || (needsTag && tag.trim() === '') || releaseInvalid || (strategy === 'squash' && deleteBranch && !forceDelete),
      // A finish that deletes a branch (local or remote) is destructive even
      // while its choices stay reversible: paint 完成 in the danger tone so the
      // row reads as such before the confirmation appears.
      danger: deleteBranch || remoteArmed, t,
    }),
    ...(busy ? { busy: true, busyLabel: t('flow.finish.busy', { kind }) } : {}),
  })
  // The finish confirmation sits above the form: the panel's dialog is
  // contained, so the confirmation must stay inside the same root (`contained`)
  // and trap focus on its own. Escape / the backdrop close only this layer; the
  // form behind it keeps its state for another try. While the write runs it is
  // busy (not dismissible) and a refusal renders here too.
  const finishConfirm = confirmOpen
    ? renderConfirmModal({
      title: t('flow.finish.confirmTitle', { kind }),
      body: confirmBody,
      // Only the remote deletion is unrecoverable and needs its own
      // acknowledgement; the rest of the steps are what the form just showed.
      extra: remoteArmed
        ? h('div', { key: 'x', className: 'gp-bpick__extra' }, [
          h('div', { key: 'warn', className: 'gp-bpick__warn' }, t('remoteBranchDelete.warning')),
          h('label', { key: 'ack', className: 'gp-modal__check' }, [
            h('input', {
              key: 'cb', type: 'checkbox', className: 'gp-check',
              checked: ack, onChange: () => setAck((v) => !v),
            }),
            t('remoteBranchDelete.ack'),
          ]),
        ])
        : null,
      confirmLabel: t('flow.finish.confirmAction'),
      danger: deleteBranch || remoteArmed,
      error,
      confirmBusy: busy,
      // The remote delete's acknowledgement is the unlock; after a refusal the
      // form must be adjusted, so the button stays locked until it is dismissed.
      confirmDisabled: (remoteArmed && !ack) || (confirmAttempted && error !== null),
      busyLabel: t('flow.finish.busy', { kind }),
      onConfirm: confirmFinish,
      onClose: () => { setConfirmOpen(false); setAck(false); setConfirmAttempted(false) },
      ...(container != null ? { container, contained: true, trapFocus: true } : {}),
      t,
    })
    : null
  return h(Fragment, null, [form, finishConfirm])
}

export interface FlowIntegrateArgs {
  readonly develop: string
  readonly current: string | null
  readonly dirty: boolean
  readonly busy?: boolean
  /** The host's refusal, rendered in the confirm body. */
  readonly error?: string | null
  readonly onSubmit: () => void
  readonly onClose: () => void
  readonly container?: Element | null
  readonly t: OpT
}

/** `整合开发`: merge `develop` into the current branch. It moves the work tree
 * and can conflict, so it keeps the same confirmation contract as a merge. */
export function renderFlowIntegrateModal({ develop, current, dirty, busy = false, error = null, onSubmit, onClose, container, t }: FlowIntegrateArgs): JSX.Element | null {
  return renderConfirmModal({
    title: t('flow.integrate.title'),
    body: t('flow.integrate.body', { develop, current: current ?? t('switch.detached') })
      + (dirty ? `\n\n${t('flow.integrate.dirty')}` : ''),
    extra: current === null ? null : h(FlowPreviewDiagram, {
      key: 'preview', t,
      preview: {
        routes: [{
          from: { name: develop, lane: flowLane(develop), state: 'existing' },
          to: { name: current, lane: flowLane(current), state: 'existing' },
          action: 'merge',
        }],
        ops: [], createsDevelop: false,
      },
      mergeLabel: t('flow.integrate.title'),
    }),
    confirmLabel: t('flow.integrate.confirm'),
    danger: false,
    error,
    confirmBusy: busy,
    confirmDisabled: busy,
    onConfirm: onSubmit,
    onClose,
    ...(container != null ? { container, contained: true, trapFocus: true } : {}),
    t,
  })
}

export interface FlowAboutArgs {
  readonly container?: Element | null
  readonly onClose: () => void
  /** Switches the plugin's Git Flow entries off. Absent when the settings form
   * is unreachable (no `configForms` service), where the dialog offers no
   * switch-off button instead of one that cannot write. */
  readonly onDisableFlow?: () => Promise<boolean>
  readonly t: OpT
}

/**
 * How the three Git Flow branch types move through this panel, plus the
 * switch-off for the entries. Switching them off is a preference write, not a
 * repository write, so it asks once for confirmation and reports the way back
 * (the plugin's settings form) instead of promising an undo in this dialog.
 */
export function renderFlowAboutModal(args: FlowAboutArgs): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(FlowAboutModal, args)
}

function FlowAboutModal({ container, onClose, onDisableFlow, t }: FlowAboutArgs): JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmDisable = (): void => {
    if (onDisableFlow === undefined || busy) return
    setBusy(true)
    setError(null)
    const failed = (): void => { setBusy(false); setError(t('flow.about.disableFailed')) }
    onDisableFlow().then((ok) => { if (ok) onClose(); else failed() }, failed)
  }
  const about = renderModalShell({
    onClose,
    title: t('flow.about.heading'),
    icon: h(MergeIcon, { size: 15 }),
    portalKey: 'flow-about-modal',
    variant: 'gp-modal--flow gp-modal--flow-about',
    ...(container != null ? { container, contained: true, trapFocus: true } : {}),
    t,
    body: [
      h('p', { key: 'intro', className: 'gp-flow-about__intro' }, t('flow.about.intro')),
      h('dl', { key: 'long-lived', className: 'gp-flow-about__branches' }, [
        h('div', { key: 'main' }, [
          h('dt', { key: 'name' }, h('code', null, 'main / master')),
          h('dd', { key: 'detail' }, t('flow.about.main')),
        ]),
        h('div', { key: 'develop' }, [
          h('dt', { key: 'name' }, h('code', null, 'develop')),
          h('dd', { key: 'detail' }, t('flow.about.develop')),
        ]),
      ]),
      h(FlowAboutDiagram, { key: 'diagram', t }),
    ],
    footer: h('div', { key: 'footer', className: 'gp-modal__footer gp-flow-about__footer' }, [
      h('a', {
        key: 'source', className: 'gp-flow-about__source', target: '_blank', rel: 'noreferrer',
        href: 'https://nvie.com/posts/a-successful-git-branching-model/',
      }, t('flow.about.source'), h('span', { 'aria-hidden': true }, '↗')),
      h('div', { key: 'actions', className: 'gp-flow-about__actions' }, [
        // Only offered when the settings service is reachable: the switch lives
        // in the plugin's config, and a button that cannot write would lie.
        onDisableFlow === undefined
          ? null
          : h('button', {
            key: 'disable', type: 'button', className: 'gp-btn', onClick: () => { setError(null); setConfirming(true) },
          }, t('flow.about.disable')),
        h('button', { key: 'close', type: 'button', className: 'gp-btn gp-btn--primary', onClick: onClose }, t('common.close')),
      ]),
    ]),
  })
  // The confirmation is its own layer above the guide: closing it returns to
  // the guide untouched, and the switch-off keeps it open while it writes so its
  // error has somewhere to render.
  const confirmLayer = confirming
    ? renderConfirmModal({
      title: t('flow.about.disableTitle'),
      body: t('flow.about.disableBody'),
      confirmLabel: t('flow.about.disableConfirm'),
      danger: false,
      error,
      confirmBusy: busy,
      busyLabel: t('flow.about.disableBusy'),
      onConfirm: confirmDisable,
      onClose: () => { if (!busy) { setConfirming(false); setError(null) } },
      ...(container != null ? { container, contained: true, trapFocus: true } : {}),
      t,
    })
    : null
  return h(Fragment, null, [about, confirmLayer])
}
