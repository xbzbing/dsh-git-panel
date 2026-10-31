/**
 * Focus lifecycle for a portaled modal dialog: move focus to the close control
 * on open, keep Tab cycling inside the dialog, close on Escape (capture phase,
 * so it wins over handlers on the page behind) and restore the opener on
 * unmount. Shared by the image lightbox and the file fullscreen reader so both
 * follow the same contract.
 *
 * `onClose` is read through a ref: callers pass inline arrows, and re-running
 * the effect on every render would re-focus the dialog and restore focus on
 * each cleanup. `restoreRef` names the control to hand focus back to when the
 * opener itself is unmounted while the dialog is open; the ref is read after
 * the commit, so it points at the control that has just been re-rendered.
 *
 * `escape` turns the Escape half off for an overlay that is not the topmost
 * layer of its own right (the branch drawer yields it to whatever dialog is
 * open above it: this listener is a capture one, so it would otherwise close
 * both layers from one keystroke).
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Marks the root of a mounted overlay that owns Escape. `useDialogFocus` sets
 * it, and the modal shell declares it, so an overlay can ask "is anything above
 * me?" without keeping a list of class names that goes stale.
 */
export const OVERLAY_ATTR = 'data-gp-overlay'

/** Whether any overlay above the page is mounted right now. */
export function hasOverlay(): boolean {
  return overlayDepth() > 0
}

/** How many overlays are mounted, bottom to top. A layer that owns Escape uses
 * this to tell "I am the top" from "a dialog opened above me": with one layer
 * the key is mine, with two it belongs to the one that opened last. */
export function overlayDepth(): number {
  return typeof document === 'undefined' ? 0 : document.querySelectorAll(`[${OVERLAY_ATTR}]`).length
}

export function useDialogFocus(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
  restoreRef?: RefObject<HTMLElement | null>,
  escape = true,
): void {
  const closeRef = useRef(onClose)
  useLayoutEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    const root = containerRef.current
    // Only an overlay that owns Escape is marked as "above": the marker is what
    // a lower layer checks before claiming the keystroke for itself.
    if (escape) root?.setAttribute(OVERLAY_ATTR, '')
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    initialFocusRef?.current?.focus()
    const focusables = (): HTMLElement[] => {
      const root = containerRef.current
      if (root === null) return []
      return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (!escape) return
        // The find bar inside the dialog owns Escape while the caret is in it:
        // closing the whole dialog on the same keystroke would throw away the
        // reader's place. Not stopping propagation lets the bar's own handler
        // (React, bubble phase) receive the key.
        if (event.target instanceof Element && event.target.closest('.gp-find') !== null) return
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const idx = active === null ? -1 : items.indexOf(active)
      event.preventDefault()
      const delta = event.shiftKey ? -1 : 1
      const next = idx === -1
        ? (delta === -1 ? items.length - 1 : 0)
        : (idx + delta + items.length) % items.length
      items[next]?.focus()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      if (escape) root?.removeAttribute(OVERLAY_ATTR)
      // Reading the ref here is the point: the named control is re-rendered by
      // the same commit that closes the dialog, so its node only exists now.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ;(restoreRef?.current ?? opener)?.focus()
    }
  }, [containerRef, initialFocusRef, restoreRef, escape])
}
