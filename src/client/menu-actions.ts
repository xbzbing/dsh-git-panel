/**
 * Menu actions for the file browser's entries.
 *
 * A pure builder of (captured value, environment, platform actions): the panel
 * supplies a translate and the clipboard/notification face, the proxy supplies
 * the platform group, and nothing here touches React. A phase that adds a group
 * adds it here, so the menu's composition is readable in one file.
 */
import type { TreeTargetValue } from './menu-owners.js'
import { menuIcon } from './menu-icons.js'
import type { ContextMenusService, MenuAction } from './menu-types.js'
import type { GitKey } from './locales.js'

/** What the Git group needs to know, read at resolve time. */
export interface MenuFacts {
  /** The browser's root is inside a checkout, so a path has Git history. */
  readonly isGit: boolean
  /** The host declared `capabilities.revDiff` / `capabilities.pathHistory`. */
  readonly revDiff: boolean
  readonly pathHistory: boolean
  /** The session has a composer the menu may quote into (quote.ts). */
  readonly canQuote?: boolean
}

/** What the Git group's entries run; the panel supplies them. */
export interface MenuCallbacks {
  readonly compareRevision: (value: TreeTargetValue) => void
  readonly compareRef: (value: TreeTargetValue) => void
  readonly showHistory: (value: TreeTargetValue) => void
  /** Put one reference into the session's composer (falls back to the
   * clipboard when the composer is gone; see quote.ts). */
  readonly quote: (text: string) => void
}

/** Everything the browser's menus need from the panel. */
export interface MenuEnv {
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  /** Absent only if the host withdrew the service between registration and use. */
  readonly menus: ContextMenusService | undefined
  readonly facts: MenuFacts
  /** Writes text to the clipboard and reports whether it landed. Supplied by
   * the client half, which owns the platform's clipboard helper — the raw
   * `navigator.clipboard` is missing outside a secure context. */
  readonly writeClipboard: (text: string) => Promise<boolean>
  /** Present once the panel registered its runs (menu-panel.ts fills it). */
  readonly callbacks?: MenuCallbacks
}

/** File-row menu: the platform group, then Git, then this plugin's own entries. */
export function fileMenuActions(
  value: TreeTargetValue, env: MenuEnv, platform: readonly MenuAction[],
): MenuAction[] {
  return [...platform, ...gitGroup(value, env, 'file'), ...browserGroup(value, env)]
}

/** Directory row / status-bar root: the same shape, without the file-only
 * entries. A directory's history covers every path below it, but a revision
 * comparison does not: it is a single-file pane, and a directory answers with a
 * multi-file diff the pane cannot render. */
export function directoryMenuActions(
  value: TreeTargetValue, env: MenuEnv, platform: readonly MenuAction[],
): MenuAction[] {
  return [...platform, ...gitGroup(value, env, 'directory'), ...browserGroup(value, env)]
}

/**
 * The Git group. Hidden entirely for an ignored entry (git has no history for
 * it), for the status-bar root (no path of its own) and on a host that did not
 * declare the capability: an old host reads an unknown `base` as a work-tree
 * diff and would answer with the wrong content rather than fail.
 */
function gitGroup(value: TreeTargetValue, env: MenuEnv, target: 'file' | 'directory'): MenuAction[] {
  if (!env.facts.isGit || value.ignored || value.path === '') return []
  const group: MenuAction[] = []
  if (env.facts.revDiff && target === 'file') {
    group.push(
      { id: 'compare-revision', label: env.t('menu.compareRevision'), icon: menuIcon('compare'), run: () => env.callbacks?.compareRevision(value) },
      { id: 'compare-ref', label: env.t('menu.compareRef'), icon: menuIcon('compare'), run: () => env.callbacks?.compareRef(value) },
    )
  }
  if (env.facts.pathHistory) {
    group.push({ id: 'show-history', label: env.t('menu.showHistory'), icon: menuIcon('history'), run: () => env.callbacks?.showHistory(value) })
  }
  return group
}

/**
 * Entries owned by the browser itself.
 *
 * The platform group already offers "copy path" (the absolute one), so a
 * workspace-relative copy would be a second, differently-shaped answer to the
 * same question; the browser adds only what the platform cannot know — putting
 * the path into the session's composer. The root row has no path of its own, so
 * it has neither.
 */
function browserGroup(value: TreeTargetValue, env: MenuEnv): MenuAction[] {
  if (value.path === '' || env.facts.canQuote !== true) return []
  return [{
    id: 'quote-path',
    label: env.t('menu.quotePath'),
    icon: menuIcon('quote'),
    failureLabel: env.t('menu.copyFailed'),
    run: () => env.callbacks?.quote(value.path),
  }]
}

/**
 * Write to the clipboard and report through the platform's toast, which
 * outlives the dismissed popup. Shared by every group that copies.
 *
 * The write goes through the platform helper rather than `navigator.clipboard`
 * directly: the raw API is absent outside a secure context, and a hosted GUI is
 * not always served over HTTPS, where every copy entry would then fail silently.
 */
export async function copyText(env: MenuEnv, text: string): Promise<void> {
  const ok = await env.writeClipboard(text)
  env.menus?.notify(ok ? env.t('menu.copied') : env.t('menu.copyFailed'), ok)
}
