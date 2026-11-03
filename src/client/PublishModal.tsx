import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { renderConfirmModal, type OpT } from './ops-modals.js'
import { canPublish } from './push-policy.js'
import type { GitAction, GitSnapshot } from './types.js'

export interface PublishModalProps {
  readonly snapshot: GitSnapshot
  readonly onAction: (action: GitAction) => Promise<{ ok: boolean; error?: string }>
  readonly onClose: () => void
  readonly t: OpT
  /** Keep the opener's control disabled while the request is in flight. */
  readonly onBusyChange?: (busy: boolean) => void
}

/**
 * Confirm publishing a branch that exists only locally: `git push -u <remote>
 * HEAD` creates the same-named branch on the remote and sets it as upstream.
 * Shared by the overview status bar and the changes page toolbar so both entry
 * points carry one dialog (copy, scope guard, busy lock) instead of two.
 *
 * Mount only while open. A changed repository / branch / HEAD invalidates the
 * confirmation: the branch it would publish is no longer the one the user saw.
 */
export function PublishModal({ snapshot, onAction, onClose, t, onBusyChange }: PublishModalProps): JSX.Element | null {
  // The remote name is part of the scope: publish is the one action that sends
  // it on the wire (`push` uses the configured upstream). A repo whose primary
  // remote changes under an open dialog must re-confirm rather than create the
  // branch somewhere the user never saw.
  const scope = JSON.stringify([snapshot.root, snapshot.branch, snapshot.head, snapshot.remote?.name ?? null])
  const openedScope = useRef(scope)
  const current = useRef({ scope, snapshot })
  current.current = { scope, snapshot }
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sameScope = scope === openedScope.current
  const remote = snapshot.remote

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // The branch lost the precondition (an upstream appeared, HEAD moved out of
  // the branch) or the scope changed: drop the stale confirmation rather than
  // publishing something the user never approved.
  useEffect(() => {
    if (!sameScope || remote === null || !canPublish(snapshot)) {
      if (!inFlight.current) onClose()
    }
  }, [sameScope, snapshot, remote, busy, onClose])

  const runPublish = async (): Promise<void> => {
    // The ref closes the double-click window before React paints the busy state.
    if (inFlight.current || current.current.scope !== openedScope.current) return
    const target = current.current.snapshot
    if (target.remote === null || !canPublish(target)) return
    inFlight.current = true
    setError(null)
    setBusy(true)
    onBusyChange?.(true)
    try {
      const res = await onAction({ kind: 'publish', remote: target.remote.name })
      if (!mounted.current) return
      if (res.ok) onClose()
      else if (current.current.scope === openedScope.current) setError(res.error ?? t('error.generic'))
    } catch (e) {
      if (mounted.current && current.current.scope === openedScope.current) setError(e instanceof Error ? e.message : t('error.generic'))
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
      onBusyChange?.(false)
    }
  }

  if (!sameScope) return null
  return renderConfirmModal({
    title: t('status.publishConfirmTitle'),
    body: t('status.publishConfirmBody', { branch: snapshot.branch ?? 'HEAD', remote: remote?.name ?? 'origin' }),
    confirmLabel: t('status.publishConfirm'),
    danger: false,
    error,
    confirmBusy: busy,
    busyLabel: t('status.publishing'),
    onConfirm: () => void runPublish(),
    onClose: () => { if (!inFlight.current) onClose() },
    t,
  })
}
