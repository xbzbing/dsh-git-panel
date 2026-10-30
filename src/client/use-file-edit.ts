/**
 * Edit state of the file browser: entering and leaving edit mode, the
 * compare-and-swap save with its pre-save syntax check, the conflict and
 * failure notices, and the unsaved-change guards.
 *
 * A draft is bound to the remote face and root selector that were current
 * when editing started, so a save always lands in the browse root the file
 * was read from, even if the browser has moved on since (the draft is then
 * "detached" and says so).
 *
 * One save runs at a time per draft. Leaving while it is in flight waits for
 * its answer: a landed save leaves at once, a failed one asks first. Each
 * mount registers in the edit store (`edit-store.ts`), which the panel asks
 * before a repository switch moves the browser and which arms the
 * `beforeunload` prompt.
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitPanelRemote } from './rpc.js'
import { queryAs } from './rpc.js'
import type { GitQueryResult } from './types.js'
import type { GitKey } from './locales.js'
import type { FileState } from './files-preview.js'
import { checkJson, checkXml, checkedLanguageFor, editAvailability, editBlockKey, editorLanguageFor, inferIndentUnit, toEditBuffer, type EditAvailability } from './edit-buffer.js'
import { editorChunkIfLoaded, FileEditor, loadEditorChunk, type EditorChunk, type EditorHandle } from './FileEditor.js'
import { opErrorText, renderConfirmModal } from './ops-modals.js'
import { newDraftId, registerEditMount, takeStashedDraft, type EditDraft, type EditMount } from './edit-store.js'
import { renderDetachedNote, renderEditNotice, type EditNotice } from './edit-notice.js'
import { useCopyFeedback } from './copy-feedback.js'

type T = (key: GitKey, params?: Record<string, string | number>) => string

type EditConfirm =
  | { readonly kind: 'discard'; readonly proceed: () => void }
  | { readonly kind: 'reload' }
  | { readonly kind: 'overwrite'; readonly currentSha256: string }

export interface FileEditApi {
  readonly availability: EditAvailability
  /** Non-null while editing. */
  readonly draft: EditDraft | null
  readonly dirty: boolean
  readonly saving: boolean
  readonly starting: boolean
  /** The browser has moved to another root since the draft was read. */
  readonly detached: boolean
  start(): void
  cancel(): void
  save(): void
  /** Run `proceed` once the current draft may be left: at once when nothing
   * is unsaved (leaving edit mode first), after a confirmation otherwise, and
   * after the answer when a save is in flight. */
  guard(proceed: () => void): void
  /** Leave edit mode without asking (the file under it is gone). */
  drop(): void
  /** The draft with the editor's current text, for the session stash. */
  snapshot(): EditDraft | null
  /** The editor's current text (the Markdown draft preview). */
  currentText(): string
  editorNode(wrap: boolean, hidden: boolean): JSX.Element | null
  noticeNode: JSX.Element[]
  /** The confirmation dialog, portaled into `container` (the reader card in
   * browser fullscreen) or document.body. */
  confirmNode(container: Element | null): JSX.Element | null
}

