/**
 * Files tab: a lazy directory tree of the working tree on the left, a preview
 * of the selected file on the right. Directories fetch their children on
 * expand (dir-list); files fetch content on select (file-content). Code/text
 * uses the platform's lazy syntax highlighter; images render inline, other
 * binaries show a placeholder. Left column width is drag-resizable.
 */
import { createElement as h, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import type { GitPanelRemote } from './rpc.js'
import { queryAs } from './rpc.js'
import type { DirEntry, GitSnapshot } from './types.js'
import type { GitKey } from './locales.js'
import { ArrowLeftIcon, CloseIcon, FullscreenIcon, InfoIcon, WrapIcon } from './icons.js'
import { useResizableColumn } from './resizable.js'
import { FileTypeIcon, IconFolderCloseRegular, IconFolderOpenRegular, languageForPath, MarkdownText, SegmentedControl, useCodeHighlighter, writeClipboard, type HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import { FindBar, markContent, matchRangesRaw, useDebounced, FIND_DEBOUNCE_MS, MAX_MATCHES } from './find.js'
import { ZoomableImage } from './ImageZoom.js'
import { FilePropsModal, type FilePropsInput } from './FilePropsModal.js'
import { useDialogFocus } from './dialog-focus.js'
import { buildTops, findWindowRange, windowRange } from './virtual-list.js'
import { useViewportTracker } from './use-viewport.js'
import { canCopyContent } from './copy-content.js'
import { createPathImages, type PathImages } from './path-images.js'
import { splitMermaidSegments, markdownKbdToCode, type MermaidSegment } from './mermaid-blocks.js'
import { MermaidFigure } from './MermaidFigure.js'

interface FilesTabProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  /** Compact (single-column drill-in) layout for a narrow panel. */
  readonly compact: boolean
  /** Work-tree generation (see Panel): a bump means a branch switch replaced the
   * files under the root, so the preserved browser state and the per-directory
   * cache are stale and must be dropped. */
  readonly worktreeGen: number
  /** Panel snapshot; null in the non-git degrade (properties then skip Git). */
  readonly snapshot: GitSnapshot | null
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
// The nowrap grid keeps rows fixed-height (long lines scroll horizontally)
// so the window math is exact; ROW_HEIGHT must match the .gp-files__row line
// box. Wrap mode leaves that grid for a flow layout where rows grow.
const ROW_HEIGHT = 20
const OVERSCAN = 12
// Assumed viewport height before the first layout measurement, so the initial
// paint mounts a bounded window instead of the whole file.
const VIEWPORT_FALLBACK = 600
// Wrap drops the fixed-height grid for flow layout, so every line mounts.
// Above either cap the view keeps the virtualized nowrap grid instead —
// mounting thousands of wrapping rows on the main thread stalls first paint
// (line count alone is not enough: a short file of 5000-char lines reaches
// tens of MB of layout work under the 10MB text read cap).
const MAX_WRAP_LINES = 2000
const MAX_WRAP_BYTES = 1024 * 1024

/** Whether the source body may use flow-layout wrapping for this content. */
function wrapCapOk(content: string, lines: number): boolean {
  return lines <= MAX_WRAP_LINES && content.length <= MAX_WRAP_BYTES
}

type FileState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly path: string }
  | { readonly kind: 'text'; readonly path: string; readonly content: string; readonly lines: number; readonly absolutePath?: string; readonly size?: number; readonly mtimeMs?: number }
  | { readonly kind: 'image'; readonly path: string; readonly dataUrl: string; readonly size?: number; readonly mtimeMs?: number }
  | { readonly kind: 'binary'; readonly path: string; readonly size?: number; readonly mtimeMs?: number }
  | { readonly kind: 'tooLarge'; readonly path: string; readonly size?: number; readonly mtimeMs?: number }
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
  /** Source-view word wrap (default on); nowrap scrolls horizontally. */
  readonly wrap: boolean
  /** Compact drill pane ('tree' = list, 'preview' = open file); wide ignores it. */
  readonly pane: 'tree' | 'preview'
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

export function FilesTab({ remote, sessionId, compact, worktreeGen, snapshot, t }: FilesTabProps): JSX.Element {
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
  const [wrap, setWrap] = useState(() => init?.wrap ?? true)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [copyContentState, setCopyContentState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [showProps, setShowProps] = useState(false)
  // Compact-only fullscreen viewer (rendered with the current source/render mode).
  const [fullscreen, setFullscreen] = useState(false)
  // Compact drill-in: 'tree' lists the working tree, 'preview' shows the file.
  // Ignored by the wide layout (tree + preview side by side).
  const [pane, setPane] = useState<'tree' | 'preview'>(() => init?.pane ?? 'tree')
  // Instance-scoped ids for the official source/render SegmentedControl: its
  // tabs name `<id>-<value>-panel`, so compact keeps one panel per mode.
  const modeId = useId()
  const markdownLabels = useMemo(() => ({ code: { copyLabel: t('files.copy'), copiedLabel: t('files.copied') }, footnotes: t('files.footnotes') }), [t])
  // Official local-image contract: rendered Markdown resolves relative image
  // destinations beside the document through the authenticated api/file
  // route. Identity stays stable per loaded file so MarkdownText's parse is
  // not repeated on unrelated re-renders (find, toolbar state).
  const pathImages = useMemo(
    () => file.kind === 'text' && file.absolutePath !== undefined ? createPathImages(document.baseURI, file.absolutePath) : undefined,
    [file],
  )
  // The rendered-Markdown document (mermaid split + kbd rewrite) derives from
  // the file content, so it is computed once per loaded file. Unrelated
  // re-renders (find input, column drag, toolbar, snapshot ticks) reuse the
  // same segment identities instead of re-splitting the whole text per frame.
  const markdownSegments = useMemo<MermaidSegment[] | undefined>(() => {
    if (file.kind !== 'text') return undefined
    return splitMermaidSegments(file.content).map((segment) => segment.kind === 'mermaid'
      ? segment
      : { kind: 'markdown' as const, text: markdownKbdToCode(segment.text) })
  }, [file])
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

  // A branch switch replaces every file under the root: drop the preserved
  // state (and the sticky cache a remount would restore from) and start over
  // from the new root listing. The first run only records the initial value —
  // on mount the props are already current.
  const genRef = useRef(worktreeGen)
  useEffect(() => {
    if (genRef.current === worktreeGen) return
    genRef.current = worktreeGen
    filesCache.delete(sessionId)
    setDirs(new Map())
    setOpen(new Set(['']))
    setSelected(null)
    setFile({ kind: 'idle' })
    setPane('tree')
    loadDir('')
  }, [worktreeGen, sessionId, loadDir])

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
    if (compact) setPane('preview')
    // Rendered view is the default for Markdown; HTML defaults to source so a
    // page never auto-executes on selection — the user opts into the preview.
    setRenderMarkdown(!isHtmlPath(path))
    setCopyState('idle')
    setCopyContentState('idle')
    setShowProps(false)
    const seq = ++fileSeq.current
    setFile({ kind: 'loading', path })
    void remote.query({ sessionId, query: { kind: 'file-content', path } }).then((res) => {
      if (seq !== fileSeq.current) return
      const fc = queryAs(res, 'file-content')
      if (fc === null) { setFile({ kind: 'error', path }); return }
      const stat = { ...(fc.size !== undefined ? { size: fc.size } : {}), ...(fc.mtimeMs !== undefined ? { mtimeMs: fc.mtimeMs } : {}) }
      if (fc.tooLarge === true) { setFile({ kind: 'tooLarge', path, ...stat }); return }
      if (fc.variant === 'image' && fc.dataUrl !== undefined) { setFile({ kind: 'image', path, dataUrl: fc.dataUrl, ...stat }); return }
      if (fc.variant === 'text') { setFile({ kind: 'text', path, content: fc.content ?? '', lines: fc.lines ?? 0, ...stat, ...(fc.absolutePath !== undefined ? { absolutePath: fc.absolutePath } : {}) }); return }
      setFile({ kind: 'binary', path, ...stat })
    }).catch(() => { if (seq === fileSeq.current) setFile({ kind: 'error', path }) })
  }, [remote, sessionId, compact])

  // Persist the browsing state when the panel unmounts (view-tab switch or
  // session change) so a quick return restores it; a ref carries the latest
  // values into the unmount-only cleanup.
  const liveRef = useRef<FilesState>({ dirs, open, selected, file, renderMarkdown, wrap, pane })
  liveRef.current = { dirs, open, selected, file, renderMarkdown, wrap, pane }
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

  // Both copy actions go through the platform helper: its async Clipboard path
  // is unavailable on a remote plain-HTTP origin (non-secure context, no
  // `navigator.clipboard`), where it falls back to `execCommand('copy')`.
  const copyPath = async (): Promise<void> => {
    if (selected === null) return
    const seq = fileSeq.current
    const ok = await writeClipboard(selected)
    if (seq !== fileSeq.current) return
    setCopyState(ok ? 'copied' : 'error')
  }

  const copyContent = async (): Promise<void> => {
    // Re-checked at click time: only a loaded text document under the copy
    // envelope may reach the clipboard, never binary/image/oversized bodies.
    if (file.kind !== 'text' || !canCopyContent(file)) return
    const seq = fileSeq.current
    const ok = await writeClipboard(file.content)
    if (seq !== fileSeq.current) return
    setCopyContentState(ok ? 'copied' : 'error')
  }

  // Properties dialog input: the loaded preview already carries path/size/
  // mtime/lines; the ignored flag comes from the parent dir's listing entry.
  const propsInput: FilePropsInput | null = (() => {
    if (selected === null) return null
    if (file.kind !== 'text' && file.kind !== 'image' && file.kind !== 'binary' && file.kind !== 'tooLarge') return null
    const slash = selected.lastIndexOf('/')
    const parent = slash < 0 ? '' : selected.slice(0, slash)
    const name = slash < 0 ? selected : selected.slice(slash + 1)
    const parentListing = dirs.get(parent)
    const entry: DirEntry | undefined = parentListing?.status === 'ready'
      ? parentListing.entries.find((e) => !e.dir && e.name === name)
      : undefined
    return {
      path: selected,
      kind: file.kind,
      ...(file.size !== undefined ? { size: file.size } : {}),
      ...(file.mtimeMs !== undefined ? { mtimeMs: file.mtimeMs } : {}),
      ...(file.kind === 'text' ? { lines: file.lines } : {}),
      ...(file.kind === 'image' ? { dataUrl: file.dataUrl } : {}),
      ignored: entry?.ignored === true,
    }
  })()

  const treeBlock = h('div', { key: 'left', className: 'gp-files__tree', style: compact ? undefined : { flex: `0 0 ${leftCol.width}px` } }, treeRows)

  const richPreview = file.kind === 'text' && isRichPath(file.path)
  // One definition per toolbar control; the compact and wide bars compose the
  // same nodes so a new mode / action cannot land on only one layout.
  const modeSeg = richPreview
    ? h(SegmentedControl, {
      key: 'mode',
      className: 'gp-files__mode-seg',
      id: modeId,
      label: t('files.previewMode'),
      value: renderMarkdown ? 'render' : 'source',
      options: [
        { value: 'source', label: t('files.source') },
        { value: 'render', label: t('files.render') },
      ],
      onChange: (next: string) => setRenderMarkdown(next === 'render'),
    })
    : null
  const fullscreenButton = file.kind === 'text'
    ? h('button', {
      key: 'full', type: 'button', className: 'gp-files__props',
      title: t('files.fullscreen'), 'aria-label': t('files.fullscreen'),
      onClick: () => setFullscreen(true),
    }, h(FullscreenIcon, { size: 14 }))
    : null
  // Word wrap only affects the source/code body (rendered Markdown already wraps).
  // Over the wrap cap the toggle stays visible but disabled — hiding it would
  // discard the preference with no explanation (the body falls back to nowrap).
  const isTextSource = file.kind === 'text' && (richPreview ? !renderMarkdown : true)
  const capOk = file.kind === 'text' ? wrapCapOk(file.content, file.lines) : false
  const wrapButton = isTextSource
    ? h('button', {
      key: 'wrap', type: 'button', className: 'gp-files__props',
      title: capOk ? t('files.wrap') : t('files.wrapDisabled'),
      'aria-label': t('files.wrap'),
      'aria-pressed': capOk && wrap,
      disabled: !capOk,
      onClick: () => setWrap((w) => !w),
    }, h(WrapIcon, { size: 14 }))
    : null
  const propsButton = h('button', {
    key: 'props', type: 'button', className: 'gp-files__props',
    title: t('files.propsTitle'), 'aria-label': t('files.propsTitle'),
    disabled: propsInput === null, onClick: () => setShowProps(true),
  }, h(InfoIcon, { size: 14 }))
  // Compact toolbar: back + the official source/render switcher + fullscreen +
  // properties. The relative path and the copy buttons leave the phone row —
  // they are what made it wrap onto three lines.
  const compactBar = compact
    ? h('div', { key: 'bar', className: 'gp-files__bar gp-files__bar--compact' }, [
      h('button', { key: 'back', type: 'button', className: 'gp-subhead__back', onClick: () => setPane('tree') }, [h(ArrowLeftIcon, { key: 'i', size: 14 }), t('files.backToTree')]),
      modeSeg,
      // Trailing icons keep their own right-aligned group: without the mode
      // switcher (plain files) they would otherwise sit next to the back button.
      h('div', { key: 'end', className: 'gp-files__bar-end' }, [wrapButton, fullscreenButton, propsButton]),
    ])
    : null

  const wideBar = compact
    ? null
    : h('div', { key: 'bar', className: 'gp-files__bar' }, [
      h('code', { key: 'path', className: 'gp-files__path', title: selected ?? '' }, selected ?? ''),
      modeSeg,
      // The two copy actions form one joined button group (collapsed shared
      // border); a lone visible button keeps the full pill radius.
      h('div', { key: 'copy', className: 'gp-files__copy-group' }, [
        h('button', {
          key: 'copy-path', type: 'button', className: `gp-files__copy-path${copyState === 'error' ? ' gp-files__copy-path--error' : ''}`,
          'aria-live': 'polite', onClick: () => { void copyPath() },
        }, t(copyState === 'copied' ? 'files.pathCopied' : copyState === 'error' ? 'files.pathCopyFailed' : 'files.copyPath')),
        // Hidden (not disabled) for binary/image/too-large/error previews and
        // for documents at/above the copy envelope — no dead control to click.
        canCopyContent(file)
          ? h('button', {
            key: 'copy-content', type: 'button', className: `gp-files__copy-path${copyContentState === 'error' ? ' gp-files__copy-path--error' : ''}`,
            'aria-live': 'polite', onClick: () => { void copyContent() },
          }, t(copyContentState === 'copied' ? 'files.contentCopied' : copyContentState === 'error' ? 'files.contentCopyFailed' : 'files.copyContent'))
          : null,
      ]),
      wrapButton,
      fullscreenButton,
      propsButton,
    ])

  // One role=tabpanel per mode in both layouts (the switcher's aria-controls
  // must always resolve); only the active one mounts the preview body.
  const previewContent = richPreview
    ? [
      h('div', {
        key: 'src', id: `${modeId}-source-panel`, role: 'tabpanel', 'aria-labelledby': `${modeId}-source`,
        style: renderMarkdown ? { display: 'none' } : { display: 'contents' },
      }, renderMarkdown ? null : renderContent(file, false, wrap, markdownLabels, pathImages, markdownSegments, t)),
      h('div', {
        key: 'rnd', id: `${modeId}-render-panel`, role: 'tabpanel', 'aria-labelledby': `${modeId}-render`,
        style: renderMarkdown ? { display: 'contents' } : { display: 'none' },
      }, renderMarkdown ? renderContent(file, true, wrap, markdownLabels, pathImages, markdownSegments, t) : null),
    ]
    : renderContent(file, renderMarkdown, wrap, markdownLabels, pathImages, markdownSegments, t)

  const previewBlock = h('div', { key: 'right', className: 'gp-files__preview' }, [
    selected !== null ? (compact ? compactBar : wideBar) : null,
    h('div', { key: 'content', className: 'gp-files__preview-content' }, previewContent),
    fullscreen && selected !== null && file.kind === 'text'
      ? h(FileFullscreen, { key: 'full', file, renderMarkdown, wrap, markdownLabels, pathImages, markdownSegments, onClose: () => setFullscreen(false), t })
      : null,
    propsInput !== null && showProps
      ? h(FilePropsModal, { key: 'props-modal', input: propsInput, snapshot, onClose: () => setShowProps(false), t })
      : null,
  ])

  // Compact: a single column drilling from the tree into the file preview.
  if (compact) {
    return h('div', { className: 'gp-files gp-files--compact' }, pane === 'preview' ? previewBlock : treeBlock)
  }

  return h('div', { className: 'gp-files' }, [
    treeBlock,
    leftCol.divider,
    previewBlock,
  ])
}

