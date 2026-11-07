/**
 * The busy/error envelope every low-frequency write uses: one op at a time, the
 * previous error cleared, and either the success side effect or a localized
 * error on the dialog. Two entry points because the two write paths report
 * differently — `remote.run` returns a wire code the panel translates, while the
 * controller's `onAction` already returns display text.
 */
import type { GitAction } from './types.js'
import type { GitPanelRemote } from './rpc.js'

export interface OpEnv {
  /** True while this op is in flight; a second press is a no-op. */
  readonly busy: boolean
  readonly setBusy: (busy: boolean) => void
  readonly setError: (message: string | null) => void
  /** In-flight marker for a write that has no dialog to absorb a double press:
   * React repaints `busy` one paint after the press, so two synchronous presses
   * both read the stale `busy: false`. Writes owned by a dialog omit it. */
  readonly inFlight?: { current: boolean } | undefined
}

/** Claim the op; false when an earlier press already holds it. */
function claim(env: OpEnv): boolean {
  if (env.inFlight?.current === true || env.busy) return false
  if (env.inFlight !== undefined) env.inFlight.current = true
  env.setBusy(true)
  return true
}

function release(env: OpEnv): void {
  if (env.inFlight !== undefined) env.inFlight.current = false
  env.setBusy(false)
}

/** Per-path writes (`run`): nothing about the work tree changed yet on error. */
export async function runRemoteAction(
  env: OpEnv,
  remote: GitPanelRemote,
  sessionId: string,
  action: GitAction,
  onOk: () => void,
  describe: (code: string, message: string | undefined) => string | null,
  fallback: string,
): Promise<void> {
  if (!claim(env)) return
  env.setError(null)
  try {
    const res = await remote.run({ sessionId, action })
    if (res.ok) onOk()
    // A caller may turn one wire code into a dialog step instead of an error
    // line (branch delete's "not fully merged" opens the force stage); `null`
    // leaves the error slot empty rather than printing a second copy of it.
    else env.setError(describe(res.error.code, res.error.message))
  } catch (error) {
    env.setError(error instanceof Error ? error.message : fallback)
  } finally {
    release(env)
  }
}

/** Work-tree writes (`onAction`): the reply carries the fresh snapshot, and its
 * failure is already localized. */
export async function runSnapshotAction(
  env: OpEnv,
  run: (action: GitAction) => Promise<{ readonly ok: boolean; readonly error?: string }>,
  action: GitAction,
  onOk: () => void,
  fallback: string,
): Promise<void> {
  if (!claim(env)) return
  env.setError(null)
  try {
    const res = await run(action)
    if (res.ok) onOk()
    else env.setError(res.error ?? fallback)
  } catch (error) {
    env.setError(error instanceof Error ? error.message : fallback)
  } finally {
    release(env)
  }
}
