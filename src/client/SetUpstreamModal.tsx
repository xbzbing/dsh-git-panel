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
 * Mount only while open. A changed repository / branch / HEAD / candidate set
 * invalidates the confirmation: the choice no longer describes what the user
 * saw, so the dialog closes rather than writing a different remote.
 */
export function SetUpstreamModal({ snapshot, onAction, onClose, t, onBusyChange }: SetUpstreamModalProps): JSX.Element | null {
  const candidates = upstreamCandidates(snapshot)
  const scope = JSON.stringify([snapshot.root, snapshot.branch, snapshot.head, candidates.map((c) => c.name)])
  const openedScope = useRef(scope)
  const current = useRef({ scope, snapshot })
  current.current = { scope, snapshot }
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const [selected, setSelected] = useState(() => defaultRemote(candidates))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sameScope = scope === openedScope.current

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // The branch lost the precondition (an upstream appeared, HEAD moved out of
  // the branch) or the candidate set changed: drop the stale confirmation
  // rather than attaching a remote the user never approved.
  useEffect(() => {
    if (!sameScope || !canSetUpstream(snapshot)) {
      if (!inFlight.current) onClose()
    }
  }, [sameScope, snapshot, busy, onClose])

  const runSetUpstream = async (): Promise<void> => {
    // The ref closes the double-click window before React paints the busy state.
    if (inFlight.current || current.current.scope !== openedScope.current) return
    const target = current.current.snapshot
    const list = upstreamCandidates(target)
    const chosen = list.find((c) => c.name === selected) ?? list[0]
    if (chosen === undefined || !canSetUpstream(target)) return
    inFlight.current = true
    setError(null)
    setBusy(true)
    onBusyChange?.(true)
    try {
      const res = await onAction({ kind: 'set-upstream', remote: chosen.name })
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
    title: t('status.setUpstream'),
    body: t('status.setUpstreamBody', { branch: snapshot.branch ?? 'HEAD' }),
    extra: h('div', { key: 'candidates', className: 'gp-upstream__list' }, candidates.map((c) => h('label', {
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
    confirmDisabled: candidates.length === 0,
    busyLabel: t('status.settingUpstream'),
    onConfirm: () => void runSetUpstream(),
    onClose: () => { if (!inFlight.current) onClose() },
    t,
  })
}
