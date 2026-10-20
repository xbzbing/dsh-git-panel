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
import { Menu, type MenuItem } from '@deepseek-ai/dsh-client-ui-primitives'
import { findNamespace, resyncAfterWrite } from './config-write.js'
import { normalizePlacement } from './placement.js'
import { segButtons } from './seg.js'
import { effortForModel, modelForProvider } from './model-route.js'
import { selectTrigger } from './select-trigger.js'
import { gitPanelRemoteOf, queryAs } from './rpc.js'
import type { ClientCtx, ConfigFormsFace } from './rpc.js'
import type { FontDelta, GitPanelPlacement, GraphStyle, ModelCatalogGroup, SuggestLanguage } from './types.js'
import { SUGGEST_LANGUAGES, SUGGEST_LANGUAGE_DEFAULT, SUGGEST_LIMITS } from './types.js'
import type { GitKey } from './locales.js'

interface PillConfigProps {
  readonly ctx: ClientCtx
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type DiffView = 'unified' | 'split'

/** Catalog load lifecycle for the model cascading selects. */
type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Model-catalog is host-level; the request type still carries sessionId. */
const SESSION_PLACEHOLDER = ''

// Suggest-limit display units, derived from the host units in SUGGEST_LIMITS
// (bytes / tokens / ms) so the form's ranges and fallbacks cannot drift from
// what normalizeConfig actually enforces. The divisions are exact (guarded by
// test) and the fallbacks mirror the host DEFAULT_CONFIG.
const MAX_KIB = { min: SUGGEST_LIMITS.maxBytes.min / 1024, max: SUGGEST_LIMITS.maxBytes.max / 1024 }
const TIMEOUT_S = { min: SUGGEST_LIMITS.timeoutMs.min / 1000, max: SUGGEST_LIMITS.timeoutMs.max / 1000 }

/** Clamp a display value into its range, mirroring the host-side enforcement
 * (normalizeConfig floors, so the form floors too — same rounding everywhere). */
function clampDisplay(v: number, range: { readonly min: number; readonly max: number }): number {
  return Math.min(range.max, Math.max(range.min, Math.floor(v)))
}

/** Parse a numeric draft; null when blank/unparseable (caller keeps the current value). */
function parseDraft(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export function PillConfig({ ctx, t }: PillConfigProps): JSX.Element {
  const [, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState<boolean | null>(null)
  const [pendingPlacement, setPendingPlacement] = useState<GitPanelPlacement | null>(null)
  const [pendingView, setPendingView] = useState<DiffView | null>(null)
  const [pendingGraph, setPendingGraph] = useState<GraphStyle | null>(null)
  const [pendingFont, setPendingFont] = useState<FontDelta | null>(null)
  const [pendingSuggest, setPendingSuggest] = useState<boolean | null>(null)
  const [pendingLang, setPendingLang] = useState<SuggestLanguage | null>(null)
  // Numeric drafts are local edit state: onChange only updates the draft so
  // typing is never blocked mid-edit; blur/Enter parses, clamps and commits.
  const [draftMaxKib, setDraftMaxKib] = useState<string | null>(null)
  const [draftOutputTokens, setDraftOutputTokens] = useState<string | null>(null)
  const [draftTimeout, setDraftTimeout] = useState<string | null>(null)
  // Model catalog: host-level providers / models / efforts.
  const [catalog, setCatalog] = useState<readonly ModelCatalogGroup[]>([])
  const [catalogFailures, setCatalogFailures] = useState<readonly { id: string; name: string; message: string }[]>([])
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>('idle')
  // In-flight model-route write: the optimistic value while the write is in
  // flight — and, for an incomplete pair (provider without model), until the
  // next selection, because the host drops that half from the live config so
  // the snapshot alone cannot hold "provider picked".
  const [pendingRoute, setPendingRoute] = useState<{ provider: string; model: string; effort: string } | null>(null)
  // Platform Menu is controlled; the caller toggles open state per row.
  const [providerOpen, setProviderOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const bump = (): void => { setTick((n) => n + 1) }

  const forms = ctx.get('configForms') as ConfigFormsFace | undefined
  // Memoize the describe/get faces per source so a host that returns a fresh
  // face each render doesn't tear down and re-open the subscriptions below.
  const mirror = useMemo(() => forms?.describe(), [forms])

  useEffect(() => {
    if (mirror === undefined) return
    void mirror.ensure()
    return mirror.subscribe(bump)
  }, [mirror])

  // Resolved once per mirror view (not per render): the schema scan is the
  // only costly step and the namespaces rarely change identity.
  const view = mirror?.getSnapshot().view
  const ns = useMemo(() => (view === undefined ? undefined : findNamespace(view.namespaces)), [view])
  const form = useMemo(() => (forms !== undefined && ns !== undefined ? forms.get(ns) : undefined), [forms, ns])

  useEffect(() => {
    if (form === undefined) return
    return form.subscribe(bump)
  }, [form])

  const snap = form?.getSnapshot()
  const loaded = form !== undefined && snap !== undefined && snap.status === 'ready'
  const mirrorStatus = mirror?.getSnapshot().status
  const checked = pending ?? (typeof snap?.value?.showInputPill === 'boolean' ? (snap.value.showInputPill as boolean) : true)
  const placement: GitPanelPlacement = pendingPlacement ?? normalizePlacement(snap?.value?.placement)
  const diffView: DiffView = pendingView ?? (snap?.value?.defaultDiffView === 'split' ? 'split' : 'unified')
  const graphStyle: GraphStyle = pendingGraph ?? (snap?.value?.graphStyle === 'compact' ? 'compact' : 'parallel')
  const fontDelta: FontDelta = pendingFont
    ?? (snap?.value?.fontDelta === -1 || snap?.value?.fontDelta === 1 ? (snap.value.fontDelta as FontDelta) : 0)
  const suggestEnabled = pendingSuggest ?? (typeof snap?.value?.suggestEnabled === 'boolean' ? (snap.value.suggestEnabled as boolean) : true)
  const rawLang = snap?.value?.suggestLanguage
  const suggestLanguage: SuggestLanguage = pendingLang
    ?? (typeof rawLang === 'string' && (SUGGEST_LANGUAGES as readonly string[]).includes(rawLang) ? rawLang as SuggestLanguage : SUGGEST_LANGUAGE_DEFAULT)
  // Display values: derive from the RAW snapshot value into the display unit,
  // clamped into range so the form shows what the host will actually enforce
  // (an out-of-range value written outside this form is clamped host-side too).
  const suggestMaxKib = clampDisplay(
    typeof snap?.value?.suggestMaxBytes === 'number' ? (snap.value.suggestMaxBytes as number) / 1024 : SUGGEST_LIMITS.maxBytes.default / 1024,
    MAX_KIB,
  )
  const suggestOutputTokens = clampDisplay(
    typeof snap?.value?.suggestMaxOutputTokens === 'number' ? (snap.value.suggestMaxOutputTokens as number) : SUGGEST_LIMITS.maxOutputTokens.default,
    SUGGEST_LIMITS.maxOutputTokens,
  )
  const suggestTimeoutS = clampDisplay(
    typeof snap?.value?.suggestTimeoutMs === 'number' ? (snap.value.suggestTimeoutMs as number) / 1000 : SUGGEST_LIMITS.timeoutMs.default / 1000,
    TIMEOUT_S,
  )
  // Model route: pending write wins over the snapshot. Provider alone drives
  // the model row; model alone drives the effort row. The effort select is
  // blank until both halves of the pair are set.
  const rawProvider = typeof snap?.value?.suggestProvider === 'string' ? (snap.value.suggestProvider as string) : ''
  const rawModel = typeof snap?.value?.suggestModel === 'string' ? (snap.value.suggestModel as string) : ''
  const rawEffort = typeof snap?.value?.suggestReasoningEffort === 'string' ? (snap.value.suggestReasoningEffort as string) : ''
  const uiProvider = pendingRoute?.provider ?? rawProvider
  const uiModel = pendingRoute !== null ? pendingRoute.model : (rawProvider !== '' ? rawModel : '')
  const uiEffort = pendingRoute !== null ? pendingRoute.effort : rawEffort
  const fixedEffort = uiProvider !== '' && uiModel !== '' ? uiEffort : ''
  const activeGroup = catalog.find((g) => g.id === uiProvider)
  const activeModel = activeGroup?.models.find((m) => m.id === uiModel)
  const efforts = activeModel?.reasoning?.efforts

  // Load the host catalog once the config form is readable; reload on demand.
  const loadCatalog = (): void => {
    setCatalogStatus('loading')
    void gitPanelRemoteOf(ctx)
      .query({ sessionId: SESSION_PLACEHOLDER, query: { kind: 'model-catalog' } })
      .then((res) => {
        const value = queryAs(res, 'model-catalog')
        if (value === null) {
          setCatalogStatus('error')
          return
        }
        setCatalog(value.groups)
        setCatalogFailures(value.failures)
        setCatalogStatus('ready')
      })
      .catch(() => { setCatalogStatus('error') })
  }

  useEffect(() => {
    if (!loaded) return
    if (catalogStatus !== 'idle') return
    loadCatalog()
    // Intentionally once per form load: reload is the retry button's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  // Write one config field, then resync so the pill/tab-dot reflect it without
  // waiting for the next poll; `clearPending` resets that field's optimistic
  // value. A snapshot already in flight when the write lands wins the first
  // resync with pre-write values, so a second re-pull bounds that race.
  const commitField = async (field: string, next: unknown, clearPending: () => void): Promise<void> => {
    if (form === undefined) return
    setFailed(false)
    setBusy(true)
    try {
      const ok = await form.set(field, next)
      clearPending()
      if (!ok) setFailed(true)
      else resyncAfterWrite()
    } catch {
      clearPending()
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (next: boolean): Promise<void> => {
    setPending(next)
    return commitField('showInputPill', next, () => setPending(null))
  }

  const setPlacement = (next: GitPanelPlacement): Promise<void> => {
    if (next === placement) return Promise.resolve()
    setPendingPlacement(next)
    return commitField('placement', next, () => setPendingPlacement(null))
  }

  const setView = (next: DiffView): Promise<void> => {
    if (next === diffView) return Promise.resolve()
    setPendingView(next)
    return commitField('defaultDiffView', next, () => setPendingView(null))
  }

  const setGraph = (next: GraphStyle): Promise<void> => {
    if (next === graphStyle) return Promise.resolve()
    setPendingGraph(next)
    return commitField('graphStyle', next, () => setPendingGraph(null))
  }

  const setFont = (next: FontDelta): Promise<void> => {
    if (next === fontDelta) return Promise.resolve()
    setPendingFont(next)
    return commitField('fontDelta', next, () => setPendingFont(null))
  }

  const toggleSuggest = (next: boolean): Promise<void> => {
    setPendingSuggest(next)
    return commitField('suggestEnabled', next, () => setPendingSuggest(null))
  }

  const setLanguage = (next: SuggestLanguage): Promise<void> => {
    if (next === suggestLanguage) return Promise.resolve()
    setPendingLang(next)
    return commitField('suggestLanguage', next, () => setPendingLang(null))
  }

  // Write the three route fields together. Empty string is the host's "absent"
  // spelling. An incomplete pair (provider without model) is dropped host-side,
  // so on success the optimistic value is kept until the next selection; every
  // other outcome — including any write failure — drops it and falls back to
  // the snapshot, matching the other pendingX fields.
  const writeModelRoute = async (
    provider: string,
    model: string,
    effort: string,
  ): Promise<void> => {
    if (form === undefined) return
    setFailed(false)
    setBusy(true)
    setPendingRoute({ provider, model, effort })
    let ok = false
    try {
      const okP = await form.set('suggestProvider', provider)
      const okM = await form.set('suggestModel', model)
      const okE = await form.set('suggestReasoningEffort', effort)
      ok = okP && okM && okE
      if (!ok) setFailed(true)
      else resyncAfterWrite()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
      if (provider === '' || model !== '' || !ok) setPendingRoute(null)
    }
  }

  const setProvider = (next: string): Promise<void> => {
    if (next === '') return writeModelRoute('', '', '')
    // Keep the model only if it belongs to the new provider, and the effort
    // only if the kept model still advertises it (same rule as setModel).
    const keepModel = modelForProvider(catalog, next, uiModel)
    const keepEffort = effortForModel(catalog, next, keepModel, uiEffort)
    return writeModelRoute(next, keepModel, keepEffort)
  }

  const setModel = (next: string): Promise<void> => {
    if (next === '') return writeModelRoute(uiProvider, '', '')
    // Drop a stale effort when the new model does not advertise it.
    const keepEffort = effortForModel(catalog, uiProvider, next, uiEffort)
    return writeModelRoute(uiProvider, next, keepEffort)
  }

  const setEffort = (next: string): Promise<void> =>
    writeModelRoute(uiProvider, uiModel, next)

  // Commit one numeric draft: parse → clamp to the display-unit range → write
  // in storage units (KiB→bytes, s→ms, tokens as-is). The clamped value is
  // HELD as the draft until the write lands (optimistic, like the pendingX
  // pattern above — clearing early would flash the pre-write live value);
  // commitField clears it on completion, so a failure falls back to the live
  // value beside the error line. A blank/unparseable draft just reverts to
  // the live value without writing.
  const commitSuggestNumber = (
    raw: string | null,
    range: { readonly min: number; readonly max: number },
    scale: number,
    field: string,
    setDraft: (v: string) => void,
    clearDraft: () => void,
  ): Promise<void> => {
    const parsed = raw === null ? null : parseDraft(raw)
    if (parsed === null) { clearDraft(); return Promise.resolve() }
    const clamped = Math.min(range.max, Math.max(range.min, Math.floor(parsed)))
    setDraft(String(clamped))
    return commitField(field, clamped * scale, clearDraft)
  }

  const commitMaxKib = (raw: string | null): Promise<void> =>
    commitSuggestNumber(raw, MAX_KIB, 1024, 'suggestMaxBytes', setDraftMaxKib, () => setDraftMaxKib(null))

  const commitOutputTokens = (raw: string | null): Promise<void> =>
    commitSuggestNumber(raw, SUGGEST_LIMITS.maxOutputTokens, 1, 'suggestMaxOutputTokens', setDraftOutputTokens, () => setDraftOutputTokens(null))

  const commitTimeout = (raw: string | null): Promise<void> =>
    commitSuggestNumber(raw, TIMEOUT_S, 1000, 'suggestTimeoutMs', setDraftTimeout, () => setDraftTimeout(null))

  // Platform Menu rows: the same dropdown surface as the overview author /
  // since filters. Trigger is ours; Menu never closes itself, so onSelect closes.
  const providerItems: readonly MenuItem[] = [
    { id: '', label: t('cfg.suggestModelSession') },
    ...catalog.map((g) => ({ id: g.id, label: g.name })),
  ]
  const modelItems: readonly MenuItem[] = [
    { id: '', label: t('cfg.suggestModelPick') },
    ...(activeGroup?.models ?? []).map((m) => ({ id: m.id, label: m.name })),
  ]
  const effortItems: readonly MenuItem[] = [
    { id: '', label: t('cfg.suggestEffortUnset') },
    ...(efforts ?? []).map((eff) => ({ id: eff.id, label: eff.name })),
  ]
  const renderMenuTrigger = (
    open: boolean,
    label: string,
    toggle: () => void,
    disabled: boolean,
  ): JSX.Element => selectTrigger(open, label, toggle, { disabled, extraClass: 'gp-cfg__select-trigger' })
  const menuDisabled = busy || snap?.writable === false
  const providerLabel = uiProvider === ''
    ? t('cfg.suggestModelSession')
    : catalog.find((g) => g.id === uiProvider)?.name ?? uiProvider
  const modelLabel = uiModel === ''
    ? t('cfg.suggestModelPick')
    : activeModel?.name ?? uiModel
  const effortLabel = fixedEffort === ''
    ? t('cfg.suggestEffortUnset')
    : efforts?.find((eff) => eff.id === fixedEffort)?.name ?? fixedEffort
  const providerMenu = h(Menu, {
    key: 'provider',
    open: providerOpen,
    onClose: () => setProviderOpen(false),
    items: providerItems,
    selectedId: uiProvider,
    onSelect: (id: string) => {
      setProviderOpen(false)
      void setProvider(id)
    },
    align: 'start',
    portal: true,
    className: 'gp-cfg__menu',
    anchor: renderMenuTrigger(providerOpen, providerLabel, () => setProviderOpen((v) => !v), menuDisabled || catalogStatus === 'loading'),
  })
  const modelMenu = h(Menu, {
    key: 'model',
    open: modelOpen,
    onClose: () => setModelOpen(false),
    items: modelItems,
    selectedId: uiModel,
    onSelect: (id: string) => {
      setModelOpen(false)
      void setModel(id)
    },
    align: 'start',
    portal: true,
    className: 'gp-cfg__menu',
    anchor: renderMenuTrigger(modelOpen, modelLabel, () => setModelOpen((v) => !v), menuDisabled || activeGroup === undefined),
  })
  const effortMenu = h(Menu, {
    key: 'effort',
    open: effortOpen,
    onClose: () => setEffortOpen(false),
    items: effortItems,
    selectedId: fixedEffort,
    onSelect: (id: string) => {
      setEffortOpen(false)
      void setEffort(id)
    },
    align: 'start',
    portal: true,
    className: 'gp-cfg__menu',
    anchor: renderMenuTrigger(effortOpen, effortLabel, () => setEffortOpen((v) => !v), menuDisabled),
  })

  if (forms === undefined) return h('p', { className: 'gp-cfg__hint' }, t('cfg.notLoaded'))
  if (!loaded) {
    if (mirrorStatus === 'idle' || mirrorStatus === 'loading') return h('p', { className: 'gp-cfg__hint' }, t('common.loading'))
    return h('p', { className: 'gp-cfg__hint' }, t('cfg.notLoaded'))
  }

  return h('div', { className: 'gp-cfg' }, [
    h('h3', { key: 'placetitle', className: 'gp-cfg__title' }, t('cfg.placementTitle')),
    h('div', { key: 'placeseg', className: 'gp-seg gp-cfg__seg', role: 'group', 'aria-label': t('cfg.placementTitle') },
      segButtons<GitPanelPlacement>(['all', 'tab', 'sidebar'], placement, (v) => { void setPlacement(v) },
        (v) => t(v === 'all' ? 'cfg.placementAll' : v === 'tab' ? 'cfg.placementTab' : 'cfg.placementSidebar'), busy || snap?.writable === false)),
    h('p', { key: 'placehint', className: 'gp-cfg__hint' }, t('cfg.placementHint')),
    h('h3', { key: 'title', className: 'gp-cfg__title', style: { marginTop: 6 } }, t('cfg.title')),
    h('label', { key: 'row', className: 'gp-cfg__row' }, [
      h('input', {
        key: 'switch', type: 'checkbox', role: 'switch', className: 'gp-cfg__switch',
        checked, disabled: busy || snap?.writable === false,
        onChange: (e: ChangeEvent<HTMLInputElement>) => { void toggle(e.currentTarget.checked) },
      }),
      h('span', { key: 'text', className: 'gp-cfg__text' }, t('cfg.toggle')),
    ]),
    h('p', { key: 'hint', className: 'gp-cfg__hint' }, t('cfg.hint')),
    h('h3', { key: 'difftitle', className: 'gp-cfg__title', style: { marginTop: 6 } }, t('cfg.diffTitle')),
    h('div', { key: 'diffseg', className: 'gp-seg gp-cfg__seg' },
      segButtons<DiffView>(['unified', 'split'], diffView, (v) => { void setView(v) },
        (v) => t(v === 'unified' ? 'cfg.diffUnified' : 'cfg.diffSplit'), busy || snap?.writable === false)),
    h('p', { key: 'diffhint', className: 'gp-cfg__hint' }, t('cfg.diffHint')),
    h('h3', { key: 'graphtitle', className: 'gp-cfg__title', style: { marginTop: 6 } }, t('cfg.graphTitle')),
    h('div', { key: 'graphseg', className: 'gp-seg gp-cfg__seg' },
      segButtons<GraphStyle>(['parallel', 'compact'], graphStyle, (v) => { void setGraph(v) },
        (v) => t(v === 'parallel' ? 'cfg.graphParallel' : 'cfg.graphCompact'), busy || snap?.writable === false)),
    h('p', { key: 'graphhint', className: 'gp-cfg__hint' }, t('cfg.graphHint')),
    h('h3', { key: 'fonttitle', className: 'gp-cfg__title', style: { marginTop: 6 } }, t('cfg.fontTitle')),
    h('div', { key: 'fontseg', className: 'gp-seg gp-cfg__seg' },
      segButtons<'smaller' | 'default' | 'larger'>(
        ['smaller', 'default', 'larger'],
        fontDelta === -1 ? 'smaller' : fontDelta === 1 ? 'larger' : 'default',
        (v) => { void setFont(v === 'smaller' ? -1 : v === 'larger' ? 1 : 0) },
        (v) => t(v === 'smaller' ? 'cfg.fontSmaller' : v === 'larger' ? 'cfg.fontLarger' : 'cfg.fontDefault'),
        busy || snap?.writable === false)),
    h('p', { key: 'fonthint', className: 'gp-cfg__hint' }, t('cfg.fontHint')),
    h('h3', { key: 'sgtitle', className: 'gp-cfg__title', style: { marginTop: 6 } }, t('cfg.suggestTitle')),
    h('label', { key: 'sgrow', className: 'gp-cfg__row' }, [
      h('input', {
        key: 'switch', type: 'checkbox', role: 'switch', className: 'gp-cfg__switch',
        checked: suggestEnabled, disabled: busy || snap?.writable === false,
        onChange: (e: ChangeEvent<HTMLInputElement>) => { void toggleSuggest(e.currentTarget.checked) },
      }),
      h('span', { key: 'text', className: 'gp-cfg__text' }, t('cfg.suggestToggle')),
    ]),
    h('p', { key: 'sglangtitle', className: 'gp-cfg__seglabel' }, t('cfg.suggestLangLabel')),
    h('div', { key: 'sglang', className: 'gp-seg gp-cfg__seg', role: 'group', 'aria-label': t('cfg.suggestLangLabel') },
      segButtons<SuggestLanguage>([...SUGGEST_LANGUAGES], suggestLanguage, (v) => { void setLanguage(v) },
        (v) => t(v === 'auto' ? 'cfg.suggestLangAuto' : v === 'zh' ? 'cfg.suggestLangZh' : 'cfg.suggestLangEn'), busy || snap?.writable === false)),
    h('p', { key: 'sglanghint', className: 'gp-cfg__rangehint' }, t('cfg.suggestLangHint')),
    h('div', { key: 'numax', className: 'gp-cfg__numrow' }, [
      h('label', { key: 'lab', className: 'gp-cfg__numlabel', htmlFor: 'gp-cfg-maxkib' }, t('cfg.suggestMaxBytesLabel')),
      h('input', {
        key: 'input', id: 'gp-cfg-maxkib', type: 'number', className: 'gp-cfg__numinput',
        inputMode: 'numeric', min: MAX_KIB.min, max: MAX_KIB.max, 'aria-describedby': 'gp-cfg-maxkib-hint',
        value: draftMaxKib ?? String(suggestMaxKib),
        disabled: busy || snap?.writable === false,
        onChange: (e: ChangeEvent<HTMLInputElement>) => { setDraftMaxKib(e.currentTarget.value) },
        onBlur: () => { void commitMaxKib(draftMaxKib) },
        onKeyDown: (e) => { if (e.key === 'Enter') { e.currentTarget.blur() } },
      }),
      h('span', { key: 'unit', className: 'gp-cfg__numunit' }, t('cfg.suggestMaxBytesUnit')),
    ]),
    h('p', { key: 'numaxhint', id: 'gp-cfg-maxkib-hint', className: 'gp-cfg__rangehint' }, t('cfg.suggestMaxBytesHint')),
    h('div', { key: 'nuout', className: 'gp-cfg__numrow' }, [
      h('label', { key: 'lab', className: 'gp-cfg__numlabel', htmlFor: 'gp-cfg-outtok' }, t('cfg.suggestOutputLabel')),
      h('input', {
        key: 'input', id: 'gp-cfg-outtok', type: 'number', className: 'gp-cfg__numinput',
        inputMode: 'numeric', min: SUGGEST_LIMITS.maxOutputTokens.min, max: SUGGEST_LIMITS.maxOutputTokens.max, 'aria-describedby': 'gp-cfg-outtok-hint',
        value: draftOutputTokens ?? String(suggestOutputTokens),
        disabled: busy || snap?.writable === false,
        onChange: (e: ChangeEvent<HTMLInputElement>) => { setDraftOutputTokens(e.currentTarget.value) },
        onBlur: () => { void commitOutputTokens(draftOutputTokens) },
        onKeyDown: (e) => { if (e.key === 'Enter') { e.currentTarget.blur() } },
      }),
      h('span', { key: 'unit', className: 'gp-cfg__numunit' }, t('cfg.suggestOutputUnit')),
    ]),
    h('p', { key: 'nuouthint', id: 'gp-cfg-outtok-hint', className: 'gp-cfg__rangehint' }, t('cfg.suggestOutputHint')),
    h('div', { key: 'nuto', className: 'gp-cfg__numrow' }, [
      h('label', { key: 'lab', className: 'gp-cfg__numlabel', htmlFor: 'gp-cfg-timeout' }, t('cfg.suggestTimeoutLabel')),
      h('input', {
        key: 'input', id: 'gp-cfg-timeout', type: 'number', className: 'gp-cfg__numinput',
        inputMode: 'numeric', min: TIMEOUT_S.min, max: TIMEOUT_S.max, 'aria-describedby': 'gp-cfg-timeout-hint',
        value: draftTimeout ?? String(suggestTimeoutS),
        disabled: busy || snap?.writable === false,
        onChange: (e: ChangeEvent<HTMLInputElement>) => { setDraftTimeout(e.currentTarget.value) },
        onBlur: () => { void commitTimeout(draftTimeout) },
        onKeyDown: (e) => { if (e.key === 'Enter') { e.currentTarget.blur() } },
      }),
      h('span', { key: 'unit', className: 'gp-cfg__numunit' }, t('cfg.suggestTimeoutUnit')),
    ]),
    h('p', { key: 'nutohint', id: 'gp-cfg-timeout-hint', className: 'gp-cfg__rangehint' }, t('cfg.suggestTimeoutHint')),
    h('div', { key: 'sgmodel', className: 'gp-cfg__menur' }, [
      h('span', { key: 'lab', className: 'gp-cfg__menulabel' }, t('cfg.suggestModelLabel')),
      providerMenu,
    ]),
    uiProvider !== ''
      ? h('div', { key: 'sgmodel2', className: 'gp-cfg__menur' }, [
        h('span', { key: 'lab', className: 'gp-cfg__menulabel' }, t('cfg.suggestProviderLabel')),
        modelMenu,
      ])
      : null,
    uiProvider !== '' && uiModel !== '' && efforts !== undefined && efforts.length > 0
      ? h('div', { key: 'sgeffort', className: 'gp-cfg__menur' }, [
        h('span', { key: 'lab', className: 'gp-cfg__menulabel' }, t('cfg.suggestEffortLabel')),
        effortMenu,
      ])
      : null,
    catalogStatus === 'loading'
      ? h('p', { key: 'sgload', className: 'gp-cfg__rangehint' }, t('cfg.suggestModelLoading'))
      : catalogStatus === 'error'
        ? h('p', { key: 'sgerr', className: 'gp-cfg__err', role: 'alert' }, [
          t('cfg.suggestModelFailed'),
          ' ',
          h('button', {
            key: 'retry', type: 'button', className: 'gp-cfg__retry',
            onClick: () => { loadCatalog() },
          }, t('cfg.suggestModelRetry')),
        ])
        // Failures win over the empty hint: a fully failed catalog is an
        // adapter error, not proof that the host has no models.
        : catalogFailures.length > 0
          ? h('p', { key: 'sgfail', className: 'gp-cfg__rangehint' },
            `${t('cfg.suggestModelFailed')}: ${catalogFailures.map((f) => f.name).join(', ')}`)
          : catalog.length === 0
            ? h('p', { key: 'sgempty', className: 'gp-cfg__rangehint' }, t('cfg.suggestModelEmpty'))
            : null,
    h('p', { key: 'sghint2', className: 'gp-cfg__hint' }, t('cfg.suggestHint')),
    failed ? h('p', { key: 'error', className: 'gp-cfg__err', role: 'alert' }, t('cfg.saveFailed')) : null,
  ])
}
