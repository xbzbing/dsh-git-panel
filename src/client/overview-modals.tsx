/**
 * Portaled write-op dialogs for the Git overview commit-action area:
 *  - TagCreateModal — name a tag (optionally annotated) at a commit.
 *  - ResetModal     — choose a reset mode (soft/mixed/hard); hard reveals the
 *                     tracked-change loss list and gates confirm behind an ack.
 * Both reuse the shared `.gp-modal*` primitives and the "trust the AI" hint.
 */
import { createElement as h, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import type { GitKey } from './locales'
import { CloseIcon, ResetIcon, TagIcon } from './icons'
import { renderAiHint, renderModalFooter, type OpT } from './ops-modals'
import type { ResetMode } from './types'

interface TagCreateCbs {
  onClose: () => void
  onCreate: (name: string, message: string) => void | Promise<void>
  error: string | null
  compact: boolean
  t: OpT
}

/** Portaled dialog: name a tag (optionally annotated) at the chosen commit. */
export function renderTagCreateModal(target: { hash: string; shortHash: string }, cb: TagCreateCbs): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(TagCreateModal, { target, ...cb })
}

function TagCreateModal({ target, onClose, onCreate, error, t }: TagCreateCbs & { target: { hash: string; shortHash: string } }): JSX.Element {
  const [name, setName] = useState('')
  const [annotated, setAnnotated] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const submit = (): void => { if (name.trim() !== '') void onCreate(name.trim(), annotated ? message : '') }
  const modal = h('div', {
    className: 'gp-modal-backdrop',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) onClose() },
  }, h('div', { className: 'gp-modal gp-modal--sm', role: 'dialog', 'aria-modal': true }, [
    h('div', { key: 'bar', className: 'gp-modal__bar' }, [
      h('span', { key: 'ic', className: 'gp-modal__fileicon' }, h(TagIcon, { size: 15 })),
      h('span', { key: 'title', className: 'gp-modal__path' }, t('tag.createTitle')),
      h('span', { key: 'hash', className: 'gp-modal__hash' }, target.shortHash),
      h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-modal__close', title: t('common.close'), onClick: onClose }, h(CloseIcon, { size: 15 })),
    ]),
    h('div', { key: 'body', className: 'gp-modal__form' }, [
      h('input', {
        key: 'name', className: 'gp-input', placeholder: t('tag.namePlaceholder'), value: name, autoFocus: true,
        onChange: (e: { target: { value: string } }) => setName(e.target.value),
        onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') submit() },
      }),
      h('label', { key: 'ann', className: 'gp-modal__check' }, [
        h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: annotated, onChange: () => setAnnotated((v) => !v) }),
        t('tag.annotated'),
      ]),
      annotated ? h('textarea', {
        key: 'msg', className: 'gp-input gp-input--area', placeholder: t('tag.messagePlaceholder'), value: message,
        onChange: (e: { target: { value: string } }) => setMessage(e.target.value),
      }) : null,
      renderAiHint(t),
      error !== null ? h('div', { key: 'err', className: 'gp-feedback' }, error) : null,
    ]),
    renderModalFooter({ onClose, onConfirm: submit, confirmLabel: t('tag.create'), confirmDisabled: name.trim() === '', danger: false, t }),
  ]))
  return createPortal(modal, document.body, 'tag-create-modal')
}

interface ResetCbs {
  from: string
  dirty: boolean
  lostFiles: readonly string[]
  lostTotal: number
  lostTruncated: boolean
  busy: boolean
  error: string | null
  onReset: (mode: ResetMode) => void | Promise<void>
  onClose: () => void
  t: OpT
}

/** Portaled dialog: choose a reset mode (soft/mixed/hard) for the current branch.
 * `hard` is the only mode that discards uncommitted work, so it reveals the
 * lost-file list and gates the confirm behind an explicit acknowledgement. */
export function renderResetModal(target: { hash: string; shortHash: string; subject: string }, cb: ResetCbs): JSX.Element | null {
  if (typeof document === 'undefined') return null
  return h(ResetModal, { target, ...cb })
}

