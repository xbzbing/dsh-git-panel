/**
 * Trigger binding for rows: merge the platform's context-menu props into a
 * row's own props, or hand the handlers through untouched when the platform
 * has no menu system (dsh < 0.2.2-alpha.3).
 *
 * `getTriggerProps` is an ordinary function, not a React hook — the platform
 * injects it as a plain prop factory and it creates no subscriptions. The
 * indirection through `MenuTriggerFactory` exists so row renderers can bind a
 * menu without knowing whether one is available, and so the react-hooks rules
 * never see a call that looks like a conditional hook.
 */
import { MENU_KIND } from './menu-owners.js'
import type { GitMenuValue, MenuKind } from './menu-owners.js'
import type { MenuBindings, MenuTriggerHandlers } from './menu-types.js'

/** A stable factory one panel holds for its lifetime. */
export type MenuTriggerFactory = {
  bind: (kind: MenuKind, value: GitMenuValue, handlers?: MenuTriggerHandlers) => MenuTriggerHandlers
}

/** The no-menu fallback: rows keep their own handlers, native menu stays. */
export const NO_MENU: MenuTriggerFactory = { bind: (_kind, _value, handlers) => handlers ?? {} }

/** What a row calls: the panel has already folded its identity (session, owner,
 * repository, root) into the value, so a row names only itself. */
export type RowMenuBinder = (
  path: string,
  kind: MenuKind,
  ignored: boolean,
  handlers?: MenuTriggerHandlers,
) => MenuTriggerHandlers

/**
 * Build the panel's trigger factory.
 * @param useContextMenu - the injected slot prop, when the host provides one.
 * @returns a factory bound to the platform bindings, or `NO_MENU`.
 */
export function menuTriggerFactory(useContextMenu: (() => MenuBindings) | undefined): MenuTriggerFactory {
  if (typeof useContextMenu !== 'function') return NO_MENU
  // The platform injects `useContextMenu` as an ordinary prop factory, not a
  // React hook: it creates no subscriptions and calls no hooks. The eslint
  // disable documents that reading (the naming convention is the platform's,
  // set in its GlobalStandardProps declaration).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const bindings = useContextMenu()
  if (bindings === undefined || typeof bindings.getTriggerProps !== 'function') return NO_MENU
  return {
    bind: (kind, value, handlers) => bindings.getTriggerProps({ kind, value }, handlers),
  }
}

export { MENU_KIND }
export type { GitMenuValue, MenuKind } from './menu-owners.js'
