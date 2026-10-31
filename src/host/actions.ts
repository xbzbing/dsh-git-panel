/**
 * GitAction → command sequence construction + execution.
 */
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import type { SnapshotDeps, GitPanelConfig } from './core.js'
import { mapWorkspaceFailure, resolveWorkspace, runCommand, snapshotForSession } from './core.js'
import { parseStatus } from './parser.js'
import { isSafeBranchName, isSafePath, isSafeRemoteName, isSafeRev } from './validate.js'
import type { GitAction, GitActionRequest, GitActionResult, GitErrorCode } from './types.js'

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
    case 'discard-all':
      // Unreachable from runAction: the executor resolves `discard-all` into a
      // concrete `discard` (fresh status → paths) before planning. Kept as a
      // typed refusal so a future caller cannot plan it into a bare restore.
      return { error: 'invalid-path', message: 'discard-all must be resolved to paths before planning' }
    case 'commit': {
      // A mixed selection needs a temporary index (runIndexOnlyCommit); refusing
      // here keeps a future caller from silently staging every path instead.
      if ((action.indexOnly?.length ?? 0) > 0) {
        return { error: 'git-error', message: 'indexOnly commits are planned by runIndexOnlyCommit' }
      }
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
    case 'branch-checkout': {
      if (!isSafeBranchName(action.name)) return { error: 'invalid-name', message: `unsafe branch name: ${action.name}` }
      // The trailing `--` disambiguates a name that is also a work-tree path:
      // `git checkout f.txt` restores that file from the index and exits 0
      // (`git checkout .` would revert the whole work tree), which the panel
      // would report as a successful switch. As a trailing separator it is not
      // `--end-of-options` — every git version accepts it; isSafeBranchName
      // still rules out a leading dash, which is the option-position surface.
      let checkout = ['git', 'checkout', action.name, '--']
      if (action.createFrom !== undefined) {
        // A remote row: create the local branch explicitly and set its upstream.
        // `-b <name> --track <ref>` is deterministic — `git checkout <remote>/<x>`
        // would detach HEAD instead, and DWIM name inference depends on config.
        if (!isSafeBranchName(action.createFrom)) return { error: 'invalid-name', message: `unsafe tracking ref: ${action.createFrom}` }
        checkout = ['git', 'checkout', '-b', action.name, '--track', action.createFrom, '--']
      }
      const msg = action.stashMessage?.trim() ?? ''
      // Stash-then-switch (the dirty-work-tree path the dialog offers): the
      // checkout alone would be refused, so the changes go to the stash first.
      // `-u` folds untracked files in as well — git also refuses a switch when
      // an untracked file is one the target branch tracks.
      return { argv: msg === '' ? [checkout] : [['git', 'stash', 'push', '-u', '-m', msg], checkout] }
    }
    case 'fetch':
      return { argv: [['git', 'fetch', '--all', '--prune']] }
    case 'pull-ff':
      // `--ff-only` can only advance HEAD to the upstream tip; it refuses (exit
      // non-zero, work tree untouched) when the branches diverged, so there is
      // no merge/rebase or conflict path to handle here.
      return { argv: [['git', 'pull', '--ff-only']] }
    case 'push':
      // Plain `git push` (never --force): it pushes the current branch to its
      // configured upstream and the remote refuses a non-fast-forward, so a
      // diverged branch (never offered by the UI) can only be rejected, not
      // overwritten.
      return { argv: [['git', 'push']] }
    case 'publish':
      // Publish a branch with no upstream yet. The remote name comes from the
      // primary remote the client holds; revalidate it so a hostile local
      // remote name can never reach the option position. `HEAD` names the
      // current branch as the destination (no refspec to validate).
      if (!isSafeRemoteName(action.remote)) return { error: 'invalid-name', message: `unsafe remote name: ${action.remote}` }
      return { argv: [['git', 'push', '-u', action.remote, 'HEAD']] }
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
      if (!Number.isSafeInteger(action.index) || action.index < 0) {
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
      // No `--end-of-options` either: older git rejects it outright ("must
      // come before non-option arguments"); isSafeRev rules out a leading dash.
      // The trailing `--` keeps a commit-ish that is also a path (a file named
      // like a branch) out of the pathspec position.
      return { argv: [['git', 'reset', `--${action.mode}`, action.commit, '--']] }
    }
  }
}

