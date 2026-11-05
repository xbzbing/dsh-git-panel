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
  const unregister = MENU_KINDS.map((kind) => menus.register<GitMenuValue>({
    id: MENU_CONTRIBUTION_IDS[kind],
    target: kind,
    // The only contributor of these families; the platform's own bands are
    // 100 / 200, so this is ordinary placement rather than a collision.
    order: 100,
    observe: (value) => observeTarget(value),
    resolve: async (value, signal) => {
      const owner = menuOwner(value.owner)
      if (owner === undefined) return []
      return owner.actionsFor(kind, value, signal)
    },
  }))
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
