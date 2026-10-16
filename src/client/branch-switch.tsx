/**
 * "Switch branch" confirm dialog, opened from the switch button on a branch
 * row. A remote row either reuses its same-named local branch or creates and
 * tracks it (the option model lives in branch-options.ts); when the work tree
 * is dirty the dialog offers stashing the local changes first instead of
 * letting git refuse the switch.
 */
import { createElement as h, useState } from 'react'
import type { JSX } from 'react'
import type { BranchOption } from './branch-options.js'
import { renderConfirmModal, type OpT } from './ops-modals.js'

export interface BranchSwitchCbs {
  /** Branch currently checked out; null on a detached HEAD. */
  readonly from: string | null
  /** Uncommitted file count; 0 hides the stash choice entirely. */
  readonly dirty: number
  readonly busy: boolean
  readonly error: string | null
  readonly onConfirm: (stash: boolean) => void
  readonly onClose: () => void
  readonly t: OpT
}

export function renderBranchSwitchConfirm(target: BranchOption, cb: BranchSwitchCbs): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(BranchSwitchConfirm, { target, ...cb })
}

function BranchSwitchConfirm({ target, from, dirty, busy, error, onConfirm, onClose, t }: BranchSwitchCbs & { target: BranchOption }): JSX.Element | null {
  // Default to the plain checkout: git carries uncommitted changes across a
  // switch whenever they don't collide with the target branch, so stashing is
  // only the fallback for when it would refuse.
  const [stash, setStash] = useState(false)
  const mode = (value: boolean, key: string, label: string, hint: string): JSX.Element =>
    h('label', { key, className: `gp-bpick__mode${stash === value ? ' gp-bpick__mode--on' : ''}` }, [
      h('input', { key: 'r', type: 'radio', name: 'gp-switch-mode', className: 'gp-check', checked: stash === value, onChange: () => setStash(value) }),
      h('span', { key: 'tx', className: 'gp-bpick__modetext' }, [
        h('span', { key: 'l', className: 'gp-bpick__modelabel' }, label),
        h('span', { key: 'h', className: 'gp-bpick__modehint' }, hint),
      ]),
    ])
  return renderConfirmModal({
    title: t('switch.confirmTitle'),
    body: t('switch.body', { from: from ?? t('switch.detached'), to: target.name }),
    extra: h('div', { key: 'x', className: 'gp-bpick__extra' }, [
      target.createFrom === undefined
        ? null
        : h('div', { key: 'trk', className: 'gp-bpick__note' }, t('switch.trackingNote', { name: target.name, ref: target.createFrom })),
      dirty === 0 ? null : h('div', { key: 'dw', className: 'gp-bpick__warn' }, t('switch.dirtyWarn', { count: dirty })),
      dirty === 0 ? null : h('div', { key: 'md', className: 'gp-bpick__modes' }, [
        mode(false, 'direct', t('switch.modeDirect'), t('switch.modeDirectHint')),
        mode(true, 'stash', t('switch.modeStash', { count: dirty }), t('switch.modeStashHint')),
      ]),
    ]),
    confirmLabel: stash ? t('switch.confirmStash') : t('switch.confirm'),
    danger: false,
    error,
    confirmBusy: busy,
    busyLabel: t('switch.switching'),
    onConfirm: () => onConfirm(stash),
    onClose,
    t,
  })
}
