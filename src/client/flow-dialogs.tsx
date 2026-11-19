/**
 * Git Flow dialogs, opened from the branch list's `Git Flow` menu:
 *  - start: name a feature / hotfix / release and pick its base;
 *  - finish: pick how the current flow branch is integrated (merge commit,
 *    squash, rebase), the message, and whether the branch (and its remote) is
 *    deleted;
 *  - integrate: merge `develop` into the current branch.
 *
 * The forms only decide: they emit a wire action (`flow-start` /
 * `flow-finish`) that the panel runs through `onAction`, and render the host's
 * error inside the dialog while it runs. Nothing here touches git.
 */
import { createElement as h, useEffect, useId, useRef, useState } from 'react'
import type { JSX } from 'react'
import { BranchIcon, MergeIcon } from './icons.js'
import { renderConfirmModal, renderModalFooter, renderModalShell, type OpT } from './ops-modals.js'
import {
  DEVELOP_BRANCH, FLOW_PREFIX, defaultTagName, flowBranchName, flowPreviewChain, flowPreviewRemotes,
  finishFlowPreview, startFlowPreview,
  type FlowFinishRequest, type FlowFinishTargets, type FlowKind, type FlowPreview,
  type FlowPreviewNode, type FlowStartRequest, type FlowStrategy,
} from './flow.js'

/** The convention's own vocabulary: these stay English in every UI, as in the
 * reference flow editor (`Feature 名称`), because they name branch prefixes. */
const KIND_LABEL: Record<FlowKind, string> = { feature: 'Feature', hotfix: 'Hotfix', release: 'Release' }
const KIND_SLUG: Record<FlowKind, string> = { feature: 'feature', hotfix: 'hotfix', release: 'release' }

const STRATEGIES: readonly FlowStrategy[] = ['merge', 'squash', 'rebase']

/** One branch pill. The optional tag rides inside the pill, right-aligned, so
 * the tag stays attached to the branch it was created on. */
function previewNode(node: FlowPreviewNode, key: string, extra = '', tag?: string): JSX.Element {
  const state = node.state === 'created'
    ? ' gp-flow-map__node--new'
    : node.state === 'deleted' ? ' gp-flow-map__node--gone' : ''
  return h('span', {
    key,
    className: `gp-flow-map__node gp-flow-map__node--${node.lane}${state}${extra === '' ? '' : ` ${extra}`}`,
    title: node.name,
  }, [
    h('i', { key: 'dot', className: 'gp-flow-map__dot' }),
    h('span', { key: 'name', className: 'gp-flow-map__name' }, node.name),
    tag === undefined
      ? null
      : h('span', { key: 'tag', className: 'gp-flow-map__tag gp-flow-map__tag--node' }, [
        h('span', { key: 'hash', className: 'gp-flow-map__tag-hash' }, '#'),
        tag,
      ]),
  ])
}

/** The local branches as one left-to-right chain, with pushed / deleted remote
 * branches hanging under their own branch. Every edge is the same animated
 * connector; the form below owns the strategy wording. A pushed ref the remote
 * does not have yet is drawn as a new (dashed) node. */
