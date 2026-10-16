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
  expanded: boolean
  showDiff: (path: string, base: 'worktree' | 'staged', expand?: boolean) => void
} {
  const [stashes, setStashes] = useState<readonly StashEntry[]>([])
  const [diffPath, setDiffPath] = useState<DiffTarget | null>(null)
  const [diffData, setDiffData] = useState<GitDiffPayload | null>(null)
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
    setDiffData(null)
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
    setDiffData(result !== null ? { text: result.text, newLines: result.newLines, truncated: result.truncated } : { text: '', newLines: 0 })
  }, () => setDiffData({ text: '', newLines: 0 }))

  const showDiff = useCallback((path: string, base: 'worktree' | 'staged', expand = false): void => {
    const target: DiffTarget = { path, base, expand, version: ++version.current }
    selection.current = target
    setDiffPath(target)
    setDiffData(null)
  }, [])

  return { stashes, diffPath, diffData, expanded: diffPath?.expand ?? false, showDiff }
}
