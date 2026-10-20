/**
 * Write one volatile Git-panel config field from outside the detail-page form
 * (the wide-layout font stepper). The settings form and this helper share a
 * single write contract so the double resync cannot drift between the two.
 */
import { resyncAll } from './registry.js'
import type { ConfigFormsFace, SettingsNamespaceView } from './rpc.js'

/** Volatile fields the settings schema exposes (host `GitPanelService.Config`). */
export type VolatileField =
  | 'showInputPill'
  | 'placement'
  | 'defaultDiffView'
  | 'graphStyle'
  | 'fontDelta'
  | 'suggestEnabled'
  | 'suggestLanguage'
  | 'suggestMaxBytes'
  | 'suggestMaxOutputTokens'
  | 'suggestTimeoutMs'
  | 'suggestProvider'
  | 'suggestModel'
  | 'suggestReasoningEffort'

/**
 * Fields whose presence in a namespace's schema marks it as ours. Any one of
 * them identifies the namespace, so dropping one field cannot break the
 * discovery for the others.
 */
const NAMESPACE_MARKERS = ['showInputPill', 'placement'] as const

/** The settings namespace whose schema declares one of our fields (ours). */
export function findNamespace(namespaces: readonly SettingsNamespaceView[]): string | undefined {
  for (const row of namespaces) {
    const dict = (row.schema as { dict?: Record<string, unknown> } | undefined)?.dict
    if (dict !== undefined) {
      for (const marker of NAMESPACE_MARKERS) {
        if (marker in dict) return row.ns
      }
    }
    const serialized = JSON.stringify(row.schema)
    for (const marker of NAMESPACE_MARKERS) {
      if (serialized.includes(marker)) return row.ns
    }
  }
  return undefined
}

/**
 * Set one field through the settings form, then resync so the pill/tab-dot
 * reflect it without waiting for the next poll. A snapshot already in flight
 * when the write lands can win the first resync with pre-write values, so a
 * second re-pull bounds that race.
 */
export function resyncAfterWrite(): void {
  resyncAll()
  setTimeout(() => { resyncAll() }, 1000)
}

export async function applyVolatileField(
  forms: ConfigFormsFace,
  field: VolatileField,
  value: unknown,
): Promise<boolean> {
  const mirror = forms.describe()
  await mirror.ensure()
  const view = mirror.getSnapshot().view
  if (view === undefined) return false
  const ns = findNamespace(view.namespaces)
  if (ns === undefined) return false
  const ok = await forms.get(ns).set(field, value)
  if (ok) resyncAfterWrite()
  return ok
}

/** Panel-side convenience: resolve `configForms` from the Cordis context. */
export async function writePanelConfigField(
  ctx: { get(key: string): unknown },
  field: VolatileField,
  value: unknown,
): Promise<boolean> {
  const forms = ctx.get('configForms') as ConfigFormsFace | undefined
  if (forms === undefined) return false
  try {
    return await applyVolatileField(forms, field, value)
  } catch {
    return false
  }
}

/** True when the settings form is reachable (the panel hides the stepper otherwise). */
export function hasConfigForms(ctx: { get(key: string): unknown }): boolean {
  return ctx.get('configForms') !== undefined
}
