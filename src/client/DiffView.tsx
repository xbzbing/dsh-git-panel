/** Side-by-side diff renderer with lazy syntax highlighting. */
import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { buildSideBySide, extractAddedContent, extractDeletedContent, isAddOnlyDiff, isBinaryDiff, isDeleteOnlyDiff, isImagePath, summarize, type SideRow } from './diff'
import { currentHighlighter, ensureHighlighter, languageForPath, type Highlighter } from './highlight'
import { ImageCompare } from './ImageCompare'
import type { GitPanelRemote } from './rpc'
import type { GitQuery, GitQueryResult } from './types'
import type { GitKey } from './locales'

export type DiffMode = 'split' | 'before' | 'after'

/** Which comparison the text diff shows — the image sides mirror it. */
export interface ImageDiffSpec {
  readonly base: 'worktree' | 'staged' | 'commit'
  readonly commit?: string
}

interface DiffViewProps {
  readonly text: string
  readonly mode: DiffMode
  /** File path, used to pick a syntax-highlighting grammar. */
  readonly path?: string
  /** Present with imageSpec → a binary image fetches old/new panes instead. */
  readonly remote?: GitPanelRemote
  readonly sessionId?: string
  readonly imageSpec?: ImageDiffSpec
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type ImageDiffValue = Extract<GitQueryResult, { kind: 'image-diff' }>
type ImageState =
  | { readonly kind: 'idle' | 'loading' | 'failed' }
  | { readonly kind: 'ready'; readonly res: ImageDiffValue }

export function DiffView({ text, mode, path, remote, sessionId, imageSpec, t }: DiffViewProps): JSX.Element {
  const rows = useMemo(() => buildSideBySide(text), [text])
  const binary = isBinaryDiff(text)
  const addOnly = useMemo(() => isAddOnlyDiff(text), [text])
  const delOnly = useMemo(() => isDeleteOnlyDiff(text), [text])

  const lang = useMemo(() => (path !== undefined ? languageForPath(path) : ''), [path])
  const hl = useHighlighter(lang)

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

  if (mode === 'before') return singleColumn(delOnly ? extractDeletedContent(text) : leftText(rows), lang, hl)
  if (mode === 'after') return singleColumn(addOnly ? extractAddedContent(text) : rightText(rows), lang, hl)

  // split
  return h('div', { className: 'gp-diff__side' }, rows.flatMap((row, i) => renderRow(row, i, lang, hl)))
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
      setState(res.ok && res.value.kind === 'image-diff' ? { kind: 'ready', res: res.value } : { kind: 'failed' })
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

function leftText(rows: readonly SideRow[]): string {
  return rows.filter((r) => r.leftText !== null).map((r) => r.leftText).join('\n')
}
function rightText(rows: readonly SideRow[]): string {
  return rows.filter((r) => r.rightText !== null).map((r) => r.rightText).join('\n')
}

function singleColumn(content: string, lang: string, hl: Highlighter | null): JSX.Element {
  const lines = content.split('\n')
  return h('div', { className: 'gp-hljs' }, lines.map((line, i) => codeCell('gp-diff-cell', String(i), line, lang, hl)))
}

function renderRow(row: SideRow, i: number, lang: string, hl: Highlighter | null): JSX.Element[] {
  if (row.kind === 'hunk') {
    return [h('div', { key: `h${i}`, className: 'gp-diff-row--hunk gp-diff-cell', style: { gridColumn: '1 / -1' } }, row.text ?? '')]
  }
  const leftCls = row.kind === 'del' ? 'gp-diff-row--del' : ''
  const rightCls = row.kind === 'add' ? 'gp-diff-row--add' : ''
  return [
    h('div', { key: `ln${i}`, className: 'gp-diff-no' }, row.leftNo ?? ''),
    row.leftText === null
      ? h('div', { key: `l${i}`, className: `gp-diff-cell gp-hljs ${leftCls}` })
      : codeCell(`gp-diff-cell gp-hljs ${leftCls}`, `l${i}`, row.leftText, lang, hl),
    h('div', { key: `rn${i}`, className: 'gp-diff-no' }, row.rightNo ?? ''),
    row.rightText === null
      ? h('div', { key: `r${i}`, className: `gp-diff-cell gp-hljs ${rightCls}` })
      : codeCell(`gp-diff-cell gp-hljs ${rightCls}`, `r${i}`, row.rightText, lang, hl),
  ]
}

/** Diff +/- summary from unified text (exported for the toolbar). */
export function diffSummary(text: string): { add: number; del: number } {
  return summarize(text)
}
