import { useCallback, useEffect, useRef, useState } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

export type CopyFeedback = 'idle' | 'copied' | 'error'

/** Click-to-copy state for the two diff-header paths (changes toolbar, commit
 * file-diff modal): the write outcome is carried by the caller's `aria-label`,
 * feedback-period `title` and visually-hidden live region for 1.6 s — the
 * visible path text itself never changes. Switching paths clears the state at
 * once and drops a write that resolves late, so feedback can never repaint
 * over a file the user has since moved to. */
export function useCopyFeedback(path: string | null): { feedback: CopyFeedback; copy: (text: string) => void } {
  const [feedback, setFeedback] = useState<CopyFeedback>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const keyRef = useRef(path)
  useEffect(() => {
    keyRef.current = path
    setFeedback('idle')
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
  }, [path])
  useEffect(() => () => { if (timer.current !== undefined) clearTimeout(timer.current) }, [])
  const copy = useCallback((text: string): void => {
    const key = keyRef.current
    void writeClipboard(text).then((ok) => {
      if (keyRef.current !== key) return
      setFeedback(ok ? 'copied' : 'error')
      if (timer.current !== undefined) clearTimeout(timer.current)
      timer.current = setTimeout(() => setFeedback('idle'), 1600)
    })
  }, [])
  return { feedback, copy }
}
