/**
 * The split commit button's "commit and push" chain (issue #152).
 *
 * One click combines two writes that are each a single click on their own:
 * `commit`, then the ordinary `push` the changes toolbar offers. It stops
 * there on purpose: publish, set-upstream and the diverged sync all own a
 * confirmation dialog, and folding one of them into this click would either ask
 * after the commit already landed or silently create a remote branch.
 *
 * Contracts:
 * - A failed commit never reaches push: chaining naively would push whatever
 *   was already ahead.
 * - The push half runs only against the snapshot the commit returned. A
 *   repository switch under the write drops that snapshot deliberately, so the
 *   chain stops instead of pushing a checkout the user did not confirm.
 * - A push that cannot fast-forward (no upstream, behind, detached, unborn) is
 *   skipped instead of attempted, and amending an already-pushed tip is skipped
 *   with its own reason: the panel never force-pushes.
 * - A failed push never unwinds the commit: the caller keeps it and reports the
 *   reason.
 */
import type { GitAction, GitSnapshot } from './types.js'
import type { ActionReply } from './op-runner.js'
import { pushBlockedReason, type PushBlockReason } from './push-policy.js'

/** Why the push half could not run. Each maps to one localized sentence. */
export type CommitPushSkip = PushBlockReason | 'amend' | 'switched'

export interface CommitPushOptions {
  /** Whether this commit amends HEAD; changes what the pre-commit state means. */
  readonly amend: boolean
  /** Called before each half so the button can name what is running. */
  readonly onPhase?: (phase: 'commit' | 'push') => void
}

export interface CommitPushResult {
  readonly committed: boolean
  readonly pushed: boolean
  /** The commit error, or the push error; already localized by `onAction`. */
  readonly error?: string
  /** Why the push half was skipped; only set when `committed` is true. */
  readonly skip?: CommitPushSkip
  /** Behind count for the skip message; absent when the reason does not need it. */
  readonly behind?: number
  /** The half that produced `error`. */
  readonly phase?: 'commit' | 'push'
  readonly snapshot?: GitSnapshot
}

/**
 * Why the ordinary push cannot run against this snapshot, or null when it can.
 * The fast-forward preconditions are `pushBlockedReason`'s (one source with the
 * toolbar); only `amend` is chain-specific: an amended tip that is still
 * published (`ahead === 0`) is no longer an ancestor of the upstream, so git
 * would reject the push and the panel never forces.
 */
export function pushSkipReason(snapshot: GitSnapshot, amend: boolean): CommitPushSkip | null {
  const blocked = pushBlockedReason(snapshot)
  if (blocked !== null) return blocked
  if (amend && snapshot.ahead === 0) return 'amend'
  return null
}

/**
 * Commit, then push when — and only when — the commit landed and the fresh
 * snapshot can still fast-forward. `before` is the snapshot the button was
 * pressed under, and it is read for one question only: an amend of a published
 * commit (skip with its own reason) looks exactly like an amend of an unpushed
 * one once the commit has landed, because both then read as diverged.
 *
 * Every other reason comes from the snapshot the commit returned, never from
 * `before`: the commit itself changes the state the reason describes. In an
 * empty repository `before.unborn` is true, yet the commit it just made exists,
 * so the honest reason is the one that still holds afterwards (`no-upstream`).
 * Reading `before` first also paired a reason with `after.behind`, which could
 * name a number from a different snapshot than the reason.
 */
export async function runCommitPush(
  onAction: (action: GitAction) => Promise<ActionReply>,
  commitAction: GitAction,
  before: GitSnapshot,
  options: CommitPushOptions,
  fallback: string,
): Promise<CommitPushResult> {
  const amendSkip: CommitPushSkip | null =
    options.amend && pushSkipReason(before, true) === 'amend' ? 'amend' : null
  options.onPhase?.('commit')
  const committed = await onAction(commitAction)
  if (!committed.ok) return { committed: false, pushed: false, error: committed.error ?? fallback, phase: 'commit' }
  const after = committed.snapshot
  // No snapshot = the repository switched under the write: never chain onto it.
  if (after === undefined) return { committed: true, pushed: false, skip: 'switched' }
  const skip = amendSkip ?? pushSkipReason(after, false)
  if (skip !== null) return { committed: true, pushed: false, skip, behind: after.behind, snapshot: after }

  options.onPhase?.('push')
  const pushed = await onAction({ kind: 'push' })
  if (!pushed.ok) {
    return { committed: true, pushed: false, error: pushed.error ?? fallback, phase: 'push', snapshot: after }
  }
  return { committed: true, pushed: true, snapshot: pushed.snapshot ?? after }
}
