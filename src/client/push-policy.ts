import type { GitRemote, GitSnapshot } from './types.js'

/** Offer only ordinary pushes from a branch strictly ahead of its upstream. */
export function canPush(snapshot: GitSnapshot): boolean {
  return snapshot.hasUpstream === true && snapshot.ahead > 0 && snapshot.behind === 0
}

/**
 * Offer the merge-based sync when the branch is diverged: fetch the upstream,
 * merge it into HEAD, then push the ordinary way. The merge is additive (a
 * merge commit, never a rewrite), and the push it enables is a fast-forward
 * because the upstream tip is now an ancestor. Gated on the host capability:
 * a host that predates the action must not be sent one it would reject.
 */
export function canSync(snapshot: GitSnapshot): boolean {
  return snapshot.capabilities?.syncMerge === true
    && snapshot.hasUpstream === true
    && snapshot.branch !== null
    && snapshot.ahead > 0 && snapshot.behind > 0
}

/**
 * The remotes that can be attached as upstream: every remote whose same-named
 * branch points at HEAD. A host that predates the list sends nothing, which
 * reads as "no candidate" — the panel then keeps offering `publish`.
 */
export function upstreamCandidates(snapshot: GitSnapshot): readonly GitRemote[] {
  return snapshot.remoteCandidates ?? []
}

/**
 * Offer attaching the upstream when at least one remote already carries a
 * same-named branch at HEAD: the only missing piece is the local tracking
 * config, so `push -u` would push nothing. The client always asks which remote
 * to attach (origin preselected); the host re-checks the chosen ref before
 * writing the config.
 */
export function canSetUpstream(snapshot: GitSnapshot): boolean {
  return snapshot.hasUpstream !== true
    && snapshot.branch !== null
    && snapshot.unborn !== true
    && snapshot.head !== null && snapshot.head !== ''
    && upstreamCandidates(snapshot).length > 0
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
    && upstreamCandidates(snapshot).length === 0
    && snapshot.branch !== null
    && snapshot.unborn !== true
    && snapshot.head !== null && snapshot.head !== ''
    && snapshot.remote !== null
}

/** The remote write the sync controls offer for this snapshot; null = none. */
export type PushIntent = 'sync' | 'push' | 'set-upstream' | 'publish'

/** One source for every push-shaped control, so a branch that cannot be pushed
 * can still be attached or published (and no two states can ever both show). */
export function pushIntent(snapshot: GitSnapshot): PushIntent | null {
  if (canSync(snapshot)) return 'sync'
  if (canPush(snapshot)) return 'push'
  if (canSetUpstream(snapshot)) return 'set-upstream'
  if (canPublish(snapshot)) return 'publish'
  return null
}