/** True when a command outcome failed specifically on the git index lock. */
function isIndexBusy(outcome: Awaited<ReturnType<typeof runCommand>>): boolean {
  if (!('run' in outcome) || outcome.run.exitCode === 0) return false
  return /index\.lock|Unable to create.*index|another git process/i.test(outcome.run.stderr + outcome.run.stdout)
}

/**
 * The wire error for a probe that never ran (spawn failure) or never finished
 * (timeout / cancellation); null when it produced a result. A probe that broke
 * says nothing about the repository state it was meant to observe, so folding
 * it into the action's own verdict would report a condition that was never
 * established — e.g. a timed-out `symbolic-ref` is not a detached HEAD.
 */
function probeFailure(outcome: Awaited<ReturnType<typeof runCommand>>): Extract<GitActionResult, { ok: false }> | null {
  if ('failure' in outcome) {
    return { ok: false, error: { code: 'git-unavailable', message: outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure) } }
  }
  if (outcome.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
  if (outcome.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  return null
}

/** Strip an embedded credential (`scheme://user:token@host`) from a git
 * message so a token in a remote URL never reaches the RPC reply or logs. */
export function scrubCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1')
}

/**
 * Classify a non-zero git exit into a wire error code + message. Order is
 * semantic and must not be reshuffled:
 *  - conflict first — a stash apply/pop conflict prints both "CONFLICT …" and
 *    "no changes added to commit", so it must win over the nothing-to-commit
 *    rule below (git keeps the stash entry on conflict → recoverable).
 *  - index.lock busy (another process holds the lock).
 *  - nothing-to-commit / no changes added (a real commit no-op).
 *  - not-found (missing ref / tag / stash, or a checkout target that resolves
 *    to neither a ref nor a path).
 *  - branch-in-use (the target branch is checked out in another worktree).
 *  - local-changes-block (a dirty-worktree refusal; neutral wording covers both
 *    `git checkout` and `git stash apply`).
 *  - revert-merge (reverting a merge commit without a mainline parent — git
 *    refuses before touching the work tree, so it is a plain refusal).
 *  - git-error fallback (surface the repo's own stderr).
 */
