/**
 * GitAction → command sequence construction + execution.
 */
import { join, sep } from 'node:path'
import type { SnapshotDeps, GitPanelConfig } from './core.ts'
import { mapWorkspaceFailure, resolveWorkspace, runCommand, snapshotForSession } from './core.ts'
import { isSafeBranchName, isSafePath, isSafeRev } from './validate.ts'
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
    case 'tag-create': {
      if (!isSafeBranchName(action.name)) return { error: 'invalid-name', message: `unsafe tag name: ${action.name}` }
      if (!isSafeRev(action.commit)) return { error: 'invalid-name', message: `unsafe commit: ${action.commit}` }
      const msg = action.message?.trim() ?? ''
      // A message makes it an annotated tag (-a -m); otherwise a lightweight tag.
      const flags = msg === '' ? [] : ['-a', '-m', msg]
      return { argv: [['git', 'tag', ...flags, '--end-of-options', action.name, action.commit]] }
    }
    case 'tag-delete':
      if (!isSafeBranchName(action.name)) return { error: 'invalid-name', message: `unsafe tag name: ${action.name}` }
      return { argv: [['git', 'tag', '-d', '--end-of-options', action.name]] }
    case 'stash-push': {
      const msg = action.message?.trim() ?? ''
      // `-m` makes the stash subject the user's text; without it git auto-labels
      // ("WIP on <branch>: …"). `--` would need a pathspec, so it is omitted.
      return { argv: [msg === '' ? ['git', 'stash', 'push'] : ['git', 'stash', 'push', '-m', msg]] }
    }
    case 'stash-apply':
    case 'stash-pop':
    case 'stash-drop': {
      if (!Number.isInteger(action.index) || action.index < 0) {
        return { error: 'invalid-index', message: `invalid stash index: ${action.index}` }
      }
      const verb = action.kind === 'stash-apply' ? 'apply' : action.kind === 'stash-pop' ? 'pop' : 'drop'
      // `stash@{N}` is built from a validated non-negative integer, never raw
      // user text; `--end-of-options` keeps it an operand belt-and-suspenders.
      return { argv: [['git', 'stash', verb, '--end-of-options', `stash@{${action.index}}`]] }
    }
    case 'revert': {
      if (!isSafeRev(action.commit)) return { error: 'invalid-name', message: `unsafe commit: ${action.commit}` }
      // `--no-edit` keeps git from opening an editor (there is no TTY); the
      // default reverse-commit message is used.
      return { argv: [['git', 'revert', '--no-edit', '--end-of-options', action.commit]] }
    }
    case 'reset': {
      if (!isSafeRev(action.commit)) return { error: 'invalid-name', message: `unsafe commit: ${action.commit}` }
      if (action.mode !== 'soft' && action.mode !== 'mixed' && action.mode !== 'hard') {
        return { error: 'invalid-name', message: `invalid reset mode: ${String(action.mode)}` }
      }
      return { argv: [['git', 'reset', `--${action.mode}`, '--end-of-options', action.commit]] }
    }
  }
}

/** True when a command outcome failed specifically on the git index lock. */
function isIndexBusy(outcome: Awaited<ReturnType<typeof runCommand>>): boolean {
  if (!('run' in outcome) || outcome.run.exitCode === 0) return false
  return /index\.lock|Unable to create.*index|another git process/i.test(outcome.run.stderr + outcome.run.stdout)
}

/**
 * Classify a non-zero git exit into a wire error code + message. Order is
 * semantic and must not be reshuffled:
 *  - conflict first — a stash apply/pop conflict prints both "CONFLICT …" and
 *    "no changes added to commit", so it must win over the nothing-to-commit
 *    rule below (git keeps the stash entry on conflict → recoverable).
 *  - index.lock busy (another process holds the lock).
 *  - nothing-to-commit / no changes added (a real commit no-op).
 *  - not-found (missing ref / tag / stash).
 *  - local-changes-block (a dirty-worktree refusal; neutral wording covers both
 *    `git checkout` and `git stash apply`).
 *  - git-error fallback (surface the repo's own stderr).
 */
export function classifyActionFailure(stdout: string, stderr: string, exitCode: number): { code: GitErrorCode; message: string } {
  const combined = stderr + stdout
  const err = stderr.trim()
  if (/CONFLICT|Merge conflict|needs merge|could not restore untracked/i.test(combined)) {
    return { code: 'conflict', message: err || 'merge conflict' }
  }
  if (/index\.lock|Unable to create.*index|another git process/i.test(combined)) {
    return { code: 'index-busy', message: err }
  }
  if (/nothing to commit|no changes added/i.test(combined)) {
    return { code: 'git-error', message: err || 'nothing to commit' }
  }
  if (/No such ref|not a valid reference|is not a stash|no tag|tag .* not found|unknown revision|bad revision|Could not parse object|ambiguous argument/i.test(combined)) {
    return { code: 'not-found', message: err || 'not found' }
  }
  if (/would be overwritten by (checkout|merge)|local changes|overwritten by merge|Your local changes/i.test(stderr)) {
    return { code: 'local-changes-block', message: err }
  }
  return { code: 'git-error', message: err || `git exited ${exitCode}` }
}

