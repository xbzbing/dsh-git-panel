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
  /** True while this dialog's op is in flight; a second press is a no-op. */
  readonly busy: boolean
  readonly setBusy: (busy: boolean) => void
  readonly setError: (message: string | null) => void
}

/** Per-path writes (`run`): nothing about the work tree changed yet on error. */
export async function runRemoteAction(
  env: OpEnv,
  remote: GitPanelRemote,
  sessionId: string,
  action: GitAction,
  onOk: () => void,
  describe: (code: string, message: string | undefined) => string,
  fallback: string,
): Promise<void> {
  if (env.busy) return
  env.setError(null)
  env.setBusy(true)
  try {
    const res = await remote.run({ sessionId, action })
    if (res.ok) onOk()
    else env.setError(describe(res.error.code, res.error.message))
  } catch (error) {
    env.setError(error instanceof Error ? error.message : fallback)
  } finally {
    env.setBusy(false)
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
  if (env.busy) return
  env.setError(null)
  env.setBusy(true)
  try {
    const res = await run(action)
    if (res.ok) onOk()
    else env.setError(res.error ?? fallback)
  } catch (error) {
    env.setError(error instanceof Error ? error.message : fallback)
  } finally {
    env.setBusy(false)
  }
}
