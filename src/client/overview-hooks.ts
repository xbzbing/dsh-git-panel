/**
 * Data hooks backing OverviewTab. Each owns one concern's state + fetch timing,
 * lifted verbatim from the component so the view layer is a thin composition.
 * Behavior (generation guards, LRU cache, debounced paging) is unchanged.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitPanelRemote } from './rpc'
import { queryAs } from './rpc'
import type { GitBranch, GitCommit, GitFileStat, GraphCommit } from './types'
import type { DiffMode } from './DiffView'
import type { DiffViewMode } from './types'

const PAGE = 100

export interface BranchTree {
  current: string | null
  defaultBranch: string | null
  local: readonly GitBranch[]
  remote: readonly GitBranch[]
  tags: readonly GitBranch[]
}

export interface HistoryFilter {
  ref: string | null
  search: string
  author: string
  since: string
}

type CommitDetail = { commit: GitCommit | null; body: string; stats: readonly GitFileStat[] }

/**
 * Left column: branch/tag tree + author list. Reloads on `refreshKey` (commit
 * landed / poll) and on mount; a fetch failure surfaces `treeError` with retry.
 */
export function useBranchTree(remote: GitPanelRemote, sessionId: string, refreshKey: number): {
  tree: BranchTree | null
  treeError: boolean
  authors: readonly string[]
  reload: () => void
} {
  const [tree, setTree] = useState<BranchTree | null>(null)
  const [treeError, setTreeError] = useState(false)
  const [authors, setAuthors] = useState<readonly string[]>([])

  const reload = useCallback(() => {
    setTreeError(false)
    void (async () => {
      const [branchesRes, tagsRes] = await Promise.all([
        remote.query({ sessionId, query: { kind: 'branches' } }),
        remote.query({ sessionId, query: { kind: 'tags' } }),
      ])
      const branches = queryAs(branchesRes, 'branches')
      if (branches === null) { setTreeError(true); return }
      const tags = queryAs(tagsRes, 'tags')
      setTree({
        current: branches.current,
        defaultBranch: branches.defaultBranch,
        local: branches.local,
        remote: branches.remote,
        tags: tags?.tags ?? [],
      })
      void remote.query({ sessionId, query: { kind: 'authors' } }).then((res) => {
        setAuthors(queryAs(res, 'authors')?.authors ?? [])
      })
    })()
  }, [remote, sessionId])

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  return { tree, treeError, authors, reload }
}

/**
 * Middle column: paged commit history. One effect owns page 0 (keyed on
 * filter + refreshKey) so a filter change and a snapshot advance can't race and
 * discard each other; `seqRef` drops stale responses, `loadingRef` guards a
 * double page-append from two scroll events in one frame.
 *
 * `onReset` fires only when the *filter* changed (branch / search / author /
 * date), where the selected commit may have dropped out of the new list. A
 * plain snapshot advance (`refreshKey`, bumped every poll because `checkedAt`
 * is always fresh) reloads page 0 to pick up new commits but preserves the
 * selection and scroll — otherwise a background poll would wipe the commit the
 * user is reading.
 */
export function useHistory(
  remote: GitPanelRemote,
  sessionId: string,
  filter: HistoryFilter,
  refreshKey: number,
  onReset: () => void,
): {
  commits: readonly GraphCommit[]
  total: number
  loading: boolean
  listError: boolean
  hasMore: boolean
  listRef: React.RefObject<HTMLDivElement>
  loadMore: () => void
} {
  const [commits, setCommits] = useState<readonly GraphCommit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState(false)
  const seqRef = useRef(0)
  const loadingRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  const loadPage = useCallback(async (skip: number, f: HistoryFilter) => {
    if (loadingRef.current) return
    loadingRef.current = true
    const seq = seqRef.current
    setLoading(true)
    setListError(false)
    const res = await remote.query({
      sessionId,
      query: {
        kind: 'history', limit: PAGE, skip,
        ...(f.ref ? { ref: f.ref } : {}),
        ...(f.search ? { search: f.search } : {}),
        ...(f.author ? { author: f.author } : {}),
        ...(f.since ? { since: f.since } : {}),
      },
    })
    loadingRef.current = false
    if (seq !== seqRef.current) return
    setLoading(false)
    const history = queryAs(res, 'history')
    if (history === null) { setListError(true); return }
    const page = history.commits
    setCommits((prev) => (skip === 0 ? page : [...prev, ...page]))
    setTotal(history.total)
  }, [remote, sessionId])

  const prevFilter = useRef(filter)
  useEffect(() => {
    seqRef.current += 1
    loadingRef.current = false
    // Distinguish a filter change (selection may no longer be in the list, and
    // the view should jump back to the top) from a plain poll refresh (same
    // filter, just a newer snapshot): only the former resets selection/scroll.
    if (prevFilter.current !== filter) {
      prevFilter.current = filter
      onReset()
      if (listRef.current) listRef.current.scrollTop = 0
    }
    void loadPage(0, filter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, refreshKey])

  const hasMore = total < 0 ? true : commits.length < total
  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return
    void loadPage(commits.length, filter)
  }, [loadPage, commits.length, filter, hasMore])

  return { commits, total, loading, listError, hasMore, listRef, loadMore }
}

/**
 * Right column + hover card: the selected commit's detail and its changed-file
 * diffs. Owns an LRU `show` cache (immutable per hash) shared by the detail
 * pane and the hover card, the full-width file-diff overlay (generation-guarded
 * + Esc-to-close), and the hover fetch (debounced, unmount-safe).
 */
