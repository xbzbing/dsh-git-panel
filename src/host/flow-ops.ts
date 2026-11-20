/**
 * Git Flow execution: the multi-step git sequences behind the panel's start /
 * finish / integrate dialogs.
 *
 * The convention, not a `git flow` CLI: `feature/*`, `hotfix/*` and
 * `release/*` hang off `develop` and the main line (`main` / `master` / the
 * remote's default branch), and a finish integrates the short-lived branch back
 * with the strategy the dialog chose.
 *
 * Everything here re-validates what the wire carries: the flow kind against the
 * branch prefix, every branch / tag / remote name through `validate.ts`, and the
 * remote names against the checkout's configured remotes. Sequence steps are
 * argv arrays only.
 *
 * Partial state is reported honestly: the first integration (the one that moves
 * the target branch) is rolled back when it conflicts, but a failure after it —
 * the release / hotfix back-merge into develop, a tag, a push, a delete —
 * returns `flow-partial`, because the target branch already moved and pretending
 * nothing happened would be false.
 */
import { mapWorkspaceFailure, resolveWorkspace, runCommand, snapshotForSession, type GitPanelConfig, type SnapshotDeps } from './core.js'
import { classifyActionFailure, splitRemoteTrackingRef } from './actions.js'
import { isSafeBranchName, isSafeRemoteName } from './validate.js'
import type { FlowKind, FlowStrategy, GitAction, GitActionRequest, GitActionResult, GitErrorCode } from './types.js'

/** The three actions this module runs. */
export type FlowAction = Extract<GitAction, { kind: 'flow-start' | 'flow-finish' | 'flow-integrate' }>

const DEVELOP = 'develop'
const MAIN_CANDIDATES: readonly string[] = ['main', 'master']
const STRATEGIES: readonly FlowStrategy[] = ['merge', 'squash', 'rebase']
const FLOW_PREFIX: Record<FlowKind, string> = {
  feature: 'feature/',
  hotfix: 'hotfix/',
  release: 'release/',
}

/** True for an action the flow runner must execute (index.ts routes on it). */
export function isFlowAction(action: GitAction): action is FlowAction {
  return action.kind === 'flow-start' || action.kind === 'flow-finish' || action.kind === 'flow-integrate'
}

function isFlowKind(value: unknown): value is FlowKind {
  return value === 'feature' || value === 'hotfix' || value === 'release'
}

type Failure = Extract<GitActionResult, { ok: false }>
type RunOutcome = { readonly ok: true; readonly exitCode: number; readonly stdout: string; readonly stderr: string } | Failure

function fail(code: GitErrorCode, message?: string): Failure {
  return { ok: false, error: { code, ...(message === undefined ? {} : { message }) } }
}

function isIndexBusy(outcome: Awaited<ReturnType<typeof runCommand>>): boolean {
  if (!('run' in outcome) || outcome.run.exitCode === 0) return false
  return /index\.lock|Unable to create.*index|another git process/i.test(outcome.run.stderr + outcome.run.stdout)
}

/** One git command with the action pipeline's index-lock retry. The exit code is
 * returned as-is; `git()` classifies a non-zero one, probes read it. */
async function raw(deps: SnapshotDeps, root: string, argv: readonly string[], label: string): Promise<RunOutcome> {
  let outcome = await runCommand(deps.run, argv, root, label, deps.signal)
  if (isIndexBusy(outcome)) {
    await new Promise((resolve) => setTimeout(resolve, 150))
    outcome = await runCommand(deps.run, argv, root, `${label}-retry`, deps.signal)
  }
  if ('failure' in outcome) {
    return fail('git-unavailable', outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure))
  }
  if (outcome.run.cancelled) return fail('cancelled')
  if (outcome.run.timedOut) return fail('timeout')
  return { ok: true, exitCode: outcome.run.exitCode ?? -1, stdout: outcome.run.stdout, stderr: outcome.run.stderr }
}

