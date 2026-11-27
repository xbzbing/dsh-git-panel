import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { resyncAfterWrite } from './config-write.js'
import { gitPanelRemoteOf } from './rpc.js'
import type { ClientCtx, ConfigFormFace, ConfigFormSnapshot, GitPanelRemote } from './rpc.js'
import type { GitSuggestPromptPreview, GitSuggestPromptView } from './types.js'
import { SUGGEST_PROMPT_MAX_BYTES } from './types.js'
import {
  normalizePrompt, parsePromptPreview, promptEditorDirty, promptEditorInitial, promptEditorReduce,
  promptUtf8Bytes, samePromptIdentity, savedPrompt, savedPromptLanguage, supportsSuggestPrompt,
} from './suggest-prompt-config.js'
import type { PromptIdentity } from './suggest-prompt-config.js'

export type PromptReadStatus = 'idle' | 'loading' | 'ready' | 'failed' | 'invalid' | 'sync'

/** On-demand query, with at most two re-reads while volatile config propagates. */
export function usePromptPreview(remote: GitPanelRemote, view: GitSuggestPromptView, active: boolean, expected: PromptIdentity | null) {
  const [value, setValue] = useState<GitSuggestPromptPreview | null>(null)
  const [status, setStatus] = useState<PromptReadStatus>('idle')
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const latest = useRef({ remote, view, active, expected, retry })
  latest.current = { remote, view, active, expected, retry }
  const prompt = expected?.configuredPrompt
  const language = expected?.languageSetting

  useEffect(() => {
    const seq = ++generation.current
    if (!active) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const current = (): boolean => {
      const now = latest.current
      return seq === generation.current && !controller.signal.aborted && now.active && now.remote === remote
        && now.view === view && now.retry === retry && now.expected?.configuredPrompt === prompt && now.expected?.languageSetting === language
    }
    const run = async (attempt: number): Promise<void> => {
      if (!current()) return
      setStatus('loading')
      try {
        const response = await remote.query({ sessionId: '', query: { kind: 'suggest-prompt', view } }, controller.signal)
        if (!current()) return
        const preview = parsePromptPreview(response, view)
        if (preview === null) {
          setStatus(response !== null && typeof response === 'object' && response.ok === false ? 'failed' : 'invalid')
          return
        }
        const expectedIdentity = prompt === undefined || language === undefined ? null : { configuredPrompt: prompt, languageSetting: language }
        if (view === 'effective' && (expectedIdentity === null || !samePromptIdentity(preview, expectedIdentity))) {
          if (attempt < 2) timer = setTimeout(() => { void run(attempt + 1) }, attempt === 0 ? 250 : 650)
          else setStatus('sync')
          return
        }
        setValue(preview)
        setStatus('ready')
      } catch {
        if (current()) setStatus('failed')
      }
    }
    void run(0)
    return () => {
      controller.abort()
      if (timer !== undefined) clearTimeout(timer)
    }
    // The two scalar identity fields define the query; a new object is not a new config.
  }, [remote, view, active, prompt, language, retry])

  const matching = value !== null && (view === 'default' || (expected !== null && samePromptIdentity(value, expected)))
  return { value: matching ? value : null, status, retry: (): void => { setRetry((n) => n + 1) } }
}

export interface SuggestPromptConfigInput {
  readonly ctx: ClientCtx
  readonly form: ConfigFormFace | undefined
  readonly snapshot: ConfigFormSnapshot | undefined
  readonly schema: unknown
  readonly visible: boolean
  readonly disabled: boolean
}

