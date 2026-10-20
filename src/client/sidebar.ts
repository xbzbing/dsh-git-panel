/**
 * The right sidebar's Git page type.
 *
 * Registration is three stages, and each stage keys on the same identity:
 *
 *  1. the registry learns the type (its `id`, its `kind`, its guide entry);
 *  2. the body seat supplies what the type renders, keyed by that `id`;
 *  3. the title seat supplies the chip's text, keyed by that `id`.
 *
 * The registry service is optional — a host without the right sidebar has no
 * such service — so the type is registered from a deferred injection that
 * waits for the service rather than for the seat declarations. Writing the
 * service into the plugin's own `inject` list would leave the whole plugin
 * waiting on a host that may never provide it.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import { Panel } from './Panel.js'
import { CommitIcon } from './icons.js'
import { NS } from './locales.js'
import type { ClientCtx } from './rpc.js'
import type { GitKey } from './locales.js'
import type { SidebarRightTabDefinition, SidebarRightTabBodyProps } from './sidebar-types.js'

/** This implementation's identity in the tab system, and the key the body and
 * title register under. */
export const SIDEBAR_ID = '@xbzbing/dsh-git-panel'

/** The page type's discriminator — what `openTab` names. */
export const SIDEBAR_KIND = 'dsh-git-panel'

/** The tab registry service, when the host offers one. */
const REGISTRY_SERVICE = 'sidebarRightTabs'

/** The controller that opens page types, when the host offers one. */
const CONTROLLER_SERVICE = 'sidebarRight'

/** The registry face the plugin uses. */
export interface SidebarRightTabsFace {
  register(definition: SidebarRightTabDefinition): () => void
}

/** The controller face the plugin uses to open a page type. */
export interface SidebarRightControllerFace {
  openTab(kind: string, options?: Record<string, unknown>): void
}

/** The registry service, or undefined when the host has no right sidebar. */
export function sidebarRegistry(ctx: ClientCtx): SidebarRightTabsFace | undefined {
  const face = ctx.get(REGISTRY_SERVICE) as SidebarRightTabsFace | undefined
  return face !== undefined && typeof face.register === 'function' ? face : undefined
}

/** The controller service, or undefined when the host has no right sidebar. */
export function sidebarController(ctx: ClientCtx): SidebarRightControllerFace | undefined {
  const face = ctx.get(CONTROLLER_SERVICE) as SidebarRightControllerFace | undefined
  return face !== undefined && typeof face.openTab === 'function' ? face : undefined
}

/**
 * Open the Git page type in the right sidebar.
 *
 * The controller expands the column in the same step, because content the
 * user cannot see is not opened.
 */
export function openSidebarTab(ctx: ClientCtx): boolean {
  const controller = sidebarController(ctx)
  if (controller === undefined) return false
  try {
    controller.openTab(SIDEBAR_KIND)
    return true
  } catch {
    return false
  }
}

/** The type's static face: what it is, and how the guide offers it. */
function definition(t: (key: GitKey) => string): SidebarRightTabDefinition {
  return {
    id: SIDEBAR_ID,
    kind: SIDEBAR_KIND,
    // A type shipped from outside the product says nothing, which the registry
    // reads as the extension band. Stating it keeps the intent explicit.
    priority: 'extension',
    // Keep a visited body mounted: the commit message being typed is unsaved
    // work, and it must survive switching tabs or sessions.
    keepMounted: true,
    title: () => t('panel.tab'),
    guide: [{
      id: 'git-panel',
      // Between the official files card (10) and session-inspector (60).
      order: 30,
      title: () => t('panel.tab'),
      description: () => t('sidebar.guideDescription'),
      icon: CommitIcon,
    }],
  }
}

/** The body: the same panel the conversation's view tab renders. The context
 * and the translate are closed over — the seat supplies only the tab's own
 * information. */
function bodyFor(ctx: ClientCtx, t: (key: GitKey) => string): (props: SidebarRightTabBodyProps) => JSX.Element {
  return (props) => {
    // `useTabInfo` throws while the tab record is not committed, so a body that
    // mounts early must not ask for it. Catching is safe only because the
    // platform throws from inside a `useMemo` factory, after its three hooks
    // (useStore, useTabNavigation, useMemo) have already registered — so the
    // hook order is unaffected by the throw. If a future platform version
    // throws before those hooks, this catch would surface as a hooks-order
    // violation instead. The panel treats an absent visibility as visible, and
    // the host's own gate keeps queries off a hidden tab.
    let visible: boolean | undefined
    try {
      visible = props.useTabInfo().tab.visible
    } catch {
      visible = undefined
    }
    return h(Panel, {
      ctx,
      sessionId: props.sessionId,
      t,
      host: 'sidebar',
      visible,
    })
  }
}

/** The chip's title. It reads no tab information: a title that asks for an
 * uncommitted record throws, and the registry's captured title is enough. */
function titleFor(t: (key: GitKey) => string): () => JSX.Element {
  return () => h('span', { className: 'gp-sidebar-title' }, t('panel.tab'))
}

/**
 * Register the Git page type with the right sidebar.
 *
 * The three stages are rolled back as one: a type that is registered but has
 * no body would leave a page type that opens to an empty pane, and its `id`
 * would stay taken for the rest of the session.
 *
 * @param ctx - the client context.
 * @param t - the namespace-bound translate.
 * @returns a disposer that unregisters the type, or undefined when the host
 * has no right sidebar to register with.
 */
export function registerSidebarTab(ctx: ClientCtx, t: (key: GitKey) => string): (() => void) | undefined {
  const registry = sidebarRegistry(ctx)
  if (registry === undefined) return undefined

  let releaseType: (() => void) | undefined
  try {
    releaseType = registry.register(definition(t))
  } catch {
    return undefined
  }

  const releases: Array<() => void> = []
  try {
    const body = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab', key: SIDEBAR_ID, locale: NS },
      bodyFor(ctx, t),
    ))
    if (typeof body === 'function') releases.push(body as () => void)

    const title = ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
      { name: 'sidebar.right.pane.tab.title', key: SIDEBAR_ID },
      titleFor(t),
    ))
    if (typeof title === 'function') releases.push(title as () => void)
  } catch {
    rollback()
    return undefined
  }

  // The registry's disposer is idempotent, so this may be called more than
  // once. Copy before reversing: `releases.reverse()` mutates in place, and a
  // second call would then release body before title instead of LIFO.
  function rollback(): void {
    for (const release of [...releases].reverse()) { try { release() } catch { /* ignore */ } }
    try { releaseType?.() } catch { /* ignore */ }
  }

  return rollback
}