/** One git command that must succeed; a refusal becomes its wire code. */
async function git(deps: SnapshotDeps, root: string, argv: readonly string[], label: string): Promise<RunOutcome> {
  const outcome = await raw(deps, root, argv, label)
  if (!outcome.ok) return outcome
  if (outcome.exitCode !== 0) {
    const failure = classifyActionFailure(outcome.stdout, outcome.stderr, outcome.exitCode)
    return fail(failure.code, failure.message)
  }
  return outcome
}

/** One `rev-parse --verify --quiet` probe: missing refs exit 1 with no output. */
async function hasRef(deps: SnapshotDeps, root: string, ref: string): Promise<{ readonly ok: true; readonly exists: boolean } | Failure> {
  const outcome = await raw(deps, root, ['git', 'rev-parse', '--verify', '--quiet', '--end-of-options', ref], 'flow-probe')
  if (!outcome.ok) return outcome
  return { ok: true, exists: outcome.exitCode === 0 }
}

async function currentBranch(deps: SnapshotDeps, root: string): Promise<{ readonly ok: true; readonly name: string | null } | Failure> {
  const outcome = await raw(deps, root, ['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], 'flow-branch')
  if (!outcome.ok) return outcome
  return { ok: true, name: outcome.exitCode === 0 ? outcome.stdout.trim() || null : null }
}

async function localBranches(deps: SnapshotDeps, root: string): Promise<{ readonly ok: true; readonly names: readonly string[] } | Failure> {
  const outcome = await raw(deps, root, ['git', 'for-each-ref', '--format=%(refname:short)', 'refs/heads'], 'flow-branches')
  if (!outcome.ok) return outcome
  return { ok: true, names: outcome.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '') }
}

/**
 * Every main-line branch the checkout offers, in the order the panel's own
 * branch list resolves them: `main` then `master`, plus the branch the remote's
 * HEAD points at when that is a different local branch. A checkout may keep
 * both `main` and `master`, and the finish dialog lets the user pick either for
 * a hotfix, so this is a list rather than one name.
 */
async function mainlineCandidates(deps: SnapshotDeps, root: string): Promise<{ readonly ok: true; readonly names: readonly string[] } | Failure> {
  const local = await localBranches(deps, root)
  if (!local.ok) return local
  const names = MAIN_CANDIDATES.filter((candidate) => local.names.includes(candidate))
  const head = await raw(deps, root, ['git', 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], 'flow-default')
  if (!head.ok) return head
  if (head.exitCode === 0) {
    const name = head.stdout.trim().replace(/^origin\//, '')
    if (name !== '' && local.names.includes(name) && !names.includes(name)) names.push(name)
  }
  return { ok: true, names }
}

async function worktreeClean(deps: SnapshotDeps, root: string): Promise<{ readonly ok: true; readonly clean: boolean } | Failure> {
  const outcome = await raw(deps, root, ['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], 'flow-status')
  if (!outcome.ok) return outcome
  if (outcome.exitCode !== 0) {
    const failure = classifyActionFailure(outcome.stdout, outcome.stderr, outcome.exitCode)
    return fail(failure.code, failure.message)
  }
  return { ok: true, clean: outcome.stdout === '' }
}

async function headOid(deps: SnapshotDeps, root: string): Promise<{ readonly ok: true; readonly oid: string | null } | Failure> {
  const outcome = await raw(deps, root, ['git', 'rev-parse', '--verify', '--quiet', 'HEAD'], 'flow-head')
  if (!outcome.ok) return outcome
  return { ok: true, oid: outcome.exitCode === 0 ? outcome.stdout.trim() || null : null }
}

/** The branch's configured upstream as a remote + remote branch, or null when
 * it has none (a local-only flow branch). */
async function upstreamOf(
  deps: SnapshotDeps, root: string, branch: string,
): Promise<{ readonly ok: true; readonly upstream: { readonly remote: string; readonly branch: string } | null } | Failure> {
  const outcome = await raw(
    deps, root,
    ['git', 'for-each-ref', '--format=%(upstream)', `refs/heads/${branch}`],
    'flow-upstream',
  )
  if (!outcome.ok) return outcome
  const ref = outcome.stdout.split('\n').map((line) => line.trim()).find((line) => line !== '')
  if (ref === undefined) return { ok: true, upstream: null }
  const remotes = await raw(deps, root, ['git', 'remote'], 'flow-remotes')
  if (!remotes.ok) return remotes
  const names = remotes.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  return { ok: true, upstream: splitRemoteTrackingRef(ref, names) }
}

/** The flow prefix check: `flow === 'feature'` must mean a `feature/…` branch,
 * never a caller-chosen pair (the host trusts neither field alone). */
function branchBelongsTo(action: { readonly flow: FlowKind; readonly branch: string }): boolean {
  if (!isFlowKind(action.flow)) return false
  const prefix = FLOW_PREFIX[action.flow]
  return action.branch.startsWith(prefix) && action.branch.length > prefix.length && isSafeBranchName(action.branch)
}

/** A finish whose first integration already moved the target branch: the extra
 * steps failed, so the result must not read as "nothing happened". */
function partial(failure: Failure): Failure {
  return fail('flow-partial', failure.error.message ?? failure.error.code)
}

async function checkout(deps: SnapshotDeps, root: string, branch: string): Promise<Failure | null> {
  const outcome = await git(deps, root, ['git', 'checkout', branch, '--'], 'flow-checkout')
  return outcome.ok ? null : outcome
}

/** The configured remote names, for validating a push target. */
async function configuredRemotes(deps: SnapshotDeps, root: string): Promise<{ readonly ok: true; readonly names: readonly string[] } | Failure> {
  const outcome = await raw(deps, root, ['git', 'remote'], 'flow-remotes')
  if (!outcome.ok) return outcome
  return { ok: true, names: outcome.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '') }
}

/** Undo a start whose publish failed: check the pre-op HEAD back out and remove
 * the branch this action created (and `develop`, when it created that too).
 * `-D` is safe here because the branch is brand new and no user commit can be on
 * it; the point is to restore the exact pre-op state so the dialog can retry. */
async function rollbackStartedBranch(
  deps: SnapshotDeps,
  root: string,
  branch: string,
  start: { readonly name: string | null; readonly oid: string | null },
  createdDevelop: boolean,
): Promise<boolean> {
  if (start.name !== null) {
    const back = await checkout(deps, root, start.name)
    if (back !== null) return false
  } else if (start.oid !== null) {
    const detached = await git(deps, root, ['git', 'checkout', '--detach', start.oid, '--'], 'flow-start-rollback')
    if (!detached.ok) return false
  } else {
    return false
  }
  const removed = await git(deps, root, ['git', 'branch', '-D', '--end-of-options', branch], 'flow-start-rollback')
  if (!removed.ok) return false
  if (createdDevelop) {
    const removedDevelop = await git(deps, root, ['git', 'branch', '-D', '--end-of-options', DEVELOP], 'flow-start-rollback')
    if (!removedDevelop.ok) return false
  }
  return true
}

/**
 * Roll the first integration back to the checkout the finish started in. Every
 * finish requires a clean work tree, so `reset --hard` to the captured tips is
 * an exact restoration (the abort of a conflicted merge keeps unrelated dirt,
 * which the clean check already ruled out).
 */
async function restore(
  deps: SnapshotDeps,
  root: string,
  state: {
    readonly strategy: FlowStrategy
    readonly target: string
    readonly targetOid: string
    readonly startBranch: string
    readonly startHead: string
  },
  failure: Failure,
): Promise<Failure> {
  if (state.strategy === 'rebase') {
    await git(deps, root, ['git', 'rebase', '--abort'], 'flow-abort')
  } else {
    // A merge conflict parks MERGE_HEAD; `--squash` conflicts do not, so the
    // reset below is what guarantees the target ref and index are back.
    await git(deps, root, ['git', 'merge', '--abort'], 'flow-abort')
    const now = await currentBranch(deps, root)
    if (now.ok && now.name === state.target) {
      await git(deps, root, ['git', 'reset', '--hard', state.targetOid], 'flow-reset')
    }
  }
  const back = await checkout(deps, root, state.startBranch)
  const head = await headOid(deps, root)
  if (back !== null || !head.ok || head.oid !== state.startHead) {
    return fail('merge-stuck', failure.error.message ?? 'the integration conflicted and could not be aborted')
  }
  const code: GitErrorCode = failure.error.code === 'conflict' ? 'merge-conflict' : failure.error.code
  return fail(code, failure.error.message)
}

/** Integrate `branch` into `target` with the chosen strategy. Null on success. */
async function integrate(
  deps: SnapshotDeps,
  root: string,
  input: {
    readonly branch: string
    readonly target: string
    readonly strategy: FlowStrategy
    readonly message: string
    readonly targetOid: string
    readonly startBranch: string
    readonly startHead: string
  },
): Promise<Failure | null> {
  const state = {
    strategy: input.strategy,
    target: input.target,
    targetOid: input.targetOid,
    startBranch: input.startBranch,
    startHead: input.startHead,
  }
  const toTarget = await checkout(deps, root, input.target)
  if (toTarget !== null) return restore(deps, root, state, toTarget)

  if (input.strategy === 'merge') {
    const merged = await git(deps, root, ['git', 'merge', '--no-ff', '-m', input.message, '--end-of-options', `refs/heads/${input.branch}`], 'flow-merge')
    return merged.ok ? null : restore(deps, root, state, merged)
  }
  if (input.strategy === 'squash') {
    const squashed = await git(deps, root, ['git', 'merge', '--squash', '--end-of-options', `refs/heads/${input.branch}`], 'flow-squash')
    if (!squashed.ok) return restore(deps, root, state, squashed)
    const committed = await git(deps, root, ['git', 'commit', '-m', input.message], 'flow-squash-commit')
    return committed.ok ? null : restore(deps, root, state, committed)
  }

  // Rebase: replay the flow branch onto the target, then fast-forward the target
  // to it. The flow branch keeps its rewritten commits until the cleanup step.
  const toBranch = await checkout(deps, root, input.branch)
  if (toBranch !== null) return restore(deps, root, state, toBranch)
  const rebased = await git(deps, root, ['git', 'rebase', input.target], 'flow-rebase')
  if (!rebased.ok) return restore(deps, root, state, rebased)
  const backToTarget = await checkout(deps, root, input.target)
  if (backToTarget !== null) return restore(deps, root, state, backToTarget)
  const fastForward = await git(deps, root, ['git', 'merge', '--ff-only', `refs/heads/${input.branch}`], 'flow-ff')
  return fastForward.ok ? null : restore(deps, root, state, fastForward)
}

async function snapshotResult(
  deps: SnapshotDeps, config: GitPanelConfig, request: GitActionRequest, output: string,
): Promise<GitActionResult> {
  const snapshot = await snapshotForSession(deps, config, request.sessionId, { repo: request.repo })
  if (!snapshot.ok) return fail('git-error', 'snapshot after action failed')
  return { ok: true, snapshot: snapshot.value, output }
}

/** `flow-start`: create the flow branch (and `develop` on the first feature
 * start) and switch to it. */
async function startFlow(
  deps: SnapshotDeps, config: GitPanelConfig, request: GitActionRequest, action: Extract<GitAction, { kind: 'flow-start' }>, root: string,
): Promise<GitActionResult> {
  if (!branchBelongsTo(action)) return fail('invalid-name', 'the branch does not belong to this flow')
  if (!isSafeBranchName(action.base)) return fail('invalid-name', `unsafe base branch: ${action.base}`)
  if (action.pushRemote !== undefined && !isSafeRemoteName(action.pushRemote)) {
    return fail('invalid-name', `unsafe remote name: ${action.pushRemote}`)
  }

  const baseExists = await hasRef(deps, root, `refs/heads/${action.base}`)
  if (!baseExists.ok) return baseExists
  if (!baseExists.exists) return fail('not-found', `base branch not found: ${action.base}`)
  const taken = await hasRef(deps, root, `refs/heads/${action.branch}`)
  if (!taken.ok) return taken
  if (taken.exists) return fail('branch-exists', `branch already exists: ${action.branch}`)

  const develop = await hasRef(deps, root, `refs/heads/${DEVELOP}`)
  if (!develop.ok) return develop

  // The publish target is checked before anything is written, and the pre-op
  // HEAD is captured so a later push failure can restore it exactly.
  if (action.pushRemote !== undefined) {
    const remotes = await configuredRemotes(deps, root)
    if (!remotes.ok) return remotes
    if (!remotes.names.includes(action.pushRemote)) return fail('invalid-name', `remote not configured: ${action.pushRemote}`)
  }
  const start = await currentBranch(deps, root)
  if (!start.ok) return start
  const startOid = await headOid(deps, root)
  if (!startOid.ok) return startOid

  // A first feature start creates `develop` from the chosen base (the dialog
  // says so). The new branch is then cut from `develop`, so every later flow
  // shares the same line even if the base was `main`.
  let effectiveBase = action.base
  let createdDevelop = false
  if (action.flow === 'feature' && !develop.exists) {
    const created = await git(deps, root, ['git', 'branch', '--end-of-options', DEVELOP, `refs/heads/${action.base}`], 'flow-develop')
    if (!created.ok) return created
    createdDevelop = true
    effectiveBase = DEVELOP
  }

  const checkedOut = await git(deps, root, ['git', 'checkout', '-b', action.branch, effectiveBase, '--'], 'flow-start')
  if (!checkedOut.ok) {
    // Do not leave the repository changed behind a reported failure: the
    // `develop` branch this action created is the only thing to undo.
    if (createdDevelop) await git(deps, root, ['git', 'branch', '-d', '--end-of-options', DEVELOP], 'flow-develop-rollback')
    return checkedOut
  }
  if (action.pushRemote !== undefined) {
    // `-u` is the same publish contract as the Publish button: the remote
    // branch is created and becomes the new branch's upstream, so a later
    // finish can find and delete it.
    const pushed = await git(
      deps, root,
      ['git', 'push', '-u', action.pushRemote, `refs/heads/${action.branch}:refs/heads/${action.branch}`],
      'flow-start-push',
    )
    if (!pushed.ok) {
      const rolledBack = await rollbackStartedBranch(deps, root, action.branch, { name: start.name, oid: startOid.oid }, createdDevelop)
      return rolledBack ? pushed : partial(pushed)
    }
    return snapshotResult(deps, config, request, pushed.stdout)
  }
  return snapshotResult(deps, config, request, checkedOut.stdout)
}

/** `flow-finish`: integrate the flow branch, run the flow's extra steps, then
 * the requested cleanup. */
async function finishFlow(
  deps: SnapshotDeps, config: GitPanelConfig, request: GitActionRequest, action: Extract<GitAction, { kind: 'flow-finish' }>, root: string,
): Promise<GitActionResult> {
  if (!branchBelongsTo(action)) return fail('invalid-name', 'the branch does not belong to this flow')
  if (!isSafeBranchName(action.target)) return fail('invalid-name', `unsafe target branch: ${action.target}`)
  if (!STRATEGIES.includes(action.strategy)) return fail('invalid-name', `invalid flow strategy: ${String(action.strategy)}`)
  const message = action.message.trim()
  if (message === '') return fail('empty-message')
  const tag = action.tag?.trim() ?? ''
  if (tag !== '') {
    if (action.flow === 'feature') return fail('invalid-name', 'a feature is not tagged')
    if (!isSafeBranchName(tag)) return fail('invalid-name', `unsafe tag name: ${tag}`)
  }
  const deleteBranch = action.deleteBranch === true
  const forceDelete = action.forceDelete === true
  // A squash integration leaves the flow branch outside the target's ancestry,
  // so only git's forced `-D` can delete it. The dialog asks for that second
  // acknowledgement explicitly; without it the branch is left in place.
  if (deleteBranch && action.strategy === 'squash' && !forceDelete) {
    return fail('invalid-name', 'deleting a squashed flow branch needs the forced-delete acknowledgement')
  }
  if (action.pushRemote !== undefined && !isSafeRemoteName(action.pushRemote)) {
    return fail('invalid-name', `unsafe remote name: ${action.pushRemote}`)
  }
  if (action.releasePushRemote !== undefined && !isSafeRemoteName(action.releasePushRemote)) {
    return fail('invalid-name', `unsafe remote name: ${action.releasePushRemote}`)
  }
  // The chained release start only belongs to a feature finish, and its branch
  // follows the same convention as a standalone release start.
  const startRelease = action.startRelease?.trim() ?? ''
  if (startRelease !== '') {
    if (action.flow !== 'feature') return fail('invalid-name', 'only a feature can start a release when finished')
    if (!startRelease.startsWith(FLOW_PREFIX.release) || startRelease.length === FLOW_PREFIX.release.length || !isSafeBranchName(startRelease)) {
      return fail('invalid-name', `invalid release branch: ${startRelease}`)
    }
  }
  if (action.releasePushRemote !== undefined && startRelease === '') {
    return fail('invalid-name', 'a release push needs a chained release start')
  }

  const branchExists = await hasRef(deps, root, `refs/heads/${action.branch}`)
  if (!branchExists.ok) return branchExists
  if (!branchExists.exists) return fail('not-found', `flow branch not found: ${action.branch}`)
  const targetExists = await hasRef(deps, root, `refs/heads/${action.target}`)
  if (!targetExists.ok) return targetExists
  if (!targetExists.exists) return fail('not-found', `target branch not found: ${action.target}`)
  if (action.target === action.branch) return fail('invalid-name', 'a flow cannot be finished into itself')

  // Where the flow lands is a property of the convention, re-checked here: a
  // feature lands on develop; a release / hotfix lands on one of the main
  // lines (and is merged back into develop afterwards).
  const develop = await hasRef(deps, root, `refs/heads/${DEVELOP}`)
  if (!develop.ok) return develop
  if (!develop.exists) return fail('not-found', `develop branch not found: ${DEVELOP}`)
  if (action.flow === 'feature') {
    if (action.target !== DEVELOP) return fail('invalid-name', `a ${action.flow} lands on ${DEVELOP}`)
  } else {
    const mainlines = await mainlineCandidates(deps, root)
    if (!mainlines.ok) return mainlines
    if (mainlines.names.length === 0) return fail('git-error', `no main line branch (main / master / remote HEAD) to finish the ${action.flow} on`)
    if (!mainlines.names.includes(action.target)) {
      return fail('invalid-name', `${action.target} is not a main line (${mainlines.names.join(' / ')})`)
    }
  }
  if (action.flow === 'release' && action.target === DEVELOP) {
    return fail('invalid-name', `a release lands on a main line, not ${DEVELOP}`)
  }

  const tagTaken = tag === '' ? null : await hasRef(deps, root, `refs/tags/${tag}`)
  if (tagTaken !== null && !tagTaken.ok) return tagTaken
  if (tagTaken !== null && tagTaken.exists) return fail('tag-exists', `tag already exists: ${tag}`)
  if (startRelease !== '') {
    const releaseTaken = await hasRef(deps, root, `refs/heads/${startRelease}`)
    if (!releaseTaken.ok) return releaseTaken
    if (releaseTaken.exists) return fail('branch-exists', `branch already exists: ${startRelease}`)
  }

  // The cleanup targets are resolved before anything moves, so a missing
  // upstream or an unknown remote refuses before the integration.
  const upstream = action.deleteRemote === true ? await upstreamOf(deps, root, action.branch) : null
  if (upstream !== null && !upstream.ok) return upstream
  if (upstream !== null && upstream.upstream === null) {
    return fail('git-error', `the flow branch has no upstream to delete: ${action.branch}`)
  }
  const pushRemotes = [action.pushRemote, action.releasePushRemote].filter((name): name is string => name !== undefined)
  if (pushRemotes.length > 0) {
    const remotes = await configuredRemotes(deps, root)
    if (!remotes.ok) return remotes
    for (const remote of pushRemotes) {
      if (!remotes.names.includes(remote)) return fail('invalid-name', `remote not configured: ${remote}`)
    }
  }

  const clean = await worktreeClean(deps, root)
  if (!clean.ok) return clean
  if (!clean.clean) return fail('local-changes-block', 'the work tree has uncommitted changes; commit or stash them first')

  const start = await currentBranch(deps, root)
  if (!start.ok) return start
  if (start.name === null) return fail('no-branch', 'detached HEAD: a flow finish needs the checked-out flow branch')
  const startOid = await headOid(deps, root)
  if (!startOid.ok) return startOid
  if (startOid.oid === null) return fail('no-branch', 'the checkout has no commit to move from')
  const targetOid = await raw(deps, root, ['git', 'rev-parse', '--verify', '--end-of-options', `refs/heads/${action.target}`], 'flow-target-oid')
  if (!targetOid.ok) return targetOid
  if (targetOid.exitCode !== 0) return fail('not-found', `target branch not found: ${action.target}`)

  const moved = await checkout(deps, root, action.branch)
  if (moved !== null) return moved

  const integrated = await integrate(deps, root, {
    branch: action.branch,
    target: action.target,
    strategy: action.strategy,
    message,
    targetOid: targetOid.stdout.trim(),
    startBranch: start.name,
    startHead: startOid.oid,
  })
  if (integrated !== null) return integrated

  // From here the target branch holds the integration. Every remaining failure
  // is reported as partial instead of pretending the checkout is untouched.
  const tagOn = async (): Promise<Failure | null> => {
    if (tag === '') return null
    const created = await git(deps, root, ['git', 'tag', '-a', '-m', `${action.flow} ${tag}`, '--end-of-options', tag, 'HEAD'], 'flow-tag')
    return created.ok ? null : partial(created)
  }

  if (action.flow === 'release' || action.flow === 'hotfix') {
    // The tag belongs to the main-line merge, so it is created before the
    // back-merge into develop.
    const tagged = await tagOn()
    if (tagged !== null) return tagged
    // A release / hotfix moves two long-lived branches: the convention merges
    // the main line back into develop as well, so develop contains the tagged
    // commit (a release) and the fix (a hotfix).
    const toDevelop = await checkout(deps, root, DEVELOP)
    if (toDevelop !== null) return partial(toDevelop)
    const merged = await git(deps, root, ['git', 'merge', '--no-ff', '-m', message, '--end-of-options', `refs/heads/${action.target}`], 'flow-develop-merge')
    if (!merged.ok) {
      await git(deps, root, ['git', 'merge', '--abort'], 'flow-develop-abort')
      return partial(merged)
    }
  }

  let output = ''
  if (upstream !== null && upstream.upstream !== null) {
    const removed = await git(deps, root, ['git', 'push', '--delete', upstream.upstream.remote, `refs/heads/${upstream.upstream.branch}`], 'flow-remote-delete')
    if (!removed.ok) return partial(removed)
    output = removed.stdout
  }
  if (deleteBranch) {
    const removed = await git(deps, root, ['git', 'branch', forceDelete ? '-D' : '-d', '--end-of-options', action.branch], 'flow-branch-delete')
    if (!removed.ok) return partial(removed)
    output = removed.stdout
  }
  if (startRelease !== '') {
    // The chained release is cut from the develop the feature just landed on,
    // and the finish ends on it so the user can keep working there.
    const started = await git(deps, root, ['git', 'checkout', '-b', startRelease, DEVELOP, '--'], 'flow-release-start')
    if (!started.ok) return partial(started)
    output = started.stdout
  }
  if (action.pushRemote !== undefined) {
    // Publish every long-lived branch the finish moved: a feature only
    // `develop`, a release / hotfix the main line and `develop`.
    const branches = action.flow === 'feature' ? [action.target] : [action.target, DEVELOP]
    const pushed = await git(
      deps, root,
      ['git', 'push', action.pushRemote, ...branches.map((name) => `refs/heads/${name}:refs/heads/${name}`)],
      'flow-push',
    )
    if (!pushed.ok) return partial(pushed)
    output = pushed.stdout
  }
  if (action.releasePushRemote !== undefined && startRelease !== '') {
    // The chained release push is its own choice: `-u` also makes the new
    // branch track the remote, so a later finish can clean up its counterpart.
    const pushed = await git(
      deps, root,
      ['git', 'push', '-u', action.releasePushRemote, `refs/heads/${startRelease}:refs/heads/${startRelease}`],
      'flow-release-push',
    )
    if (!pushed.ok) return partial(pushed)
    output = pushed.stdout
  }
  return snapshotResult(deps, config, request, output.trim())
}

/** `flow-integrate`: merge `develop` into the checked-out feature branch. */
async function integrateFlow(
  deps: SnapshotDeps, config: GitPanelConfig, request: GitActionRequest, action: Extract<GitAction, { kind: 'flow-integrate' }>, root: string,
): Promise<GitActionResult> {
  if (!isSafeBranchName(action.develop)) return fail('invalid-name', `unsafe develop branch: ${action.develop}`)
  const develop = await hasRef(deps, root, `refs/heads/${action.develop}`)
  if (!develop.ok) return develop
  if (!develop.exists) return fail('not-found', `develop branch not found: ${action.develop}`)
  const current = await currentBranch(deps, root)
  if (!current.ok) return current
  if (current.name === null) return fail('no-branch', 'detached HEAD: integration needs the checked-out feature branch')
  if (!current.name.startsWith(FLOW_PREFIX.feature) || current.name.length === FLOW_PREFIX.feature.length) {
    return fail('invalid-name', 'integration only applies on a feature branch')
  }
  const merged = await git(deps, root, ['git', 'merge', '--end-of-options', action.develop], 'flow-integrate')
  if (merged.ok) return snapshotResult(deps, config, request, merged.stdout)
  if (merged.error.code === 'conflict') {
    // Same contract as a branch merge: the panel has no conflict UI, so the
    // merge is aborted instead of parking the shared work tree mid-merge.
    const aborted = await git(deps, root, ['git', 'merge', '--abort'], 'flow-integrate-abort')
    return aborted.ok
      ? fail('merge-conflict', merged.error.message)
      : fail('merge-stuck', merged.error.message)
  }
  return merged
}

/** Execute one Git Flow action, returning the fresh snapshot on success. */
export async function runFlowAction(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  request: GitActionRequest,
): Promise<GitActionResult> {
  const action = request.action
  if (!isFlowAction(action)) return fail('invalid-name', `not a flow action: ${action.kind}`)
  const workspace = await resolveWorkspace(deps, request.sessionId, request.repo, config.codeWorkspace)
  if (!workspace.ok) return { ok: false, error: mapWorkspaceFailure(workspace.failure) }
  const root = workspace.root
  if (action.kind === 'flow-start') return startFlow(deps, config, request, action, root)
  if (action.kind === 'flow-finish') return finishFlow(deps, config, request, action, root)
  return integrateFlow(deps, config, request, action, root)
}
