/**
 * Git Flow by branch-name convention — no `git flow` CLI and no extra git
 * config. The panel reads the long-lived branches from the checkout it already
 * lists (`develop` beside `main` / `master`) and treats `feature/…`,
 * `hotfix/…` and `release/…` as the short-lived ones, which is exactly what the
 * convention names them.
 *
 * Everything here is a pure decision the dialogs and the menu render from:
 * which base a flow starts on, whether an entry is offered, which branch a
 * finish targets, and the default tag a release / hotfix produces. The host
 * re-validates every name it receives; this module only keeps the UI from
 * offering impossible combinations.
 */

import type { FlowKind, FlowStrategy, GitAction } from './types.js'
import { FLOW_KINDS } from './types.js'

/** The three short-lived flows. `bugfix/` and `support/` are deliberately out:
 * the convention leaves them optional, and the editor menu this follows does
 * not list them. The values and the wire action shapes live in the host's
 * `types.ts` (single source); this module re-exports them for the views. */
export type { FlowKind, FlowStrategy }
export { FLOW_KINDS }

export const FLOW_PREFIX: Record<FlowKind, string> = {
  feature: 'feature/',
  hotfix: 'hotfix/',
  release: 'release/',
}

/** The long-lived branches the flows hang off. */
export const DEVELOP_BRANCH = 'develop'
const MAIN_CANDIDATES: readonly string[] = ['main', 'master']

/** Which flow, if any, a branch name belongs to. A name that is only the prefix
 * (`feature/`) belongs to none. */
export function detectFlowBranch(branch: string | null): { readonly kind: FlowKind; readonly name: string } | null {
  if (branch === null) return null
  for (const kind of FLOW_KINDS) {
    const prefix = FLOW_PREFIX[kind]
    if (branch.startsWith(prefix) && branch.length > prefix.length) {
      return { kind, name: branch.slice(prefix.length) }
    }
  }
  return null
}

/**
 * `feature/<name>` for a user-entered short name, or null when the name cannot
 * be a branch. Mirrors the host's `isSafeBranchName` enough to stop the dialog
 * from sending an obviously invalid request; the host still validates.
 */
export function flowBranchName(kind: FlowKind, raw: string): string | null {
  const name = raw.trim()
  if (name === '') return null
  if (/\s/.test(name)) return null
  if (/[~^:?*]/.test(name)) return null
  if (name.includes('[') || name.includes('\\')) return null
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return null
  if (name.endsWith('.lock') || name.includes('..') || name.includes('//') || name.includes('@{')) return null
  return `${FLOW_PREFIX[kind]}${name}`
}

/** The tag a finished release / hotfix creates by default: its branch suffix,
 * so `release/1.2.0` proposes `1.2.0`. Editable in the dialog. */
export function defaultTagName(branch: string): string {
  const index = branch.indexOf('/')
  return index === -1 ? branch : branch.slice(index + 1)
}

export interface FlowBases {
  /** `develop`, when the checkout has it. */
  readonly develop: string | null
  /** The repository's main line: `main`, else `master`, else the host's
   * default branch when it is a local one. */
  readonly main: string | null
}

/** Resolve the two long-lived branches from the checkout's local branch list.
 * The host's default branch wins when it is one of the main-line names (a
 * repository whose `origin/HEAD` still points at `master` must not be treated
 * as `main`), with `main` then `master` as the fallback order. */
export function flowBases(local: readonly string[], defaultBranch: string | null): FlowBases {
  const names = new Set(local)
  const preferred = defaultBranch !== null && names.has(defaultBranch) ? defaultBranch : null
  const main = (preferred !== null && MAIN_CANDIDATES.includes(preferred) ? preferred : null)
    ?? MAIN_CANDIDATES.find((name) => names.has(name))
    ?? preferred
  return { develop: names.has(DEVELOP_BRANCH) ? DEVELOP_BRANCH : null, main }
}

