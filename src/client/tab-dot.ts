/**
 * Status dot on the conversation shell's Git view-tab button.
 *
 * The shell renders the view-tab label as plain text resolved globally (no
 * per-session context, not reactive to git status), so the dot is injected
 * imperatively next to the label from the always-mounted, session-aware pill.
 * The dot carries no text, so the tab's textContent stays the plain label and
 * the pill's `activateGitTab` matcher keeps working. A narrowly-scoped
 * MutationObserver on the tab list re-applies the dot if the shell re-renders
 * the button. Color mirrors the input-bar pill: green synced / orange dirty.
 */
import { SHELL_TABLIST_SELECTOR, SHELL_TAB_SELECTOR } from './jump'

export type GitTabDotStatus = 'synced' | 'dirty' | null

const DOT_ATTR = 'data-gp-tab-dot'

let observer: MutationObserver | undefined
let observed: HTMLElement | null = null
let currentLabel = ''
let currentStatus: GitTabDotStatus = null
// Owner token: with multiple shell panes two GitPill instances drive this
// module. The last one to set an active dot owns it; a clear from a stale owner
// (its unmount) must not erase the current owner's dot (last-writer-wins).
let owner: symbol | undefined

/** The shell view-tab button carrying the given label (dot text excluded). */
function findTab(label: string): HTMLButtonElement | null {
  if (typeof document === 'undefined') return null
  const tabs = document.querySelectorAll<HTMLButtonElement>(SHELL_TAB_SELECTOR)
  for (const tab of tabs) {
    if ((tab.textContent ?? '').trim() === label) return tab
  }
  return null
}

/** Reconcile the dot on the current tab to the current desired status. */
function apply(): void {
  const btn = findTab(currentLabel)
  if (btn === null) return
  const existing = btn.querySelector<HTMLSpanElement>(`[${DOT_ATTR}]`)
  if (currentStatus === null) {
    existing?.remove()
    return
  }
  const cls = `gp-tab-dot gp-tab-dot--${currentStatus}`
  if (existing !== null) {
    if (existing.className !== cls) existing.className = cls
    return
  }
  const dot = document.createElement('span')
  dot.className = cls
  dot.setAttribute(DOT_ATTR, '')
  dot.setAttribute('aria-hidden', 'true')
  btn.appendChild(dot)
}

/** (Re)attach the observer to the live tab-list container. */
function ensureObserver(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  const container = document.querySelector<HTMLElement>(SHELL_TABLIST_SELECTOR)
  if (container === observed) return
  observer?.disconnect()
  observed = container
  if (container === null) { observer = undefined; return }
  observer = new MutationObserver(() => apply())
  observer.observe(container, { childList: true, subtree: true })
}

function teardownObserver(): void {
  observer?.disconnect()
  observer = undefined
  observed = null
}

/**
 * Set the Git tab's status dot (null hides it). `who` identifies the caller so
 * a later owner's clear can't be undone by an earlier instance. A null status
 * releases ownership and detaches the observer instead of tracking the tab.
 */
export function setGitTabDot(who: symbol, label: string, status: GitTabDotStatus): void {
  if (typeof document === 'undefined') return
  // A null status is a release: same owner check + teardown as clearGitTabDot.
  if (status === null) { clearGitTabDot(who); return }
  owner = who
  currentLabel = label
  currentStatus = status
  ensureObserver()
  apply()
}

/** Remove the dot on behalf of `who` (pill unmount). A stale owner is ignored. */
export function clearGitTabDot(who: symbol): void {
  if (owner !== undefined && owner !== who) return
  owner = undefined
  currentStatus = null
  apply()
  teardownObserver()
}
