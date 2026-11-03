/**
 * The two toolbar controls every diff surface renders: the "expand all context"
 * toggle and the view-mode switches. Both the inline changes pane and the
 * commit file-diff dialog use them, so the pressed/disabled contract and the
 * glyphs cannot drift between the two. Each control takes its own callback
 * shape: a surface that renders only one of them passes nothing it cannot use.
 */
import { createElement as h } from 'react'
import type { CSSProperties, JSX } from 'react'
import { IconCompareSplitOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitKey } from './locales.js'
import { AfterIcon, BeforeIcon, ExpandAllIcon } from './icons.js'
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

/**
 * View-mode switches: one icon toggle for unified ↔ split (the shell's
 * compare glyph, rotated once the split view is on) and one per single-side
 * view. A pressed switch means "this is what you are looking at"; pressing it
 * again returns to the unified diff, so the reader never needs a separate
 * "back" control. `data-diff-mode` gives tests and tooltips a stable handle.
 */
export function renderDiffModes(cb: DiffModeCbs): JSX.Element {
  const split = cb.mode === 'split'
  const compare = cb.modes.includes('split')
    ? h('button', {
      key: 'split', type: 'button',
      className: 'gp-icon-btn gp-diff__mode',
      'data-diff-mode': 'split',
      'aria-pressed': split,
      title: cb.t(split ? 'diff.toUnified' : 'diff.toSplit'),
      'aria-label': cb.t(split ? 'diff.toUnified' : 'diff.toSplit'),
      onClick: () => cb.onMode(split ? 'unified' : 'split'),
    }, h(IconCompareSplitOutlineRegular, { key: 'i', size: 15, className: 'gp-diff__compare-icon' }))
    : null
  const side = (mode: 'before' | 'after'): JSX.Element | null => {
    if (!cb.modes.includes(mode)) return null
    const pressed = cb.mode === mode
    const label = cb.t(pressed ? 'diff.backToUnified' : `diff.${mode}`)
    const icon = mode === 'before' ? BeforeIcon : AfterIcon
    return h('button', {
      key: mode, type: 'button',
      className: 'gp-icon-btn gp-diff__mode',
      'data-diff-mode': mode,
      'aria-pressed': pressed,
      title: label,
      'aria-label': label,
      onClick: () => cb.onMode(pressed ? 'unified' : mode),
    }, h(icon, { key: 'i', size: 15 }))
  }
  return h('div', {
    key: 'modes',
    className: 'gp-diff__modes',
    role: 'group',
    'aria-label': cb.t('diff.viewMode'),
  }, [compare, side('before'), side('after')])
}
