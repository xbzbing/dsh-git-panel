/**
 * Files tab: a lazy directory tree of the working tree on the left, a preview
 * of the selected file on the right. Directories fetch their children on
 * expand (dir-list); files fetch content on select (file-content). Code/text
 * uses the platform's lazy syntax highlighter; images render inline, other
 * binaries show a placeholder. Left column width is drag-resizable.
 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitPanelRemote } from './rpc'
import { queryAs } from './rpc'
import type { DirEntry } from './types'
import type { GitKey } from './locales'
import { ChevronIcon } from './icons'
import { useResizableColumn } from './resizable'
import { FileTypeIcon, languageForPath, MarkdownText, useCodeHighlighter, type HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import { FindBar, markContent, matchRangesRaw, useDebounced, FIND_DEBOUNCE_MS, MAX_MATCHES } from './find'

interface FilesTabProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type Loaded = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly entries: readonly DirEntry[]; readonly truncated: boolean }

function isMarkdownPath(path: string): boolean { return /\.(?:md|markdown)$/i.test(path) }
function isHtmlPath(path: string): boolean { return /\.(?:html?|xhtml)$/i.test(path) }
/** Text files that offer a rendered view beside their source. */
function isRichPath(path: string): boolean { return isMarkdownPath(path) || isHtmlPath(path) }

// Source-view performance guards. Syntax highlighting is synchronous and DOM
// cost scales with line count, so above these limits the code preview degrades
// gracefully: no highlighting for a big file, truncation for a huge line.
const MAX_HIGHLIGHT_BYTES = 256 * 1024
const MAX_HIGHLIGHT_LINES = 5000
const MAX_LINE_CHARS = 5000

// Row virtualization: the source view renders only the rows in (or near) the
// viewport, so a 15k-line file mounts ~a screenful of nodes instead of 30k.
// Rows are fixed-height and non-wrapping (horizontal scroll) so the window math
// is exact; ROW_HEIGHT must match the .gp-files__row line box.
const ROW_HEIGHT = 20
const OVERSCAN = 12

type FileState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly path: string }
  | { readonly kind: 'text'; readonly path: string; readonly content: string; readonly lines: number }
  | { readonly kind: 'image'; readonly path: string; readonly dataUrl: string }
  | { readonly kind: 'binary'; readonly path: string }
  | { readonly kind: 'tooLarge'; readonly path: string }
  | { readonly kind: 'error'; readonly path: string }

/**
 * Preserved Files-tab state so a quick return (within the same ~1-minute
 * window the panel uses for its sub-tab) keeps the opened directories,
 * selection, and preview instead of resetting to the root. Keyed per session;
 * an entry older than the window is dropped on read.
 */
interface FilesState {
  readonly dirs: ReadonlyMap<string, Loaded>
  readonly open: ReadonlySet<string>
  readonly selected: string | null
  readonly file: FileState
  readonly renderMarkdown: boolean
}
const FILES_STICKY_MS = 60_000
const filesCache = new Map<string, { state: FilesState; leftAt: number }>()

function stashFilesState(sessionId: string, state: FilesState): void {
  // A mid-flight load can't resume after remount; persist it as idle so the
  // restore path re-selects and refetches the file.
  const file: FileState = state.file.kind === 'loading' ? { kind: 'idle' } : state.file
  filesCache.set(sessionId, { state: { ...state, file }, leftAt: Date.now() })
}

function restoreFilesState(sessionId: string): FilesState | null {
  const entry = filesCache.get(sessionId)
  if (entry === undefined) return null
  if (Date.now() - entry.leftAt > FILES_STICKY_MS) { filesCache.delete(sessionId); return null }
  return entry.state
}