/** Preview body: rendered Markdown/HTML when the mode is on, else raw preview. */
function renderContent(
  file: FileState,
  renderMarkdown: boolean,
  wrap: boolean,
  markdownLabels: { code: { copyLabel: string; copiedLabel: string }; footnotes: string },
  pathImages: PathImages | undefined,
  markdownSegments: MermaidSegment[] | undefined,
  t: (key: GitKey, params?: Record<string, string | number>) => string,
): JSX.Element {
  if (file.kind === 'text' && renderMarkdown && isMarkdownPath(file.path) && markdownSegments !== undefined) {
    const markdownProps = { labels: markdownLabels, variant: 'body' as const, ...(pathImages !== undefined ? { pathImages } : {}) }
    if (markdownSegments.length === 1 && markdownSegments[0].kind === 'markdown') {
      return h('div', { className: 'gp-files__markdown' }, h(MarkdownText, { text: markdownSegments[0].text, ...markdownProps }))
    }
    // Mermaid fences render through the lazy engine chunk; every other
    // segment stays on the official MarkdownText, in document order, with
    // kbd hints already rewritten (see the memoized markdownSegments).
    return h('div', { className: 'gp-files__markdown' }, markdownSegments.map((segment, index) => segment.kind === 'mermaid'
      ? h(MermaidFigure, { key: index, source: segment.source, t })
      : h(MarkdownText, { key: index, text: segment.text, ...markdownProps })))
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
  return renderPreview(file, wrap, t)
}

/**
 * Fullscreen reader: the current preview re-rendered in the shell's
 * near-fullscreen modal, with the mode chosen in the panel toolbar. Escape,
 * the backdrop and the close button dismiss it; focus moves into the dialog
 * and returns to the toolbar control (shared dialog lifecycle).
 */
function FileFullscreen(props: {
  file: FileState
  renderMarkdown: boolean
  wrap: boolean
  markdownLabels: { code: { copyLabel: string; copiedLabel: string }; footnotes: string }
  pathImages: PathImages | undefined
  markdownSegments: MermaidSegment[] | undefined
  onClose: () => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}): JSX.Element | null {
  const { file, renderMarkdown, wrap, markdownLabels, pathImages, markdownSegments, onClose, t } = props
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  useDialogFocus(dialogRef, onClose, closeRef)
  if (typeof document === 'undefined' || file.kind !== 'text') return null
  return createPortal(h('div', {
    className: 'gp-modal-backdrop',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) onClose() },
  }, h('div', { ref: dialogRef, className: 'gp-modal', role: 'dialog', 'aria-modal': true, 'aria-label': t('files.fullscreen') }, [
    h('div', { key: 'bar', className: 'gp-modal__bar' }, [
      h('code', { key: 'path', className: 'gp-modal__path', title: file.path }, file.path),
      h('button', {
        key: 'close', ref: closeRef, type: 'button', className: 'gp-icon-btn gp-modal__close',
        title: t('common.close'), 'aria-label': t('common.close'), onClick: onClose,
      }, h(CloseIcon, { size: 15 })),
    ]),
    h('div', { key: 'scroll', className: 'gp-modal__scroll' },
      h('div', { key: 'body', className: 'gp-files__preview-content' }, renderContent(file, renderMarkdown, wrap, markdownLabels, pathImages, markdownSegments, t))),
  ])), document.body, 'file-fullscreen')
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
    return [h('div', { key: `l${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 8 + depth * 16 } }, cb.t('common.loading'))]
  }
  if (loaded.status === 'error') {
    return [h('div', { key: `e${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 8 + depth * 16 } }, cb.t('files.loadFailed'))]
  }
  const rows: JSX.Element[] = []
  for (const entry of loaded.entries) {
    const path = dirPath === '' ? entry.name : `${dirPath}/${entry.name}`
    if (entry.dir) {
      const isOpen = cb.open.has(path)
      rows.push(h('button', {
        key: path, type: 'button', className: `gp-tree-row gp-files__entry gp-files__entry--dir${entry.ignored ? ' gp-tree-row--ignored' : ''}`,
        style: { paddingLeft: 8 + depth * 16 }, 'aria-expanded': isOpen,
        'aria-label': entry.ignored ? `${entry.name} (${cb.t('files.ignored')})` : entry.name,
        onClick: () => cb.toggleDir(path),
      }, [
        // The official file lists mark expansion with the folder glyph itself
        // instead of a separate chevron.
        h('span', { key: 'i', className: 'gp-tree-ic' }, isOpen
          ? h(IconFolderOpenRegular, { size: 16 })
          : h(IconFolderCloseRegular, { size: 16 })),
        h('span', { key: 'n', className: 'gp-tree-name' }, entry.name),
      ]))
      if (isOpen) rows.push(...renderTree(path, depth + 1, cb))
    } else {
      const active = cb.selected === path
      rows.push(h('button', {
        key: path, type: 'button', className: `gp-tree-row gp-files__entry${active ? ' gp-tree-row--active' : ''}${entry.ignored ? ' gp-tree-row--ignored' : ''}`,
        style: { paddingLeft: 8 + depth * 16 }, 'aria-current': active ? 'true' : undefined,
        'aria-label': entry.ignored ? `${entry.name} (${cb.t('files.ignored')})` : entry.name,
        onClick: () => cb.selectFile(path),
      }, [
        h('span', { key: 'i', className: 'gp-tree-ic' }, h(FileTypeIcon, { path, size: 16 })),
        h('span', { key: 'n', className: 'gp-tree-name' }, entry.name),
      ]))
    }
  }
  if (loaded.truncated) {
    rows.push(h('div', { key: `t${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 8 + depth * 16 } }, cb.t('files.truncated')))
  }
  return rows
}

function renderPreview(file: FileState, wrap: boolean, t: (key: GitKey, params?: Record<string, string | number>) => string): JSX.Element {
  switch (file.kind) {
    case 'idle': return h('div', { className: 'gp-empty' }, t('files.selectFile'))
    case 'loading': return h('div', { className: 'gp-empty' }, t('common.loading'))
    case 'error': return h('div', { className: 'gp-empty' }, t('files.loadFailed'))
    case 'tooLarge': return h('div', { className: 'gp-empty' }, t('files.tooLarge'))
    case 'binary': return h('div', { className: 'gp-empty' }, t('files.binary'))
    case 'image':
      return h(ZoomableImage, { src: file.dataUrl, alt: file.path, t, viewportClass: 'gp-files__image' })
    case 'text':
      return h(CodePreview, { content: file.content, path: file.path, wrap, t })
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
function CodePreview({ content, path, wrap, t }: { content: string; path: string; wrap: boolean; t: (key: GitKey, params?: Record<string, string | number>) => string }): JSX.Element {
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
  const { setEl: setContainerEl, viewport, elRef: containerRef } = useViewportTracker()
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

  // Virtualization: mount only the rows in (or near) the viewport. Uniform row
  // height, so the window math reuses the shared prefix-sum helpers. Wrap mode
  // drops the fixed-height grid for flow layout (rows grow), so the window
  // math no longer applies and every line mounts instead — gated by wrapCapOk
  // so a huge file keeps the virtualized nowrap grid.
  const total = lines.length
  const wrapActive = wrap && wrapCapOk(content, total)
  const tops = useMemo(() => buildTops(new Array<number>(total).fill(ROW_HEIGHT)), [total])
  const effHeight = viewport.height > 0 ? viewport.height : VIEWPORT_FALLBACK
  const { first, last } = windowRange(tops, viewport.top, effHeight, OVERSCAN * ROW_HEIGHT)

  // Keep the active match mounted so scrollIntoView has a node to hit;
  // findWindowRange snaps onto a match outside the window instead of spanning
  // the gap to it — a span would mount every intervening row in one commit.
  const activeLine = matches.length > 0 ? matches[safeActive].line : -1
  const { first: windowFirst, last: windowLast } = wrapActive
    ? { first: 0, last: total }
    : findWindowRange({ first, last }, activeLine, total, OVERSCAN)

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

  // Only the [windowFirst, windowLast) rows are mounted in the virtualized
  // (nowrap) grid; a top pad + total height spacer preserve the scrollbar
  // geometry so scrolling feels native. Wrap mode is a plain flow list.
  const windowRows: JSX.Element[] = []
  for (let i = windowFirst; i < windowLast; i++) {
    windowRows.push(h('div', { key: i, className: 'gp-files__row', style: wrapActive ? undefined : { top: i * ROW_HEIGHT } }, [
      h('div', { key: 'n', className: 'gp-diff-no' }, i + 1),
      renderCodeLine(lines[i], i, highlighted?.[i], perLine.get(i), active, activeRef, t),
    ]))
  }

  return h('div', { className: `gp-files__code gp-diff__scroll${wrapActive ? ' gp-files__code--wrap' : ' gp-files__code--nowrap'}`, ref: setContainerEl }, [
    header,
    h('div', {
      key: 'grid',
      className: 'gp-files__single gp-files__single--virt',
      ...(wrapActive ? {} : { style: { height: total * ROW_HEIGHT } }),
    }, windowRows),
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
