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
import { resyncAll } from './registry.js'
import { segButtons } from './seg.js'
import type { ClientCtx, ConfigFormsFace, SettingsNamespaceView } from './rpc.js'
import type { GraphStyle, SuggestLanguage } from './types.js'
import { SUGGEST_LANGUAGES, SUGGEST_LANGUAGE_DEFAULT, SUGGEST_LIMITS } from './types.js'
import type { GitKey } from './locales.js'

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

type DiffView = 'unified' | 'split'

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
  const [pendingView, setPendingView] = useState<DiffView | null>(null)
  const [pendingGraph, setPendingGraph] = useState<GraphStyle | null>(null)
  const [pendingSuggest, setPendingSuggest] = useState<boolean | null>(null)
  const [pendingLang, setPendingLang] = useState<SuggestLanguage | null>(null)
  // Numeric drafts are local edit state: onChange only updates the draft so
  // typing is never blocked mid-edit; blur/Enter parses, clamps and commits.
  const [draftMaxKib, setDraftMaxKib] = useState<string | null>(null)
  const [draftOutputTokens, setDraftOutputTokens] = useState<string | null>(null)
  const [draftTimeout, setDraftTimeout] = useState<string | null>(null)
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
  const diffView: DiffView = pendingView ?? (snap?.value?.defaultDiffView === 'split' ? 'split' : 'unified')
  const graphStyle: GraphStyle = pendingGraph ?? (snap?.value?.graphStyle === 'compact' ? 'compact' : 'parallel')
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
      else { resyncAll(); setTimeout(() => resyncAll(), 1000) }
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

  const toggleSuggest = (next: boolean): Promise<void> => {
    setPendingSuggest(next)
    return commitField('suggestEnabled', next, () => setPendingSuggest(null))
  }

  const setLanguage = (next: SuggestLanguage): Promise<void> => {
    if (next === suggestLanguage) return Promise.resolve()
    setPendingLang(next)
    return commitField('suggestLanguage', next, () => setPendingLang(null))
  }

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
    h('div', { key: 'suggestcard', className: 'gp-cfg__card' }, [
      h('h3', { key: 'sgtitle', className: 'gp-cfg__card-title' }, t('cfg.suggestTitle')),
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
      h('p', { key: 'sghint', className: 'gp-cfg__hint' }, t('cfg.suggestHint')),
    ]),
    failed ? h('p', { key: 'error', className: 'gp-cfg__err', role: 'alert' }, t('cfg.saveFailed')) : null,
  ])
}
