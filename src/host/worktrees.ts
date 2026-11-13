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
 * inside the session cwd, or when it is a checkout `git worktree list` reports
 * **and** its own `.git` entry points back into that repository's record set
 * (`checkoutGitDir` / `isOwnCheckout`). The record alone is not evidence: git
 * only replays the path written in `.git/worktrees/<id>/gitdir`, and that is a
 * plain writable file, so a copied repository (its records still name the old
 * machine's absolute paths) or a hand-written record can claim any directory it
 * likes. Verifying the entry makes "this repository owns it" true again
 * (ADR-0035). A checkout outside the cwd keeps a `..` selector; one on another
 * Windows drive, which `relative` cannot express, keeps `disabled: 'outside'`.
 * A row whose directory is gone (`prunable`, or unreadable) is marked `stale`
 * instead, and one this repository does not certify keeps
 * `disabled: 'uncertified'`: it is listed, but the door will refuse it.
 */
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isWithin, relativeRepoPath, samePath, type RepoFs } from './repos.js'

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
  /** Why the row cannot be chosen: outside the cwd on another Windows drive
   * (no relative path), not certified by this repository (see
   * `isOwnCheckout`), or its directory is gone. */
  readonly disabled?: 'outside' | 'uncertified' | 'stale'
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

/** A relative path for a checkout outside the cwd. Returned verbatim to the
 * selector and admitted on the way back only against the certified set. */
function lexicalRelative(from: string, to: string): string {
  const rel = relative(from, to)
  if (rel === '') return basename(to)
  return rel.split(sep).join('/')
}

/** The filesystem face the identity check needs: the `.git` entry of a claimed
 * checkout, read without spawning git. */
export interface CheckoutGitFace {
  readonly realpath: (path: string) => Promise<string>
  readonly stat: (path: string) => Promise<{ isFile(): boolean; isDirectory(): boolean }>
  readonly readFile: (path: string) => Promise<Uint8Array>
}

/** Slack for a `.git` file: a gitlink is one short line; anything much larger
 * is not one. */
const GITDIR_FILE_MAX_BYTES = 4096

/**
 * The git dir a directory's `.git` entry points at, as a realpath; null when
 * there is none or it cannot be read.
 *
 * A plain checkout has a `.git` *directory*; a linked worktree (and a
 * submodule) has a `.git` *file* holding `gitdir: <path>`. Asking this of the
 * directory itself is the only honest question: `git worktree list` merely
 * replays what a record file says about some path, so it can name a directory
 * that belongs to a different repository altogether.
 */
export async function checkoutGitDir(fs: CheckoutGitFace, root: string): Promise<string | null> {
  const dotGit = join(root, '.git')
  let info: { isFile(): boolean; isDirectory(): boolean }
  try {
    info = await fs.stat(dotGit)
  } catch {
    return null
  }
  if (info.isDirectory()) return await fs.realpath(dotGit).catch(() => null)
  if (!info.isFile()) return null
  let raw: Uint8Array
  try {
    raw = await fs.readFile(dotGit)
  } catch {
    return null
  }
  if (raw.byteLength > GITDIR_FILE_MAX_BYTES) return null
  const match = /^\uFEFF?gitdir:[ \t]*(.+?)[ \t]*$/m.exec(Buffer.from(raw).toString('utf8'))
  if (match === null) return null
  const target = match[1]!
  const absolute = isAbsolute(target) ? target : resolve(root, target)
  return await fs.realpath(absolute).catch(() => null)
}

/**
 * Whether `root` really is one of `commonDir`'s checkouts.
 *
 * The primary work tree's `.git` resolves to the common dir itself; a linked
 * worktree's `gitdir:` points at a record under `<commonDir>/worktrees/`. A
 * copied repository's records still name the old machine's paths, and a
 * hand-written record can name anything, so both fail here even though git
 * lists them (ADR-0035).
 */
export async function isOwnCheckout(
  fs: CheckoutGitFace,
  commonDir: string,
  root: string,
  primary: boolean,
): Promise<boolean> {
  const dir = await checkoutGitDir(fs, root)
  if (dir === null) return false
  if (primary) return samePath(dir, commonDir)
  const records = join(commonDir, 'worktrees')
  return isWithin(records, dir) && !samePath(records, dir) && samePath(dirname(dir), records)
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
 *
 * `certified` is the set the door will admit (`certifiedCheckouts`): a record
 * outside the cwd is selectable exactly when it is a member. Reading the rows
 * from git and admitting them by a second rule is how "the row says selectable,
 * the door refuses" happens — the ceiling on the certified set and the identity
 * check both make that possible, so the rows follow it instead of restating it.
 */
export async function worktreeCheckouts(
  fs: RepoFs,
  cwd: string,
  workspaceRoot: string,
  infos: readonly WorktreeInfo[],
  certified: readonly string[],
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
    if (rel === null) {
      // Outside the cwd the row exists only because the repository owns it: the
      // selector is a `..` path, which `repoDirFor` refuses by design and the
      // certified door admits by membership. `certified` is that membership, so
      // a record beyond the ceiling, or one whose `.git` does not point back
      // into this repository, is listed as unchoosable rather than promised.
      const lexical = lexicalRelative(cwd, real)
      const admitted = certified.some((entry) => samePath(entry, real))
      out.push({
        path: lexical,
        root: real,
        name: basename(real),
        role,
        branch: info.branch,
        locked: info.locked,
        ...(isAbsolute(lexical) ? { disabled: 'outside' as const } : admitted ? {} : { disabled: 'uncertified' as const }),
      })
      continue
    }
    out.push({
      path: rel,
      root: real,
      name: basename(real),
      role,
      branch: info.branch,
      locked: info.locked,
    })
  }
  return out
}
