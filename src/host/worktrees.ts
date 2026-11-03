/**
 * Worktree discovery for the repository switcher.
 *
 * `git worktree list --porcelain` reports every checkout a repository has — the
 * primary work tree and each linked worktree — with the branch each one holds,
 * the `locked` / `prunable` markers and a detached HEAD. The panel needs it
 * because the common worktree layout (`.agents/worktrees/<branch>`) sits deeper
 * than the filesystem scan's depth ceiling, and because a worktree's `.git` is
 * a *file*, which makes the scanner read it as an unrelated nested repository.
 *
 * Trust boundary: a listed directory is selectable when its realpath lies
 * inside the session cwd — plus the one exception of the primary work tree, the
 * repository root a session that moved into a linked worktree must be able to
 * return to (admitted on the way back by `repoDirCertified` against git's own
 * primary record). Every other directory outside the cwd keeps
 * `disabled: 'outside'` so the user can see why a checkout the repository owns
 * cannot be chosen directly; its `path` is then only a lexical relative
 * string the selector rejects on return. A row whose directory is gone
 * (`prunable`, or unreadable) is marked `stale` instead: it cannot be entered,
 * and saying so is the only honest state.
 */
import { basename, relative, sep } from 'node:path'
import { relativeRepoPath, samePath, type RepoFs } from './repos.js'

/** One record of `git worktree list --porcelain`. */
export interface WorktreeInfo {
  /** Absolute work-tree path as git printed it. */
  readonly path: string
  /** HEAD commit; null when the repository has no commits (unborn). */
  readonly head: string | null
  /** Checked-out branch (refs/heads/ stripped); null = detached HEAD. */
  readonly branch: string | null
  readonly locked: boolean
  readonly prunable: boolean
  readonly bare: boolean
}

/**
 * A worktree converted for the switcher: the cwd-relative selector path (or a
 * lexical relative path for a disabled row), the identity the row needs, and
 * the reason it cannot be chosen when there is one.
 */
export interface WorktreeCheckout {
  /** cwd-relative POSIX path; '' when the row *is* the session's checkout. */
  readonly path: string
  /** Realpath of the directory (the listed path when it is gone). */
  readonly root: string
  readonly name: string
  readonly role: 'main' | 'linked'
  readonly branch: string | null
  readonly locked: boolean
  /** Why the row cannot be chosen: outside the cwd (and not the repository
   * root), or its directory is gone. */
  readonly disabled?: 'outside' | 'stale'
}

/** Parse `git worktree list --porcelain [-z]` output into records. git prints
 * paths verbatim (never quoted), so only the `-z` form — every attribute
 * NUL-terminated, an empty attribute between records — survives a path holding
 * a newline; output without a NUL is the newline form of a git that predates
 * `-z`. An empty attribute separates records; a bare key (`detached`, `bare`)
 * carries no value, and `locked` / `prunable` carry an optional reason. */
export function parseWorktreePorcelain(stdout: string): WorktreeInfo[] {
  const rows: WorktreeInfo[] = []
  let current: { path: string; head: string | null; branch: string | null; locked: boolean; prunable: boolean; bare: boolean } | null = null
  const flush = (): void => {
    if (current !== null) rows.push(current)
    current = null
  }
  for (const line of stdout.includes('\0') ? stdout.split('\0') : stdout.split(/\r?\n/)) {
    if (line === '') {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      flush()
      current = { path: line.slice(9), head: null, branch: null, locked: false, prunable: false, bare: false }
      continue
    }
    if (current === null) continue
    if (line.startsWith('HEAD ') && current.head === null) current.head = line.slice(5)
    else if (line.startsWith('branch ')) current.branch = line.slice(7).replace(/^refs\/heads\//, '')
    else if (line === 'detached' || line.startsWith('detached ')) current.branch = null
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true
    else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true
    else if (line === 'bare') current.bare = true
  }
  flush()
  return rows
}

/** A relative path for a checkout outside the cwd (git printed it, so it is a
 * checkout of this repository). Returned verbatim to the selector and admitted
 * on the way back only against the work-tree list. */
function lexicalRelative(from: string, to: string): string {
  const rel = relative(from, to)
  if (rel === '') return basename(to)
  return rel.split(sep).join('/')
}

/**
 * Convert porcelain records into switcher rows for one session.
 *
 * `workspaceRoot` is the checkout the session's own selector resolves to; the
 * record naming that directory becomes the workspace row (`path: ''`) whatever
 * its primary/linked role is, so the list and the selector agree on identity.
 * The primary work tree keeps `role: 'main'`; every other record is `linked`.
 * Rows are returned in git's order (primary first), then selectable rows and
 * disabled rows grouped by the caller.
 */
export async function worktreeCheckouts(
  fs: RepoFs,
  cwd: string,
  workspaceRoot: string,
  infos: readonly WorktreeInfo[],
): Promise<readonly WorktreeCheckout[]> {
  const out: WorktreeCheckout[] = []
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i]
    if (info.bare) continue
    const role: 'main' | 'linked' = i === 0 ? 'main' : 'linked'
    if (info.prunable) {
      out.push({
        path: lexicalRelative(cwd, info.path),
        root: info.path,
        name: basename(info.path),
        role,
        branch: info.branch,
        locked: info.locked,
        disabled: 'stale',
      })
      continue
    }
    const real = await fs.realpath(info.path).catch(() => null)
    if (real === null) {
      out.push({
        path: lexicalRelative(cwd, info.path),
        root: info.path,
        name: basename(info.path),
        role,
        branch: info.branch,
        locked: info.locked,
        disabled: 'stale',
      })
      continue
    }
    if (samePath(real, workspaceRoot)) {
      out.push({ path: '', root: real, name: basename(real), role, branch: info.branch, locked: info.locked })
      continue
    }
    const rel = relativeRepoPath(cwd, real)
    // The repository root escapes the cwd only for a session that moved into a
    // linked worktree; every other checkout outside the cwd stays unchoosable
    // (it is one hop away once the root is selected).
    if (rel === null && role !== 'main') {
      out.push({
        path: lexicalRelative(cwd, real),
        root: real,
        name: basename(real),
        role,
        branch: info.branch,
        locked: info.locked,
        disabled: 'outside',
      })
      continue
    }
    out.push({
      path: rel ?? lexicalRelative(cwd, real),
      root: real,
      name: basename(real),
      role,
      branch: info.branch,
      locked: info.locked,
    })
  }
  return out
}
