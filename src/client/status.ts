/** Changed-file status → display helpers, shared by the Changes list and the
 * Overview commit-file tree so both map every status (incl. conflicted /
 * typechange) onto a CSS class that actually exists in styles.ts. */
import type { GitChangeStatus } from './types'

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
