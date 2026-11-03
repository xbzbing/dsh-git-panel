/**
 * Input validation for the host trust boundary. Paths, refs, and branch names
 * arriving over RPC are the only untrusted argv material; every git command
 * that would otherwise place them in an option position is guarded here.
 * Subcommands that accept `--end-of-options` additionally pass the value after
 * it (belt-and-suspenders); `checkout` and `reset` do not — those subcommands
 * reject that option — so for them this validation is the only guard.
 */
import { isAbsolute, normalize } from 'node:path'
import { HISTORY_PATH_SEARCH_MAX_LENGTH } from './types.js'

/** A repository-relative path is safe when it stays inside the work tree. */
export function isSafePath(path: string): boolean {
  if (path === '' || isAbsolute(path)) return false
  const norm = normalize(path)
  if (norm === '..' || norm.startsWith('../') || norm.startsWith('..\\')) return false
  return true
}

// Control chars, space, DEL, and the glob / rev-expression metacharacters a
// plain branch/tag/commit ref we filter by must never contain.
const REV_META = /[\x00-\x20\x7f~^:?*[\\]/

/**
 * A ref (branch / tag / commit-ish) is safe as a bare argv element: no leading
 * `-` (would be parsed as a git option — the `--output=` file-write vector),
 * no whitespace/control chars, no glob or rev-range metacharacters.
 */
export function isSafeRev(input: string): boolean {
  if (input === '' || input.startsWith('-')) return false
  if (REV_META.test(input)) return false
  if (input.includes('..') || input.includes('@{')) return false
  return true
}

/** A branch name for `git checkout`: the ref rules plus the shapes a rev
 * filter tolerates but checkout would misread — a bare `.` (checkout takes it
 * as a path and restores the work tree from the index), a trailing `.` or
 * `.lock`, and a bare `@`. */
export function isSafeBranchName(name: string): boolean {
  if (!isSafeRev(name)) return false
  if (name === '.' || name === '@') return false
  if (name.startsWith('/')) return false
  if (name.endsWith('.') || name.endsWith('.lock')) return false
  return true
}

/** A git remote name for `git push -u <remote> HEAD`. Allows the characters git
 * permits in a remote name (alphanumerics, `._/-`) but never a leading dash, so
 * a configured remote can never slip into the option position. */
export function isSafeRemoteName(name: string): boolean {
  return /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(name) && name.length <= 128
}

/** Search text accepted by the history path filter. Empty/whitespace is absent. */
export function validateHistoryPathSearch(input: unknown): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  if (input === undefined) return { ok: true, value: '' }
  if (typeof input !== 'string') return { ok: false, message: 'path search must be a string' }
  if (input.length > HISTORY_PATH_SEARCH_MAX_LENGTH) return { ok: false, message: 'path search is too long' }
  if (/[\x00-\x1f\x7f-\x9f]/.test(input)) return { ok: false, message: 'path search contains a control character' }
  return { ok: true, value: input.trim() }
}

/** Escape the four metacharacters in Git's default wildcard pathspec syntax. */
export function historyPathspec(keyword: string): string {
  const escaped = keyword.replace(/[\\*?\[\]]/g, '\\$&')
  return `:(top,icase)*${escaped}*`
}
