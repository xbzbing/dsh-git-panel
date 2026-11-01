/**
 * On-demand hidden-context expansion: the hook behind every diff gap's
 * expand control. It lives apart from the view so the request/generation
 * logic can be driven by the hook harness without pulling in the platform UI
 * primitives the diff renderer imports.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { spliceGap, GAP_STEP, type GapInfo, type SideRow } from './diff.js'
import { queryAs, type GitPanelRemote } from './rpc.js'
import { FILE_LINES_MAX_LINES, type GitQuery } from './types.js'
import type { DiffBase } from './views/diff/diff-types.js'

export interface GapExpander {
  readonly busy: string | null
  readonly run: (gap: GapInfo, direction: 'all' | 'up' | 'down') => void
  /** Last reveal request failed: its message, or '' when the reply carried
   * none. Cleared by the next attempt and by a reseed. */
  readonly failed: string | null
}

/**
 * On-demand hidden-context expansion. Clicking a gap control fetches the
 * revealed slice (file-lines query, source mirrors the diff base) and splices it
 * into the row list. A generation guard drops a stale response if the rows were
 * reseeded (diff text or the trailing-gap line count changed) mid-flight.
 */
export function useGapExpander(
  setRows: (updater: (prev: readonly SideRow[]) => readonly SideRow[]) => void,
  remote: GitPanelRemote | undefined,
  sessionId: string | undefined,
  path: string | undefined,
  base: DiffBase | undefined,
  commit: string | undefined,
  text: string,
  newLines: number | undefined,
): GapExpander {
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const gen = useRef(0)
  // Reseeding invalidates any in-flight reveal. The seed is the diff text and
  // its line count — NOT `rows`: every splice produces a new rows array, so
  // keying on it would bump the generation after the first chunk of an
  // "expand all" walk and strand the remaining nine batches as a live gap.
  useEffect(() => { gen.current += 1; setBusy(null); setFailed(null) }, [text, newLines])

  const run = useCallback((gap: GapInfo, direction: 'all' | 'up' | 'down') => {
    if (remote === undefined || sessionId === undefined || path === undefined || base === undefined) return
    const key = `${gap.rightStart}:${direction}`
    setBusy(key)
    setFailed(null)
    const my = ++gen.current
    const queryAt = (start: number, end: number): GitQuery => base === 'commit' && commit !== undefined
      ? { kind: 'file-lines', path, base: 'commit', commit, start, end }
      : base === 'staged'
        ? { kind: 'file-lines', path, base: 'staged', start, end }
        : { kind: 'file-lines', path, base: 'worktree', start, end }
    // The host bounds one reply (FILE_LINES_MAX_LINES and the config byte cap),
    // so "expand all" walks forward chunk by chunk until EOF. The walk is capped
    // too: a few hundred thousand revealed lines in one gesture is not worth the
    // frame time, and whatever is left stays a gap the reader can click again.
    const first = sliceRequest(gap, direction)
    const steps = direction === 'all' ? EXPAND_ALL_STEPS : 1
    void (async () => {
      let start = first.start
      let end = first.end
      for (let step = 0; step < steps; step += 1) {
        const res = await remote.query({ sessionId, query: queryAt(start, end) })
        if (my !== gen.current) return
        const fl = queryAs(res, 'file-lines')
        if (fl === null) {
          // A reveal the host refused (a worktree file over the read cap, a
          // transport drop) must say so: silently leaving the gap would read as
          // "nothing happened", and a caller-visible reason names the real fix.
          if (my === gen.current) setFailed(!res.ok && typeof res.error.message === 'string' && res.error.message !== '' ? res.error.message : '')
          break
        }
        setRows((prev) => spliceGap(prev, start, direction, fl.start, fl.lines, fl.eof))
        if (fl.eof || fl.lines.length === 0 || direction !== 'all') break
        start = fl.start + fl.lines.length
        if (start > gap.rightStart + gap.count - 1) break
        end = Math.min(start + FILE_LINES_MAX_LINES - 1, gap.rightStart + gap.count - 1)
      }
      if (my === gen.current) setBusy(null)
    })().catch(() => { if (my === gen.current) { setFailed(''); setBusy(null) } })
  }, [remote, sessionId, path, base, commit, setRows])

  return { busy, run, failed }
}

/** Requests one "expand all" click may chain: ten host-sized replies, so a
 * huge gap fills in one gesture while the frame budget stays bounded. */
const EXPAND_ALL_STEPS = 10

/** New-side line range to request for a gap expansion step. */
function sliceRequest(gap: GapInfo, direction: 'all' | 'up' | 'down'): { start: number; end: number } {
  const total = gap.count
  if (direction === 'all' || total <= GAP_STEP) {
    return { start: gap.rightStart, end: gap.rightStart + total - 1 }
  }
  if (direction === 'down') {
    return { start: gap.rightStart, end: gap.rightStart + GAP_STEP - 1 }
  }
  // 'up': reveal the bottom window of the gap.
  return { start: gap.rightStart + total - GAP_STEP, end: gap.rightStart + total - 1 }
}
