/**
 * Shared confirm/footer modal primitives for low-frequency write operations
 * (tag create/delete, stash push/drop). Portaled dialogs reuse the existing
 * `.gp-modal*` styles; every footer carries the "use the dsh AI" hint so a user
 * always sees the lower-conflict alternative to operating git from the panel.
 */
import { createElement as h, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { CloseIcon } from './icons.js'
import { OVERLAY_ATTR, useDialogFocus } from './dialog-focus.js'
import type { GitKey } from './locales.js'

export type OpT = (key: GitKey, params?: Record<string, string | number>) => string

/**
 * The single wire-code → display-text map. Both the Changes/Panel action path
 * and the direct-`run` tag path render through this, so a code can never show
 * two different messages depending on which path hit it.
 */
export function opErrorText(code: string, message: string | undefined, t: OpT): string {
  switch (code) {
    case 'empty-message': return t('error.emptyMessage')
    case 'nothing-to-commit': return t('error.nothingToCommit')
    case 'not-a-git-repo': return t('error.notARepo')
    // The picker's own state went stale (the directory is gone, or it stopped
    // being a work-tree top): not a git failure, and the fix is to pick again.
    case 'invalid-repo': return t('error.invalidRepo')
    case 'cwd-unavailable': return t('error.noCwd')
    case 'local-changes-block': return t('error.localChangesBlock')
    case 'not-ff': return t('error.notFastForward')
    case 'push-rejected': return t('error.pushRejected')
    case 'auth-failed': return t('error.authFailed')
    case 'conflict': return t('error.conflict')
    case 'revert-conflict': return t('error.revertConflict')
    case 'revert-stuck': return t('error.revertStuck')
    case 'revert-merge': return t('error.revertMerge')
    case 'index-busy': return t('error.indexBusy')
    case 'not-found': return t('error.notFound')
    case 'branch-in-use': return t('error.branchInUse')
    case 'nested-repo': return t('error.nestedRepo')
    // The same refusal raised mid-loop, after earlier paths were deleted: the
    // copy must not read as "nothing happened".
    case 'nested-repo-partial': return t('error.nestedRepoPartial')
    // `discard-all` re-ran status and the stream was clipped: the host refuses
    // rather than silently discarding a prefix of the change set.
    case 'status-lossy': return t('error.statusLossy')
    // The cause varies (branch in use, missing ref, conflict), so the raw git
    // message rides along — the localized text alone would not say why.
    case 'stash-switch-failed': return t('error.stashSwitchFailed', { reason: message ?? '' })
    // Publishing needs a branch to name the remote side after: a detached HEAD
    // or a repository without commits has none.
    case 'no-branch': return t('error.noBranch')
    case 'invalid-name':
    case 'invalid-index': return t('error.invalidName')
    // A rejected path came from the panel's own selection: it is outside the
    // repository (or a `.git` entry), so there is no detail worth showing.
    case 'invalid-path': return t('error.invalidPath')
    // File-browser saves. A save the host refused on an edit rule carries a
    // `reason` the editor maps itself; this is the fallback for the rest
    // (type or file kind). Write errors carry only the errno code.
    case 'not-editable': return t('error.notEditable')
    case 'write-denied': return t('error.writeDenied', { reason: message ?? '' })
    case 'write-failed': return t('error.writeFailed', { reason: message ?? '' })
    // Transport-level outcomes carry no message of their own.
    case 'timeout': return t('error.timeout')
    case 'cancelled': return t('error.cancelled')
    // `git-error` keeps the repository's own message: hooks, signing and
    // provider failures are the only copy that says why, and cannot be translated.
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
  /** Portal target; document.body when absent. A dialog raised from inside
   * another dialog that is in browser fullscreen must render inside that
   * element, or it is not displayed at all. */
  container?: Element | null
  /** Take focus on open, keep Tab inside, restore it on close
   * (`useDialogFocus`): for a dialog raised over another focus-trapping one. */
  trapFocus?: boolean
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

function ModalShell({ onClose, title, icon, hash, body, footer, overlay, portalKey, container, trapFocus, t }: ModalShellProps): JSX.Element {
  const busy = overlay !== undefined && overlay !== null
  const frameRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    // A focus-trapping shell gets Escape from `useDialogFocus` instead.
    if (trapFocus === true) return undefined
    // While an op runs, swallow Escape so the dialog can't be dismissed mid-flight.
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy, trapFocus])
  const modal = h('div', {
    className: 'gp-modal-backdrop',
    // Declares this dialog as an overlay above the page, so a lower layer's
    // Escape handler (the branch drawer) can yield the keystroke to it.
    [OVERLAY_ATTR]: '',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (!busy && e.target === e.currentTarget) onClose() },
  }, h('div', { ref: frameRef, className: 'gp-modal gp-modal--sm', role: 'dialog', 'aria-modal': true }, [
    trapFocus === true ? h(ShellFocus, { key: 'focus', frameRef, closeRef, onClose: () => { if (!busy) onClose() } }) : null,
    h('div', { key: 'bar', className: 'gp-modal__bar' }, [
      icon !== undefined ? h('span', { key: 'ic', className: 'gp-modal__fileicon' }, icon) : null,
      h('span', { key: 'title', className: 'gp-modal__path' }, title),
      hash !== undefined ? h('span', { key: 'hash', className: 'gp-modal__hash' }, hash) : null,
      h('button', { key: 'close', ref: closeRef, type: 'button', className: 'gp-icon-btn gp-modal__close', title: t('common.close'), disabled: busy, onClick: onClose }, h(CloseIcon, { size: 15 })),
    ]),
    h('div', { key: 'body', className: 'gp-modal__form' }, body),
    footer,
    overlay ?? null,
  ]))
  return createPortal(modal, container ?? document.body, portalKey)
}

function ShellFocus({ frameRef, closeRef, onClose }: {
  frameRef: RefObject<HTMLDivElement | null>
  closeRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}): null {
  useDialogFocus(frameRef, onClose, closeRef)
  return null
}

/**
 * A busy overlay covering a dialog while an op runs: the platform loader plus a
 * label. No progress bar — the single-shot `run` RPC returns only on completion,
 * so there is no real progress to report; the label alone states that work is in
 * flight.
 */
function renderBusyOverlay(label: string): JSX.Element {
  return h('div', { key: 'overlay', className: 'gp-modal__overlay' }, [
    h(StateDot, { key: 'sp', state: 'ongoing', size: 26 }),
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
  /** See `ModalShellProps.container` / `trapFocus`. */
  container?: Element | null
  trapFocus?: boolean
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
    ...(cb.container !== undefined ? { container: cb.container } : {}),
    ...(cb.trapFocus !== undefined ? { trapFocus: cb.trapFocus } : {}),
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
