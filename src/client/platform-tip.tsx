/**
 * Hover hint for one control, in the shell's own tooltip language: the platform
 * `Tooltip` bubble (dark pill, no built-in delay, portalled out of a clipped
 * surface) when this dsh release exports it, otherwise the control's native
 * `title`. The `aria-label` stays the accessible name either way; this only
 * changes the visual hint.
 *
 * Two invisible constraints keep the fallback reachable:
 * - The client bundle is CJS and reads the primitive through the host module
 *   table at render time, so a shell without the export leaves the property
 *   `undefined` instead of failing to import. A namespace import is the ESM
 *   equivalent, needed if the client half ever stops being CJS.
 * - `memo` / `forwardRef` components are objects, not functions, so presence is
 *   the test — a `typeof` check would silently drop those shells to the slow
 *   native tooltip.
 */
import { cloneElement, createElement as h } from 'react'
import type { JSX } from 'react'
import { Tooltip as PlatformTooltip } from '@deepseek-ai/dsh-client-ui-primitives'

interface PlatformTipProps {
  readonly label: string
  readonly children: JSX.Element
}

/** One control's hint, always hanging below the control it explains. */
export function PlatformTip({ label, children }: PlatformTipProps): JSX.Element {
  if (PlatformTooltip !== undefined) {
    return h(PlatformTooltip, { label, side: 'bottom', delayMs: 0, portal: true, children })
  }
  return cloneElement(children, { title: label })
}
