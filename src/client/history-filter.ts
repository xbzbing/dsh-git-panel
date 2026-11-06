/**
 * The history page's filter rules that can be decided without React.
 *
 * The search box publishes on a debounce, and the file-history chip is exclusive
 * with every other filter on the wire (the host rejects a request that carries
 * both). Both are decisions about *what changed*, so they live here where a test
 * can pin them: a publish that changes nothing must have no side effects — the
 * tick after a mount publishes the same empty text, and it must not take a chip
 * down with it.
 */
import type { HistoryFilter } from './overview-hooks.js'

/** What one debounced publish should do, or null when there is nothing to say. */
export interface SearchPublish {
  readonly search: string
  readonly pathSearch: string
  /** The write replaces the chip: any other filter is exclusive with it. */
  readonly dropsChip: boolean
}

/**
 * Decide what a debounced search publish does.
 * @param prev - the filter as it stands now.
 * @param search - the message-search text to publish.
 * @param pathSearch - the path-search text to publish.
 * @returns the write, or null when the text is unchanged (no request, no side
 *   effects — in particular the chip survives).
 */
export function searchPublish(
  prev: Pick<HistoryFilter, 'search' | 'pathSearch' | 'exactPath'>, search: string, pathSearch: string,
): SearchPublish | null {
  if (prev.search === search && (prev.pathSearch ?? '') === pathSearch) return null
  return { search, pathSearch, dropsChip: prev.exactPath !== undefined }
}
