/**
 * The mounted Git panel's root element, published to the panes below it.
 *
 * A dialog raised from inside the panel can render into this element instead of
 * `document.body`: its backdrop then covers the panel only, not the whole
 * browser window. That is what "keep it in the Git panel" means for the Git
 * Flow dialogs — opening them must not dim the conversation or the editor
 * beside the panel.
 *
 * The value is the `.gp-panel` node itself (positioned, so an absolute overlay
 * fills it); null before mount or outside a panel, where callers fall back to
 * the viewport-level portal.
 */
import { createContext, useContext } from 'react'

export const PanelRootContext = createContext<HTMLElement | null>(null)

export function usePanelRoot(): HTMLElement | null {
  return useContext(PanelRootContext)
}
