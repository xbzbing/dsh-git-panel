/** Side-by-side diff renderer with lazy syntax highlighting, on-demand gap
 * expansion, and word-level intra-line emphasis. Rows are windowed: only the
 * viewport (plus overscan) is mounted, so an "expand all" on a large file does
 * not tokenize and lay out the whole file at once. */
import { createElement as h, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  buildSideBySide, flattenToUnified, isBinaryDiff, retargetTrailingGap,
  isImagePath, isSvgPath, spliceGap, summarize, GAP_STEP, type GapInfo, type SideRow,
} from './diff.js'
import { languageForPath, useCodeHighlighter, type CodeHighlighter, type HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import { splitHighlightSpans } from './code-spans.js'
import { memoizeHighlighter } from './highlight-cache.js'
import { buildTops, findWindowRange, windowRange } from './virtual-list.js'
import { useViewportTracker } from './use-viewport.js'
import { FindBar, markContent, matchRangesRaw, useDebounced, FIND_DEBOUNCE_MS, MAX_MATCHES } from './find.js'
import { ImageCompare } from './ImageCompare.js'
import type { GitPanelRemote } from './rpc.js'
import { queryAs } from './rpc.js'
import { DIFF_EXPAND_CONTEXT, type GitQuery } from './types.js'
import { useImageDiff } from './image-diff-hook.js'
import type { GitKey } from './locales.js'

/** unified = single inline column; split = side-by-side; before/after show one
 * side's full content. */
export type DiffMode = 'unified' | 'split' | 'before' | 'after'

/** Diff base for the compared sides — selects the image panes and the source
 * the hidden-context expansion reads from. */
export type DiffBase = 'worktree' | 'staged' | 'commit'

// --- row virtualization ---
// Code rows are exactly one line box tall; hunk and gap bands carry their own
// padding. Wrapping is the only thing that makes a code row taller, and every
// mounted row reports its real height back (see the measurement effect), so the
// estimates below only have to be close for the rows that were never on screen.
const EST_CODE_H = 20
const EST_HUNK_H = 27
const EST_GAP_H = 29
/** Rows kept mounted beyond the viewport on each side. */
const OVERSCAN_ROWS = 12
/** Viewport height assumed before the scroller reports its own, so the first
 * paint is already windowed rather than full. */
const VIEWPORT_FALLBACK = 600

/** Bound the match set so a pathological query (e.g. a single space) on a large
 * diff cannot build an unbounded array or paint tens of thousands of marks.
 * (MAX_MATCHES is shared from ./find.) */

/** Search state threaded into the code cells while Find is active. */
interface FindCtx {
  readonly perCell: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>>
  readonly activeKey: string | null
  readonly activeRange: readonly [number, number] | null
  readonly activeRef: { current: HTMLElement | null }
}

interface DiffViewProps {
  readonly visible?: boolean
  readonly text: string
  readonly mode: DiffMode
  /** File path, used to pick a syntax-highlighting grammar. */
  readonly path?: string
  /** Present with base → a binary image fetches old/new panes instead;
   * also the source for on-demand gap (hidden-context) expansion. */
  readonly remote?: GitPanelRemote
  readonly sessionId?: string
  /** Diff base and, for `commit`, the commit to compare against. Kept as plain
   * values (never an object built during render) so the memoized component is
   * not invalidated on every parent render. */
  readonly base?: DiffBase
  readonly commit?: string
  /** True while the toolbar's "expand all" is engaged. Only then can hidden
   * context be a surprise, so only then does the capped notice render. */
  readonly expanded?: boolean
  /** The host flagged the diff text as truncated (the runner dropped the head
   * of its output at the cap): surviving hunks stay readable, but the header and
   * opening hunks are missing and the +/- counts under-report. */
  readonly truncated?: boolean
  /** New-side total line count from the diff query — the only fact that can
   * tell whether hidden context follows the last hunk (git caps trailing
   * context at -U, so the text alone is ambiguous at the file end). Required:
   * a caller that omits it would silently lose the trailing expand control. */
  readonly newLines: number
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export const DiffView = memo(function DiffView({ visible = true, text, mode, path, remote, sessionId, base, commit, expanded, truncated, newLines, t }: DiffViewProps): JSX.Element {
  const baseRows = useMemo(() => buildSideBySide(text, newLines), [text, newLines])
  const binary = isBinaryDiff(text)

  const hl = useCodeHighlighter(path === undefined ? undefined : languageForPath(path))
  // Rows re-render as the window moves and whenever an ancestor re-renders;
  // tokenizing the same line twice is the most expensive thing this view does.
  const hlCached = useMemo(() => memoizeHighlighter(hl), [hl])

  // Rows are stateful so revealed gap context can be spliced in. Reseed only
  // when the diff text itself changes: a newer line count for the same text (a
  // poll re-pull after the file grew below the last hunk) re-derives just the
  // trailing gap, so an expanded region is not silently collapsed under the
  // reader. Retargeting is impossible without the parser's counters — then the
  // rows are reseeded, which is the old behaviour.
  const [rows, setRows] = useState<readonly SideRow[]>(baseRows)
  const seededText = useRef(text)
  useEffect(() => {
    if (seededText.current !== text) {
      seededText.current = text
      setRows(baseRows)
      return
    }
    setRows((prev) => retargetTrailingGap(prev, newLines) ?? baseRows)
  }, [text, newLines, baseRows])
  const expand = useGapExpander(rows, setRows, remote, sessionId, path, base, commit)

  // An SVG is both an image (rendered old/new comparison) and text (a source
  // diff). It gets a render/source toggle, defaulting to the rendered view;
  // raster binaries only ever have the rendered comparison.
  const svg = path !== undefined && isSvgPath(path)
  const [svgView, setSvgView] = useState<SvgView>('render')
  useEffect(() => { setSvgView('render') }, [path])

  const imageable = (binary || svg) && path !== undefined && isImagePath(path)
    && remote !== undefined && sessionId !== undefined && base !== undefined
  // An SVG showing its source diff doesn't need the image fetch.
  const wantImage = imageable && (!svg || svgView === 'render')
  const image = useImageDiff(
    wantImage ? remote : undefined, wantImage ? sessionId : undefined, wantImage ? path : undefined,
    wantImage ? base : undefined, wantImage ? commit : undefined, visible,
  )

  // In-diff Find (Ctrl/Cmd+F): matches are computed over every row of the
  // active mode — not just the mounted window — so the count and next/prev walk
  // stay complete while only visible matches render marks.
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const activeRef = useRef<HTMLElement | null>(null)
  useEffect(() => { setFindOpen(false); setQuery(''); setActiveIndex(0) }, [text, path])

  // The two per-mode render lists: `unified`/`split` walk SideRows, `before`/
  // `after` walk the one-sided line projection. Both are indexed by the same
  // key scheme the code cells use, so a Find match's key names its row.
  const unified = useMemo(() => (mode === 'unified' ? flattenToUnified(rows) : null), [mode, rows])
  const numbered = useMemo(
    () => (mode === 'before' ? beforeLines(rows) : mode === 'after' ? afterLines(rows) : null),
    [mode, rows],
  )
  const cells = useMemo(() => collectCells(rows, unified, numbered), [rows, unified, numbered])
  // Cache a lowercased copy of every visible cell once per (mode, rows); a
  // case-insensitive scan reuses it instead of re-lowercasing on each query.
  const lowerCells = useMemo(() => cells.map((c) => ({ key: c.key, text: c.text.toLowerCase() })), [cells])
  const debouncedQuery = useDebounced(query, FIND_DEBOUNCE_MS)
  const needle = caseSensitive ? debouncedQuery : debouncedQuery.toLowerCase()
  const scanCells = caseSensitive ? cells : lowerCells
  const matches = useMemo(() => findMatches(scanCells, needle), [scanCells, needle])
  useEffect(() => { setActiveIndex(0) }, [needle])
  const safeActive = matches.length === 0 ? 0 : Math.min(activeIndex, matches.length - 1)
  const active = matches.length > 0 ? matches[safeActive]! : null
  const activeKey = active?.cellKey ?? null
  const activeStart = active?.start ?? -1

  const perCell = useMemo(() => {
    const map = new Map<string, Array<readonly [number, number]>>()
    for (const m of matches) {
      const arr = map.get(m.cellKey) ?? []
      arr.push([m.start, m.end])
      map.set(m.cellKey, arr)
    }
    return map
  }, [matches])

  // Keep the active match scrolled into view as navigation moves. rAF waits for
  // the widened window to mount the row before scrolling to it. Declared with
  // the rest of the Find state: the image early-return below must not change the
  // hook count when the SVG render/source toggle flips.
  useEffect(() => {
    if (activeKey === null) return
    const id = requestAnimationFrame(() => activeRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' }))
    return () => cancelAnimationFrame(id)
  }, [safeActive, matches, activeKey, activeStart])

  const step = useCallback((delta: number) => {
    setActiveIndex((cur) => matches.length === 0 ? 0 : (cur + delta + matches.length) % matches.length)
  }, [matches.length])

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

  // --- windowing ---
  // DiffView owns the scroller: the window math needs the viewport height on
  // the very first paint, which a caller-owned container could not provide.
  const { setEl: setViewportEl, viewport, elRef: scrollerRef } = useViewportTracker()
  const bodyRef = useRef<HTMLDivElement | null>(null)
  /** Body offset inside the scroller's content box (0 unless the scroller is
   * given a header); subtracted from scrollTop to get the visible row range. */
  const [bodyOffset, setBodyOffset] = useState(0)
  const [measureTick, setMeasureTick] = useState(0)

  // Measured row heights, dropped when the row list or the layout changes shape
  // (a gap splice, a new diff, another mode) — derived during render so the
  // first render after the change never mixes in stale heights.
  const heightState = useRef<{ mode: DiffMode; rows: readonly SideRow[]; heights: number[] }>({ mode, rows, heights: [] })
  if (heightState.current.mode !== mode || heightState.current.rows !== rows) {
    heightState.current = { mode, rows, heights: [] }
  }
  const heights = heightState.current.heights

  const count = unified !== null ? unified.length : numbered !== null ? numbered.length : rows.length
  const estimateAt = useCallback((i: number): number => {
    const row: SideRow | null = unified !== null ? unified[i] ?? null : numbered === null ? rows[i] ?? null : null
    if (row === null) return EST_CODE_H
    return row.kind === 'hunk' ? EST_HUNK_H : row.kind === 'gap' ? EST_GAP_H : EST_CODE_H
  }, [unified, numbered, rows])
  // `heights` is mutated in place by the measurement effect below; measureTick
  // is the signal that it changed.
  const allHeights = useMemo(() => {
    const out = new Array<number>(count)
    for (let i = 0; i < count; i++) {
      const measured = heights[i]
      out[i] = measured !== undefined && measured > 0 ? measured : estimateAt(i)
    }
    return out
  }, [count, heights, estimateAt, measureTick])
  const tops = useMemo(() => buildTops(allHeights), [allHeights])

  const effHeight = viewport.height > 0 ? viewport.height : VIEWPORT_FALLBACK
  const { first, last } = windowRange(tops, Math.max(0, viewport.top - bodyOffset), effHeight, OVERSCAN_ROWS * EST_CODE_H)
  // Keep the active Find match mounted so `scrollIntoView` has a node to hit.
  // findWindowRange snaps onto a match lying outside the window instead of
  // spanning the gap to it: a span mounts every row between the viewport and
  // the match in one commit — the freeze this view exists to remove.
  const activeRow = activeKey === null ? -1 : cellRow(activeKey)
  const { first: windowFirst, last: windowLast } = findWindowRange({ first, last }, activeRow, count, OVERSCAN_ROWS)

  // Rows report their real height after every commit: wrapping makes a code row
  // taller than its estimate, and the prefix sums have to follow so the
  // scrollbar and the window stay honest. Corrections are applied only when
  // they differ by more than a sub-pixel, so this settles after one pass.
  useLayoutEffect(() => {
    const body = bodyRef.current
    const scroller = scrollerRef.current
    if (body === null || scroller === null) return
    const bodyTop = body.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    if (Math.abs(bodyTop - bodyOffset) > 0.5) setBodyOffset(bodyTop)
    const seen = new Map<number, number>()
    for (const node of body.querySelectorAll<HTMLElement>('[data-r]')) {
      const i = Number(node.dataset.r)
      const height = node.getBoundingClientRect().height
      if (!Number.isFinite(height) || height <= 0) continue
      const prev = seen.get(i)
      if (prev === undefined || height > prev) seen.set(i, height)
    }
    let changed = false
    for (const [i, height] of seen) {
      const current = heights[i]
      if (current === undefined || Math.abs(current - height) > 0.5) {
        heights[i] = height
        changed = true
      }
    }
    if (changed) setMeasureTick((n) => n + 1)
  })

  // Rendered comparison (raster binary always; SVG in 'render' mode).
  if (wantImage) {
    const rendered = ((): JSX.Element => {
      if (image.kind === 'idle' || image.kind === 'loading') return h('div', { className: 'gp-empty' }, t('common.loading'))
      if (image.kind === 'ready') {
        const res = image.res
        if (res.tooLarge === true) return h('div', { className: 'gp-empty' }, t('diff.tooLarge'))
        if (res.mime !== null && (res.old !== undefined || res.new !== undefined)) {
          return h(ImageCompare, { oldUrl: res.old, newUrl: res.new, mode, t })
        }
      }
      // failed / unsupported / no sides.
      return h('div', { className: 'gp-empty' }, t('diff.binary'))
    })()
    // An SVG keeps its render/source toggle above the rendered panes; a raster
    // binary has no source view, so it renders bare.
    return svg ? svgFrame(svgView, setSvgView, rendered, t) : rendered
  }

  // Raster binary with no usable rendered comparison.
  if (binary && !svg) return h('div', { className: 'gp-empty' }, t('diff.binary'))

  const find: FindCtx | null = findOpen && needle !== '' ? {
    perCell, activeKey, activeRange: active !== null ? [active.start, active.end] : null, activeRef,
  } : null

  /** A band reserving the height of the rows outside the mounted window; it
   * spans every grid column so it occupies a row of its own. */
  const spacer = (key: string, height: number): JSX.Element | null =>
    height > 0.5
      ? h('div', { key, className: 'gp-diff__spacer', style: { gridColumn: '1 / -1', height: `${height}px` } })
      : null
  const leadPad = spacer('lead', tops[windowFirst]!)
  const tailPad = spacer('tail', tops[count]! - tops[windowLast]!)

  // Text diff (regular files, and an SVG in 'source' mode). Each mode renders
  // only [windowFirst, windowLast) of its own row list.
  const body = ((): JSX.Element => {
    if (text.trim() === '') return h('div', { className: 'gp-empty' }, t('diff.empty'))
    if (numbered !== null) {
      const lines: Array<JSX.Element | null> = [leadPad]
      for (let i = windowFirst; i < windowLast; i++) {
        const line = numbered[i]!
        lines.push(h('div', { key: `n${i}`, className: 'gp-diff-no' }, line.no ?? ''))
        lines.push(codeCell('gp-diff-cell', `c${i}`, line.text, hlCached, find, i))
      }
      lines.push(tailPad)
      return h('div', { className: 'gp-diff__single', ref: bodyRef }, lines)
    }
    if (unified !== null) {
      const out: Array<JSX.Element | null> = [leadPad]
      for (let i = windowFirst; i < windowLast; i++) {
        out.push(...renderUnifiedRow(unified[i]!, i, hlCached, expand, find, t))
      }
      out.push(tailPad)
      return h('div', { className: 'gp-diff__unified', ref: bodyRef }, out)
    }
    const out: Array<JSX.Element | null> = [leadPad]
    for (let i = windowFirst; i < windowLast; i++) {
      out.push(...renderRow(rows[i]!, i, hlCached, expand, find, t))
    }
    out.push(tailPad)
    return h('div', { className: 'gp-diff__side', ref: bodyRef }, out)
  })()

  const findBox = findOpen ? h(FindBar, {
    inputRef, query, matches: matches.length, active: safeActive, caseSensitive,
    onChange: setQuery, onToggleCase: () => setCaseSensitive((c) => !c),
    onStep: step, onClose: () => setFindOpen(false), t,
  }) : null
  // The toolbar asked for a full expansion but hidden context remains → say so,
  // and drop the notice the moment the last gap is consumed. Reading the parsed
  // rows rather than the requested context size is what makes it exact: git can
  // cover a whole file at 2000 lines of context when nearby edits merge their
  // hunks, and can leave a gap short of 4000 lines when a hunk hugs one file edge.
  const capped = expanded === true && rows.some((r) => r.kind === 'gap')
  const wrapped = h('div', { className: 'gp-diff__wrap', ref: containerRef }, [
    findBox,
    truncated === true
      ? h('div', { key: 'truncated', className: 'gp-notice' }, t('diff.truncated'))
      : null,
    capped ? h('div', { key: 'capped', className: 'gp-notice' }, t('diff.expandCapped', { n: DIFF_EXPAND_CONTEXT })) : null,
    h('div', { key: 'scroll', className: 'gp-diff__scroll', ref: setViewportEl }, body),
  ])
  return svg ? svgFrame(svgView, setSvgView, wrapped, t) : wrapped
})

/** A single match location within the diff, addressed by visible cell key. */
interface DiffMatch { readonly cellKey: string; readonly start: number; readonly end: number }

/** Row index encoded in a cell key (`c12`, `l3`, `r3`), or -1 when unparseable. */
function cellRow(key: string): number {
  const n = Number(key.slice(1))
  return Number.isFinite(n) ? n : -1
}

/** Ordered visible code cells for the active mode, keyed as their render fns. */
function collectCells(
  rows: readonly SideRow[],
  unified: readonly SideRow[] | null,
  numbered: readonly NumberedLine[] | null,
): Array<{ key: string; text: string }> {
  const cells: Array<{ key: string; text: string }> = []
  if (numbered !== null) { numbered.forEach((l, i) => cells.push({ key: `c${i}`, text: l.text })); return cells }
  if (unified !== null) {
    unified.forEach((row, i) => {
      if (row.kind === 'hunk' || row.kind === 'gap') return
      const content = row.rightText ?? row.leftText ?? ''
      if (content !== '') cells.push({ key: `c${i}`, text: content })
    })
    return cells
  }
  rows.forEach((row, i) => {
    if (row.kind === 'hunk' || row.kind === 'gap') return
    if (row.leftText !== null && row.leftText !== '') cells.push({ key: `l${i}`, text: row.leftText })
    if (row.rightText !== null && row.rightText !== '') cells.push({ key: `r${i}`, text: row.rightText })
  })
  return cells
}

/** Substring matches across the (already case-normalized) cells, capped. Both
 * `cells[].text` and `needle` are pre-normalized by the caller. */
function findMatches(cells: ReadonlyArray<{ key: string; text: string }>, needle: string): DiffMatch[] {
  if (needle === '') return []
  const out: DiffMatch[] = []
  for (const cell of cells) {
    for (const [start, end] of matchRangesRaw(cell.text, needle)) {
      out.push({ cellKey: cell.key, start, end })
      if (out.length >= MAX_MATCHES) return out
    }
  }
  return out
}

type SvgView = 'render' | 'source'

/** Wrap SVG diff content with a render/source toggle bar above it. */
function svgFrame(
  view: SvgView, onView: (v: SvgView) => void, body: JSX.Element,
  t: (key: GitKey, params?: Record<string, string | number>) => string,
): JSX.Element {
  const btn = (v: SvgView, label: string): JSX.Element =>
    h('button', {
      key: v, type: 'button',
      className: `gp-seg__btn${view === v ? ' gp-seg__btn--active' : ''}`,
      'aria-pressed': view === v,
      onClick: () => onView(v),
    }, label)
  return h('div', { className: 'gp-svgdiff' }, [
    h('div', { key: 'bar', className: 'gp-svgdiff__bar' },
      h('div', { className: 'gp-seg' }, [btn('render', t('diff.svgRender')), btn('source', t('diff.svgSource'))])),
    h('div', { key: 'body', className: 'gp-svgdiff__body' }, body),
  ])
}

interface GapExpander {
  readonly busy: string | null
  readonly run: (gap: GapInfo, direction: 'all' | 'up' | 'down') => void
}

/**
 * On-demand hidden-context expansion. Clicking a gap control fetches the
 * revealed slice (file-lines query, source mirrors the diff base) and splices it
 * into the row list. A generation guard drops a stale response if the rows
 * were reseeded (diff text changed) mid-flight.
 */
function useGapExpander(
  rows: readonly SideRow[],
  setRows: (updater: (prev: readonly SideRow[]) => readonly SideRow[]) => void,
  remote: GitPanelRemote | undefined,
  sessionId: string | undefined,
  path: string | undefined,
  base: DiffBase | undefined,
  commit: string | undefined,
): GapExpander {
  const [busy, setBusy] = useState<string | null>(null)
  const gen = useRef(0)
  // Reseeding the rows (diff text changed) invalidates any in-flight reveal.
  useEffect(() => { gen.current += 1; setBusy(null) }, [rows])

  const run = useCallback((gap: GapInfo, direction: 'all' | 'up' | 'down') => {
    if (remote === undefined || sessionId === undefined || path === undefined || base === undefined) return
    const key = `${gap.rightStart}:${direction}`
    setBusy(key)
    const my = ++gen.current
    // Which slice to request. 'up'/'down' reveal one GAP_STEP window; 'all'
    // (and any bounded gap) reveal the whole hidden region.
    const { start, end } = sliceRequest(gap, direction)
    const query: GitQuery = base === 'commit' && commit !== undefined
      ? { kind: 'file-lines', path, base: 'commit', commit, start, end }
      : base === 'staged'
        ? { kind: 'file-lines', path, base: 'staged', start, end }
        : { kind: 'file-lines', path, base: 'worktree', start, end }
    void remote.query({ sessionId, query }).then((res) => {
      if (my !== gen.current) return
      const fl = queryAs(res, 'file-lines')
      setBusy(null)
      if (fl === null) return
      setRows((prev) => spliceGap(prev, gap.rightStart, direction, fl.start, fl.lines, fl.eof))
    }).catch(() => { if (my === gen.current) setBusy(null) })
  }, [remote, sessionId, path, base, commit, setRows])

  return { busy, run }
}

/** New-side line range to request for a gap expansion step. */
function sliceRequest(gap: GapInfo, direction: 'all' | 'up' | 'down'): { start: number; end: number } {
  const total = gap.count
  if (direction === 'all' || total <= GAP_STEP) {
    return { start: gap.rightStart, end: gap.rightStart + total - 1 }
  }
  if (direction === 'down') {
    return { start: gap.rightStart, end: gap.rightStart + GAP_STEP - 1 }
  }
  // 'up': reveal the bottom window of the gap.
  return { start: gap.rightStart + total - GAP_STEP, end: gap.rightStart + total - 1 }
}

/** Syntax runs are React text nodes, not untrusted HTML. */
function syntaxRuns(spans: readonly HighlightSpan[], prefix = ''): JSX.Element[] {
  return spans.map((span, i) => h('span', { key: `${prefix}${i}`, style: span.style }, span.text))
}

/** Wrap Find matches in the given cell's content with <mark>, keeping syntax. */
function withFindMarks(
  content: string, cellKey: string, find: FindCtx | null, spans: readonly HighlightSpan[] | undefined,
): Array<JSX.Element | string> | null {
  if (find === null) return null
  const ranges = find.perCell.get(cellKey)
  if (ranges === undefined || ranges.length === 0) return null
  const activeRange = find.activeKey === cellKey ? find.activeRange : null
  return markContent(content, ranges, spans, cellKey, activeRange, find.activeRef)
}

/** A highlighted code cell, or plain text until its grammar loads. Find
 * matches (when active) are marked in place, preserving syntax colors.
 * `row` marks the element for the row-height measurement. */
function codeCell(
  className: string, key: string, content: string, hl: CodeHighlighter,
  find: FindCtx | null = null, row = -1,
): JSX.Element {
  const attrs = { key, className, 'data-r': row >= 0 ? row : undefined }
  if (content === '') return h('div', attrs, '\u00a0')
  const spans = hl(content)?.[0]
  const marked = withFindMarks(content, key, find, spans)
  if (marked !== null) return h('div', attrs, marked)
  return h('div', attrs, spans === undefined ? content : syntaxRuns(spans))
}

/** Highlight the whole line once, then split runs at the word-diff boundaries.
 * When Find is active on this cell, match marks take precedence over the
 * word-diff emphasis (both are just spans; the search overlay wins visually). */
function wordCell(
  className: string, key: string, content: string, range: readonly [number, number],
  wordCls: string, hl: CodeHighlighter, find: FindCtx | null = null, row = -1,
): JSX.Element {
  const attrs = { key, className, 'data-r': row >= 0 ? row : undefined }
  const spans = hl(content)?.[0] ?? [{ text: content, style: {} }]
  const marked = withFindMarks(content, key, find, spans)
  if (marked !== null) return h('div', attrs, marked)
  const [pre, changed, post] = splitHighlightSpans(spans, range)
  return h('div', attrs, [
    ...syntaxRuns(pre, 'p'),
    h('span', { key: 'w', className: wordCls }, changed.length === 0 ? '\u00a0' : syntaxRuns(changed)),
    ...syntaxRuns(post, 's'),
  ])
}

/** One numbered code line for the single-column before/after views. */
interface NumberedLine {
  readonly no: number | null
  readonly text: string
}

/** Before view: every row that had a left (old) side, in order. */
function beforeLines(rows: readonly SideRow[]): NumberedLine[] {
  return rows.filter((r) => r.leftText !== null).map((r) => ({ no: r.leftNo, text: r.leftText as string }))
}
/** After view: every row that had a right (new) side, in order. */
function afterLines(rows: readonly SideRow[]): NumberedLine[] {
  return rows.filter((r) => r.rightText !== null).map((r) => ({ no: r.rightNo, text: r.rightText as string }))
}

function renderRow(
  row: SideRow, i: number, hl: CodeHighlighter,
  expand: GapExpander, find: FindCtx | null, t: (key: GitKey, params?: Record<string, string | number>) => string,
): JSX.Element[] {
  if (row.kind === 'hunk') {
    return [h('div', { key: `h${i}`, className: 'gp-diff-row--hunk gp-diff-cell', style: { gridColumn: '1 / -1' }, 'data-r': i }, row.text ?? '')]
  }
  if (row.kind === 'gap') {
    return [renderGap(row.gap!, i, expand, t)]
  }
  const leftCls = row.kind === 'del' || row.kind === 'mod' ? 'gp-diff-row--del' : ''
  const rightCls = row.kind === 'add' || row.kind === 'mod' ? 'gp-diff-row--add' : ''
  const leftCell = row.leftText === null
    ? h('div', { key: `l${i}`, className: `gp-diff-cell ${leftCls}` })
    : row.kind === 'mod' && row.leftWord !== undefined
      ? wordCell(`gp-diff-cell ${leftCls}`, `l${i}`, row.leftText, row.leftWord, 'gp-diff-word gp-diff-word--del', hl, find, i)
      : codeCell(`gp-diff-cell ${leftCls}`, `l${i}`, row.leftText, hl, find, i)
  const rightCell = row.rightText === null
    ? h('div', { key: `r${i}`, className: `gp-diff-cell ${rightCls}` })
    : row.kind === 'mod' && row.rightWord !== undefined
      ? wordCell(`gp-diff-cell ${rightCls}`, `r${i}`, row.rightText, row.rightWord, 'gp-diff-word gp-diff-word--add', hl, find, i)
      : codeCell(`gp-diff-cell ${rightCls}`, `r${i}`, row.rightText, hl, find, i)
  return [
    h('div', { key: `ln${i}`, className: 'gp-diff-no' }, row.leftNo ?? ''),
    leftCell,
    h('div', { key: `rn${i}`, className: 'gp-diff-no' }, row.rightNo ?? ''),
    rightCell,
  ]
}

/**
 * One unified (inline) row: a full-width line-number gutter (old|new) + one
 * code column tinted by add/del. Gap/hunk rows reuse the split renderers so
 * on-demand expansion works identically in both layouts.
 */
function renderUnifiedRow(
  row: SideRow, i: number, hl: CodeHighlighter,
  expand: GapExpander, find: FindCtx | null, t: (key: GitKey, params?: Record<string, string | number>) => string,
): JSX.Element[] {
  if (row.kind === 'hunk') {
    return [h('div', { key: `h${i}`, className: 'gp-diff-row--hunk gp-diff-cell', style: { gridColumn: '1 / -1' }, 'data-r': i }, row.text ?? '')]
  }
  if (row.kind === 'gap') {
    return [renderGap(row.gap!, i, expand, t)]
  }
  const isDel = row.kind === 'del'
  const isAdd = row.kind === 'add'
  const rowCls = isAdd ? 'gp-diff-row--add' : isDel ? 'gp-diff-row--del' : ''
  const sign = isAdd ? '+' : isDel ? '\u2212' : '\u00a0'
  const content = row.rightText ?? row.leftText ?? ''
  const wordRange = isAdd ? row.rightWord : isDel ? row.leftWord : undefined
  const wordCls = isAdd ? 'gp-diff-word gp-diff-word--add' : 'gp-diff-word gp-diff-word--del'
  const codeCls = `gp-diff-cell gp-diff-uni__code ${rowCls}`
  const code = wordRange !== undefined
    ? wordCell(codeCls, `c${i}`, content, wordRange, wordCls, hl, find, i)
    : codeCell(codeCls, `c${i}`, content, hl, find, i)
  return [
    h('div', { key: `ol${i}`, className: 'gp-diff-no' }, row.leftNo ?? ''),
    h('div', { key: `nl${i}`, className: 'gp-diff-no' }, row.rightNo ?? ''),
    h('div', { key: `sg${i}`, className: `gp-diff-uni__sign ${rowCls}` }, sign),
    code,
  ]
}

/** A collapsed-context band spanning both sides, with expand controls. */
function renderGap(
  gap: GapInfo, i: number, expand: GapExpander,
  t: (key: GitKey, params?: Record<string, string | number>) => string,
): JSX.Element {
  const busyAll = expand.busy === `${gap.rightStart}:all`
  const busyUp = expand.busy === `${gap.rightStart}:up`
  const busyDown = expand.busy === `${gap.rightStart}:down`
  const btn = (dir: 'all' | 'up' | 'down', label: string, busyThis: boolean): JSX.Element =>
    h('button', {
      key: dir, type: 'button', className: 'gp-gap__btn', disabled: expand.busy !== null,
      onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); expand.run(gap, dir) },
    }, busyThis ? t('common.loading') : label)

  const controls: JSX.Element[] = []
  // Counts are always exact, so a gap control can never be a dead button: it
  // is only rendered when there is something to reveal, and a small region is
  // offered whole in one click. A leading gap has no "block above" to expand
  // toward, so it offers no "up".
  const total = gap.count
  if (total <= GAP_STEP) {
    controls.push(btn('all', t('diff.expandGap', { n: total }), busyAll))
  } else {
    if (!gap.atStart) controls.push(btn('up', t('diff.expandUp', { n: GAP_STEP }), busyUp))
    controls.push(btn('all', t('diff.expandGap', { n: total }), busyAll))
    controls.push(btn('down', t('diff.expandDown', { n: GAP_STEP }), busyDown))
  }
  return h('div', { key: `g${i}`, className: 'gp-diff-row--gap', style: { gridColumn: '1 / -1' }, 'data-r': i }, controls)
}

/** Diff +/- summary from unified text (exported for the toolbar). */
export function diffSummary(text: string): { add: number; del: number } {
  return summarize(text)
}
