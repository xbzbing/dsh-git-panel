/**
 * Files tab preview: the source view (virtualized, lazily highlighted, with an
 * in-panel Find) plus the image / placeholder branches, and the state union the
 * tab keeps per selected file. Split out of FilesTab so the tab itself stays a
 * tree + toolbar + pane assembly.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitKey } from './locales.js'
import { languageForPath, useCodeHighlighter, type HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import { FindBar, markContent, matchRangesRaw, useDebounced, FIND_DEBOUNCE_MS, MAX_MATCHES } from './find.js'
import { ZoomableImage } from './ImageZoom.js'
import { buildTops, findWindowRange, windowRange } from './virtual-list.js'
import { useViewportTracker } from './use-viewport.js'
import { wrapCapOk } from './wrap-cap.js'

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

export type FileState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly path: string }
  | { readonly kind: 'text'; readonly path: string; readonly content: string; readonly lines: number; readonly absolutePath?: string; readonly size?: number; readonly mtimeMs?: number }
  | { readonly kind: 'image'; readonly path: string; readonly dataUrl: string; readonly size?: number; readonly mtimeMs?: number }
  | { readonly kind: 'binary'; readonly path: string; readonly size?: number; readonly mtimeMs?: number }
  | { readonly kind: 'tooLarge'; readonly path: string; readonly size?: number; readonly mtimeMs?: number }
  | { readonly kind: 'error'; readonly path: string; readonly code?: string }

export function renderPreview(file: FileState, wrap: boolean, t: (key: GitKey, params?: Record<string, string | number>) => string): JSX.Element {
  switch (file.kind) {
    case 'idle': return h('div', { className: 'gp-empty' }, t('files.selectFile'))
    case 'loading': return h('div', { className: 'gp-empty' }, t('common.loading'))
    case 'error': return h('div', { className: 'gp-empty' }, file.code === 'file-not-found' ? t('files.notFound') : t('files.loadFailed'))
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
  }, [containerRef])

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
