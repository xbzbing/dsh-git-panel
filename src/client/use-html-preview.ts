/**
 * The rendered HTML preview's state machine: document packing, the `blob:` URL
 * the interactive frame travels through, the heavy-document confirmation, the
 * stopped render, and the static-preview hint.
 *
 * The frame itself — ready report, slow state, mask, stop control — stays in
 * `HtmlFrame`; this hook only decides which body, if any, that frame gets, and
 * owns the object URL that decision implies. Pure document rewriting stays in
 * `html-pack.ts`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitPanelRemote } from './rpc.js'
import { queryAs } from './rpc.js'
import type { GitKey } from './locales.js'
import { canOpenLocally } from './local-origin.js'
import {
  createStaticHtmlDocument, HTML_HEAVY_SCRIPT_BYTES, inlineScriptBytes, looksScriptRendered, packHtmlDocument, withReadyPing,
} from './html-pack.js'
import type { HtmlFrameSpec } from './HtmlFrame.js'
import type { FileState } from './files-preview.js'

type Translate = (key: GitKey, params?: Record<string, string | number>) => string

/** A loaded text file: the only file the rendered HTML view can come from. */
export type HtmlFile = Extract<FileState, { kind: 'text' }>

/** Script permission for the rendered view: only the interactive one runs. */
export type HtmlPreviewMode = 'static' | 'interactive'

export interface UseHtmlPreviewOptions {
  /** The selected file when it is HTML and loaded; null otherwise. */
  readonly file: HtmlFile | null
  /** Page-level source/render selection (shared with Markdown). */
  readonly renderMarkdown: boolean
  /** Switches that selection without handing out its state setter. */
  readonly onRenderChange: (value: boolean) => void
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly t: Translate
}

/** The heavy-document question, once it is the user's turn to answer it. */
export interface HtmlPreviewHeavy {
  readonly path: string
  readonly bytes: number
  readonly canOpen: boolean
  readonly opening: boolean
  readonly error: string | null
  readonly openExternally: () => Promise<void>
  readonly approve: () => void
  readonly cancel: () => void
}

export interface HtmlPreviewResult {
  readonly mode: HtmlPreviewMode
  readonly toggleScripts: () => void
  /** A fresh selection starts from a clean slate, even for the same path. */
  readonly resetForSelection: () => void
  readonly changeView: (rendered: boolean) => void
  readonly heavy: HtmlPreviewHeavy | null
  /**
   * `undefined`: this is not a rendered HTML preview (or the render was
   * cancelled or stopped). `null`: the pack is still in flight, so the caller
   * keeps the source preview instead of flashing an unstyled page.
   */
  readonly frame: HtmlFrameSpec | null | undefined
  readonly hint: { readonly run: () => void } | undefined
  readonly stop: (() => void) | undefined
}

/** HTML asset pack for the loaded document: in flight, rewritten srcdoc, or a
 * deliberate fall-back to the plain bytes (no packable assets, a base element,
 * an oversized document, or any pack failure). */
type HtmlPackState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly file: FileState }
  | { readonly status: 'ready'; readonly file: FileState; readonly srcdoc: string }
  | { readonly status: 'plain'; readonly file: FileState }

