import { createElement as h, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { renderConfirmModal, type OpT } from './ops-modals.js'
import { canSetUpstream, upstreamCandidates } from './push-policy.js'
import type { GitAction, GitRemote, GitSnapshot } from './types.js'

export interface SetUpstreamModalProps {
  readonly snapshot: GitSnapshot
  readonly onAction: (action: GitAction) => Promise<{ ok: boolean; error?: string }>
  readonly onClose: () => void
  readonly t: OpT
  /** Keep the opener's control disabled while the request is in flight. */
  readonly onBusyChange?: (busy: boolean) => void
}

/** The preselected remote: origin when it is a candidate, else the first one. */
function defaultRemote(candidates: readonly GitRemote[]): string {
  return candidates.find((c) => c.name === 'origin')?.name ?? candidates[0]?.name ?? ''
}

/**
 * Choose which remote's same-named branch to attach as upstream. The dialog is
 * always shown, even with a single candidate: the user explicitly confirms the
 * one config write instead of a click silently picking a remote. Shared by the
 * overview status bar and the changes page toolbar.
 *
 * Mount only while open. A changed repository / branch / HEAD invalidates the
 * confirmation outright; a changed candidate set closes an untouched dialog,
 * while a failed attempt keeps the dialog (and its error) up with confirm
 * disabled, so the user sees why nothing was written.
 */
export function SetUpstreamModal({ snapshot, onAction, onClose, t, onBusyChange }: SetUpstreamModalProps): JSX.Element | null {
  // Freeze the candidate list at open. A poll/fetch can add or prune a
  // candidate while the dialog is up; the radio rows must keep describing the
  // choice the user actually saw, not shift under the pointer.
  const [candidates] = useState(() => upstreamCandidates(snapshot))
  const candidateKey = candidates.map((c) => c.name).join('\u0000')
  const identity = JSON.stringify([snapshot.root, snapshot.branch, snapshot.head])
  const openedIdentity = useRef(identity)
  const current = useRef({ identity, snapshot })
  current.current = { identity, snapshot }
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [selected, setSelected] = useState(() => defaultRemote(candidates))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sameIdentity = identity === openedIdentity.current
  const latestKey = upstreamCandidates(snapshot).map((c) => c.name).join('\u0000')
  const sameCandidates = latestKey === candidateKey

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // The shared modal focuses the first input, which is not necessarily the
  // preselected remote (`git remote -v` sorts names, so origin can be second).
  // Move focus to the checked row so the dialog opens on the actual choice.
  useEffect(() => {
    listRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus()
  }, [])

  // A different repository / branch / HEAD makes the choice meaningless, so
  // close even if the last attempt failed. Within the same target, a candidate
  // change closes the untouched dialog; after a failure it stays open to keep
  // the error visible, with confirm disabled (the user must cancel and reopen).
  useEffect(() => {
    if (!sameIdentity) {
      if (!inFlight.current) onClose()
      return
    }
    if (error === null && (!sameCandidates || !canSetUpstream(snapshot))) {
      if (!inFlight.current) onClose()
    }
  }, [sameIdentity, sameCandidates, error, snapshot, onClose])

  const runSetUpstream = async (): Promise<void> => {
    // The ref closes the double-click window before React paints the busy state.
    if (inFlight.current || current.current.identity !== openedIdentity.current) return
    // Resolve the choice against the latest snapshot: a remote that vanished
    // must never be swapped for a different one behind the user's back.
    const target = current.current.snapshot
    const chosen = upstreamCandidates(target).find((c) => c.name === selected)
    if (chosen === undefined || !canSetUpstream(target)) return
    inFlight.current = true
    setError(null)
    setBusy(true)
    onBusyChange?.(true)
    try {
      const res = await onAction({ kind: 'set-upstream', remote: chosen.name })
      if (!mounted.current) return
      if (res.ok) onClose()
      else if (current.current.identity === openedIdentity.current) setError(res.error ?? t('error.generic'))
    } catch (e) {
      if (mounted.current && current.current.identity === openedIdentity.current) setError(e instanceof Error ? e.message : t('error.generic'))
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
      onBusyChange?.(false)
    }
  }

  if (!sameIdentity) return null
  return renderConfirmModal({
    title: t('status.setUpstream'),
    body: t('status.setUpstreamBody', { branch: snapshot.branch ?? 'HEAD' }),
    extra: h('div', {
      key: 'candidates', className: 'gp-upstream__list',
      role: 'radiogroup', 'aria-label': t('status.setUpstream'), ref: listRef,
    }, candidates.map((c) => h('label', {
      key: c.name,
      className: `gp-upstream__option${selected === c.name ? ' gp-upstream__option--on' : ''}`,
    }, [
      h('input', {
        key: 'r', type: 'radio', name: 'gp-upstream-remote', className: 'gp-check',
        checked: selected === c.name, onChange: () => setSelected(c.name),
      }),
      h('span', { key: 'tx', className: 'gp-upstream__text' }, [
        h('span', { key: 'l', className: 'gp-upstream__label' }, `${c.name}/${snapshot.branch ?? 'HEAD'}`),
        h('span', { key: 'h', className: 'gp-upstream__hint' }, c.host ?? c.url),
      ]),
    ]))),
    confirmLabel: t('status.setUpstream'),
    danger: false,
    error,
    confirmBusy: busy,
    confirmDisabled: candidates.length === 0 || !sameCandidates || !canSetUpstream(snapshot),
    busyLabel: t('status.settingUpstream'),
    onConfirm: () => void runSetUpstream(),
    onClose: () => { if (!inFlight.current) onClose() },
    t,
  })
}
