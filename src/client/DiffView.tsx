/** Side-by-side diff renderer. */
import { createElement as h, useMemo } from 'react'
import type { JSX } from 'react'
import { buildSideBySide, extractAddedContent, extractDeletedContent, isAddOnlyDiff, isBinaryDiff, isDeleteOnlyDiff, summarize, type SideRow } from './diff'
import type { GitKey } from './locales'

export type DiffMode = 'split' | 'before' | 'after'

interface DiffViewProps {
  readonly text: string
  readonly mode: DiffMode
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function DiffView({ text, mode, t }: DiffViewProps): JSX.Element {
  const rows = useMemo(() => buildSideBySide(text), [text])
  const binary = isBinaryDiff(text)
  const addOnly = useMemo(() => isAddOnlyDiff(text), [text])
  const delOnly = useMemo(() => isDeleteOnlyDiff(text), [text])

  if (binary) return h('div', { className: 'gp-empty' }, t('diff.binary'))
  if (text.trim() === '') return h('div', { className: 'gp-empty' }, t('diff.empty'))

  if (mode === 'before') return singleColumn(delOnly ? extractDeletedContent(text) : leftText(rows))
  if (mode === 'after') return singleColumn(addOnly ? extractAddedContent(text) : rightText(rows))

  // split
  return h('div', { className: 'gp-diff__side' }, rows.flatMap((row, i) => renderRow(row, i)))
}

function leftText(rows: readonly SideRow[]): string {
  return rows.filter((r) => r.leftText !== null).map((r) => r.leftText).join('\n')
}
function rightText(rows: readonly SideRow[]): string {
  return rows.filter((r) => r.rightText !== null).map((r) => r.rightText).join('\n')
}

function singleColumn(content: string): JSX.Element {
  const lines = content.split('\n')
  return h('div', {}, lines.map((line, i) => h('div', { key: i, className: 'gp-diff-cell' }, line === '' ? '\u00a0' : line)))
}

function renderRow(row: SideRow, i: number): JSX.Element[] {
  if (row.kind === 'hunk') {
    return [h('div', { key: `h${i}`, className: 'gp-diff-row--hunk gp-diff-cell', style: { gridColumn: '1 / -1' } }, row.text ?? '')]
  }
  const leftCls = row.kind === 'del' ? 'gp-diff-row--del' : row.kind === 'add' && row.leftText === null ? '' : ''
  const rightCls = row.kind === 'add' ? 'gp-diff-row--add' : row.kind === 'del' && row.rightText === null ? '' : ''
  return [
    h('div', { key: `ln${i}`, className: 'gp-diff-no' }, row.leftNo ?? ''),
    h('div', { key: `l${i}`, className: `gp-diff-cell ${leftCls}` }, row.leftText === null ? '' : (row.leftText === '' ? '\u00a0' : row.leftText)),
    h('div', { key: `rn${i}`, className: 'gp-diff-no' }, row.rightNo ?? ''),
    h('div', { key: `r${i}`, className: `gp-diff-cell ${rightCls}` }, row.rightText === null ? '' : (row.rightText === '' ? '\u00a0' : row.rightText)),
  ]
}

/** Diff +/- summary from unified text (exported for the toolbar). */
export function diffSummary(text: string): { add: number; del: number } {
  return summarize(text)
}
