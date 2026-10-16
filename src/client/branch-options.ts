/**
 * Option model behind the branch rows' switch buttons. Pure so the remote-ref
 * shadowing rule and the current-branch lock are unit-tested; the branch list
 * (OverviewTab.tsx) and the confirm dialog (branch-switch.tsx) only consume it.
 */
import type { GitBranch } from './types.js'

/**
 * One pickable row. `name` is always the *local* branch that ends up checked
 * out: a remote row either reuses an existing local branch of that name or has
 * `createFrom` set, in which case the local branch is created from that
 * remote-tracking ref and set to track it.
 */
export interface BranchOption {
  /** Stable identity for React keys and keyboard highlighting. */
  readonly key: string
  readonly group: 'local' | 'remote'
  /** Displayed name: `x` for a local branch, `origin/x` for a remote ref. */
  readonly label: string
  /** Local branch this row switches to (created first when `createFrom` is set). */
  readonly name: string
  /** Remote-tracking ref a missing local branch is created from and tracks. */
  readonly createFrom?: string
  /** True when the remote ref already has a local branch of the same name. */
  readonly reused: boolean
  readonly ahead?: number
  readonly behind?: number
  readonly shortHash: string | null
}

export interface BranchSource {
  readonly current: string | null
  readonly local: readonly GitBranch[]
  readonly remote: readonly GitBranch[]
}

/** Split a `refs/remotes` short name (`origin/x`) into remote + branch name.
 * Null when the ref carries no remote prefix (nothing to create a branch from). */
export function splitRemoteRef(ref: string): { remote: string; branch: string } | null {
  const cut = ref.indexOf('/')
  if (cut <= 0 || cut === ref.length - 1) return null
  return { remote: ref.slice(0, cut), branch: ref.slice(cut + 1) }
}

/** Switch targets for the branch list: local branches, then remote-tracking
 * refs. `key` is `local:<name>` / `remote:<ref>`, matching the list's rows. */
export function buildBranchOptions(tree: BranchSource): readonly BranchOption[] {
  const localNames = new Set(tree.local.map((b) => b.name))
  const local: BranchOption[] = tree.local.map((b) => ({
    key: `local:${b.name}`,
    group: 'local',
    label: b.name,
    name: b.name,
    reused: false,
    ahead: b.ahead,
    behind: b.behind,
    shortHash: b.shortHash,
  }))
  const remote: BranchOption[] = []
  for (const ref of tree.remote) {
    // `git checkout origin/x` would detach HEAD, so a remote row always resolves
    // to the local branch `x`: reuse it when it exists, else create + track it.
    const split = splitRemoteRef(ref.name)
    if (split === null) continue
    const exists = localNames.has(split.branch)
    remote.push({
      key: `remote:${ref.name}`,
      group: 'remote',
      label: ref.name,
      name: split.branch,
      createFrom: exists ? undefined : ref.name,
      reused: exists,
      ahead: ref.ahead,
      behind: ref.behind,
      shortHash: ref.shortHash,
    })
  }
  return [...local, ...remote]
}

/** A row is inert when it names the branch already checked out. */
export function isSelectable(option: BranchOption, current: string | null): boolean {
  return option.name !== current
}
