/**
 * The two-step diverged sync (ADR-0036): `pull-merge` fetches the upstream and
 * merges it into the current branch, then the ordinary `push` publishes the
 * result. Split deliberately instead of one host action: a failure after the
 * merge must not hide the fact that the merge already landed — the reply of the
 * successful half carries the fresh snapshot, so the counts the user sees are
 * the post-merge ones.
 */
import type { GitAction } from './types.js'
import type { ActionReply } from './op-runner.js'
import { canPush } from './push-policy.js'

/** The half that failed. The caller needs it: a merge failure belongs in the
 * confirm dialog, a push failure leaves nothing the dialog can retry. */
export interface SyncChainResult extends ActionReply {
  readonly phase?: 'merge' | 'push'
}

/**
 * Run the chain. Returns the last reply: the merge reply when there is nothing
 * to push (no snapshot, or the branch is no longer strictly ahead), the push
 * reply on success, and a failure that keeps the post-merge snapshot when only
 * the push failed.
 */
export async function runSyncChain(
  onAction: (action: GitAction) => Promise<ActionReply>,
  fallback: string,
): Promise<SyncChainResult> {
  const merged = await onAction({ kind: 'pull-merge' })
  if (!merged.ok) return { ...merged, error: merged.error ?? fallback, phase: 'merge' }
  // A repository switch under the write drops the snapshot on purpose: pushing
  // then would target a checkout the user did not confirm.
  const after = merged.snapshot
  if (after === undefined || !canPush(after)) return merged
  const pushed = await onAction({ kind: 'push' })
  if (pushed.ok) return pushed
  return { ok: false, error: pushed.error ?? fallback, phase: 'push', ...(after === undefined ? {} : { snapshot: after }) }
}
