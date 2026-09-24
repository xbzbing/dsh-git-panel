/** Side-by-side diff renderer with lazy syntax highlighting. */
import { createElement as h, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { buildSideBySide, extractAddedContent, extractDeletedContent, isAddOnlyDiff, isBinaryDiff, isDeleteOnlyDiff, summarize, type SideRow } from './diff'
import { currentHighlighter, ensureHighlighter, languageForPath, type Highlighter } from './highlight'
import type { GitKey } from './locales'

export type DiffMode = 'split' | 'before' | 'after'

interface DiffViewProps {
  readonly text: string
  readonly mode: DiffMode
  /** File path, used to pick a syntax-highlighting grammar. */
  readonly path?: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function DiffView({ text, mode, path, t }: DiffViewProps): JSX.Element {
  const rows = useMemo(() => buildSideBySide(text), [text])
  const binary = isBinaryDiff(text)
  const addOnly = useMemo(() => isAddOnlyDiff(text), [text])
  const delOnly = useMemo(() => isDeleteOnlyDiff(text), [text])

  const lang = useMemo(() => (path !== undefined ? languageForPath(path) : ''), [path])
  const hl = useHighlighter(lang)

  if (binary) return h('div', { className: 'gp-empty' }, t('diff.binary'))
  if (text.trim() === '') return h('div', { className: 'gp-empty' }, t('diff.empty'))

  if (mode === 'before') return singleColumn(delOnly ? extractDeletedContent(text) : leftText(rows), lang, hl)
  if (mode === 'after') return singleColumn(addOnly ? extractAddedContent(text) : rightText(rows), lang, hl)

  // split
  return h('div', { className: 'gp-diff__side' }, rows.flatMap((row, i) => renderRow(row, i, lang, hl)))
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
