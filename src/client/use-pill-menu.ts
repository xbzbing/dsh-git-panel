/**
 * The input-bar pill's context menu: owner registration, trigger props and the
 * remote check, kept out of `GitPill` (which is a status marker, not a page).
 *
 * Two things make the pill different from the panel's rows:
 *
 *  - **It outlives the panel.** The pill is what opens the panel, so its menu
 *    cannot resolve through the panel's owner. The pill registers its own owner
 *    under its instance id, and the target it captures names that id: a second
 *    pill in another conversation pane never answers for this one.
 *  - **It has no status bar.** The remote check reports through the platform's
 *    toast (`notify`), which outlives the dismissed popup, instead of a slot in
 *    a page the pill may not have open.
 */
import { useEffect, useId, useMemo, useRef } from 'react'
import { controllerFor } from './registry.js'
import { gitPanelRemoteOf, hasSession, type ClientCtx } from './rpc.js'
import { withRepo } from './repo-select.js'
import { contextMenusOf } from './menu-register.js'
import { MENU_KIND, registerMenuOwner } from './menu-owners.js'
import { menuTriggerFactory, NO_MENU } from './menu-bindings.js'
import { pillMenuActions, type PillMenuCommands } from './pill-menu.js'
import { opErrorText } from './ops-modals.js'
import type { GitKey } from './locales.js'
import type { MenuAction, MenuSource, UseContextMenu } from './menu-types.js'
import type { PillTargetValue } from './menu-owners.js'

/** The checkout the pill is showing, as the menu needs it. */
export interface PillSample {
  readonly root: string
  /** HEAD branch; null while detached. */
  readonly branch: string | null
  /** The checkout has a remote worth asking about. */
  readonly remote: boolean
}

export interface PillMenuInputs {
  readonly ctx: ClientCtx
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  readonly sessionId: string | undefined
  readonly useContextMenu: UseContextMenu | undefined
  /** The sample on screen right now; null while the view is not ready. */
  readonly sample: PillSample | null
  /** Open one panel page — the pill's own jump logic (placement aware). */
  readonly openTab: (tab: 'overview' | 'changes' | 'files') => void
}

/**
 * Publish the pill's menu and return the trigger props for its button.
 * @param inputs - live accessors into the pill.
 * @returns props to spread onto the pill's button (empty without a session or a
 *   menu package).
 */
export function usePillMenu(inputs: PillMenuInputs): Record<string, unknown> {
  const { ctx, t, sessionId, useContextMenu, sample, openTab } = inputs
  const factory = useMemo(() => menuTriggerFactory(useContextMenu), [useContextMenu])
  const ownerId = useId()
  // The owner resolves after the gesture, so every input is read through the
  // refs below rather than the closure's render-time value.
  const sampleRef = useRef<PillSample | null>(sample)
  sampleRef.current = sample
  const tRef = useRef(t)
  tRef.current = t
  const openTabRef = useRef(openTab)
  openTabRef.current = openTab
  // One fetch per checkout at a time: a second menu click while the first runs
  // would only repeat the network round trip.
  const claims = useRef(new Set<string>())

  useEffect(() => {
    if (!hasSession(sessionId)) return undefined
    const live = sessionId
    const fetchOf = (repoTag: string): void => {
      if (claims.current.has(repoTag)) return
      claims.current.add(repoTag)
      void (async () => {
        const notify = (text: string, success: boolean): void => { contextMenusOf(ctx)?.notify(text, success) }
        try {
          const result = await withRepo(gitPanelRemoteOf(ctx), repoTag).run({ sessionId: live, action: { kind: 'fetch' } })
          if (!result.ok) {
            notify(opErrorText(result.error.code, result.error.message, tRef.current), false)
            return
          }
          // The reply carries the sample of the checkout the fetch ran in; only
          // that checkout's controller may publish it.
          const controller = controllerFor(live)
          if (controller.getRepo() === repoTag) controller.accept(result.snapshot)
          const snap = result.snapshot
          if (snap.remote === null) notify(tRef.current('menu.fetchNoRemote'), true)
          else if (!snap.hasUpstream) notify(tRef.current('menu.fetchNoUpstream'), true)
          else notify(tRef.current('menu.fetchDone', { ahead: snap.ahead, behind: snap.behind }), true)
        } catch (error) {
          notify(error instanceof Error ? error.message : tRef.current('common.operationFailed'), false)
        } finally {
          claims.current.delete(repoTag)
        }
      })()
    }
    return registerMenuOwner(ownerId, {
      observe: (): readonly MenuSource[] => {
        // The pill mirrors the session's controller, so an open menu follows the
        // same samples the marker does.
        const controller = controllerFor(live)
        return controller.getSnapshot().state === 'ready' ? [controller] : []
      },
      actionsFor: (_kind, value, signal): MenuAction[] => {
        if (signal.aborted) return []
        const shown = sampleRef.current
        const target = value as PillTargetValue
        // The menu must speak for the checkout the pill is showing now: a
        // repository switch under an open menu empties it instead of offering
        // "copy branch" for a branch that is no longer checked out.
        if (shown === null || target.root !== shown.root) return []
        const commands: PillMenuCommands = {
          openTab: (tab) => openTabRef.current(tab),
          fetch: (repoTag) => fetchOf(repoTag),
        }
        return pillMenuActions(target, {
          t: tRef.current,
          menus: contextMenusOf(ctx),
          facts: { isGit: true, revDiff: false, pathHistory: false },
        }, commands, { canFetch: shown.remote })
      },
    })
  }, [ctx, ownerId, sessionId])

  if (!hasSession(sessionId) || factory === NO_MENU) return {}
  return factory.bind(MENU_KIND.pill, () => {
    const shown = sampleRef.current
    return {
      sessionId,
      owner: ownerId,
      repo: controllerFor(sessionId).getRepo(),
      root: shown?.root ?? '',
      branch: shown?.branch ?? null,
    }
  })
}
