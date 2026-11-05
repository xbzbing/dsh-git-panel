/**
 * The panel's context-menu wiring, kept out of `Panel` (which is already the
 * largest surface in the plugin).
 *
 * Two rules shape it:
 *
 *  - **The captured value is built when the gesture runs**, not when the row
 *    rendered. The platform accepts a thunk target, so a row may pass a path and
 *    let this module fill in the identity at click time — a browse root or
 *    repository picked after the row rendered is then never read stale.
 *  - **The owner re-checks before acting.** Resolution compares the captured
 *    identity with the panel's live state (session, repository, browse root) and
 *    resolves to nothing when they disagree, because a menu can outlive the
 *    surface that raised it: switching the repository or the browse root under an
 *    open menu must not turn "reveal this file" into "reveal a path that no
 *    longer exists under the root the panel shows now".
 */
import { useEffect, useId, useMemo, useRef } from 'react'
import { hasSession, type ClientCtx } from './rpc.js'
import { menuTriggerFactory, type PanelMenu } from './menu-bindings.js'
import { MENU_KIND, registerMenuOwner, type GitMenuValue } from './menu-owners.js'
import type { TreeTargetValue } from './menu-owners.js'
import { panelMenuOwner } from './menu-panel.js'
import { contextMenusOf } from './menu-register.js'
import type { GitKey } from './locales.js'
import type { MenuCallbacks } from './menu-actions.js'
import type { OverviewMenuCommands, OverviewMenuFacts } from './overview-menu.js'
import type { ChangesMenuCommands, ChangesMenuFacts } from './changes-menu.js'
import type { MenuSource, UseContextMenu } from './menu-types.js'

/** What the panel hands the hook. */
export interface PanelMenuInputs {
  readonly ctx: ClientCtx
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  readonly sessionId: string | undefined
  /** Repository tag the panel currently shows (read at resolve time). */
  readonly repo: string
  /** Absolute browse root the browser shows, read at gesture time. */
  readonly browseRoot: () => string | null
  /** The slot's injected factory; absent on hosts without the menu package. */
  readonly useContextMenu: UseContextMenu | undefined
  /** Inputs an open menu follows (the session snapshot). */
  readonly observe: () => readonly MenuSource[]
  /** The browser's root is inside a checkout; read live. */
  readonly isGit: () => boolean
  /** The host's declared query capabilities; read live (older host: false). */
  readonly capabilities: () => { readonly revDiff: boolean; readonly pathHistory: boolean }
  /** The Git group's runs. */
  readonly onCompareRevision: (value: TreeTargetValue) => void
  readonly onCompareRef: (value: TreeTargetValue) => void
  readonly onShowHistory: (value: TreeTargetValue) => void
  /** The overview's runs and busy flag (branch / commit rows). */
  readonly overviewCommands: () => OverviewMenuCommands
  readonly overviewFacts: () => OverviewMenuFacts
  /** The changes tab's runs, busy flag and checked set (change / dir / stash rows). */
  readonly changesCommands: () => ChangesMenuCommands
  readonly changesFacts: () => ChangesMenuFacts
  readonly changesPick: () => ReadonlySet<string>
}

/**
 * Publish the panel's menu face and register its owner.
 * @param inputs - live accessors into the panel.
 * @returns the facade its subtree reads (see menu-context.ts).
 */
export function usePanelMenu(inputs: PanelMenuInputs): PanelMenu {
  const { ctx, t, sessionId, repo, browseRoot, useContextMenu, observe, isGit, capabilities, onCompareRevision, onCompareRef, onShowHistory, overviewCommands, overviewFacts, changesCommands, changesFacts, changesPick } = inputs
  const factory = useMemo(() => menuTriggerFactory(useContextMenu), [useContextMenu])
  const ownerId = useId()
  // Repository is compared at resolve time, so the thunk reads it through a ref
  // instead of the closure's render-time value.
  const repoRef = useRef(repo)
  repoRef.current = repo

  const facade = useMemo<PanelMenu>(() => ({
    row: (path, kind, ignored, handlers) => {
      if (!hasSession(sessionId)) return handlers ?? {}
      return factory.bind(kind, () => ({
        sessionId, owner: ownerId, repo: repoRef.current, path, root: browseRoot(), ignored,
      }), handlers)
    },
    image: (image, handlers) => {
      if (!hasSession(sessionId)) return handlers ?? {}
      return factory.bind(MENU_KIND.image, () => ({
        sessionId, owner: ownerId, repo: repoRef.current, ...image,
      }), handlers)
    },
    // Overview rows capture their own identity; the facade only adds the panel's
    // and defers the value so a repository switch is read at gesture time.
    bind: (kind, value, handlers) => {
      if (!hasSession(sessionId)) return handlers ?? {}
      return factory.bind(
        kind,
        () => ({ ...value, sessionId, owner: ownerId, repo: repoRef.current }) as GitMenuValue,
        handlers,
      )
    },
  }), [factory, sessionId, ownerId, browseRoot])

  const callbacksRef = useRef<MenuCallbacks>({ compareRevision: onCompareRevision, compareRef: onCompareRef, showHistory: onShowHistory })
  callbacksRef.current = { compareRevision: onCompareRevision, compareRef: onCompareRef, showHistory: onShowHistory }
  const overviewCommandsRef = useRef(overviewCommands())
  overviewCommandsRef.current = overviewCommands()
  const changesCommandsRef = useRef(changesCommands())
  changesCommandsRef.current = changesCommands()
  useEffect(() => {
    if (!hasSession(sessionId)) return
    return registerMenuOwner(ownerId, panelMenuOwner({
      env: () => ({
        t, menus: contextMenusOf(ctx),
        facts: { isGit: isGit(), ...capabilities() },
      }),
      browseRoot,
      identity: () => ({ sessionId, repo: repoRef.current }),
      callbacks: () => callbacksRef.current,
      overview: () => ({ commands: overviewCommandsRef.current, facts: overviewFacts }),
      changes: () => ({
        commands: changesCommandsRef.current,
        facts: changesFacts,
        pick: changesPick,
      }),
      observe,
    }))
  }, [ctx, ownerId, sessionId, t, browseRoot, observe, isGit, capabilities, overviewFacts, changesFacts, changesPick])

  return facade
}
