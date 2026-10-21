/**
 * Files tab: a lazy directory tree of the working tree on the left, a preview
 * of the selected file on the right. Directories fetch their children on
 * expand (dir-list); files fetch content on select (file-content). Code/text
 * uses the platform's lazy syntax highlighter; images render inline, other
 * binaries show a placeholder. Left column width is drag-resizable.
 */
import { createElement as h, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
import type { GitPanelRemote } from './rpc.js'
import { queryAs } from './rpc.js'
import type { DirEntry, GitSnapshot } from './types.js'
import type { GitKey } from './locales.js'
import { ArrowLeftIcon, CloseIcon, ExitFullscreenIcon, FullscreenIcon, InfoIcon, RefreshIcon, WrapIcon } from './icons.js'
import { useResizableColumn, useStackedSplit } from './resizable.js'
import { FileTypeIcon, IconFolderCloseRegular, IconFolderOpenRegular, MarkdownText, SegmentedControl, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { FilePropsModal, type FilePropsInput } from './FilePropsModal.js'
import { useDialogFocus } from './dialog-focus.js'
import { canCopyContent } from './copy-content.js'
import { createPathImages, type PathImages } from './path-images.js'
import { splitMermaidSegments, markdownKbdToCode, type MermaidSegment } from './mermaid-blocks.js'
import { createStaticHtmlDocument, HTML_HEAVY_SCRIPT_BYTES, inlineScriptBytes, looksScriptRendered, packHtmlDocument, withReadyPing } from './html-pack.js'
import { formatBytes } from './bytes.js'
import { canOpenLocally } from './local-origin.js'
import { renderModalShell } from './ops-modals.js'
import { inertAttr } from './inert.js'
import { HtmlFrame, type HtmlFrameSpec } from './HtmlFrame.js'
import { MermaidFigure } from './MermaidFigure.js'
import { renderPreview, type FileState } from './files-preview.js'
import { wrapCapOk } from './wrap-cap.js'

interface FilesTabProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  /** Compact (single-column drill-in) layout for a narrow panel. */
  readonly compact: boolean
  /** Stacked layout: a tall narrow right sidebar — tree above, preview below,
   * selection updates the preview in place (no drilling). */
  readonly stacked: boolean
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


/** HTML asset pack for the loaded document: in flight, rewritten srcdoc, or a
 * deliberate fall-back to the plain bytes (no packable assets, a base element,
 * an oversized document, or any pack failure). */
type HtmlPackState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly file: FileState }
  | { readonly status: 'ready'; readonly file: FileState; readonly srcdoc: string }
  | { readonly status: 'plain'; readonly file: FileState }

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
/** Pending eviction per session, so a parked entry never outlives its window. */
const filesEvict = new Map<string, ReturnType<typeof setTimeout>>()

function stashFilesState(sessionId: string, state: FilesState): void {
  // A mid-flight load can't resume after remount; persist it as idle so the
  // restore path re-selects and refetches the file.
  const file: FileState = state.file.kind === 'loading' ? { kind: 'idle' } : state.file
  filesCache.set(sessionId, { state: { ...state, file }, leftAt: Date.now() })
  // A parked entry holds the loaded document text (up to the read cap), so it
  // is dropped when the restore window closes — not whenever some tab happens
  // to mount again and notice the expiry.
  const pending = filesEvict.get(sessionId)
  if (pending !== undefined) clearTimeout(pending)
  filesEvict.set(sessionId, setTimeout(() => {
    filesEvict.delete(sessionId)
    const entry = filesCache.get(sessionId)
    if (entry !== undefined && Date.now() - entry.leftAt >= FILES_STICKY_MS) filesCache.delete(sessionId)
  }, FILES_STICKY_MS + 1_000))
}

function restoreFilesState(sessionId: string): FilesState | null {
  const entry = filesCache.get(sessionId)
  if (entry === undefined) return null
  if (Date.now() - entry.leftAt > FILES_STICKY_MS) { filesCache.delete(sessionId); return null }
  return entry.state
}

export function FilesTab({ remote, sessionId, compact, stacked, worktreeGen, snapshot, t }: FilesTabProps): JSX.Element {
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
  // Script permission for the rendered HTML view. On by default so a page
  // renders the way a browser would (the official preview keeps this behind a
  // developer switch); turning it off gives a static, script-free document.
  const [htmlScripts, setHtmlScripts] = useState(true)
  const [wrap, setWrap] = useState(() => init?.wrap ?? true)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [copyContentState, setCopyContentState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [showProps, setShowProps] = useState(false)
  // The fullscreen reader restyles this tab's own preview in place instead of
  // rendering a second copy: a rendered HTML page keeps its document (a new
  // frame would re-run its scripts) and a code view keeps scroll and find state.
  const [fullscreen, setFullscreen] = useState(false)
  // Browser fullscreen of the reader card, tracked from the browser's own state.
  const [screenFull, setScreenFull] = useState(false)
  const fsCardRef = useRef<HTMLDivElement | null>(null)
  const fsCloseRef = useRef<HTMLButtonElement | null>(null)
  const fsTriggerRef = useRef<HTMLButtonElement | null>(null)
  // Compact drill-in: 'tree' lists the working tree, 'preview' shows the file.
  // Ignored by the wide layout (tree + preview side by side).
  const [pane, setPane] = useState<'tree' | 'preview'>(() => init?.pane ?? 'tree')
  // Manual refresh from the tree's floating button: re-lists the open
  // directories and re-reads the selected file. `refreshFlight` keeps one
  // refresh at a time (the button is disabled while it runs). `dirGen` drops
  // every listing a branch switch made stale; `dirSeq` keeps the newest request
  // per directory, so an older listing that lands last cannot overwrite a
  // refresh that already arrived.
  const [refreshing, setRefreshing] = useState(false)
  const refreshFlight = useRef(false)
  const dirGen = useRef(0)
  const dirSeq = useRef(new Map<string, number>())
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

  // HTML asset pack (ADR-0020): relative css/js is read through the host's
  // validated file-content route and rewritten to `data:` URLs before the
  // document is serialized. Keyed on the loaded file object (same identity
  // memo as pathImages/markdownSegments); a stale in-flight pack is dropped by
  // object identity. Packing runs only while the rendered view is on — HTML
  // defaults to source, so selection alone never reads extra files. Any pack
  // failure falls back to the plain bytes.
  const htmlMode: 'static' | 'interactive' = htmlScripts ? 'interactive' : 'static'
  // A document whose own scripts weigh more than the panel is willing to wait
  // for is confirmed before its frame is mounted: the page's scripts run
  // before it paints, and a multi-megabyte report can hold the frame blank
  // for a dozen seconds. The frame is isolated, so the panel stays usable —
  // but the preview looks broken during the wait, and the user should know
  // that up front rather than watch a mask.
  const heavyScriptBytes = useMemo(() => {
    if (file.kind !== 'text' || !isHtmlPath(file.path)) return 0
    return inlineScriptBytes(file.content)
  }, [file])
  const heavyDocument = heavyScriptBytes >= HTML_HEAVY_SCRIPT_BYTES
  // The user has approved this document's render (or it is light enough to
  // need no approval). Keyed on the file, so another file asks again.
  const [heavyApproved, setHeavyApproved] = useState<string | null>(null)
  // "Open it outside the panel" is only meaningful on the machine that has the
  // file: a loopback GUI means the server and the reader share a disk.
  const heavyCanOpen = useMemo(
    () => canOpenLocally(typeof location === 'undefined' ? '' : location.hostname),
    [],
  )
  const [openExternal, setOpenExternal] = useState<{ readonly busy: boolean; readonly error: string | null }>({ busy: false, error: null })
  const openFileExternally = useCallback(async (): Promise<void> => {
    if (file.kind !== 'text') return
    setOpenExternal({ busy: true, error: null })
    const res = await remote.openFile({ sessionId, path: file.path })
    if (res.ok) {
      // The page now lives in the system browser; leave the source view here so
      // nothing tries to mount a frame on top of a page that is being painted
      // somewhere else.
      setOpenExternal({ busy: false, error: null })
      setRenderMarkdown(false)
      return
    }
    setOpenExternal({ busy: false, error: t('files.htmlOpenFailed') })
  }, [file, remote, sessionId, t])
  const htmlPath = file.kind === 'idle' ? null : file.path
  const heavyPending = heavyDocument && renderMarkdown && htmlMode === 'interactive' && htmlPath !== null && heavyApproved !== htmlPath
  // The user stopped the render from the mask: the frame is unmounted and the
  // source view takes over again, so a page that never paints cannot trap the
  // panel.
  const [htmlStopped, setHtmlStopped] = useState<string | null>(null)
  const [htmlPack, setHtmlPack] = useState<HtmlPackState>({ status: 'idle' })
  useEffect(() => {
    if (file.kind !== 'text' || !isHtmlPath(file.path) || !renderMarkdown || htmlMode !== 'interactive' || heavyPending || htmlStopped === file.path) {
      setHtmlPack((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }))
      return
    }
    let cancelled = false
    setHtmlPack({ status: 'loading', file })
    const readText = async (path: string): Promise<string | null> => {
      const res = await remote.query({ sessionId, query: { kind: 'file-content', path } })
      const fc = queryAs(res, 'file-content')
      if (fc === null || fc.variant !== 'text' || fc.content === undefined || fc.tooLarge === true) return null
      return fc.content
    }
    void packHtmlDocument(file.content, file.path, readText).then((srcdoc) => {
      if (cancelled) return
      setHtmlPack(srcdoc === null ? { status: 'plain', file } : { status: 'ready', file, srcdoc })
    }).catch(() => {
      if (!cancelled) setHtmlPack({ status: 'plain', file })
    })
    return () => { cancelled = true }
  }, [file, renderMarkdown, htmlMode, remote, sessionId, heavyPending, htmlStopped])

  // Interactive documents are handed to the iframe through a blob: URL, never
  // srcdoc: a frame with a URL of its own goes into a separate renderer
  // process, so a heavy page's scripts cannot block the panel.
  const htmlInteractiveDoc = useMemo<string | undefined>(() => {
    if (file.kind !== 'text' || !isHtmlPath(file.path) || !renderMarkdown || htmlMode !== 'interactive') return undefined
    // Only a pack that settled for THIS file yields a document: mounting the
    // raw bytes first would start the page once, then throw it away when the
    // packed document arrives (a double script run on a heavy page).
    if (htmlPack.status === 'idle' || htmlPack.file !== file) return undefined
    return htmlPack.status === 'ready' ? htmlPack.srcdoc : htmlPack.status === 'plain' ? file.content : undefined
  }, [file, renderMarkdown, htmlMode, htmlPack])
  // The blob URL is an effect, not a memo: a render that React throws away
  // would leak an object URL that pins the whole document. The document it was
  // built from travels with it, so a stale URL is never handed to the frame.
  const [htmlBlob, setHtmlBlob] = useState<{ readonly doc: string; readonly url: string } | undefined>(undefined)
  useEffect(() => {
    if (htmlInteractiveDoc === undefined) { setHtmlBlob(undefined); return }
    const url = URL.createObjectURL(new Blob([withReadyPing(htmlInteractiveDoc)], { type: 'text/html' }))
    setHtmlBlob({ doc: htmlInteractiveDoc, url })
    return () => { URL.revokeObjectURL(url) }
  }, [htmlInteractiveDoc])

  // The iframe body for the rendered HTML view: null while a pack is in
  // flight (hold the source preview instead of flashing an unstyled page),
  // undefined when this is not a rendered HTML preview.
  const htmlFrame = useMemo<HtmlFrameSpec | null | undefined>(() => {
    if (file.kind !== 'text' || !isHtmlPath(file.path) || !renderMarkdown) return undefined
    if (htmlMode === 'static') return { kind: 'static', srcdoc: createStaticHtmlDocument(file.content) }
    // A heavy document waits for the user's confirmation, and a stopped render
    // stays stopped: neither may mount a frame.
    if (heavyPending || htmlStopped === file.path) return undefined
    return htmlBlob !== undefined && htmlBlob.doc === htmlInteractiveDoc ? { kind: 'interactive', src: htmlBlob.url } : null
  }, [file, renderMarkdown, htmlMode, htmlBlob, htmlInteractiveDoc, heavyPending, htmlStopped])

  // A static preview of a script-rendered page is blank, which looks like a
  // bug. Offer the explicit way back to a running page instead, but only when
  // the document really renders through its scripts (a styled page with a
  // small script still shows its content and needs no warning).
  // Only the static preview needs the verdict, and the scan reads the whole
  // document: skip it while the page is going to run anyway.
  const scriptRendered = useMemo(
    () => htmlMode === 'static' && file.kind === 'text' && isHtmlPath(file.path) && renderMarkdown && looksScriptRendered(file.content),
    [file, renderMarkdown, htmlMode],
  )
  // Present only while a script-rendered document sits in the static preview.
  const htmlHint = useMemo<{ readonly run: () => void } | undefined>(
    () => (!scriptRendered || htmlFrame?.kind !== 'static' ? undefined : { run: () => setHtmlScripts(true) }),
    [scriptRendered, htmlFrame],
  )
  // Stopping a render unmounts the frame and returns to the source view: the
  // page's scripts are gone with the frame, and the user gets their document
  // back instead of an empty preview.
  const stopHtmlRender = useCallback(() => {
    if (file.kind !== 'text') return
    setHtmlStopped(file.path)
    setRenderMarkdown(false)
  }, [file])
  // The stop control belongs to the interactive frame only: a static preview
  // commits in the same task and has no wait to end.
  const htmlStop = htmlFrame?.kind === 'interactive' ? stopHtmlRender : undefined

  // Browser fullscreen belongs to the browser: the system UI or Esc can leave
  // it, so the button mirrors `fullscreenchange` instead of a local flag. Only
  // this card counts — another element going full screen is not our state.
  useEffect(() => {
    const sync = (): void => setScreenFull(document.fullscreenElement === fsCardRef.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  const closeFullscreen = useCallback(() => {
    if (document.fullscreenElement !== null && document.fullscreenElement === fsCardRef.current) {
      void document.exitFullscreen().catch(() => undefined)
    }
    setFullscreen(false)
  }, [])
  const toggleScreenFull = useCallback(() => {
    const card = fsCardRef.current
    if (card === null) return
    if (document.fullscreenElement === card) { void document.exitFullscreen().catch(() => undefined); return }
    // A host that denies fullscreen (a Permissions-Policy on an embedded GUI)
    // rejects here; the button follows the browser's state, so all that is left
    // is to say the request did not happen.
    void card.requestFullscreen().catch((error: unknown) => { console.warn('git-panel: full screen was refused', error) })
  }, [])

  const leftCol = useResizableColumn({ storageKey: 'gp.files.left', initial: 300, min: 180, reserve: 220, edge: 'end' })
  // Stacked only reads it here (hooks run unconditionally); the shared split
  // keeps this tab's bands aligned with the overview and changes tabs.
  const split = useStackedSplit()

  // Listing of one directory. `force` re-reads a directory that is already
  // listed, keeping its current entries mounted until the new listing lands;
  // the normal path only starts a listing that is missing or failed. A
  // response from before a branch switch is dropped by `dirGen`; a response
  // superseded by a newer request for the same directory is dropped by
  // `dirSeq`, whichever order they arrive in.
  const loadDir = useCallback((path: string, force = false): Promise<void> => {
    const gen = dirGen.current
    const seq = (dirSeq.current.get(path) ?? 0) + 1
    dirSeq.current.set(path, seq)
    const current = (): boolean => gen === dirGen.current && dirSeq.current.get(path) === seq
    setDirs((prev) => {
      const cur = prev.get(path)
      if (cur !== undefined && (force ? cur.status === 'ready' : cur.status !== 'error')) return prev
      const next = new Map(prev)
      next.set(path, { status: 'loading' })
      return next
    })
    return remote.query({ sessionId, query: { kind: 'dir-list', path } }).then((res) => {
      if (!current()) return
      const dl = queryAs(res, 'dir-list')
      setDirs((prev) => {
        const next = new Map(prev)
        next.set(path, dl === null ? { status: 'error' } : { status: 'ready', entries: dl.entries, truncated: dl.truncated })
        return next
      })
    }).catch(() => {
      if (!current()) return
      setDirs((prev) => { const next = new Map(prev); next.set(path, { status: 'error' }); return next })
    })
  }, [remote, sessionId])

  // Load the root once on mount / when the session changes.
  useEffect(() => { void loadDir('') }, [loadDir])

  // A branch switch replaces every file under the root: drop the preserved
  // state (and the sticky cache a remount would restore from) and start over
  // from the new root listing. The first run only records the initial value —
  // on mount the props are already current.
  const genRef = useRef(worktreeGen)
  useEffect(() => {
    if (genRef.current === worktreeGen) return
    genRef.current = worktreeGen
    dirGen.current += 1
    dirSeq.current.clear()
    fileSeq.current += 1
    filesCache.delete(sessionId)
    setDirs(new Map())
    setOpen(new Set(['']))
    setSelected(null)
    setFile({ kind: 'idle' })
    setPane('tree')
    void loadDir('')
  }, [worktreeGen, sessionId, loadDir])

  const toggleDir = useCallback((path: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(path)) { next.delete(path); return next }
      next.add(path)
      if (dirs.get(path) === undefined) void loadDir(path)
      return next
    })
  }, [dirs, loadDir])

  // Read one file into the preview. A fresh selection blanks the pane to its
  // loading state; a refresh keeps the current content on screen until the
  // re-read lands (a failed read still replaces it with the error state).
  const loadFile = useCallback((path: string, clear: boolean): Promise<void> => {
    const seq = ++fileSeq.current
    if (clear) setFile({ kind: 'loading', path })
    return remote.query({ sessionId, query: { kind: 'file-content', path } }).then((res) => {
      if (seq !== fileSeq.current) return
      const fc = queryAs(res, 'file-content')
      // Carry the wire code into the error state so the preview can name the
      // real cause (a file deleted after the listing is `file-not-found`).
      if (fc === null) { setFile({ kind: 'error', path, ...(res.ok ? {} : { code: res.error.code }) }); return }
      const stat = { ...(fc.size !== undefined ? { size: fc.size } : {}), ...(fc.mtimeMs !== undefined ? { mtimeMs: fc.mtimeMs } : {}) }
      if (fc.tooLarge === true) { setFile({ kind: 'tooLarge', path, ...stat }); return }
      if (fc.variant === 'image' && fc.dataUrl !== undefined) { setFile({ kind: 'image', path, dataUrl: fc.dataUrl, ...stat }); return }
      if (fc.variant === 'text') { setFile({ kind: 'text', path, content: fc.content ?? '', lines: fc.lines ?? 0, ...stat, ...(fc.absolutePath !== undefined ? { absolutePath: fc.absolutePath } : {}) }); return }
      setFile({ kind: 'binary', path, ...stat })
    }).catch(() => { if (seq === fileSeq.current) setFile({ kind: 'error', path }) })
  }, [remote, sessionId])

  const selectFile = useCallback((path: string) => {
    setSelected(path)
    if (compact) setPane('preview')
    // Rendered view is the default for Markdown; HTML defaults to source so a
    // page never auto-executes on selection — the user opts into the preview.
    setRenderMarkdown(!isHtmlPath(path))
    setHtmlScripts(true)
    setCopyState('idle')
    setCopyContentState('idle')
    setShowProps(false)
    // A stopped render and a declined heavy document belong to the file that
    // was loaded: another file starts from a clean slate.
    setHtmlStopped(null)
    setHeavyApproved(null)
    void loadFile(path, true)
  }, [compact, loadFile])

  // Manual refresh (the tree's top-right button): re-list every expanded
  // directory and re-read the selected file, so an edit made outside the panel
  // (a checkout in a terminal, an editor save) shows up without leaving the
  // tab. Listings of collapsed directories are dropped and read again on the
  // next expand.
  const refresh = useCallback((): void => {
    if (refreshFlight.current) return
    refreshFlight.current = true
    setRefreshing(true)
    const openDirs = open
    setDirs((prev) => new Map([...prev].filter(([path]) => openDirs.has(path))))
    const pending: Array<Promise<void>> = [...openDirs].map((path) => loadDir(path, true))
    if (selected !== null) pending.push(loadFile(selected, false))
    const settle = (): void => {
      refreshFlight.current = false
      setRefreshing(false)
    }
    void Promise.all(pending).then(settle, settle)
  }, [open, selected, loadDir, loadFile])

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

  // The reader card is this same preview element with a dialog role: the body
  // stays mounted in place, so nothing is re-rendered or reloaded. Everything
  // beside the card is made inert while it is open, so `aria-modal` is true.
  const fsActive = fullscreen && selected !== null && file.kind === 'text'

  // The refresh control floats at the tree's top-right corner: it re-lists the
  // expanded directories and re-reads the open file (see `refresh`) without a
  // row of its own above the list, and it stays put while the entries scroll
  // under it.
  const refreshButton = h('button', {
    key: 'refresh', type: 'button', className: `gp-files__refresh${refreshing ? ' gp-files__refresh--busy' : ''}`,
    title: t('files.refresh'), 'aria-label': t('files.refresh'),
    'aria-busy': refreshing, disabled: refreshing,
    onClick: () => refresh(),
  }, h(RefreshIcon, { size: 14 }))

  const treeBlock = h('div', {
    key: 'left', className: 'gp-files__tree-wrap',
    // Stacked takes the shared top/bottom split; only the wide row layout
    // needs the drag-resized horizontal basis.
    style: stacked ? { flex: `0 0 ${split.pct}%` } : compact ? undefined : { flex: `0 0 ${leftCol.width}px` },
    ...inertAttr(fsActive),
  }, [
    // The control leads in DOM order so keyboard users reach it before walking
    // the entry rows; its absolute position puts it at the box's corner.
    refreshButton,
    h('div', { key: 'tree', className: 'gp-files__tree' }, treeRows),
  ])

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
      // Switching back to the rendered view retries a render the user stopped:
      // the frame was unmounted, so a new one starts from scratch.
      onChange: (next: string) => {
        if (next === 'render' && htmlStopped !== null) setHtmlStopped(null)
        setRenderMarkdown(next === 'render')
      },
    })
    : null
  const fullscreenButton = file.kind === 'text'
    ? h('button', {
      key: 'full', ref: fsTriggerRef, type: 'button', className: 'gp-files__props',
      title: t('files.fullscreen'), 'aria-label': t('files.fullscreen'),
      onClick: () => setFullscreen(true),
    }, h(FullscreenIcon, { size: 14 }))
    : null
  // Script permission exists only for the rendered HTML view: on by default,
  // and this button is the only way to turn it off (static preview).
  const scriptToggle = file.kind === 'text' && isHtmlPath(file.path) && renderMarkdown
    ? h('button', {
      key: 'scripts', type: 'button', className: 'gp-files__props gp-files__scripts',
      title: htmlMode === 'interactive' ? t('files.scriptsOn') : t('files.scriptsOff'),
      'aria-label': t('files.runScripts'),
      'aria-pressed': htmlMode === 'interactive',
      onClick: () => setHtmlScripts(htmlMode !== 'interactive'),
    }, 'JS')
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
      h('div', { key: 'end', className: 'gp-files__bar-end' }, [scriptToggle, wrapButton, fullscreenButton, propsButton]),
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
      scriptToggle,
      wrapButton,
      fullscreenButton,
      propsButton,
    ])

  // The switcher that owns these tabs is hidden in the reader, so the panel
  // role (and its now-dangling label reference) goes with it; the nodes and
  // their keys stay, so the preview body is not remounted.
  const tabPanel = (mode: 'source' | 'render'): Record<string, string> => (fsActive
    ? { id: `${modeId}-${mode}-panel` }
    : { id: `${modeId}-${mode}-panel`, role: 'tabpanel', 'aria-labelledby': `${modeId}-${mode}` })
  const previewContent = richPreview
    ? [
      h('div', {
        key: 'src', ...tabPanel('source'),
        style: renderMarkdown ? { display: 'none' } : { display: 'contents' },
      }, renderMarkdown ? null : renderContent(file, false, wrap, markdownLabels, pathImages, markdownSegments, htmlFrame, htmlHint, htmlStop, t)),
      h('div', {
        key: 'rnd', ...tabPanel('render'),
        style: renderMarkdown ? { display: 'contents' } : { display: 'none' },
      }, renderMarkdown ? renderContent(file, true, wrap, markdownLabels, pathImages, markdownSegments, htmlFrame, htmlHint, htmlStop, t) : null),
    ]
    : renderContent(file, renderMarkdown, wrap, markdownLabels, pathImages, markdownSegments, htmlFrame, htmlHint, htmlStop, t)

  // A heavy document asks in a modal before its frame is mounted: the choice
  // is about a page that can freeze the whole app while it paints, so it must
  // be deliberate rather than a bar that is easy to click past.
  const heavyNotice = heavyPending && file.kind === 'text'
    ? h(HeavyPreviewModal, {
      key: 'heavy',
      path: file.path,
      bytes: heavyScriptBytes,
      canOpen: heavyCanOpen,
      opening: openExternal.busy,
      error: openExternal.error,
      onOpen: () => { void openFileExternally() },
      onRender: () => { setHeavyApproved(file.path); setOpenExternal({ busy: false, error: null }) },
      onCancel: () => { setRenderMarkdown(false); setOpenExternal({ busy: false, error: null }) },
      t,
    })
    : null


  const previewBlock = h('div', {
    key: 'right',
    className: `gp-files__preview${fsActive ? ' gp-files__preview--full' : ''}`,
    ...(fsActive ? { ref: fsCardRef, role: 'dialog', 'aria-modal': true, 'aria-label': file.kind === 'text' ? file.path : '' } : {}),
  }, [
    fsActive
      ? h('div', { key: 'fsbar', className: 'gp-modal__bar gp-files__fsbar' }, [
        h('code', { key: 'path', className: 'gp-modal__path', title: file.path }, file.path),
        h('button', {
          key: 'screen', type: 'button', className: 'gp-icon-btn gp-files__fs-screen',
          title: screenFull ? t('files.exitFullscreen') : t('files.enterFullscreen'),
          'aria-label': t('files.screenFull'),
          'aria-pressed': screenFull, onClick: toggleScreenFull,
        }, h(screenFull ? ExitFullscreenIcon : FullscreenIcon, { size: 15 })),
        h('button', {
          key: 'close', ref: fsCloseRef, type: 'button', className: 'gp-icon-btn gp-modal__close',
          title: t('common.close'), 'aria-label': t('common.close'), onClick: closeFullscreen,
        }, h(CloseIcon, { size: 15 })),
      ])
      : null,
    fsActive
      ? h(FullscreenFocus, { key: 'fsfocus', cardRef: fsCardRef, initialRef: fsCloseRef, restoreRef: fsTriggerRef, onClose: closeFullscreen })
      : null,
    selected !== null && !fsActive ? (compact ? compactBar : wideBar) : null,
    heavyNotice,
    h('div', { key: 'content', className: 'gp-files__preview-content' }, previewContent),
    propsInput !== null && showProps
      ? h(FilePropsModal, { key: 'props-modal', input: propsInput, snapshot, onClose: () => setShowProps(false), t })
      : null,
  ])

  // Dims the app behind the reader card. A real node, not a huge spread shadow:
  // a 100vmax shadow paints a viewport-sized layer for as long as it is open.
  const fsBackdrop = fsActive
    ? h('div', { key: 'fs-desk', className: 'gp-files__fs-backdrop', 'aria-hidden': 'true', onClick: closeFullscreen })
    : null

  // Stacked: a tall narrow sidebar shows the tree above and the preview below;
  // picking a file updates the preview in place (the wide semantics — there is
  // no drill state to enter, so no back bar).
  if (stacked) {
    return h('div', { className: 'gp-files gp-files--stacked' }, [
      treeBlock,
      h('div', {
        key: 'split', className: 'gp-resizer gp-resizer--row', role: 'separator',
        'aria-orientation': 'horizontal',
        ...split.dividerProps,
      }),
      previewBlock,
      fsBackdrop,
    ])
  }

  // Compact: a single column drilling from the tree into the file preview.
  if (compact) {
    return h('div', { className: 'gp-files gp-files--compact' }, [pane === 'preview' ? previewBlock : treeBlock, fsBackdrop])
  }

  return h('div', { className: 'gp-files' }, [
    treeBlock,
    leftCol.divider,
    previewBlock,
    fsBackdrop,
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
  htmlFrame: HtmlFrameSpec | null | undefined,
  htmlHint: { readonly run: () => void } | undefined,
  htmlStop: (() => void) | undefined,
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
  if (file.kind === 'text' && htmlFrame !== undefined) {
    // The pack is in flight: hold the source preview instead of flashing an
    // unstyled page (the pack resolves in a few local RPC round-trips).
    if (htmlFrame === null) return renderPreview(file, wrap, t)
    // A static preview is handed no script permission at all and carries a CSP
    // that blocks the network; the interactive one opts into allow-scripts.
    return h('div', { className: 'gp-files__html-wrap' }, [
      htmlHint !== undefined
        ? h('div', { key: 'hint', className: 'gp-files__html-note' }, [
          h('span', { key: 'text', className: 'gp-files__html-note-text' }, t('files.scriptsSkipped')),
          h('button', {
            key: 'run', type: 'button', className: 'gp-files__html-note-run',
            title: t('files.scriptsOff'), onClick: htmlHint.run,
          }, t('files.runScripts')),
        ])
        : null,
      // Keyed on the frame identity: a sandbox attribute updated after the
      // document loaded does not re-run the scripts it already blocked, so a
      // permission change must remount the frame (and its loading mask).
      h(HtmlFrame, { key: `frame:${htmlFrame.kind}:${htmlFrame.kind === 'interactive' ? htmlFrame.src : ''}`, frame: htmlFrame, title: file.path, t, ...(htmlStop !== undefined ? { onStop: htmlStop } : {}) }),
    ])
  }
  return renderPreview(file, wrap, t)
}


/**
 * The confirmation a heavy HTML document asks for before its frame is mounted.
 *
 * A modal rather than a bar: the choice is about a page that can freeze the
 * whole app while it paints, so it must not be dismissed by accident, and it
 * has to be readable before anything starts.
 */
function HeavyPreviewModal(props: {
  path: string
  bytes: number
  readonly canOpen: boolean
  readonly opening: boolean
  readonly error: string | null
  readonly onOpen: () => void
  readonly onRender: () => void
  readonly onCancel: () => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}): JSX.Element {
  const { t } = props
  const body: (JSX.Element | null)[] = [
    h('div', { key: 'wrap', 'data-gp-heavy-modal': '' }, [
      h('p', { key: 'why', className: 'gp-modal__confirmtext' }, t('files.htmlHeavyWhy', { size: formatBytes(props.bytes) })),
      h('p', { key: 'inline', className: 'gp-modal__confirmtext' }, t('files.htmlHeavyInline')),
      props.canOpen ? null : h('p', { key: 'remote', className: 'gp-modal__confirmtext' }, t('files.htmlHeavyRemote')),
      props.error !== null ? h('p', { key: 'err', className: 'gp-feedback', role: 'alert' }, props.error) : null,
    ]),
  ]
  const footer = h('div', { key: 'footer', className: 'gp-modal__footer' }, [
    h('button', { key: 'cancel', type: 'button', className: 'gp-btn', disabled: props.opening, onClick: props.onCancel }, t('common.cancel')),
    props.canOpen
      ? h('button', {
        key: 'open', type: 'button', className: 'gp-btn', disabled: props.opening, onClick: props.onOpen,
      }, t(props.opening ? 'files.htmlOpening' : 'files.htmlOpenInBrowser'))
      : null,
    h('button', {
      key: 'render', type: 'button', className: 'gp-btn gp-btn--primary', disabled: props.opening, onClick: props.onRender,
    }, t('files.htmlHeavyRun')),
  ])
  return renderModalShell({
    onClose: props.onCancel,
    title: props.path,
    portalKey: 'file-heavy-preview',
    body,
    footer,
    t,
  }) as JSX.Element
}

/**
 * Focus lifecycle of the fullscreen reader. A component of its own so the
 * shared dialog contract only runs while the reader is open — wrapping the
 * preview in a conditional component instead would remount it.
 */
function FullscreenFocus(props: {
  cardRef: RefObject<HTMLDivElement | null>
  initialRef: RefObject<HTMLButtonElement | null>
  restoreRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}): null {
  useDialogFocus(props.cardRef, props.onClose, props.initialRef, props.restoreRef)
  return null
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
