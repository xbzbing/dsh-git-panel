/**
 * Git Flow dialogs, opened from the branch list's `Git Flow` menu:
 *  - start: name a feature / hotfix / release and pick its base;
 *  - finish: pick how the current flow branch is integrated (merge commit,
 *    squash, rebase), the message, and whether the branch (and its remote) is
 *    deleted;
 *  - integrate: merge `develop` into the current branch.
 *
 * They are the shell of the feature: the forms decide and emit a FlowRequest,
 * and the write path that runs it arrives with the host actions. Until a
 * runner is wired, the dialog says so after submit and changes nothing —
 * never a button that silently does nothing.
 */
import { createElement as h, useId, useState } from 'react'
import type { JSX } from 'react'
import { BranchIcon, MergeIcon } from './icons.js'
import { renderConfirmModal, renderModalFooter, renderModalShell, type OpT } from './ops-modals.js'
import {
  DEVELOP_BRANCH, defaultTagName, flowBranchName,
  type FlowFinishRequest, type FlowFinishTargets, type FlowKind, type FlowStartRequest, type FlowStrategy,
} from './flow.js'

/** The convention's own vocabulary: these stay English in every UI, as in the
 * reference flow editor (`Feature 名称`), because they name branch prefixes. */
const KIND_LABEL: Record<FlowKind, string> = { feature: 'Feature', hotfix: 'Hotfix', release: 'Release' }
const KIND_SLUG: Record<FlowKind, string> = { feature: 'feature', hotfix: 'hotfix', release: 'release' }

const STRATEGIES: readonly FlowStrategy[] = ['merge', 'squash', 'rebase']

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
  /** Submit is disabled while a write runs. */
  readonly busy?: boolean
  /** The execution is not wired yet (shell phase): shown after submit. */
  readonly pending?: boolean
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

function FlowStartModal({ flow, branches, defaultBase, existing, initialName = '', busy = false, pending = false, onSubmit, onClose, container, t }: FlowStartArgs): JSX.Element | null {
  const [name, setName] = useState(initialName)
  const [base, setBase] = useState(defaultBase)
  // Two panels of one session can be mounted at once (conversation + sidebar),
  // so the label/field ids are per instance rather than fixed strings.
  const uid = useId()
  const nameId = `${uid}-name`
  const baseId = `${uid}-base`
  const branch = flowBranchName(flow, name)
  const taken = branch !== null && existing.includes(branch)
  const invalid = name.trim() !== '' && branch === null
  const kind = KIND_LABEL[flow]
  const confirmDisabled = busy || branch === null || taken || base === ''
  const submit = (): void => {
    if (confirmDisabled || branch === null) return
    onSubmit({ flow, branch, base })
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
      h('div', { key: 'txt', className: 'gp-modal__confirmtext' }, t('flow.start.body', { kind: KIND_SLUG[flow], base })),
      // The first feature start creates `develop` from the chosen base: the
      // dialog says so rather than claiming the flow branches off the base
      // directly.
      flow === 'feature' && !branches.includes(DEVELOP_BRANCH)
        ? h('div', { key: 'init', className: 'gp-flow__hint' }, t('flow.start.initDevelop', { base }))
        : null,
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
      h('div', { key: 'preview', className: 'gp-flow__preview' },
        t('flow.start.result', { branch: branch ?? '—' })),
      h('div', { key: 'base', className: 'gp-flow__field' }, [
        h('label', { key: 'l', className: 'gp-flow__label', htmlFor: baseId }, t('flow.start.base')),
        h('select', {
          key: 's', id: baseId, className: 'gp-input gp-flow__select', value: base,
          onChange: (e: { target: { value: string } }) => setBase(e.target.value),
        }, branches.map((b) => h('option', { key: b, value: b }, b))),
      ]),
      taken ? h('div', { key: 'taken', className: 'gp-feedback' }, t('flow.start.exists')) : null,
      invalid ? h('div', { key: 'invalid', className: 'gp-feedback' }, t('flow.start.invalid')) : null,
      pending ? h('div', { key: 'pending', className: 'gp-flow__pending' }, t('flow.pending')) : null,
    ],
    footer: renderModalFooter({
      onClose, onConfirm: submit, confirmLabel: t('flow.start.confirm'),
      confirmDisabled, danger: false, t,
    }),
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
  readonly busy?: boolean
  readonly pending?: boolean
  readonly onSubmit: (request: FlowFinishRequest) => void
  readonly onClose: () => void
  readonly container?: Element | null
  readonly t: OpT
}

export function renderFlowFinishModal(args: FlowFinishArgs): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(FlowFinishModal, args)
}

