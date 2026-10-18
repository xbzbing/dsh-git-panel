/**
 * Trigger button the platform Menu wraps — the overview's author / since
 * filters and the config form's cascading model selects share the same
 * dropdown surface. Menu is controlled and never closes itself: callers own
 * the `open` state and close in `onSelect`. The trigger is ours, so it can be
 * disabled per row (busy, not writable, catalog still loading) and style its
 * chip via `extraClass` next to the shared base.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

export function selectTrigger(
  open: boolean,
  label: string,
  toggle: () => void,
  opts: { readonly disabled?: boolean; readonly extraClass?: string } = {},
): JSX.Element {
  const className = opts.extraClass === undefined ? 'gp-select-trigger' : `gp-select-trigger ${opts.extraClass}`
  return h('button', {
    type: 'button',
    className,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    title: label,
    disabled: opts.disabled,
    onClick: toggle,
  }, [
    h('span', { key: 'l', className: 'gp-select-trigger__label' }, label),
    h(IconChevronDownOutlineRegular, { key: 'c', className: 'gp-select-trigger__chevron', size: 14 }),
  ])
}
