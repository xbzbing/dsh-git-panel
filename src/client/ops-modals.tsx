/**
 * Shared confirm/footer modal primitives for low-frequency write operations
 * (tag create/delete, stash push/drop). Portaled dialogs reuse the existing
 * `.gp-modal*` styles; every footer carries the "use the dsh AI" hint so a user
 * always sees the lower-conflict alternative to operating git from the panel.
 */
import { createElement as h, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { CloseIcon } from './icons.js'
import { isTopOverlay, OVERLAY_ATTR, useDialogFocus } from './dialog-focus.js'
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
    // A branch delete git refused: the branch is still a HEAD somewhere, or it
    // holds unmerged commits. The second one is what promotes the delete dialog
    // to its forced step; the text states the condition, not a raw git message.
    case 'branch-checked-out': return t('error.branchCheckedOut')
    case 'branch-unmerged': return t('branchDelete.unmergedWarn')
    // `git branch` refused a taken name: nothing was created (issue #118).
    case 'branch-exists': return t('error.branchExists')
    // A merge conflicted and the host auto-aborted it (the panel has no
    // conflict UI), so the work tree is back to the pre-merge state; the
    // "stuck" half says the abort itself failed and the repo is mid-merge.
    case 'merge-conflict': return t('error.mergeConflict')
    case 'merge-stuck': return t('error.mergeStuck')
    // The same contract for cherry-pick, plus the empty-result cancellation
    // (its change is already in the current branch; the sequencer was cleared).
    case 'pick-conflict': return t('error.pickConflict')
    case 'pick-stuck': return t('error.pickStuck')
    case 'pick-empty': return t('error.pickEmpty')
    // Cherry-picking a merge commit: a mainline parent is required, which the
    // panel cannot choose (the twin of reverting one).
    case 'pick-merge': return t('error.pickMerge')
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
    // or a repository without commits has none. The same applies to attaching
    // an upstream to HEAD.
    case 'no-branch': return t('error.noBranch')
    // The set-upstream control was rendered for a branch without tracking; if a
    // config appeared meanwhile, replacing it silently would lose that choice.
    case 'has-upstream': return t('error.hasUpstream')
    // The remote-tracking ref that justified the action disappeared: refresh
    // will recompute which remote write (if any) still applies.
    case 'upstream-missing': return t('error.upstreamMissing')
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
  /** A dialog-wide busy state: Escape, the backdrop and the close button are
   * all suppressed while it is set, so an in-flight write can't be dismissed
   * out from under its own error line. */
  busy?: boolean
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
  /** A modifier class for the frame (`gp-modal--sm` stays): a dialog whose body
   * is a list rather than a form sizes and pads itself through it. */
  variant?: string
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

function ModalShell({ onClose, title, icon, hash, body, footer, busy: busyProp, overlay, portalKey, container, trapFocus, variant, t }: ModalShellProps): JSX.Element {
  // Busy is declared, never inferred: an overlay only exists for dialogs that
  // also pass a label, and inferring from it left reset/revert/tag-delete
  // dismissible mid-flight (their error line then had no dialog to render in).
  const busy = busyProp === true
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  // Escape stays with this shell (it knows about `busy`) unless it traps focus:
  // then the shared hook owns Tab, focus restore and the key, starting on the
  // safe button.
  useDialogFocus(frameRef, onClose, trapFocus === true ? closeRef : undefined, undefined, trapFocus === true)
  useLayoutEffect(() => {
    // A dialog that opens with focus still on the page leaves a keyboard user
    // tabbing through the content behind it (and screen readers announce nothing
    // new). Forms start in their input, confirmations on the safe button.
    if (trapFocus === true) return
    const root = frameRef.current
    const target = root?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select')
      ?? root?.querySelector<HTMLElement>('.gp-modal__footer .gp-btn')
    target?.focus()
  }, [trapFocus])
  useEffect(() => {
    // A focus-trapping shell gets Escape from `useDialogFocus` instead.
    if (trapFocus === true) return undefined
    // While an op runs, swallow Escape so the dialog can't be dismissed
    // mid-flight; while another overlay is stacked above (the comparison overlay
    // on top of its picker), the key belongs to that one — both listeners are on
    // `document`, so without this check one keystroke closes both layers.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || busy) return
      if (!isTopOverlay(backdropRef.current)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy, trapFocus])
  const modal = h('div', {
    ref: backdropRef,
    className: 'gp-modal-backdrop',
    // Declares this dialog as an overlay above the page, so a lower layer's
    // Escape handler (the branch drawer) can yield the keystroke to it.
    [OVERLAY_ATTR]: '',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (!busy && e.target === e.currentTarget) onClose() },
  }, h('div', { ref: frameRef, className: `gp-modal gp-modal--sm${variant === undefined ? '' : ` ${variant}`}`, role: 'dialog', 'aria-modal': true, 'aria-label': title }, [
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
  /** An extra client-side gate on the confirm button (an acknowledgement
   * checkbox the caller renders in `extra`), separate from `confirmBusy`: the
   * button is disabled but the dialog stays dismissible. */
  confirmDisabled?: boolean
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
 * stash drop, branch delete). A plain text body + the shared AI hint over the
 * shell. */
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
    footer: renderModalFooter({ onClose: cb.onClose, onConfirm: cb.onConfirm, confirmLabel: cb.confirmLabel, confirmDisabled: cb.confirmBusy === true || cb.confirmDisabled === true, danger: cb.danger, t: cb.t }),
    ...(cb.confirmBusy === true ? { busy: true } : {}),
    ...(showOverlay ? { overlay: renderBusyOverlay(cb.busyLabel!) } : {}),
  })
}
