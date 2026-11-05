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
 * The shell's conversation pane root around `from`, when the shell marks one.
 * The main occurrence marks its root with `data-phase`; the right sidebar's
 * embedded chat has no view-tab row and is bounded by `data-sidebar-chat`.
 * Scoping here keeps an ancestor walk from reaching another pane's tab row in
 * a multi-pane shell. Older shells without these markers fall back to the
 * nearest-tablist walk below.
 */
function paneRoot(from?: Element | null): Element | null {
  return from?.closest<HTMLElement>('[data-phase]')
    ?? from?.closest<HTMLElement>('[data-slot="main.conversation"]')
    ?? from?.closest<HTMLElement>('[data-sidebar-chat]')
    ?? null
}

/**
 * The shell's view tabs nearest to `from` (the pill's own conversation in a
 * multi-pane shell; the document otherwise). A narrow conversation — a phone —
 * shows only the leading tabs; the rest, Git included, sit behind the tab row's
 * "more views" menu button, which lives beside the tablist rather than in it.
 */
function shellTabs(from?: Element | null): { readonly root: ParentNode; readonly tabs: HTMLButtonElement[]; readonly more: HTMLButtonElement | null } {
  const pane = paneRoot(from)
  let root: ParentNode = pane ?? document
  if (pane === null) {
    for (let el = from ?? null; el !== null; el = el.parentElement) {
      if (el.querySelector(SHELL_TABLIST_SELECTOR) !== null) { root = el; break }
    }
  }
  const tablist = root.querySelector<HTMLElement>(SHELL_TABLIST_SELECTOR)
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(SHELL_TAB_SELECTOR)]
  const row = tablist?.parentElement ?? null
  const more = row === null
    ? null
    : [...row.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')].find((b) => !(tablist?.contains(b) ?? false)) ?? null
  return { root, tabs, more }
}

const tabLabel = (el: Element): string => (el.textContent ?? '').trim()

/** Pick `label` from the open "more views" menu; the menu renders into a
 * portal after the trigger's click, so the item is polled for a few frames. */
function pickFromMoreMenu(more: HTMLButtonElement, label: string): void {
  if (more.getAttribute('aria-expanded') !== 'true') more.click()
  let frames = 0
  const pick = (): void => {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((n) => tabLabel(n) === label)
    if (item !== undefined) { item.click(); return }
    if (++frames < 30) requestAnimationFrame(pick)
  }
  pick()
}

/**
 * Activate the Git view tab by clicking its tab-bar button (the semantic
 * `button[role="tab"]` the conversation shell renders), matched by the
 * localized label; when the row has no room for it, through the "more views"
 * menu. Returns whether a way to the Git view was found.
 */
export function activateGitTab(label: string, from?: Element | null): boolean {
  if (typeof document === 'undefined') return false
  const { tabs, more } = shellTabs(from)
  const tab = tabs.find((b) => tabLabel(b) === label)
  if (tab !== undefined) {
    if (tab.getAttribute('aria-selected') !== 'true') tab.click()
    return true
  }
  if (more === null) return false
  pickFromMoreMenu(more, label)
  return true
}

/** Whether the Git view is the shell's current view. A Git tab in the row
 * reports it directly; one folded into the "more views" menu has no state on
 * screen, so the mounted conversation panel answers instead (the shell mounts
 * the active view only). Without a tab row or menu there is no shell view to
 * toggle, so the panel is never reported as the active one. */
export function isGitTabActive(label: string, from?: Element | null): boolean {
  if (typeof document === 'undefined') return false
  const { root, tabs, more } = shellTabs(from)
  const tab = tabs.find((b) => tabLabel(b) === label)
  if (tab !== undefined) return tab.getAttribute('aria-selected') === 'true'
  if (more === null) return false
  return root.querySelector('.gp-panel[data-gp-host="conversation"]') !== null
}

/**
 * Leave the Git panel by selecting the first non-Git shell tab — the
 * conversation view, which the shell always keeps first (order 0) and never
 * folds into the menu. Returns whether such a tab was found; a no-op when it
 * is already selected.
 */
export function returnToConversation(label: string, from?: Element | null): boolean {
  if (typeof document === 'undefined') return false
  const tab = shellTabs(from).tabs.find((b) => tabLabel(b) !== label)
  if (tab === undefined) return false
  if (tab.getAttribute('aria-selected') !== 'true') tab.click()
  return true
}
