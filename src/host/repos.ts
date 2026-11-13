/**
 * Nested-repository discovery for the repository switcher (issue #83).
 *
 * A session's cwd is often a workspace directory that is *not* itself a
 * repository but holds one per project (`workspace/site/.git`,
 * `workspace/api/.git`). The panel's original single-repository view only ever
 * asked git for the cwd's own work-tree top, so those projects were invisible.
 * This module scans the cwd for repository roots and resolves the selector the
 * client sends back.
 *
 * Trust boundary: the selector is a cwd-relative path, never an absolute one.
 * Every candidate is realpath'd and re-checked for containment inside the
 * realpath'd cwd before git runs in it, so an absolute path, a `..` escape or a
 * symlink pointing outside the cwd can never become a repository root.
 */
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isSafePath } from './validate.js'

/** Directories the scanner descends into, cwd-relative depth. Deep enough for
 * the common group/project layout, shallow enough that one scan stays cheap. */
export const REPO_SCAN_DEPTH = 3
/** Directory ceiling for one scan: a workspace with a huge tree stops early
 * instead of walking everything on every panel mount. */
export const REPO_SCAN_LIMIT = 2000
/** Repository ceiling for one result list; past this the switcher would be
 * unusable anyway, and the client addresses entries by path, not index. */
export const REPO_RESULT_LIMIT = 50

/** Never a repository of its own, and the two names that would turn a scan
 * into a full dependency-tree walk. */
const SKIP_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules'])

/** The filesystem face the scanner needs — a structural subset of the host's
 * snapshot deps, so production wiring and tests pass the same shape. */
export interface RepoFs {
  readonly realpath: (path: string) => Promise<string>
  readonly stat: (path: string) => Promise<unknown>
  readonly readdir: (path: string) => Promise<readonly { readonly name: string; readonly isDirectory: boolean }[]>
}

/** One nested repository found below the cwd. */
export interface ScannedRepo {
  /** cwd-relative path, POSIX separators. */
  readonly path: string
  /** Absolute realpath of the work-tree top. */
  readonly root: string
  /** Display name (the directory's basename). */
  readonly name: string
}

/** Windows path comparison is case-insensitive; POSIX is not. */
export function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** True when `target` is `root` or sits inside it. */
export function isWithin(root: string, target: string): boolean {
  if (samePath(root, target)) return true
  const prefix = root.endsWith(sep) ? root : root + sep
  return process.platform === 'win32'
    ? target.toLowerCase().startsWith(prefix.toLowerCase())
    : target.startsWith(prefix)
}

/** cwd-relative POSIX path of `target`, or null when it escapes `root`. */
export function relativeRepoPath(root: string, target: string): string | null {
  const rel = relative(root, target)
  if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || rel.startsWith('../')) return null
  return rel.split(sep).join('/')
}

/** A directory is a work-tree top when it has a `.git` entry: a directory in a
 * normal clone, a file in a worktree or submodule. */
