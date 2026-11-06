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
import { repoRowMenuActions, type ReposMenuCommands, type ReposMenuFacts } from './repos-menu.js'
import type { BranchTargetValue, ChangeDirTargetValue, ChangeTargetValue, CommitTargetValue, RepoTargetValue, StashTargetValue } from './menu-owners.js'
import { platformPathFor } from './menu-paths.js'
import type { ContextMenusService, MenuAction, MenuSource, MenuTrigger } from './menu-types.js'

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
  /** The repository rows' remote check, read live (the checkout asked about is
   * named per row). */
  readonly repos: () => { commands: ReposMenuCommands; facts: (repoTag: string) => ReposMenuFacts }
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
    own: (kind, value) => ownActionsFor(kind, value, options),
    borrowed: (kind, value, signal) => borrowedActionsFor(kind, value, signal, options),
  }
}

/** The families that borrow the platform's own entries for the same target
 * (open / reveal / copy path, image copy / download / save as). Every other
 * family is the plugin's alone. */
export const BORROWED_KINDS: ReadonlySet<MenuKind> = new Set<MenuKind>([
  MENU_KIND.file, MENU_KIND.directory, MENU_KIND.image, MENU_KIND.repos,
])

/** Whether an occurrence still names the surface it was raised on. A menu can
 * outlive that surface: every action here names a resource by a captured path or
 * ref, so the panel must still show the same session, repository and browse root
 * before anything is offered — otherwise "reveal" or "copy path" would act on a
 * path that no longer exists where the panel now points. */
function identityOk(kind: MenuKind, value: GitMenuValue, options: PanelMenuOptions): boolean {
  const live = options.identity()
  if (value.sessionId !== live.sessionId) return false
  // A repository row names its own checkout: the row is one entry of a chooser,
  // not a path inside the checkout the panes act on, so picking another
  // repository in the panel does not invalidate it. Its actions only need the
  // row's absolute root, which the captured value carries.
  if (kind === MENU_KIND.repos) return (value as RepoTargetValue).root !== ''
  if (value.repo !== live.repo) return false
  if (isTreeTarget(value) && value.root !== null && value.root !== options.browseRoot()) return false
  return true
}

/**
 * The plugin's own entries. Synchronous on purpose: the platform resolves each
 * contribution under its own budget, and an entry list that has to wait for the
 * platform's copy would disappear entirely whenever that copy is slow.
 */
export function ownActionsFor(
  kind: MenuKind, value: GitMenuValue, options: PanelMenuOptions,
): readonly MenuAction[] {
  if (!identityOk(kind, value, options)) return []
  const env: MenuEnv = { ...options.env(), callbacks: options.callbacks() }
  // The image family is the platform's own copy / download / save-as; it has no
  // plugin entries of its own.
  if (kind === MENU_KIND.image) return []
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
    return stashMenuActions(value as StashTargetValue, env, options.changes().commands, options.changes().facts())
  }
  if (kind === MENU_KIND.repos) {
    const row = value as RepoTargetValue
    const repos = options.repos()
    return repoRowMenuActions(row, env, [], repos.commands, repos.facts(row.repo))
  }
  if (!isTreeTarget(value)) return []
  if (kind === MENU_KIND.directory) return directoryMenuActions(value, env, [])
  return fileMenuActions(value, env, [])
}

/**
 * The platform's own entries, borrowed for one of this plugin's targets. Async
 * on purpose: the platform answers under its own request, and this group may
 * arrive late or not at all — the plugin's entries above are unaffected.
 */
export async function borrowedActionsFor(
  kind: MenuKind, value: GitMenuValue, signal: AbortSignal, options: PanelMenuOptions,
): Promise<readonly MenuAction[]> {
  if (!BORROWED_KINDS.has(kind) || !identityOk(kind, value, options)) return []
  const menus = options.env().menus
  if (menus === undefined) return []
  if (kind === MENU_KIND.image) return borrowedImageActions(value as ImageTargetValue, menus, signal)
  if (kind === MENU_KIND.repos) {
    const row = value as RepoTargetValue
    return platformActions(
      menus,
      { kind: 'directory', value: { sessionId: row.sessionId, path: row.root } },
      DIRECTORY_VIEWS,
      signal,
    )
  }
  if (!isTreeTarget(value)) return []
  const path = platformPathFor(value, options.browseRoot())
  if (kind === MENU_KIND.directory) {
    return platformActions(menus, target('directory', value, path), DIRECTORY_VIEWS, signal)
  }
  return platformActions(menus, target('file', value, path), FILE_VIEWS, signal)
}

/**
 * The diff panes' pictures: the platform's own image actions (copy, download,
 * save as) applied to the data URL the pane shows. No path is passed, so nothing
 * can claim to reveal a file the picture did not come from.
 */
async function borrowedImageActions(
  value: ImageTargetValue, menus: ContextMenusService, signal: AbortSignal,
): Promise<readonly MenuAction[]> {
  const platformTarget: MenuTrigger = {
    kind: 'image',
    value: {
      url: value.url,
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.mediaType === undefined ? {} : { mediaType: value.mediaType }),
    },
  }
  return platformActions(menus, platformTarget, IMAGE_VIEWS, signal)
}

/** The platform target for one tree entry. Directory and file targets differ
 * only in kind; both carry the same absolute path. */
function target(kind: 'file' | 'directory', value: GitMenuValue, path: string): MenuTrigger {
  return { kind, value: { sessionId: value.sessionId, path } }
}