/** Execute a management action, returning the fresh snapshot on success. */
export async function runAction(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  request: GitActionRequest,
): Promise<GitActionResult> {
  const workspace = await resolveWorkspace(deps, request.sessionId)
  if (!workspace.ok) return { ok: false, error: mapWorkspaceFailure(workspace.failure) }
  const root = workspace.root

  // Detect unborn for correct unstage semantics.
  const headProbe = await runCommand(deps.run, ['git', 'rev-parse', '--verify', 'HEAD'], root, 'head-probe', deps.signal)
  const unborn = !('run' in headProbe) || headProbe.run.exitCode !== 0

  // Stash is a stack addressed by position; under a shared worktree another
  // actor can push/pop/drop between the list query and this action, shifting
  // every index. Resolve `stash@{N}` to its SHA now and reject if it no longer
  // matches the entry the client acted on — otherwise a drop could destroy the
  // wrong (unrecoverable) stash. TOCTOU window is cut to this rev-parse.
  const act = request.action
  if (act.kind === 'stash-apply' || act.kind === 'stash-pop' || act.kind === 'stash-drop') {
    if (!Number.isInteger(act.index) || act.index < 0) {
      return { ok: false, error: { code: 'invalid-index', message: `invalid stash index: ${act.index}` } }
    }
    const probe = await runCommand(deps.run, ['git', 'rev-parse', '--verify', '--quiet', '--end-of-options', `stash@{${act.index}}`], root, 'stash-verify', deps.signal)
    const sha = 'run' in probe && probe.run.exitCode === 0 ? probe.run.stdout.trim() : ''
    if (sha === '' || sha !== act.sha) {
      return { ok: false, error: { code: 'not-found', message: 'stash entry changed; refresh and retry' } }
    }
  }

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
  // A per-path commit is two steps (add then commit); on failure include which
  // argv failed so the caller isn't left guessing whether the add or the commit
  // broke (the sequence is not atomic — the add may have staged already).
  for (let step = 0; step < plan.argv.length; step += 1) {
    const argv = plan.argv[step]!
    let outcome = await runCommand(deps.run, argv, root, 'action', deps.signal)
    // Shared-worktree contention: another git process (often the dsh AI agent)
    // holds .git/index.lock. Retry once after a short delay before surfacing a
    // friendly "git busy" error instead of the raw lock message.
    if (isIndexBusy(outcome)) {
      await new Promise((resolve) => setTimeout(resolve, 150))
      outcome = await runCommand(deps.run, argv, root, 'action-retry', deps.signal)
    }
    const where = plan.argv.length > 1 ? ` (step ${step + 1}/${plan.argv.length}: ${argv.join(' ')})` : ''
    if ('failure' in outcome) {
      const message = outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure)
      return { ok: false, error: { code: 'git-unavailable', message: message + where } }
    }
    if (outcome.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
    if (outcome.run.timedOut) return { ok: false, error: { code: 'timeout' } }
    lastOutput = outcome.run.stdout || outcome.run.stderr
    if (outcome.run.exitCode !== 0) {
      const failure = classifyActionFailure(outcome.run.stdout, outcome.run.stderr, outcome.run.exitCode ?? -1)
      // A conflicting `git revert` leaves the repository in the "reverting"
      // state (REVERT_HEAD + sequencer), which the panel offers no way to
      // continue/skip and which also blocks the shared-worktree dsh AI's own
      // commits. The user has made no resolution yet, so abort immediately to
      // restore the pre-revert state (unrelated dirty changes are preserved by
      // --abort) and report a conflict that was cancelled, not one to resolve.
      if (request.action.kind === 'revert' && failure.code === 'conflict') {
        await runCommand(deps.run, ['git', 'revert', '--abort'], root, 'revert-abort', deps.signal)
        return { ok: false, error: { code: 'revert-conflict', message: failure.message + where } }
      }
      return { ok: false, error: { code: failure.code, message: failure.message + where } }
    }
    // `git stash push` with nothing to stash (e.g. only untracked files) prints
    // "No local changes to save" and exits 0 — a silent no-op that would look
    // like a successful stash. Surface it as a failure so the UI reports it.
    if (request.action.kind === 'stash-push' && /No local changes to save/i.test(outcome.run.stdout + outcome.run.stderr)) {
      return { ok: false, error: { code: 'git-error', message: (outcome.run.stdout.trim() || 'No local changes to save') + where } }
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
