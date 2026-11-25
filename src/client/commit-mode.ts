/**
 * The commit action chosen for a session's split commit button.
 *
 * This is a workflow preference, not repository data: it lives in this module's
 * map keyed by the DSH session id, so switching tabs (or remounting the panel
 * inside the same session) keeps it, while a page reload starts from `commit`
 * again. It is deliberately *not* written to the plugin config: the choice only
 * describes how the next click behaves, and a value that outlives the
 * conversation would silently turn the primary button into a network write
 * weeks later.
 */

/** `commit` = the primary button only records; `commit-push` = commit, then push. */
export type CommitMode = 'commit' | 'commit-push'

const modes = new Map<string, CommitMode>()

/** The mode this session remembered; `commit` until changed. */
export function commitModeFor(sessionId: string): CommitMode {
  return modes.get(sessionId) ?? 'commit'
}

/** Remember the chosen mode for the session; `commit` drops the entry instead
 * of storing the default. */
export function rememberCommitMode(sessionId: string, mode: CommitMode): void {
  if (mode === 'commit') modes.delete(sessionId)
  else modes.set(sessionId, mode)
}
