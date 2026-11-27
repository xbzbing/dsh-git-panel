import { createElement as h, useId, useRef, useState } from 'react'
import type { ChangeEvent, JSX } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCopyFeedback } from './copy-feedback.js'
import type { GitKey } from './locales.js'
import { renderModalShell } from './ops-modals.js'
import { segButtons } from './seg.js'
import { SUGGEST_PROMPT_MAX_BYTES } from './types.js'
import type { GitSuggestPromptPreview, GitSuggestPromptView, ResolvedLanguage } from './types.js'
import { useSuggestPromptConfig } from './use-suggest-prompt-config.js'
import type { PromptReadStatus, SuggestPromptConfigInput } from './use-suggest-prompt-config.js'

type PromptT = (key: GitKey, params?: Record<string, string | number>) => string

function PromptText({ label, text, t }: { readonly label: string; readonly text: string; readonly t: PromptT }): JSX.Element {
  const { feedback, copy } = useCopyFeedback(text)
  return h('div', { className: 'gp-cfg__prompt-text' }, [
    h('div', { key: 'head', className: 'gp-cfg__prompt-head' }, [
      h('h4', { key: 'label', className: 'gp-cfg__prompt-label' }, label),
      h('button', { key: 'copy', type: 'button', className: 'gp-cfg__prompt-button', onClick: () => { copy() } }, t('cfg.suggestPromptCopy')),
    ]),
    h('pre', { key: 'text', className: 'gp-cfg__prompt-original', tabIndex: 0, 'aria-label': label }, text),
    feedback !== 'idle' ? h('p', { key: 'feedback', className: feedback === 'error' ? 'gp-cfg__err' : 'gp-cfg__hint', role: 'status' }, t(feedback === 'copied' ? 'cfg.suggestPromptCopied' : 'cfg.suggestPromptCopyFailed')) : null,
  ])
}

function PromptVariants({ value, both, t }: { readonly value: GitSuggestPromptPreview; readonly both: boolean; readonly t: PromptT }): JSX.Element {
  const [picked, setPicked] = useState<ResolvedLanguage>('zh')
  const language = both || value.languageSetting === 'auto' ? picked : value.languageSetting
  const variant = value.variants[language]
  return h('div', { className: 'gp-cfg__prompt-variants' }, [
    h('p', { key: 'source', className: 'gp-cfg__hint' }, t(value.source === 'custom' ? 'cfg.suggestPromptSourceCustom' : 'cfg.suggestPromptSourceDefault')),
    both || value.languageSetting === 'auto'
      ? h('div', { key: 'languages', className: 'gp-seg gp-cfg__seg', role: 'group', 'aria-label': t('cfg.suggestLangLabel') },
        segButtons<ResolvedLanguage>(['zh', 'en'], language, setPicked, (v) => t(v === 'zh' ? 'cfg.suggestLangZh' : 'cfg.suggestLangEn'), false))
      : h('p', { key: 'language', className: 'gp-cfg__hint' }, t(language === 'zh' ? 'cfg.suggestLangZh' : 'cfg.suggestLangEn')),
    h(PromptText, { key: 'system', label: t('cfg.suggestPromptSystem'), text: variant.system, t }),
    h(PromptText, { key: 'reminder', label: t('cfg.suggestPromptUserReminder'), text: variant.userReminder, t }),
  ])
}

function PromptRead({ value, status, retry, saved, both, t }: {
  readonly value: GitSuggestPromptPreview | null
  readonly status: PromptReadStatus
  readonly retry: () => void
  readonly saved: boolean
  readonly both: boolean
  readonly t: PromptT
}): JSX.Element {
  const failed = status === 'failed' || status === 'invalid' || status === 'sync'
  return h('div', { className: 'gp-cfg__prompt-read', 'aria-busy': status === 'loading' }, [
    status === 'loading' ? h('div', { key: 'loading', className: 'gp-cfg__prompt-loading', role: 'status' }, [
      h(StateDot, { key: 'dot', state: 'ongoing', size: 16 }),
      h('span', { key: 'label' }, t('common.loading')),
    ]) : null,
    failed ? h('div', { key: 'error', className: 'gp-cfg__prompt-error', role: 'alert' }, [
      saved ? h('p', { key: 'saved', className: 'gp-cfg__err' }, t('cfg.suggestPromptSavedPreviewFailed')) : null,
      h('p', { key: 'detail', className: 'gp-cfg__err' }, t(status === 'invalid' ? 'cfg.suggestPromptPreviewInvalid' : status === 'sync' ? 'cfg.suggestPromptPreviewSync' : 'cfg.suggestPromptPreviewFailed')),
      h('button', { key: 'retry', type: 'button', className: 'gp-cfg__prompt-button', onClick: retry }, t('cfg.suggestPromptRetry')),
    ]) : null,
    value !== null ? h(PromptVariants, { key: 'value', value, both, t }) : null,
  ])
}

