/**
 * The React half of the commit dialog's version read: one target at a time,
 * loaded when the file view opens or when copy needs a body.
 *
 * State is stored with the key it belongs to and derived on render, so a target
 * switch can never paint the previous file's body for a frame (the same pattern
 * as `copy-feedback.ts`). The pipeline in `file-version.ts` drops replies for a
 * target the view has moved past, so a late answer neither paints nor is cached.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { queryAs, type GitPanelRemote } from './rpc.js'
import { useCopyFeedback, type CopyFeedback } from './copy-feedback.js'
import type { GitKey } from './locales.js'
import {
  createVersionReads, FILE_VERSION_IDLE, fileVersionKey, fileVersionQuery, fileVersionStateOf,
  type FileVersionState, type FileVersionTarget,
} from './file-version.js'

export type { FileVersionControl, FileVersionState, FileVersionTarget } from './file-version.js'
export { fileVersionKey } from './file-version.js'

export function useFileVersion(
  remote: GitPanelRemote,
  sessionId: string,
  target: FileVersionTarget | null,
  active: boolean,
): {
  readonly state: FileVersionState
  readonly load: () => void
  readonly copy: () => void
  readonly busy: boolean
  readonly feedback: CopyFeedback
  readonly failure: GitKey | null
} {
  const key = fileVersionKey(target)
  const [slot, setSlot] = useState<{ readonly key: string | null; readonly value: FileVersionState }>({ key: null, value: FILE_VERSION_IDLE })
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<GitKey | null>(null)
  const { feedback, copy: writeClipboard } = useCopyFeedback(target?.path ?? null)
  // Another target's state is not this target's state, whatever the stored slot
  // still holds between the switch and the next reply.
  const state = slot.key === key ? slot.value : FILE_VERSION_IDLE

  const targetRef = useRef(target)
  targetRef.current = target
  const keyRef = useRef(key)
  keyRef.current = key
  const reads = useRef(createVersionReads())
  const stateKindRef = useRef(state.kind)
  stateKindRef.current = state.kind

  useEffect(() => {
    reads.current.invalidate()
    setBusy(false)
    setFailure(null)
  }, [key])

  const ensure = useCallback(async (): Promise<FileVersionState | null> => {
    const current = targetRef.current
    const currentKey = keyRef.current
    if (current === null || currentKey === null) return null
    return reads.current.read(
      currentKey,
      () => remote.query({ sessionId, query: fileVersionQuery(current) }).then((res) => {
        const version = queryAs(res, 'file-version')
        return version === null ? ({ kind: 'error' } as const) : fileVersionStateOf(version)
      }),
      (state) => setSlot({ key: currentKey, value: state }),
    )
  }, [remote, sessionId])

  const load = useCallback((): void => {
    if (keyRef.current === null) return
    if (stateKindRef.current === 'error') reads.current.invalidate()
    void ensure()
  }, [ensure])

  useEffect(() => {
    if (active) load()
    // `read` returns the cached state, so re-entering the file view does not
    // refetch; `load` reaches the live pipeline through refs, so it never needs
    // to re-run this effect on a state transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key])

  const copy = useCallback((): void => {
    if (targetRef.current === null || busy) return
    const myKey = keyRef.current
    setBusy(true)
    setFailure(null)
    void ensure().then((result) => {
      if (myKey === null || myKey !== keyRef.current) return
      if (result === null) return
      if (result.kind === 'ready') {
        writeClipboard(result.content)
        return
      }
      if (result.kind === 'tooLarge') setFailure('diff.versionTooLarge')
      else if (result.kind === 'binary') setFailure('diff.versionBinary')
      else if (result.kind === 'absent') setFailure('diff.versionAbsent')
      else setFailure('files.loadFailed')
    }).finally(() => setBusy(false))
  }, [busy, ensure, writeClipboard])

  return { state, load, copy, busy, feedback, failure }
}
