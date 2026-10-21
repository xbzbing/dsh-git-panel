import { useCallback, useEffect, useRef, useState } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

export type CopyFeedback = 'idle' | 'copied' | 'error'

/** Click-to-copy state for a path control (the two diff-header paths, the
 * changes toolbar, the file-properties rows): the write outcome is carried by
 * the caller's `aria-label`, feedback-period `title` and visually-hidden live
 * region for 1.6 s — the visible path text itself never changes. Switching
 * paths clears the state at once and drops a write that resolves late, so
 * feedback can never repaint over a file the user has since moved to.
 *
 * `copy()` writes the watched path; `copy(text)` writes something else that
 * still identifies the same entry (the properties dialog copies the absolute
 * path). The watched `path` stays the guard key either way, so moving to
 * another file invalidates a pending write no matter which form was copied. */
export function useCopyFeedback(path: string | null): { feedback: CopyFeedback; copy: (text?: string) => void } {
  // The outcome is stored together with the path it belongs to and derived on
  // render, so a path switch can never paint the previous file's confirmation
  // for a frame: clearing it in an effect would race the next paint. The effect
  // still drops the stored outcome, so coming back to the same file does not
  // resurrect it.
  const [state, setState] = useState<{ key: string | null; kind: CopyFeedback }>({ key: null, kind: 'idle' })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const keyRef = useRef(path)
  useEffect(() => {
    keyRef.current = path
    if (state.key !== null) setState({ key: null, kind: 'idle' })
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [path])
  useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current) }, [])
  const copy = useCallback((text?: string): void => {
    const key = keyRef.current
    const payload = text ?? key
    if (payload === null) return
    void writeClipboard(payload).then((ok) => {
      if (keyRef.current !== key) return
      setState({ key, kind: ok ? 'copied' : 'error' })
      if (timer.current !== undefined) clearTimeout(timer.current)
      timer.current = setTimeout(() => setState({ key, kind: 'idle' }), 1600)
    })
  }, [])
  return { feedback: state.key === path ? state.kind : 'idle', copy }
}
