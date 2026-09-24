/**
 * dsh-git-panel client half — Cordis apply.
 *
 * Registers two slots:
 *   conversation.view (order 30)  → the Git panel (Overview / Changes tabs)
 *   conversation.input.left       → the zsh-style Git branch marker pill
 * Bilingual dictionaries are registered under the `gitPanel` namespace; the
 * per-session snapshot controller registry is bound to this context.
 */
import { createElement as h } from 'react'
import { ensureStyles } from './styles'
import { en, zh } from './locales'
import { bindContext, disposeAll, resyncAll } from './registry'
import { Panel } from './Panel'
import { GitPill } from './GitPill'
import type { ClientCtx } from './rpc'

const NS = 'gitPanel'

export const inject = ['slots', 'locale', 'connection']

export const name = 'dsh-git-panel'

export function apply(ctx: ClientCtx): void {
  ensureStyles()
  bindContext(ctx)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }) ?? undefined, 'dsh-git-panel: dictionaries')
  const t = ctx.locale.bind(NS) as (key: string, params?: Record<string, string | number>) => string

  // Main panel tab beside Chat (0) / Trajectory (10).
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    { name: 'conversation.view', id: 'git-panel', order: 30, locale: NS, label: () => t('panel.tab') },
    (props: { sessionId?: string }) => h(Panel, { ctx, sessionId: props.sessionId, t }),
  ))

  // inputBar zsh-style git marker.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    { name: 'conversation.input.left', id: 'git-panel-pill', order: 100, locale: NS },
    (props: { sessionId?: string }) => h(GitPill, { sessionId: props.sessionId, t }),
  ))

  // Refresh all controllers on connection reset; dispose on teardown.
  ctx.effect(() => {
    const off = ctx.on('connection/reset', () => resyncAll())
    return () => {
      if (typeof off === 'function') off()
      disposeAll()
    }
  }, 'dsh-git-panel: lifecycle')
}

module.exports = { name, inject, apply }
