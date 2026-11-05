/**
 * Menu actions for the file browser's entries.
 *
 * A pure builder of (captured value, environment, platform actions): the panel
 * supplies a translate and the clipboard/notification face, the proxy supplies
 * the platform group, and nothing here touches React. A phase that adds a group
 * adds it here, so the menu's composition is readable in one file.
 */
import type { TreeTargetValue } from './menu-owners.js'
import type { ContextMenusService, MenuAction } from './menu-types.js'
import type { GitKey } from './locales.js'

/** What the Git group needs to know, read at resolve time. */
export interface MenuFacts {
  /** The browser's root is inside a checkout, so a path has Git history. */
  readonly isGit: boolean
  /** The host declared `capabilities.revDiff` / `capabilities.pathHistory`. */
  readonly revDiff: boolean
  readonly pathHistory: boolean
}

/** What the Git group's entries run; the panel supplies them. */
export interface MenuCallbacks {
  readonly compareRevision: (value: TreeTargetValue) => void
  readonly compareRef: (value: TreeTargetValue) => void
  readonly showHistory: (value: TreeTargetValue) => void
}

/** Everything the browser's menus need from the panel. */
export interface MenuEnv {
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  /** Absent only if the host withdrew the service between registration and use. */
  readonly menus: ContextMenusService | undefined
  readonly facts: MenuFacts
  /** Present once the panel registered its runs (menu-panel.ts fills it). */
  readonly callbacks?: MenuCallbacks
}

/** File-row menu: the platform group, then Git, then this plugin's own entries. */
export function fileMenuActions(
  value: TreeTargetValue, env: MenuEnv, platform: readonly MenuAction[],
): MenuAction[] {
  return [...platform, ...gitGroup(value, env), ...browserGroup(value, env)]
}

/** Directory row / status-bar root: the same shape, without the file-only
 * entries. A directory's history covers every path below it. */
export function directoryMenuActions(
  value: TreeTargetValue, env: MenuEnv, platform: readonly MenuAction[],
): MenuAction[] {
  return [...platform, ...gitGroup(value, env), ...browserGroup(value, env)]
}

/**
 * The Git group. Hidden entirely for an ignored entry (git has no history for
 * it), for the status-bar root (no path of its own) and on a host that did not
 * declare the capability: an old host reads an unknown `base` as a work-tree
 * diff and would answer with the wrong content rather than fail.
 */
function gitGroup(value: TreeTargetValue, env: MenuEnv): MenuAction[] {
  if (!env.facts.isGit || value.ignored || value.path === '') return []
  const group: MenuAction[] = []
  if (env.facts.revDiff) {
    group.push(
      { id: 'compare-revision', label: env.t('menu.compareRevision'), run: () => env.callbacks?.compareRevision(value) },
      { id: 'compare-ref', label: env.t('menu.compareRef'), run: () => env.callbacks?.compareRef(value) },
    )
  }
  if (env.facts.pathHistory) {
    group.push({ id: 'show-history', label: env.t('menu.showHistory'), run: () => env.callbacks?.showHistory(value) })
  }
  return group
}

/** Entries owned by the browser itself. The root row has no relative path to
 * copy (it *is* the root), so it omits that one. */
function browserGroup(value: TreeTargetValue, env: MenuEnv): MenuAction[] {
  const group: MenuAction[] = []
  if (value.path !== '') group.push({
    id: 'copy-relative-path',
    label: env.t('menu.copyRelativePath'),
    failureLabel: env.t('menu.copyFailed'),
    run: () => copyText(env, value.path),
  })
  return group
}

/** Write to the clipboard and report through the platform's toast, which
 * outlives the dismissed popup. Shared by every group that copies. */
export async function copyText(env: Pick<MenuEnv, 't' | 'menus'>, text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  env.menus?.notify(env.t('menu.copied'), true)
}
