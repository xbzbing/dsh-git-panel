/**
 * VS Code multi-root workspace discovery: external repository roots named by a
 * `.code-workspace` file inside the session cwd (issue #121, ADR-0030).
 *
 * The panel can certify repositories inside the cwd (the scan, `git worktree
 * list`). A hub directory is the opposite layout: the repositories live *next*
 * to it, and the editor model for that is a multi-root workspace file. This
 * module reads that file and resolves its folders into external roots, so the
 * host gains a second certified source without relaxing any path rule: a
 * selector may leave the cwd only when the workspace file names the directory
 * and git confirms it is a work-tree top.
 *
 * Nothing here is trusted implicitly. The file is JSONC (comments, trailing
 * commas, BOM, CRLF), so it cannot go through `JSON.parse` directly; only
 * `folders[].path` and `folders[].name` are read — `settings`, `launch`,
 * `tasks` and every other section is dropped by the parser, not by a filter
 * afterwards. Every folder path is realpath'd, must contain a `.git` entry and
 * must survive `git rev-parse --show-toplevel` equalling the directory itself,
 * which rejects both a subdirectory of a repository and a bare path.
 */
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isOutwardSelector, isWithin, samePath } from './repos.js'

/** One folder entry from the workspace file. */
export interface WorkspaceFolder {
  /** `folders[].path`, verbatim. */
  readonly path: string
  /** `folders[].name`: a display override, not a path. */
  readonly label?: string
}

/** An external repository root the workspace file certifies. */
export interface ExternalRoot {
  /** cwd-relative path with POSIX separators; it leaves the cwd (`../…`). */
  readonly path: string
  /** Absolute realpath of the work-tree top. */
  readonly root: string
  /** Repository basename, for the row title. */
  readonly name: string
  /** `folders[].name` when the file overrides the display name. */
  readonly label?: string
}

/** Detected workspace file plus the roots it certifies. */
export interface CodeWorkspaceScan {
  /** Absolute path of the file, or null when there is none to name. */
  readonly file: string | null
  readonly roots: readonly ExternalRoot[]
  /** Recognition state; absent when nothing was configured for this session
   * (`off`, or `auto` with no candidate). */
  readonly state?: CodeWorkspaceState
}

/** The filesystem face this module needs — a structural subset of the host's
 * snapshot deps, so production wiring and tests pass the same shape. */
export interface CodeWorkspaceFs {
  readonly realpath: (path: string) => Promise<string>
  readonly stat: (path: string) => Promise<{ readonly mtimeMs: number; readonly size: number; readonly isFile: () => boolean }>
  readonly readdir: (path: string) => Promise<readonly { readonly name: string; readonly isDirectory: boolean }[]>
  readonly readFile: (path: string) => Promise<Uint8Array>
}

/** Suffix every VS Code workspace file carries; an explicit setting value must
 * wear it too, which keeps the option self-describing. */
export const CODE_WORKSPACE_SUFFIX = '.code-workspace'

/** Ceiling for one file: a workspace file is a few lines of JSON in practice,
 * and a hostile one must not be read into memory. */
export const CODE_WORKSPACE_MAX_BYTES = 1024 * 1024

/** Ceiling for the roots one file may add. Past this the switcher is unusable
 * anyway, and each entry costs a git probe. */
export const CODE_WORKSPACE_MAX_ROOTS = 20

/** Cache ceiling: one entry per (file, mtime, size) — a file edited often must
 * not grow the map without bound. */
const CODE_WORKSPACE_CACHE_MAX = 32

const POSIX_SEP = '/'

/** Strip `//` and block comments outside string literals. A comment becomes a
 * single space so two tokens never fuse into one. */
