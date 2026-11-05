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
import { BranchIcon, CommitIcon, CopyIcon, DiffIcon, FilesIcon, HistoryIcon, ListIcon, QuoteIcon, RevertIcon, ResetIcon, StashIcon, StagePickedIcon, SyncIcon, TagIcon, TrashIcon } from './icons.js'
import type { ClientCtx } from './rpc.js'
/** What a platform glyph takes: the popup passes its own size and class. */
interface IconProps {
  readonly size?: number
  readonly className?: string
}

/** Stable icon keys. Changing one silently drops that entry's glyph (the slot
 * has no fallback), so they are pinned by a unit test. */
export const MENU_ICONS = {
  compare: 'git-panel.compare',
  history: 'git-panel.history',
  copy: 'git-panel.copy',
  quote: 'git-panel.quote',
  branch: 'git-panel.branch',
  tag: 'git-panel.tag',
  revert: 'git-panel.revert',
  reset: 'git-panel.reset',
  checkout: 'git-panel.checkout',
  stage: 'git-panel.stage',
  discard: 'git-panel.discard',
  stash: 'git-panel.stash',
  fetch: 'git-panel.fetch',
  overview: 'git-panel.overview',
  changes: 'git-panel.changes',
  files: 'git-panel.files',
} as const

export type MenuIconName = keyof typeof MENU_ICONS

/** The icon a menu action names. The platform resolves the key; a picture that
 * comes with the action (`src`) is not used here. */
export function menuIcon(name: MenuIconName): { readonly key: string } {
  return { key: MENU_ICONS[name] }
}

/** One entry of the platform's `contextMenu.icon` slot. */
interface IconSlotProps extends IconProps {
  /** The action's own icon value (unused: this plugin's glyphs carry no image). */
  readonly icon?: { readonly key: string; readonly src?: string }
}

const SLOT_ICONS: Readonly<Record<MenuIconName, (props: IconSlotProps) => JSX.Element>> = {
  compare: DiffIcon,
  history: HistoryIcon,
  copy: CopyIcon,
  quote: QuoteIcon,
  branch: BranchIcon,
  tag: TagIcon,
  revert: RevertIcon,
  reset: ResetIcon,
  checkout: CommitIcon,
  stage: StagePickedIcon,
  discard: TrashIcon,
  stash: StashIcon,
  fetch: SyncIcon,
  overview: ListIcon,
  changes: DiffIcon,
  files: FilesIcon,
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
  for (const [name, Icon] of Object.entries(SLOT_ICONS) as Array<[MenuIconName, (props: IconSlotProps) => JSX.Element]>) {
    try {
      const handle = ctx.slots.inject('contextMenu.icon', () => ctx.slots.register(
        { name: 'contextMenu.icon', key: MENU_ICONS[name] },
        Icon,
      ))
      if (typeof handle === 'function') released.push(handle as () => void)
    } catch {
      // An older shell without the icon slot: the entries keep their labels.
    }
  }
  return () => { for (const off of released) { try { off() } catch { /* ignore */ } } }
}