function flowChain(preview: FlowPreview, remoteName: string | null, remoteBranches: ReadonlySet<string>, t: OpT): JSX.Element {
  const nodes = flowPreviewChain(preview.routes)
  const remotes = new Map(flowPreviewRemotes(preview.ops, remoteName).map((remote) => [remote.branch, remote]))
  const hasRemote = nodes.some((node) => remotes.has(node.name))
  const children: JSX.Element[] = []
  nodes.forEach((node, index) => {
    const tag = preview.routes.find((route) => route.to.name === node.name)?.tag
    const remote = remotes.get(node.name)
    const edge = `${index === 0 ? ' gp-flow-chain__col--first' : ''}${index === nodes.length - 1 ? ' gp-flow-chain__col--last' : ''}`
    children.push(h('div', { key: `col-${index}`, className: `gp-flow-chain__col${edge}` }, [
      previewNode(node, 'local', '', tag),
      hasRemote
        ? (remote === undefined
          ? h('span', { key: 'v', className: 'gp-flow-chain__v gp-flow-chain__v--none' })
          : h('span', {
            key: 'v',
            className: `gp-flow-chain__v${remote.deleted ? ' gp-flow-chain__v--del' : ''}`,
            'aria-hidden': 'true',
          }))
        : null,
      hasRemote
        ? (remote === undefined
          ? h('span', { key: 'empty', className: 'gp-flow-chain__empty' })
          : previewNode({
            name: remote.ref,
            lane: 'other',
            // A push of a branch the remote does not have yet creates it.
            state: remote.deleted ? 'deleted' : remoteBranches.has(remote.ref) ? 'existing' : 'created',
          }, 'remote', 'gp-flow-map__node--remote'))
        : null,
    ]))
    if (index < nodes.length - 1) {
      children.push(h('span', { key: `h-${index}`, className: 'gp-flow-chain__h', 'aria-hidden': 'true' }))
    }
  })
  return h('div', { className: `gp-flow-chain gp-flow-chain--${nodes.length}`, role: 'group', 'aria-label': t('flow.preview.title') }, children)
}

/** The change preview both flow dialogs render: the branch chain, plus the
 * form's own error when the input cannot be submitted. */
