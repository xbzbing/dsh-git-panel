/**
 * Hover hint for one control, in the shell's own tooltip language: the
 * platform `Tooltip` bubble (dark pill, delay 0) when this dsh release exports
 * it, otherwise the control's native `title`. The native tooltip cannot be
 * sped up and is what these icon controls carried before, so the fallback keeps
 * older shells explained; the `aria-label` stays the accessible name either
 * way — this only changes the visual hint.
 */
import { cloneElement, createElement as h } from 'react'
import type { JSX } from 'react'
import { Tooltip as PlatformTooltip } from '@deepseek-ai/dsh-client-ui-primitives'

export interface PlatformTipProps {
  readonly label: string
  readonly children: JSX.Element
  readonly side?: 'top' | 'bottom'
}

export function PlatformTip({ label, children, side = 'bottom' }: PlatformTipProps): JSX.Element {
  if (typeof PlatformTooltip === 'function') {
    return h(PlatformTooltip, { label, side, portal: true, children })
  }
  return cloneElement(children, { title: label })
}