export function stripJsoncComments(input: string): string {
  let out = ''
  let index = 0
  while (index < input.length) {
    const char = input[index]!
    if (char === '"') {
      out += char
      index += 1
      // Copy the string verbatim, honouring escapes: `"//"` is data, not a
      // comment, and `"a\"b"` must not end at the escaped quote.
      while (index < input.length) {
        const inner = input[index]!
        out += inner
        index += 1
        if (inner === '\\') {
          if (index < input.length) {
            out += input[index]!
            index += 1
          }
          continue
        }
        if (inner === '"') break
      }
      continue
    }
    if (char === '/' && input[index + 1] === '/') {
      while (index < input.length && input[index] !== '\n' && input[index] !== '\r') index += 1
      out += ' '
      continue
    }
    if (char === '/' && input[index + 1] === '*') {
      index += 2
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) index += 1
      index += 2
      out += ' '
      continue
    }
    out += char
    index += 1
  }
  return out
}

/** Drop a comma that is followed by whitespace and then `}` or `]` — the JSONC
 * trailing comma. Strings are skipped so `","` never matches. */
export function stripTrailingCommas(input: string): string {
  let out = ''
  let inString = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!
    if (inString) {
      out += char
      if (char === '\\') {
        if (index + 1 < input.length) {
          out += input[index + 1]!
          index += 1
        }
        continue
      }
      if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === ',') {
      let next = index + 1
      while (next < input.length && /\s/.test(input[next]!)) next += 1
      if (input[next] === '}' || input[next] === ']') {
        out += ' '
        continue
      }
    }
    out += char
  }
  return out
}

/**
 * Parse a `.code-workspace` file into its folder entries.
 *
 * Returns null for anything that is not a workspace file: unparsable JSONC, a
 * non-object root, a missing `folders` array, or a folder entry without a
 * string `path`. A single malformed entry invalidates the file on purpose — a
 * partially understood project model is worse than an empty list, and guessing
 * which entries to keep would let a broken file silently hide repositories.
 */
export function parseWorkspaceFolders(text: string): readonly WorkspaceFolder[] | null {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let parsed: unknown
  try {
    parsed = JSON.parse(stripTrailingCommas(stripJsoncComments(body)))
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const folders = (parsed as { folders?: unknown }).folders
  if (!Array.isArray(folders)) return null
  const out: WorkspaceFolder[] = []
  for (const entry of folders) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null
    const path = (entry as { path?: unknown }).path
    if (typeof path !== 'string' || path === '') return null
    const label = (entry as { name?: unknown }).name
    out.push({
      path,
      ...(typeof label === 'string' && label.trim() !== '' ? { label: label.trim() } : {}),
    })
  }
  return out
}

/** Recognition state of the session's workspace file, reported on `repo-list`
 * (ADR-0030). Absent when the setting is `off`, or `auto` found no candidate:
 * those are "not configured", not failures. */
export type CodeWorkspaceState = 'applied' | 'missing' | 'invalid' | 'ambiguous'

/**
 * Whether a name is a workspace file, by the same rule VS Code uses:
 * `extname(name) === '.code-workspace'`, no case folding. The exact comparison
 * matters at both ends: `hub.CODE-WORKSPACE` is not a workspace file, and
 * neither is a file literally named `.code-workspace`, whose `extname` is
 * empty. Parity of recognition is the point — the panel must not treat a file
 * the editor opens as plain text as a project model.
 */
export function isCodeWorkspaceName(name: string): boolean {
  return extname(name) === CODE_WORKSPACE_SUFFIX
}

/**
 * Validate an explicit `codeWorkspace` setting value: a single path segment
 * naming a workspace file inside the cwd.
 *
 * The setting is plugin-wide while the cwd is per-session, so an absolute path
 * (or one with a separator, or `..`) would silently point every session at the
 * same place — a cross-session footgun. The shape is refused here; whether the
 * file exists inside *this* cwd is decided when the session is resolved, where
 * the failure is reported instead of silently ignored.
 */
export function explicitCodeWorkspaceName(setting: string): string | null {
  if (setting === '' || setting === 'off' || setting === 'auto') return null
  if (setting.length > 255) return null
  if (setting.includes('/') || setting.includes('\\') || setting.includes('\0')) return null
  if (setting === '.' || setting === '..') return null
  if (!isCodeWorkspaceName(setting)) return null
  return setting
}

