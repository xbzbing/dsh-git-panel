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
    case 'conflict': return t('error.conflict')
    case 'revert-conflict': return t('error.revertConflict')
    case 'revert-stuck': return t('error.revertStuck')
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

export interface ConfirmCbs {
  title: string
  body: string
  confirmLabel: string
  danger: boolean
  error: string | null
  /** Disable confirm while an op is in flight (parity with ResetModal). */
  confirmBusy?: boolean
  onConfirm: () => void
  onClose: () => void
  t: OpT
}

/** Portaled confirm dialog for a low-frequency destructive op (tag delete, stash drop). */
export function renderConfirmModal(cb: ConfirmCbs): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(ConfirmModal, cb)
}

/** Escape / backdrop / close / cancel all dismiss, matching the panel's other
 * dialogs (file-diff modal, branch sheet, tag/stash dialogs all honor Esc). */
function ConfirmModal(cb: ConfirmCbs): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') cb.onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cb])
  const modal = h('div', {
    className: 'gp-modal-backdrop',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) cb.onClose() },
  }, h('div', { className: 'gp-modal gp-modal--sm', role: 'dialog', 'aria-modal': true }, [
    h('div', { key: 'bar', className: 'gp-modal__bar' }, [
      h('span', { key: 'title', className: 'gp-modal__path' }, cb.title),
      h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-modal__close', title: cb.t('common.close'), onClick: cb.onClose }, h(CloseIcon, { size: 15 })),
    ]),
    h('div', { key: 'body', className: 'gp-modal__form' }, [
      h('div', { key: 'txt', className: 'gp-modal__confirmtext' }, cb.body),
      renderAiHint(cb.t),
      cb.error !== null ? h('div', { key: 'err', className: 'gp-feedback' }, cb.error) : null,
    ]),
    renderModalFooter({ onClose: cb.onClose, onConfirm: cb.onConfirm, confirmLabel: cb.confirmLabel, confirmDisabled: cb.confirmBusy === true, danger: cb.danger, t: cb.t }),
  ]))
  return createPortal(modal, document.body, 'confirm-modal')
}
