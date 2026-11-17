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

/** The three short-lived flows. `bugfix/` and `support/` are deliberately out:
 * the convention leaves them optional, and the editor menu this follows does
 * not list them. */
export type FlowKind = 'feature' | 'hotfix' | 'release'

export const FLOW_KINDS: readonly FlowKind[] = ['feature', 'hotfix', 'release']

export const FLOW_PREFIX: Record<FlowKind, string> = {
  feature: 'feature/',
  hotfix: 'hotfix/',
  release: 'release/',
}

/** The long-lived branches the flows hang off. */
export const DEVELOP_BRANCH = 'develop'
const MAIN_CANDIDATES: readonly string[] = ['main', 'master']

/** Default merge message the finish dialog opens with (the reference flow
 * editor uses the same text even in non-English UIs; it is a commit message,
 * not a UI label, so it is not translated here). */
export const FLOW_FINISH_MESSAGE = 'Finish git-flow'

export type FlowStrategy = 'merge' | 'squash' | 'rebase'

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

/** The branch a flow is integrated into when finished. A hotfix lands on the
 * main line first; a feature and a release land on `develop` (a release also
 * visits the main line, which is the finish sequence's business, not the
 * dialog's). */
export function finishTarget(kind: FlowKind, bases: FlowBases): string | null {
  return kind === 'hotfix' ? bases.main : bases.develop
}

/** The branch a new flow starts from. `develop` is created from `main` on the
 * first feature start, so a missing `develop` still offers the entry. */
export function startBase(kind: FlowKind, bases: FlowBases): string | null {
  if (kind === 'hotfix') return bases.main
  return bases.develop ?? (kind === 'feature' ? bases.main : null)
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

/** One request the UI hands to the write path (the host actions arrive with the
 * execution step; the shell only builds these today). */
export interface FlowStartRequest {
  readonly flow: FlowKind
  /** Full branch name, e.g. `feature/login`. */
  readonly branch: string
  readonly base: string
}

export interface FlowFinishRequest {
  readonly flow: FlowKind
  /** The flow branch being finished (usually HEAD, but a branch row's own
   * right-click names it explicitly). */
  readonly branch: string
  readonly strategy: FlowStrategy
  readonly message: string
  readonly deleteBranch: boolean
  readonly deleteRemote: boolean
  /** Release / hotfix only. */
  readonly tag?: string
}

export interface FlowIntegrateRequest {
  readonly develop: string
}

export type FlowRequest =
  | ({ readonly type: 'start' } & FlowStartRequest)
  | ({ readonly type: 'finish' } & FlowFinishRequest)
  | ({ readonly type: 'integrate' } & FlowIntegrateRequest)

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
