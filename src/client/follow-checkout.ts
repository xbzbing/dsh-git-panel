/**
 * Which repository row a session's current directory belongs to, for the
 * "follow the session" switch.
 *
 * The platform projects the session's live directory as `workingDirectory`;
 * the host's repository list carries the same directories as realpaths. A
 * follow target is only ever a selectable checkout of the session's own
 * repository — the workspace row or a row git reported as `main` / `linked` —
 * because moving the panel into an unrelated nested repository or a
 * `.code-workspace` root would be following `working_directory` again, which
 * ADR-0041 deliberately does not do. Pure: paths and rows in, one row out, so
 * the rules are unit-tested without a renderer.
 */
import type { GitRepoEntry } from './types.js'

/** The platform's standard `useProjection` slot prop, bound to the slot's Session. */
export type UseProjection = (key: string, selector?: (value: unknown) => unknown) => unknown

/** Normalize a host path for comparison: forward slashes, no trailing separator. */
function normalize(path: string): string {
  const slashed = path.replace(/\\/g, '/')
  return slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed
}

/** Windows paths compare case-insensitively; POSIX paths do not. */
function windowsPath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith('//')
}

/** Whether two host paths name the same directory (case rules follow the path shape). */
function samePath(a: string, b: string): boolean {
  return windowsPath(a) || windowsPath(b) ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Whether `target` is `root` itself or sits below it. */
function within(root: string, target: string): boolean {
  const normalizedRoot = normalize(root)
  const normalizedTarget = normalize(target)
  if (samePath(normalizedRoot, normalizedTarget)) return true
  if (normalizedRoot === '/') return normalizedTarget.startsWith('/')
  return windowsPath(normalizedRoot) || windowsPath(normalizedTarget)
    ? normalizedTarget.toLowerCase().startsWith(normalizedRoot.toLowerCase() + '/')
    : normalizedTarget.startsWith(normalizedRoot + '/')
}

/**
 * The row to follow for `directory`, or undefined when the directory's own row
 * cannot be followed.
 *
 * The most specific row decides: the longest root covering the directory, so a
 * worktree nested inside the main checkout (the `.agents/worktrees/<branch>`
 * layout) is never attributed to the main row. That row is then judged — a
 * disabled row (outside the cwd and uncertified, or stale) and a scanned nested
 * repository or `.code-workspace` root (`role: 'repo'`) yield nothing rather
 * than falling back to an ancestor row, because the panel must not move to a
 * different checkout than the one the session actually works in. The workspace
 * row (`path: ''`) is trusted without a role: its root is the session's own
 * checkout by construction, and a session created in a linked worktree carries
 * it as the workspace row too.
 */
export function checkoutForDirectory(
  directory: string | null | undefined,
  repos: readonly GitRepoEntry[],
): GitRepoEntry | undefined {
  if (typeof directory !== 'string' || directory === '') return undefined
  let best: GitRepoEntry | undefined
  let bestLength = -1
  for (const row of repos) {
    if (!within(row.root, directory)) continue
    const length = normalize(row.root).length
    if (length > bestLength) {
      best = row
      bestLength = length
    }
  }
  if (best === undefined) return undefined
  if (best.disabled !== undefined) return undefined
  if (best.path !== '' && best.role !== 'main' && best.role !== 'linked') return undefined
  return best
}

/**
 * Whether `directory` is exactly the row's root, not merely below it.
 *
 * The follow effect refetches the list once when the session's directory is
 * below a plausible row but no row names it: a worktree created during the
 * session is a directory under the main checkout that the last scan could not
 * know about, and following the enclosing row instead would show the wrong
 * tree. An exact row needs no such read.
 */
export function atCheckoutRoot(directory: string | null | undefined, row: GitRepoEntry): boolean {
  return typeof directory === 'string' && directory !== '' && samePath(normalize(directory), normalize(row.root))
}
