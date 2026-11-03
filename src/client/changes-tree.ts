/**
 * Changes-tab row model: the flat change list and the directory tree are two
 * presentations of the same rows, so one pure builder produces both and the
 * tab only maps a row kind to a height, a badge and a handler. Keeping the
 * flattening here also keeps the virtualization offsets and the directory
 * policies testable without a DOM.
 *
 * Picking a directory reuses the existing group select-all (`selection-keys.ts`)
 * on that directory's descendant changes: one selection vocabulary for rows,
 * groups and directories. Directory actions likewise only ever name paths that
 * already exist as change entries, so a directory click cannot aim git at a
 * directory prefix the host never validated (the nested-repo and collapsed
 * untracked-directory guards stay in force).
 */
import { buildFileTree, type FileTreeNode } from './file-tree.js'
import type { GitChange } from './types.js'

/** The three lists the changes tab renders. */
export type ChangeGroupKey = 'staged' | 'unstaged' | 'untracked'

/** One row per change, or one row per directory plus its nested changes. */
export type ChangeViewMode = 'flat' | 'tree'

export interface ChangeGroupInput {
  readonly key: ChangeGroupKey
  /** Loaded rows of the group, already sorted by path. */
  readonly items: readonly GitChange[]
  /**
   * Honest total for the group header (the snapshot's stats count). It exceeds
   * `items.length` when the host capped the list; while filtering it is ignored
   * in favour of the number of hits, which is what the reader can act on.
   */
  readonly count: number
}

/** A group header: chevron, select-all and the honest count. */
export interface ChangeHeadRow {
  readonly kind: 'head'
  readonly group: ChangeGroupKey
  readonly count: number
  /** Rows the head's select-all covers: the loaded, filter-matching ones. */
  readonly items: readonly GitChange[]
  readonly collapsible: boolean
  /**
   * Whether the header reads as folded. Always false while filtering: a hit
   * must be reachable, and the filter only ignores the fold temporarily — the
   * stored state comes back when the query is cleared.
   */
  readonly collapsed: boolean
}

/** A directory: collapse control, aggregated count and directory-level actions. */
export interface ChangeDirRow {
  readonly kind: 'dir'
  readonly group: ChangeGroupKey
  /** Forward-slash path of the directory, relative to the repository root. */
  readonly path: string
  /** Display name; a single-child directory chain is joined with `/`. */
  readonly name: string
  readonly depth: number
  readonly collapsed: boolean
  /** Descendant change entries — the pick / stage / discard target. */
  readonly changes: readonly GitChange[]
}

/** One changed file. */
export interface ChangeFileRow {
  readonly kind: 'file'
  readonly change: GitChange
  readonly depth: number
}

export type ChangeListRow = ChangeHeadRow | ChangeDirRow | ChangeFileRow

export interface ChangeRowsInput {
  readonly groups: readonly ChangeGroupInput[]
  /** Groups the reader collapsed (headers stay, rows go). */
  readonly closedGroups: ReadonlySet<ChangeGroupKey>
  readonly mode: ChangeViewMode
  /** Directory collapse state, keyed by `dirKey`. Only read in tree mode. */
  readonly collapsedDirs: ReadonlySet<string>
  /** Path filter; blank means "no filter". */
  readonly filter: string
}

/** Collapse-state key of a directory: the same path can sit in two groups. */
export function dirKey(group: ChangeGroupKey, path: string): string {
  return `${group}:${path}`
}

/** A stored preference value as a view mode; anything unknown reads as flat. */
export function normalizeViewMode(raw: string | null | undefined): ChangeViewMode {
  return raw === 'tree' ? 'tree' : 'flat'
}

/** Case-insensitive path match: the filter narrows the list, it never edits it. */
export function matchesFilter(path: string, filter: string): boolean {
  const query = filter.trim().toLowerCase()
  return query === '' || path.toLowerCase().includes(query)
}

const NO_DIRS: ReadonlySet<string> = new Set()

/**
 * Flatten the groups into the row list the virtualized list mounts. Groups keep
 * their order; tree mode nests each group's changes under their directories,
 * directories before files, a directory with a single directory child collapsed
 * into one row (`src/client`).
 */
export function buildChangeRows(input: ChangeRowsInput): ChangeListRow[] {
  const filtering = input.filter.trim() !== ''
  const rows: ChangeListRow[] = []
  for (const group of input.groups) {
    const visible = group.items.filter((c) => matchesFilter(c.path, input.filter))
    // While filtering a group without a hit is noise; without a filter a group
    // whose rows all fell past the host's cap keeps its honest count on screen.
    if (visible.length === 0 && (filtering || group.count === 0)) continue
    // A filter reveals every hit: a fold the reader made must not swallow the
    // rows the query was meant to find (the same rule as a folded directory).
    const closed = !filtering && input.closedGroups.has(group.key)
    rows.push({
      kind: 'head',
      group: group.key,
      count: filtering ? visible.length : group.count,
      items: visible,
      collapsible: visible.length > 0,
      collapsed: closed,
    })
    if (closed) continue
    if (input.mode === 'flat') {
      for (const change of visible) rows.push({ kind: 'file', change, depth: 0 })
      continue
    }
    // A filter reveals every hit: an ancestor the reader had collapsed must not
    // swallow the rows the filter was meant to find.
    const collapsed = filtering ? NO_DIRS : input.collapsedDirs
    const tree = walkTree(buildFileTree(visible.map((c) => ({ path: c.path, meta: c }))), 0, group.key, collapsed)
    for (const row of tree.rows) rows.push(row)
  }
  return rows
}

/** Subtree rows in render order, plus the changes they stand for. */
function walkTree(
  nodes: readonly FileTreeNode[],
  depth: number,
  group: ChangeGroupKey,
  collapsed: ReadonlySet<string>,
): { readonly rows: ChangeListRow[]; readonly changes: readonly GitChange[] } {
  const rows: ChangeListRow[] = []
  const changes: GitChange[] = []
  for (const node of nodes) {
    if (!node.dir) {
      const change = node.meta as GitChange
      changes.push(change)
      rows.push({ kind: 'file', change, depth })
      continue
    }
    const hidden = collapsed.has(dirKey(group, node.path))
    // A collapsed directory still needs its descendant list: the directory's
    // count, select-all and actions cover rows the reader has not opened.
    const below = walkTree(node.children, depth + 1, group, hidden ? NO_DIRS : collapsed)
    for (const change of below.changes) changes.push(change)
    rows.push({ kind: 'dir', group, path: node.path, name: node.name, depth, collapsed: hidden, changes: below.changes })
    if (hidden) continue
    for (const row of below.rows) rows.push(row)
  }
  return { rows, changes }
}

/** What a directory row's stage control does: the side its group shows. */
export function dirStageAction(group: ChangeGroupKey, changes: readonly GitChange[]): { readonly kind: 'stage' | 'unstage'; readonly paths: readonly string[] } | null {
  const staged = group === 'staged'
  const paths = dedupe(changes.filter((c) => c.staged === staged).map((c) => c.path))
  if (paths.length === 0) return null
  return { kind: staged ? 'unstage' : 'stage', paths }
}

/**
 * Working-tree paths a directory row's discard covers. Index-side entries have
 * nothing to discard (`git restore --` only touches the work tree), and an
 * empty list means the control has nothing to offer.
 */
export function dirDiscardPaths(changes: readonly GitChange[]): readonly string[] {
  return dedupe(changes.filter((c) => !c.staged).map((c) => c.path))
}

function dedupe(paths: readonly string[]): string[] {
  return [...new Set(paths)].sort()
}
