import { useState } from 'react'
import type { GitPanelRemote } from './rpc.js'
import { queryAs } from './rpc.js'
import type { GitQuery, GitQueryResult } from './types.js'
import type { DiffBase } from './DiffView.js'
import { useVisibleRequest } from './use-visible-request.js'

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
  const key = JSON.stringify([sessionId, path, base, commit])
  const [saved, setSaved] = useState<{ key: string; value: ImageState }>({ key, value: { kind: 'idle' } })
  useVisibleRequest(key, visible && remote !== undefined && sessionId !== undefined && path !== undefined && base !== undefined, async (isCurrent) => {
    if (remote === undefined || sessionId === undefined || path === undefined || base === undefined) return
    setSaved((prev) => prev.key === key && prev.value.kind === 'ready' ? prev : { key, value: { kind: 'loading' } })
    const query: GitQuery = base === 'commit' && commit !== undefined
      ? { kind: 'image-diff', path, base: 'commit', commit }
      : base === 'staged' ? { kind: 'image-diff', path, base: 'staged' } : { kind: 'image-diff', path, base: 'worktree' }
    const res = await remote.query({ sessionId, query })
    if (!isCurrent()) return
    const image = queryAs(res, 'image-diff')
    setSaved({ key, value: image !== null ? { kind: 'ready', res: image } : { kind: 'failed' } })
  }, () => setSaved({ key, value: { kind: 'failed' } }))
  return saved.key === key ? saved.value : { kind: 'idle' }
}
