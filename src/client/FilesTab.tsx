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
import { ArrowLeftIcon, CheckIcon, ChevronIcon, CloseIcon, CopyIcon, FolderIcon, FullscreenIcon, InfoIcon, RefreshIcon, RepoIcon, ScreenIcon, SyncIcon, WrapIcon } from './icons.js'
import { useResizableColumn, useStackedSplit } from './resizable.js'
import { FileTypeIcon, IconFolderCloseRegular, IconFolderOpenRegular, MarkdownText, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import { FilePropsModal, type FilePropsInput } from './FilePropsModal.js'
import { useDialogFocus } from './dialog-focus.js'
import { canCopyContent } from './copy-content.js'
import { useCopyFeedback } from './copy-feedback.js'
import { useHoverTip } from './tip.js'
import { rtlPathText } from './rtl-path.js'
import { pathCopyButton } from './path-copy-button.js'
import { createPathImages, type PathImages } from './path-images.js'
import { splitMermaidSegments, markdownKbdToCode, type MermaidSegment } from './mermaid-blocks.js'
import { formatBytes } from './bytes.js'
import { renderModalShell } from './ops-modals.js'
import { NoticeBar } from './notice.js'
import { inertAttr } from './inert.js'
import { useRowSlider } from './row-slider.js'
import { HtmlFrame, type HtmlFrameSpec } from './HtmlFrame.js'
import { useHtmlPreview } from './use-html-preview.js'
import { MermaidFigure } from './MermaidFigure.js'
import { CodePreview, renderPreview, type FileState } from './files-preview.js'
import { wrapCapOk } from './wrap-cap.js'
import { isSvgPath } from './diff.js'
import { screenFailKeyOf, SCREEN_TIMEOUT_MS } from './screen-full.js'
import type { FilesRootMenu } from './repo-list.js'

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
  /** The sample of the checkout the browser is rooted in; null when there is
   * none (non-git degrade) or the browser shows another root than the panel
   * follows — properties then skip the Git facts. */
  readonly snapshot: GitSnapshot | null
  /** Absolute browse root Panel resolved for the browser's selector; null
   * until the list (or the error's cwd) names it — the bar then shows only
   * the refresh control. */
  readonly browseRoot: string | null
  /** Candidate roots for the address dropdown; null = not following (or no
   * second root) and the address keeps its click-to-copy behaviour. */
  readonly rootMenu?: FilesRootMenu | null
  /** Root a picked selector ('' = the project root), or null to resume
   * following the switched repository. */
  readonly onPickRoot?: (selector: string | null) => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type Loaded = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly entries: readonly DirEntry[]; readonly truncated: boolean }

function isMarkdownPath(path: string): boolean { return /\.(?:md|markdown)$/i.test(path) }
function isHtmlPath(path: string): boolean { return /\.(?:html?|xhtml)$/i.test(path) }
/** Text files that offer a rendered view beside their source. */
function isRichPath(path: string): boolean { return isMarkdownPath(path) || isHtmlPath(path) }


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

