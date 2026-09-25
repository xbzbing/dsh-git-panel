/**
 * Plugin detail page config form (the `plugins.bundle.config` slot body).
 *
 * Renders the `showInputPill` switch bound to this bundle's volatile Config
 * field through the settings `configForms` service — the openviking-manager
 * detail-page pattern (explicit slot registration; no auto-generated form
 * exists). The mirror namespace is discovered by schema shape, so the form
 * follows the Host entry id instead of assuming it.
 */
import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, JSX } from 'react'
import { resyncAll } from './registry'
import type { ClientCtx, ConfigFormsFace, SettingsNamespaceView } from './rpc'
import type { GitKey } from './locales'

interface PillConfigProps {
  readonly ctx: ClientCtx
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** The settings namespace whose schema declares `showInputPill` (ours). */
function findNamespace(namespaces: readonly SettingsNamespaceView[]): string | undefined {
  for (const row of namespaces) {
    const dict = (row.schema as { dict?: Record<string, unknown> } | undefined)?.dict
    if (dict !== undefined && 'showInputPill' in dict) return row.ns
    if (JSON.stringify(row.schema).includes('showInputPill')) return row.ns
  }
  return undefined
}

export function PillConfig({ ctx, t }: PillConfigProps): JSX.Element {
  const [, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState<boolean | null>(null)
  const bump = (): void => { setTick((n) => n + 1) }

  const forms = ctx.get('configForms') as ConfigFormsFace | undefined
  // Memoize the describe/get faces per source so a host that returns a fresh
  // face each render doesn't tear down and re-open the subscriptions below.
  const mirror = useMemo(() => forms?.describe(), [forms])

  useEffect(() => {
    if (mirror === undefined) return
    void mirror.ensure()
    return mirror.subscribe(bump)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mirror])

  // Resolved once per mirror view (not per render): the schema scan is the
  // only costly step and the namespaces rarely change identity.
  const view = mirror?.getSnapshot().view
  const ns = useMemo(() => (view === undefined ? undefined : findNamespace(view.namespaces)), [view])
  const form = useMemo(() => (forms !== undefined && ns !== undefined ? forms.get(ns) : undefined), [forms, ns])

  useEffect(() => {
    if (form === undefined) return
    return form.subscribe(bump)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  const snap = form?.getSnapshot()
  const loaded = form !== undefined && snap !== undefined && snap.status === 'ready'
  const mirrorStatus = mirror?.getSnapshot().status
  const checked = pending ?? (typeof snap?.value?.showInputPill === 'boolean' ? (snap.value.showInputPill as boolean) : true)

  const toggle = async (next: boolean): Promise<void> => {
    if (form === undefined) return
    setPending(next)
    setFailed(false)
    setBusy(true)
    try {
      const ok = await form.set('showInputPill', next)
      setPending(null)
      if (!ok) setFailed(true)
      // The pill and tab dot read the snapshot controller, which otherwise
      // only polls every refreshIntervalMs — resync so the flip shows now.
      else {
        resyncAll()
        // A snapshot already in flight when the write landed wins the first
        // resync with pre-write values; one later re-pull bounds that race.
        setTimeout(() => resyncAll(), 1000)
      }
    } catch {
      setPending(null)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (forms === undefined) return h('p', { className: 'gp-cfg__hint' }, t('cfg.notLoaded'))
  if (!loaded) {
    if (mirrorStatus === 'idle' || mirrorStatus === 'loading') return h('p', { className: 'gp-cfg__hint' }, t('common.loading'))
    return h('p', { className: 'gp-cfg__hint' }, t('cfg.notLoaded'))
  }

  return h('div', { className: 'gp-cfg' }, [
    h('h3', { key: 'title', className: 'gp-cfg__title' }, t('cfg.title')),
    h('label', { key: 'row', className: 'gp-cfg__row' }, [
      h('input', {
        key: 'switch', type: 'checkbox', role: 'switch', className: 'gp-cfg__switch',
        checked, disabled: busy || snap?.writable === false,
        onChange: (e: ChangeEvent<HTMLInputElement>) => { void toggle(e.currentTarget.checked) },
      }),
      h('span', { key: 'text', className: 'gp-cfg__text' }, t('cfg.toggle')),
    ]),
    h('p', { key: 'hint', className: 'gp-cfg__hint' }, t('cfg.hint')),
    failed ? h('p', { key: 'error', className: 'gp-cfg__err', role: 'alert' }, t('cfg.saveFailed')) : null,
  ])
}
