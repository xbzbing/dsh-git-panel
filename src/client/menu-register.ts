/**
 * Menu contribution: the `gitPanel.*` families.
 *
 * One registration covers every kind this build declares. Resolution walks the
 * captured target's owner id back to the panel instance that raised the gesture
 * (menu-owners.ts) and lets it build the actions from its latest snapshot; an
 * owner that has since unmounted contributes nothing, so a menu never speaks for
 * a panel that is no longer on screen. `observe` is resolved the same way: an
 * open menu follows the snapshot of the panel it belongs to, not every panel's.
 *
 * The service is optional and may arrive after this plugin, so it is waited for
 * through a deferred injection instead of the plugin's own `inject` list — a
 * host without the menu package (dsh < 0.2.2-alpha.3) must not hold the whole
 * plugin back.
 */
import { MENU_KINDS, menuOwner, type GitMenuValue, type MenuKind } from './menu-owners.js'
import type { ClientCtx } from './rpc.js'
import type { ContextMenusService, MenuSource } from './menu-types.js'

/** Contribution ids, one per target kind (`<plugin>.<family>` in the platform's
 * view id, which is why they are stable). */
export const MENU_CONTRIBUTION_IDS: Readonly<Record<MenuKind, string>> = {
  'gitPanel.file': 'git-panel.file',
  'gitPanel.directory': 'git-panel.directory',
  'gitPanel.image': 'git-panel.image',
  'gitPanel.branch': 'git-panel.branch',
  'gitPanel.commit': 'git-panel.commit',
  'gitPanel.change': 'git-panel.change',
  'gitPanel.changeDir': 'git-panel.changeDir',
  'gitPanel.stash': 'git-panel.stash',
  'gitPanel.repos': 'git-panel.repos',
  'gitPanel.pill': 'git-panel.pill',
}

/**
 * Ids of the contributions that borrow the platform's own entries for one of
 * this plugin's targets. They sort before the plugin's own contribution for the
 * same family (`git-panel.borrow.file` < `git-panel.file`), which is what keeps
 * the borrowed group first in the merged list while letting it resolve — and
 * fail — on its own.
 */
export const BORROWED_CONTRIBUTION_IDS: Readonly<Partial<Record<MenuKind, string>>> = {
  'gitPanel.file': 'git-panel.borrow.file',
  'gitPanel.directory': 'git-panel.borrow.directory',
  'gitPanel.image': 'git-panel.borrow.image',
  'gitPanel.repos': 'git-panel.borrow.repos',
}

/** The `contextMenus` service, when the host has the menu package. */
export function contextMenusOf(ctx: ClientCtx): ContextMenusService | undefined {
  const face = ctx.get('contextMenus') as ContextMenusService | undefined
  return face !== undefined && typeof face.register === 'function' ? face : undefined
}

/**
 * Register the plugin's contributions.
 * @param menus - the `contextMenus` service.
 * @returns removal of every registration, idempotent.
 */
export function registerGitMenus(menus: ContextMenusService): () => void {
  const unregister: Array<() => void> = []
  for (const kind of MENU_KINDS) {
    // The plugin's own group. Resolved synchronously — which is also why it can
    // follow the snapshot without flickering: a re-resolve costs one pure
    // builder call, not a wait for the platform. The whole face (busy flags, the
    // checked set, a root that turned into a checkout, the sampled remote) is
    // read at resolve time, so an open menu keeps up with all of it.
    unregister.push(menus.register<GitMenuValue>({
      id: MENU_CONTRIBUTION_IDS[kind],
      target: kind,
      // The only contributor of these families; the platform's own bands are
      // 100 / 200, so this is ordinary placement rather than a collision.
      order: 100,
      observe: (value: GitMenuValue) => observeTarget(value),
      resolve: (value) => {
        const owner = menuOwner(value.owner)
        if (owner === undefined) return []
        return owner.own(kind, value)
      },
    }))
    const borrowedId = BORROWED_CONTRIBUTION_IDS[kind]
    if (borrowedId === undefined) continue
    // The borrowed group. Async because the platform answers on its own time, and
    // it deliberately lists no `observe`: its entries do not depend on the
    // panel's snapshot, and re-resolving them would empty that group for the
    // duration of every platform round trip. Separated so a slow or timed-out
    // platform answer cannot take the plugin's entries with it.
    unregister.push(menus.register<GitMenuValue>({
      id: borrowedId,
      target: kind,
      order: 100,
      resolve: async (value, signal) => {
        const owner = menuOwner(value.owner)
        if (owner === undefined) return []
        return owner.borrowed(kind, value, signal)
      },
    }))
  }
  let released = false
  return () => {
    if (released) return
    released = true
    for (const off of unregister) { try { off() } catch { /* ignore */ } }
  }
}

/** Wait for the menu service, then hold the registrations for this plugin's
 * lifetime. */
export function mountGitMenus(ctx: ClientCtx): void {
  ctx.inject(['contextMenus'], (ready) => {
    const menus = contextMenusOf(ready)
    if (menus === undefined) return
    ready.effect(() => registerGitMenus(menus), 'dsh-git-panel: menus')
  })
}

/** Sources an open menu follows for one captured target. Exported for the unit
 * test that pins the per-owner lookup. */
export function observeTarget(value: GitMenuValue): readonly MenuSource[] {
  return menuOwner(value.owner)?.observe() ?? []
}