/** What the setting resolves to for one session. */
type LocatedWorkspace =
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'missing'; readonly file: string }
  | { readonly kind: 'file'; readonly file: string }

/** Confirm that a candidate is a regular file inside the cwd. */
async function confirmWorkspaceFile(fs: CodeWorkspaceFs, root: string, candidate: string): Promise<LocatedWorkspace> {
  const real = await fs.realpath(candidate).catch(() => null)
  if (real === null) return { kind: 'missing', file: candidate }
  // A symlink out of the workspace would let the setting escape the cwd.
  if (!isWithin(root, real)) return { kind: 'invalid' }
  try {
    if (!(await fs.stat(real)).isFile()) return { kind: 'invalid' }
  } catch {
    return { kind: 'missing', file: candidate }
  }
  return { kind: 'file', file: real }
}

/**
 * Which workspace file the session uses.
 *
 * `auto` accepts exactly one `*.code-workspace` in the cwd, by the VS Code
 * name rule. Two or more resolve to `ambiguous` — including when one of them
 * matches the cwd basename — because guessing would show repositories of a
 * project the user did not pick. An explicit name must exist inside the cwd as
 * a regular file after realpath, so a symlink cannot smuggle the setting out.
 */
async function locateCodeWorkspace(
  fs: CodeWorkspaceFs,
  cwd: string,
  setting: string,
): Promise<LocatedWorkspace> {
  if (setting === 'off') return { kind: 'none' }
  const root = await fs.realpath(cwd).catch(() => cwd)
  if (setting !== 'auto') {
    const name = explicitCodeWorkspaceName(setting)
    // A malformed value is reported, not treated as "off": a typo in the
    // setting is exactly the failure a silent fallback would hide.
    if (name === null) return { kind: 'invalid' }
    return confirmWorkspaceFile(fs, root, join(root, name))
  }
  let entries: readonly { readonly name: string; readonly isDirectory: boolean }[]
  try {
    entries = await fs.readdir(root)
  } catch {
    return { kind: 'none' }
  }
  const candidates = entries
    .filter((entry) => !entry.isDirectory && isCodeWorkspaceName(entry.name))
    .map((entry) => entry.name)
    .sort()
  if (candidates.length === 0) return { kind: 'none' }
  if (candidates.length > 1) return { kind: 'ambiguous' }
  return confirmWorkspaceFile(fs, root, join(root, candidates[0]!))
}

/**
 * Resolve one folder entry to an external root, or null when it does not name a
 * work-tree top outside the cwd.
 *
 * `toplevel` runs `git rev-parse --show-toplevel` in the directory (the host
 * supplies it; this module spawns nothing), and is consulted only after the
 * cheap filesystem probe found a `.git` entry — a folder pointing at an
 * ordinary directory costs no process.
 */
async function resolveFolder(
  fs: CodeWorkspaceFs,
  toplevel: (dir: string) => Promise<string | null>,
  cwdReal: string,
  workspaceDir: string,
  folder: WorkspaceFolder,
): Promise<ExternalRoot | null> {
  if (folder.path.includes('\0')) return null
  const absolute = isAbsolute(folder.path) ? folder.path : resolve(workspaceDir, folder.path)
  const real = await fs.realpath(absolute).catch(() => null)
  if (real === null) return null
  // Entry inside the cwd duplicates an existing row (the workspace repository
  // or a scanned checkout); the scan already owns that namespace.
  if (samePath(real, cwdReal) || isWithin(cwdReal, real)) return null
  if (basename(real) === '.git') return null
  try {
    await fs.stat(join(real, '.git'))
  } catch {
    return null
  }
  const top = await toplevel(real)
  // A subdirectory of a repository resolves to its ancestor and is rejected
  // here; symlinks were already flattened by realpath.
  if (top === null || !samePath(top, real)) return null
  const path = relative(cwdReal, real).split(sep).join(POSIX_SEP)
  // A folder on another Windows drive keeps an absolute path after `relative`,
  // which no door accepts; listing it would be a row that always fails.
  if (isAbsolute(path) || !isOutwardSelector(path)) return null
  return { path, root: real, name: basename(real), ...(folder.label !== undefined ? { label: folder.label } : {}) }
}

