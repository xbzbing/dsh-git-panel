/**
 * Shared confirm/footer modal primitives for low-frequency write operations
 * (tag create/delete, stash push/drop). Portaled dialogs reuse the existing
 * `.gp-modal*` styles; every footer carries the "use the dsh AI" hint so a user
 * always sees the lower-conflict alternative to operating git from the panel.
 */
import { createElement as h, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { CloseIcon } from './icons'
import type { GitKey } from './locales'

export type OpT = (key: GitKey, params?: Record<string, string | number>) => string

/**
 * The single wire-code → display-text map. Both the Changes/Panel action path
 * and the direct-`run` tag path render through this, so a code can never show
 * two different messages depending on which path hit it.
 */
export function opErrorText(code: string, message: string | undefined, t: OpT): string {
  switch (code) {
    case 'empty-message': return t('error.emptyMessage')
    case 'not-a-git-repo': return t('error.notARepo')
    case 'cwd-unavailable': return t('error.noCwd')
    case 'local-changes-block': return t('error.localChangesBlock')
    case 'not-ff': return t('error.notFastForward')
    case 'conflict': return t('error.conflict')
    case 'revert-conflict': return t('error.revertConflict')
    case 'revert-stuck': return t('error.revertStuck')
    case 'revert-merge': return t('error.revertMerge')
    case 'index-busy': return t('error.indexBusy')
    case 'not-found': return t('error.notFound')
    case 'invalid-name':
    case 'invalid-index': return t('error.invalidName')
    default: return message ?? t('error.generic')
  }
}

/** The shared "trust the AI" hint. Lives in the dialog body (below the main
 * text), not in the footer, so it never shares a row with the action buttons. */
export function renderAiHint(t: OpT): JSX.Element {
  return h('div', { key: 'aihint', className: 'gp-modal__hint' }, t('ops.aiHint'))
}

/** Shared modal footer: right-aligned Cancel / Confirm buttons. */
export function renderModalFooter(cb: {
  onClose: () => void
  onConfirm: () => void
  confirmLabel: string
  confirmDisabled: boolean
  danger: boolean
  t: OpT
}): JSX.Element {
  return h('div', { key: 'footer', className: 'gp-modal__footer' }, [
    h('button', { key: 'cancel', type: 'button', className: 'gp-btn', onClick: cb.onClose }, cb.t('common.cancel')),
    h('button', {
      key: 'ok', type: 'button',
      className: `gp-btn ${cb.danger ? 'gp-btn--danger' : 'gp-btn--primary'}`,
      disabled: cb.confirmDisabled, onClick: cb.onConfirm,
    }, cb.confirmLabel),
  ])
}

export interface ModalShellProps {
  onClose: () => void
  /** Bar title (rendered as `.gp-modal__path`). */
  title: string
  /** Optional leading icon node and trailing short-hash chip in the bar. */
  icon?: JSX.Element
  hash?: string
  /** Children of the scrollable `.gp-modal__form` body (keyed, nulls skipped). */
  body: (JSX.Element | null)[]
  /** Footer node, usually `renderModalFooter(...)` (null renders no footer). */
  footer: JSX.Element | null
  /** Optional busy overlay covering the dialog while an op runs. */
  overlay?: JSX.Element | null
  /** Stable React portal key, unique per dialog kind. */
  portalKey: string
  t: OpT
}

/** The one small-dialog shell: backdrop (click-outside closes), `.gp-modal--sm`
 * frame, bar (optional icon + title + optional hash + close), `.gp-modal__form`
 * body, and footer, portaled to document.body with Escape-to-close wired once.
 * Every low-frequency write dialog (confirm / tag / stash / reset) renders
 * through this so the shell markup and dismiss contract live in one place. */
export function renderModalShell(props: ModalShellProps): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(ModalShell, props)
}

function ModalShell({ onClose, title, icon, hash, body, footer, overlay, portalKey, t }: ModalShellProps): JSX.Element {
  const busy = overlay !== undefined && overlay !== null
  useEffect(() => {
    // While an op runs, swallow Escape so the dialog can't be dismissed mid-flight.
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])
  const modal = h('div', {
    className: 'gp-modal-backdrop',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (!busy && e.target === e.currentTarget) onClose() },
  }, h('div', { className: 'gp-modal gp-modal--sm', role: 'dialog', 'aria-modal': true }, [
    h('div', { key: 'bar', className: 'gp-modal__bar' }, [
      icon !== undefined ? h('span', { key: 'ic', className: 'gp-modal__fileicon' }, icon) : null,
      h('span', { key: 'title', className: 'gp-modal__path' }, title),
      hash !== undefined ? h('span', { key: 'hash', className: 'gp-modal__hash' }, hash) : null,
      h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-modal__close', title: t('common.close'), disabled: busy, onClick: onClose }, h(CloseIcon, { size: 15 })),
    ]),
    h('div', { key: 'body', className: 'gp-modal__form' }, body),
    footer,
    overlay ?? null,
  ]))
  return createPortal(modal, document.body, portalKey)
}

/**
 * A busy overlay covering a dialog while an op runs: a spinner + a label. No
 * progress bar — the single-shot `run` RPC returns only on completion, so there
 * is no real progress to report; the label alone states that work is in flight.
 */
function renderBusyOverlay(label: string): JSX.Element {
  return h('div', { key: 'overlay', className: 'gp-modal__overlay' }, [
    h('div', { key: 'sp', className: 'gp-spinner' }),
    h('div', { key: 'lb', className: 'gp-modal__overlay-label' }, label),
  ])
}

export interface ConfirmCbs {
  title: string
  body: string
  /** Optional highlighted node rendered below the body (e.g. a pull scope line). */
  extra?: JSX.Element | null
  confirmLabel: string
  danger: boolean
  error: string | null
  /** Disable confirm while an op is in flight (parity with ResetModal). */
  confirmBusy?: boolean
  /** When set with confirmBusy, show a busy overlay carrying this label. */
  busyLabel?: string
  onConfirm: () => void
  onClose: () => void
  t: OpT
}

/** Portaled confirm dialog for a low-frequency destructive op (tag delete,
 * stash drop). A plain text body + the shared AI hint over the shell. */
export function renderConfirmModal(cb: ConfirmCbs): JSX.Element | null {
  const showOverlay = cb.confirmBusy === true && cb.busyLabel !== undefined
  return renderModalShell({
    onClose: cb.onClose,
    title: cb.title,
    portalKey: 'confirm-modal',
    t: cb.t,
    body: [
      h('div', { key: 'txt', className: 'gp-modal__confirmtext' }, cb.body),
      cb.extra ?? null,
      renderAiHint(cb.t),
      cb.error !== null ? h('div', { key: 'err', className: 'gp-feedback' }, cb.error) : null,
    ],
    footer: renderModalFooter({ onClose: cb.onClose, onConfirm: cb.onConfirm, confirmLabel: cb.confirmLabel, confirmDisabled: cb.confirmBusy === true, danger: cb.danger, t: cb.t }),
    ...(showOverlay ? { overlay: renderBusyOverlay(cb.busyLabel!) } : {}),
  })
}
