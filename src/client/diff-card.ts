/**
 * The changes tab's enlarged diff card: its open state, the three refs the
 * dialog contract needs, and the focus lifecycle. Kept in one hook so the card
 * cannot be "open" in one place and "not a dialog" in another — the inline
 * `.gp-diff` IS the card restyled (never a portal, so the DiffView cannot
 * remount; ADR-0016 / ADR-0023), and these four facts describe that one element.
 */
import { createElement as h, useCallback, useMemo, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
import { useDialogFocus } from './dialog-focus.js'

export interface DiffCard {
  /** Rendered as a dialog right now: the toggle is on, a diff is selected, and
   * the diff is the pane on screen (compact drills away from it). This is the
   * one flag callers read — the dialog attributes, the backdrop, the focus
   * lifecycle and the sibling pane's `inert` all hang off it. */
  readonly visible: boolean
  /** The card element itself — the focus trap's container. */
  readonly cardRef: RefObject<HTMLDivElement | null>
  /** The toolbar toggle: focus returns here when the card closes. */
  readonly triggerRef: RefObject<HTMLButtonElement | null>
  /** The card's close control: initial focus once the card opens. */
  readonly closeRef: RefObject<HTMLButtonElement | null>
  readonly toggle: () => void
  readonly close: () => void
}

/**
 * Card state for one changes surface. `hasDiff` / `paneIsDiff` / `compact` are
 * the surface's own facts: a card cannot be visible over an empty diff, and in
 * compact the user can drill back to the list leaving the card's flag set (the
 * card then simply is not mounted).
 */
export function useDiffCard(o: { hasDiff: boolean; compact: boolean; paneIsDiff: boolean }): DiffCard {
  const [open, setOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback((): void => setOpen(false), [])
  const toggle = useCallback((): void => setOpen((v) => !v), [])
  const visible = open && o.hasDiff && (!o.compact || o.paneIsDiff)
  return useMemo(
    () => ({ visible, cardRef, triggerRef, closeRef, toggle, close }),
    [visible, toggle, close],
  )
}

/**
 * The card's focus lifecycle, mounted only while it is visible: focus moves to
 * the close control, Tab cycles inside the card, Escape closes it in the
 * capture phase, and focus returns to the toolbar toggle. A component of its
 * own because the shared hook attaches on mount — wrapping the diff itself in a
 * conditional component would remount the DiffView.
 */
export function DiffCardFocus(props: {
  cardRef: RefObject<HTMLDivElement | null>
  initialRef: RefObject<HTMLButtonElement | null>
  restoreRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}): null {
  useDialogFocus(props.cardRef, props.onClose, props.initialRef, props.restoreRef)
  return null
}

/** Backdrop of the in-place card: a click target, hidden from assistive tech. */
export function DiffCardBackdrop(props: { onClose: () => void }): JSX.Element {
  return h('div', {
    className: 'gp-diff-backdrop', 'aria-hidden': 'true',
    onClick: (e: { target: unknown; currentTarget: unknown }) => {
      if (e.target === e.currentTarget) props.onClose()
    },
  })
}
