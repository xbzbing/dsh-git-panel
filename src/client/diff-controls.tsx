/**
 * The two toolbar controls every diff surface renders: the "expand all context"
 * toggle and the mode segmented control. Both the inline changes pane and the
 * commit file-diff dialog use them, so the pressed/disabled contract and the
 * glyphs cannot drift between the two. Each control takes its own callback
 * shape: a surface that renders only one of them passes nothing it cannot use.
 */
import { createElement as h } from 'react'
import type { CSSProperties, JSX } from 'react'
import type { GitKey } from './locales.js'
import { ExpandAllIcon } from './icons.js'
import { segButtons } from './seg.js'
import type { DiffMode } from './DiffView.js'

export interface DiffExpandCbs {
  /** The mode the view actually renders (compact maps split → unified);
   * expansion only means something for a whole-file view. */
  readonly mode: DiffMode
  readonly expanded: boolean
  readonly onToggleExpand: () => void
  /** Toolbar placement. The changes pane's stats span normally carries the
   * right-edge push (`marginLeft: 'auto'`); with no stats item — the diff is
   * still loading, or it is empty — the button takes that job itself so the
   * control group does not sit left of where the reader expects it. */
  readonly style?: CSSProperties
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export interface DiffModeCbs {
  /** The mode the view actually renders (compact maps split → unified). */
  readonly mode: DiffMode
  readonly modes: readonly DiffMode[]
  readonly onMode: (mode: DiffMode) => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Expansion only means something for a whole-file view. */
function expandable(mode: DiffMode): boolean {
  return mode === 'split' || mode === 'unified'
}

export function renderDiffExpand(cb: DiffExpandCbs): JSX.Element {
  const label = cb.t(cb.expanded ? 'diff.collapse' : 'diff.expandAll')
  return h('button', {
    key: 'expand', type: 'button',
    className: 'gp-icon-btn gp-diff__expand',
    ...(cb.style !== undefined ? { style: cb.style } : {}),
    disabled: !expandable(cb.mode),
    'aria-pressed': cb.expanded,
    title: label,
    'aria-label': label,
    onClick: () => cb.onToggleExpand(),
  }, h(ExpandAllIcon, { size: 14 }))
}

export function renderDiffModeSeg(cb: DiffModeCbs): JSX.Element {
  return h('div', { key: 'seg', className: 'gp-seg' },
    segButtons<DiffMode>(cb.modes, cb.mode, cb.onMode, (m) => cb.t(`diff.${m}` as GitKey)))
}