/**
 * Read the configured workspace file and resolve its folders.
 *
 * The resolved roots are memoized on `(file, mtimeMs, size)` so a session with
 * an external repository selected does not re-probe up to 20 repositories on
 * every 30-second snapshot. The stamp is part of the key, so an edited file
 * misses and is re-read; a deleted file simply stops producing roots (the
 * caller then rejects the selector, which is the correct answer).
 *
 * The state answers "was the file recognised", independently of how many
 * folders it yielded: a parsed file with no checkouts is `applied`, not empty
 * by accident.
 */
export async function scanCodeWorkspace(
  fs: CodeWorkspaceFs,
  toplevel: (dir: string) => Promise<string | null>,
  cwd: string,
  setting: string,
  cache?: Map<string, readonly ExternalRoot[]>,
): Promise<CodeWorkspaceScan> {
  const located = await locateCodeWorkspace(fs, cwd, setting)
  if (located.kind === 'none') return { file: null, roots: [] }
  if (located.kind === 'ambiguous') return { file: null, roots: [], state: 'ambiguous' }
  if (located.kind === 'invalid') return { file: null, roots: [], state: 'invalid' }
  if (located.kind === 'missing') return { file: located.file, roots: [], state: 'missing' }
  const file = located.file
  let stamp: string
  let size: number
  try {
    const info = await fs.stat(file)
    stamp = `${info.mtimeMs}:${info.size}`
    size = info.size
  } catch {
    return { file, roots: [], state: 'missing' }
  }
  // The roots depend on the cwd too (entries inside it are dropped and `path`
  // is relative to it), so two sessions sharing one file must not share an
  // answer: the realpath'd cwd is part of the key.
  const cwdReal = await fs.realpath(cwd).catch(() => cwd)
  const key = `${cwdReal}\u0000${file}\u0000${stamp}`
  const cached = cache?.get(key)
  if (cached !== undefined) {
    // The key follows the file, not the directories it names: a checkout that
    // was deleted or replaced must not stay a phantom row. One realpath per
    // root, no process spawns.
    const alive: ExternalRoot[] = []
    for (const root of cached) {
      const real = await fs.realpath(root.root).catch(() => null)
      if (real !== null && samePath(real, root.root)) alive.push(root)
    }
    if (alive.length !== cached.length) cache?.set(key, alive)
    return { file, roots: alive, state: 'applied' }
  }
  // The cap is enforced before the read: a hostile file must never enter
  // memory, and `info.size` already says how big it is. The post-read check
  // stays, for a file swapped out between `stat` and `readFile`.
  if (size > CODE_WORKSPACE_MAX_BYTES) return { file, roots: [], state: 'invalid' }
  let text: string
  try {
    const raw = await fs.readFile(file)
    if (raw.byteLength > CODE_WORKSPACE_MAX_BYTES) return { file, roots: [], state: 'invalid' }
    text = Buffer.from(raw).toString('utf8')
  } catch {
    return { file, roots: [], state: 'invalid' }
  }
  const folders = parseWorkspaceFolders(text)
  if (folders === null) return { file, roots: [], state: 'invalid' }
  const workspaceDir = dirname(file)
  const seen = new Set<string>()
  const roots: ExternalRoot[] = []
  for (const folder of folders) {
    if (roots.length >= CODE_WORKSPACE_MAX_ROOTS) break
    const root = await resolveFolder(fs, toplevel, cwdReal, workspaceDir, folder)
    if (root === null) continue
    const identity = process.platform === 'win32' ? root.root.toLowerCase() : root.root
    if (seen.has(identity)) continue
    seen.add(identity)
    roots.push(root)
  }
  roots.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  if (cache !== undefined) {
    if (cache.size >= CODE_WORKSPACE_CACHE_MAX) cache.clear()
    cache.set(key, roots)
  }
  return { file, roots, state: 'applied' }
}
