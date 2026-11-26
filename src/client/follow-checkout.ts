/**
 * Which repository row a session's current directory belongs to, for the
 * "follow the session" switch.
 *
 * The platform projects the session's live directory as `workingDirectory`;
 * the host's repository list carries the same directories as realpaths. A
 * follow target is only ever a selectable checkout of the session's own
 * repository — the workspace row or a row git reported as `main` / `linked` —
 * because moving the panel into an unrelated nested repository or a
 * `.code-workspace` root would be following `working_directory` again, which
 * ADR-0041 deliberately does not do. Pure: paths and rows in, one row out, so
 * the rules are unit-tested without a renderer.
 */
import type { GitRepoEntry } from './types.js'

/** The platform's standard `useProjection` slot prop, bound to the slot's Session. */
export type UseProjection = (key: string, selector?: (value: unknown) => unknown) => unknown

/** Normalize a host path for comparison: forward slashes, no trailing separator. */
function normalize(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed
}

/** Windows paths compare case-insensitively; POSIX paths do not. */
function windowsPath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith('//')
}

/** Whether two host paths name the same directory (case rules follow the path shape). */
function samePath(a: string, b: string): boolean {
  return windowsPath(a) || windowsPath(b) ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Whether `target` is `root` itself or sits below it. */
function within(root: string, target: string): boolean {
  const normalizedRoot = normalize(root)
  const normalizedTarget = normalize(target)
  if (samePath(normalizedRoot, normalizedTarget)) return true
  if (normalizedRoot === '/') return normalizedTarget.startsWith('/')
  return windowsPath(normalizedRoot) || windowsPath(normalizedTarget)
    ? normalizedTarget.toLowerCase().startsWith(normalizedRoot.toLowerCase() + '/')
    : normalizedTarget.startsWith(normalizedRoot + '/')
}

/**
 * The row to follow for `directory`, or undefined when the directory's own row
 * cannot be followed.
 *
 * The most specific row decides: the longest root covering the directory, so a
 * worktree nested inside the main checkout (the `.agents/worktrees/<branch>`
 * layout) is never attributed to the main row. That row is then judged — a
 * disabled row (outside the cwd and uncertified, or stale) and a scanned nested
 * repository or `.code-workspace` root (`role: 'repo'`) yield nothing rather
 * than falling back to an ancestor row, because the panel must not move to a
 * different checkout than the one the session actually works in. The workspace
 * row (`path: ''`) is trusted without a role: its root is the session's own
 * checkout by construction, and a session created in a linked worktree carries
 * it as the workspace row too.
 */
export function checkoutForDirectory(
  directory: string | null | undefined,
  repos: readonly GitRepoEntry[],
): GitRepoEntry | undefined {
  if (typeof directory !== 'string' || directory === '') return undefined
  let best: GitRepoEntry | undefined
  let bestLength = -1
  for (const row of repos) {
    if (!within(row.root, directory)) continue
    const length = normalize(row.root).length
    if (length > bestLength) {
      best = row
      bestLength = length
    }
  }
  if (best === undefined) return undefined
  if (best.disabled !== undefined) return undefined
  if (best.path !== '' && best.role !== 'main' && best.role !== 'linked') return undefined
  return best
}

/**
 * Whether `directory` is exactly the row's root, not merely below it.
 *
 * The follow effect refetches the list once when the session's directory is
 * below a plausible row but no row names it: a worktree created during the
 * session is a directory under the main checkout that the last scan could not
 * know about, and following the enclosing row instead would show the wrong
 * tree. An exact row needs no such read.
 */
export function atCheckoutRoot(directory: string | null | undefined, row: GitRepoEntry): boolean {
  return typeof directory === 'string' && directory !== '' && samePath(normalize(directory), normalize(row.root))
}

/** Mutable follow bookkeeping, one record per session's checkout lifecycle. */
export interface FollowPlanState {
  /** Whether the setting was on at the last run. */
  enabled: boolean
  /** Whether `enabled` was read from a ready sample for this session. */
  known: boolean
  /** The directory the last run observed. */
  cwd: string | null
  /** The directory whose follow decision is still waiting for an answer. */
  pending: string | null
  /** The directory that already asked for one fresh repository list. */
  refetched: string | null
  /** The setting was just turned on: follow even past a manual pick. */
  force: boolean
  /** The selection the last run protected as the user's own pick. It keeps the
   * priority independent of `first` / `pending`, so a pick the host later
   * refuses can release the follow in the same mount. */
  manual: string | null
  /** The pick revision the latest directory move released. A pick carrying a
   * newer revision was made after the move and is new intent even when it names
   * the same selector, so a value comparison is not used here. */
  releasedRevision: number | null
}

/** What the panel should do after one follow-effect run. */
export type FollowAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'refetch' }
  | { readonly kind: 'follow'; readonly path: string }