export function FilesTab({ remote, sessionId, t }: FilesTabProps): JSX.Element {
  // Restore a recently-left state once (per mount); null when none/expired.
  const restored = useRef<FilesState | null | undefined>(undefined)
  if (restored.current === undefined) restored.current = restoreFilesState(sessionId)
  const init = restored.current
  // Per-directory listing cache + expansion set, both keyed by relative path
  // ('' = root). The tree renders from these; expanding a dir fetches it once.
  const [dirs, setDirs] = useState<ReadonlyMap<string, Loaded>>(() => init?.dirs ?? new Map())
  const [open, setOpen] = useState<ReadonlySet<string>>(() => init?.open ?? new Set(['']))
  const [selected, setSelected] = useState<string | null>(() => init?.selected ?? null)
  const [file, setFile] = useState<FileState>(() => init?.file ?? { kind: 'idle' })
  const [renderMarkdown, setRenderMarkdown] = useState(() => init?.renderMarkdown ?? true)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [copyContentState, setCopyContentState] = useState<'idle' | 'copied' | 'error'>('idle')
  const markdownLabels = useMemo(() => ({ code: { copyLabel: t('files.copy'), copiedLabel: t('files.copied') }, footnotes: t('files.footnotes') }), [t])
  const fileSeq = useRef(0)

  const leftCol = useResizableColumn({ storageKey: 'gp.files.left', initial: 300, min: 180, reserve: 220, edge: 'end' })

  const loadDir = useCallback((path: string) => {
    setDirs((prev) => {
      const cur = prev.get(path)
      if (cur !== undefined && cur.status !== 'error') return prev
      const next = new Map(prev)
      next.set(path, { status: 'loading' })
      return next
    })
    void remote.query({ sessionId, query: { kind: 'dir-list', path } }).then((res) => {
      const dl = queryAs(res, 'dir-list')
      setDirs((prev) => {
        const next = new Map(prev)
        next.set(path, dl === null ? { status: 'error' } : { status: 'ready', entries: dl.entries, truncated: dl.truncated })
        return next
      })
    }).catch(() => {
      setDirs((prev) => { const next = new Map(prev); next.set(path, { status: 'error' }); return next })
    })
  }, [remote, sessionId])

  // Load the root once on mount / when the session changes.
  useEffect(() => { loadDir('') }, [loadDir])

  const toggleDir = useCallback((path: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(path)) { next.delete(path); return next }
      next.add(path)
      if (dirs.get(path) === undefined) loadDir(path)
      return next
    })
  }, [dirs, loadDir])

  const selectFile = useCallback((path: string) => {
    setSelected(path)
    // Rendered view is the default for Markdown; HTML defaults to source so a
    // page never auto-executes on selection — the user opts into the preview.
    setRenderMarkdown(!isHtmlPath(path))
    setCopyState('idle')
    setCopyContentState('idle')
    const seq = ++fileSeq.current
    setFile({ kind: 'loading', path })
    void remote.query({ sessionId, query: { kind: 'file-content', path } }).then((res) => {
      if (seq !== fileSeq.current) return
      const fc = queryAs(res, 'file-content')
      if (fc === null) { setFile({ kind: 'error', path }); return }
      if (fc.tooLarge === true) { setFile({ kind: 'tooLarge', path }); return }
      if (fc.variant === 'image' && fc.dataUrl !== undefined) { setFile({ kind: 'image', path, dataUrl: fc.dataUrl }); return }
      if (fc.variant === 'text') { setFile({ kind: 'text', path, content: fc.content ?? '', lines: fc.lines ?? 0 }); return }
      setFile({ kind: 'binary', path })
    }).catch(() => { if (seq === fileSeq.current) setFile({ kind: 'error', path }) })
  }, [remote, sessionId])

  // Persist the browsing state when the panel unmounts (view-tab switch or
  // session change) so a quick return restores it; a ref carries the latest
  // values into the unmount-only cleanup.
  const liveRef = useRef<FilesState>({ dirs, open, selected, file, renderMarkdown })
  liveRef.current = { dirs, open, selected, file, renderMarkdown }
  useEffect(() => () => { stashFilesState(sessionId, liveRef.current) }, [sessionId])

  // A restored selection whose preview was still loading at unmount comes back
  // as idle; refetch it once on mount so the preview isn't left blank.
  const rehydrated = useRef(false)
  useEffect(() => {
    if (rehydrated.current) return
    rehydrated.current = true
    if (init !== null && init.selected !== null && file.kind === 'idle') selectFile(init.selected)
  }, [init, file.kind, selectFile])

  const treeRows = useMemo(() => renderTree('', 0, { dirs, open, selected, toggleDir, selectFile, t }), [dirs, open, selected, toggleDir, selectFile, t])

  const copyPath = async (): Promise<void> => {
    if (selected === null) return
    const seq = fileSeq.current
    try {
      await navigator.clipboard.writeText(selected)
      if (seq === fileSeq.current) setCopyState('copied')
    } catch {
      if (seq === fileSeq.current) setCopyState('error')
    }
  }

  const copyContent = async (): Promise<void> => {
    if (file.kind !== 'text') return
    const seq = fileSeq.current
    try {
      await navigator.clipboard.writeText(file.content)
      if (seq === fileSeq.current) setCopyContentState('copied')
    } catch {
      if (seq === fileSeq.current) setCopyContentState('error')
    }
  }

  return h('div', { className: 'gp-files' }, [
    h('div', { key: 'left', className: 'gp-files__tree', style: { flex: `0 0 ${leftCol.width}px` } }, treeRows),
    leftCol.divider,
    h('div', { key: 'right', className: 'gp-files__preview' }, [
      selected !== null ? h('div', { key: 'bar', className: 'gp-files__bar' }, [
        h('code', { key: 'path', className: 'gp-files__path', title: selected }, selected),
        file.kind === 'text' && isRichPath(file.path)
          ? h('div', { key: 'mode', className: 'gp-files__mode', role: 'group', 'aria-label': t('files.previewMode') }, [
            h('button', { key: 'source', type: 'button', className: `gp-files__mode-btn${!renderMarkdown ? ' gp-files__mode-btn--active' : ''}`, 'aria-pressed': !renderMarkdown, onClick: () => setRenderMarkdown(false) }, t('files.source')),
            h('button', { key: 'render', type: 'button', className: `gp-files__mode-btn${renderMarkdown ? ' gp-files__mode-btn--active' : ''}`, 'aria-pressed': renderMarkdown, onClick: () => setRenderMarkdown(true) }, t('files.render')),
          ])
          : null,
        h('button', {
          key: 'copy', type: 'button', className: `gp-files__copy-path${copyState === 'error' ? ' gp-files__copy-path--error' : ''}`,
          'aria-live': 'polite', onClick: () => { void copyPath() },
        }, t(copyState === 'copied' ? 'files.pathCopied' : copyState === 'error' ? 'files.pathCopyFailed' : 'files.copyPath')),
        file.kind === 'text'
          ? h('button', {
            key: 'copy-content', type: 'button', className: `gp-files__copy-path${copyContentState === 'error' ? ' gp-files__copy-path--error' : ''}`,
            'aria-live': 'polite', onClick: () => { void copyContent() },
          }, t(copyContentState === 'copied' ? 'files.contentCopied' : copyContentState === 'error' ? 'files.contentCopyFailed' : 'files.copyContent'))
          : null,
      ]) : null,
      h('div', { key: 'content', className: 'gp-files__preview-content' }, renderContent(file, renderMarkdown, markdownLabels, t)),
    ]),
  ])
}

