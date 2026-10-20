/**
 * The live mount state: what the user asked for, and what the panel is
 * actually mounted at.
 *
 * Module-level rather than React state, because the pill reads it outside any
 * component's render (it decides where a click lands) and the mount
 * reconciliation lives in the plugin's `apply`, not in a component.
 */
import { normalizePlacement, resolvePlacement } from './placement.js'
import type { GitPanelPlacement } from './types.js'

/** The user's preference, and whether the host can serve the sidebar mount. */
interface PlacementState {
  chosen: GitPanelPlacement
  sidebarAvailable: boolean
}

const state: PlacementState = { chosen: 'all', sidebarAvailable: false }

/**
 * The placement the panel is mounted at: the user's preference reduced to what
 * the host can serve.
 */
export function effectivePlacement(): GitPanelPlacement {
  return resolvePlacement(state.chosen, state.sidebarAvailable)
}

/** Record a new user preference. */
export function setChosenPlacement(value: unknown): GitPanelPlacement {
  state.chosen = normalizePlacement(value, 'all')
  return state.chosen
}

/** Record whether the right sidebar is available. */
export function setSidebarAvailable(available: boolean): void {
  state.sidebarAvailable = available
}
