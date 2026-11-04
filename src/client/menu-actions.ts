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

/** Everything the browser's menus need from the panel. */
export interface MenuEnv {
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  /** Absent only if the host withdrew the service between registration and use. */
  readonly menus: ContextMenusService | undefined
}

/** File-row menu: the platform group, then this plugin's own entries. */
export function fileMenuActions(
  value: TreeTargetValue, env: MenuEnv, platform: readonly MenuAction[],
): MenuAction[] {
  return [...platform, ...browserGroup(value, env)]
}

/** Directory row / status-bar root: the same shape, without the file-only
 * entries. */
export function directoryMenuActions(
  value: TreeTargetValue, env: MenuEnv, platform: readonly MenuAction[],
): MenuAction[] {
  return [...platform, ...browserGroup(value, env)]
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
 * outlives the dismissed popup. */
async function copyText(env: MenuEnv, text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
  env.menus?.notify(env.t('menu.copied'), true)
}
