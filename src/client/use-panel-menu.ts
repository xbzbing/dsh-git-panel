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
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { hasSession, type ClientCtx } from './rpc.js'
import { menuTriggerFactory, type PanelMenu } from './menu-bindings.js'
import { MENU_KIND, registerMenuOwner, type GitMenuValue, type MenuValueSeed } from './menu-owners.js'
import type { TreeTargetValue } from './menu-owners.js'
import { panelMenuOwner } from './menu-panel.js'
import { contextMenusOf } from './menu-register.js'
import { quoteAvailable } from './quote.js'
import type { GitKey } from './locales.js'
import type { MenuCallbacks } from './menu-actions.js'
import type { OverviewMenuCommands, OverviewMenuFacts } from './overview-menu.js'
import type { ChangesMenuCommands, ChangesMenuFacts } from './changes-menu.js'
import type { ReposMenuCommands, ReposMenuFacts } from './repos-menu.js'
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
  /** Put a reference into the session's composer (falls back to the clipboard). */
  readonly onQuote: (text: string) => void
  /** The overview's runs and busy flag (branch / commit rows). */
  readonly overviewCommands: () => OverviewMenuCommands
  readonly overviewFacts: () => OverviewMenuFacts
  /** The changes tab's runs, busy flag and checked set (change / dir / stash rows). */
  readonly changesCommands: () => ChangesMenuCommands
  readonly changesFacts: () => ChangesMenuFacts
  readonly changesPick: () => ReadonlySet<string>
  /** The repository rows' remote check (they are not the selected checkout, so
   * the run reports through the menu toast). */
  readonly reposCommands: () => ReposMenuCommands
  readonly reposFacts: (repoTag: string) => ReposMenuFacts
}

/**
 * Publish the panel's menu face and register its owner.
 * @param inputs - live accessors into the panel.
 * @returns the facade its subtree reads (see menu-context.ts).
 */
export function usePanelMenu(inputs: PanelMenuInputs): PanelMenu {
  const { ctx, t, sessionId, repo, browseRoot, useContextMenu, observe, isGit, capabilities, onCompareRevision, onCompareRef, onShowHistory, onQuote, overviewCommands, overviewFacts, changesCommands, changesFacts, changesPick, reposCommands, reposFacts } = inputs
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
    // Overview, changes and repository rows capture their own fields; the facade
    // adds the panel's identity and defers the value so a repository switch is
    // read at gesture time. A seed may name its own `repo` (a repository row
    // points at its own checkout) — that one wins over the panel's selection.
    bind: (kind, value: MenuValueSeed, handlers) => {
      if (!hasSession(sessionId)) return handlers ?? {}
      return factory.bind(
        kind,
        () => ({ repo: repoRef.current, ...value, sessionId, owner: ownerId }) as GitMenuValue,
        handlers,
      )
    },
  }), [factory, sessionId, ownerId, browseRoot])

  const callbacksRef = useRef<MenuCallbacks>({ compareRevision: onCompareRevision, compareRef: onCompareRef, showHistory: onShowHistory, quote: onQuote })
  callbacksRef.current = { compareRevision: onCompareRevision, compareRef: onCompareRef, showHistory: onShowHistory, quote: onQuote }

  useEffect(() => {
    if (!hasSession(sessionId)) return
    return registerMenuOwner(ownerId, panelMenuOwner({
      env: () => ({
        t, menus: contextMenusOf(ctx), writeClipboard,
        facts: { isGit: isGit(), ...capabilities(), canQuote: hasSession(sessionId) && quoteAvailable(ctx, sessionId) },
      }),
      browseRoot,
      identity: () => ({ sessionId, repo: repoRef.current }),
      callbacks: () => callbacksRef.current,
      // The tabs publish their runs into the panel's refs during *their* render,
      // which is later than the panel's. Reading them through the accessors at
      // resolve time therefore sees the current closures; copying the values
      // here would pin whatever the previous panel render found (an empty stash
      // list, a stale dirty flag).
      overview: () => ({ commands: overviewCommands(), facts: overviewFacts }),
      changes: () => ({
        commands: changesCommands(),
        facts: changesFacts,
        pick: changesPick,
      }),
      repos: () => ({ commands: reposCommands(), facts: reposFacts }),
      observe,
    }))
  }, [ctx, ownerId, sessionId, t, browseRoot, observe, isGit, capabilities, overviewCommands, overviewFacts, changesCommands, changesFacts, changesPick, reposCommands, reposFacts])

  return facade
}