export function useSuggestPromptConfig({ ctx, form, snapshot, schema, visible, disabled }: SuggestPromptConfigInput) {
  const mirrorPrompt = savedPrompt(snapshot?.value?.suggestPrompt)
  const language = savedPromptLanguage(snapshot?.value?.suggestLanguage)
  const [storedEditor, dispatch] = useReducer(promptEditorReduce, mirrorPrompt, promptEditorInitial)
  const owner = useRef(form)
  const bound = owner.current === form
  const editor = bound ? storedEditor : promptEditorInitial(mirrorPrompt)
  const [expanded, setExpanded] = useState(false)
  const [defaultOpen, setDefaultOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [syncPending, setSyncPending] = useState(false)
  const lifetime = useRef({ generation: 0 }).current
  const saving = useRef(false)
  const latest = useRef({ form, snapshot, schema, disabled, mirrorPrompt })
  latest.current = { form, snapshot, schema, disabled, mirrorPrompt }
  const supported = supportsSuggestPrompt(schema)
  const writable = supported && snapshot?.status === 'ready' && snapshot.writable === true && form !== undefined
  const bytes = promptUtf8Bytes(editor.draft)
  const dirty = promptEditorDirty(editor)
  const overLimit = promptUtf8Bytes(normalizePrompt(editor.draft)) > SUGGEST_PROMPT_MAX_BYTES
  const canSave = bound && writable && !disabled && !editor.saving && editor.pending === null && !editor.conflict && dirty && !overLimit
  const remote = gitPanelRemoteOf(ctx)
  const identity: PromptIdentity | null = editor.saved === null ? null : { configuredPrompt: editor.saved, languageSetting: language }
  const effective = usePromptPreview(remote, 'effective', bound && visible && expanded, identity)
  const defaults = usePromptPreview(remote, 'default', bound && visible && defaultOpen, null)

  useEffect(() => {
    dispatch({ type: 'mirror', value: mirrorPrompt })
  }, [mirrorPrompt, editor.saving])

  useEffect(() => {
    ++lifetime.generation
    owner.current = form
    saving.current = false
    dispatch({ type: 'reload', value: latest.current.mirrorPrompt })
    setExpanded(false)
    setDefaultOpen(false)
    setSyncPending(false)
    return () => { ++lifetime.generation }
  }, [form, lifetime])

  // The accepted draft never falls back to a stale mirror. A bounded read makes
  // propagation trouble visible; only explicit reload abandons the accepted text.
  useEffect(() => {
    if (editor.pending === null || editor.saving) {
      setSyncPending(false)
      return
    }
    if (mirrorPrompt === editor.pending.target) return
    const timer = setTimeout(() => { setSyncPending(true) }, 1800)
    return () => { clearTimeout(timer) }
  }, [editor.pending, editor.saving, mirrorPrompt, refresh])

  const save = useCallback(async (): Promise<void> => {
    if (!canSave || saving.current) return
    const now = latest.current
    if (now.form !== form || !supportsSuggestPrompt(now.schema) || now.snapshot?.status !== 'ready' || now.snapshot.writable !== true || now.disabled) return
    if (now.mirrorPrompt !== editor.saved) {
      dispatch({ type: 'mirror', value: now.mirrorPrompt })
      return
    }
    saving.current = true
    const seq = lifetime.generation
    dispatch({ type: 'start' })
    try {
      const ok = await form!.set('suggestPrompt', normalizePrompt(editor.draft))
      if (seq !== lifetime.generation) return
      dispatch({ type: ok ? 'success' : 'failure' })
      if (ok) {
        resyncAfterWrite()
        setExpanded(true)
        // Also refresh when a successful save keeps the same identity (e.g. clearing whitespace).
        effective.retry()
        setRefresh((n) => n + 1)
      }
    } catch {
      if (seq === lifetime.generation) dispatch({ type: 'failure' })
    } finally {
      if (seq === lifetime.generation) saving.current = false
    }
  }, [canSave, form, editor.draft, editor.saved, effective, lifetime])

  const retryEffective = (): void => {
    setExpanded(true)
    effective.retry()
  }

  return {
    editor, bytes, overLimit, dirty, canSave, supported, writable, syncPending: bound && syncPending, expanded, defaultOpen,
    effective: { ...effective, retry: retryEffective }, defaults,
    edit: (text: string): void => { dispatch({ type: 'edit', text }) },
    reload: (): void => {
      dispatch({ type: 'reload', value: latest.current.mirrorPrompt })
      effective.retry()
    },
    toggleExpanded: (): void => { setExpanded((open) => !open) },
    openDefault: (): void => { setDefaultOpen(true) },
    closeDefault: (): void => { setDefaultOpen(false) },
    save,
  }
}
