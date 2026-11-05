/**
 * The panel's menu face: turn a captured target into actions.
 *
 * Resolution is async because the platform group is borrowed from the
 * platform's own resolution (menu-proxy.ts); the browser's own entries are
 * synchronous and appended after it. Everything is read from the panel's live
 * state at resolve time, so an open menu follows a repository switch or a
 * finished write (the contribution lists the panel's snapshot in `observe`).
 */
import { MENU_KIND, isTreeTarget, type GitMenuValue, type ImageTargetValue, type MenuKind, type MenuOwner } from './menu-owners.js'
import { DIRECTORY_VIEWS, FILE_VIEWS, IMAGE_VIEWS, platformActions } from './menu-proxy.js'
import { directoryMenuActions, fileMenuActions, type MenuCallbacks, type MenuEnv } from './menu-actions.js'
import { branchMenuActions, commitMenuActions, type OverviewMenuCommands, type OverviewMenuFacts } from './overview-menu.js'
import { changeMenuActions, changeDirMenuActions, stashMenuActions, type ChangesMenuCommands, type ChangesMenuFacts } from './changes-menu.js'
import type { BranchTargetValue, ChangeDirTargetValue, ChangeTargetValue, CommitTargetValue } from './menu-owners.js'
import { platformPathFor } from './menu-paths.js'
import type { MenuAction, MenuSource, MenuTrigger } from './menu-types.js'

/** The panel's identity as it stands *now*, compared against the captured one
 * before any action is offered. */
export interface PanelIdentity {
  readonly sessionId: string
  readonly repo: string
}

/** What the panel hands the owner once, reading its state through accessors. */
export interface PanelMenuOptions {
  /** Read live: the menu service may arrive after the panel mounts. */
  readonly env: () => MenuEnv
  /** Absolute root the browser's relative paths hang off, when it has one. */
  readonly browseRoot: () => string | null
  /** Session and repository the panel shows right now. */
  readonly identity: () => PanelIdentity
  /** The Git group's runs (read through the ref the hook keeps fresh). */
  readonly callbacks: () => MenuCallbacks
  /** The overview's runs and busy state, read live. */
  readonly overview: () => { commands: OverviewMenuCommands; facts: () => OverviewMenuFacts }
  /** The changes tab's runs, busy state and checked set, read live. */
  readonly changes: () => {
    commands: ChangesMenuCommands
    facts: () => ChangesMenuFacts
    pick: () => ReadonlySet<string>
  }
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
  const env: MenuEnv = { ...options.env(), callbacks: options.callbacks() }
  // A menu can outlive the surface that raised it. Every action here names a
  // resource by a captured path or ref, so the panel must still be showing the
  // same session, repository and browse root before anything is offered —
  // otherwise "reveal" or "copy path" would act on a path that no longer exists
  // where the panel now points.
  const live = options.identity()
  if (value.sessionId !== live.sessionId || value.repo !== live.repo) return []
  if (isTreeTarget(value) && value.root !== null && value.root !== options.browseRoot()) return []
  if (kind === MENU_KIND.image) {
    return imageActions(value as ImageTargetValue, env, signal)
  }
  if (kind === MENU_KIND.branch) {
    return branchMenuActions(value as BranchTargetValue, env, options.overview().commands, options.overview().facts())
  }
  if (kind === MENU_KIND.commit) {
    return commitMenuActions(value as CommitTargetValue, env, options.overview().commands, options.overview().facts())
  }
  if (kind === MENU_KIND.change) {
    return changeMenuActions(value as ChangeTargetValue, env, options.changes().commands, options.changes().facts(), options.changes().pick())
  }
  if (kind === MENU_KIND.changeDir) {
    return changeDirMenuActions(value as ChangeDirTargetValue, env, options.changes().commands, options.changes().facts())
  }
  if (kind === MENU_KIND.stash) {
    return stashMenuActions(value as never, env, options.changes().commands, options.changes().facts())
  }
  if (!isTreeTarget(value)) return []
  const path = platformPathFor(value, options.browseRoot())
  if (kind === MENU_KIND.directory) {
    const platform = env.menus === undefined
      ? []
      : await platformActions(env.menus, target('directory', value, path), DIRECTORY_VIEWS, signal)
    return directoryMenuActions(value, env, platform)
  }
  const platform = env.menus === undefined
    ? []
    : await platformActions(env.menus, target('file', value, path), FILE_VIEWS, signal)
  return fileMenuActions(value, env, platform)
}

/**
 * The diff panes' pictures: the platform's own image actions (copy, download,
 * save as) applied to the data URL the pane shows. No path is passed, so nothing
 * can claim to reveal a file the picture did not come from.
 */
async function imageActions(
  value: ImageTargetValue, env: MenuEnv, signal: AbortSignal,
): Promise<MenuAction[]> {
  if (env.menus === undefined) return []
  const platformTarget: MenuTrigger = {
    kind: 'image',
    value: {
      url: value.url,
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.mediaType === undefined ? {} : { mediaType: value.mediaType }),
    },
  }
  return platformActions(env.menus, platformTarget, IMAGE_VIEWS, signal)
}

/** The platform target for one tree entry. Directory and file targets differ
 * only in kind; both carry the same absolute path. */
function target(kind: 'file' | 'directory', value: GitMenuValue, path: string): MenuTrigger {
  return { kind, value: { sessionId: value.sessionId, path } }
}
