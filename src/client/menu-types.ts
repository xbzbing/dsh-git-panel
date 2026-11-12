/**
 * The platform's context-menu faces, as this plugin uses them.
 *
 * @deepseek-ai/dsh-client-ui-context-menu (dsh 0.2.2-alpha.3 and later) is a
 * client plugin package, not a platform seed: its boot row is named in
 * package.json `dsh.client.inject` so its factories arrive before this bundle
 * materializes (ADR-0032). The plugin imports no value from it — only the
 * structural shapes below, the same approach `sidebar-types.ts` takes for the
 * right sidebar. A host that predates the package has no `contextMenus` service
 * and injects no `useContextMenu`, so nothing here is reached (see
 * menu-register.ts and menu-bindings.ts for the two gates).
 */
import type { HTMLAttributes } from 'react'

/** Pointer position in viewport pixels; keyboard gestures use the trigger's box. */
export interface MenuPoint {
  readonly x: number
  readonly y: number
}

/** Keyed icon renderer plus the image URL captured with the action. The keyed
 * slot that draws it is shared: an action keeps whichever icon key its
 * contribution produced, and the platform's own registered components paint it.
 * An application icon arrives as `src` instead. */
export interface MenuIcon {
  readonly key: string
  readonly src?: string
}

/** Plain presentation of one action: what the popup draws. */
export interface MenuActionView {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  readonly danger?: boolean
  readonly separatorBefore?: boolean
  readonly icon?: MenuIcon
  readonly children?: readonly MenuActionView[]
}

/** A contribution's action: presentation plus the callback the popup runs. */
export interface MenuAction extends Omit<MenuActionView, 'children'> {
  readonly children?: readonly MenuAction[]
  /** Shown when `run` rejects; actions that cannot fail omit it. */
  readonly failureLabel?: string
  readonly run?: () => void | Promise<void>
}

/** Handlers a trigger may already own; `getTriggerProps` merges into these and
 * honours `preventDefault()` from them. `tabIndex` defaults to 0 inside the
 * platform, so a row that must not become a Tab stop passes -1. */
export type MenuTriggerHandlers = Pick<HTMLAttributes<HTMLElement>, 'onContextMenu' | 'onKeyDown' | 'tabIndex'>

/** The bindings the platform injects into every slot component. */
export interface MenuBindings {
  /** Ordinary function (no hooks): safe to call per row inside a render loop.
   * A thunk target is captured when the gesture runs, not when the row
   * rendered — the value is then current even if the row's props are stale. */
  getTriggerProps: (
    target: MenuTrigger | (() => MenuTrigger) | undefined, handlers?: MenuTriggerHandlers,
  ) => MenuTriggerHandlers
}

/** Injected slot global: read the current lifetime's bindings. */
export type UseContextMenu = () => MenuBindings

/** The object a trigger binds. The value is always JSON-serializable: it is
 * captured when the gesture runs, so a re-render or a recycled row cannot
 * retarget an open menu. */
export interface MenuTrigger {
  readonly kind: string
  readonly value: unknown
}

/** A reactive input a contribution lists in `observe`: re-resolve when it
 * changes, so an open menu follows a busy flag or a new snapshot. The platform
 * only calls `subscribe`; `getSnapshot` is what the source publishes. */
export interface MenuSource {
  subscribe: (listener: () => void) => () => void
}

/** A readable store in the platform's snapshot shape: the value now, plus a
 * subscription for whoever renders it (a React store, `useSyncExternalStore`). */
export interface MenuSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** One contribution. `Value` is the target value the family carries: the
 * platform hands the captured value through unchanged, so a contribution
 * declares the shape it expects and the registry stays untyped about it. */
export interface MenuContribution<Value = never> {
  readonly id: string
  readonly target: string
  /** Ascending group among providers of the same target kind. */
  readonly order: number
  /** Inputs whose change re-resolves this contribution for the same target. */
  observe?(value: Value): readonly MenuSource[]
  resolve(value: Value, signal: AbortSignal): readonly MenuAction[] | Promise<readonly MenuAction[]>
}

/** The `contextMenus` client service, as far as this plugin reaches into it. */
/**
 * Register for subsequent openings; unloading withdraws actions and aborts
 * their queries. Duplicate ids within a target kind fail.
 */
export interface ContextMenusService {
  /** The shared popup's captured target, `null` while no popup is open.
   * Optional so a stub or an older platform face without it still satisfies
   * the contract (nothing may assume the popup can be observed). */
  readonly active?: MenuSnapshot<MenuTrigger | null>
  register<Value>(contribution: MenuContribution<Value>): () => void
  /** Resolve an embedded occurrence for a target (the platform's own kinds
   * included) without opening the shared popup. */
  resolve(target: MenuTrigger): MenuResolution
  /** Show localized feedback outside the originating surface. */
  notify(text: string, success?: boolean, action?: {
    readonly label: string
    readonly run: () => void | Promise<void>
    readonly failureLabel: string
  }): void
  close(): void
}

/** An independent menu occurrence. */
export interface MenuResolution {
  readonly source: { getSnapshot(): readonly MenuActionView[] }
  readonly ready: Promise<void>
  select(id: string): void
  dispose(): void
}
