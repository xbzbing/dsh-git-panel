/**
 * The repository switcher's row model.
 *
 * The entries are the checkouts the host certifies — the workspace's own
 * repository and its worktrees, plus the repositories a scan found. A cwd that
 * owns no checkout lists only what the scan found: the root itself is not a
 * checkout and gets no row, so a non-git root never offers a "workspace root"
 * choice. Kept pure so the group split (the repository family vs the unrelated
 * repositories of the workspace) and the label rules are unit-tested instead
 * of living in render code.
 */
import type { GitRepoEntry } from './types.js'

export interface RepoChoice {
  /** Request tag for the host: '' is the session cwd itself. */
  readonly path: string
  /** Repository basename. */
  readonly name: string
  /** Absolute repository root. */
  readonly root: string
  /** `workspace` = the workspace's own checkout, `worktree` = a linked
   * worktree of a repository, `external` = a repository the `.code-workspace`
   * file certifies outside the cwd, `repo` = a repository of its own inside
   * the cwd. */
  readonly kind: 'workspace' | 'worktree' | 'external' | 'repo'
  /** Display name the workspace file chose for this root; absent → use `name`. */
  readonly label?: string
  /** Identity inside a repository family (see GitRepoEntry.role); absent on an
   * older host that predates the field. */
  readonly role?: 'main' | 'linked' | 'repo'
  /** HEAD branch of this checkout; null = detached, absent = unknown. */
  readonly branch?: string | null
  /** Why the row cannot be chosen: `outside` = outside the session cwd with no
   * relative selector (another Windows drive), `uncertified` = not a checkout
   * this repository owns, or `stale` = its directory is gone. */
  readonly disabled?: 'outside' | 'uncertified' | 'stale'
  /** git's `locked` flag on this worktree. */
  readonly locked?: boolean
}

/**
 * List entries. An empty list means "no repository to pick from" (a host that
 * does not answer repo-list yet, or a scan still in flight) and renders no list
 * block at all.
 */
export function repoChoices(repos: readonly GitRepoEntry[]): readonly RepoChoice[] {
  return repos.map((entry) => ({
    path: entry.path,
    name: entry.name,
    root: entry.root,
    // A session inside a linked worktree sees the main checkout as a row too;
    // it belongs to the same family (`role: 'main'`), so it groups with the
    // worktrees rather than under the unrelated repositories.
    kind: entry.kind === 'workspace'
      ? 'workspace'
      : entry.kind === 'external'
        ? 'external'
        : entry.role === 'linked' || entry.role === 'main' ? 'worktree' : 'repo',
    ...(entry.label !== undefined ? { label: entry.label } : {}),
    ...(entry.role !== undefined ? { role: entry.role } : {}),
    ...(entry.branch !== undefined ? { branch: entry.branch } : {}),
    ...(entry.disabled !== undefined ? { disabled: entry.disabled } : {}),
    ...(entry.locked !== undefined ? { locked: entry.locked } : {}),
  }))
}

/** Which group a choice belongs to: `own` is the repository family the session
 * cwd itself sits in (its main checkout and worktrees), `foreign` is
 * everything else the workspace offers. */
export type RepoGroupKey = 'own' | 'foreign'

export interface RepoGroup {
  readonly key: RepoGroupKey
  readonly items: readonly RepoChoice[]
  /** How many rows in this group can actually be chosen (disabled rows count
   * in `items` but not here — a group count must say both numbers). */
  readonly selectable: number
}

/**
 * Split the rows into the two groups, own first, dropping empty ones. A single
 * group means the caller renders no group header at all: a "Worktrees" heading
 * over one family, or the flat list of an unrelated-repositories workspace, is
 * noise — the header earns its line only when there is something to separate.
 */
export function repoGroups(choices: readonly RepoChoice[]): readonly RepoGroup[] {
  const own = choices.filter((c) => c.kind === 'workspace' || c.kind === 'worktree')
  const foreign = choices.filter((c) => c.kind === 'repo' || c.kind === 'external')
  const groups: RepoGroup[] = []
  if (own.length > 0) groups.push({ key: 'own', items: own, selectable: own.filter((c) => c.disabled === undefined).length })
  if (foreign.length > 0) groups.push({ key: 'foreign', items: foreign, selectable: foreign.filter((c) => c.disabled === undefined).length })
  return groups
}

/**
 * Primary label of an entry. The relative path disambiguates two checkouts
 * sharing a basename, but repeating it when the basename already is the whole
 * path only adds noise.
 */
export function repoLabel(choice: RepoChoice): string {
  // A workspace file can name a root (`folders[].name`); that name is the one
  // the user sees in their editor, so it wins over the basename/path pair.
  if (choice.label !== undefined) return choice.label
  // Worktrees already get their path on the detail line; putting it into the
  // label too would print "pr-85 (.agents/worktrees/review/pr-85)" in a
  // column narrow enough that the name alone is all that fits.
  if (choice.kind === 'worktree') return choice.name
  // The cwd's own checkout carries an empty path — the repository is the
  // workspace, so there is nothing to disambiguate.
  if (choice.path === '' || choice.name === choice.path) return choice.name
  return `${choice.name} (${choice.path})`
}

