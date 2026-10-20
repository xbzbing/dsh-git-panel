/**
 * Minimal ambient surface for the platform's Markdown, code highlighter and
 * dropdown menu.
 * @deepseek-ai/dsh-client-ui-primitives is a web-shell platform seed listed
 * in package.json `dsh.client.inject`, external to the plugin bundle. These
 * declarations mirror its public MarkdownText, code-highlighting and Menu types.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { JSX, ReactNode } from 'react'

  export interface MarkdownCodeLabels {
    copyLabel: string
    copiedLabel: string
  }
  export interface MarkdownLabels {
    code: MarkdownCodeLabels
    footnotes: string
  }
  export interface HighlightSpan {
    text: string
    style: import('react').CSSProperties
  }
  export type CodeHighlighter = (code: string) => HighlightSpan[][] | undefined
  export function languageForPath(path: string): string | undefined
  export function useCodeHighlighter(language: string | undefined): CodeHighlighter
  /** Async Clipboard API with an `execCommand('copy')` fallback for insecure
   * contexts (a remote plain-HTTP origin has no `navigator.clipboard`). */
  export function writeClipboard(text: string): Promise<boolean>
  export const FileTypeIcon: (props: ({ readonly path: string } | { readonly kind: 'folder' }) & { readonly size?: number; readonly className?: string }) => JSX.Element | null
  export const MarkdownText: (props: {
    text: string
    labels: MarkdownLabels
    variant?: 'body' | 'compact'
    streaming?: boolean
    /** Official local-image contract: resolve an authored destination onto a
     * URL (undefined keeps the alt-text fallback). External http(s)
     * destinations pass through without this resolver. */
    pathImages?: { readonly resolve: (destination: string) => string | undefined }
  }) => JSX.Element

  /** Which mark a {@link StateDot} paints. `ongoing` is the platform's loader:
   * a rotating ring with a breathing arc, sized 14 by default. */
  export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'
  /** The platform's state mark — the only loading indicator the shell draws,
   * so a plugin that shows a loader must render this rather than its own ring. */
  export const StateDot: (props: {
    state: StateDotState
    size?: number
    className?: string
    appearance?: 'dot' | 'step'
  }) => JSX.Element

  /** The props a platform glyph takes: its size and an optional class. */
  export interface IconProps {
    readonly size?: number
    readonly className?: string
  }

  /** One selectable menu row (optionally with a nested submenu). */
  export interface MenuItem {
    id: string
    label: ReactNode
    disabled?: boolean
    shortcut?: { keys: readonly string[]; aria?: string | undefined }
    icon?: ReactNode
    danger?: boolean
    submenu?: readonly MenuItem[]
  }
  /** A hairline between item groups (not selectable). */
  export interface MenuSeparator {
    type: 'separator'
    id: string
  }
  /** A non-interactive heading row above a group of items. */
  export interface MenuLabel {
    type: 'label'
    id: string
    text: string
  }
  export type MenuEntry = MenuItem | MenuSeparator | MenuLabel
  export interface MenuItemButtonProps {
    children: ReactNode
    shortcut?: MenuItem['shortcut']
    icon?: ReactNode
    disabled?: boolean
    danger?: boolean
    separatorBefore?: boolean
    onSelect: () => void
  }
  /** One component-rendered `role="menuitem"` row for a `Menu` whose rows are
   * components rather than `items` data. */
  export function MenuItemButton(props: MenuItemButtonProps): JSX.Element
  /** Anchored dropdown menu. `open` is controlled; the caller renders the
   * `anchor` trigger itself (including aria-haspopup/aria-expanded) and must
   * close the menu from `onSelect` — Menu does not close on selection. */
  export function Menu(props: {
    open: boolean
    autoFocus?: boolean
    anchor: ReactNode
    items?: readonly MenuEntry[]
    children?: ReactNode
    footer?: readonly MenuEntry[]
    selectedId?: string | undefined
    selectedIds?: readonly string[] | undefined
    onSelect?: (id: string) => void
    onClose: () => void
    align?: 'start' | 'end'
    side?: 'bottom' | 'top' | 'right'
    portal?: boolean
    closeOnPointerLeave?: boolean
    dense?: boolean
    compact?: boolean
    selection?: 'check' | 'fill'
    getAnchorRect?: () => DOMRect | null
    className?: string | undefined
    listClassName?: string | undefined
  }): JSX.Element
  export const IconChevronDownOutlineRegular: (props: {
    readonly size?: number
    readonly className?: string
  }) => JSX.Element
  /** Folder glyphs with a closed/open pair: the open one marks an expanded
   * directory in the official file lists. */
  export const IconFolderCloseRegular: (props: {
    readonly size?: number
    readonly className?: string
  }) => JSX.Element
  export const IconFolderOpenRegular: (props: {
    readonly size?: number
    readonly className?: string
  }) => JSX.Element

  /** One equal-width tab: its label plus the caller-owned tab/panel DOM ids. */
  export interface SegmentedTab {
    value: string
    label: ReactNode
    id: string
    panelId: string
  }
  /** Equal-width controlled tabs with a sliding selection indicator (the
   * indicator span carries the animation); the panels stay caller-owned. The
   * real signature returns ReactNode and takes a non-empty tuple of items —
   * narrowed here so `h()` accepts it, and we always pass 1 or 3 tabs. */
  export function SegmentedTabs(props: {
    items: readonly SegmentedTab[]
    value: string
    onChange: (value: string) => void
    label: string
    className?: string | undefined
  }): JSX.Element

  /** One option of a {@link SegmentedControl}. */
  export interface SegmentedControlOption {
    value: string
    label: string
    disabled?: boolean
    title?: string
  }
  /** Two-or-more equal-width segments with a sliding indicator, for switching a
   * card between a few modes (the official two-choice control). The owner
   * renders one `role=tabpanel` per option with id `<id>-<value>-panel` and
   * `aria-labelledby` pointing at `<id>-<value>`. */
  export function SegmentedControl(props: {
    id: string
    value: string
    options: readonly SegmentedControlOption[]
    onChange: (next: string) => void
    label: string
    disabled?: boolean
    className?: string | undefined
  }): JSX.Element
}
