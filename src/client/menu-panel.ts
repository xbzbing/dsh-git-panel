/**
 * The panel's menu face: turn a captured target into actions.
 *
 * Resolution is async because the platform group is borrowed from the
 * platform's own resolution (menu-proxy.ts); the browser's own entries are
 * synchronous and appended after it. Everything is read from the panel's live
 * state at resolve time, so an open menu follows a repository switch or a
 * finished write (the contribution lists the panel's snapshot in `observe`).
 */
import { MENU_KIND, type GitMenuValue, type MenuKind, type MenuOwner } from './menu-owners.js'
import { DIRECTORY_VIEWS, FILE_VIEWS, platformActions } from './menu-proxy.js'
import { directoryMenuActions, fileMenuActions, type MenuEnv } from './menu-actions.js'
import { platformPathFor } from './menu-paths.js'
import type { MenuAction, MenuSource, MenuTrigger } from './menu-types.js'

/** What the panel hands the owner once, reading its state through accessors. */
export interface PanelMenuOptions {
  /** Read live: the menu service may arrive after the panel mounts. */
  readonly env: () => MenuEnv
  /** Absolute root the browser's relative paths hang off, when it has one. */
  readonly browseRoot: () => string | null
  /** Inputs an open menu should follow (the session snapshot). */
  readonly observe: () => readonly MenuSource[]
}

/**
 * Build the owner one panel registers.
 * @param options - live accessors into the panel.
 */
export function panelMenuOwner(options: PanelMenuOptions): MenuOwner {
  return {
    observe: () => options.observe(),
    actionsFor: (kind, value, signal) => actionsFor(kind, value, signal, options),
  }
}

async function actionsFor(
  kind: MenuKind, value: GitMenuValue, signal: AbortSignal, options: PanelMenuOptions,
): Promise<MenuAction[]> {
  const env = options.env()
  const menus = env.menus
  const path = platformPathFor(value, options.browseRoot())
  if (kind === MENU_KIND.directory) {
    const platform = menus === undefined ? [] : await platformActions(menus, target('directory', value, path), DIRECTORY_VIEWS, signal)
    return directoryMenuActions(value, env, platform)
  }
  const platform = menus === undefined ? [] : await platformActions(menus, target('file', value, path), FILE_VIEWS, signal)
  return fileMenuActions(value, env, platform)
}

/** The platform target for one tree entry. Directory and file targets differ
 * only in kind; both carry the same absolute path. */
function target(kind: 'file' | 'directory', value: GitMenuValue, path: string): MenuTrigger {
  return { kind, value: { sessionId: value.sessionId, path } }
}