/**
 * Secondary line under the name: the checkout path. The workspace's own
 * checkout has no path to state; every other row states it — a first-level
 * directory repeats its name, which keeps every row the same two-line shape.
 * A worktree whose directory name equals its basename shows the *parent* path:
 * the directory itself is already the name on the first line.
 */
export function repoDetail(choice: RepoChoice): string {
  if (choice.kind === 'worktree') {
    if (choice.path.endsWith('/' + choice.name)) {
      return choice.path.slice(0, -(choice.name.length + 1))
    }
    return choice.path
  }
  return choice.path === '' ? '' : choice.path
}

/** i18n key explaining why a row cannot be chosen; null when it can. */
export function repoDisabledKey(choice: RepoChoice): 'repos.disabled.outside' | 'repos.disabled.uncertified' | 'repos.disabled.stale' | null {
  if (choice.disabled === 'outside') return 'repos.disabled.outside'
  if (choice.disabled === 'uncertified') return 'repos.disabled.uncertified'
  if (choice.disabled === 'stale') return 'repos.disabled.stale'
  return null
}

/** One line of a row's hover tip; the kind decides the leading icon. */
export interface RepoTipLine {
  readonly kind: 'reason' | 'branch' | 'path'
  readonly text: string
}

/**
 * Hover tip of one row: the details a narrow row elides, one per line — the
 * reason it cannot be chosen (disabled rows only), the branch the row reports
 * (a detached HEAD prints its state, an unknown branch claims nothing), and
 * the absolute root. The path line is always last; the renderer puts a
 * hairline above it so the branch reads apart from the location.
 */
export function repoRowTip(
  choice: RepoChoice,
  branch: string | null | undefined,
  labels: { readonly detached: string; readonly disabled: string | null },
): readonly RepoTipLine[] {
  const lines: RepoTipLine[] = []
  if (labels.disabled !== null) lines.push({ kind: 'reason', text: labels.disabled })
  if (branch === null) lines.push({ kind: 'branch', text: labels.detached })
  else if (branch !== undefined && branch !== '') lines.push({ kind: 'branch', text: branch })
  lines.push({ kind: 'path', text: choice.root === '' ? repoLabel(choice) : choice.root })
  return lines
}

/** One candidate root of the browse-root dropdown. */
export interface FilesRootRow {
  /** '' = the project root, otherwise the repository selector tag. */
  readonly selector: string
  readonly kind: 'project' | 'repo'
  /** Absolute root, display only. */
  readonly root: string
  /** Repository basename, or the workspace file's display name when it sets
   * one — the same primary label the switcher shows. The project row is
   * labelled by i18n instead. */
  readonly name: string
  /** Grey second line, the same detail rule as the switcher rows. */
  readonly path: string
  readonly disabled?: 'outside' | 'uncertified' | 'stale'
  /** Row the manual pick marks; `pick` null (following) marks none — the
   * follow row is the caller's own and highlights then. */
  readonly active: boolean
}

/** The browse-root dropdown as Panel hands it to the files pane. */
export interface FilesRootMenu {
  readonly rows: readonly FilesRootRow[]
  /** The follow row highlights while no manual pick is active. */
  readonly followActive: boolean
}

/**
 * The checkout a browse-root pick moves the whole panel to. Choosing a root
 * that is itself a selectable checkout switches Git with it — the project root
 * counts when the cwd owns a checkout (the '' entry). null = the pick leaves Git
 * alone: the follow row, a project root that is no repository, a disabled row.
 */
export function gitRepoForFilesRoot(
  selector: string | null,
  entries: readonly { readonly path: string; readonly disabled?: string }[],
): string | null {
  if (selector === null) return null
  const entry = entries.find((e) => e.path === selector)
  return entry === undefined || entry.disabled !== undefined ? null : entry.path
}

/**
 * Candidate roots behind the browse-root dropdown: the project root first,
 * then every checkout; disabled entries stay listed and marked, mirroring the
 * switcher. `pick` is the manual pick ('' = project root, null = following).
 */
export function filesRootRows(projectRoot: string, choices: readonly RepoChoice[], pick: string | null): readonly FilesRootRow[] {
  const rows: FilesRootRow[] = [{
    selector: '',
    kind: 'project',
    root: projectRoot,
    name: '',
    path: '',
    active: pick === '',
  }]
  for (const c of choices) {
    if (c.path === '') continue
    rows.push({
      selector: c.path,
      kind: 'repo',
      root: c.root,
      // The switcher leads with `folders[].name` when the workspace file sets
      // one; two menus must not show two different names for the same root.
      name: c.label ?? c.name,
      path: repoDetail(c),
      ...(c.disabled !== undefined ? { disabled: c.disabled } : {}),
      active: pick === c.path,
    })
  }
  return rows
}
