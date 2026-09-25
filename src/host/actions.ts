/**
 * GitAction → command sequence construction + execution.
 */
import type { SnapshotDeps, GitPanelConfig } from './core.ts'
import { resolveWorkspace, runCommand, snapshotForSession } from './core.ts'
import { isSafeBranchName, isSafePath } from './validate.ts'
import type { GitAction, GitActionRequest, GitActionResult, GitErrorCode } from './types.ts'

export { isSafePath }

interface CommandPlan {
  readonly argv: readonly (readonly string[])[]
}
type PlanResult = CommandPlan | { readonly error: GitErrorCode; readonly message?: string }

function withPaths(prefixes: readonly (readonly string[])[], paths: readonly string[]): PlanResult {
  if (paths.length === 0) return { error: 'invalid-path', message: 'no paths given' }
  for (const path of paths) {
    if (!isSafePath(path)) return { error: 'invalid-path', message: `unsafe path: ${path}` }
  }
  return { argv: prefixes.map((prefix) => [...prefix, ...paths]) }
}

/** Build the git command sequence for an action. */
export function planAction(action: GitAction, unborn: boolean): PlanResult {
  switch (action.kind) {
    case 'stage':
      return withPaths([['git', 'add', '--']], action.paths)
    case 'stage-all':
      return { argv: [['git', 'add', '-A']] }
    case 'unstage':
      return unborn
        ? withPaths([['git', 'rm', '--cached', '-r', '--']], action.paths)
        : withPaths([['git', 'restore', '--staged', '--']], action.paths)
    case 'unstage-all':
      return unborn
        ? { argv: [['git', 'rm', '--cached', '-r', '--', '.']] }
        : { argv: [['git', 'restore', '--staged', '--', '.']] }
    case 'discard':
      return withPaths([['git', 'restore', '--']], action.paths)
    case 'commit': {
      const message = action.message.trim()
      const amendFlag = action.amend === true ? ['--amend'] : []
      if (message === '' && action.amend !== true) return { error: 'empty-message' }
      const msgArgs = message === '' ? [] : ['-m', message]
      if (action.paths === undefined || action.paths.length === 0) {
        return { argv: [['git', 'commit', ...amendFlag, ...msgArgs]] }
      }
      const staged = withPaths([['git', 'add', '--']], action.paths)
      if ('error' in staged) return staged
      const commitCmd = ['git', 'commit', ...amendFlag, ...msgArgs, '--', ...action.paths]
      for (const path of action.paths) {
        if (!isSafePath(path)) return { error: 'invalid-path', message: `unsafe path: ${path}` }
      }
      return { argv: [...staged.argv, commitCmd] }
    }
    case 'branch-checkout':
      if (!isSafeBranchName(action.name)) return { error: 'invalid-name', message: `unsafe branch name: ${action.name}` }
      return { argv: [['git', 'checkout', '--end-of-options', action.name]] }
    case 'fetch':
      return { argv: [['git', 'fetch', '--all', '--prune']] }
  }
}

/** Execute a management action, returning the fresh snapshot on success. */
export async function runAction(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  request: GitActionRequest,
): Promise<GitActionResult> {
  const workspace = await resolveWorkspace(deps, request.sessionId)
  if (!workspace.ok) {
    const error = workspace.failure.error
    return { ok: false, error: { code: error.code as GitErrorCode, message: 'detail' in error ? error.detail : undefined } }
  }
  const root = workspace.root

  // Detect unborn for correct unstage semantics.
  const headProbe = await runCommand(deps.run, ['git', 'rev-parse', '--verify', 'HEAD'], root, 'head-probe', deps.signal)
  const unborn = !('run' in headProbe) || headProbe.run.exitCode !== 0

  const plan = planAction(request.action, unborn)
  if ('error' in plan) return { ok: false, error: { code: plan.error, ...(plan.message ? { message: plan.message } : {}) } }

  let lastOutput = ''
  for (const argv of plan.argv) {
    const outcome = await runCommand(deps.run, argv, root, 'action', deps.signal)
    if ('failure' in outcome) {
      const message = outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure)
      return { ok: false, error: { code: 'git-unavailable', message } }
    }
    if (outcome.run.timedOut) return { ok: false, error: { code: 'timeout' } }
    lastOutput = outcome.run.stdout || outcome.run.stderr
    if (outcome.run.exitCode !== 0) {
      const stderr = outcome.run.stderr
      // "nothing to commit" is reported on stdout with a non-zero exit but is
      // not an error for our purposes when amending or committing an empty set.
      if (/nothing to commit|no changes added/i.test(stderr + lastOutput)) {
        return { ok: false, error: { code: 'git-error', message: stderr.trim() || 'nothing to commit' } }
      }
      if (/would be overwritten by checkout|local changes/i.test(stderr)) {
        return { ok: false, error: { code: 'local-changes-block', message: stderr.trim() } }
      }
      return { ok: false, error: { code: 'git-error', message: stderr.trim() || `git exited ${outcome.run.exitCode}` } }
    }
  }

  const snapshot = await snapshotForSession(deps, config, request.sessionId)
  if (!snapshot.ok) {
    return { ok: false, error: { code: 'git-error', message: 'snapshot after action failed' } }
  }
  return { ok: true, snapshot: snapshot.value, output: lastOutput.trim() }
}
