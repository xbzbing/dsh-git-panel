/**
 * Panel-instance ownership of menu actions.
 *
 * A menu contribution is registered once per plugin, but the actions it offers
 * come from the surface that raised the gesture: one session can have the panel
 * mounted in the conversation tab and in the right sidebar at once, and each
 * copy owns its own selection, busy flags and modals. The captured target
 * therefore carries the owner id (`useId`), and resolution walks back to that
 * instance. A target whose owner has unmounted resolves to no actions rather
 * than to the surviving copy's state.
 */
import type { MenuAction, MenuSource } from './menu-types.js'

/** What one mounted panel offers the menus. */
export interface MenuOwner {
  /** Reactive input for an open menu: the session snapshot the panel renders. */
  observe(): readonly MenuSource[]
  /** The panel's own entries: synchronous, so a slow platform never takes them
   * down with it. */
  own(kind: MenuKind, value: GitMenuValue): readonly MenuAction[]
  /** The platform entries borrowed for this target. `signal` aborts with the
   * popup, so a proxied platform query stops with it. */
  borrowed(kind: MenuKind, value: GitMenuValue, signal: AbortSignal): Promise<readonly MenuAction[]>
}

/** Base every captured target carries: which panel, which session, which
 * checkout. Resolution compares session and repository against the owner's live
 * state and resolves to nothing when they disagree (menu-panel.ts); a tree value
 * is also checked against the browse root it was captured under. */
export interface MenuIdentity {
  readonly sessionId: string
  readonly owner: string
  /** Repository tag (GitRepoEntry.path) the panel was showing. */
  readonly repo: string
}

/** A file or directory in the browser. `path` uses '/' separators relative to
 * `root`; `root` is the absolute browse root, null while it is unresolved. */
export interface TreeTargetValue extends MenuIdentity {
  readonly path: string
  readonly root: string | null
  /** The entry is .gitignore'd: no Git group offers actions on it. */
  readonly ignored: boolean
}

/** A diff picture: the two panes of a binary image diff hold data URLs, and the
 * old side is not a file in the work tree at all. `path` is left out on purpose
 * — with it the platform would point "reveal" at a file that is not what the
 * pane shows. */
export interface ImageTargetValue {
  readonly sessionId: string
  readonly owner: string
  readonly repo: string
  readonly url: string
  /** Suggested download name (the old side carries a revision suffix). */
  readonly name?: string
  readonly mediaType?: string
}

/** One branch row (local or remote). `name` is what the panel's switch map is
 * keyed by; the section is carried so a remote row is never switched as a local
 * name. */
export interface BranchTargetValue extends MenuIdentity {
  readonly name: string
  readonly isCurrent: boolean
  readonly isRemote: boolean
}

/** One commit row (history list or the detail header). */
export interface CommitTargetValue extends MenuIdentity {
  readonly hash: string
  readonly shortHash: string
  readonly subject: string
}

/** One change row: which side it was picked on decides the actions (stage /
 * unstage) and whether discarding is possible at all. */
export interface ChangeTargetValue extends MenuIdentity {
  readonly path: string
  /** The row is the index side (already staged). */
  readonly staged: boolean
}

/** One directory row of the changes tree. */
export interface ChangeDirTargetValue extends MenuIdentity {
  /** Directory path, '' for the repository root row. */
  readonly path: string
  readonly staged: boolean
  /** Every changed path below it, so the menu acts on exactly what the row
   * claims to cover. */
  readonly paths: readonly string[]
  readonly discardable: readonly string[]
}

/** One row of the repository selector. Unlike the tree families its `repo` tag
 * is the row's own checkout (not the panel's selection): the list is a chooser,
 * so "reveal" and "copy path" name the row whoever the panes act on, and the
 * actions only need the row's absolute root. */
export interface RepoTargetValue extends MenuIdentity {
  /** Absolute checkout root ('' when the host did not report one). */
  readonly root: string
}

/** One stash row: the sha the apply/pop/drop actions address plus the subject
 * the row prints (the copy entry reuses it). */
export interface StashTargetValue extends MenuIdentity {
  readonly sha: string
  readonly label: string
}

/** The input-bar pill. It reports the checkout the panel samples, so its
 * actions (jump to a page, copy the branch or the root, check the remote) are
 * bound to that moment: `branch` is null while HEAD is detached. */
export interface PillTargetValue extends MenuIdentity {
  readonly root: string
  readonly branch: string | null
}

/** Everything a captured target value can be. */
export type GitMenuValue =
  | TreeTargetValue | ImageTargetValue | BranchTargetValue | CommitTargetValue
  | ChangeTargetValue | ChangeDirTargetValue | StashTargetValue | RepoTargetValue | PillTargetValue

/** The fields a surface supplies when it binds a target: the value without the
 * identity the panel facade fills in. `repo` stays optional on purpose — a
 * repository row names its own checkout, everything else inherits the panel's.
 */
type MenuSeed<T> = Omit<T, 'sessionId' | 'owner' | 'repo'> & { readonly repo?: string }

export type MenuValueSeed =
  | MenuSeed<TreeTargetValue>
  | MenuSeed<ImageTargetValue>
  | MenuSeed<BranchTargetValue>
  | MenuSeed<CommitTargetValue>
  | MenuSeed<ChangeTargetValue>
  | MenuSeed<ChangeDirTargetValue>
  | MenuSeed<StashTargetValue>
  | MenuSeed<RepoTargetValue>
  | MenuSeed<PillTargetValue>


/** Target kind names. Each is a distinct family in the platform registry, so
 * our contributions never mix with the platform's `file` / `directory` ones —
 * which is what keeps the platform's "open in sidebar" entry out of the menu. */
export const MENU_KIND = {
  file: 'gitPanel.file',
  directory: 'gitPanel.directory',
  image: 'gitPanel.image',
  branch: 'gitPanel.branch',
  commit: 'gitPanel.commit',
  change: 'gitPanel.change',
  changeDir: 'gitPanel.changeDir',
  stash: 'gitPanel.stash',
  repos: 'gitPanel.repos',
  pill: 'gitPanel.pill',
} as const

export type MenuKind = typeof MENU_KIND[keyof typeof MENU_KIND]

/** The kinds this build contributes menus for. */
export const MENU_KINDS: readonly MenuKind[] = [
  MENU_KIND.file, MENU_KIND.directory, MENU_KIND.image, MENU_KIND.branch, MENU_KIND.commit,
  MENU_KIND.change, MENU_KIND.changeDir, MENU_KIND.stash, MENU_KIND.repos, MENU_KIND.pill,
]

/** Narrow a captured value to a browser entry (file or directory). The browser
 * families are the only ones carrying both a relative path and a root; the
 * repository row and the pill name an absolute checkout and carry the root
 * alone. */
export function isTreeTarget(value: GitMenuValue): value is TreeTargetValue {
  return 'path' in value && 'root' in value
}



const owners = new Map<string, MenuOwner>()

/**
 * Publish one panel's menu face.
 * @param id - the panel instance id used in captured targets.
 * @param owner - its action builder.
 * @returns removal, idempotent.
 */
export function registerMenuOwner(id: string, owner: MenuOwner): () => void {
  owners.set(id, owner)
  return () => {
    if (owners.get(id) === owner) owners.delete(id)
  }
}

/** The owner that raised a menu, or undefined once it unmounted. */
export function menuOwner(id: string): MenuOwner | undefined {
  return owners.get(id)
}

/** Forget every owner (plugin teardown: no panel survives it). */
export function disposeMenuOwners(): void {
  owners.clear()
}