export function classifyActionFailure(stdout: string, stderr: string, exitCode: number): { code: GitErrorCode; message: string } {
  const combined = stderr + stdout
  // Network git errors echo the remote URL verbatim, which may embed a
  // credential (`https://user:token@host/…`); strip it so a token never lands
  // in the RPC message or logs (matches remote.ts stripping it from hrefs).
  const err = scrubCredentials(stderr.trim())
  // Anchored at line start: a staged file may be named `CONFLICT-notes.md`, and
  // the "nothing added to commit" output lists it as ` M CONFLICT-notes.md`.
  if (/^(?:CONFLICT \(|CONFLICT:|Merge conflict|needs merge|error: could not restore untracked)/m.test(combined)) {
    return { code: 'conflict', message: err || 'merge conflict' }
  }
  if (/index\.lock|Unable to create.*index|another git process/i.test(combined)) {
    return { code: 'index-busy', message: err }
  }
  if (/nothing to commit|nothing added to commit|no changes added/i.test(combined)) {
    return { code: 'nothing-to-commit', message: err }
  }
  if (/No such ref|not a valid reference|invalid reference|is not a stash|no tag|tag .* not found|unknown revision|bad revision|Could not parse object|ambiguous argument|did not match any file\(s\) known to git/i.test(combined)) {
    return { code: 'not-found', message: err || 'not found' }
  }
  // The branch exists but is checked out in another worktree of this repo:
  // git refuses the switch (detaching it there would corrupt that worktree).
  if (/is already used by worktree|already checked out at/i.test(combined)) {
    return { code: 'branch-in-use', message: err || 'branch is checked out in another worktree' }
  }
  // A network git command (fetch/pull/push) that failed because no usable
  // credentials were available. GIT_TERMINAL_PROMPT=0 turns an interactive
  // prompt into "terminal prompts disabled", so these fail fast rather than hang.
  // Only signals that name authentication itself: ssh prints "Could not read
  // from remote repository" for every transport failure (unknown host,
  // connection refused), so that line stays out and falls through to git-error.
  if (/Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey\)|Host key verification failed/i.test(combined)) {
    return { code: 'auth-failed', message: err || 'authentication failed' }
  }
  // `git push` rejected by the remote: the remote advanced, so the push is not a
  // fast-forward. Checked before the pull `not-ff` branch because the wording
  // overlaps ("non-fast-forward").
  if (/\[rejected\]|Updates were rejected|failed to push some refs|fetch first|tip of your current branch is behind/i.test(combined)) {
    return { code: 'push-rejected', message: err || 'push rejected (remote has new commits; fetch first)' }
  }
  // `git pull --ff-only` on diverged branches: a clean refusal that leaves the
  // work tree untouched, distinct from a dirty-tree block below.
  if (/Not possible to fast-forward|cannot fast-forward|not a fast-forward|Need to specify how to reconcile divergent branches/i.test(combined)) {
    return { code: 'not-ff', message: err || 'cannot fast-forward (branches diverged)' }
  }
  if (/would be overwritten by (checkout|merge)|local changes|overwritten by merge|Your local changes/i.test(stderr)) {
    return { code: 'local-changes-block', message: err }
  }
  // Reverting a merge commit without a mainline parent: git refuses before
  // creating REVERT_HEAD, so this is a plain refusal (no stuck state) that the
  // panel surfaces with a clear message instead of the raw hint.
  if (/is a merge but no -m|mainline parent/i.test(combined)) {
    return { code: 'revert-merge', message: err || 'cannot revert a merge commit from the panel' }
  }
  return { code: 'git-error', message: err || `git exited ${exitCode}` }
}

/**
 * Commit a selection that mixes both sides of the changes list. The
 * `indexOnly` paths are committed from the index exactly as staged — re-staging
 * them would fold unstaged hunks into the commit and undo a partial
 * `git add -p`; the remaining paths are staged from the work tree first, as a
 * whole-file pick means. The commit is assembled in a temporary index seeded
 * from HEAD, so paths staged outside the selection stay staged and never enter
 * this commit.
 */
