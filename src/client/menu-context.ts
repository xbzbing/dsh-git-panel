/**
 * The panel's menu face, published through React context.
 *
 * The file browser's rows receive their binder as a prop — the tree renderer is
 * a pure function called from a memo, so it cannot read a hook — while the image
 * panes sit four components deep inside the diff tree (DiffView → ImageCompare →
 * ZoomableImage), where threading a prop would touch components that have no
 * other reason to know about menus. Context is the narrower change for that
 * path, and a panel that shows no menu simply publishes nothing.
 */
import { createContext, useContext } from 'react'
import type { PanelMenu } from './menu-bindings.js'

/** Absent when the host has no menu package (or outside a panel). */
export const PanelMenuContext = createContext<PanelMenu | undefined>(undefined)

/** The enclosing panel's menu face, if it has one. */
export function usePanelMenu(): PanelMenu | undefined {
  return useContext(PanelMenuContext)
}
