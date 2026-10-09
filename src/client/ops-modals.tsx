/**
 * Shared confirm/footer modal primitives for low-frequency write operations
 * (tag create/delete, stash push/drop). Portaled dialogs reuse the existing
 * `.gp-modal*` styles; every footer carries the "use the dsh AI" hint so a user
 * always sees the lower-conflict alternative to operating git from the panel.
 */
import { createElement as h } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { CloseIcon } from './icons'
import type { GitKey } from './locales'

export type OpT = (key: GitKey, params?: Record<string, string | number>) => string

/** Map a write-action failure code to display text (callers of `run` directly). */
export function opErrorText(code: string, message: string | undefined, t: OpT): string {
  switch (code) {
    case 'invalid-name': return t('error.invalidName')
    case 'not-found': return t('error.notFound')
    case 'index-busy': return t('error.indexBusy')
    case 'conflict': return t('error.conflict')
    case 'local-changes-block': return t('error.localChangesBlock')
    case 'empty-message': return t('error.emptyMessage')
    default: return message ?? t('error.generic')
  }
}

/** Shared modal footer: the AI-operation hint over Cancel / Confirm buttons. */
export function renderModalFooter(cb: {
  onClose: () => void
  onConfirm: () => void
  confirmLabel: string
  confirmDisabled: boolean
  danger: boolean
  t: OpT
}): JSX.Element {
  return h('div', { key: 'footer', className: 'gp-modal__footer' }, [
    h('div', { key: 'hint', className: 'gp-modal__hint' }, cb.t('ops.aiHint')),
    h('div', { key: 'btns', className: 'gp-modal__btns' }, [
      h('button', { key: 'cancel', type: 'button', className: 'gp-btn', onClick: cb.onClose }, cb.t('common.cancel')),
      h('button', {
        key: 'ok', type: 'button',
        className: `gp-btn ${cb.danger ? 'gp-btn--danger' : 'gp-btn--primary'}`,
        disabled: cb.confirmDisabled, onClick: cb.onConfirm,
      }, cb.confirmLabel),
    ]),
  ])
}

export interface ConfirmCbs {
  title: string
  body: string
  confirmLabel: string
  danger: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
  t: OpT
}

/** Portaled confirm dialog for a low-frequency destructive op (tag delete, stash drop). */
export function renderConfirmModal(cb: ConfirmCbs): JSX.Element | null {
  if (typeof document === 'undefined') return null
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
      cb.error !== null ? h('div', { key: 'err', className: 'gp-feedback' }, cb.error) : null,
    ]),
    renderModalFooter({ onClose: cb.onClose, onConfirm: cb.onConfirm, confirmLabel: cb.confirmLabel, confirmDisabled: false, danger: cb.danger, t: cb.t }),
  ]))
  return createPortal(modal, document.body, 'confirm-modal')
}