async function runIndexOnlyCommit(
  deps: SnapshotDeps,
  root: string,
  action: Extract<GitAction, { kind: 'commit' }>,
  unborn: boolean,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; output: string } | { ok: false; error: Extract<GitActionResult, { ok: false }>['error'] }> {
  const indexOnly = [...new Set(action.indexOnly ?? [])]
  const paths = action.paths ?? []
  for (const path of [...paths, ...indexOnly]) {
    if (!isSafePath(path)) return { ok: false, error: { code: 'invalid-path', message: `unsafe path: ${path}` } }
  }
  if (indexOnly.length === 0) return { ok: false, error: { code: 'invalid-path', message: 'indexOnly needs at least one path' } }
  const indexOnlySet = new Set(indexOnly)
  const worktreePaths = paths.filter((path) => !indexOnlySet.has(path))
  const indexFile = join(tmpdir(), `dsh-git-panel-${randomUUID()}.index`)
  const env = { GIT_INDEX_FILE: indexFile }

  /** Run one step of the commit and turn a broken run into a wire error. */
  const step = async (
    argv: readonly string[],
    extra?: { readonly data?: string; readonly env?: boolean },
  ): Promise<{ stdout: string } | { error: Extract<GitActionResult, { ok: false }>['error'] }> => {
    const outcome = await runCommand(
      deps.run, argv, root, 'commit-index', signal,
      extra?.data === undefined && extra?.env !== true ? undefined : { ...(extra?.data !== undefined ? { data: extra.data } : {}), ...(extra?.env === true ? { env } : {}) },
    )
    if ('failure' in outcome) {
      return { error: { code: 'git-unavailable', message: outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure) } }
    }
    if (outcome.run.cancelled) return { error: { code: 'cancelled' } }
    if (outcome.run.timedOut) return { error: { code: 'timeout' } }
    if (outcome.run.exitCode !== 0) {
      const failure = classifyActionFailure(outcome.run.stdout, outcome.run.stderr, outcome.run.exitCode ?? -1)
      return { error: { code: failure.code, message: failure.message } }
    }
    return { stdout: outcome.run.stdout }
  }

  try {
    const base = await step(['git', 'read-tree', unborn ? '--empty' : 'HEAD'], { env: true })
    if ('error' in base) return { ok: false, error: base.error }

    // Whole-file side: stage from the work tree into the real index (the
    // long-standing behaviour), then mirror those entries into the temp one.
    if (worktreePaths.length > 0) {
      const added = await step(['git', 'add', '--', ...worktreePaths])
      if ('error' in added) return { ok: false, error: added.error }
    }
    const copy = [...worktreePaths, ...indexOnly]
    const listed = await step(['git', 'ls-files', '-s', '-z', '--', ...copy])
    if ('error' in listed) return { ok: false, error: listed.error }
    const lines = listed.stdout.split('\0').filter((record) => record !== '')
    if (lines.length > 0) {
      const applied = await step(['git', 'update-index', '-z', '--index-info'], { data: listed.stdout, env: true })
      if ('error' in applied) return { ok: false, error: applied.error }
    }
    const present = new Set(lines.map((record) => record.slice(record.indexOf('\t') + 1)))
    // An index-side path with no entry is a staged deletion: the temp index was
    // seeded from HEAD, so the entry has to be dropped explicitly.
    const missing = indexOnly.filter((path) => !present.has(path))
    if (missing.length > 0) {
      const removed = await step(['git', 'update-index', '--force-remove', '--', ...missing], { env: true })
      if ('error' in removed) return { ok: false, error: removed.error }
    }
    // A staged rename carries its deletion on the old path, which the path list
    // may not mention (the list is keyed by the new path): drop it too, or the
    // commit would keep both sides.
    const renamed = await step(['git', 'diff', '--cached', '--name-status', '-z', '-M', '--', ...indexOnly])
    if ('error' in renamed) return { ok: false, error: renamed.error }
    const fields = renamed.stdout.split('\0').filter((field) => field !== '')
    const oldPaths: string[] = []
    for (let i = 0; i < fields.length; i += 1) {
      if (!fields[i]!.startsWith('R')) continue
      const from = fields[i + 1]
      i += 2
      if (from !== undefined && !indexOnlySet.has(from)) oldPaths.push(from)
    }
    if (oldPaths.length > 0) {
      const dropped = await step(['git', 'update-index', '--force-remove', '--', ...oldPaths], { env: true })
      if ('error' in dropped) return { ok: false, error: dropped.error }
    }

    const message = action.message.trim()
    const amendFlag = action.amend === true ? ['--amend'] : []
    // amend + empty message: reuse the previous message (no TTY for an editor).
    const msgArgs = message === '' ? ['--no-edit'] : ['-m', message]
    const committed = await step(['git', 'commit', ...amendFlag, ...msgArgs], { env: true })
    if ('error' in committed) return { ok: false, error: committed.error }
    return { ok: true, output: committed.stdout.trim() }
  } finally {
    await deps.fs.remove(indexFile).catch(() => undefined)
  }
}

