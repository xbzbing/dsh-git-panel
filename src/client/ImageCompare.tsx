/**
 * Old/new image panes for a binary image diff. Side-by-side in split mode,
 * single pane in before/after mode; a side that does not exist (added,
 * untracked, deleted) shows a placeholder instead of an image.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type { DiffMode } from './DiffView'
import type { GitKey } from './locales'

interface ImageCompareProps {
  readonly oldUrl?: string
  readonly newUrl?: string
  readonly mode: DiffMode
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

function pane(side: 'before' | 'after', url: string | undefined, t: ImageCompareProps['t']): JSX.Element {
  const label = t(`diff.${side}` as GitKey)
  return h('div', { className: `gp-imgcmp__pane gp-imgcmp__pane--${side}` }, [
    h('div', { key: 'head', className: 'gp-imgcmp__head' }, label),
    url === undefined
      ? h('div', { key: 'missing', className: 'gp-imgcmp__missing' }, t('diff.imageMissing'))
      : h('div', { key: 'img', className: 'gp-imgcmp__img' }, h('img', { src: url, alt: label })),
  ])
}

export function ImageCompare({ oldUrl, newUrl, mode, t }: ImageCompareProps): JSX.Element {
  if (mode === 'before') return h('div', { className: 'gp-imgcmp gp-imgcmp--single' }, pane('before', oldUrl, t))
  if (mode === 'after') return h('div', { className: 'gp-imgcmp gp-imgcmp--single' }, pane('after', newUrl, t))
  return h('div', { className: 'gp-imgcmp' }, [pane('before', oldUrl, t), pane('after', newUrl, t)])
}