function FlowFinishModal({ flow, branch, targets, hasUpstream, remote, busy = false, pending = false, onSubmit, onClose, container, t }: FlowFinishArgs): JSX.Element | null {
  const [strategy, setStrategy] = useState<FlowStrategy>('merge')
  // The default message is a commit subject, so it follows the UI language:
  // `完成 git-flow` in Chinese, `Finish git-flow` in English.
  const [message, setMessage] = useState(t('flow.finish.messageDefault'))
  const [target, setTarget] = useState(targets.selected)
  const [deleteBranch, setDeleteBranch] = useState(true)
  const [deleteRemote, setDeleteRemote] = useState(false)
  const [push, setPush] = useState(false)
  const [tag, setTag] = useState(flow === 'feature' ? '' : defaultTagName(branch))
  const uid = useId()
  const messageId = `${uid}-message`
  const tagId = `${uid}-tag`
  const targetId = `${uid}-target`
  const kind = KIND_LABEL[flow]
  const slug = KIND_SLUG[flow]
  const needsTag = flow !== 'feature'
  // The ref a push would publish, resolved for the branch actually chosen: a
  // target the remote does not have cannot be pushed, so the option stays off.
  const pushRef = remote.name !== null && remote.branches.includes(`${remote.name}/${target}`)
    ? `${remote.name}/${target}`
    : null
  const submit = (): void => {
    if (busy) return
    onSubmit({
      flow, branch, target, strategy, message: message.trim(), deleteBranch, deleteRemote,
      push: pushRef !== null && push,
      ...(needsTag ? { tag: tag.trim() } : {}),
    })
  }
  const strategyLabel: Record<FlowStrategy, string> = {
    merge: t('flow.finish.strategyMerge'),
    squash: t('flow.finish.strategySquash'),
    rebase: t('flow.finish.strategyRebase', { target }),
  }
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
      h('div', { key: 'txt', className: 'gp-modal__confirmtext' }, t('flow.finish.body', { kind: slug, target })),
      h('div', { key: 'modes', className: 'gp-flow__modes', role: 'radiogroup', 'aria-label': t('flow.finish.strategy') }, STRATEGIES.map((value) =>
        h('label', { key: value, className: 'gp-flow__mode' }, [
          h('input', {
            key: 'r', type: 'radio', name: `${uid}-strategy`, className: 'gp-check',
            checked: strategy === value, onChange: () => setStrategy(value),
          }),
          h('span', { key: 'l' }, strategyLabel[value]),
        ]))),
      // Where the work lands. Only a hotfix can pick (a checkout keeping both
      // `main` and `master`); the other flows show their one target instead of
      // a control that cannot change.
      h('div', { key: 'target', className: 'gp-flow__field' }, targets.editable
        ? [
          h('label', { key: 'l', className: 'gp-flow__label', htmlFor: targetId }, t('flow.finish.target')),
          h('select', {
            key: 's', id: targetId, className: 'gp-input gp-flow__select', value: target,
            onChange: (e: { target: { value: string } }) => setTarget(e.target.value),
          }, targets.options.map((name) => h('option', { key: name, value: name }, name))),
        ]
        : [
          h('span', { key: 'l', className: 'gp-flow__label' }, t('flow.finish.target')),
          h('span', { key: 'v', className: 'gp-flow__target', title: t('flow.finish.targetFixed') }, target),
        ]),
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
      h('label', { key: 'remote', className: `gp-modal__check${hasUpstream ? '' : ' gp-flow__check--off'}`, title: hasUpstream ? undefined : t('flow.finish.remoteDisabled') }, [
        h('input', {
          key: 'cb', type: 'checkbox', className: 'gp-check',
          checked: hasUpstream && deleteRemote, disabled: !hasUpstream,
          onChange: () => setDeleteRemote((v) => !v),
        }),
        t('flow.finish.deleteRemote', { kind: slug }),
      ]),
      // Push the landing branch to its remote. Off by default: finishing the
      // flow is a local integration, publishing it is a separate decision.
      h('label', { key: 'push', className: `gp-modal__check${pushRef === null ? ' gp-flow__check--off' : ''}`, title: pushRef === null ? t('flow.finish.pushDisabled') : undefined }, [
        h('input', {
          key: 'cb', type: 'checkbox', className: 'gp-check',
          checked: pushRef !== null && push, disabled: pushRef === null,
          onChange: () => setPush((v) => !v),
        }),
        t('flow.finish.push', { ref: pushRef ?? target }),
      ]),
      pending ? h('div', { key: 'pending', className: 'gp-flow__pending' }, t('flow.pending')) : null,
    ],
    footer: renderModalFooter({
      onClose, onConfirm: submit, confirmLabel: t('flow.finish.confirm'),
      confirmDisabled: busy || (needsTag && tag.trim() === ''), danger: false, t,
    }),
    ...(busy ? { busy: true } : {}),
  })
}

export interface FlowIntegrateArgs {
  readonly develop: string
  readonly current: string | null
  readonly dirty: boolean
  readonly busy?: boolean
  readonly pending?: boolean
  readonly onSubmit: () => void
  readonly onClose: () => void
  readonly container?: Element | null
  readonly t: OpT
}

/** `整合开发`: merge `develop` into the current branch. It moves the work tree
 * and can conflict, so it keeps the same confirmation contract as a merge. */
export function renderFlowIntegrateModal({ develop, current, dirty, busy = false, pending = false, onSubmit, onClose, container, t }: FlowIntegrateArgs): JSX.Element | null {
  return renderConfirmModal({
    title: t('flow.integrate.title'),
    body: t('flow.integrate.body', { develop, current: current ?? t('switch.detached') })
      + (dirty ? `\n\n${t('flow.integrate.dirty')}` : ''),
    confirmLabel: t('flow.integrate.confirm'),
    danger: false,
    error: pending ? t('flow.pending') : null,
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
      h('div', { key: 'detail', className: 'gp-modal__confirmtext' }, t('flow.about.detail')),
    ],
    footer: h('div', { key: 'footer', className: 'gp-modal__footer' }, [
      h('button', { key: 'close', type: 'button', className: 'gp-btn gp-btn--primary', onClick: onClose }, t('common.close')),
    ]),
  })
}