/** Every long-lived main-line branch the checkout offers: `main` and `master`
 * can coexist (a legacy default), and both rows must be able to start a
 * hotfix. The resolved default is appended when it is neither. */
export function flowMainlines(local: readonly string[], defaultBranch: string | null): readonly string[] {
  const names = new Set(local)
  const lines = MAIN_CANDIDATES.filter((name) => names.has(name))
  const resolved = flowBases(local, defaultBranch).main
  if (resolved !== null && !lines.includes(resolved)) lines.push(resolved)
  return lines
}

/** The branch a flow is integrated into when finished: a feature lands on
 * `develop`; a release and a hotfix land on the main line, which is where the
 * convention puts the release commit and its tag. The main line is then merged
 * back into `develop` (`finishTargets.backMerge`), for a release so that
 * `develop` contains the tagged commit, for a hotfix so the fix reaches the
 * next version too. */
export function finishTarget(kind: FlowKind, bases: FlowBases): string | null {
  return kind === 'feature' ? bases.develop : bases.main
}

/**
 * The finish dialog's landing branches. `selected` is the branch the chosen
 * strategy integrates into (a release / hotfix: the main line; a feature:
 * `develop`), and `backMerge` is what the finish then merges back into
 * (`develop` for a release / hotfix, nothing for a feature). A hotfix lands on
 * a main line, and only a checkout that keeps both `main` and `master` has
 * something to choose — the resolved main line is preselected. A lone main line
 * is shown as a value, never as a selector with a single option.
 */
export interface FlowFinishTargets {
  /** The branches the selector offers, in the order the branch list shows them. */
  readonly options: readonly string[]
  /** The preselected branch. */
  readonly selected: string
  /** False when there is nothing to choose between: the field is read-only. */
  readonly editable: boolean
  /** The long-lived branches the finish merges back into after the integration
   * (empty for a feature). A release / hotfix needs `develop` to exist. */
  readonly backMerge: readonly string[]
}

export function finishTargets(kind: FlowKind, bases: FlowBases, mainlines: readonly string[]): FlowFinishTargets | null {
  const selected = finishTarget(kind, bases)
  if (selected === null) return null
  const backMerge = kind !== 'feature' && bases.develop !== null && bases.develop !== selected
    ? [bases.develop]
    : []
  // A release / hotfix always merges back into `develop`; without it the flow
  // has nowhere to land the second half of the convention.
  if (kind !== 'feature' && backMerge.length === 0) return null
  if (kind !== 'hotfix') return { options: [selected], selected, editable: false, backMerge }
  const options = mainlines.includes(selected) ? mainlines : [selected, ...mainlines]
  return { options, selected, editable: options.length > 1, backMerge }
}

/** The branch a new flow starts from. `develop` is created from `main` on the
 * first feature start, so a missing `develop` still offers the entry. */
export function startBase(kind: FlowKind, bases: FlowBases): string | null {
  if (kind === 'hotfix') return bases.main
  return bases.develop ?? (kind === 'feature' ? bases.main : null)
}

/** The lanes a change-preview node can sit on: the three flow kinds plus the
 * two long-lived branches. Any other base (a custom default branch) reads as
 * `other` and stays neutral. */
export type FlowLane = FlowKind | 'main' | 'develop' | 'other'

/** What a node means in the preview: a branch that stays, one the action
 * creates, or one it deletes. */
export type FlowNodeState = 'existing' | 'created' | 'deleted'

export interface FlowPreviewNode {
  readonly name: string
  readonly lane: FlowLane
  readonly state: FlowNodeState
}

/** What a directed edge does. `checkout` moves HEAD; the rest name the way the
 * integration lands, with `backMerge` the release / hotfix return trip. */
export type FlowPreviewAction = 'checkout' | 'merge' | 'squash' | 'rebase' | 'backMerge'

export interface FlowPreviewRoute {
  readonly from: FlowPreviewNode
  readonly to: FlowPreviewNode
  /** Null for the implicit `develop` creation step. */
  readonly action: FlowPreviewAction | null
  /** Tag created on `to` (a release / hotfix finish). */
  readonly tag?: string
}