/** Explicit-save draft state and on-demand read-only prompt transparency. */
export function SuggestPromptConfig(props: SuggestPromptConfigInput & { readonly t: PromptT }): JSX.Element {
  const { t } = props
  const state = useSuggestPromptConfig(props)
  const id = useId()
  const defaultButton = useRef<HTMLButtonElement | null>(null)
  const effectiveButton = useRef<HTMLButtonElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const footerClose = useRef<HTMLButtonElement | null>(null)
  const { editor } = state
  const editDisabled = !state.writable || props.disabled || editor.saving
  const openPreview = (view: GitSuggestPromptView, reread = false): void => {
    restoreFocusRef.current = view === 'default' ? defaultButton.current : effectiveButton.current
    // A save may finish after the user opens a reader. Keep its focus inside the
    // current shell; only a first open focuses the stable external return target.
    ;(footerClose.current ?? restoreFocusRef.current)?.focus()
    if (view === 'default') state.openDefault()
    else if (reread) state.effective.retry()
    else state.openEffective()
  }
  const save = async (): Promise<void> => {
    if (await state.save()) openPreview('effective')
  }
  return h('div', { className: 'gp-cfg__field gp-cfg__prompt' }, [
    h('div', { key: 'title', className: 'gp-cfg__prompt-head' }, [
      h('h3', { key: 'label', className: 'gp-cfg__title' }, h('label', { htmlFor: `${id}-draft` }, t('cfg.suggestPromptTitle'))),
      h('button', { key: 'default', ref: defaultButton, type: 'button', className: 'gp-cfg__prompt-button gp-cfg__prompt-default', 'aria-haspopup': 'dialog', onClick: () => { openPreview('default') } }, t('cfg.suggestPromptDefault')),
    ]),
    h('p', { key: 'hint', id: `${id}-hint`, className: 'gp-cfg__hint' }, t('cfg.suggestPromptHint')),
    h('textarea', {
      key: 'draft', id: `${id}-draft`, className: 'gp-cfg__prompt-input', rows: 6,
      value: editor.draft, placeholder: t('cfg.suggestPromptPlaceholder'), disabled: editDisabled,
      'aria-describedby': `${id}-hint ${id}-bytes`, 'aria-invalid': state.overLimit || undefined,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { state.edit(event.currentTarget.value) },
    }),
    h('div', { key: 'actions', className: 'gp-cfg__prompt-actions' }, [
      h('button', { key: 'save', type: 'button', className: 'gp-cfg__prompt-button gp-cfg__prompt-save', disabled: !state.canSave, onClick: () => { void save() } }, [
        editor.saving ? h(StateDot, { key: 'dot', state: 'ongoing', size: 14 }) : null,
        t('cfg.suggestPromptSave'),
      ]),
      h('button', { key: 'clear', type: 'button', className: 'gp-cfg__prompt-button gp-cfg__prompt-clear', disabled: editDisabled || editor.draft === '', onClick: () => { state.edit('') } }, t('cfg.suggestPromptClear')),
      h('span', { key: 'bytes', id: `${id}-bytes`, className: 'gp-cfg__rangehint gp-cfg__prompt-bytes' }, t('cfg.suggestPromptBytes', { bytes: state.bytes, max: SUGGEST_PROMPT_MAX_BYTES })),
    ]),
    state.overLimit ? h('p', { key: 'limit', className: 'gp-cfg__err', role: 'alert' }, t('cfg.suggestPromptTooLong')) : null,
    !state.supported ? h('p', { key: 'unsupported', className: 'gp-cfg__hint' }, t('cfg.suggestPromptUnsupported'))
      : !state.writable ? h('p', { key: 'readonly', className: 'gp-cfg__hint' }, t('cfg.suggestPromptReadOnly')) : null,
    editor.saved === null ? h('p', { key: 'invalid', className: 'gp-cfg__err' }, t('cfg.suggestPromptInvalidConfig')) : null,
    editor.result === 'failed' ? h('p', { key: 'failed', className: 'gp-cfg__err', role: 'alert' }, t('cfg.saveFailed')) : null,
    editor.result === 'saved' ? h('p', { key: 'saved', className: 'gp-cfg__hint', role: 'status' }, t('cfg.suggestPromptSaved')) : null,
    state.dirty ? h('p', { key: 'dirty', className: 'gp-cfg__hint' }, t('cfg.suggestPromptDirty')) : null,
    editor.conflict || state.syncPending ? h('div', { key: 'conflict', className: 'gp-cfg__prompt-error', role: 'status' }, [
      h('p', { key: 'hint', className: 'gp-cfg__hint' }, t(editor.conflict ? 'cfg.suggestPromptConflict' : 'cfg.suggestPromptSyncMirror')),
      h('button', { key: 'reload', type: 'button', className: 'gp-cfg__prompt-button gp-cfg__prompt-reload', disabled: editor.saving, onClick: state.reload }, t('cfg.suggestPromptReload')),
      state.syncPending ? h('button', { key: 'retry', type: 'button', className: 'gp-cfg__prompt-button', onClick: () => { openPreview('effective', true) } }, t('cfg.suggestPromptRetry')) : null,
    ]) : null,
    h('button', {
      key: 'effective', ref: effectiveButton, type: 'button', className: 'gp-cfg__prompt-button gp-cfg__prompt-effective',
      'aria-haspopup': 'dialog', onClick: () => { openPreview('effective') },
    }, t('cfg.suggestPromptEffective')),
    props.visible && state.previewView !== null ? renderModalShell({
      title: t(state.previewView === 'default' ? 'cfg.suggestPromptDefaultTitle' : 'cfg.suggestPromptPreview'),
      onClose: state.closePreview, portalKey: 'suggest-prompt-preview',
      variant: `gp-cfg__prompt-modal gp-cfg__prompt-modal--${state.previewView}`, trapFocus: true, restoreFocusRef, t,
      body: [
        h('p', { key: 'hint', className: 'gp-cfg__hint' }, t('cfg.suggestPromptPreviewHint')),
        state.previewView === 'effective' && state.dirty ? h('p', { key: 'dirty', className: 'gp-cfg__hint' }, t('cfg.suggestPromptDirty')) : null,
        h(PromptRead, { key: state.previewView, ...(state.previewView === 'default' ? state.defaults : state.effective), saved: state.previewView === 'effective' && editor.result === 'saved', both: state.previewView === 'default', t }),
      ],
      footer: h('div', { className: 'gp-modal__footer' }, h('button', { ref: footerClose, type: 'button', className: 'gp-btn', onClick: state.closePreview }, t('common.close'))),
    }) : null,
  ])
}
