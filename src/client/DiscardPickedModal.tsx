/**
 * Confirm dialog for the toolbar's "discard picked changes" batch action
 * (issue #40). Counts only — the dialog is a guard rail, not a file list —
 * with separate lines for picks that are out of scope (index-side) and for
 * untracked targets that will be deleted from disk for good. The untracked
 * count is derived here from `snapshot × targets` so `pickDiscardTargets`
 * keeps its pure key-only contract.
 */
import { createElement as h, useMemo } from 'react'
import type { JSX } from 'react'
import { renderConfirmModal, type OpT } from './ops-modals.js'
import type { GitSnapshot } from './types.js'

export interface DiscardPickedModalProps {
  /** Deduped worktree paths to discard (the `:w` half of the selection). */
  readonly paths: readonly string[]
  /** Index-side picks kept out of the request, reported as unaffected. */
  readonly stagedOnly: readonly string[]
  /** Dialog title; defaults to the "selected changes" wording. A directory
   * scope names itself instead — the rows below are about the same counts. */
  readonly title?: string
  readonly snapshot: GitSnapshot
  readonly busy: boolean
  readonly error: string | null
  readonly onConfirm: () => void
  readonly onClose: () => void
  readonly t: OpT
}

export function DiscardPickedModal({ paths, stagedOnly, title, snapshot, busy, error, onConfirm, onClose, t }: DiscardPickedModalProps): JSX.Element | null {
  // Untracked targets are deleted from disk and were never in the object store,
  // unlike the tracked ones (`git restore --`, file survives): worth a line of
  // its own in a dialog that deliberately names no files.
  const untracked = useMemo(() => {
    const set = new Set(paths)
    return snapshot.changes.filter((c) => c.status === 'untracked' && set.has(c.path)).length
  }, [paths, snapshot])
  const notes = stagedOnly.length > 0 || untracked > 0
    ? h('div', { key: 'notes' }, [
      stagedOnly.length > 0
        ? h('div', { key: 'staged', className: 'gp-modal__confirmtext' }, t('changes.discardPickedStaged', { count: stagedOnly.length }))
        : null,
      untracked > 0
        ? h('div', { key: 'untracked', className: 'gp-modal__confirmtext' }, t('changes.discardPickedUntracked', { count: untracked }))
        : null,
    ])
    : null
  return renderConfirmModal({
    title: title ?? t('changes.discardPickedTitle'),
    // Only the count — the dialog is a guard rail, not a file list.
    body: t('changes.discardPickedBody', { count: paths.length }),
    // Index-side picks are not discarded; untracked targets are deleted from
    // disk for good. Name both counts rather than dropping them silently (an
    // unexplained shortfall is the bug report waiting to happen).
    extra: notes,
    confirmLabel: t('changes.discard'),
    danger: true,
    error,
    confirmBusy: busy,
    busyLabel: t('changes.discarding'),
    onConfirm,
    onClose,
    t,
  })
}
