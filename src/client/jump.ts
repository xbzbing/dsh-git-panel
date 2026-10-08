/**
 * Panel/sub-tab focus relay. The pill records a sub-tab request per session and
 * activates the Git view tab. A mounted Panel receives the request live through
 * a subscriber; a not-yet-mounted Panel takes the pending value on mount — so a
 * pill click switches sub-tabs even when the panel is already visible.
 */

export type SubTab = 'overview' | 'changes' | 'files'

/** The conversation shell's view-tab bar and its buttons — one definition for
 * both the pill jump and the tab status dot, so neither can match an unrelated
 * `role="tab"` elsewhere on the page. */
export const SHELL_TABLIST_SELECTOR = '[data-conversation-tabs]'
export const SHELL_TAB_SELECTOR = '[data-conversation-tabs] button[role="tab"]'

const pending = new Map<string, SubTab>()
const subscribers = new Map<string, Set<(tab: SubTab) => void>>()

/** Record a sub-tab request; deliver to live subscribers, else hold it pending. */
export function requestSubTab(sessionId: string, tab: SubTab): void {
  const subs = subscribers.get(sessionId)
  if (subs !== undefined && subs.size > 0) {
    for (const cb of subs) cb(tab)
    return
  }
  pending.set(sessionId, tab)
}

/** Take the pending sub-tab request, if any — one-shot (mount path). */
export function takeSubTab(sessionId: string): SubTab | null {
  const tab = pending.get(sessionId)
  if (tab === undefined) return null
  pending.delete(sessionId)
  return tab
}

/** Subscribe a mounted Panel to live sub-tab requests; returns an unsubscribe
 * that also drops the session's subscriber set when empty (no leak). */
export function subscribeSubTab(sessionId: string, cb: (tab: SubTab) => void): () => void {
  let set = subscribers.get(sessionId)
  if (set === undefined) { set = new Set(); subscribers.set(sessionId, set) }
  set.add(cb)
  return () => {
    const s = subscribers.get(sessionId)
    if (s === undefined) return
    s.delete(cb)
    if (s.size === 0) subscribers.delete(sessionId)
  }
}

/**
 * Sub-tab stickiness across a panel unmount. Switching the shell's view tab
 * away unmounts the Panel (losing its selection); if the user returns within
 * STICKY_MS the last sub-tab is restored instead of recomputing the default
 * entry. The clock starts when the panel is left (stash on unmount), so the
 * window measures time away, not time since the last tab click.
 */
const STICKY_MS = 60_000
const sticky = new Map<string, { tab: SubTab; leftAt: number }>()

/** Record the sub-tab the panel is leaving on, timestamped now. */
export function stashSubTab(sessionId: string, tab: SubTab): void {
  sticky.set(sessionId, { tab, leftAt: Date.now() })
}

/** The stashed sub-tab if the panel was left within the sticky window, else
 * null (an expired entry is dropped). */
export function recentSubTab(sessionId: string): SubTab | null {
  const entry = sticky.get(sessionId)
  if (entry === undefined) return null
  if (Date.now() - entry.leftAt > STICKY_MS) { sticky.delete(sessionId); return null }
  return entry.tab
}

/**
 * Activate the Git view tab by clicking its tab-bar button (the semantic
 * `button[role="tab"]` the conversation shell renders). Matches by the
 * localized label. Returns whether a matching tab was found.
 */
export function activateGitTab(label: string): boolean {
  if (typeof document === 'undefined') return false
  const tabs = document.querySelectorAll<HTMLButtonElement>(SHELL_TAB_SELECTOR)
  for (const tab of tabs) {
    if ((tab.textContent ?? '').trim() !== label) continue
    if (tab.getAttribute('aria-selected') !== 'true') tab.click()
    return true
  }
  return false
}

/** Whether the Git view tab is the shell's currently selected tab. */
export function isGitTabActive(label: string): boolean {
  if (typeof document === 'undefined') return false
  const tabs = document.querySelectorAll<HTMLButtonElement>(SHELL_TAB_SELECTOR)
  for (const tab of tabs) {
    if ((tab.textContent ?? '').trim() !== label) continue
    return tab.getAttribute('aria-selected') === 'true'
  }
  return false
}

/**
 * Leave the Git panel by selecting the first non-Git shell tab — the
 * conversation view, which the shell always keeps first (order 0). Returns
 * whether such a tab was found; a no-op when it is already selected.
 */
export function returnToConversation(label: string): boolean {
  if (typeof document === 'undefined') return false
  const tabs = document.querySelectorAll<HTMLButtonElement>(SHELL_TAB_SELECTOR)
  for (const tab of tabs) {
    if ((tab.textContent ?? '').trim() === label) continue
    if (tab.getAttribute('aria-selected') !== 'true') tab.click()
    return true
  }
  return false
}
