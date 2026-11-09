import type { GitSnapshot } from './types.js'

/** Offer only ordinary pushes from a branch strictly ahead of its upstream. */
export function canPush(snapshot: GitSnapshot): boolean {
  return snapshot.hasUpstream === true && snapshot.ahead > 0 && snapshot.behind === 0
}

/**
 * Offer attaching the upstream when the primary remote already carries a
 * same-named branch at HEAD: the only missing piece is the local tracking
 * config, so `push -u` would push nothing. The snapshot's flag proves both the
 * remote branch and the identical commit from local refs; the host re-checks
 * that the ref still exists before writing the config.
 */
export function canSetUpstream(snapshot: GitSnapshot): boolean {
  return snapshot.hasUpstream !== true
    && snapshot.remoteBranchAtHead === true
    && snapshot.branch !== null
    && snapshot.unborn !== true
    && snapshot.head !== null && snapshot.head !== ''
    && snapshot.remote !== null
}

/**
 * Offer publishing when the current branch exists only locally: it has no
 * upstream yet, HEAD is on a branch (not detached), there is at least one
 * commit to send (an unborn branch has nothing to push), and a remote exists to
 * create the branch on. A same-named remote branch at HEAD is not published —
 * it is merely attached (`canSetUpstream`), so the two states never overlap.
 * Creating a same-named branch on the remote cannot overwrite anything, so this
 * needs no ahead/behind reconciliation.
 */
export function canPublish(snapshot: GitSnapshot): boolean {
  return snapshot.hasUpstream !== true
    && snapshot.remoteBranchAtHead !== true
    && snapshot.branch !== null
    && snapshot.unborn !== true
    && snapshot.head !== null && snapshot.head !== ''
    && snapshot.remote !== null
}

/** The remote write the sync controls offer for this snapshot; null = none. */
export type PushIntent = 'push' | 'set-upstream' | 'publish'

/** One source for every push-shaped control, so a branch that cannot be pushed
 * can still be attached or published (and no two states can ever both show). */
export function pushIntent(snapshot: GitSnapshot): PushIntent | null {
  if (canPush(snapshot)) return 'push'
  if (canSetUpstream(snapshot)) return 'set-upstream'
  if (canPublish(snapshot)) return 'publish'
  return null
}
