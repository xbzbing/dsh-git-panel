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
  /** Actions for one captured target, built from the panel's latest state.
   * `signal` aborts with the popup, so a proxied platform query stops too. */
  actionsFor(kind: MenuKind, value: GitMenuValue, signal: AbortSignal): readonly MenuAction[] | Promise<readonly MenuAction[]>
}

/** Base every captured target carries: which panel, which session, which
 * checkout. All three are compared against the owner's live state before an
 * action runs (menu-guard.ts). */
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

/** Everything a captured target value can be. */
export type GitMenuValue = TreeTargetValue

/** Target kind names. Each is a distinct family in the platform registry, so
 * our contributions never mix with the platform's `file` / `directory` ones —
 * which is what keeps the platform's "open in sidebar" entry out of the menu. */
export const MENU_KIND = {
  file: 'gitPanel.file',
  directory: 'gitPanel.directory',
} as const

export type MenuKind = typeof MENU_KIND[keyof typeof MENU_KIND]

/** The kinds this build contributes menus for. */
export const MENU_KINDS: readonly MenuKind[] = [MENU_KIND.file, MENU_KIND.directory]

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
