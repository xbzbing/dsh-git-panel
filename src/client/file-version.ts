/**
 * The commit dialog's version read: the complete post-change body at the
 * diff's base, shared by the read-only file view and the "copy post-change
 * content" action.
 *
 * The read is on demand (opening the file view or pressing copy), one request
 * per open target. A target switch invalidates both the cached body and any
 * in-flight reply, so a late answer for the previous file cannot paint or
 * overwrite the next one.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { queryAs, type GitPanelRemote } from './rpc.js'
import type { GitQuery, GitQueryResult } from './types.js'
import { useCopyFeedback, type CopyFeedback } from './copy-feedback.js'
import type { GitKey } from './locales.js'

/** The version a diff's new side compares against. `rev` is the caller's
 * problem: a revision comparison's new side is the work tree. */
export interface FileVersionTarget {
  readonly path: string
  readonly base: 'worktree' | 'staged' | 'commit'
  readonly commit?: string
}

export type FileVersionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly content: string; readonly lines: number; readonly size: number }
  | { readonly kind: 'tooLarge'; readonly size?: number }
  | { readonly kind: 'binary'; readonly size?: number }
  | { readonly kind: 'absent' }
  | { readonly kind: 'error' }

export interface FileVersionControl {
  readonly state: FileVersionState
  /** Start (or retry) the read; the file view calls this when it opens. */
  readonly load: () => void
  /** Read if needed, then write the complete body to the clipboard. */
  readonly copy: () => void
  /** Copy request in flight (the view's own loading state is separate). */
  readonly busy: boolean
  readonly feedback: CopyFeedback
  /** Why the copy could not happen (a version state, not a clipboard error). */
  readonly failure: GitKey | null
}

function targetKey(target: FileVersionTarget | null): string | null {
  if (target === null) return null
  return `${target.base}\u0000${target.commit ?? ''}\u0000${target.path}`
}

function queryOf(target: FileVersionTarget): GitQuery {
  return target.base === 'commit'
    ? { kind: 'file-version', path: target.path, base: 'commit', commit: target.commit ?? '' }
    : { kind: 'file-version', path: target.path, base: target.base }
}

function stateOf(value: Extract<GitQueryResult, { kind: 'file-version' }>): FileVersionState {
  switch (value.variant) {
    case 'text':
      return { kind: 'ready', content: value.content ?? '', lines: value.lines ?? 0, size: value.size ?? 0 }
    case 'tooLarge':
      return { kind: 'tooLarge', ...(value.size !== undefined ? { size: value.size } : {}) }
    case 'binary':
      return { kind: 'binary', ...(value.size !== undefined ? { size: value.size } : {}) }
    case 'absent':
      return { kind: 'absent' }
  }
}

export function useFileVersion(
  remote: GitPanelRemote,
  sessionId: string,
  target: FileVersionTarget | null,
  active: boolean,
): FileVersionControl {
  const key = targetKey(target)
  const [state, setState] = useState<FileVersionState>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<GitKey | null>(null)
  const { feedback, copy: writeClipboard } = useCopyFeedback(target?.path ?? null)

  // The request/reply pair is keyed by the target, not by the state object:
  // a re-render while the same file is open must not start a second read.
  const targetRef = useRef(target)
  targetRef.current = target
  const keyRef = useRef(key)
  keyRef.current = key
  const cache = useRef<{ key: string; state: FileVersionState } | null>(null)
  const inflight = useRef<{ key: string; promise: Promise<FileVersionState> } | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    cache.current = null
    inflight.current = null
    setState({ kind: 'idle' })
    setBusy(false)
    setFailure(null)
  }, [key])

  const ensure = useCallback(async (): Promise<FileVersionState | null> => {
    const current = targetRef.current
    const currentKey = keyRef.current
    if (current === null || currentKey === null) return null
    const cached = cache.current
    if (cached !== null && cached.key === currentKey) return cached.state
    const running = inflight.current
    if (running !== null && running.key === currentKey) return running.promise
    const my = generation.current
    setState({ kind: 'loading' })
    const promise = remote.query({ sessionId, query: queryOf(current) }).then((res) => {
      const version = queryAs(res, 'file-version')
      const next = version === null ? ({ kind: 'error' } as const) : stateOf(version)
      // A reply for a target that has since changed is dropped: caching it
      // would let the next open of that path show a stale body. An error is not
      // cached, so pressing copy again actually retries the read.
      if (my === generation.current && currentKey === keyRef.current) {
        if (version !== null) cache.current = { key: currentKey, state: next }
        setState(next)
      }
      return next
    }).catch(() => {
      const next = { kind: 'error' } as const
      if (my === generation.current && currentKey === keyRef.current) setState(next)
      return next
    }).finally(() => {
      if (inflight.current !== null && inflight.current.key === currentKey) inflight.current = null
    })
    inflight.current = { key: currentKey, promise }
    return promise
  }, [remote, sessionId])

  const load = useCallback((): void => {
    if (keyRef.current === null) return
    if (state.kind === 'error') {
      cache.current = null
      inflight.current = null
    }
    void ensure()
  }, [ensure, state.kind])

  useEffect(() => {
    if (active) load()
    // `ensure` returns the cached state, so re-entering the file view does not
    // refetch. `state.kind` only decides whether an error drops that cache;
    // depending on it here would refire the effect on every state transition.
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
