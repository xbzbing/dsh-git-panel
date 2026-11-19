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
 *
 * The per-kind row heights live here too: the window math and the renderer
 * share one table, and the stylesheet must pin every row kind to the box that
 * table assumes (the pin is a selector list — dropping one entry lets that row
 * grow to its content height while the offsets still space by the constant).
 */
import { buildFileTree, type FileTreeNode } from './file-tree.js'
import type { ChangesViewMode, GitChange } from './types.js'

/** The three lists the changes tab renders. */
export type ChangeGroupKey = 'staged' | 'unstaged' | 'untracked'

/** One row per change, or one row per directory plus its nested changes.
 * The wire's `ChangesViewMode`, named for the row model. */
export type ChangeViewMode = ChangesViewMode

export interface ChangeGroupInput {
  readonly key: ChangeGroupKey
  /** Loaded rows of the group, already sorted by path. */
  readonly items: readonly GitChange[]
  /**
   * Honest total for the group header (the snapshot's stats count). It exceeds
   * `items.length` when the host capped the list.
   */
  readonly count: number
}

/** A group header: chevron, select-all and the honest count. */
export interface ChangeHeadRow {
  readonly kind: 'head'
  readonly group: ChangeGroupKey
  readonly count: number
  /** Rows the head's select-all covers: the loaded ones. */
  readonly items: readonly GitChange[]
  /**
   * The host capped this group: `items` is only a prefix of the full total.
   * Read off the group so select-all stays hidden whenever only a prefix is
   * loaded — a checked box would read as covering rows the list never fetched.
   */
  readonly truncated: boolean
  /** Whether there are loaded rows to fold. */
  readonly collapsible: boolean
  /**
   * The empty `(0)` frame of a fixed group: no rows, but the header keeps the
   * group's controls (chevron, select-all) so it still reads as a header rather
   * than a bare label.
   */
  readonly frame: boolean
  /** Whether the header reads as folded (the stored state; nothing else
   * overrides it — a row the reader folded stays folded). */
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

/**
 * Fixed height per row kind: the virtual window sums these before any render
 * and the stylesheet pins the same kinds to their box
 * (`.gp-changes__vrow>…{height:100%}`), so a kind added here needs its pin
 * there too. Both sides of that contract are asserted: this table and the pin
 * in `test/unit/changes-row-heights.test.mjs`, the rendered geometry in
 * `test/e2e/changes-tree.mjs`.
 */
export const ROW_H: Record<ChangeListRow['kind'], number> = { head: 26, dir: 26, file: 28 }

export interface ChangeRowsInput {
  readonly groups: readonly ChangeGroupInput[]
  /** Groups the reader collapsed (headers stay, rows go). */
  readonly closedGroups: ReadonlySet<ChangeGroupKey>
  readonly mode: ChangeViewMode
  /** Directory collapse state, keyed by `dirKey`. Only read in tree mode. */
  readonly collapsedDirs: ReadonlySet<string>
}

/** Collapse-state key of a directory: the same path can sit in two groups. */
export function dirKey(group: ChangeGroupKey, path: string): string {
  return `${group}:${path}`
}

/** A stored preference value as a view mode; anything unknown reads as flat. */
export function normalizeViewMode(raw: string | null | undefined): ChangeViewMode {
  return raw === 'tree' ? 'tree' : 'flat'
}

/** Folds passed down into an already-collapsed subtree: its rows are not
 * emitted, so nothing inside it can read as hidden-but-expanded. */
const EMPTY_FOLDS: ReadonlySet<string> = new Set()

/**
 * Groups whose header stays on screen at `(0)`: the list's fixed frame. A group
 * not listed here only appears once it has rows (or a capped count to show), so
 * a group kind added later defaults to hidden-until-present.
 */
const FRAME_GROUPS: ReadonlySet<ChangeGroupKey> = new Set(['staged', 'unstaged'])

/**
 * The groups the row list should mount a header for. The frame is always
 * supplied — an empty header reading `(0)` is the signal that the side is
 * empty, not that the section is missing. Every other group appears with rows,
 * or when the host capped its rows away but its honest count is known.
 */
export function visibleChangeGroups<G extends { readonly key: ChangeGroupKey; readonly items: readonly GitChange[] }>(
  groups: readonly G[],
  counts: Readonly<Record<ChangeGroupKey, number>>,
  truncated: boolean,
): G[] {
  return groups.filter((g) => FRAME_GROUPS.has(g.key) || g.items.length > 0 || (truncated && counts[g.key] > 0))
}

/**
 * Flatten the groups into the row list the virtualized list mounts. Groups keep
 * their order; tree mode nests each group's changes under their directories,
 * directories before files, a directory with a single directory child collapsed
 * into one row (`src/client`).
 *
 * Every passed group keeps its header, including one at `(0)` with no rows: the
 * tab decides which groups exist, and the staged / unstaged pair is its fixed
 * frame — a header that vanished at zero forced the reader to re-read the labels
 * to tell "nothing staged" from "no such section".
 */
export function buildChangeRows(input: ChangeRowsInput): ChangeListRow[] {
  const rows: ChangeListRow[] = []
  for (const group of input.groups) {
    const items = group.items
    const closed = input.closedGroups.has(group.key)
    rows.push({
      kind: 'head',
      group: group.key,
      count: group.count,
      items,
      truncated: items.length < group.count,
      collapsible: items.length > 0,
      frame: items.length === 0 && group.count === 0,
      collapsed: closed,
    })
    if (closed) continue
    if (input.mode === 'flat') {
      for (const change of items) rows.push({ kind: 'file', change, depth: 0 })
      continue
    }
    const tree = walkTree(buildFileTree(items.map((c) => ({ path: c.path, meta: c }))), 0, group.key, input.collapsedDirs)
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
    const below = walkTree(node.children, depth + 1, group, hidden ? EMPTY_FOLDS : collapsed)
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
