/** Side-by-side diff renderer with lazy syntax highlighting, on-demand gap
 * expansion, and word-level intra-line emphasis. */
import { createElement as h, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  buildSideBySide, flattenToUnified, isBinaryDiff,
  isImagePath, spliceGap, summarize, GAP_STEP, type GapInfo, type SideRow,
} from './diff'
import { currentHighlighter, ensureHighlighter, languageForPath, type Highlighter } from './highlight'
import { ImageCompare } from './ImageCompare'
import type { GitPanelRemote } from './rpc'
import { queryAs } from './rpc'
import type { GitQuery, GitQueryResult } from './types'
import type { GitKey } from './locales'

/** unified = single inline column; split = side-by-side; before/after show one
 * side's full content. */
export type DiffMode = 'unified' | 'split' | 'before' | 'after'

/** Which comparison the diff shows — image sides and gap-expansion source
 * both mirror it. */
export interface ImageDiffSpec {
  readonly base: 'worktree' | 'staged' | 'commit'
  readonly commit?: string
}

interface DiffViewProps {
  readonly text: string
  readonly mode: DiffMode
  /** File path, used to pick a syntax-highlighting grammar. */
  readonly path?: string
  /** Present with imageSpec → a binary image fetches old/new panes instead;
   * also the source for on-demand gap (hidden-context) expansion. */
  readonly remote?: GitPanelRemote
  readonly sessionId?: string
  readonly imageSpec?: ImageDiffSpec
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type ImageDiffValue = Extract<GitQueryResult, { kind: 'image-diff' }>
type ImageState =
  | { readonly kind: 'idle' | 'loading' | 'failed' }
  | { readonly kind: 'ready'; readonly res: ImageDiffValue }

export const DiffView = memo(function DiffView({ text, mode, path, remote, sessionId, imageSpec, t }: DiffViewProps): JSX.Element {
  const baseRows = useMemo(() => buildSideBySide(text), [text])
  const binary = isBinaryDiff(text)

  const lang = useMemo(() => (path !== undefined ? languageForPath(path) : ''), [path])
  const hl = useHighlighter(lang)

  // Rows are stateful in split mode so revealed gap context can be spliced in;
  // reseed whenever the underlying diff text changes.
  const [rows, setRows] = useState<readonly SideRow[]>(baseRows)
  useEffect(() => { setRows(baseRows) }, [baseRows])
  const expand = useGapExpander(rows, setRows, remote, sessionId, path, imageSpec)

  const imageable = binary && path !== undefined && isImagePath(path) && remote !== undefined && sessionId !== undefined && imageSpec !== undefined
  const image = useImageDiff(imageable ? remote : undefined, imageable ? sessionId : undefined, imageable ? path : undefined, imageable ? imageSpec : undefined)

  if (binary) {
    if (imageable) {
      if (image.kind === 'idle' || image.kind === 'loading') return h('div', { className: 'gp-empty' }, t('common.loading'))
      if (image.kind === 'ready') {
        const res = image.res
        if (res.tooLarge === true) return h('div', { className: 'gp-empty' }, t('diff.tooLarge'))
        if (res.mime !== null && (res.old !== undefined || res.new !== undefined)) {
          return h(ImageCompare, { oldUrl: res.old, newUrl: res.new, mode, t })
        }
      }
      // failed / unsupported / no sides → the plain binary notice below.
    }
    return h('div', { className: 'gp-empty' }, t('diff.binary'))
  }
  if (text.trim() === '') return h('div', { className: 'gp-empty' }, t('diff.empty'))

  if (mode === 'before') return singleColumn(beforeLines(rows), lang, hl)
  if (mode === 'after') return singleColumn(afterLines(rows), lang, hl)

  if (mode === 'unified') {
    const uni = flattenToUnified(rows)
    return h('div', { className: 'gp-diff__unified' }, uni.flatMap((row, i) => renderUnifiedRow(row, i, lang, hl, expand, t)))
  }

  // split
  return h('div', { className: 'gp-diff__side' }, rows.flatMap((row, i) => renderRow(row, i, lang, hl, expand, t)))
})

interface GapExpander {
  readonly busy: string | null
  readonly run: (gap: GapInfo, direction: 'all' | 'up' | 'down') => void
}

/**
 * On-demand hidden-context expansion. Clicking a gap control fetches the
 * revealed slice (file-lines query, source mirrors imageSpec) and splices it
 * into the row list. A generation guard drops a stale response if the rows
 * were reseeded (diff text changed) mid-flight.
 */
function useGapExpander(
  rows: readonly SideRow[],
  setRows: (updater: (prev: readonly SideRow[]) => readonly SideRow[]) => void,
  remote: GitPanelRemote | undefined,
  sessionId: string | undefined,
  path: string | undefined,
  spec: ImageDiffSpec | undefined,
): GapExpander {
  const [busy, setBusy] = useState<string | null>(null)
  const gen = useRef(0)
  // Reseeding the rows (diff text changed) invalidates any in-flight reveal.
  useEffect(() => { gen.current += 1; setBusy(null) }, [rows])

  const run = useCallback((gap: GapInfo, direction: 'all' | 'up' | 'down') => {
    if (remote === undefined || sessionId === undefined || path === undefined || spec === undefined) return
    const key = `${gap.rightStart}:${direction}`
    setBusy(key)
    const my = ++gen.current
    // Which slice to request. 'up'/'down' reveal one GAP_STEP window; 'all'
    // (and any bounded gap) reveal the whole hidden region.
    const { start, end } = sliceRequest(gap, direction)
    const query: GitQuery = spec.base === 'commit' && spec.commit !== undefined
      ? { kind: 'file-lines', path, base: 'commit', commit: spec.commit, start, end }
      : spec.base === 'staged'
        ? { kind: 'file-lines', path, base: 'staged', start, end }
        : { kind: 'file-lines', path, base: 'worktree', start, end }
    void remote.query({ sessionId, query }).then((res) => {
      if (my !== gen.current) return
      const fl = queryAs(res, 'file-lines')
      setBusy(null)
      if (fl === null) return
      setRows((prev) => spliceGap(prev, gap.rightStart, direction, fl.start, fl.lines, fl.eof))
    }).catch(() => { if (my === gen.current) setBusy(null) })
  }, [remote, sessionId, path, spec, setRows])

  return { busy, run }
}

/** New-side line range to request for a gap expansion step. */
function sliceRequest(gap: GapInfo, direction: 'all' | 'up' | 'down'): { start: number; end: number } {
  if (gap.atEnd) {
    // Trailing gap: reveal the next window below the last shown line.
    return { start: gap.rightStart, end: gap.rightStart + GAP_STEP - 1 }
  }
  const total = gap.count ?? GAP_STEP
  if (direction === 'all' || total <= GAP_STEP) {
    return { start: gap.rightStart, end: gap.rightStart + total - 1 }
  }
  if (direction === 'down') {
    return { start: gap.rightStart, end: gap.rightStart + GAP_STEP - 1 }
  }
  // 'up': reveal the bottom window of the gap.
  return { start: gap.rightStart + total - GAP_STEP, end: gap.rightStart + total - 1 }
}

/**
 * Fetch the old/new image sides for a binary image path. Identity-stable
 * primitives only (the spec object may be rebuilt every render); a generation
 * guard drops a response that a newer path/base took over.
 */
function useImageDiff(
  remote: GitPanelRemote | undefined,
  sessionId: string | undefined,
  path: string | undefined,
  spec: ImageDiffSpec | undefined,
): ImageState {
  const [state, setState] = useState<ImageState>({ kind: 'idle' })
  const base = spec?.base
  const commit = spec?.commit
  useEffect(() => {
    if (remote === undefined || sessionId === undefined || path === undefined || base === undefined) return
    let alive = true
    setState({ kind: 'loading' })
    const query: GitQuery = base === 'commit' && commit !== undefined
      ? { kind: 'image-diff', path, base: 'commit', commit }
      : base === 'staged'
        ? { kind: 'image-diff', path, base: 'staged' }
        : { kind: 'image-diff', path, base: 'worktree' }
    void remote.query({ sessionId, query }).then((res) => {
      if (!alive) return
      const img = queryAs(res, 'image-diff')
      setState(img !== null ? { kind: 'ready', res: img } : { kind: 'failed' })
    }).catch(() => { if (alive) setState({ kind: 'failed' }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, sessionId, path, base, commit])
  return state
}

/**
 * Resolve the loaded highlighter for a language, kicking the lazy import on
 * first need. Returns null (plain text) until the bundle lands, then a
 * highlighter that actually supports `lang`.
 */
function useHighlighter(lang: string): Highlighter | null {
  const [, bump] = useState(0)
  useEffect(() => {
    if (lang === '') return
    if (currentHighlighter() !== null) return
    let alive = true
    void ensureHighlighter().then(() => { if (alive) bump((n) => n + 1) })
    return () => { alive = false }
  }, [lang])
  if (lang === '') return null
  const hl = currentHighlighter()
  return hl !== null && hl.supports(lang) ? hl : null
}

/** A highlighted code cell, or a plain-text one when no highlighter/lang. */
function codeCell(className: string, key: string, content: string, lang: string, hl: Highlighter | null): JSX.Element {
  if (content === '') return h('div', { key, className }, '\u00a0')
  if (hl === null) return h('div', { key, className }, content)
  return h('div', { key, className, dangerouslySetInnerHTML: { __html: hl.line(content, lang) } })
}

/**
 * A code cell for a modified line with an intra-line change range: the changed
 * middle is wrapped in a `.gp-diff-word` span. Each of the three segments
 * (prefix / changed / suffix) is highlighted independently so highlight.js
 * spans never straddle the word marker and break its nesting.
 */
function wordCell(
  className: string, key: string, content: string, range: readonly [number, number],
  wordCls: string, lang: string, hl: Highlighter | null,
): JSX.Element {
  const [a, b] = range
  const pre = content.slice(0, a)
  const mid = content.slice(a, b)
  const post = content.slice(b)
  const seg = (s: string): { __html: string } | undefined => (hl === null ? undefined : { __html: hl.line(s, lang) })
  const part = (s: string, k: string): JSX.Element =>
    hl === null ? h('span', { key: k }, s) : h('span', { key: k, dangerouslySetInnerHTML: seg(s) })
  return h('div', { key, className }, [
    pre !== '' ? part(pre, 'p') : null,
    h('span', { key: 'w', className: wordCls }, mid !== '' ? part(mid, 'm') : '\u00a0'),
    post !== '' ? part(post, 's') : null,
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

function singleColumn(lines: readonly NumberedLine[], lang: string, hl: Highlighter | null): JSX.Element {
  return h('div', { className: 'gp-diff__single' }, lines.flatMap((line, i) => [
    h('div', { key: `n${i}`, className: 'gp-diff-no' }, line.no ?? ''),
    codeCell('gp-diff-cell gp-hljs', `c${i}`, line.text, lang, hl),
  ]))
}

function renderRow(
  row: SideRow, i: number, lang: string, hl: Highlighter | null,
  expand: GapExpander, t: (key: GitKey, params?: Record<string, string | number>) => string,
): JSX.Element[] {
  if (row.kind === 'hunk') {
    return [h('div', { key: `h${i}`, className: 'gp-diff-row--hunk gp-diff-cell', style: { gridColumn: '1 / -1' } }, row.text ?? '')]
  }
  if (row.kind === 'gap') {
    return [renderGap(row.gap!, i, expand, t)]
  }
  const leftCls = row.kind === 'del' || row.kind === 'mod' ? 'gp-diff-row--del' : ''
  const rightCls = row.kind === 'add' || row.kind === 'mod' ? 'gp-diff-row--add' : ''
  const leftCell = row.leftText === null
    ? h('div', { key: `l${i}`, className: `gp-diff-cell gp-hljs ${leftCls}` })
    : row.kind === 'mod' && row.leftWord !== undefined
      ? wordCell(`gp-diff-cell gp-hljs ${leftCls}`, `l${i}`, row.leftText, row.leftWord, 'gp-diff-word gp-diff-word--del', lang, hl)
      : codeCell(`gp-diff-cell gp-hljs ${leftCls}`, `l${i}`, row.leftText, lang, hl)
  const rightCell = row.rightText === null
    ? h('div', { key: `r${i}`, className: `gp-diff-cell gp-hljs ${rightCls}` })
    : row.kind === 'mod' && row.rightWord !== undefined
      ? wordCell(`gp-diff-cell gp-hljs ${rightCls}`, `r${i}`, row.rightText, row.rightWord, 'gp-diff-word gp-diff-word--add', lang, hl)
      : codeCell(`gp-diff-cell gp-hljs ${rightCls}`, `r${i}`, row.rightText, lang, hl)
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
  row: SideRow, i: number, lang: string, hl: Highlighter | null,
  expand: GapExpander, t: (key: GitKey, params?: Record<string, string | number>) => string,
): JSX.Element[] {
  if (row.kind === 'hunk') {
    return [h('div', { key: `h${i}`, className: 'gp-diff-row--hunk gp-diff-cell', style: { gridColumn: '1 / -1' } }, row.text ?? '')]
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
  const codeCls = `gp-diff-cell gp-hljs gp-diff-uni__code ${rowCls}`
  const code = wordRange !== undefined
    ? wordCell(codeCls, `c${i}`, content, wordRange, wordCls, lang, hl)
    : codeCell(codeCls, `c${i}`, content, lang, hl)
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
  if (gap.atEnd) {
    controls.push(btn('down', t('diff.expandDown', { n: GAP_STEP }), busyDown))
  } else {
    const total = gap.count ?? 0
    if (total > 0 && total <= GAP_STEP) {
      controls.push(btn('all', t('diff.expandGap', { n: total }), busyAll))
    } else {
      // Larger gap: reveal up, down, or all. A leading gap has no "block above"
      // to expand toward, so it offers only "down" + "all", and vice versa.
      if (!gap.atStart) controls.push(btn('up', t('diff.expandUp', { n: GAP_STEP }), busyUp))
      controls.push(btn('all', t('diff.expandGap', { n: total }), busyAll))
      controls.push(btn('down', t('diff.expandDown', { n: GAP_STEP }), busyDown))
    }
  }
  return h('div', { key: `g${i}`, className: 'gp-diff-row--gap', style: { gridColumn: '1 / -1' } }, controls)
}

/** Diff +/- summary from unified text (exported for the toolbar). */
export function diffSummary(text: string): { add: number; del: number } {
  return summarize(text)
}
