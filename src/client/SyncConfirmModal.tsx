/**
 * The one confirmation shared by the status bar and the changes toolbar for a
 * diverged sync (ADR-0036). It owns the two-step chain, the busy lock and — as
 * `PublishModal` does — the scope captured at open time: a confirmation the
 * user gave for one checkout must never merge/push a branch they did not see.
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitAction, GitSnapshot } from './types.js'
import type { ActionReply } from './op-runner.js'
import type { OpT } from './ops-modals.js'
import { renderConfirmModal } from './ops-modals.js'
import { canSync } from './push-policy.js'
import { runSyncChain } from './sync-flow.js'

export interface SyncConfirmModalProps {
  readonly snapshot: GitSnapshot
  readonly onAction: (action: GitAction) => Promise<ActionReply>
  readonly onClose: () => void
  /** Drives the entry's own busy state (status bar label / toolbar lock). */
  readonly onBusyChange?: (busy: boolean) => void
  /** A push-half failure cannot be retried here: the merge already landed and
   * `behind` is 0, so re-running would only merge again. The caller shows the
   * sync-specific text in its own error slot after this dialog closes. */
  readonly onError: (message: string) => void
  readonly t: OpT
}

export function SyncConfirmModal({ snapshot, onAction, onClose, onBusyChange, onError, t }: SyncConfirmModalProps): JSX.Element | null {
  // Root + branch + HEAD identify the checkout the user approved. The counts
  // are refreshed into the body, but a moved HEAD is a different target.
  const scope = JSON.stringify([snapshot.root, snapshot.branch, snapshot.head])
  const openedScope = useRef(scope)
  const current = useRef({ scope, snapshot })
  current.current = { scope, snapshot }
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sameScope = scope === openedScope.current

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // A stale confirmation is dropped, not retargeted: an in-flight chain
  // finishes and reports its own outcome, while an idle dialog closes as soon
  // as the checkout moves or the branch stops being diverged.
  useEffect(() => {
    if ((!sameScope || !canSync(current.current.snapshot)) && !inFlight.current) onClose()
  }, [sameScope, snapshot, onClose])

  const run = async (): Promise<void> => {
    // The ref closes the double-click window before React paints `busy`.
    if (inFlight.current) return
    if (current.current.scope !== openedScope.current) { onClose(); return }
    const target = current.current.snapshot
    if (!canSync(target)) { onClose(); return }
    inFlight.current = true
    setError(null)
    setBusy(true)
    onBusyChange?.(true)
    try {
      const res = await runSyncChain(onAction, t('error.generic'))
      if (!mounted.current) return
      if (res.ok) { onClose(); return }
      if (res.phase === 'push') {
        // Merge landed; a second sync would create another merge commit and be
        // rejected again. Close and let the caller explain the push half.
        onError(t('sync.pushFailed'))
        onClose()
        return
      }
      if (current.current.scope === openedScope.current) setError(res.error ?? t('error.generic'))
      else onClose()
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : t('error.generic'))
    } finally {
      inFlight.current = false
      // The parent's lock must be released even if this dialog itself was
      // unmounted by a scope change while the chain was running.
      onBusyChange?.(false)
      if (mounted.current) setBusy(false)
    }
  }

  return renderConfirmModal({
    title: t('sync.title'),
    body: t('sync.body', { ahead: snapshot.ahead, behind: snapshot.behind, branch: snapshot.branch ?? '' }),
    confirmLabel: t('sync.confirm'),
    danger: false,
    error,
    confirmBusy: busy,
    confirmDisabled: !sameScope,
    busyLabel: t('status.syncing'),
    onConfirm: () => void run(),
    onClose,
    t,
  })
}