export type FlowPreviewOpKind = 'delete' | 'deleteRemote' | 'push'

export interface FlowPreviewOp {
  readonly kind: FlowPreviewOpKind
  /** Refs a push publishes, e.g. `origin/main`. */
  readonly refs?: readonly string[]
  /** A squash finish deletes its branch with `-D`. */
  readonly force?: boolean
}

/** What a dialog's change legend renders: the edges the operation performs and
 * the cleanup / publish work that follows. Strings stay in the view, so the
 * model can be unit-tested without a renderer. */
export interface FlowPreview {
  readonly routes: readonly FlowPreviewRoute[]
  readonly ops: readonly FlowPreviewOp[]
  /** The start creates `develop` from the base first (the first feature). */
  readonly createsDevelop: boolean
}

/** The lane a branch name belongs to; `other` covers a custom base branch. */
export function flowLane(name: string): FlowLane {
  if (name === DEVELOP_BRANCH) return 'develop'
  if (MAIN_CANDIDATES.includes(name)) return 'main'
  return detectFlowBranch(name)?.kind ?? 'other'
}

export interface FlowStartPreviewInput {
  readonly flow: FlowKind
  /** The full name the new branch will get (the view also passes a placeholder
   * while the name is empty). */
  readonly branch: string
  readonly base: string
  readonly hasDevelop: boolean
  /** Refs the start publishes; null when the push option is off or unavailable. */
  readonly pushRefs?: readonly string[] | null
}

/** The start legend: one edge from the base to the new branch, or two when the
 * first feature creates `develop` first (the host does the same), plus the
 * publish op when the new branch is pushed. */
export function startFlowPreview(input: FlowStartPreviewInput): FlowPreview {
  const { flow, branch, base, hasDevelop } = input
  const createsDevelop = flow === 'feature' && !hasDevelop
  const route = (from: string, to: string, action: FlowPreviewAction | null): FlowPreviewRoute => ({
    from: { name: from, lane: flowLane(from), state: 'existing' },
    to: { name: to, lane: flowLane(to), state: 'created' },
    action,
  })
  return {
    createsDevelop,
    routes: createsDevelop
      ? [route(base, DEVELOP_BRANCH, null), route(DEVELOP_BRANCH, branch, 'checkout')]
      : [route(base, branch, 'checkout')],
    ops: input.pushRefs !== undefined && input.pushRefs !== null && input.pushRefs.length > 0
      ? [{ kind: 'push', refs: input.pushRefs }]
      : [],
  }
}

export interface FlowFinishPreviewInput {
  readonly flow: FlowKind
  readonly branch: string
  readonly target: string
  /** Long-lived branches the finish also moves (a release / hotfix). */
  readonly backMerge: readonly string[]
  readonly strategy: FlowStrategy
  /** The tag the finish creates; empty for a feature. */
  readonly tag: string
  readonly deleteBranch: boolean
  readonly deleteRemote: boolean
  /** Refs the push publishes; null when the option is off or unavailable. */
  readonly pushRefs: readonly string[] | null
  /** The checkout's remote, for the deleted upstream's ref. */
  readonly remoteName?: string | null
  readonly forceDelete?: boolean
  /** Full `release/…` branch a feature finish also starts from `develop`. */
  readonly startRelease?: string | null
}

/** The finish legend: the integration edge (with its tag), the back-merge, and
 * the cleanup / publish ops the checkboxes select. The source node reads as
 * deleted as soon as the branch delete is requested. */
