/**
 * Whether the platform's shared context-menu popup is currently open.
 *
 * The platform publishes the captured target of its single popup
 * (`contextMenus.active`, `null` after dismissal). Surfaces that draw at the
 * cursor need it: the popup is an overlay, so anything anchored to the pointer
 * would be painted underneath it.
 */
import { useCallback, useSyncExternalStore } from 'react'
import type { MenuSnapshot } from './menu-types.js'

/**
 * @param active - the popup's target snapshot, when the host has a menu package.
 * @returns true while a popup is open (always false without the snapshot).
 */
export function useMenuActive(active: MenuSnapshot<unknown> | undefined): boolean {
  const subscribe = useCallback(
    (listener: () => void) => (active === undefined ? () => {} : active.subscribe(listener)),
    [active],
  )
  const getSnapshot = useCallback(() => active !== undefined && active.getSnapshot() !== null, [active])
  // Server rendering has no popup; the client snapshot is the only truth.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