/** Everything one follow-effect run reads. */
export interface FollowPlanInput {
  readonly sessionDirectory: string | null
  readonly repos: readonly GitRepoEntry[]
  readonly repo: string
  readonly followSession: boolean
  readonly followSessionKnown: boolean
  readonly hasRepoPick: boolean
  /** The revision of this session's latest deliberate pick
   * (`repoPickRevision`); per session, so another session's click is not seen
   * as new intent here. */
  readonly pickRevision: number
  readonly repoListReady: boolean
  readonly repoProbeFailed: boolean
  readonly state: FollowPlanState
}

/** The next state and the one side effect the effect should perform. */
export interface FollowPlan {
  readonly state: FollowPlanState
  readonly action: FollowAction
}

/**
 * Decide one follow step. Pure: the checkout lifecycle keeps the returned
 * `state` and performs `action`; every branch that needs a
 * user-visible delay (the one list refetch, a pending directory) is explicit
 * here, so the rules are unit-tested without a renderer.
 *
 * A manual pick wins while the panel is on the same directory: on the first
 * run of a mount, while a refetch or a failed probe is pending, and on every
 * later run the directory does not change (`state.manual` records it). The
 * directory stays pending behind that pick: when the host refuses it, the repair
 * clears the selection and the next run follows the directory again. A real
 * directory change (or turning the setting on) re-arms the follow and lets the
 * manual pick go — that is the documented trade-off, not an accident.
 */
export function planFollow(input: FollowPlanInput): FollowPlan {
  const state: FollowPlanState = { ...input.state }
  const none: FollowPlan = { state, action: { kind: 'none' } }
  if (!input.followSessionKnown) return none
  if (!state.known) {
    // The first ready sample establishes the value; it is not a flip.
    state.known = true
    state.enabled = input.followSession
    state.force = false
  } else if (state.enabled !== input.followSession) {
    state.enabled = input.followSession
    state.cwd = null
    state.pending = null
    state.refetched = null
    state.force = input.followSession
    state.releasedRevision = null
  }
  if (!input.followSession) return none
  const directory = input.sessionDirectory
  if (directory === null) return none
  const first = state.cwd === null
  const changed = state.cwd !== directory
  if (!changed && state.pending !== directory) return none
  if (changed) {
    state.cwd = directory
    state.pending = directory
    state.refetched = null
    state.manual = null
    state.releasedRevision = !first && input.hasRepoPick ? input.pickRevision : null
  }
  // A pick the move released is not new intent; a later one is, even when it
  // names the same selector (the user re-picked after the repair dropped it).
  const freshPick = input.hasRepoPick && (state.releasedRevision === null || input.pickRevision > state.releasedRevision)
  // Directory and manual-pick bookkeeping stays live during discovery. Only
  // row evidence/actions wait, so a later scan cannot replay an older move
  // over a pick made after the most recent directory change.
  if (!input.repoListReady) {
    if (!state.force && freshPick && (first || !changed)) state.manual = input.repo
    return none
  }
  const target = checkoutForDirectory(directory, input.repos)
  const exact = target !== undefined && atCheckoutRoot(directory, target)
  // A manual pick survives the first run of a mount, the pending window (a
  // refetch in flight must not switch it away) and every later run on the same
  // directory. `manual` is what carries it: the pick keeps priority even after
  // the first run, and a host refusal releases it by clearing the selection.
  const manualWins = !state.force && freshPick &&
    (first || !changed || state.manual === input.repo) &&
    (input.repoProbeFailed || input.repos.some((entry) => entry.path === input.repo && entry.disabled === undefined)) &&
    (target === undefined || target.path !== input.repo)
  state.force = false
  if (manualWins) {
    state.manual = input.repo
    // Keep the directory pending: it is the fallback target once the host
    // refuses the pick and the selection returns to the default.
    state.pending = directory
    return none
  }
  state.manual = null
  // The covering row is only a guess for a directory the scan has not named:
  // ask once whether a more specific checkout (the session's new worktree)
  // exists before following the enclosing one.
  if (!exact && state.refetched !== directory) {
    state.refetched = directory
    return { state, action: { kind: 'refetch' } }
  }
  if (target === undefined || (!exact && input.repoProbeFailed)) {
    // Keep the directory pending: a probe that recovers, or a list refetched
    // with the new row, re-enters this effect and can decide again.
    state.pending = directory
    return none
  }
  state.pending = null
  if (target.path === input.repo) return none
  return { state, action: { kind: 'follow', path: target.path } }
}