function renderFlowPreview(card: {
  readonly preview: FlowPreview
  /** A validation error (taken name / invalid name / empty tag); normal states
   * show no explanatory line under the graph. */
  readonly errorText?: string | null
  /** The checkout's remote name, for splitting `origin/<branch>` refs. */
  readonly remoteName?: string | null
  /** Existing remote-tracking refs, so a pushed ref that does not exist yet is
   * drawn as new. */
  readonly remoteBranches?: readonly string[]
  readonly t: OpT
}): JSX.Element {
  return h('div', {
    className: 'gp-flow-map', role: 'group', 'aria-label': card.t('flow.preview.title'),
  }, [
    h('div', { key: 'head', className: 'gp-flow-map__head' }, [
      h('span', { key: 'title', className: 'gp-flow-map__title' }, card.t('flow.preview.title')),
    ]),
    flowChain(card.preview, card.remoteName ?? null, new Set(card.remoteBranches ?? []), card.t),
    card.errorText === undefined || card.errorText === null || card.errorText === ''
      ? null
      : h('div', { key: 'error', className: 'gp-flow-map__note gp-flow-map__note--error', role: 'alert' }, [
        h('b', { key: 'mark' }, '!'),
        card.errorText,
      ]),
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
      h(renderFlowPreview, { key: 'preview', preview, errorText, remoteName, remoteBranches, t }),
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
      h('div', { key: 'base', className: 'gp-flow__field' }, [
        h('label', { key: 'l', className: 'gp-flow__label', htmlFor: baseId }, t('flow.start.base')),
        h('select', {
          key: 's', id: baseId, className: 'gp-input gp-flow__select', value: base,
          onChange: (e: { target: { value: string } }) => setBase(e.target.value),
        }, branches.map((b) => h('option', { key: b, value: b }, b))),
      ]),
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
    ...(busy ? { busy: true } : {}),
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

function FlowFinishModal({ flow, branch, targets, hasUpstream, remote, existing = [], releaseInitialName = '', busy = false, error = null, onSubmit, onClose, container, t }: FlowFinishArgs): JSX.Element | null {
  const [strategy, setStrategy] = useState<FlowStrategy>('merge')
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
  // The chained release is published separately, and only when asked: finishing
  // a feature should not silently create a remote release branch.
  const [pushRelease, setPushRelease] = useState(false)
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
    ? pushBranches.map((name) => `${remote.name}/${name}`)
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
  const submit = (): void => {
    if (busy) return
    onSubmit({
      kind: 'flow-finish', flow, branch, target, strategy, message: message.trim(), deleteBranch, deleteRemote,
      ...(movedPushRefs !== null && push ? { pushRemote: remote.name! } : {}),
      forceDelete: strategy === 'squash' && forceDelete,
      ...(needsTag ? { tag: tag.trim() } : {}),
      ...(flow === 'feature' && startRelease && releaseBranch !== null ? { startRelease: releaseBranch } : {}),
      ...(releasePushRef !== null ? { releasePushRemote: remote.name! } : {}),
    })
  }
  const strategyLabel: Record<FlowStrategy, string> = {
    merge: t('flow.finish.strategyMerge'),
    squash: t('flow.finish.strategySquash'),
    rebase: t('flow.finish.strategyRebase', { target }),
  }
  // The card only carries the graph; the strategy wording lives in the radio
  // list and its existing labels, not in a second sentence under the branches.
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
    forceDelete: strategy === 'squash' && forceDelete,
    startRelease: flow === 'feature' && startRelease ? (releaseBranch ?? 'release/…') : null,
  })
  return renderModalShell({
    onClose,
    title: t('flow.finish.title', { kind }),
    icon: h(MergeIcon, { size: 15 }),
    portalKey: 'flow-finish-modal',
    variant: 'gp-modal--flow',
    ...(container != null ? { container, contained: true, trapFocus: true } : {}),
    t,
    body: [
      h('div', { key: 'heading', className: 'gp-flow__heading' }, t('flow.finish.heading', { branch })),
      h(renderFlowPreview, { key: 'preview', preview, errorText, remoteName: remote.name, remoteBranches: remote.branches, t }),
      h('div', { key: 'modes', className: 'gp-flow__modes', role: 'radiogroup', 'aria-label': t('flow.finish.strategy') }, STRATEGIES.map((value) =>
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
        ? h('div', { key: 'target', className: 'gp-flow__field' }, [
          h('label', { key: 'l', className: 'gp-flow__label', htmlFor: targetId }, t('flow.finish.target')),
          h('select', {
            key: 's', id: targetId, className: 'gp-input gp-flow__select', value: target,
            onChange: (e: { target: { value: string } }) => setTarget(e.target.value),
          }, targets.options.map((name) => h('option', { key: name, value: name }, name))),
        ])
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
      confirmDisabled: busy || (needsTag && tag.trim() === '') || releaseInvalid || (strategy === 'squash' && deleteBranch && !forceDelete), danger: false, t,
    }),
    ...(busy ? { busy: true } : {}),
  })
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

/** One stroked branch line; `merge` draws the dashed integration edge. */
function graphPath(key: string, lane: string, d: string, merge = false): JSX.Element {
  return h('path', {
    key, d,
    className: `gp-flow-graph__path gp-flow-graph__path--${lane}${merge ? ' gp-flow-graph__path--merge' : ''}`,
  })
}

function graphDot(key: string, lane: string, cx: number, cy: number): JSX.Element {
  return h('circle', { key, cx, cy, r: 3.5, className: `gp-flow-graph__dot gp-flow-graph__dot--${lane}` })
}

function graphLabel(key: string, lane: string, y: number, text: string): JSX.Element {
  return h('text', {
    key, x: 2, y: y + 3,
    className: `gp-flow-graph__label gp-flow-graph__label--${lane}`,
  }, text)
}

/**
 * The branch topology as one inline SVG: five lanes, long-lived branches as
 * solid lines, short-lived ones leaving and returning, and dashed edges for the
 * extra integration a release / hotfix performs. Lane names ride the left edge
 * so the picture reads without a legend.
 */
function FlowGraph({ t }: { readonly t: OpT }): JSX.Element {
  return h('svg', {
    className: 'gp-flow-graph',
    viewBox: '0 0 560 270',
    role: 'img',
    'aria-label': t('flow.about.diagramAlt'),
  }, [
    graphLabel('l-hotfix', 'hotfix', 26, 'hotfix/*'),
    graphLabel('l-main', 'main', 80, 'main/master'),
    graphLabel('l-release', 'release', 134, 'release/*'),
    graphLabel('l-develop', 'develop', 188, 'develop'),
    graphLabel('l-feature', 'feature', 242, 'feature/*'),
    graphPath('p-main', 'main', 'M100 80 H540'),
    graphPath('p-develop', 'develop', 'M100 188 H540'),
    // feature/* leaves develop, collects two commits and merges back.
    graphPath('p-feature', 'feature', 'M120 188 L120 224 Q120 242 138 242 H202 Q220 242 220 224 L220 188'),
    // release/* leaves develop, merges back into develop, and also into main.
    graphPath('p-release', 'release', 'M260 188 L260 152 Q260 134 278 134 H332 Q350 134 350 152 L350 188'),
    graphPath('p-release-main', 'release', 'M326 134 L360 80', true),
    // hotfix/* leaves main, merges into main and then into develop.
    graphPath('p-hotfix', 'hotfix', 'M420 80 L420 44 Q420 26 438 26 H468'),
    graphPath('p-hotfix-main', 'hotfix', 'M468 26 L505 80', true),
    graphPath('p-hotfix-develop', 'hotfix', 'M468 26 L480 188', true),
    graphDot('d-main-1', 'main', 110, 80),
    graphDot('d-main-2', 'main', 360, 80),
    graphDot('d-main-3', 'main', 505, 80),
    graphDot('d-develop-1', 'develop', 110, 188),
    graphDot('d-develop-2', 'develop', 150, 188),
    graphDot('d-develop-3', 'develop', 220, 188),
    graphDot('d-develop-4', 'develop', 300, 188),
    graphDot('d-develop-5', 'develop', 350, 188),
    graphDot('d-develop-6', 'develop', 480, 188),
    graphDot('d-feature-1', 'feature', 150, 242),
    graphDot('d-feature-2', 'feature', 185, 242),
    graphDot('d-release-1', 'release', 292, 134),
    graphDot('d-release-2', 'release', 326, 134),
    graphDot('d-hotfix-1', 'hotfix', 446, 26),
    graphDot('d-hotfix-2', 'hotfix', 468, 26),
    // The release tag sits on main; the version is an illustration, not data.
    h('text', { key: 'tag', x: 360, y: 66, textAnchor: 'middle', className: 'gp-flow-graph__tag' }, 'v1.0'),
  ])
}

export interface FlowAboutArgs {
  readonly container?: Element | null
  readonly onClose: () => void
  readonly t: OpT
}

/** `什么是 Git Flow`: the model in two paragraphs plus the branch diagram. */
export function renderFlowAboutModal({ container, onClose, t }: FlowAboutArgs): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return renderModalShell({
    onClose,
    title: t('flow.about.title'),
    icon: h(MergeIcon, { size: 15 }),
    portalKey: 'flow-about-modal',
    variant: 'gp-modal--flow',
    ...(container != null ? { container, contained: true, trapFocus: true } : {}),
    t,
    body: [
      h('div', { key: 'heading', className: 'gp-flow__heading' }, t('flow.about.heading')),
      h('div', { key: 'intro', className: 'gp-modal__confirmtext' }, t('flow.about.intro')),
      h(FlowGraph, { key: 'graph', t }),
      h('div', { key: 'detail', className: 'gp-modal__confirmtext gp-flow__about-detail' },
        t('flow.about.detail').split('\n').map((line, index) =>
          h('div', { key: index, className: 'gp-flow__about-line' }, line))),
    ],
    footer: h('div', { key: 'footer', className: 'gp-modal__footer' }, [
      h('button', { key: 'close', type: 'button', className: 'gp-btn gp-btn--primary', onClick: onClose }, t('common.close')),
    ]),
  })
}

