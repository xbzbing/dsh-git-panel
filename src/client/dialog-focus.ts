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
 * Keys inside a `KEYS_OWNER_ATTR` subtree (the file editor) are offered to
 * that subtree first: the capture listener lets Tab / Escape through, and a
 * bubble listener applies the dialog's handling only when the subtree left
 * the event un-`preventDefault`ed. That is how Tab indents inside the editor
 * and Escape closes its search panel without closing the reader, while an
 * unhandled key (Escape with no panel, Tab after the editor's Escape escape
 * hatch) still reaches the dialog.
 *
 * `escape` turns the Escape half off for an overlay that is not the topmost
 * layer of its own right (the branch drawer yields it to whatever dialog is
 * open above it: this listener is a capture one, so it would otherwise close
 * both layers from one keystroke).
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

/** Marks a subtree that handles its own Tab / Escape before the dialog does. */
export const KEYS_OWNER_ATTR = 'data-gp-keys-owner'

function inKeysOwner(event: KeyboardEvent): boolean {
  const target = event.target
  return target instanceof Element && target.closest(`[${KEYS_OWNER_ATTR}]`) !== null
}

/**
 * Marks the root of a mounted overlay that owns Escape. `useDialogFocus` sets
 * it, and the modal shell declares it, so an overlay can ask "is anything above
 * me?" without keeping a list of class names that goes stale.
 */
export const OVERLAY_ATTR = 'data-gp-overlay'

/** Whether any overlay above the page is mounted right now. */
export function hasOverlay(): boolean {
  return typeof document !== 'undefined' && document.querySelector(`[${OVERLAY_ATTR}]`) !== null
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
    const handle = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (!escape) return
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
    // A key typed inside another overlay belongs to that overlay: cycling
    // focus back here would pull it out of the dialog the user is answering.
    // The nearest marked ancestor decides, so a confirmation portaled above
    // this dialog and one rendered inside it (the browser-fullscreen reader
    // card hosts its own confirmations) both count as another overlay.
    const inOtherOverlay = (event: KeyboardEvent): boolean => {
      const target = event.target
      if (!(target instanceof Element)) return false
      const nearest = target.closest(`[${OVERLAY_ATTR}]`)
      return nearest !== null && nearest !== containerRef.current
    }
    const onCapture = (event: KeyboardEvent): void => {
      if (inOtherOverlay(event)) return
      if ((event.key === 'Escape' || event.key === 'Tab') && inKeysOwner(event)) return
      handle(event)
    }
    const onBubble = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !inKeysOwner(event)) return
      handle(event)
    }
    window.addEventListener('keydown', onCapture, true)
    window.addEventListener('keydown', onBubble)
    return () => {
      window.removeEventListener('keydown', onCapture, true)
      window.removeEventListener('keydown', onBubble)
      if (escape) root?.removeAttribute(OVERLAY_ATTR)
      // Reading the ref here is the point: the named control is re-rendered by
      // the same commit that closes the dialog, so its node only exists now.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ;(restoreRef?.current ?? opener)?.focus()
    }
  }, [containerRef, initialFocusRef, restoreRef, escape])
}
