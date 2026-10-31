/**
 * The two toolbar controls every diff surface renders: the "expand all context"
 * toggle and the mode segmented control. Both the inline changes pane and the
 * commit file-diff dialog use them, so the pressed/disabled contract and the
 * glyphs cannot drift between the two.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type { GitKey } from './locales.js'
import { ExpandAllIcon } from './icons.js'
import { segButtons } from './seg.js'
import type { DiffMode } from './DiffView.js'

export interface DiffControlsCbs {
  /** The mode the view actually renders (compact maps split → unified). */
  readonly mode: DiffMode
  readonly modes: readonly DiffMode[]
  readonly onMode: (mode: DiffMode) => void
  readonly expanded: boolean
  readonly onToggleExpand: () => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Expansion only means something for a whole-file view. */
function expandable(mode: DiffMode): boolean {
  return mode === 'split' || mode === 'unified'
}

export function renderDiffExpand(cb: DiffControlsCbs): JSX.Element {
  const label = cb.t(cb.expanded ? 'diff.collapse' : 'diff.expandAll')
  return h('button', {
    key: 'expand', type: 'button',
    className: 'gp-icon-btn gp-diff__expand',
    disabled: !expandable(cb.mode),
    'aria-pressed': cb.expanded,
    title: label,
    'aria-label': label,
    onClick: () => cb.onToggleExpand(),
  }, h(ExpandAllIcon, { size: 14 }))
}

export function renderDiffModeSeg(cb: DiffControlsCbs): JSX.Element {
  return h('div', { key: 'seg', className: 'gp-seg' },
    segButtons<DiffMode>(cb.modes, cb.mode, cb.onMode, (m) => cb.t(`diff.${m}` as GitKey)))
}
