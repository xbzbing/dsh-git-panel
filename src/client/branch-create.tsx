/**
 * "Create branch" dialog, opened from a branch row's or a commit row's menu
 * (issue #118). Names a new local branch at the captured start point — a
 * branch row's ref (full tracking ref for a remote row) or a commit's full
 * hash — and creates it **without switching**: the current branch and the work
 * tree stay where they are, so this is a pure ref write like the tag form and
 * reloads through the same ref-op path.
 */
import { createElement as h, useState } from 'react'
import type { JSX } from 'react'
import { BranchIcon } from './icons.js'
import { renderAiHint, renderModalFooter, renderModalShell, type OpT } from './ops-modals.js'

export interface BranchCreateCbs {
  /** What the dialog shows: the start point's display name (branch name or
   * short hash). The wire carries the addressable `start` separately. */
  readonly label: string
  readonly busy: boolean
  readonly error: string | null
  readonly onCreate: (name: string) => void | Promise<void>
  readonly onClose: () => void
  readonly t: OpT
}

export function renderBranchCreateModal(target: { label: string }, cb: Omit<BranchCreateCbs, 'label'>): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(BranchCreateModal, { label: target.label, ...cb })
}

function BranchCreateModal({ label, busy, error, onCreate, onClose, t }: BranchCreateCbs): JSX.Element | null {
  const [name, setName] = useState('')
  const submit = (): void => { if (!busy && name.trim() !== '') void onCreate(name.trim()) }
  return renderModalShell({
    onClose, title: t('branchCreate.title'), icon: h(BranchIcon, { size: 15 }), hash: label,
    portalKey: 'branch-create-modal', t,
    body: [
      h('div', { key: 'txt', className: 'gp-modal__confirmtext' }, t('branchCreate.body', { start: label })),
      h('input', {
        key: 'name', className: 'gp-input', placeholder: t('branchCreate.placeholder'), value: name, autoFocus: true,
        onChange: (e: { target: { value: string } }) => setName(e.target.value),
        onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') submit() },
      }),
      renderAiHint(t),
      error !== null ? h('div', { key: 'err', className: 'gp-feedback' }, error) : null,
    ],
    footer: renderModalFooter({
      onClose, onConfirm: submit, confirmLabel: t('branchCreate.confirm'),
      confirmDisabled: busy || name.trim() === '', danger: false, t,
    }),
    // Mid-flight the dialog stays put: its error line only renders here, so
    // dismissing it would swallow the reason the creation failed.
    ...(busy ? { busy: true } : {}),
  })
}
