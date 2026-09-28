/**
 * Shared in-panel Find primitives, used by both the file source preview and the
 * diff view: a sticky Find bar (query input, case toggle, count, prev/next,
 * close) and the helpers that mark matches inside syntax-highlighted content.
 */
import { createElement as h, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitKey } from './locales'

type T = (key: GitKey, params?: Record<string, string | number>) => string

// Bound the match set so a pathological query (e.g. a single space) on a large
// file/diff cannot build an unbounded array or paint tens of thousands of marks.
export const MAX_MATCHES = 5000

// Delay before a typed query drives match recomputation + a full re-render.
// The input value stays immediate; only the (expensive) scan is debounced.
export const FIND_DEBOUNCE_MS = 120

/**
 * Debounce a value: returns the latest `value` only after it stayed unchanged
 * for `ms`. Keeps per-keystroke typing from re-scanning a large body and
 * re-rendering the whole line grid on every character.
 */
export function useDebounced<V>(value: V, ms: number): V {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/**
 * Find substring match ranges of an already case-normalized `needle` in an
 * already case-normalized `hay`. Callers pass a cached lowercased haystack (see
 * the per-file/per-diff memo) so case-insensitive search does not re-lowercase
 * the whole body on every keystroke.
 */
export function matchRangesRaw(hay: string, needle: string): Array<[number, number]> {
  if (needle === '') return []
  const out: Array<[number, number]> = []
  let from = 0
  for (;;) {
    const idx = hay.indexOf(needle, from)
    if (idx < 0) break
    out.push([idx, idx + needle.length])
    from = idx + needle.length
  }
  return out
}

/**
 * Render `content[from,to)` as the syntax spans clipped to that sub-range (or
 * plain text when no grammar loaded yet), preserving token styles inside a
 * nested match highlight.
 */
export function styledSlice(
  spans: readonly HighlightSpan[] | undefined, content: string, from: number, to: number, keyPrefix: string,
): Array<JSX.Element | string> {
  if (from >= to) return []
  if (spans === undefined) return [content.slice(from, to)]
  const out: JSX.Element[] = []
  let offset = 0
  let k = 0
  for (const span of spans) {
    const spanEnd = offset + span.text.length
    const a = Math.max(from, offset)
    const b = Math.min(to, spanEnd)
    if (b > a) out.push(h('span', { key: `${keyPrefix}-${k++}`, style: span.style }, span.text.slice(a - offset, b - offset)))
    offset = spanEnd
    if (offset >= to) break
  }
  return out
}

/**
 * Wrap the given match ranges of `content` in <mark>, keeping syntax spans. The
 * active range gets an extra class + ref so navigation can scroll it into view.
 */
export function markContent(
  content: string,
  ranges: ReadonlyArray<readonly [number, number]>,
  spans: readonly HighlightSpan[] | undefined,
  keyBase: string,
  activeRange: readonly [number, number] | null,
  activeRef: { current: HTMLElement | null },
): Array<JSX.Element | string> {
  const children: Array<JSX.Element | string> = []
  let cursor = 0
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  for (const [s, e] of sorted) {
    if (s < cursor) continue
    if (s > cursor) children.push(...styledSlice(spans, content, cursor, s, `${keyBase}b${cursor}`))
    const isActive = activeRange !== null && activeRange[0] === s && activeRange[1] === e
    children.push(h('mark', {
      key: `mk${keyBase}-${s}`, className: `gp-find-hit${isActive ? ' gp-find-hit--active' : ''}`,
      ...(isActive ? { ref: activeRef } : {}),
    }, styledSlice(spans, content, s, e, `mk${keyBase}-${s}`)))
    cursor = e
  }
  if (cursor < content.length) children.push(...styledSlice(spans, content, cursor, content.length, `${keyBase}e`))
  return children
}

export interface FindBarProps {
  readonly inputRef: { current: HTMLInputElement | null }
  readonly query: string
  readonly matches: number
  readonly active: number
  readonly caseSensitive: boolean
  readonly onChange: (v: string) => void
  readonly onToggleCase: () => void
  readonly onStep: (delta: number) => void
  readonly onClose: () => void
  readonly t: T
}

/** The shared Find bar. Esc closes; Enter/Shift+Enter walks matches. */
export function FindBar(p: FindBarProps): JSX.Element {
  return h('div', { key: 'find', className: 'gp-find' }, [
    h('input', {
      key: 'in', ref: p.inputRef, className: 'gp-find__input', type: 'text',
      placeholder: p.t('files.findPlaceholder'), value: p.query, spellCheck: false,
      'aria-label': p.t('files.findPlaceholder'),
      onChange: (e: { target: { value: string } }) => p.onChange(e.target.value),
      onKeyDown: (e: KeyboardEvent) => {
        // stopPropagation so Esc dismisses Find without also closing a host
        // modal that listens for Escape.
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onClose() }
        else if (e.key === 'Enter') { e.preventDefault(); p.onStep(e.shiftKey ? -1 : 1) }
      },
    }),
    h('button', {
      key: 'case', type: 'button',
      className: `gp-find__btn gp-find__case${p.caseSensitive ? ' gp-find__case--active' : ''}`,
      title: p.t('files.findCase'), 'aria-label': p.t('files.findCase'), 'aria-pressed': p.caseSensitive,
      onClick: () => p.onToggleCase(),
    }, 'Aa'),
    h('span', { key: 'cnt', className: 'gp-find__count' },
      p.query === '' ? '' : p.matches === 0 ? p.t('files.findNoMatch') : `${p.active + 1}/${p.matches}`),
    h('button', { key: 'prev', type: 'button', className: 'gp-find__btn', title: p.t('files.findPrev'), 'aria-label': p.t('files.findPrev'), disabled: p.matches === 0, onClick: () => p.onStep(-1) }, '\u2039'),
    h('button', { key: 'next', type: 'button', className: 'gp-find__btn', title: p.t('files.findNext'), 'aria-label': p.t('files.findNext'), disabled: p.matches === 0, onClick: () => p.onStep(1) }, '\u203a'),
    h('button', { key: 'x', type: 'button', className: 'gp-find__btn', title: p.t('files.findClose'), 'aria-label': p.t('files.findClose'), onClick: () => p.onClose() }, '\u2715'),
  ])
}
