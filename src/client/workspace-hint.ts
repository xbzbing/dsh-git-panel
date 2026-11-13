/**
 * The workspace-file hint's wording.
 *
 * `repo-list` reports one recognition state; `invalid` additionally reports
 * which check refused the file, because the repairs differ: a malformed setting,
 * a symlink out of the cwd, a directory in the file's place, a file past the
 * size cap, an unreadable file, and content that is not a workspace file each
 * need something else from the user. One sentence for all of them only says that
 * something is wrong (ADR-0035).
 *
 * Kept pure and out of the two components that render it (the switcher's hint
 * row and the browser's notice bar) so both say the same thing, and so the
 * fallback for a host that predates the field is tested without a browser.
 */
import type { GitKey } from './locales.js'
import type { WorkspaceInvalidReason } from './types.js'

/** Locale key for an `invalid` recognition.
 *
 * An older host sends no reason, and the generic message is then the honest
 * answer rather than a guess at which check failed. A reason this build does not
 * know (a newer host) takes the same path. */
export function workspaceInvalidKey(reason: WorkspaceInvalidReason | undefined): GitKey {
  switch (reason) {
    case 'name': return 'repos.workspaceInvalidName'
    case 'link': return 'repos.workspaceInvalidLink'
    case 'not-file': return 'repos.workspaceInvalidNotFile'
    case 'size': return 'repos.workspaceInvalidSize'
    case 'read': return 'repos.workspaceInvalidRead'
    case 'parse': return 'repos.workspaceInvalidParse'
    default: return 'repos.workspaceInvalid'
  }
}
