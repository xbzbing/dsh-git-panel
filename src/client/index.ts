/**
 * dsh-git-panel client half — Cordis apply.
 *
 * Registers three slots:
 *   conversation.view (order 30)   → the Git panel (Overview / Changes tabs)
 *   conversation.input.left        → the zsh-style Git branch marker pill
 *   plugins.bundle.config          → the detail-page config form (showInputPill)
 * Bilingual dictionaries are registered under the `gitPanel` namespace; the
 * per-session snapshot controller registry is bound to this context.
 */
import { createElement as h } from 'react'
import { ensureStyles } from './styles'
import { en, zh } from './locales'
import { bindContext, disposeAll, resyncAll } from './registry'
import { Panel } from './Panel'
import { GitPill } from './GitPill'
import { PillConfig } from './PillConfig'
import type { ClientCtx } from './rpc'

const NS = 'gitPanel'
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
  const t = ctx.locale.bind(NS) as (key: string, params?: Record<string, string | number>) => string

  // Slot registrations may return an unregister handle; collect them and undo
  // them on teardown so a second apply (hot-reload) can't double-register.
  const disposers: Array<() => void> = []
  const track = (handle: unknown): void => { if (typeof handle === 'function') disposers.push(handle as () => void) }

  // Main panel tab beside Chat (0) / Trajectory (10).
  track(ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: 'git-panel', order: 30, locale: NS, label: () => t('panel.tab') },
    (props: { sessionId?: string }) => h(Panel, { ctx, sessionId: props.sessionId, t }),
  )))

  // inputBar zsh-style git marker.
  track(ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'git-panel-pill', order: 100, locale: NS },
    (props: { sessionId?: string }) => h(GitPill, { sessionId: props.sessionId, t }),
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
      for (const d of disposers.splice(0)) { try { d() } catch { /* ignore */ } }
      disposeAll()
    }
  }, 'dsh-git-panel: lifecycle')
}

module.exports = { name, inject, apply }
