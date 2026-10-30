/**
 * Module store of the file browser's edit drafts, shared by every mounted
 * Files tab and the panel around it.
 *
 * - Each mounted editor registers its own entry: one session can be on screen
 *   in two panels at once (the session tab and the sidebar), and each panel
 *   holds its own draft, so dirtiness is tracked per mount and a session is
 *   unsaved while any of its mounts or its stash is.
 * - A Files tab that unmounts parks its draft here (`stashDraft`) and the next
 *   mount for the session picks it up (`takeStashedDraft`). A parked unsaved
 *   draft counts as unsaved: it survives until a save, a confirmed discard or
 *   a page reload.
 * - A `beforeunload` prompt is armed while any draft anywhere is unsaved.
 */
import type { GitPanelRemote } from './rpc.js'

/** One file being edited. `text` / `selection` are refreshed from the editor
 * whenever the draft is stashed; the editor itself is the live copy. */
export interface EditDraft {
  /** Unique per started edit: a save's answer is applied only to the draft
   * that sent it, not to a later edit of the same path. */
  readonly id: number
  readonly path: string
  readonly remote: GitPanelRemote
  /** The file browser's root selector when the edit started; the draft keeps
   * writing there after the browser has moved to another root. */
  readonly rootKey: string
  /** That root's absolute path when known, for the "draft belongs elsewhere"
   * notice. */
  readonly rootPath: string | null
  readonly baseSha256: string
  /** LF buffer of the disk version the edit started from. */
  readonly baseline: string
  readonly eol: 'lf' | 'crlf'
  readonly bom: boolean
  readonly text: string
  readonly selection?: { readonly anchor: number; readonly head: number }
  readonly dirty: boolean
}

let nextDraftId = 1

/** A fresh draft id. */
export function newDraftId(): number {
  return nextDraftId++
}

interface Mount {
  readonly sessionId: string
  dirty: boolean
  readonly discard: () => void
}

const mounts = new Map<symbol, Mount>()
const stashed = new Map<string, EditDraft>()
let armed = false

function onBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault()
  event.returnValue = ''
}

function anyUnsaved(): boolean {
  for (const mount of mounts.values()) if (mount.dirty) return true
  for (const draft of stashed.values()) if (draft.dirty) return true
  return false
}

function syncUnloadPrompt(): void {
  if (typeof window === 'undefined') return
  const want = anyUnsaved()
  if (want === armed) return
  armed = want
  if (want) window.addEventListener('beforeunload', onBeforeUnload)
  else window.removeEventListener('beforeunload', onBeforeUnload)
}

/** A mounted editor's handle in the store. */
export interface EditMount {
  setDirty(dirty: boolean): void
  release(): void
}

/**
 * Register one mounted editor. `discard` drops that mount's draft without
 * asking (the panel already confirmed it).
 */
export function registerEditMount(sessionId: string, discard: () => void): EditMount {
  const token = Symbol('edit-mount')
  const mount: Mount = { sessionId, dirty: false, discard }
  mounts.set(token, mount)
  return {
    setDirty(dirty) {
      if (mount.dirty === dirty || !mounts.has(token)) return
      mount.dirty = dirty
      syncUnloadPrompt()
    },
    release() {
      if (!mounts.delete(token)) return
      syncUnloadPrompt()
    },
  }
}

/** Whether a session holds an edit draft that differs from the disk, in any
 * of its mounts or parked in its stash. */
export function hasUnsavedEdit(sessionId: string): boolean {
  for (const mount of mounts.values()) if (mount.sessionId === sessionId && mount.dirty) return true
  return stashed.get(sessionId)?.dirty === true
}

/** Whether the session's stash holds an unsaved draft (the rest of the parked
 * browser state is then kept for it, past its usual window). */
export function hasStashedUnsavedEdit(sessionId: string): boolean {
  return stashed.get(sessionId)?.dirty === true
}

/** Drop every draft of a session, mounted or parked (the user confirmed
 * leaving them). */
export function discardUnsavedEdit(sessionId: string): void {
  for (const mount of [...mounts.values()]) {
    if (mount.sessionId !== sessionId) continue
    mount.dirty = false
    mount.discard()
  }
  stashed.delete(sessionId)
  syncUnloadPrompt()
}

/**
 * Park an unmounting tab's draft. A clean or absent draft never replaces an
 * unsaved one already parked (the other panel of the same session left it
 * there).
 */
export function stashDraft(sessionId: string, draft: EditDraft | null): void {
  const parked = stashed.get(sessionId)
  if (draft === null || !draft.dirty) {
    if (parked === undefined || !parked.dirty) {
      if (draft === null) stashed.delete(sessionId)
      else stashed.set(sessionId, draft)
    }
  } else {
    stashed.set(sessionId, draft)
  }
  syncUnloadPrompt()
}

/** Hand a parked draft to the mount that restores the session; it leaves the
 * stash, so a second panel mounting next does not take the same draft. */
export function takeStashedDraft(sessionId: string): EditDraft | null {
  const draft = stashed.get(sessionId) ?? null
  if (draft !== null) {
    stashed.delete(sessionId)
    syncUnloadPrompt()
  }
  return draft
}

/** Test hook: forget every mount and parked draft. */
export function resetEditStore(): void {
  mounts.clear()
  stashed.clear()
  syncUnloadPrompt()
}