function ResetModal({ target, from, dirty, lostFiles, lostTotal, lostTruncated, busy, error, onReset, onClose, t }: ResetCbs & { target: { hash: string; shortHash: string; subject: string } }): JSX.Element {
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [ack, setAck] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // Switching away from hard clears a stale acknowledgement.
  useEffect(() => { if (mode !== 'hard') setAck(false) }, [mode])
  const modes: Array<{ value: ResetMode; label: GitKey; hint: GitKey }> = [
    { value: 'mixed', label: 'reset.modeMixed', hint: 'reset.mixedHint' },
    { value: 'soft', label: 'reset.modeSoft', hint: 'reset.softHint' },
    { value: 'hard', label: 'reset.modeHard', hint: 'reset.hardHint' },
  ]
  const confirmDisabled = busy || (mode === 'hard' && !ack)
  const modal = h('div', {
    className: 'gp-modal-backdrop',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) onClose() },
  }, h('div', { className: 'gp-modal gp-modal--sm', role: 'dialog', 'aria-modal': true }, [
    h('div', { key: 'bar', className: 'gp-modal__bar' }, [
      h('span', { key: 'ic', className: 'gp-modal__fileicon' }, h(ResetIcon, { size: 15 })),
      h('span', { key: 'title', className: 'gp-modal__path' }, t('reset.title')),
      h('span', { key: 'hash', className: 'gp-modal__hash' }, target.shortHash),
      h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-modal__close', title: t('common.close'), onClick: onClose }, h(CloseIcon, { size: 15 })),
    ]),
    h('div', { key: 'body', className: 'gp-modal__form' }, [
      h('div', { key: 'txt', className: 'gp-modal__confirmtext' }, t('reset.body', { from, to: target.shortHash })),
      h('div', { key: 'modes', className: 'gp-reset__modes' }, modes.map((m) => h('label', {
        key: m.value, className: `gp-reset__mode${mode === m.value ? ' gp-reset__mode--on' : ''}${m.value === 'hard' ? ' gp-reset__mode--danger' : ''}`,
      }, [
        h('input', { key: 'r', type: 'radio', name: 'gp-reset-mode', className: 'gp-check', checked: mode === m.value, onChange: () => setMode(m.value) }),
        h('span', { key: 'tx', className: 'gp-reset__modetext' }, [
          h('span', { key: 'l', className: 'gp-reset__modelabel' }, t(m.label)),
          h('span', { key: 'h', className: 'gp-reset__modehint' }, t(m.hint)),
        ]),
      ]))),
      // Hard mode discards two separable things: uncommitted tracked changes
      // (unrecoverable) and any commits ahead of the target (reflog-recoverable).
      // Always state the orphaned-commit effect; list the uncommitted losses
      // only when there are any.
      mode === 'hard' ? h('div', { key: 'orphan', className: 'gp-reset__dirtywarn' }, t('reset.hardOrphan')) : null,
      mode === 'hard' && lostTotal > 0 ? h('div', { key: 'lost', className: 'gp-reset__lost' }, [
        h('div', { key: 'w', className: 'gp-reset__warn' }, t('reset.hardWarn')),
        h('ul', { key: 'ul', className: 'gp-reset__lostlist' }, [
          ...lostFiles.map((p) => h('li', { key: p, title: p }, p)),
          lostTruncated ? h('li', { key: '_more', className: 'gp-reset__lostmore' }, t('reset.lostMore')) : null,
        ]),
      ]) : null,
      // Ack wording tracks whether uncommitted work is actually at risk.
      mode === 'hard' ? h('label', { key: 'ack', className: 'gp-modal__check gp-reset__ack' }, [
        h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: ack, onChange: () => setAck((v) => !v) }),
        t(lostTotal > 0 ? 'reset.hardAck' : 'reset.hardAckClean'),
      ]) : null,
      dirty ? h('div', { key: 'dirty', className: 'gp-reset__dirtywarn' }, t('ops.dirtyWarn')) : null,
      renderAiHint(t),
      error !== null ? h('div', { key: 'err', className: 'gp-feedback' }, error) : null,
    ]),
    renderModalFooter({ onClose, onConfirm: () => void onReset(mode), confirmLabel: t('reset.confirm'), confirmDisabled, danger: mode === 'hard', t }),
  ]))
  return createPortal(modal, document.body, 'reset-modal')
}
