/**
 * The panel-mount preference, read from the settings mirror.
 *
 * The preference lives in the host's config, so reading it means reading the
 * settings mirror's resolved value for this plugin's namespace. The mirror
 * resolves schema defaults before the first answer arrives, so a host that has
 * already read this plugin's settings hands over the effective value
 * immediately; one that has not answers later, and the caller follows the
 * change.
 */
import { findNamespace } from './config-write.js'
import { normalizePlacement } from './placement.js'
import type { ClientCtx, ConfigFormsFace, SettingsNamespaceView } from './rpc.js'
import type { GitPanelPlacement } from './types.js'

/** The settings face, or undefined when the host has no settings surface. */
function settingsForms(ctx: ClientCtx): ConfigFormsFace | undefined {
  const forms = ctx.get('configForms') as ConfigFormsFace | undefined
  return forms !== undefined && typeof forms.describe === 'function' ? forms : undefined
}

/** Read the preference out of a namespace's resolved value. */
function placementOf(namespaces: readonly SettingsNamespaceView[]): GitPanelPlacement | undefined {
  const ns = findNamespace(namespaces)
  if (ns === undefined) return undefined
  const row = namespaces.find((entry) => entry.ns === ns)
  const value = row?.value
  if (value === undefined || typeof value !== 'object' || value === null) return undefined
  return normalizePlacement((value as { placement?: unknown }).placement, 'all')
}

/**
 * The preference as the mirror currently holds it.
 *
 * A mirror that has not answered yet reports no value, and the caller keeps
 * the default until the answer arrives.
 */
export function readPlacementFromConfig(ctx: ClientCtx): GitPanelPlacement {
  const forms = settingsForms(ctx)
  if (forms === undefined) return 'all'
  try {
    const view = forms.describe().getSnapshot().view
    if (view === undefined) return 'all'
    return placementOf(view.namespaces) ?? 'all'
  } catch {
    return 'all'
  }
}

/**
 * Follow the preference.
 *
 * The first read is attempted immediately (the mirror may already hold an
 * answer); the read is also triggered if it does not, and every later change
 * is reported.
 *
 * @param ctx - the client context.
 * @param onChange - called with the new preference whenever it changes.
 * @returns a function that stops following.
 */
export function watchPlacement(ctx: ClientCtx, onChange: (next: GitPanelPlacement) => void): () => void {
  const forms = settingsForms(ctx)
  if (forms === undefined) return () => {}

  let current = readPlacementFromConfig(ctx)
  let stopped = false

  const report = (next: GitPanelPlacement): void => {
    if (stopped || next === current) return
    current = next
    onChange(next)
  }

  let mirror: ReturnType<ConfigFormsFace['describe']> | undefined
  try {
    mirror = forms.describe()
  } catch {
    return () => {}
  }

  const unsubscribe = mirror.subscribe(() => {
    const view = mirror?.getSnapshot().view
    if (view === undefined) return
    report(placementOf(view.namespaces) ?? 'all')
  })

  // Ask for the first answer if the mirror has none. A host that already has
  // one resolves this without a round trip.
  void Promise.resolve(mirror.ensure())
    .then(() => {
      if (stopped) return
      const view = mirror?.getSnapshot().view
      if (view === undefined) return
      report(placementOf(view.namespaces) ?? 'all')
    })
    .catch(() => { /* the mirror stays at its default */ })

  return () => {
    stopped = true
    try { unsubscribe() } catch { /* ignore */ }
  }
}
