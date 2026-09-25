/**
 * GitAction → command sequence construction + execution.
 */
import { join, sep } from 'node:path'
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
      const amend = action.amend === true
      if (message === '' && !amend) return { error: 'empty-message' }
      // amend + empty message: reuse the previous message. Without -m and with
      // no TTY (`stdin:'ignore'`) git would abort asking for a message, so pass
      // --no-edit to keep the existing one.
      const amendFlag = amend ? ['--amend'] : []
      const msgArgs = message === '' ? ['--no-edit'] : ['-m', message]
      if (action.paths === undefined || action.paths.length === 0) {
        return { argv: [['git', 'commit', ...amendFlag, ...msgArgs]] }
      }
      const staged = withPaths([['git', 'add', '--']], action.paths)
      if ('error' in staged) return staged
      const commitCmd = ['git', 'commit', ...amendFlag, ...msgArgs, '--', ...action.paths]
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

  // Discard of an untracked path can't go through `git restore` (pathspec does
  // not match a known file); delete those from the work tree directly, with a
  // realpath-containment check, and let git restore only the tracked ones.
  if (request.action.kind === 'discard') {
    const removed = await discardUntracked(deps, config, root, request.sessionId, request.action.paths)
    if (removed !== null) {
      if (!removed.ok) return removed.result
      if (removed.remainingTracked.length === 0) {
        const snapshot = await snapshotForSession(deps, config, request.sessionId)
        if (!snapshot.ok) return { ok: false, error: { code: 'git-error', message: 'snapshot after action failed' } }
        return { ok: true, snapshot: snapshot.value, output: '' }
      }
      request = { ...request, action: { kind: 'discard', paths: removed.remainingTracked } }
    }
  }

  const plan = planAction(request.action, unborn)
  if ('error' in plan) return { ok: false, error: { code: plan.error, ...(plan.message ? { message: plan.message } : {}) } }

  let lastOutput = ''
  for (const argv of plan.argv) {
    const outcome = await runCommand(deps.run, argv, root, 'action', deps.signal)
    if ('failure' in outcome) {
      const message = outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure)
      return { ok: false, error: { code: 'git-unavailable', message } }
    }
    if (outcome.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
    if (outcome.run.timedOut) return { ok: false, error: { code: 'timeout' } }
    lastOutput = outcome.run.stdout || outcome.run.stderr
    if (outcome.run.exitCode !== 0) {
      const stderr = outcome.run.stderr
      // "nothing to commit" exits non-zero: report it as a git-error with the
      // repo's own message rather than a bare exit code.
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

/**
 * Split a discard request into untracked paths (deleted from the work tree
 * directly, since `git restore` can't touch them) and tracked paths (left for
 * the git command). Returns null when the action doesn't need this split
 * (no untracked path among the request). Each unlink is realpath-contained to
 * the repository root before it runs.
 */
async function discardUntracked(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  root: string,
  sessionId: string,
  paths: readonly string[],
): Promise<null | { ok: true; remainingTracked: readonly string[] } | { ok: false; result: GitActionResult }> {
  const snap = await snapshotForSession(deps, config, sessionId)
  if (!snap.ok) return null
  const untrackedSet = new Set(snap.value.changes.filter((c) => c.status === 'untracked').map((c) => c.path))
  const untracked = paths.filter((p) => untrackedSet.has(p))
  if (untracked.length === 0) return null
  const tracked = paths.filter((p) => !untrackedSet.has(p))
  let rootReal: string
  try {
    rootReal = await deps.fs.realpath(root)
  } catch {
    return { ok: false, result: { ok: false, error: { code: 'git-error', message: 'repository root unavailable' } } }
  }
  for (const path of untracked) {
    if (!isSafePath(path)) return { ok: false, result: { ok: false, error: { code: 'invalid-path', message: `unsafe path: ${path}` } } }
    const target = join(root, path)
    let targetReal: string
    try {
      targetReal = await deps.fs.realpath(target)
    } catch {
      continue // already gone — nothing to discard
    }
    if (targetReal !== rootReal && !targetReal.startsWith(rootReal + sep)) {
      return { ok: false, result: { ok: false, error: { code: 'invalid-path', message: `path escapes repository: ${path}` } } }
    }
    await deps.fs.remove(target).catch(() => {})
  }
  return { ok: true, remainingTracked: tracked }
}
