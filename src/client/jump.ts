/**
 * Panel/sub-tab focus relay. The pill records a one-shot sub-tab request per
 * session and activates the Git view tab; the Panel consumes the request once
 * mounted. Module-level per-session map, same life pattern as other plugins'
 * focus stores.
 */

export type SubTab = 'overview' | 'changes'

const pending = new Map<string, SubTab>()

/** Record which sub-tab to reveal for a session — replaces any unconsumed request. */
export function requestSubTab(sessionId: string, tab: SubTab): void {
  pending.set(sessionId, tab)
}

/** Take the pending sub-tab request, if any — one-shot. */
export function takeSubTab(sessionId: string): SubTab | null {
  const tab = pending.get(sessionId)
  if (tab === undefined) return null
  pending.delete(sessionId)
  return tab
}

/**
 * Activate the Git view tab by clicking its tab-bar button (the semantic
 * `button[role="tab"]` the conversation shell renders). Matches by the
 * localized label. Returns whether a matching tab was found.
 */
export function activateGitTab(label: string): boolean {
  if (typeof document === 'undefined') return false
  const tabs = document.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
  for (const tab of tabs) {
    if ((tab.textContent ?? '').trim() !== label) continue
    if (tab.getAttribute('aria-selected') !== 'true') tab.click()
    return true
  }
  return false
}