/** Execute a management action, returning the fresh snapshot on success. */
export async function runAction(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  request: GitActionRequest,
): Promise<GitActionResult> {
  const workspace = await resolveWorkspace(deps, request.sessionId, request.repo)
  if (!workspace.ok) return { ok: false, error: mapWorkspaceFailure(workspace.failure) }
  const root = workspace.root

  // Detect unborn for correct unstage semantics.
  const headProbe = await runCommand(deps.run, ['git', 'rev-parse', '--verify', 'HEAD'], root, 'head-probe', deps.signal)
  const unborn = !('run' in headProbe) || headProbe.run.exitCode !== 0

  // Publish needs a branch for git to derive the remote destination from. Bare
  // `HEAD` is not enough on a detached HEAD or in an unborn repository: git
  // answers with a refspec hint instead of a name. Probe it here (the client's
  // snapshot may already be stale) and refuse with a clear code, so that hint
  // never surfaces as a raw git error. The command itself keeps the literal
  // `HEAD` (ADR-0007) — no ref reaches argv from the RPC. A probe that never
  // ran or never finished reports its own condition: it established nothing
  // about the branch, so it must not be read as a detached HEAD.
  if (request.action.kind === 'publish') {
    const headBroke = probeFailure(headProbe)
    if (headBroke !== null) return headBroke
    if (unborn) return { ok: false, error: { code: 'no-branch', message: 'no commits to publish' } }
    const branchProbe = await runCommand(deps.run, ['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], root, 'publish-branch', deps.signal)
    const branchBroke = probeFailure(branchProbe)
    if (branchBroke !== null) return branchBroke
    const branch = 'run' in branchProbe && branchProbe.run.exitCode === 0 ? branchProbe.run.stdout.trim() : ''
    if (branch === '') return { ok: false, error: { code: 'no-branch', message: 'detached HEAD: no branch to publish' } }
  }

  // Stash is a stack addressed by position; under a shared worktree another
  // actor can push/pop/drop between the list query and this action, shifting
  // every index. Resolve `stash@{N}` to its SHA now and reject if it no longer
  // matches the entry the client acted on — otherwise a drop could destroy the
  // wrong (unrecoverable) stash. TOCTOU window is cut to this rev-parse.
  const act = request.action
  if (act.kind === 'stash-apply' || act.kind === 'stash-pop' || act.kind === 'stash-drop') {
    if (!Number.isSafeInteger(act.index) || act.index < 0) {
      return { ok: false, error: { code: 'invalid-index', message: `invalid stash index: ${act.index}` } }
    }
    const probe = await runCommand(deps.run, ['git', 'rev-parse', '--verify', '--quiet', '--end-of-options', `stash@{${act.index}}`], root, 'stash-verify', deps.signal)
    const sha = 'run' in probe && probe.run.exitCode === 0 ? probe.run.stdout.trim() : ''
    if (sha === '' || sha !== act.sha) {
      return { ok: false, error: { code: 'not-found', message: 'stash entry changed; refresh and retry' } }
    }
  }

  // `discard-all` carries no paths on the wire: the host re-runs status itself
  // and refuses when the stream was lossy (a clipped read cannot honestly back
  // an "every change" claim). The resolved working-tree paths then ride the
  // normal `discard` pipeline below, keeping the untracked deletion guards
  // (nested-repo refusal, per-path re-check) in one place.
  if (request.action.kind === 'discard-all') {
    const status = await runCommand(deps.run, ['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], root, 'discard-all-status', deps.signal)
    if ('failure' in status) return { ok: false, error: { code: 'git-unavailable', message: status.failure instanceof Error ? status.failure.message : String(status.failure) } }
    if (status.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
    if (status.run.timedOut) return { ok: false, error: { code: 'timeout' } }
    if (status.run.exitCode !== 0) {
      const failure = classifyActionFailure(status.run.stdout, status.run.stderr, status.run.exitCode ?? -1)
      return { ok: false, error: failure }
    }
    if (status.run.stdoutLossy) {
      return { ok: false, error: { code: 'status-lossy', message: 'status output was clipped; refusing to discard an incomplete change set' } }
    }
    const all = parseStatus(status.run.stdout)
    // Working-tree side only: staged-only entries are out of scope (same
    // contract as the picked batch), so `:w` picks are the whole target set.
    const paths = [...new Set(all.filter((c) => !c.staged).map((c) => c.path))].sort()
    if (paths.length === 0) {
      const snapshot = await snapshotForSession(deps, config, request.sessionId, { repo: request.repo })
      if (!snapshot.ok) return { ok: false, error: { code: 'git-error', message: 'snapshot after action failed' } }
      return { ok: true, snapshot: snapshot.value, output: '' }
    }
    request = { ...request, action: { kind: 'discard', paths } }
  }

  // Discard of an untracked path can't go through `git restore` (pathspec does
  // not match a known file); delete those from the work tree directly, with a
  // realpath-containment check, and let git restore only the tracked ones.
  if (request.action.kind === 'discard') {
    const removed = await discardUntracked(deps, config, root, request.sessionId, request.repo, request.action.paths)
    if (removed !== null) {
      if (!removed.ok) return removed.result
      if (removed.remainingTracked.length === 0) {
        const snapshot = await snapshotForSession(deps, config, request.sessionId, { repo: request.repo })
        if (!snapshot.ok) return { ok: false, error: { code: 'git-error', message: 'snapshot after action failed' } }
        return { ok: true, snapshot: snapshot.value, output: '' }
      }
      request = { ...request, action: { kind: 'discard', paths: removed.remainingTracked } }
    }
  }

  // A selection that mixes both sides commits from a temporary index (see
  // runIndexOnlyCommit); it is not a fixed argv sequence, so it runs before the
  // planner.
  if (request.action.kind === 'commit' && (request.action.indexOnly?.length ?? 0) > 0) {
    const committed = await runIndexOnlyCommit(deps, root, request.action, unborn, deps.signal)
    if (!committed.ok) return committed
    const snap = await snapshotForSession(deps, config, request.sessionId, { repo: request.repo })
    if (!snap.ok) return { ok: false, error: { code: 'git-error', message: 'snapshot after action failed' } }
    return { ok: true, snapshot: snap.value, output: committed.output }
  }

  const plan = planAction(request.action, unborn)
  if ('error' in plan) return { ok: false, error: { code: plan.error, ...(plan.message ? { message: plan.message } : {}) } }

  // A "stash then switch" checkout is planned as [stash, checkout]; both the
  // no-op stash guard below and the partial-failure code depend on knowing which
  // step is the stash (step 0).
  const stashing = request.action.kind === 'branch-checkout' && (request.action.stashMessage?.trim() ?? '') !== ''
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
    // Stash-then-switch, step 2: the stash already succeeded, so the work tree
    // changed no matter how this step fails — a git refusal, a timeout, a
    // cancelled or unavailable git alike. Report every shape through the one
    // code that tells the caller the changes are in the stash (recoverable),
    // with the underlying reason riding along, rather than a plain error that
    // reads as "nothing happened".
    const stashChangedWorkTree = stashing && step > 0
    if ('failure' in outcome) {
      const message = outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure)
      return { ok: false, error: { code: stashChangedWorkTree ? 'stash-switch-failed' : 'git-unavailable', message: message + where } }
    }
    if (outcome.run.cancelled) {
      return { ok: false, error: stashChangedWorkTree ? { code: 'stash-switch-failed', message: 'cancelled' + where } : { code: 'cancelled' } }
    }
    if (outcome.run.timedOut) {
      return { ok: false, error: stashChangedWorkTree ? { code: 'stash-switch-failed', message: 'timed out' + where } : { code: 'timeout' } }
    }
    lastOutput = outcome.run.stdout || outcome.run.stderr
    if (outcome.run.exitCode !== 0) {
      const failure = classifyActionFailure(outcome.run.stdout, outcome.run.stderr, outcome.run.exitCode ?? -1)
      // A plain git refusal after a landed stash: same partial state, see above.
      if (stashChangedWorkTree) {
        return { ok: false, error: { code: 'stash-switch-failed', message: failure.message + where } }
      }
      // A conflicting `git revert` leaves the repository in the "reverting"
      // state (REVERT_HEAD + sequencer), which the panel offers no way to
      // continue/skip and which also blocks the shared-worktree dsh AI's own
      // commits. The user has made no resolution yet, so abort immediately to
      // restore the pre-revert state (unrelated dirty changes are preserved by
      // --abort). The abort can itself lose the index.lock race (the very
      // contention this feature guards), so verify it (with the same one-shot
      // retry) and, only if it cleared the state, report the cancelled
      // conflict; otherwise tell the user the repo is still mid-revert rather
      // than falsely claiming the work tree is untouched.
      if (request.action.kind === 'revert' && failure.code === 'conflict') {
        let abort = await runCommand(deps.run, ['git', 'revert', '--abort'], root, 'revert-abort', deps.signal)
        if (isIndexBusy(abort)) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          abort = await runCommand(deps.run, ['git', 'revert', '--abort'], root, 'revert-abort-retry', deps.signal)
        }
        const aborted = 'run' in abort && abort.run.exitCode === 0
        return aborted
          ? { ok: false, error: { code: 'revert-conflict', message: failure.message + where } }
          : { ok: false, error: { code: 'revert-stuck', message: failure.message + where } }
      }
      return { ok: false, error: { code: failure.code, message: failure.message + where } }
    }
    // `git stash push` with nothing to stash (e.g. only untracked files, or only
    // ignored ones) prints "No local changes to save" and exits 0 — a silent
    // no-op that would look like a successful stash. Surface it as a failure so
    // the UI reports it. For the stash-then-switch path the blocking changes are
    // evidently not stashable by this flow, so report the block instead of
    // jumping into a checkout that is about to be refused all over again.
    if ((request.action.kind === 'stash-push' || stashing) && /No local changes to save/i.test(outcome.run.stdout + outcome.run.stderr)) {
      const message = (outcome.run.stdout.trim() || 'No local changes to save') + where
      return { ok: false, error: { code: stashing ? 'local-changes-block' : 'git-error', message } }
    }
  }

  const snapshot = await snapshotForSession(deps, config, request.sessionId, { repo: request.repo })
  if (!snapshot.ok) {
    return { ok: false, error: { code: 'git-error', message: 'snapshot after action failed' } }
  }
  return { ok: true, snapshot: snapshot.value, output: lastOutput.trim() }
}

/**
 * Whether a work-tree directory is a repository of its own: a nested repo or a
 * submodule (`.git`, directory or file) or a bare repository (no `.git`, but a
 * `HEAD` file beside the `objects/` and `refs/` directories). `discard` refuses
 * all of them — a recursive delete would take a whole repository's history with
 * it (issue #46).
 */
async function looksLikeRepository(deps: SnapshotDeps, target: string): Promise<boolean> {
  try {
    await deps.fs.stat(join(target, '.git'))
    return true
  } catch { /* not a nested repo / submodule — check the bare layout below */ }
  const head = await pathKind(deps, join(target, 'HEAD'))
  const refs = await pathKind(deps, join(target, 'refs'))
  const objects = await pathKind(deps, join(target, 'objects'))
  // `HEAD` is a file; `refs` and `objects` are directories. A path that is not
  // readable but is a symlink still counts: that is a shared store which is not
  // mounted right now, and the markers beside it are real data — refusing is
  // the safe direction. Only genuinely wrong types (a plain file where a
  // directory belongs) disqualify the entry.
  if (!head.present || head.directory === true) return false
  const directoryLike = (kind: PathKind): boolean => kind.present && kind.directory !== false
  return directoryLike(refs) && directoryLike(objects)
}

interface PathKind {
  /** The path exists; a dangling symlink counts as existing. */
  readonly present: boolean
  /** `true`/`false` when stat resolved it, `null` when only the link is known. */
  readonly directory: boolean | null
}

async function pathKind(deps: SnapshotDeps, path: string): Promise<PathKind> {
  try {
    return { present: true, directory: (await deps.fs.stat(path)).isDirectory() }
  } catch {
    return { present: (await deps.fs.symlinkTarget(path)) !== null, directory: null }
  }
}

/** The path's own entry (never followed), or null when nothing is there. */
async function lstatOrNull(
  deps: SnapshotDeps,
  path: string,
): Promise<{ isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean } | null> {
  try {
    return await deps.fs.lstat(path)
  } catch {
    return null
  }
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
  repo: string | undefined,
  paths: readonly string[],
): Promise<null | { ok: true; remainingTracked: readonly string[] } | { ok: false; result: GitActionResult }> {
  const snap = await snapshotForSession(deps, config, sessionId, { repo })
  if (!snap.ok) return null
  const untrackedSet = new Set(snap.value.changes.filter((c) => c.status === 'untracked').map((c) => c.path))
  const untracked = paths.filter((p) => untrackedSet.has(p))
  if (untracked.length === 0) return null
  const tracked = paths.filter((p) => !untrackedSet.has(p))
  // Refuse the whole request (before removing anything) when an untracked
  // directory entry is itself a repository: a nested repo, a submodule or a bare
  // repository shows up as one directory entry, and a recursive delete would take
  // the entire inner repository with it. A plain directory that merely *contains*
  // a repo is still discarded as a whole — that boundary is deliberate (#46).
  // The remove loop below re-checks each directory right before its own removal:
  // only that instant can still see a repository appear after this scan.
  const directoryEntries = new Set(snap.value.changes.filter((c) => c.isDirectory === true).map((c) => c.path))
  for (const path of untracked) {
    if (!directoryEntries.has(path)) continue
    if (!(await looksLikeRepository(deps, join(root, path)))) continue
    return { ok: false, result: { ok: false, error: { code: 'nested-repo', message: `repository directory: ${path}` } } }
  }
  let rootReal: string
  try {
    rootReal = await deps.fs.realpath(root)
  } catch {
    return { ok: false, result: { ok: false, error: { code: 'git-error', message: 'repository root unavailable' } } }
  }
  // Remove every untracked target, collecting failures: a removal that did not
  // happen must not come back as a successful discard (a directory without
  // `recursive`, a permission error, …). Paths already gone stay gone — the
  // caller gets an error instead of a silent no-op.
  const failures: string[] = []
  let removedCount = 0
  for (const path of untracked) {
    if (!isSafePath(path)) return { ok: false, result: { ok: false, error: { code: 'invalid-path', message: `unsafe path: ${path}` } } }
    const target = join(root, path)
    const link = await lstatOrNull(deps, target)
    if (link === null) {
      // Nothing at that path: the entry is already gone (another process, or a
      // refresh that raced). Continuing is truthful — there is nothing to undo.
      continue
    }
    // A dangling symlink resolves to nothing, so `realpath` below cannot place
    // it; contain the link's own directory instead. `fs.remove` deletes the
    // link itself, never the target, so this is the same containment rule as a
    // regular entry — without it the link would be silently left behind.
    const targetReal = await deps.fs.realpath(target).catch(() => null)
    const containReal = targetReal ?? (link.isSymbolicLink()
      ? await deps.fs.realpath(dirname(target)).catch(() => null)
      : null)
    if (containReal === null || (containReal !== rootReal && !containReal.startsWith(rootReal + sep))) {
      return { ok: false, result: { ok: false, error: { code: 'invalid-path', message: `path escapes repository: ${path}` } } }
    }
    // Last-moment re-check: the pre-flight above can be raced by a repository
    // appearing under a directory target after it scanned. Statting again
    // immediately before the removal narrows that window to the few syscalls
    // between this call and the `rm` itself. Nothing has been removed yet in
    // the normal case, so the refusal still means "the batch is untouched"; if
    // it fires after earlier paths were deleted, say so with its own code —
    // the generic copy would read as if the whole batch had been skipped.
    if (await looksLikeRepository(deps, target)) {
      const code = removedCount === 0 ? 'nested-repo' : 'nested-repo-partial'
      const detail = removedCount === 0 ? '' : `; ${removedCount} path(s) already removed`
      return { ok: false, result: { ok: false, error: { code, message: `repository directory: ${path}${detail}` } } }
    }
    try {
      await deps.fs.remove(target)
      removedCount += 1
    } catch (e) {
      failures.push(`${path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (failures.length > 0) {
    // Named shortfalls: which paths failed, and that the tracked half of the
    // request never ran because the untracked deletions are attempted first.
    const skipped = tracked.length > 0 ? `; ${tracked.length} tracked path(s) not restored` : ''
    return {
      ok: false,
      result: { ok: false, error: { code: 'git-error', message: `could not discard ${failures.length} path(s): ${failures.join('; ')}${skipped}` } },
    }
  }
  return { ok: true, remainingTracked: tracked }
}