export function useCommitDetail(remote: GitPanelRemote, sessionId: string, defaultDiffView: DiffViewMode): {
  selected: GraphCommit | null
  detail: CommitDetail | null
  detailError: boolean
  select: (commit: GraphCommit) => void
  clearSelection: () => void
  fileDiff: { path: string; hash: string; shortHash: string } | null
  fileDiffText: string | null
  fileDiffError: boolean
  fileDiffMode: DiffMode
  setFileDiffMode: (m: DiffMode) => void
  fileDiffExpanded: boolean
  openFileDiff: (path: string, hash: string, shortHash: string, expand?: boolean) => void
  closeFileDiff: () => void
  hover: { commit: GraphCommit; x: number; y: number } | null
  hoverBody: string | null
  onHoverEnter: (commit: GraphCommit, x: number, y: number) => void
  onHoverLeave: () => void
} {
  const [selected, setSelected] = useState<GraphCommit | null>(null)
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [detailError, setDetailError] = useState(false)
  const [fileDiff, setFileDiff] = useState<{ path: string; hash: string; shortHash: string } | null>(null)
  const [fileDiffText, setFileDiffText] = useState<string | null>(null)
  const [fileDiffError, setFileDiffError] = useState(false)
  const [fileDiffMode, setFileDiffMode] = useState<DiffMode>(defaultDiffView)
  const [fileDiffExpanded, setFileDiffExpanded] = useState(false)
  const fileDiffSeq = useRef(0)
  const selectedHash = useRef<string | null>(null)
  const detailCache = useRef(new Map<string, CommitDetail>())

  const clearSelection = useCallback(() => {
    setSelected(null)
    setDetail(null)
    selectedHash.current = null
  }, [])

  const select = useCallback(async (commit: GraphCommit) => {
    selectedHash.current = commit.hash
    setSelected(commit)
    setDetailError(false)
    // Selecting a different commit drops any open file-diff overlay.
    fileDiffSeq.current += 1
    setFileDiff(null)
    setFileDiffText(null)
    setFileDiffError(false)
    const cached = detailCache.current.get(commit.hash)
    if (cached !== undefined) { setDetail(cached); return }
    setDetail(null)
    const res = await remote.query({ sessionId, query: { kind: 'show', ref: commit.hash } })
    if (selectedHash.current !== commit.hash) return
    const show = queryAs(res, 'show')
    if (show !== null) {
      const d = { commit: show.commit, body: show.body, stats: show.stats }
      const cache = detailCache.current
      cache.set(commit.hash, d)
      while (cache.size > 50) {
        const first = cache.keys().next().value
        if (first === undefined) break
        cache.delete(first)
      }
      setDetail(d)
    } else {
      setDetailError(true)
    }
  }, [remote, sessionId])

  const openFileDiff = useCallback(async (path: string, hash: string, shortHash: string, expand = false) => {
    const seq = ++fileDiffSeq.current
    setFileDiff({ path, hash, shortHash })
    setFileDiffText(null)
    setFileDiffError(false)
    setFileDiffExpanded(expand)
    const res = await remote.query({ sessionId, query: { kind: 'diff', path, base: 'commit', commit: hash, ...(expand ? { context: 100000 } : {}) } })
    if (seq !== fileDiffSeq.current) return
    const diff = queryAs(res, 'diff')
    if (diff !== null) setFileDiffText(diff.text)
    else setFileDiffError(true)
  }, [remote, sessionId])

  const closeFileDiff = useCallback(() => {
    fileDiffSeq.current += 1
    setFileDiff(null)
    setFileDiffText(null)
    setFileDiffError(false)
    setFileDiffExpanded(false)
  }, [])

  // Esc closes the file-diff modal.
  useEffect(() => {
    if (fileDiff === null) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeFileDiff() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fileDiff, closeFileDiff])

  const [hover, setHover] = useState<{ commit: GraphCommit; x: number; y: number } | null>(null)
  const [hoverBody, setHoverBody] = useState<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hoverHash = useRef<string | null>(null)

  const onHoverEnter = useCallback((commit: GraphCommit, x: number, y: number) => {
    if (hoverTimer.current !== undefined) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => {
      hoverHash.current = commit.hash
      setHover({ commit, x, y })
      const cached = detailCache.current.get(commit.hash)
      if (cached !== undefined) { setHoverBody(cached.body); return }
      setHoverBody(null)
      void remote.query({ sessionId, query: { kind: 'show', ref: commit.hash } }).then((res) => {
        if (hoverHash.current !== commit.hash) return
        const show = queryAs(res, 'show')
        if (show !== null) {
          detailCache.current.set(commit.hash, { commit: show.commit, body: show.body, stats: show.stats })
          setHoverBody(show.body)
        } else setHoverBody('')
      })
    }, 260)
  }, [remote, sessionId])

  const onHoverLeave = useCallback(() => {
    if (hoverTimer.current !== undefined) clearTimeout(hoverTimer.current)
    hoverHash.current = null
    setHover(null)
    setHoverBody(null)
  }, [])

  // Clear a pending hover timer on unmount so it can't setState after teardown.
  useEffect(() => () => { if (hoverTimer.current !== undefined) clearTimeout(hoverTimer.current) }, [])

  return {
    selected, detail, detailError, select, clearSelection,
    fileDiff, fileDiffText, fileDiffError, fileDiffMode, setFileDiffMode, fileDiffExpanded, openFileDiff, closeFileDiff,
    hover, hoverBody, onHoverEnter, onHoverLeave,
  }
}

