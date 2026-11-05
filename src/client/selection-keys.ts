/**
 * Change-list selection keys. A key carries the side the row was picked on:
 * `path:w` (working tree) / `path:s` (index). A path that is both staged and
 * modified shows up as two rows, so selection / active / armed are keyed by
 * path+side and acting on one row does not light up the other.
 *
 * Every construction and every parse goes through this module: an inline
 * `path + (staged ? ':s' : ':w')` or a hand-rolled suffix strip elsewhere would
 * be a second authority for the same format. The side alphabet itself is spelled
 * once, in `sideOf` — `pathOfKey` derives from it instead of re-spelling it, so
 * a new side cannot update one without the other.
 *
 * Besides the codec this module holds the policies that consume keys:
 * `pickDiscardTargets` (batch-discard split), `pickStageTargets` /
 * `pickUnstageTargets` (the two batch stage directions), and the group
 * select-all state (`groupPickState` / `toggleGroupKeys`). They are defined on
 * the same sides, so they live next to them rather than re-deriving them at the
 * call site.
 */
import type { GitChange } from './types.js'

/** The side a selection key was picked on. */
export type ChangeSide = 's' | 'w'

/** Selection key for a change row (`path:s` when staged, else `path:w`). */
export function changeKey(c: Pick<GitChange, 'path' | 'staged'>): string {
  return c.path + (c.staged ? ':s' : ':w')
}

/** Side carried by a key, or null when the key has no known side suffix. */
export function sideOf(key: string): ChangeSide | null {
  if (key.endsWith(':s')) return 's'
  if (key.endsWith(':w')) return 'w'
  return null
}

/** Bare path behind a key; only a trailing side suffix is dropped. */
export function pathOfKey(key: string): string {
  return sideOf(key) === null ? key : key.slice(0, -2)
}

export interface DiscardTargets {
  /** Deduped working-tree paths `discard` will act on (sorted for a stable request). */
  readonly paths: readonly string[]
  /**
   * Paths picked on the index side only (`:s` with no `:w` pick of the same
   * path). A working-tree discard cannot touch them, so the dialog names their
   * count instead of quietly leaving them out of the total.
   */
  readonly stagedOnly: readonly string[]
}

/**
 * Split keys into their per-side path buckets, deduped; keys with no known
 * side are ignored. Total by construction: each side names its own bucket, so
 * widening `ChangeSide` fails to compile here instead of letting a new side
 * fall through to one bucket and silently drop out of a batch action.
 */
function splitBySide(keys: Iterable<string>): Record<ChangeSide, Set<string>> {
  const bySide: Record<ChangeSide, Set<string>> = { w: new Set(), s: new Set() }
  for (const key of keys) {
    const side = sideOf(key)
    if (side === null) continue
    bySide[side].add(pathOfKey(key))
  }
  return bySide
}

/**
 * Batch-discard target resolution. `discard` only ever touches the working tree
 * (`git restore --`, untracked files are deleted), so a batch discard acts on
 * the `:w` picks and index-side picks are reported separately rather than being
 * silently swallowed by the count. Keys with no known side are ignored.
 */
export function pickDiscardTargets(keys: Iterable<string>): DiscardTargets {
  const { w: worktree, s: staged } = splitBySide(keys)
  return {
    paths: [...worktree].sort(),
    stagedOnly: [...staged].filter((p) => !worktree.has(p)).sort(),
  }
}

/**
 * Batch-stage targets from a selection: the working-tree-side picks (`:w`),
 * deduped and sorted. An index-side pick (`:s`) is already staged, so it never
 * widens the target set — a path picked on both sides stages once. Keys with no
 * known side are ignored, like `pickDiscardTargets`.
 */
export function pickStageTargets(keys: Iterable<string>): readonly string[] {
  return [...splitBySide(keys).w].sort()
}

/**
 * Batch-unstage targets from a selection: the index-side picks (`:s`), deduped
 * and sorted. The mirror of `pickStageTargets` — a working-tree pick is not in
 * the index and owes nothing to `git reset`, so it never widens this set.
 */
export function pickUnstageTargets(keys: Iterable<string>): readonly string[] {
  return [...splitBySide(keys).s].sort()
}

/** Tri-state of one group's rows against the current selection. */
export type GroupPickState = 'none' | 'partial' | 'all'

/**
 * Group select-all state: `all` when every row in the group is picked, `partial`
 * when some are, `none` when none are. An empty group is `none` — the head has
 * nothing to toggle and the checkbox reads unchecked.
 */
export function groupPickState(selected: ReadonlySet<string>, changes: readonly Pick<GitChange, 'path' | 'staged'>[]): GroupPickState {
  if (changes.length === 0) return 'none'
  let picked = 0
  for (const c of changes) if (selected.has(changeKey(c))) picked++
  if (picked === 0) return 'none'
  return picked === changes.length ? 'all' : 'partial'
}

/**
 * Toggle one group: every row picked → clear just those keys; otherwise pick
 * all of them. Keys outside the group are left untouched, so a mixed selection
 * spanning groups survives a group toggle.
 */
export function toggleGroupKeys(selected: ReadonlySet<string>, changes: readonly Pick<GitChange, 'path' | 'staged'>[]): Set<string> {
  const next = new Set(selected)
  const allPicked = changes.length > 0 && changes.every((c) => next.has(changeKey(c)))
  for (const c of changes) {
    const key = changeKey(c)
    if (allPicked) next.delete(key); else next.add(key)
  }
  return next
}
