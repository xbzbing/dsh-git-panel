import { useState } from 'react'
import { queryAs, type GitPanelRemote } from './rpc.js'
import type { GitQuery, GitQueryResult } from './types.js'
import type { DiffBase } from './DiffView.js'
import { useVisibleRequest } from './use-visible-request.js'
import type { QueryKey } from './query-key.js'

type ImageState =
  | { readonly kind: 'idle' | 'loading' | 'failed' }
  | { readonly kind: 'ready'; readonly res: Extract<GitQueryResult, { kind: 'image-diff' }> }

/** Image sides are a second query stage and must respect visibility too. */
export function useImageDiff(
  remote: GitPanelRemote | undefined,
  sessionId: string | undefined,
  path: string | undefined,
  base: DiffBase | undefined,
  commit: string | undefined,
  visible: boolean,
): ImageState {
  const queryKey: QueryKey = [sessionId, path, base, commit]
  const [saved, setSaved] = useState<{ queryKey: QueryKey; value: ImageState }>({ queryKey, value: { kind: 'idle' } })
  const matches = (key: QueryKey): boolean => key.length === queryKey.length && key.every((part, index) => part === queryKey[index])
  useVisibleRequest(queryKey, visible && remote !== undefined && sessionId !== undefined && path !== undefined && base !== undefined, async (isCurrent) => {
    if (remote === undefined || sessionId === undefined || path === undefined || base === undefined) return
    setSaved((prev) => matches(prev.queryKey) && prev.value.kind === 'ready' ? prev : { queryKey, value: { kind: 'loading' } })
    const query: GitQuery = base === 'commit' && commit !== undefined
      ? { kind: 'image-diff', path, base: 'commit', commit }
      : base === 'staged' ? { kind: 'image-diff', path, base: 'staged' } : { kind: 'image-diff', path, base: 'worktree' }
    const res = await remote.query({ sessionId, query })
    if (!isCurrent()) return
    const image = queryAs(res, 'image-diff')
    setSaved({ queryKey, value: image !== null ? { kind: 'ready', res: image } : { kind: 'failed' } })
  }, () => setSaved({ queryKey, value: { kind: 'failed' } }))
  return matches(saved.queryKey) ? saved.value : { kind: 'idle' }
}