export function finishFlowPreview(input: FlowFinishPreviewInput): FlowPreview {
  const needsTag = input.flow !== 'feature'
  const tag = needsTag ? input.tag.trim() : ''
  const routes: FlowPreviewRoute[] = [{
    from: { name: input.branch, lane: flowLane(input.branch), state: input.deleteBranch ? 'deleted' : 'existing' },
    to: { name: input.target, lane: flowLane(input.target), state: 'existing' },
    action: input.strategy,
    ...(tag === '' ? {} : { tag }),
  }]
  for (const back of input.backMerge) {
    routes.push({
      from: { name: input.target, lane: flowLane(input.target), state: 'existing' },
      to: { name: back, lane: flowLane(back), state: 'existing' },
      action: 'backMerge',
    })
  }
  const startRelease = input.startRelease?.trim() ?? ''
  if (startRelease !== '') {
    // The chained release starts from the branch the feature just landed on.
    routes.push({
      from: { name: input.target, lane: flowLane(input.target), state: 'existing' },
      to: { name: startRelease, lane: flowLane(startRelease), state: 'created' },
      action: 'checkout',
    })
  }
  const ops: FlowPreviewOp[] = []
  if (input.deleteBranch) ops.push({ kind: 'delete', ...(input.forceDelete === true ? { force: true } : {}) })
  if (input.deleteRemote) {
    ops.push({
      kind: 'deleteRemote',
      ...(input.remoteName != null ? { refs: [`${input.remoteName}/${input.branch}`] } : {}),
    })
  }
  if (input.pushRefs !== null && input.pushRefs.length > 0) ops.push({ kind: 'push', refs: input.pushRefs })
  return { routes, ops, createsDevelop: false }
}

/** The local branches a preview draws left-to-right: the first edge's source
 * plus every edge's target. A release finish therefore reads
 * `release/… → main → develop`. */
export function flowPreviewChain(routes: readonly FlowPreviewRoute[]): readonly FlowPreviewNode[] {
  if (routes.length === 0) return []
  return [routes[0].from, ...routes.map((route) => route.to)]
}

/** One remote branch under its local branch. */
export interface FlowPreviewRemote {
  readonly ref: string
  /** The local branch it belongs to (`origin/develop` → `develop`). */
  readonly branch: string
  /** False for a push, true for a delete-remote. */
  readonly deleted: boolean
}

/** Remote branches the preview should draw under their local branch. The
 * remote name may itself contain `/`, so split on the full configured name
 * rather than the first slash. */
export function flowPreviewRemotes(
  ops: readonly FlowPreviewOp[],
  remoteName: string | null,
): readonly FlowPreviewRemote[] {
  if (remoteName === null) return []
  const prefix = `${remoteName}/`
  const remotes: FlowPreviewRemote[] = []
  for (const op of ops) {
    if (op.kind !== 'push' && op.kind !== 'deleteRemote') continue
    for (const ref of op.refs ?? []) {
      if (!ref.startsWith(prefix) || ref.length === prefix.length) continue
      remotes.push({ ref, branch: ref.slice(prefix.length), deleted: op.kind === 'deleteRemote' })
    }
  }
  return remotes
}

export type FlowMenuItemId =
  | 'start-feature'
  | 'integrate-develop'
  | 'finish-feature'
  | 'start-hotfix'
  | 'finish-hotfix'
  | 'start-release'
  | 'finish-release'

export interface FlowMenuFacts {
  readonly current: string | null
  readonly local: readonly string[]
  readonly defaultBranch: string | null
  /** Any write in flight in the pane: every entry is disabled while it runs. */
  readonly busy?: boolean
}

export interface FlowMenuItemState {
  readonly id: FlowMenuItemId
  readonly disabled: boolean
  /** Items of one group sit together; the menu draws a separator between
   * groups (Feature / Hotfix / Release, as the reference menu does). */
  readonly group: number
}

/**
 * The menu's entries and their enabled state. Finish entries are offered only
 * while HEAD sits on the matching flow branch (the operation acts on the
 * current branch); start entries need a base to branch from; the integrate
 * entry needs `develop` and does not apply when already on it.
 */
