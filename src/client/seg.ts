/** Shared segmented-control button row (the `.gp-seg__btn` active-class map).
 * Returns just the buttons; each caller keeps its own wrapper div so the outer
 * class, layout, and label source stay per-site. */
import { createElement as h } from 'react'
import type { JSX } from 'react'

export function segButtons<T extends string>(
  items: readonly T[],
  active: T,
  onPick: (value: T) => void,
  labelFn: (value: T) => string,
  disabled = false,
): JSX.Element[] {
  return items.map((value) =>
    h('button', {
      key: value, type: 'button',
      className: `gp-seg__btn${active === value ? ' gp-seg__btn--active' : ''}`,
      ...(disabled ? { disabled: true } : {}),
      onClick: () => onPick(value),
    }, labelFn(value)))
}
