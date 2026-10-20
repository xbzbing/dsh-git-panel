/**
 * Where the Git panel is mounted, and what the running harness can actually
 * offer.
 *
 * The user's preference (`chosen`) says where the panel should appear. The
 * effective mount (`effective`) is that preference reduced to what the host
 * can serve: a host without the right sidebar has no sidebar page type, and
 * a `sidebar`-only preference would then leave the panel with no entry point
 * at all — so it degrades to `all` rather than to nothing.
 */
import type { GitPanelPlacement } from './types.js'

/** The placements the panel can be mounted at. */
export const PLACEMENTS: readonly GitPanelPlacement[] = ['all', 'tab', 'sidebar']

/** Which mount points a placement uses. */
export interface MountState {
  /** The conversation's view tab (beside Chat / Trajectory). */
  readonly tab: boolean
  /** The right sidebar's page type. */
  readonly sidebar: boolean
}

/**
 * Coerce a raw settings value into a placement. An unknown string (a
 * hand-edited profile, or a value written by a newer version) falls back to
 * the default rather than mounting nowhere.
 */
export function normalizePlacement(value: unknown, fallback: GitPanelPlacement = 'all'): GitPanelPlacement {
  return value === 'all' || value === 'tab' || value === 'sidebar' ? value : fallback
}

/**
 * The mount points a placement uses.
 */
export function mountState(placement: GitPanelPlacement): MountState {
  return {
    tab: placement === 'all' || placement === 'tab',
    sidebar: placement === 'all' || placement === 'sidebar',
  }
}

/**
 * Reduce the preferred placement to the one the host can serve.
 *
 * A `sidebar`-only preference on a host without the right sidebar would
 * remove the conversation tab *and* leave nothing behind, so it degrades to
 * `all` — the panel keeps an entry point, and the preference takes effect as
 * soon as the sidebar shows up.
 */
export function resolvePlacement(chosen: GitPanelPlacement, sidebarAvailable: boolean): GitPanelPlacement {
  if (chosen === 'sidebar' && !sidebarAvailable) return 'all'
  return chosen
}