export function flowMenuItems(facts: FlowMenuFacts): readonly FlowMenuItemState[] {
  const bases = flowBases(facts.local, facts.defaultBranch)
  const current = detectFlowBranch(facts.current)
  const busy = facts.busy === true
  const canFinish = (kind: FlowKind): boolean =>
    current?.kind === kind && finishTarget(kind, bases) !== null
  return [
    {
      id: 'start-feature',
      group: 0,
      disabled: busy || startBase('feature', bases) === null,
    },
    {
      id: 'integrate-develop',
      group: 0,
      // `整合开发` brings develop into a feature branch: it only makes sense
      // while HEAD is on one. On develop itself (or a release / hotfix) there
      // is nothing to integrate into.
      disabled: busy || bases.develop === null || current?.kind !== 'feature',
    },
    {
      id: 'finish-feature',
      group: 0,
      // A feature also needs `develop` to land on, which is the same condition.
      disabled: busy || !canFinish('feature'),
    },
    {
      id: 'start-hotfix',
      group: 1,
      disabled: busy || startBase('hotfix', bases) === null,
    },
    {
      id: 'finish-hotfix',
      group: 1,
      // The finish sequence merges the main line back into `develop`, so a
      // hotfix without `develop` has nowhere to land.
      disabled: busy || !canFinish('hotfix') || bases.develop === null,
    },
    {
      id: 'start-release',
      group: 2,
      disabled: busy || startBase('release', bases) === null,
    },
    {
      id: 'finish-release',
      group: 2,
      disabled: busy || !canFinish('release') || bases.develop === null,
    },
  ]
}

/** One request the UI hands to the write path. The shape is the host's wire
 * action (single source), so a dialog cannot emit a field the host will not
 * read. */
export type FlowStartRequest = Extract<GitAction, { kind: 'flow-start' }>
export type FlowFinishRequest = Extract<GitAction, { kind: 'flow-finish' }>
export type FlowIntegrateRequest = Extract<GitAction, { kind: 'flow-integrate' }>

/** Which dialog the panel currently has open. The button and the branch rows'
 * context menus raise the same values, and the panel owns the dialog so either
 * entry lands in one place. */
export type FlowDialog =
  | { readonly type: 'start'; readonly flow: FlowKind; readonly base?: string }
  | { readonly type: 'finish'; readonly flow: FlowKind; readonly branch: string }
  | { readonly type: 'integrate' }
  | { readonly type: 'about' }

/** One `major.minor.patch` version read off a tag, plus the `v` it carried. */
export interface FlowVersion {
  readonly prefix: string
  readonly major: number
  readonly minor: number
  readonly patch: number
}

// Tags may carry a leading v/V and a pre-release suffix (`v1.2.3-rc.1`); only
// the numeric core decides the next version.
const VERSION_RE = /^([vV])?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/

/** Parse one tag as a version, or null when it is not one. Missing minor /
 * patch parts read as zero, so `2` and `2.1` are valid. */
export function parseFlowVersion(text: string): FlowVersion | null {
  const match = VERSION_RE.exec(text.trim())
  if (match === null) return null
  return {
    prefix: match[1] ?? '',
    major: Number(match[2]),
    minor: Number(match[3] ?? 0),
    patch: Number(match[4] ?? 0),
  }
}

function compareVersions(a: FlowVersion, b: FlowVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

/**
 * The version a new release / hotfix proposes: the highest version among the
 * tags, bumped in the position the flow owns and zeroed after it — minor for a
 * release (`1.4.2` → `1.5.0`), patch for a hotfix (`1.4.2` → `1.4.3`). The
 * leading `v` of the version it read is preserved. Null when no tag is a
 * version: the field then starts empty and the user types one.
 */
export function nextFlowVersion(kind: 'hotfix' | 'release', tags: readonly string[]): string | null {
  let highest: FlowVersion | null = null
  for (const tag of tags) {
    const version = parseFlowVersion(tag)
    if (version === null) continue
    if (highest === null || compareVersions(version, highest) > 0) highest = version
  }
  if (highest === null) return null
  const minor = kind === 'release' ? highest.minor + 1 : highest.minor
  const patch = kind === 'release' ? 0 : highest.patch + 1
  return `${highest.prefix}${highest.major}.${minor}.${patch}`
}
