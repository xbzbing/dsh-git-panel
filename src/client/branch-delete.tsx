/**
 * Branch-delete confirm dialogs, opened from a branch row's menu (issue #112).
 *
 * Local: two stages, both explicit. The first confirm runs git's safe `-d`,
 * which refuses to delete a branch whose commits are not merged yet. That
 * refusal is not an error surfaced to the user — it promotes the dialog to its
 * second stage, where a forced `-D` needs a fresh acknowledgement before the
 * confirm button unlocks.
 *
 * Remote: one stage, but the acknowledgement is mandatory from the start. Git
 * has no merged-check for `push --delete`, so the dialog carries the only
 * safety net: the branch is deleted on the server, other people stop seeing it,
 * and the panel cannot undo it. Nothing local is deleted.
 */
import { createElement as h, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { renderConfirmModal, type OpT } from './ops-modals.js'

export interface BranchDeleteCbs {
  /** Local branch being deleted. */
  readonly name: string
  /** The safe delete was refused as "not fully merged": force needs the ack. */
  readonly needsForce: boolean
  readonly busy: boolean
  readonly error: string | null
  readonly onConfirm: (force: boolean) => void
  readonly onClose: () => void
  readonly t: OpT
}

export function renderBranchDeleteConfirm(target: { name: string }, cb: Omit<BranchDeleteCbs, 'name'>): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(BranchDeleteConfirm, { name: target.name, ...cb })
}

function BranchDeleteConfirm({ name, needsForce, busy, error, onConfirm, onClose, t }: BranchDeleteCbs): JSX.Element | null {
  const [ack, setAck] = useState(false)
  // A new target, or a newly revealed force step, invalidates an acknowledgement
  // given for the previous state.
  useEffect(() => { setAck(false) }, [name, needsForce])
  const confirmDisabled = busy || (needsForce && !ack)
  return renderConfirmModal({
    title: t('branchDelete.title'),
    body: t('branchDelete.body', { name }),
    extra: h('div', { key: 'x', className: 'gp-bpick__extra' }, needsForce
      ? [
          h('div', { key: 'warn', className: 'gp-bpick__warn' }, t('branchDelete.unmergedWarn')),
          h('label', { key: 'ack', className: 'gp-modal__check' }, [
            h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: ack, onChange: () => setAck((v) => !v) }),
            t('branchDelete.forceAck'),
          ]),
        ]
      : [h('div', { key: 'note', className: 'gp-bpick__note' }, t('branchDelete.safeNote'))]),
    confirmLabel: needsForce ? t('branchDelete.force') : t('branchDelete.confirm'),
    danger: true,
    error,
    confirmBusy: busy,
    confirmDisabled,
    busyLabel: t('branchDelete.busy'),
    onConfirm: () => onConfirm(needsForce),
    onClose,
    t,
  })
}

export interface RemoteBranchDeleteCbs {
  /** The row's short name (`origin/feat/x`), what the user right-clicked. */
  readonly label: string
  readonly busy: boolean
  readonly error: string | null
  readonly onConfirm: () => void
  readonly onClose: () => void
  readonly t: OpT
}

export function renderRemoteBranchDeleteConfirm(target: { label: string }, cb: Omit<RemoteBranchDeleteCbs, 'label'>): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(RemoteBranchDeleteConfirm, { label: target.label, ...cb })
}

function RemoteBranchDeleteConfirm({ label, busy, error, onConfirm, onClose, t }: RemoteBranchDeleteCbs): JSX.Element | null {
  const [ack, setAck] = useState(false)
  // A new target invalidates an acknowledgement given for the previous one.
  useEffect(() => { setAck(false) }, [label])
  return renderConfirmModal({
    title: t('remoteBranchDelete.title'),
    body: t('remoteBranchDelete.body', { name: label }),
    extra: h('div', { key: 'x', className: 'gp-bpick__extra' }, [
      h('div', { key: 'warn', className: 'gp-bpick__warn' }, t('remoteBranchDelete.warning')),
      h('label', { key: 'ack', className: 'gp-modal__check' }, [
        h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: ack, onChange: () => setAck((v) => !v) }),
        t('remoteBranchDelete.ack'),
      ]),
    ]),
    confirmLabel: t('remoteBranchDelete.confirm'),
    danger: true,
    error,
    confirmBusy: busy,
    // No safe stage exists on a server: the ack is the only way to unlock it.
    confirmDisabled: !ack,
    busyLabel: t('remoteBranchDelete.busy'),
    onConfirm,
    onClose,
    t,
  })
}
