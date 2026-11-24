import { useCallback, useEffect, useRef, useState } from 'react'
import { queryAs, type GitPanelRemote } from './rpc.js'
import { DIFF_EXPAND_CONTEXT, type GitDiffPayload, type GitSnapshot, type StashEntry } from './types.js'
import { useVisibleRequest } from './use-visible-request.js'
import type { QueryKey } from './query-key.js'

type DiffTarget = { path: string; base: 'worktree' | 'staged'; expand: boolean; version: number }

/** Only request orchestration lives here; drafts, selection and confirmations
 * stay in ChangesTab and continue updating even while the tab is hidden. */
export function useChangesData(
  remote: GitPanelRemote,
  sessionId: string,
  snapshot: GitSnapshot,
  visible: boolean,
  onStashError: () => void,
  queryKey: QueryKey,
): {
  stashes: readonly StashEntry[]
  diffPath: DiffTarget | null
  diffData: GitDiffPayload | null
  /** Whether the context is expanded for the next diff (the toolbar's state). */
  expanded: boolean
  /** Whether `diffData` was read with expanded context: the text on screen
   * lags `expanded` while a context switch loads. */
  diffExpanded: boolean
  /** Open a file's diff; `contextOnly` switches the context of the open file
   * and keeps its diff on screen until the new text arrives. */
  showDiff: (path: string, base: 'worktree' | 'staged', expand?: boolean, contextOnly?: boolean) => void
} {
  const [stashes, setStashes] = useState<readonly StashEntry[]>([])
  const [diffPath, setDiffPath] = useState<DiffTarget | null>(null)
  const [loaded, setLoaded] = useState<{ readonly data: GitDiffPayload; readonly expand: boolean } | null>(null)
  const selection = useRef<DiffTarget | null>(null)
  const version = useRef(0)
  useVisibleRequest([sessionId, ...queryKey], visible, async (isCurrent) => {
    const res = await remote.query({ sessionId, query: { kind: 'stash-list' } })
    if (!isCurrent()) return
    const result = queryAs(res, 'stash-list')
    if (result !== null) setStashes(result.entries)
    else onStashError()
  }, onStashError)

  const stillThere = diffPath !== null && snapshot.changes.some((c) => c.path === diffPath.path)
  useEffect(() => {
    if (diffPath === null || stillThere) return
    selection.current = null
    setDiffPath(null)
    setLoaded(null)
  }, [diffPath, stillThere])

  // Each open changes version: identical parameters still reload cleared data.
  const diffQueryKey: QueryKey = [sessionId, ...queryKey, diffPath?.path, diffPath?.base, diffPath?.expand, diffPath?.version]
  useVisibleRequest(diffQueryKey, visible && stillThere, async (isCurrent) => {
    if (diffPath === null) return
    const target = diffPath
    const res = await remote.query({
      sessionId,
      query: { kind: 'diff', path: target.path, base: target.base, ...(target.expand ? { context: DIFF_EXPAND_CONTEXT } : {}) },
    })
    if (!isCurrent() || selection.current !== target) return
    const result = queryAs(res, 'diff')
    setLoaded({ data: result !== null ? { text: result.text, newLines: result.newLines, truncated: result.truncated } : { text: '', newLines: 0 }, expand: target.expand })
  }, () => setLoaded({ data: { text: '', newLines: 0 }, expand: selection.current?.expand ?? false }))

  const showDiff = useCallback((path: string, base: 'worktree' | 'staged', expand = false, contextOnly = false): void => {
    const target: DiffTarget = { path, base, expand, version: ++version.current }
    const previous = selection.current
    selection.current = target
    setDiffPath(target)
    // Switching the context of the open file keeps its diff on screen until
    // the new text arrives: the DiffView stays mounted, and so does a line
    // comment being written on it (ADR-0038). Opening a file, the same one
    // included, starts from the loading state.
    const sameFile = previous !== null && previous.path === path && previous.base === base
    if (!(contextOnly && sameFile)) setLoaded(null)
  }, [])

  return {
    stashes, diffPath, diffData: loaded?.data ?? null, expanded: diffPath?.expand ?? false,
    diffExpanded: loaded?.expand ?? false, showDiff,
  }
}
