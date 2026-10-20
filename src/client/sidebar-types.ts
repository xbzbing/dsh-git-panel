/**
 * The platform's right-sidebar tab registry, as this plugin uses it.
 *
 * @deepseek-ai/dsh-client-ui-sidebar-right is a web-shell platform seed listed
 * in package.json `dsh.client.inject`, external to the plugin bundle. The
 * plugin never imports a value from it — only these types, which mirror the
 * public surface it relies on: the tab definition (stage one), the registry
 * service, and the keyed seats (stage two).
 */
import type { ComponentType, JSX } from 'react'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * How strongly a type wants an address it recognizes. `extension` — a type
 * from outside the product — outranks every viewer shipped with the product.
 */
export type SidebarRightTabPriority = 'extension' | 'builtin' | 'fallback'

/** One entry capsule the guide page offers, contributed by the type it opens. */
export interface SidebarRightGuideEntry {
  /** Stable entry identity within its provider. */
  readonly id: string
  /** Ascending position among every registered type's entries. */
  readonly order: number
  /** The capsule's title, read again on every use so a language change needs no re-registration. */
  readonly title: () => string
  /** One line under the title on what picking the capsule opens. */
  readonly description?: () => string
  /** Optional glyph, drawn before the title. */
  readonly icon?: ComponentType<IconProps>
}

/** One registered tab type: its static face, and nothing else. */
export interface SidebarRightTabDefinition {
  /**
   * This implementation's identity in the tab system, unique across every
   * registration (a package name is the natural value). It is also the key
   * the body and title register under in the sidebar's keyed seats.
   */
  readonly id: string
  /** Type discriminator: what the tabs of this type are, and what `openTab` names. */
  readonly kind: string
  /** Each open by kind creates independent content; omission keeps one page per kind in each pane. */
  readonly multiple?: boolean
  /** Lazily keep a visited body mounted through hiding, session changes and docking; default false. */
  readonly keepMounted?: boolean
  /** Resource-address globs this type recognizes; omit for a page type. */
  readonly patterns?: readonly string[]
  /** Defaults to `extension`: a type that says nothing is one from outside the product. */
  readonly priority?: SidebarRightTabPriority
  /** Veto an address this type's globs matched. */
  readonly canOpen?: (address: string) => boolean
  /** The tab chip's initial text, captured into the layout record at open time. */
  readonly title: (address: string) => string
  /** Entry boxes for the guide page. Omit to stay off it. */
  readonly guide?: readonly SidebarRightGuideEntry[]
}

/** The registered tab types. */
export interface SidebarRightTabRegistry {
  /**
   * Register one tab type for the caller's lifetime.
   * @param definition - the contributed type.
   * @returns idempotent disposer.
   * @throws when the id is taken, or the kind is already registered in a way this one cannot coexist with.
   */
  register(definition: SidebarRightTabDefinition): () => void
  /** The type in force for a kind. */
  get(kind: string): SidebarRightTabDefinition | undefined
}

/** Live information shared by a tab's body, title, and guide replacement. */
export interface SidebarRightTabInfo {
  readonly sidebar: {
    readonly expanded: boolean
    readonly fullscreen: boolean
  }
  readonly panel: {
    readonly id: string
  }
  readonly tab: {
    readonly id: string
    readonly title: string
    /**
     * Only the foreground session is visible. Docked bodies require expansion
     * and selection; floats survive collapse.
     */
    readonly visible: boolean
    readonly navigation: {
      readonly address: string
      readonly revision: number
    }
    readonly signal: AbortSignal
  }
}

/** Read current tab information through the slot framework's subscriptions. */
export type UseSidebarRightTabInfo = () => SidebarRightTabInfo

/** The props a sidebar tab body receives from its keyed seat. */
export interface SidebarRightTabBodyProps {
  /** The session the panel belongs to. */
  readonly sessionId: string
  /** Read the tab's live information. */
  readonly useTabInfo: UseSidebarRightTabInfo
  /** The namespace-bound translate, read fresh on every label call. */
  readonly t: (key: string, params?: Record<string, string | number>) => string
  /** Render a slot's content from inside a body. */
  readonly renderSlot?: (name: string, props?: Record<string, unknown>) => JSX.Element | null
}

/** The props a sidebar tab title receives from its keyed seat. */
export interface SidebarRightTabTitleProps {
  /** Read the tab's live information. */
  readonly useTabInfo: UseSidebarRightTabInfo
}