export function useHtmlPreview(options: UseHtmlPreviewOptions): HtmlPreviewResult {
  const { file, renderMarkdown, onRenderChange, remote, sessionId, t } = options

  // Script permission for the rendered HTML view. On by default so a page
  // renders the way a browser would; turning it off gives a static,
  // script-free document.
  const [htmlScripts, setHtmlScripts] = useState(true)
  const mode: HtmlPreviewMode = htmlScripts ? 'interactive' : 'static'
  const htmlPath = file === null ? null : file.path

  // A document whose own scripts weigh more than the panel is willing to wait
  // for is confirmed before its frame is mounted: the page's scripts run
  // before it paints, and a multi-megabyte report can hold the frame blank for
  // a dozen seconds.
  const heavyScriptBytes = useMemo(() => (file === null ? 0 : inlineScriptBytes(file.content)), [file])
  const heavyDocument = heavyScriptBytes >= HTML_HEAVY_SCRIPT_BYTES
  // The user has approved this document's render (or it is light enough to need
  // no approval). Keyed on the path, so another file asks again.
  const [heavyApproved, setHeavyApproved] = useState<string | null>(null)
  // "Open it outside the panel" is only meaningful on the machine that has the
  // file: a loopback GUI means the server and the reader share a disk.
  const canOpen = useMemo(() => canOpenLocally(typeof location === 'undefined' ? '' : location.hostname), [])
  const [openExternal, setOpenExternal] = useState<{ readonly busy: boolean; readonly error: string | null }>({ busy: false, error: null })
  const openExternally = useCallback(async (): Promise<void> => {
    if (file === null) return
    setOpenExternal({ busy: true, error: null })
    const res = await remote.openFile({ sessionId, path: file.path })
    if (res.ok) {
      // The page now lives in the system browser; leave the source view here so
      // nothing tries to mount a frame on top of a page that is being painted
      // somewhere else.
      setOpenExternal({ busy: false, error: null })
      onRenderChange(false)
      return
    }
    setOpenExternal({ busy: false, error: t('files.htmlOpenFailed') })
  }, [file, remote, sessionId, t, onRenderChange])
  const heavyPending = heavyDocument && renderMarkdown && mode === 'interactive' && htmlPath !== null && heavyApproved !== htmlPath

  // The user stopped the render from the mask: the frame is unmounted and the
  // source view takes over again, so a page that never paints cannot trap the
  // panel.
  const [stopped, setStopped] = useState<string | null>(null)
  const [pack, setPack] = useState<HtmlPackState>({ status: 'idle' })
  // Packing runs only while the rendered view is on — HTML defaults to source,
  // so selection alone never reads extra files. Keyed on the loaded file object:
  // a stale in-flight pack is dropped by object identity as well as by the
  // cleanup flag below.
  useEffect(() => {
    if (file === null || !renderMarkdown || mode !== 'interactive' || heavyPending || stopped === file.path) {
      setPack((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }))
      return
    }
    let cancelled = false
    setPack({ status: 'loading', file })
    const readText = async (path: string): Promise<string | null> => {
      const res = await remote.query({ sessionId, query: { kind: 'file-content', path } })
      const fc = queryAs(res, 'file-content')
      if (fc === null || fc.variant !== 'text' || fc.content === undefined || fc.tooLarge === true) return null
      return fc.content
    }
    void packHtmlDocument(file.content, file.path, readText).then((srcdoc) => {
      if (cancelled) return
      setPack(srcdoc === null ? { status: 'plain', file } : { status: 'ready', file, srcdoc })
    }).catch(() => {
      if (!cancelled) setPack({ status: 'plain', file })
    })
    return () => { cancelled = true }
  }, [file, renderMarkdown, mode, remote, sessionId, heavyPending, stopped])

  // Only a pack that settled for THIS file yields a document: mounting the raw
  // bytes first would start the page once, then throw it away when the packed
  // document arrives (a double script run on a heavy page).
  const interactiveDoc = useMemo<string | undefined>(() => {
    if (file === null || !renderMarkdown || mode !== 'interactive') return undefined
    if (pack.status === 'idle' || pack.file !== file) return undefined
    return pack.status === 'ready' ? pack.srcdoc : pack.status === 'plain' ? file.content : undefined
  }, [file, renderMarkdown, mode, pack])

  // Interactive documents are handed to the iframe through a blob: URL, never
  // srcdoc: a frame with a URL of its own goes into a separate renderer
  // process, so a heavy page's scripts cannot block the panel. The URL is an
  // effect, not a memo: a render React throws away would leak an object URL
  // that pins the whole document. The document it was built from travels with
  // it, so a stale URL is never handed to the frame.
  //
  // The blob type carries the charset: a blob: document arrives with no
  // headers and, unlike a file: page, is not encoding-sniffed, so a page that
  // declares no `<meta charset>` would fall back to the platform encoding and
  // render every non-ASCII character as mojibake. The host decodes the file as
  // UTF-8, so this label is always the truth.
  const [blob, setBlob] = useState<{ readonly doc: string; readonly url: string } | undefined>(undefined)
  useEffect(() => {
    if (interactiveDoc === undefined) { setBlob(undefined); return }
    const url = URL.createObjectURL(new Blob([withReadyPing(interactiveDoc)], { type: 'text/html;charset=utf-8' }))
    setBlob({ doc: interactiveDoc, url })
    return () => { URL.revokeObjectURL(url) }
  }, [interactiveDoc])

  const frame = useMemo<HtmlFrameSpec | null | undefined>(() => {
    if (file === null || !renderMarkdown) return undefined
    if (mode === 'static') return { kind: 'static', srcdoc: createStaticHtmlDocument(file.content) }
    // A heavy document waits for the user's confirmation, and a stopped render
    // stays stopped: neither may mount a frame.
    if (heavyPending || stopped === file.path) return undefined
    return blob !== undefined && blob.doc === interactiveDoc ? { kind: 'interactive', src: blob.url } : null
  }, [file, renderMarkdown, mode, blob, interactiveDoc, heavyPending, stopped])

  // A static preview of a script-rendered page is blank, which looks like a
  // bug. Offer the explicit way back to a running page instead, but only when
  // the document really renders through its scripts. Only the static preview
  // needs the verdict, and the scan reads the whole document: skip it while the
  // page is going to run anyway.
  const scriptRendered = useMemo(
    () => mode === 'static' && file !== null && renderMarkdown && looksScriptRendered(file.content),
    [file, renderMarkdown, mode],
  )
  const hint = useMemo<{ readonly run: () => void } | undefined>(
    () => (!scriptRendered || frame?.kind !== 'static' ? undefined : { run: () => setHtmlScripts(true) }),
    [scriptRendered, frame],
  )

  // Stopping a render unmounts the frame and returns to the source view: the
  // page's scripts are gone with the frame, and the user gets their document
  // back instead of an empty preview.
  const stopRender = useCallback(() => {
    if (file === null) return
    setStopped(file.path)
    onRenderChange(false)
  }, [file, onRenderChange])

  const toggleScripts = useCallback(() => { setHtmlScripts(!htmlScripts) }, [htmlScripts])

  // A fresh selection starts from a clean slate even when it names the same
  // path: the stopped render and the heavy approval belong to the load that was
  // replaced. Deliberately independent of `file`, so the caller's selection
  // callback keeps one stable identity.
  const resetForSelection = useCallback(() => {
    setHtmlScripts(true)
    setStopped(null)
    setHeavyApproved(null)
  }, [])

  // Switching back to the rendered view retries a render the user stopped: the
  // frame was unmounted, so a new one starts from scratch. A stopped render
  // keeps its heavy approval, as it always has.
  const changeView = useCallback((rendered: boolean) => {
    if (rendered) setStopped((prev) => (prev === null ? prev : null))
    onRenderChange(rendered)
  }, [onRenderChange])

  // A heavy document asks in a modal before its frame is mounted: the choice is
  // about a page that can freeze the app while it paints, so it must be
  // deliberate. Nothing here mounts a frame until `approve` runs.
  const heavy: HtmlPreviewHeavy | null = heavyPending && file !== null
    ? {
      path: file.path,
      bytes: heavyScriptBytes,
      canOpen,
      opening: openExternal.busy,
      error: openExternal.error,
      openExternally,
      approve: () => { setHeavyApproved(file.path); setOpenExternal({ busy: false, error: null }) },
      cancel: () => { onRenderChange(false); setOpenExternal({ busy: false, error: null }) },
    }
    : null

  // The stop control belongs to the interactive frame only: a static preview
  // commits in the same task and has no wait to end.
  return {
    mode,
    toggleScripts,
    resetForSelection,
    changeView,
    heavy,
    frame,
    hint,
    stop: frame?.kind === 'interactive' ? stopRender : undefined,
  }
}