export function FilesTab({ remote, sessionId, compact, stacked, worktreeGen, snapshot, browseRoot, rootMenu, onPickRoot, t }: FilesTabProps): JSX.Element {
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
  // Copy feedback comes from the shared hook, so the toolbar's confirmation
  // expires on the same clock as the two diff-header paths (1.6 s) and a late
  // write for a file the user has left cannot repaint the next one.
  const pathCopy = useCopyFeedback(selected)
  const contentCopy = useCopyFeedback(selected)
  // The status bar's copy target: the root Panel resolved for the browser's
  // selector. Keyed on the path itself, so a switch repaints the bar without
  // carrying the old root's ✓.
  const rootCopy = useCopyFeedback(browseRoot)
  // The copy-content icon is label-free, so its hint rides the portaled tip
  // (fast + themed, like the toolbar controls) instead of a native title —
  // the two stacked when both were present.
  const { tipProps, tipNode, hideTip } = useHoverTip({ placement: 'below' })
  // A tip is anchored where its button stood when hovered, so a selection change
  // (the button can even be swapped out for the next file's) would strand the
  // bubble at the old spot; drop it instead of re-measuring.
  useEffect(() => { hideTip() }, [selected, hideTip])
  const [showProps, setShowProps] = useState(false)
  // The fullscreen reader restyles this tab's own preview in place instead of
  // rendering a second copy: a rendered HTML page keeps its document (a new
  // frame would re-run its scripts) and a code view keeps scroll and find state.
  const [fullscreen, setFullscreen] = useState(false)
  // Browser fullscreen of the reader card, tracked from the browser's own state.
  const [screenFull, setScreenFull] = useState(false)
  // Set to the notice key naming why the request could not take effect
  // (refused, policy-blocked, unsupported, or never answered): the toggle
  // then does nothing on its own, so the panel states the reason instead of
  // leaving a dead control silent.
  const [screenFail, setScreenFail] = useState<GitKey | null>(null)
  // Watchdog for a request the host never answers: cancelled when the
  // promise settles, when full screen is entered, and on unmount.
  const screenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fsCardRef = useRef<HTMLDivElement | null>(null)
  const fsCloseRef = useRef<HTMLButtonElement | null>(null)
  const fsTriggerRef = useRef<HTMLButtonElement | null>(null)
  // Compact drill-in: 'tree' lists the working tree, 'preview' shows the file.
  // Ignored by the wide layout (tree + preview side by side).
  const [pane, setPane] = useState<'tree' | 'preview'>(() => init?.pane ?? 'tree')
  // Manual refresh from the status bar's refresh button: re-lists the open
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

  // The rendered HTML preview: packing, the blob: URL, the heavy-document
  // question, the stopped render and the static hint all live in the hook.
  const htmlPreview = useHtmlPreview({
    file: file.kind === 'text' && isHtmlPath(file.path) ? file : null,
    renderMarkdown,
    onRenderChange: setRenderMarkdown,
    remote,
    sessionId,
    t,
  })
  // The selection callback depends on this one stable action, not on the whole
  // result object, which is rebuilt on every render.
  const resetHtmlPreview = htmlPreview.resetForSelection

  // Browser fullscreen belongs to the browser: the system UI or Esc can leave
  // it, so the button mirrors `fullscreenchange` instead of a local flag. Only
  // this card counts — another element going full screen is not our state.
  useEffect(() => {
    const sync = (): void => {
      const own = document.fullscreenElement === fsCardRef.current
      setScreenFull(own)
      // A granted request (or any later state where the card owns the screen)
      // retires the failure notice.
      if (own) setScreenFail(null)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      if (screenTimer.current !== null) { clearTimeout(screenTimer.current); screenTimer.current = null }
    }
  }, [])
  const closeFullscreen = useCallback(() => {
    if (document.fullscreenElement !== null && document.fullscreenElement === fsCardRef.current) {
      void document.exitFullscreen().catch(() => undefined)
    }
    setScreenFail(null)
    setFullscreen(false)
  }, [])
  const toggleScreenFull = useCallback(() => {
    const card = fsCardRef.current
    if (card === null) return
    if (document.fullscreenElement === card) { void document.exitFullscreen().catch(() => undefined); return }
    // Every way this request can fail must leave a visible reason instead of
    // a dead control: a host that denies fullscreen rejects the promise
    // (Chrome reports a Permissions-Policy lockout as a TypeError), an engine
    // without the API throws synchronously, and a host that never settles
    // the promise is caught by the watchdog below.
    const clearTimer = (): void => {
      if (screenTimer.current !== null) { clearTimeout(screenTimer.current); screenTimer.current = null }
    }
    clearTimer()
    setScreenFail(null)
    if (typeof card.requestFullscreen !== 'function') { setScreenFail('files.screenFullUnsupported'); return }
    screenTimer.current = setTimeout(() => {
      screenTimer.current = null
      if (document.fullscreenElement !== card) setScreenFail('files.screenFullNoResponse')
    }, SCREEN_TIMEOUT_MS)
    try {
      void card.requestFullscreen().then(() => {
        clearTimer()
        // The spec resolves only after fullscreenElement is set; a host that
        // resolves without entering is reported like a silent one.
        if (document.fullscreenElement !== card) setScreenFail('files.screenFullNoResponse')
      }, (error: unknown) => {
        clearTimer()
        setScreenFail(screenFailKeyOf(error))
      })
    } catch {
      clearTimer()
      setScreenFail('files.screenFullUnsupported')
    }
  }, [])

  const leftCol = useResizableColumn({ storageKey: 'gp.files.left', initial: 300, min: 180, reserve: 220, edge: 'end', resetTitle: t('resizer.resetWidth') })
  // Stacked only reads it here (hooks run unconditionally); the shared split
  // keeps this tab's bands aligned with the overview and changes tabs.
  const split = useStackedSplit(t('resizer.resetHeight'))

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
      if (fc.variant === 'image' && fc.dataUrl !== undefined) {
        // An SVG arrives with its markup beside the picture: one read feeds
        // both faces of the preview.
        setFile({
          kind: 'image', path, dataUrl: fc.dataUrl,
          ...(fc.content !== undefined ? { content: fc.content } : {}),
          ...(fc.lines !== undefined ? { lines: fc.lines } : {}),
          ...stat,
        })
        return
      }
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
    setShowProps(false)
    // A stopped render and a declined heavy document belong to the file that
    // was loaded: any selection, including the same path again, starts from a
    // clean slate.
    resetHtmlPreview()
    void loadFile(path, true)
  }, [compact, loadFile, resetHtmlPreview])

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

  // Both copy actions go through the platform helper (inside useCopyFeedback):
  // its async Clipboard path is unavailable on a remote plain-HTTP origin
  // (non-secure context, no `navigator.clipboard`), where it falls back to
  // `execCommand('copy')`.
  // Re-checked at click time: only a loaded text document, or an SVG whose
  // markup came with the picture, may reach the clipboard — never a binary or
  // oversized body, and never a content-less image.
  const copyContent = (): void => {
    // Both copyable shapes carry their body in `content` (a text file's own, or
    // the markup that rides beside an SVG picture).
    const body = file.kind === 'text' || file.kind === 'image' ? file.content : undefined
    if (body === undefined || !canCopyContent(file)) return
    contentCopy.copy(body)
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

  // The refresh control sits in the tree column's status bar, above the
  // scrolling entries: same re-list/re-read behaviour, one refresh at a time
  // via `refreshFlight`, busy state on the button itself.
  const refreshButton = h('button', {
    key: 'refresh', type: 'button', className: `gp-files__refresh${refreshing ? ' gp-files__refresh--busy' : ''}`,
    title: t('files.refresh'), 'aria-label': t('files.refresh'),
    'aria-busy': refreshing, disabled: refreshing,
    onClick: () => refresh(),
  }, h(RefreshIcon, { size: 14 }))

  // A second candidate root gives the address a list instead of copy: it opens
  // under the bar, closes on an outside press or Escape, and offers the
  // follow state, the project root, every checkout, and a copy entry. The
  // config default decides nothing here — the list is the session's override.
  const [rootMenuOpen, setRootMenuOpen] = useState(false)
  const rootMenuRef = useRef<HTMLDivElement | null>(null)
  // The list does not need a resolved root: it is how the session gets one.
  const menuable = rootMenu !== undefined && rootMenu !== null
  useEffect(() => { if (!menuable) setRootMenuOpen(false) }, [menuable])
  useEffect(() => {
    if (!rootMenuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      const el = rootMenuRef.current
      if (el !== null && !el.contains(event.target as Node)) setRootMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') setRootMenuOpen(false) }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [rootMenuOpen])

  const rootMenuNode = !menuable || !rootMenuOpen || rootMenu === null || rootMenu === undefined
    ? null
    : h('div', { key: 'rootmenu', ref: rootMenuRef, className: 'gp-files__rootmenu', role: 'listbox', 'aria-label': t('files.rootMenuLabel') }, [
      h('button', {
        key: 'follow', type: 'button', role: 'option', 'aria-selected': rootMenu.followActive,
        className: `gp-files__rootmenu__item${rootMenu.followActive ? ' gp-files__rootmenu__item--active' : ''}`,
        onClick: () => { hideTip(); setRootMenuOpen(false); onPickRoot?.(null) },
      }, [
        h('span', { key: 'i', className: 'gp-files__rootmenu__icon' }, h(SyncIcon, { size: 13 })),
        h('span', { key: 'n', className: 'gp-files__rootmenu__name' }, t('files.rootFollowGit')),
      ]),
      ...rootMenu.rows.map((row) => h('button', {
        key: row.selector === '' ? 'project' : `repo:${row.selector}`,
        type: 'button', role: 'option', 'aria-selected': row.active,
        ...(row.disabled !== undefined ? { 'aria-disabled': true as const } : {}),
        className: `gp-files__rootmenu__item${row.active ? ' gp-files__rootmenu__item--active' : ''}${row.disabled !== undefined ? ' gp-files__rootmenu__item--disabled' : ''}`,
        onClick: () => {
          if (row.disabled !== undefined) return
          hideTip()
          setRootMenuOpen(false)
          onPickRoot?.(row.selector)
        },
      }, [
        h('span', { key: 'i', className: 'gp-files__rootmenu__icon' }, row.kind === 'project' ? h(FolderIcon, { size: 13 }) : h(RepoIcon, { size: 13 })),
        h('span', { key: 't', className: 'gp-files__rootmenu__text' }, [
          h('span', { key: 'n', className: 'gp-files__rootmenu__name' }, row.kind === 'project' ? t('files.rootProject') : row.name),
          h('span', {
            key: 'p',
            className: row.kind === 'project' ? 'gp-files__rootmenu__path gp-files__rootmenu__path--abs' : 'gp-files__rootmenu__path',
          }, row.kind === 'project' ? rtlPathText(row.root) : row.path),
        ]),
      ])),
      browseRoot === null ? null : h('button', {
        key: 'copy', type: 'button', className: 'gp-files__rootmenu__item gp-files__rootmenu__copy',
        onClick: () => { hideTip(); setRootMenuOpen(false); rootCopy.copy(browseRoot) },
      }, [
        rootCopy.feedback === 'copied' ? h(CheckIcon, { key: 'ok', size: 13 }) : h(CopyIcon, { key: 'i', size: 13 }),
        h('span', { key: 'n', className: 'gp-files__rootmenu__name' },
          rootCopy.feedback === 'copied' ? t('files.rootCopied') : t('files.copyRootMenu')),
      ]),
    ])

  // The tree column's own header row: the absolute browse root on the left —
  // click to copy, or (with a second candidate root) to open the candidate-root
  // list — the refresh control on the right. It belongs to the directory tree
  // column only and it is where the degrade (no snapshot at all) names where
  // the browser is rooted. The tree wrap carries the reader's inert state.
  const statusBar = h('div', {
    key: 'status', className: 'gp-files__statusbar',
  }, [
    browseRoot === null && !menuable
      ? null
      : h('button', {
        key: 'root', type: 'button',
        className: `gp-files__status-path${rootCopy.feedback === 'copied' ? ' gp-files__status-path--copied' : ''}${menuable && rootMenuOpen ? ' gp-files__status-path--open' : ''}`,
        ...(menuable
          ? { 'aria-haspopup': 'listbox' as const, 'aria-expanded': rootMenuOpen, 'aria-label': t('files.chooseRoot') }
          : { 'aria-label': rootCopy.feedback === 'copied' ? t('files.rootCopied') : t('files.copyRoot') }),
        // The tip carries the full path (and the copy outcome while the ✓
        // shows); the visible text elides from the left, slash included.
        ...tipProps(rootCopy.feedback === 'copied' ? t('files.rootCopied') : browseRoot ?? t('files.chooseRoot')),
        onClick: () => {
          hideTip()
          if (menuable) setRootMenuOpen((open) => !open)
          else if (browseRoot !== null) rootCopy.copy(browseRoot)
        },
      }, [
        h('code', { key: 'p', className: 'gp-files__status-code' }, [
          h('span', { key: 'body', className: 'gp-files__status-body' }, browseRoot === null ? t('files.chooseRoot') : rtlPathText(browseRoot)),
        ]),
        menuable
          ? h(ChevronIcon, { key: 'chev', size: 12, open: rootMenuOpen })
          : rootCopy.feedback === 'copied'
            ? h(CheckIcon, { key: 'ok', size: 12 })
            : h(CopyIcon, { key: 'i', size: 12 }),
        h('span', { key: 'live', className: 'gp-copy-live', 'aria-live': 'polite' },
          rootCopy.feedback === 'copied' ? t('files.rootCopied') : ''),
      ]),
    rootMenuNode,
    refreshButton,
  ])

  // The entry rows share the panel's travelling fill (see row-slider.tsx); the
  // tree is rebuilt on every fold and every directory load, hence the deps.
  const treeSlider = useRowSlider({ activeSelector: '.gp-files__entry.gp-tree-row--active', deps: [selected, treeRows] })
  const treeBlock = h('div', {
    key: 'left', className: 'gp-files__tree-wrap',
    // Stacked takes the shared top/bottom split; only the wide row layout
    // needs the drag-resized horizontal basis.
    style: stacked ? { flex: `0 0 ${split.pct}%` } : compact ? undefined : { flex: `0 0 ${leftCol.width}px` },
    ...inertAttr(fsActive),
  }, [
    // The header leads in DOM order (keyboard users reach it before the entry
    // rows) and sits outside the scrolling child, so it stays put.
    statusBar,
    h('div', { key: 'tree', className: 'gp-files__tree', ref: treeSlider.ref }, [treeSlider.slider, treeRows]),
  ])

  const richPreview = file.kind === 'text' && isRichPath(file.path)
  // An SVG is a picture and also markup, so it renders by default and offers a
  // source face — the same split the diff view uses for these files.
  const svgSource = file.kind === 'image' && file.content !== undefined && isSvgPath(file.path)
  const modeSwitchable = richPreview || svgSource
  // One definition per toolbar control; the compact and wide bars compose the
  // same nodes so a new mode / action cannot land on only one layout.
  const modeSeg = modeSwitchable
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
      onChange: (next: string) => htmlPreview.changeView(next === 'render'),
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
      title: htmlPreview.mode === 'interactive' ? t('files.scriptsOn') : t('files.scriptsOff'),
      'aria-label': t('files.runScripts'),
      'aria-pressed': htmlPreview.mode === 'interactive',
      onClick: htmlPreview.toggleScripts,
    }, 'JS')
    : null
  // Word wrap only affects the source/code body (rendered Markdown already wraps).
  // Over the wrap cap the toggle stays visible but disabled — hiding it would
  // discard the preference with no explanation (the body falls back to nowrap).
  const isTextSource = file.kind === 'text'
    ? (richPreview ? !renderMarkdown : true)
    : svgSource && !renderMarkdown
  const sourceText = file.kind === 'text'
    ? { content: file.content, lines: file.lines }
    : file.kind === 'image' && file.content !== undefined
      ? { content: file.content, lines: file.lines ?? 0 }
      : null
  const capOk = sourceText === null ? false : wrapCapOk(sourceText.content, sourceText.lines)
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
  // The filename is the copy control: clicking it copies the relative path, in
  // the same shape and on the same feedback clock as the two diff headers
  // (path-copy-button.tsx). The directory elides from its left, tail kept, so
  // the name stays whole at any width.
  const pathButton = pathCopyButton({
    elementKey: 'path',
    path: selected ?? '',
    feedback: pathCopy.feedback,
    onCopy: () => pathCopy.copy(),
    t,
    rootClass: 'gp-files__path',
    dirClass: 'gp-files__path-dir',
    nameClass: 'gp-files__path-name',
    disabled: selected === null,
  })
  // Icon-only: the label rides aria-label, the outcome rides the hover tip (the
  // live region is screen-reader only, so a sighted user needs the tip to say
  // which of the two happened) and the check glyph on success.
  const copyContentButton = canCopyContent(file)
    ? h('button', {
      key: 'copy-content', type: 'button',
      className: `gp-files__copy-path gp-files__copy-icon${contentCopy.feedback === 'copied' ? ' gp-files__copy-path--copied' : contentCopy.feedback === 'error' ? ' gp-files__copy-path--error' : ''}`,
      'aria-label': t('files.copyContent'),
      ...tipProps(t(contentCopy.feedback === 'copied' ? 'files.contentCopied' : contentCopy.feedback === 'error' ? 'files.contentCopyFailed' : 'files.copyContent')),
      onClick: () => { hideTip(); copyContent() },
    }, [
      contentCopy.feedback === 'copied' ? h(CheckIcon, { key: 'ok', size: 14 }) : h(CopyIcon, { key: 'i', size: 14 }),
      h('span', { key: 'live', className: 'gp-copy-live', 'aria-live': 'polite' },
        contentCopy.feedback === 'idle' ? '' : t(contentCopy.feedback === 'copied' ? 'files.contentCopied' : 'files.contentCopyFailed')),
    ])
    : null

  // Compact toolbar: back, the source/render switcher, then the icon group
  // (wrap / fullscreen / copy-content / properties). The relative path is
  // wide-only.
  const compactBar = compact
    ? h('div', { key: 'bar', className: 'gp-files__bar gp-files__bar--compact' }, [
      h('button', { key: 'back', type: 'button', className: 'gp-subhead__back', onClick: () => setPane('tree') }, [h(ArrowLeftIcon, { key: 'i', size: 14 }), t('files.backToTree')]),
      modeSeg,
      // Trailing icons keep their own right-aligned group: without the mode
      // switcher (plain files) they sit next to the back button otherwise.
      h('div', { key: 'end', className: 'gp-files__bar-end' }, [scriptToggle, wrapButton, fullscreenButton, copyContentButton, propsButton]),
    ])
    : null

  const wideBar = compact
    ? null
    : h('div', { key: 'bar', className: 'gp-files__bar' }, [
      pathButton,
      modeSeg,
      // Hidden (not disabled) for binary/image/too-large/error previews and for
      // documents at/above the copy envelope — no dead control to click.
      copyContentButton,
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
  const previewContent = modeSwitchable
    ? [
      h('div', {
        key: 'src', ...tabPanel('source'),
        style: renderMarkdown ? { display: 'none' } : { display: 'contents' },
      }, renderMarkdown ? null : renderContent(file, false, wrap, markdownLabels, pathImages, markdownSegments, htmlPreview.frame, htmlPreview.hint, htmlPreview.stop, t)),
      h('div', {
        key: 'rnd', ...tabPanel('render'),
        style: renderMarkdown ? { display: 'contents' } : { display: 'none' },
      }, renderMarkdown ? renderContent(file, true, wrap, markdownLabels, pathImages, markdownSegments, htmlPreview.frame, htmlPreview.hint, htmlPreview.stop, t) : null),
    ]
    : renderContent(file, renderMarkdown, wrap, markdownLabels, pathImages, markdownSegments, htmlPreview.frame, htmlPreview.hint, htmlPreview.stop, t)

  // A heavy document asks in a modal before its frame is mounted: the choice
  // is about a page that can freeze the whole app while it paints, so it must
  // be deliberate rather than a bar that is easy to click past.
  const heavyQuestion = htmlPreview.heavy
  const heavyNotice = heavyQuestion !== null && file.kind === 'text'
    ? h(HeavyPreviewModal, {
      key: 'heavy',
      path: heavyQuestion.path,
      bytes: heavyQuestion.bytes,
      canOpen: heavyQuestion.canOpen,
      opening: heavyQuestion.opening,
      error: heavyQuestion.error,
      onOpen: () => { void heavyQuestion.openExternally() },
      onRender: heavyQuestion.approve,
      onCancel: heavyQuestion.cancel,
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
          key: 'screen', type: 'button',
          // Labelled: the card is opened by the icon-only fullscreen button
          // outside, so this one carries its own text and a display glyph.
          className: 'gp-btn gp-files__fs-screen',
          title: screenFull ? t('files.exitFullscreen') : t('files.enterFullscreen'),
          'aria-label': screenFull ? t('files.exitFullscreen') : t('files.screenFull'),
          'aria-pressed': screenFull, onClick: toggleScreenFull,
        }, [
          h(ScreenIcon, { key: 'i', size: 14 }),
          h('span', { key: 'l', className: 'gp-files__fs-screen-label' }, screenFull ? t('files.exitFullscreen') : t('files.screenFull')),
        ]),
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
    // The browser-fullscreen toggle sits in this same card, so a failure is
    // reported where the user just clicked, naming its reason (the live
    // region announces it).
    screenFail !== null
      ? h(NoticeBar, {
        key: 'fs-fail', status: true,
        text: t(screenFail), closeLabel: t('common.close'),
        onClose: () => setScreenFail(null),
      })
      : null,
    // Hover tip for the copy-content icon, next to the only bar that can raise
    // it (the compact bar carries no copy button); portaled, so it is not
    // clipped here.
    tipNode,
    h('div', { key: 'content', className: 'gp-files__preview-content' }, previewContent),
    propsInput !== null && showProps
      ? h(FilePropsModal, { key: 'props-modal', input: propsInput, root: browseRoot, snapshot, onClose: () => setShowProps(false), t })
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

/** Preview body: rendered Markdown/HTML/SVG when the mode is on, else raw preview. */
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
  // An SVG has both faces in hand: the picture, or its markup as source.
  if (file.kind === 'image' && file.content !== undefined) {
    return renderMarkdown ? renderPreview(file, wrap, t) : h(CodePreview, { content: file.content, path: file.path, wrap, t })
  }
  if (file.kind === 'text' && renderMarkdown && isMarkdownPath(file.path) && markdownSegments !== undefined) {
    const markdownProps = { labels: markdownLabels, variant: 'body' as const, ...(pathImages !== undefined ? { pathImages } : {}) }
    if (markdownSegments.length === 1 && markdownSegments[0].kind === 'markdown') {
      return h('div', { className: 'gp-files__markdown' }, h('div', { className: 'gp-files__markdown-body' }, h(MarkdownText, { text: markdownSegments[0].text, ...markdownProps })))
    }
    // Mermaid fences render through the lazy engine chunk; every other
    // segment stays on the official MarkdownText, in document order, with
    // kbd hints already rewritten (see the memoized markdownSegments).
    return h('div', { className: 'gp-files__markdown' }, h('div', { className: 'gp-files__markdown-body' },
      markdownSegments.map((segment, index) => segment.kind === 'mermaid'
        ? h(MermaidFigure, { key: index, source: segment.source, t })
        : h(MarkdownText, { key: index, text: segment.text, ...markdownProps }))))
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
  // An expanded directory that lists nothing says so, one level under the dir
  // — flipping only the folder glyph is the sole sign otherwise. The root's
  // empty listing stays blank (its loading state is already a centered pane);
  // a truncated listing always carries entries, so it never reaches here.
  if (loaded.entries.length === 0 && !loaded.truncated) {
    if (depth === 0) return []
    return [h('div', { key: `empty${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 8 + depth * 16 } }, cb.t('files.emptyDir'))]
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
