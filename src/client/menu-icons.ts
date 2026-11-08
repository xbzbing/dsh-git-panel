/**
 * Icons for this plugin's own menu entries.
 *
 * The platform paints an action's `icon` by looking up `icon.key` in its
 * `contextMenu.icon` slot (each package registers the keys it owns), so a
 * contribution cannot hand over a component directly — it names a key and the
 * popup draws whatever was registered under it. The keys here are namespaced
 * with the plugin id, which is what keeps them from colliding with the
 * platform's (`open-in-app.*`, `file-actions.*`).
 *
 * The glyphs are this plugin's own 16×16 stroke icons: they inherit
 * `currentColor`, so a danger entry's red reaches its icon without a second
 * rule, and they take the popped menu's sizing like any platform glyph.
 */
import type { JSX } from 'react'
import { BranchIcon, CherryPickIcon, CommitIcon, CopyIcon, DiffIcon, FilesIcon, HistoryIcon, ListIcon, MergeIcon, QuoteIcon, RevertIcon, ResetIcon, StashIcon, StagePickedIcon, SyncIcon, TagIcon, TrashIcon } from './icons.js'
import type { ClientCtx } from './rpc.js'
/** What a platform glyph takes: the popup passes its own size and class. */
interface IconProps {
  readonly size?: number
  readonly className?: string
}

/** The one table a menu glyph lives in: the stable key plus the component that
 * paints it. Two parallel maps used to drift — a name could gain a key and no
 * glyph, and the platform has no fallback for a missing key. */
const MENU_ICON_TABLE = {
  compare: { key: 'git-panel.compare', Icon: DiffIcon },
  history: { key: 'git-panel.history', Icon: HistoryIcon },
  copy: { key: 'git-panel.copy', Icon: CopyIcon },
  quote: { key: 'git-panel.quote', Icon: QuoteIcon },
  branch: { key: 'git-panel.branch', Icon: BranchIcon },
  merge: { key: 'git-panel.merge', Icon: MergeIcon },
  pick: { key: 'git-panel.pick', Icon: CherryPickIcon },
  tag: { key: 'git-panel.tag', Icon: TagIcon },
  revert: { key: 'git-panel.revert', Icon: RevertIcon },
  reset: { key: 'git-panel.reset', Icon: ResetIcon },
  checkout: { key: 'git-panel.checkout', Icon: CommitIcon },
  stage: { key: 'git-panel.stage', Icon: StagePickedIcon },
  discard: { key: 'git-panel.discard', Icon: TrashIcon },
  delete: { key: 'git-panel.delete', Icon: TrashIcon },
  stash: { key: 'git-panel.stash', Icon: StashIcon },
  fetch: { key: 'git-panel.fetch', Icon: SyncIcon },
  overview: { key: 'git-panel.overview', Icon: ListIcon },
  changes: { key: 'git-panel.changes', Icon: DiffIcon },
  files: { key: 'git-panel.files', Icon: FilesIcon },
} as const

type MenuIconEntry = (typeof MENU_ICON_TABLE)[keyof typeof MENU_ICON_TABLE]

/** Stable icon keys. Changing one silently drops that entry's glyph (the slot
 * has no fallback), so they are pinned by a unit test. */
export type MenuIconName = keyof typeof MENU_ICON_TABLE
export const MENU_ICONS = Object.fromEntries(
  Object.entries(MENU_ICON_TABLE).map(([name, entry]) => [name, entry.key]),
) as { readonly [K in MenuIconName]: (typeof MENU_ICON_TABLE)[K]['key'] }

/** The icon a menu action names. The platform resolves the key; a picture that
 * comes with the action (`src`) is not used here. */
export function menuIcon(name: MenuIconName): { readonly key: string } {
  return { key: MENU_ICON_TABLE[name].key }
}

/** One entry of the platform's `contextMenu.icon` slot. */
interface IconSlotProps extends IconProps {
  /** The action's own icon value (unused: this plugin's glyphs carry no image). */
  readonly icon?: { readonly key: string; readonly src?: string }
}

/**
 * Register the plugin's glyphs with the platform's menu-icon slot.
 *
 * Called from the same deferred injection that registers the menu
 * contributions: a host without the context-menu package has no slot to fill,
 * and registering into a slot that never exists would be dead wiring.
 */
export function registerMenuIcons(ctx: ClientCtx): () => void {
  const released: Array<() => void> = []
  for (const [name, entry] of Object.entries(MENU_ICON_TABLE) as Array<[MenuIconName, MenuIconEntry]>) {
    try {
      const handle = ctx.slots.inject('contextMenu.icon', () => ctx.slots.register(
        { name: 'contextMenu.icon', key: MENU_ICONS[name] },
        entry.Icon as (props: IconSlotProps) => JSX.Element,
      ))
      if (typeof handle === 'function') released.push(handle as () => void)
    } catch {
      // An older shell without the icon slot: the entries keep their labels.
    }
  }
  return () => { for (const off of released) { try { off() } catch { /* ignore */ } } }
}
