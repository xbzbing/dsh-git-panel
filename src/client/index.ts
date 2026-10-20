/**
 * dsh-git-panel client half — Cordis apply.
 *
 * Registers three slots:
 *   conversation.view (order 30)   → the Git panel (Overview / Changes tabs)
 *   conversation.input.left        → the zsh-style Git branch marker pill
 *   plugins.bundle.config          → the detail-page config form (showInputPill)
 * Bilingual dictionaries are registered under the `gitPanel` namespace; the
 * per-session snapshot controller registry is bound to this context.
 *
 * The panel's mount is a preference, not a constant: the user picks whether it
 * appears in the conversation's view tab, in the right sidebar, or in both.
 * The two mounts are registered and released independently, so a preference
 * change is a release plus a registration rather than a reload.
 */
import { createElement as h } from 'react'
import { ensureStyles } from './styles.js'
import { en, zh, NS } from './locales.js'
import { bindContext, disposeAll, resyncAll } from './registry.js'
import { Panel } from './Panel.js'
import { GitPill } from './GitPill.js'
import { PillConfig } from './PillConfig.js'
import { registerSidebarTab, sidebarRegistry } from './sidebar.js'
import { mountState } from './placement.js'
import { setChosenPlacement, setSidebarAvailable, effectivePlacement } from './placement-state.js'
import { readPlacementFromConfig, watchPlacement } from './placement-config.js'
import type { ClientCtx } from './rpc.js'
import type { GitKey } from './locales.js'

/**
 * `plugins.bundle.config` keys: the bundle identity is the install dep key —
 * `@xbzbing/dsh-git-panel` for the npm and (post-rename) github installs,
 * `dsh-git-panel` for pre-rename github/file installs still present in older
 * profiles. Register both so the detail-page configuration gate matches either.
 */
const BUNDLE_KEYS = ['dsh-git-panel', '@xbzbing/dsh-git-panel'] as const

const inject = ['slots', 'locale', 'connection']

const name = 'dsh-git-panel'

function apply(ctx: ClientCtx): void {
  ensureStyles()
  bindContext(ctx)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }) ?? undefined, 'dsh-git-panel: dictionaries')
  const t = ctx.locale.bind(NS) as (key: GitKey, params?: Record<string, string | number>) => string

  // Slot registrations may return an unregister handle; collect them and undo
  // them on teardown so a second apply (hot-reload) can't double-register.
  const disposers: Array<() => void> = []
  const track = (handle: unknown): void => { if (typeof handle === 'function') disposers.push(handle as () => void) }

  // ── the panel's mount ────────────────────────────────────────────────
  // The conversation's view tab and the right sidebar's page type are two
  // independent registrations of the same panel. Which of them exist is the
  // user's preference, reduced to what the host can serve: a host without the
  // right sidebar keeps the tab, because a sidebar-only preference would
  // otherwise leave the panel with no entry point at all.
  let releaseTab: (() => void) | undefined
  let releaseSidebar: (() => void) | undefined

  const mountTab = (): void => {
    if (releaseTab !== undefined) return
    // Main panel tab beside Chat (0) / Trajectory (10).
    const handle = ctx.slots.inject('conversation.view', () => ctx.slots.register(
      { name: 'conversation.view', id: 'git-panel', order: 30, locale: NS, label: () => t('panel.tab') },
      (props: { sessionId?: string }) => h(Panel, { ctx, sessionId: props.sessionId, t }),
    ))
    // The platform returns an idempotent disposer. A non-function means that
    // contract broke; saying so is better than faking a release, which would
    // silently leave the registration in place and double-register on the
    // next remount.
    if (typeof handle !== 'function') throw new Error('git-panel: slots.inject must return a disposer')
    releaseTab = handle as () => void
  }

  const unmountTab = (): void => {
    if (releaseTab === undefined) return
    const release = releaseTab
    releaseTab = undefined
    try { release() } catch { /* ignore */ }
  }

  // The sidebar's page type is registered only where the host has a right
  // sidebar to register with. A host without one leaves this unmounted, so
  // the registration is retried when the service arrives.
  const mountSidebar = (): void => {
    if (releaseSidebar !== undefined) return
    releaseSidebar = registerSidebarTab(ctx, t)
  }

  const unmountSidebar = (): void => {
    const release = releaseSidebar
    releaseSidebar = undefined
    try { release?.() } catch { /* ignore */ }
  }

  // Bring the mounts in line with the effective placement.
  const reconcile = (): void => {
    const want = mountState(effectivePlacement())
    if (want.tab) mountTab()
    else unmountTab()
    if (want.sidebar) mountSidebar()
    else unmountSidebar()
  }

  // The right sidebar is optional, and its service may arrive after this
  // plugin does. Read the preference first, then keep watching for the
  // service: when it shows up, the sidebar-only preference takes effect.
  setChosenPlacement(readPlacementFromConfig(ctx))
  setSidebarAvailable(sidebarRegistry(ctx) !== undefined)
  reconcile()

  // The right sidebar's registry service is waited for through a deferred
  // injection — not through this plugin's own `inject` list, which would leave
  // the whole plugin waiting on a host that may never provide it.
  ctx.inject(['sidebarRightTabs'], (ready) => {
    setSidebarAvailable(sidebarRegistry(ready) !== undefined)
    reconcile()
  })

  // The preference itself: read the settings mirror and follow its changes.
  // The resync closes the loop for the pill: its tooltip text and click target
  // read the effective placement, and those are only re-rendered when a
  // snapshot arrives. A change arriving from outside the config form (a
  // profile switch, another window) would otherwise wait for the next poll.
  const stopWatching = watchPlacement(ctx, (next) => {
    setChosenPlacement(next)
    reconcile()
    resyncAll()
  })

  // inputBar zsh-style git marker.
  track(ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'git-panel-pill', order: 100, locale: NS },
    (props: { sessionId?: string }) => h(GitPill, { ctx, sessionId: props.sessionId, t }),
  )))

  // Plugin detail page config form (the openviking-manager pattern): only an
  // explicit `plugins.bundle.config` entry keyed by the bundle identity gives
  // the detail page a configuration section — `static Config` alone renders
  // nothing. One registration per install-identity key (see BUNDLE_KEYS).
  for (const key of BUNDLE_KEYS) {
    track(ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
      { name: 'plugins.bundle.config', key, locale: NS },
      (props: { view?: string }) => (props.view === 'summary' ? t('cfg.title') : h(PillConfig, { ctx, t })),
    )))
  }

  // Refresh all controllers on connection reset; dispose slots + controllers on teardown.
  ctx.effect(() => {
    const off = ctx.on('connection/reset', () => resyncAll())
    return () => {
      if (typeof off === 'function') off()
      stopWatching()
      unmountTab()
      unmountSidebar()
      for (const d of disposers.splice(0)) { try { d() } catch { /* ignore */ } }
      disposeAll()
    }
  }, 'dsh-git-panel: lifecycle')
}

module.exports = { name, inject, apply }