/** Preview body: rendered Markdown/HTML when the mode is on, else raw preview. */
function renderContent(
  file: FileState,
  renderMarkdown: boolean,
  markdownLabels: { code: { copyLabel: string; copiedLabel: string }; footnotes: string },
  t: (key: GitKey, params?: Record<string, string | number>) => string,
): JSX.Element {
  if (file.kind === 'text' && renderMarkdown && isMarkdownPath(file.path)) {
    return h('div', { className: 'gp-files__markdown' }, h(MarkdownText, { text: file.content, labels: markdownLabels, variant: 'body' }))
  }
  if (file.kind === 'text' && renderMarkdown && isHtmlPath(file.path)) {
    // Render in a locked-down iframe: allow-scripts lets an interactive page
    // run, but WITHOUT allow-same-origin the document is a unique opaque
    // origin — it cannot reach the DSH parent, its storage, or same-origin
    // network. srcDoc keeps the bytes in-document (no extra fetch).
    return h('iframe', {
      className: 'gp-files__html', title: file.path, srcDoc: file.content,
      sandbox: 'allow-scripts', referrerPolicy: 'no-referrer',
    })
  }
  return renderPreview(file, t)
}

interface TreeCbs {
  dirs: ReadonlyMap<string, Loaded>
  open: ReadonlySet<string>
  selected: string | null
  toggleDir: (path: string) => void
  selectFile: (path: string) => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Recursively render the expanded tree from the per-directory cache. */
function renderTree(dirPath: string, depth: number, cb: TreeCbs): JSX.Element[] {
  const loaded = cb.dirs.get(dirPath)
  if (loaded === undefined || loaded.status === 'loading') {
    if (depth === 0) return [h('div', { key: 'l', className: 'gp-empty' }, cb.t('common.loading'))]
    return [h('div', { key: `l${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 10 + depth * 14 } }, cb.t('common.loading'))]
  }
  if (loaded.status === 'error') {
    return [h('div', { key: `e${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 10 + depth * 14 } }, cb.t('files.loadFailed'))]
  }
  const rows: JSX.Element[] = []
  for (const entry of loaded.entries) {
    const path = dirPath === '' ? entry.name : `${dirPath}/${entry.name}`
    if (entry.dir) {
      const isOpen = cb.open.has(path)
      rows.push(h('button', {
        key: path, type: 'button', className: `gp-tree-row gp-files__entry gp-files__entry--dir${entry.ignored ? ' gp-tree-row--ignored' : ''}`,
        style: { paddingLeft: 10 + depth * 14 }, 'aria-expanded': isOpen,
        'aria-label': entry.ignored ? `${entry.name} (${cb.t('files.ignored')})` : entry.name,
        onClick: () => cb.toggleDir(path),
      }, [
        h('span', { key: 'c', className: 'gp-tree-chev' }, h(ChevronIcon, { size: 11, open: isOpen })),
        h('span', { key: 'i', className: 'gp-tree-ic' }, h(FileTypeIcon, { kind: 'folder', size: 18 })),
        h('span', { key: 'n', className: 'gp-tree-name' }, entry.name),
      ]))
      if (isOpen) rows.push(...renderTree(path, depth + 1, cb))
    } else {
      const active = cb.selected === path
      rows.push(h('button', {
        key: path, type: 'button', className: `gp-tree-row gp-files__entry${active ? ' gp-tree-row--active' : ''}${entry.ignored ? ' gp-tree-row--ignored' : ''}`,
        style: { paddingLeft: 10 + depth * 14 }, 'aria-current': active ? 'true' : undefined,
        'aria-label': entry.ignored ? `${entry.name} (${cb.t('files.ignored')})` : entry.name,
        onClick: () => cb.selectFile(path),
      }, [
        h('span', { key: 'c', className: 'gp-tree-chev' }),
        h('span', { key: 'i', className: 'gp-tree-ic' }, h(FileTypeIcon, { path, size: 18 })),
        h('span', { key: 'n', className: 'gp-tree-name' }, entry.name),
      ]))
    }
  }
  if (loaded.truncated) {
    rows.push(h('div', { key: `t${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 10 + depth * 14 } }, cb.t('files.truncated')))
  }
  return rows
}

function renderPreview(file: FileState, t: (key: GitKey, params?: Record<string, string | number>) => string): JSX.Element {
  switch (file.kind) {
    case 'idle': return h('div', { className: 'gp-empty' }, t('files.selectFile'))
    case 'loading': return h('div', { className: 'gp-empty' }, t('common.loading'))
    case 'error': return h('div', { className: 'gp-empty' }, t('files.loadFailed'))
    case 'tooLarge': return h('div', { className: 'gp-empty' }, t('files.tooLarge'))
    case 'binary': return h('div', { className: 'gp-empty' }, t('files.binary'))
    case 'image':
      return h('div', { className: 'gp-files__image' }, h('img', { src: file.dataUrl, alt: file.path }))
    case 'text':
      return h(CodePreview, { content: file.content, path: file.path, t })
  }
}

/** A single match location within the code body. */
interface Match { readonly line: number; readonly start: number; readonly end: number }

/**
 * Substring matches across the (already case-normalized) line array, capped.
 * `hays` and `needle` are both pre-normalized by the caller, so a case-
 * insensitive scan does not re-lowercase the file on every keystroke.
 */
function findMatches(hays: readonly string[], needle: string): Match[] {
  if (needle === '') return []
  const out: Match[] = []
  for (let li = 0; li < hays.length; li++) {
    for (const [start, end] of matchRangesRaw(hays[li], needle)) {
      out.push({ line: li, start, end })
      if (out.length >= MAX_MATCHES) return out
    }
  }
  return out
}

/**
 * Read-only numbered code view with lazy syntax highlighting and an in-panel
 * Find (Ctrl/Cmd+F): matches are highlighted in place preserving syntax colors,
 * with next/prev navigation, a live count, and Esc to close. The find shortcut
 * is intercepted only while this preview is actually visible (offsetParent), so
 * it never steals Ctrl+F from the rest of the app.
 */
function CodePreview({ content, path, t }: { content: string; path: string; t: (key: GitKey, params?: Record<string, string | number>) => string }): JSX.Element {
  const lines = useMemo(() => {
    const arr = content.split('\n')
    if (arr.length > 0 && arr[arr.length - 1] === '') arr.pop()
    return arr
  }, [content])
  // Guard 1: a large file is cheap to detect from its raw size, and Shiki
  // tokenizes the whole body synchronously — over the threshold, skip
  // highlighting entirely (undefined lang → no grammar load) and render plain
  // text so opening the file never blocks the main thread.
  const plain = content.length > MAX_HIGHLIGHT_BYTES || lines.length > MAX_HIGHLIGHT_LINES
  const lang = plain ? undefined : languageForPath(path)
  const highlight = useCodeHighlighter(lang)
  const highlighted = useMemo(() => plain ? undefined : highlight(lines.join('\n')), [plain, highlight, lines])

  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const activeRef = useRef<HTMLElement | null>(null)

  // Reset the find state when the previewed file changes.
  useEffect(() => { setFindOpen(false); setQuery(''); setActiveIndex(0) }, [path])

  // Debounce the scan (not the input) so typing does not re-match + re-render
  // the whole grid on every keystroke.
  const debouncedQuery = useDebounced(query, FIND_DEBOUNCE_MS)
  // Cache a lowercased copy of every line once per file; a case-insensitive
  // scan reuses it instead of re-lowercasing the body on each query change.
  const lowerLines = useMemo(() => lines.map((l) => l.toLowerCase()), [lines])
  const needle = caseSensitive ? debouncedQuery : debouncedQuery.toLowerCase()
  const hays = caseSensitive ? lines : lowerLines
  const matches = useMemo(() => findMatches(hays, needle), [hays, needle])
  // A new query or case-mode change restarts navigation at the first match.
  useEffect(() => { setActiveIndex(0) }, [needle])
  const safeActive = matches.length === 0 ? 0 : Math.min(activeIndex, matches.length - 1)

  // Per-line match ranges for rendering (only lines that actually match).
  const perLine = useMemo(() => {
    const map = new Map<number, Array<readonly [number, number]>>()
    for (const m of matches) {
      const arr = map.get(m.line) ?? []
      arr.push([m.start, m.end])
      map.set(m.line, arr)
    }
    return map
  }, [matches])

  // Intercept Ctrl/Cmd+F while this preview is on screen; open + focus find.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F'))) return
      const el = containerRef.current
      if (el === null || el.offsetParent === null) return
      e.preventDefault()
      setFindOpen(true)
      requestAnimationFrame(() => inputRef.current?.select())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Virtualization: track the scroll container's viewport so only the visible
  // row window is mounted. A ResizeObserver keeps the height current; a scroll
  // listener updates the top offset.
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const sync = (): void => setViewport({ top: el.scrollTop, height: el.clientHeight })
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', sync); ro?.disconnect() }
  }, [])

  const total = lines.length
  const headerH = 0 // header is sticky and overlays; rows start at offset 0
  const first = Math.max(0, Math.floor((viewport.top - headerH) / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = viewport.height === 0 ? total : Math.ceil(viewport.height / ROW_HEIGHT) + OVERSCAN * 2
  const last = Math.min(total, first + visibleCount)

  // Keep the active match's row inside the mounted window before scrolling to
  // it: expand the window to include it, so scrollIntoView has a node to hit.
  const activeLine = matches.length > 0 ? matches[safeActive].line : -1
  const windowFirst = activeLine >= 0 ? Math.min(first, Math.max(0, activeLine - OVERSCAN)) : first
  const windowLast = activeLine >= 0 ? Math.max(last, Math.min(total, activeLine + OVERSCAN)) : last

  // Keep the active match scrolled into view as navigation moves. rAF waits for
  // the widened window to mount the row before scrolling to it.
  useEffect(() => {
    if (activeLine < 0) return
    const id = requestAnimationFrame(() => activeRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' }))
    return () => cancelAnimationFrame(id)
  }, [safeActive, matches, activeLine])

  const step = useCallback((delta: number) => {
    setActiveIndex((cur) => {
      if (matches.length === 0) return 0
      return (cur + delta + matches.length) % matches.length
    })
  }, [matches.length])

  const active = matches.length > 0 ? matches[safeActive] : null
  const findBox = findOpen ? h(FindBar, {
    inputRef, query, matches: matches.length, active: safeActive, caseSensitive,
    onChange: setQuery, onToggleCase: () => setCaseSensitive((c) => !c),
    onStep: step, onClose: () => setFindOpen(false), t,
  }) : null

  const header = (plain || findOpen) ? h('div', { key: 'hd', className: 'gp-files__header' }, [
    plain ? h('div', { key: 'note', className: 'gp-files__note' }, t('files.highlightOff')) : null,
    findBox,
  ]) : null

  // Only the [windowFirst, windowLast) rows are mounted; a top pad + total
  // height spacer preserve the scrollbar geometry so scrolling feels native.
  const windowRows: JSX.Element[] = []
  for (let i = windowFirst; i < windowLast; i++) {
    windowRows.push(h('div', { key: i, className: 'gp-files__row', style: { top: i * ROW_HEIGHT } }, [
      h('div', { key: 'n', className: 'gp-diff-no' }, i + 1),
      renderCodeLine(lines[i], i, highlighted?.[i], perLine.get(i), active, activeRef, t),
    ]))
  }

  return h('div', { className: 'gp-files__code gp-diff__scroll', ref: containerRef }, [
    header,
    h('div', { key: 'grid', className: 'gp-files__single gp-files__single--virt', style: { height: total * ROW_HEIGHT } }, windowRows),
  ])
}

/**
 * One code cell. Guard 2: an over-long line (e.g. minified/inlined content) is
 * truncated to a bounded width with a marker, and its syntax spans are dropped
 * — a single 40k-char cell would otherwise blow up layout and text-node cost.
 * Find matches on the line are wrapped in <mark>, preserving syntax spans.
 */
function renderCodeLine(
  line: string,
  i: number,
  spans: readonly HighlightSpan[] | undefined,
  ranges: ReadonlyArray<readonly [number, number]> | undefined,
  active: Match | null,
  activeRef: { current: HTMLElement | null },
  t: (key: GitKey, params?: Record<string, string | number>) => string,
): JSX.Element {
  if (line === '') return h('div', { key: `c${i}`, className: 'gp-diff-cell' }, '\u00a0')
  if (line.length > MAX_LINE_CHARS) {
    // A truncated giant line drops both syntax and match highlighting.
    return h('div', { key: `c${i}`, className: 'gp-diff-cell' }, [
      line.slice(0, MAX_LINE_CHARS),
      h('span', { key: 'trunc', className: 'gp-files__trunc' }, t('files.lineTruncated')),
    ])
  }
  if (ranges === undefined || ranges.length === 0) {
    return h('div', { key: `c${i}`, className: 'gp-diff-cell' }, spans !== undefined
      ? spans.map((span: HighlightSpan, j: number) => h('span', { key: j, style: span.style }, span.text))
      : line)
  }
  const activeRange = active !== null && active.line === i ? [active.start, active.end] as const : null
  return h('div', { key: `c${i}`, className: 'gp-diff-cell' }, markContent(line, ranges, spans, `c${i}`, activeRange, activeRef))
}