async function hasGitEntry(fs: RepoFs, dir: string): Promise<boolean> {
  try {
    await fs.stat(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/**
 * Breadth-first scan of `cwd` for repository roots. A directory with a
 * `.git` is a root and is not descended into (its own nested repositories, if
 * any, belong to it, not to the workspace). Symlinked directories are skipped
 * because the dirent reports them as non-directories. Bounded by depth, scan
 * count and result count; the result is sorted by path so the switcher order is
 * stable.
 */
export async function scanRepos(
  fs: RepoFs,
  cwd: string,
  opts: { readonly depth?: number; readonly scanLimit?: number; readonly resultLimit?: number } = {},
): Promise<ScannedRepo[]> {
  const root = await fs.realpath(cwd).catch(() => cwd)
  const depth = opts.depth ?? REPO_SCAN_DEPTH
  const scanLimit = opts.scanLimit ?? REPO_SCAN_LIMIT
  const resultLimit = opts.resultLimit ?? REPO_RESULT_LIMIT
  const found: ScannedRepo[] = []
  const queue: Array<{ readonly dir: string; readonly depth: number }> = [{ dir: root, depth: 0 }]
  let scanned = 0
  while (queue.length > 0) {
    const item = queue.shift()!
    if (item.depth >= depth) continue
    let entries: readonly { readonly name: string; readonly isDirectory: boolean }[]
    try {
      entries = await fs.readdir(item.dir)
    } catch {
      continue
    }
    const dirs = entries
      .filter((e) => e.isDirectory && !SKIP_DIRS.has(e.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of dirs) {
      if (found.length >= resultLimit || scanned >= scanLimit) {
        found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        return found
      }
      scanned += 1
      const abs = join(item.dir, entry.name)
      if (await hasGitEntry(fs, abs)) {
        // realpath can differ from the listed path (a symlinked *parent*, a
        // case-insensitive filesystem); the root must be the real directory.
        const real = await fs.realpath(abs).catch(() => null)
        if (real === null || !isWithin(root, real)) continue
        const rel = relativeRepoPath(root, real)
        if (rel === null) continue
        found.push({ path: rel, root: real, name: basename(real) })
        continue
      }
      queue.push({ dir: abs, depth: item.depth + 1 })
    }
  }
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return found
}

/**
 * Resolve a repository selector to the directory inside the session cwd.
 *
 * Rejects anything that is not a safe relative path, anything that realpaths
 * outside the cwd (absolute paths and `..` never reach realpath; a symlink
 * that escapes does), the cwd itself (that is the empty selector), and a
 * `.git` directory. Whether the directory is a work-tree top is decided by the
 * caller, which asks git.
 */
export async function repoDirFor(
  fs: RepoFs,
  cwd: string,
  rel: string,
): Promise<{ readonly ok: true; readonly dir: string } | { readonly ok: false }> {
  if (!isSafePath(rel)) return { ok: false }
  const root = await fs.realpath(cwd).catch(() => cwd)
  const real = await fs.realpath(resolve(root, rel)).catch(() => null)
  if (real === null || !isWithin(root, real) || samePath(real, root)) return { ok: false }
  if (basename(real) === '.git') return { ok: false }
  return { ok: true, dir: real }
}

/** True when a selector leaves the session cwd (`..` or a `../…` path). These
 * are the only selectors that can address an external root, and they are never
 * cacheable: the allow-list behind them comes from a file the user may edit. */
export function isOutwardSelector(rel: string): boolean {
  return rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')
}

/**
 * Resolve a selector that leaves the cwd to a directory a `.code-workspace`
 * file certifies (ADR-0030). This is the third door out of the cwd, and it is
 * the narrowest: the realpath must be a member of the allow-list built for this
 * request from the workspace file, so a wire value can name neither an
 * arbitrary parent directory nor a sibling the file does not list.
 *
 * `..` is expected here — that is how an external root is addressed — but an
 * absolute path is still refused, and directories inside the cwd belong to
 * `repoDirFor`, so exactly one door accepts a given path.
 */
export async function repoDirExternal(
  fs: RepoFs,
  cwd: string,
  rel: string,
  allowList: readonly string[],
): Promise<{ readonly ok: true; readonly dir: string } | { readonly ok: false }> {
  if (rel === '' || isAbsolute(rel) || !isOutwardSelector(rel)) return { ok: false }
  const origin = await fs.realpath(cwd).catch(() => cwd)
  const real = await fs.realpath(resolve(origin, rel)).catch(() => null)
  if (real === null || isWithin(origin, real)) return { ok: false }
  if (basename(real) === '.git') return { ok: false }
  return allowList.some((allowed) => samePath(allowed, real)) ? { ok: true, dir: real } : { ok: false }
}

/**
 * Resolve a selector that leaves the cwd, for a directory the session's own
 * repository owns as a checkout: any record `git worktree list` reports,
 * whether the primary work tree or a linked worktree created elsewhere.
 *
 * A session that moved into a linked worktree has its repository root in a
 * parent directory, and a worktree is routinely created beside the checkout
 * (`git worktree add ../feature`), so those rows can only be addressed with
 * `..` — which `repoDirFor` refuses by design. This second door admits exactly
 * the directories git reported for the repository the cwd belongs to: `roots`
 * is that record set, read per request. The path shape decides nothing, so a
 * wire value cannot name an arbitrary parent directory, a sibling checkout or
 * an unrelated repository. Directories inside the cwd are `repoDirFor`'s
 * business and are refused here, so exactly one door accepts a given path.
 *
 * Why this set may be trusted without the workspace file's opt-in: worktree
 * records live in `.git/worktrees/`, host-local state that a cloned repository
 * cannot ship. A row appears here only after the user ran `git worktree add`
 * (ADR-0035).
 */
export async function repoDirCertified(
  fs: RepoFs,
  cwd: string,
  rel: string,
  roots: readonly string[],
): Promise<{ readonly ok: true; readonly dir: string } | { readonly ok: false }> {
  // `..` is allowed here and only here: the selector is meant to leave the cwd.
  // An absolute path is still refused — a selector addresses a directory
  // relative to the session, so a wire value cannot name one by itself.
  if (roots.length === 0 || rel === '' || isAbsolute(rel)) return { ok: false }
  const origin = await fs.realpath(cwd).catch(() => cwd)
  const real = await fs.realpath(resolve(origin, rel)).catch(() => null)
  if (real === null || isWithin(origin, real)) return { ok: false }
  if (basename(real) === '.git') return { ok: false }
  return roots.some((root) => samePath(root, real)) ? { ok: true, dir: real } : { ok: false }
}
