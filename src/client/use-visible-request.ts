import { useCallback, useEffect, useRef } from 'react'
import { pageVisibility } from './visibility.js'
import type { QueryKey } from './query-key.js'

/** A visible query keeps its data while hidden; only matching responses may
 * publish. Failed loads remain eligible for the next tick/activation/retry.
 * `visible` carries the tab/snapshot gate; the live page check also covers the
 * interval before React renders a visibility change and asynchronous continuations. */
export function useVisibleRequest(
  queryKey: QueryKey,
  visible: boolean,
  load: (isCurrent: () => boolean, canContinue: () => boolean) => Promise<void>,
  onError: () => void,
): () => Promise<void> {
  const serializedKey = JSON.stringify(queryKey)
  const target = useRef({ key: serializedKey, visible, load, onError })
  target.current = { key: serializedKey, visible, load, onError }
  const alive = useRef(true)
  const sequence = useRef(0)
  const inflight = useRef<{ key: string; promise: Promise<void> } | null>(null)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; sequence.current += 1; inflight.current = null }
  }, [])

  const reload = useCallback((): Promise<void> => {
    const request = target.current
    if (!alive.current || !request.visible || !pageVisibility.isVisible()) return Promise.resolve()
    if (inflight.current?.key === request.key) return inflight.current.promise
    const seq = ++sequence.current
    const isCurrent = (): boolean => alive.current && seq === sequence.current && target.current.key === request.key
    const canContinue = (): boolean => isCurrent() && target.current.visible && pageVisibility.isVisible()
    const promise = request.load(isCurrent, canContinue)
      .catch(() => { if (isCurrent()) request.onError() })
      .finally(() => { if (inflight.current?.promise === promise) inflight.current = null })
    inflight.current = { key: request.key, promise }
    return promise
  }, [])

  useEffect(() => { if (visible) void reload() }, [serializedKey, visible, reload])
  return reload
}
