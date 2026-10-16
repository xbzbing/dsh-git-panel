/** Changed-file status → display helpers, shared by the Changes list and the
 * Overview commit-file tree so both map every status (incl. conflicted /
 * typechange) onto a CSS class that actually exists in styles.ts. */
import type { GitChange, GitChangeStatus } from './types.js'

/** Single-letter badge for a status. */
export const statusChar: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: '!', typechange: 'T',
}

/** CSS class for a status badge; unmapped statuses fall back to modified. */
export function statusClass(status: GitChangeStatus | string): string {
  if (status === 'added' || status === 'untracked') return 'gp-status--added'
  if (status === 'deleted') return 'gp-status--deleted'
  if (status === 'renamed') return 'gp-status--renamed'
  return 'gp-status--modified'
}

/**
 * Whether Git considers `path` untracked. Porcelain collapses an untracked
 * directory into one `?? dir/` entry, so a file inside it matches no change of
 * its own and must be recognised by its untracked ancestor directory.
 */
export function isUntrackedPath(changes: readonly GitChange[], path: string): boolean {
  return changes.some((c) => c.status === 'untracked'
    && (c.isDirectory ? path.startsWith(`${c.path}/`) : c.path === path))
}
