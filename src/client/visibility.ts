/** Shared, lazy Page Visibility subscription; usable without a DOM. */
export interface VisibilitySource {
  isVisible(): boolean
  subscribe(listener: () => void): () => void
}

interface VisibilityDocument {
  readonly hidden: boolean
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export function createVisibilitySource(
  getDocument: () => VisibilityDocument | undefined = () => typeof document === 'undefined' ? undefined : document,
): VisibilitySource {
  const listeners = new Set<() => void>()
  let watched: VisibilityDocument | undefined
  let visible = true
  const isVisible = (): boolean => getDocument()?.hidden !== true
  const changed = (): void => {
    const next = isVisible()
    if (next === visible) return
    visible = next
    for (const listener of [...listeners]) listener()
  }
  return {
    isVisible,
    subscribe(listener) {
      if (listeners.size === 0) {
        watched = getDocument()
        visible = isVisible()
        watched?.addEventListener('visibilitychange', changed)
      }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          watched?.removeEventListener('visibilitychange', changed)
          watched = undefined
        }
      }
    },
  }
}

export const pageVisibility = createVisibilitySource()
