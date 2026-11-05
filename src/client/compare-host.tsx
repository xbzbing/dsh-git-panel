/**
 * 「比较」与「文件历史」的宿主：面板只持有一个请求（哪个文件、哪种选择框），
 * 其余状态（候选、分页、差异查询、弹窗模式）留在这里，让 Panel 不因为这三个
 * 菜单项再长一截。
 *
 * 两个选择框共用 ComparePicker（同一套外壳、过滤与虚拟列表）：
 *  - 分支或标签：一次读出本地 / 远程分支与标签；
 *  - 修订版本：只列当前分支可达的提交（ref = HEAD + exactPath），分页追加。
 * 选中后打开 rev 对比弹窗：旧侧是所选版本，新侧是工作区。
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitPanelRemote } from './rpc.js'
import { queryAs } from './rpc.js'
import type { GraphCommit, GitDiffPayload } from './types.js'
import type { GitKey } from './locales.js'
import type { DiffMode } from './DiffView.js'
import { renderFileDiffModal } from './overview-filediff.js'
import { useCopyFeedback } from './copy-feedback.js'
import { DIFF_EXPAND_CONTEXT } from './types.js'
import { ComparePicker } from './compare-flow.js'
import { loadCompareCandidates, revisionCandidates, type CompareRef } from './compare-refs.js'

/** The history page size of the revisions picker; its cap is the picker's own
 * "load more" affordance rather than an unbounded walk. */
export const REVISION_PAGE = 50

/** What the panel asked for. */
export interface CompareRequest {
  /** `ref`: branches and tags; `revision`: this file's commits. */
  readonly mode: 'ref' | 'revision'
  /** Repository-relative path the comparison is about. */
  readonly path: string
}

export interface CompareHostProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly request: CompareRequest
  readonly compact: boolean
  /** The panel's diff-view preference, so the comparison opens in the layout
   * the user already chose (compact folds split into unified, as everywhere). */
  readonly defaultDiffView: DiffMode
  readonly onClose: () => void
  /** The panel's browse-root-relative root label, for the overlay title. */
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** One mounted comparison flow: picker → revision diff overlay. */
export function CompareHost({ remote, sessionId, request, compact, defaultDiffView, onClose, t }: CompareHostProps): JSX.Element | null {
  const [picked, setPicked] = useState<{ rev: string; label: string } | null>(null)
  const [candidates, setCandidates] = useState<readonly CompareRef[] | null>(null)
  const [commits, setCommits] = useState<readonly GraphCommit[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const seq = useRef(0)

  // Candidates for one mode, for one file. A newer request supersedes an older
  // reply (the picker can be reopened on another entry while a page is in
  // flight).
  useEffect(() => {
    const id = ++seq.current
    setCandidates(null)
    setCommits(null)
    setFailed(false)
    setLoading(true)
    setHasMore(false)
    if (request.mode === 'ref') {
      void loadCompareCandidates(remote, sessionId).then((refs) => {
        if (seq.current !== id) return
        setLoading(false)
        if (refs === null) { setFailed(true); return }
        setCandidates(refs)
      })
      return
    }
    void remote.query({
      sessionId,
      // HEAD-only: a revision list is "what this file looked like on this line
      // of work", and a commit from another branch would compare against a
      // history the file never had here.
      query: { kind: 'history', limit: REVISION_PAGE, skip: 0, ref: 'HEAD', exactPath: request.path },
    }).then((res) => {
      if (seq.current !== id) return
      setLoading(false)
      const history = queryAs(res, 'history')
      if (history === null) { setFailed(true); return }
      setCommits(history.commits)
      setHasMore(history.total < 0 ? history.commits.length === REVISION_PAGE : history.commits.length < history.total)
    })
  }, [remote, sessionId, request.mode, request.path])

  const loadMore = useCallback(() => {
    if (commits === null) return
    const id = seq.current
    const skip = commits.length
    setLoading(true)
    void remote.query({
      sessionId,
      query: { kind: 'history', limit: REVISION_PAGE, skip, ref: 'HEAD', exactPath: request.path },
    }).then((res) => {
      if (seq.current !== id) return
      setLoading(false)
      const history = queryAs(res, 'history')
      if (history === null) { setFailed(true); return }
      const next = [...commits, ...history.commits]
      setCommits(next)
      setHasMore(next.length === commits.length + REVISION_PAGE && next.length < (history.total < 0 ? Infinity : history.total))
    })
  }, [commits, remote, sessionId, request.path])

  const rows = useMemo(
    () => (request.mode === 'ref' ? candidates : commits === null ? null : revisionCandidates(commits)),
    [request.mode, candidates, commits],
  )

  const loadMoreEl = request.mode === 'revision' && hasMore
    ? h('button', {
      key: 'more', type: 'button', className: 'gp-compare__more',
      onClick: () => loadMore(),
    }, t('common.loadMore'))
    : null

  const picker = h(ComparePicker, {
    key: 'picker',
    title: request.mode === 'ref' ? t('menu.compareTitle') : t('menu.revisionsTitle'),
    path: request.path,
    candidates: rows,
    loading,
    failed,
    footer: loadMoreEl,
    onPick: (rev, label) => setPicked({ rev, label }),
    onClose,
    t,
  })

  return h('div', { style: { display: 'contents' } }, [
    picker,
    picked === null
      ? null
      : h(RevDiffOverlay, {
        key: 'overlay', remote, sessionId, path: request.path, rev: picked.rev, label: picked.label,
        compact, defaultMode: compact && defaultDiffView === 'split' ? 'unified' : defaultDiffView,
        onClose: () => setPicked(null), t,
      }),
  ])
}

/** The revision comparison itself: `<rev>` against the work tree. */
function RevDiffOverlay(props: {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly path: string
  readonly rev: string
  readonly label: string
  readonly compact: boolean
  readonly defaultMode: DiffMode
  readonly onClose: () => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}): JSX.Element | null {
  const { remote, sessionId, path, rev, label, compact, defaultMode, onClose, t } = props
  const [data, setData] = useState<GitDiffPayload | null>(null)
  const [error, setError] = useState(false)
  const [mode, setMode] = useState<DiffMode>(defaultMode)
  const [expanded, setExpanded] = useState(false)
  const copy = useCopyFeedback(path)
  const seq = useRef(0)

  useEffect(() => {
    const id = ++seq.current
    setData(null)
    setError(false)
    void remote.query({
      sessionId,
      query: {
        kind: 'diff', path, base: 'rev', rev,
        ...(expanded ? { context: DIFF_EXPAND_CONTEXT } : {}),
      },
    }).then((res) => {
      if (seq.current !== id) return
      const diff = queryAs(res, 'diff')
      if (diff === null) { setError(true); return }
      setData({ text: diff.text, newLines: diff.newLines, truncated: diff.truncated })
    })
  }, [remote, sessionId, path, rev, expanded])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return renderFileDiffModal({ path, rev, label }, {
    visible: true, data, error, mode, onMode: setMode, expanded, onExpand: setExpanded,
    onClose, pathFeedback: copy.feedback, onCopyPath: copy.copy, remote, sessionId, compact, t,
  })
}
