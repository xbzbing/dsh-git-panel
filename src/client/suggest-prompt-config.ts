import type { GitSuggestPromptPreview, GitSuggestPromptView, SuggestLanguage } from './types.js'
import { SUGGEST_PROMPT_MAX_BYTES, SUGGEST_PROMPT_PREVIEW_MAX_BYTES } from './types.js'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Exact field declaration, either a direct schema or settings' serialized graph.
 * Only the root and this field are read; hydration could execute schema callbacks. */
export function supportsSuggestPrompt(schema: unknown): boolean {
  if (!record(schema)) return false
  if (record(schema.dict)) return Object.hasOwn(schema.dict, 'suggestPrompt')
  const uid = schema.uid
  const refs = schema.refs
  if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid < 0 || !record(refs) || !Object.hasOwn(refs, uid)) return false
  const root = refs[uid]
  if (!record(root) || root.type !== 'object' || !record(root.dict) || !Object.hasOwn(root.dict, 'suggestPrompt')) return false
  const field = root.dict.suggestPrompt
  return typeof field === 'number' && Number.isSafeInteger(field) && field >= 0 && Object.hasOwn(refs, field) && record(refs[field])
}

/** TextEncoder replaces isolated surrogates with U+FFFD; the fallback does too. */
export function promptUtf8Bytes(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength
  let bytes = 0
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4
  }
  return bytes
}

export function normalizePrompt(text: string): string {
  return text.trim() === '' ? '' : text
}

/** Missing is the host default; malformed configured values remain unknown. */
export function savedPrompt(value: unknown): string | null {
  if (value === undefined) return ''
  if (typeof value !== 'string') return null
  const normalized = normalizePrompt(value)
  return promptUtf8Bytes(normalized) <= SUGGEST_PROMPT_MAX_BYTES ? normalized : null
}

export function savedPromptLanguage(value: unknown): SuggestLanguage {
  return value === 'zh' || value === 'en' ? value : 'auto'
}

export interface PromptIdentity {
  readonly configuredPrompt: string
  readonly languageSetting: SuggestLanguage
}

export function samePromptIdentity(preview: PromptIdentity, expected: PromptIdentity): boolean {
  return preview.configuredPrompt === expected.configuredPrompt && preview.languageSetting === expected.languageSetting
}

export type PromptPreviewErrorStatus = 'config-invalid' | 'failed' | 'invalid'

/** Business rejection is distinct from malformed wire data and transport failure. */
export function promptPreviewErrorStatus(response: unknown, view: GitSuggestPromptView): PromptPreviewErrorStatus {
  if (!record(response) || response.ok !== false) return 'invalid'
  return view === 'effective' && record(response.error) && response.error.code === 'suggest-prompt-invalid' ? 'config-invalid' : 'failed'
}

/** Both variants are checked, even when a fixed language renders only one. */
export function parsePromptPreview(response: unknown, view: GitSuggestPromptView): GitSuggestPromptPreview | null {
  if (!record(response) || response.ok !== true || !record(response.value)) return null
  const value = response.value
  if (value.kind !== 'suggest-prompt' || value.view !== view) return null
  if (value.languageSetting !== 'auto' && value.languageSetting !== 'zh' && value.languageSetting !== 'en') return null
  if (typeof value.configuredPrompt !== 'string' || savedPrompt(value.configuredPrompt) !== value.configuredPrompt) return null
  if (value.source !== (value.configuredPrompt === '' ? 'default' : 'custom')) return null
  if (view === 'default' && (value.configuredPrompt !== '' || value.source !== 'default')) return null
  if (!record(value.variants)) return null
  for (const language of ['zh', 'en']) {
    const variant = value.variants[language]
    if (!record(variant)) return null
    for (const field of ['system', 'userReminder']) {
      const text = variant[field]
      // Includes the bounded custom rules plus the host-owned task/language wrapper.
      if (typeof text !== 'string' || text.length === 0 || promptUtf8Bytes(text) > SUGGEST_PROMPT_PREVIEW_MAX_BYTES) return null
    }
  }
  return value as unknown as GitSuggestPromptPreview
}

export interface PromptEditorState {
  readonly draft: string
  readonly saved: string | null
  readonly conflict: boolean
  readonly saving: boolean
  readonly pending: { readonly before: string | null; readonly target: string } | null
  readonly result: 'idle' | 'saved' | 'failed'
}

export type PromptEditorAction =
  | { readonly type: 'mirror'; readonly value: string | null }
  | { readonly type: 'edit'; readonly text: string }
  | { readonly type: 'start' }
  | { readonly type: 'success' }
  | { readonly type: 'failure' }
  | { readonly type: 'reload'; readonly value: string | null }

export function promptEditorInitial(value: string | null): PromptEditorState {
  return { draft: value ?? '', saved: value, conflict: false, saving: false, pending: null, result: 'idle' }
}

export function promptEditorDirty(state: PromptEditorState): boolean {
  return normalizePrompt(state.draft) !== state.saved
}

/** A successful write holds its captured text until the settings mirror catches up. */
export function promptEditorReduce(state: PromptEditorState, action: PromptEditorAction): PromptEditorState {
  switch (action.type) {
    case 'edit': return { ...state, draft: action.text, result: 'idle' }
    case 'reload': return promptEditorInitial(action.value)
    case 'start': return { ...state, saving: true, result: 'idle', pending: { before: state.saved, target: normalizePrompt(state.draft) } }
    case 'success': {
      if (state.pending === null) return { ...state, saving: false, result: 'saved' }
      const target = state.pending.target
      if (state.conflict) return { ...state, saving: false, draft: target, pending: null, result: 'saved' }
      return { ...state, saving: false, saved: target, draft: target, result: 'saved' }
    }
    case 'failure': return { ...state, saving: false, pending: null, result: 'failed' }
    case 'mirror': {
      if (state.pending !== null) {
        if (action.value === state.pending.target) {
          return { ...state, saved: action.value, pending: state.saving ? state.pending : null }
        }
        if (action.value === state.pending.before) return state
        return { ...state, saved: action.value, conflict: true, pending: state.saving ? state.pending : null }
      }
      if (action.value === state.saved) return state
      if (promptEditorDirty(state) || state.saving) return { ...state, saved: action.value, conflict: true }
      return promptEditorInitial(action.value)
    }
  }
}