export function useFileEdit(options: {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly file: FileState
  /** The browser's current root selector and its absolute path. */
  readonly rootKey: string
  readonly rootPath: string | null
  /** The host's edit switch (false hides the entry). */
  readonly allowEdit: boolean
  /** The selection the browser restored at mount: a draft parked in the
   * stash comes back only into the selection it was made on (otherwise it
   * was a clean one whose browser state expired, and it is dropped). */
  readonly restoreSelected: string | null
  /** A save landed for the draft on screen: the file-content view of the
   * bytes now on disk. */
  readonly onSaved: (value: Extract<GitQueryResult, { kind: 'file-content' }>) => void
  /** Any save landed, including one whose draft was left meanwhile. */
  readonly onWritten: () => void
  /** A detached draft ended (saved or discarded): the selection under it
   * belongs to the root the browser left. */
  readonly onDetachedEnd: () => void
  readonly t: T
}): FileEditApi {
  const { sessionId, file, t } = options
  const restored = useRef<EditDraft | null | undefined>(undefined)
  if (restored.current === undefined) {
    const parked = takeStashedDraft(sessionId)
    restored.current = parked !== null && parked.path === options.restoreSelected ? parked : null
  }
  const [draft, setDraft] = useState<EditDraft | null>(restored.current)
  const [dirty, setDirty] = useState(restored.current?.dirty === true)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [chunk, setChunk] = useState<EditorChunk | null>(() => editorChunkIfLoaded())
  const [notice, setNotice] = useState<EditNotice | null>(null)
  const [confirm, setConfirm] = useState<EditConfirm | null>(null)
  const handleRef = useRef<EditorHandle | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  // Synchronous twin of `saving`: two clicks in one frame must not send two
  // writes, and a leave asked mid-save is parked here until the answer.
  const savingRef = useRef(false)
  const afterSaveRef = useRef<(() => void) | null>(null)
  const live = useRef(options)
  useLayoutEffect(() => { live.current = options })
  const copy = useCopyFeedback(draft?.path ?? null)

  // A restored draft needs the chunk again after a reload of the panel bundle.
  useEffect(() => {
    if (draft === null || chunk !== null) return
    let alive = true
    loadEditorChunk().then((loaded) => { if (alive) setChunk(loaded) }, () => { if (alive) setNotice({ kind: 'chunk-failed' }) })
    return () => { alive = false }
  }, [draft, chunk])

  const leave = useCallback(() => {
    handleRef.current = null
    afterSaveRef.current = null
    setDraft(null)
    setDirty(false)
    setNotice(null)
    setConfirm(null)
  }, [])
  const leaveRef = useRef(leave)
  leaveRef.current = leave

  const mountRef = useRef<EditMount | null>(null)
  useEffect(() => {
    const mount = registerEditMount(sessionId, () => leaveRef.current())
    mountRef.current = mount
    mount.setDirty(dirtyRef.current)
    return () => {
      mount.release()
      if (mountRef.current === mount) mountRef.current = null
    }
  }, [sessionId])
  useEffect(() => { mountRef.current?.setDirty(dirty) }, [dirty])

  const detached = draft !== null && draft.rootKey !== options.rootKey
  const wasDetached = useRef(detached)
  useEffect(() => {
    if (detached) { wasDetached.current = true; return }
    if (!wasDetached.current) return
    wasDetached.current = false
    if (draft === null) live.current.onDetachedEnd()
  }, [detached, draft])

  // A refresh that reads another version of the file under the draft says so
  // before the save does: same notice, the draft untouched. A detached draft's
  // file is not the one the browser reads any more.
  const fileSha = file.kind === 'text' && draft !== null && !detached && file.path === draft.path ? file.sha256 : undefined
  useEffect(() => {
    const current = draftRef.current
    if (current === null || fileSha === undefined || fileSha === current.baseSha256) return
    setNotice((prev) => (prev?.kind === 'conflict' && prev.currentSha256 === fileSha ? prev : { kind: 'conflict', currentSha256: fileSha }))
  }, [fileSha])

  // Enter edit mode on the file that was on screen when the user asked; a
  // chunk that arrives after the selection moved only gets cached.
  const begin = useCallback((loaded: EditorChunk, path: string) => {
    setChunk(loaded)
    const current = live.current.file
    if (draftRef.current !== null || current.kind !== 'text' || current.path !== path) return
    if (current.edit === undefined || !current.edit.ok || current.sha256 === undefined) return
    const baseline = toEditBuffer(current.content)
    setNotice(null)
    setDraft({
      id: newDraftId(), path: current.path, remote: live.current.remote,
      rootKey: live.current.rootKey, rootPath: live.current.rootPath,
      baseSha256: current.sha256, baseline, eol: current.edit.eol, bom: current.edit.bom, text: baseline, dirty: false,
    })
    setDirty(false)
  }, [])

  const start = useCallback(() => {
    const target = live.current.file
    if (draftRef.current !== null || target.kind !== 'text') return
    const ready = editorChunkIfLoaded()
    if (ready !== null) { begin(ready, target.path); return }
    setStarting(true)
    loadEditorChunk().then((loaded) => {
      setStarting(false)
      begin(loaded, target.path)
    }, () => {
      setStarting(false)
      setNotice({ kind: 'chunk-failed' })
    })
  }, [begin])

  const currentText = useCallback((): string => handleRef.current?.getText() ?? draftRef.current?.text ?? '', [])

  const snapshot = useCallback((): EditDraft | null => {
    const current = draftRef.current
    if (current === null) return null
    const handle = handleRef.current
    return handle === null
      ? { ...current, dirty: dirtyRef.current }
      : { ...current, text: handle.getText(), selection: handle.getSelection(), dirty: dirtyRef.current }
  }, [])

  const guard = useCallback((proceed: () => void) => {
    if (draftRef.current === null) { proceed(); return }
    if (savingRef.current) { afterSaveRef.current = proceed; return }
    if (!dirtyRef.current) { leave(); proceed(); return }
    setConfirm({ kind: 'discard', proceed })
  }, [leave])

  const cancel = useCallback(() => { guard(() => undefined) }, [guard])

  const write = useCallback(async (base: string, skipCheck: boolean): Promise<void> => {
    const current = draftRef.current
    if (current === null || savingRef.current) return
    const text = currentText()
    if (!skipCheck) {
      const language = checkedLanguageFor(current.path)
      const issue = language === 'json' ? checkJson(text)
        : language === 'xml' ? checkXml(text, new DOMParser())
          : language === 'yaml' ? chunk?.validateYaml(text) ?? null
            : null
      if (language !== null && issue !== null) { setNotice({ kind: 'syntax', language, issue }); return }
    }
    savingRef.current = true
    setSaving(true)
    setNotice(null)
    let res: Awaited<ReturnType<GitPanelRemote['writeFile']>>
    try {
      res = await current.remote.writeFile({ sessionId, path: current.path, content: text, baseSha256: base })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
    const after = afterSaveRef.current
    afterSaveRef.current = null
    if (res.ok) live.current.onWritten()
    // The draft that sent this write was left meanwhile (dropped, discarded
    // from the panel, or replaced by a new edit of the same path).
    if (draftRef.current?.id !== current.id) { after?.(); return }
    if (res.ok) {
      leave()
      live.current.onSaved(res.value)
      after?.()
      return
    }
    const { code, reason } = res.error
    if (code === 'file-changed' && res.error.currentSha256 !== undefined) setNotice({ kind: 'conflict', currentSha256: res.error.currentSha256 })
    else if (code === 'file-not-found') setNotice({ kind: 'gone' })
    else if (code === 'edit-disabled') setNotice({ kind: 'disabled' })
    else if (code === 'not-editable' && reason !== undefined) setNotice({ kind: 'error', text: live.current.t(editBlockKey(reason)) })
    else setNotice({ kind: 'error', text: opErrorText(code, res.error.message, live.current.t) })
    // The save did not land, so the draft is still unsaved: the leave that
    // waited for it asks now.
    if (after !== null) setConfirm({ kind: 'discard', proceed: after })
  }, [chunk, currentText, leave, sessionId])

  const save = useCallback(() => {
    const current = draftRef.current
    if (current === null || !dirtyRef.current) return
    void write(current.baseSha256, false)
  }, [write])

  const reload = useCallback(async () => {
    const current = draftRef.current
    if (current === null || savingRef.current) return
    const res = await current.remote.query({ sessionId, query: { kind: 'file-content', path: current.path } })
    const fc = queryAs(res, 'file-content')
    if (draftRef.current?.id !== current.id) return
    if (fc === null || fc.content === undefined || fc.sha256 === undefined || fc.edit === undefined || !fc.edit.ok) {
      setNotice(res.ok || res.error.code !== 'file-not-found' ? { kind: 'error', text: t('files.editReloadFailed') } : { kind: 'gone' })
      return
    }
    const baseline = toEditBuffer(fc.content)
    setDraft({ ...current, baseSha256: fc.sha256, baseline, eol: fc.edit.eol, bom: fc.edit.bom, text: baseline, dirty: false })
    handleRef.current?.replaceAll(baseline, baseline)
    setNotice(null)
    // A detached draft's file is not on screen: the preview keeps the root
    // the browser shows.
    if (current.rootKey === live.current.rootKey) live.current.onSaved(fc)
  }, [sessionId, t])

  const copyText = copy.copy
  const copyDraft = useCallback(() => { copyText(currentText()) }, [copyText, currentText])

  const onDirty = useCallback((next: boolean) => setDirty(next), [])
  // Read at mount: a view rebuilt in the same commit that destroyed the
  // previous one (a layout tier switch) starts from the text that view had.
  const initial = useCallback(() => {
    const current = draftRef.current
    return { doc: current?.text ?? '', ...(current?.selection !== undefined ? { selection: current.selection } : {}) }
  }, [])
  const onUnmount = useCallback((text: string, selection: { anchor: number; head: number }) => {
    const current = draftRef.current
    if (current !== null) draftRef.current = { ...current, text, selection, dirty: dirtyRef.current }
    // Keep React's copy in step for a remount within this mount (a layout
    // tier switch); a leave() that already cleared the draft wins.
    setDraft((prev) => (prev === null ? prev : { ...prev, text, selection, dirty: dirtyRef.current }))
  }, [])

  const baseline = draft?.baseline
  const indentUnit = useMemo(() => (baseline === undefined ? '  ' : inferIndentUnit(baseline)), [baseline])

  const editorNode = (wrap: boolean, hidden: boolean): JSX.Element | null => {
    if (draft === null || chunk === null) return null
    return h(FileEditor, {
      key: `editor:${draft.id}`,
      chunk, path: draft.path,
      initial, baseline: draft.baseline,
      language: editorLanguageFor(draft.path),
      indentUnit,
      // Read-only while a save is in flight and while a dialog asks about
      // this draft: neither may race a keystroke into the buffer.
      wrap, readOnly: saving || confirm !== null, dirty, eol: draft.eol, bom: draft.bom, hidden,
      handleRef, onUnmount, onDirty, onSave: save, t,
    })
  }

  const noticeBar = renderEditNotice(notice, {
    t,
    close: () => setNotice(null),
    retryChunk: () => { setNotice(null); start() },
    saveAnyway: () => { const current = draftRef.current; if (current !== null) void write(current.baseSha256, true) },
    copy: copyDraft,
    copyFeedback: copy.feedback,
    reload: () => setConfirm({ kind: 'reload' }),
    overwrite: (currentSha256) => setConfirm({ kind: 'overwrite', currentSha256 }),
  })
  const noticeNode = [
    detached && draft !== null ? renderDetachedNote(draft.rootPath, draft.path, t) : null,
    noticeBar,
  ].filter((node): node is JSX.Element => node !== null)

  const confirmNode = (container: Element | null): JSX.Element | null => confirm === null ? null : renderConfirmModal({
    title: t(confirm.kind === 'discard' ? 'files.editDiscardTitle' : confirm.kind === 'reload' ? 'files.editReloadTitle' : 'files.editOverwriteTitle'),
    body: t(confirm.kind === 'discard' ? 'files.editDiscardBody' : confirm.kind === 'reload' ? 'files.editReloadBody' : 'files.editOverwriteBody'),
    confirmLabel: t(confirm.kind === 'discard' ? 'files.editDiscard' : confirm.kind === 'reload' ? 'files.editReload' : 'files.editOverwrite'),
    danger: true,
    error: null,
    container,
    // Raised over the editor (and over the reader dialog in fullscreen): it
    // takes focus and Escape so neither lower layer reacts to them.
    trapFocus: true,
    onClose: () => setConfirm(null),
    onConfirm: () => {
      setConfirm(null)
      if (confirm.kind === 'discard') { leave(); confirm.proceed() }
      else if (confirm.kind === 'reload') void reload()
      else void write(confirm.currentSha256, true)
    },
    t,
  })

  const availability = options.allowEdit ? editAvailability(file) : { state: 'hidden' as const }
  return {
    availability,
    draft, dirty, saving, starting, detached,
    start, cancel, save, guard, drop: leave, snapshot, currentText,
    editorNode, noticeNode, confirmNode,
  }
}
