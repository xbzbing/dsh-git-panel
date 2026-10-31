/**
 * Hand a browsable file to the operating system's default application.
 *
 * The panel renders HTML previews in a sandboxed frame. A page whose own script
 * is heavy enough to saturate the shared compositor freezes the whole app while
 * it paints (ADR-0022), so for those pages the useful action is "open it outside
 * the panel": the system browser runs the page in its own process, where it
 * cannot stall the GUI.
 *
 * The OS never sees a path the plugin has not validated first: `isSafePath`
 * rejects traversal and absolute spellings, and the resolved file must still be
 * inside the browse root after symlinks are followed — the same containment
 * check the read endpoints use.
 */
import { join } from 'node:path'
import { isSafePath } from './validate.js'
import { isInsideRoot } from './queries.js'
import type { SnapshotDeps } from './core.js'
import type { GitOpenFileResult } from './types.js'

/** Platform argv that opens one file with its default handler. */
export function openerArgv(platform: string, target: string): readonly string[] | null {
  if (platform === 'darwin') return ['open', target]
  // `start` is a cmd built-in and cannot be argv[0]; rundll32 hands the path to
  // the registered handler without going through a shell.
  if (platform === 'win32') return ['rundll32', 'url.dll,FileProtocolHandler', target]
  if (platform === 'linux') return ['xdg-open', target]
  return null
}

/** Whether this host can hand a file to the desktop at all. */
export function canOpenWithSystem(platform: string): boolean {
  return openerArgv(platform, 'x') !== null
}

/**
 * Resolve `path` inside `root` and open it with the OS default application.
 *
 * @param deps Host fs face (realpath containment).
 * @param root Browse root for the session.
 * @param path Browse-root-relative path from the client (untrusted).
 * @param spawn Runs one argv and resolves with its exit code, or null on failure.
 * @returns The absolute path on success, a typed failure otherwise.
 */
export async function openWithSystem(
  deps: SnapshotDeps,
  root: string,
  path: string,
  spawn: (argv: readonly string[]) => Promise<number | null>,
  platform: string = process.platform,
): Promise<GitOpenFileResult> {
  if (!isSafePath(path)) return { ok: false, error: { code: 'invalid-path', message: path } }
  // The panel's only use for this is "open the HTML preview outside the GUI", so
  // host-side allow-listing the extension keeps the endpoint from becoming a way
  // to launch a repository's own `.command` / `.app` / `.exe` / `.desktop`.
  if (!/\.html?$/i.test(path)) return { ok: false, error: { code: 'invalid-path', message: path } }
  const file = join(root, path)
  const inside = await isInsideRoot(deps, root, file, true)
  if (inside === 'missing') return { ok: false, error: { code: 'file-not-found', message: path } }
  if (inside !== 'inside') return { ok: false, error: { code: 'invalid-path', message: path } }
  const argv = openerArgv(platform, file)
  if (argv === null) return { ok: false, error: { code: 'git-error', message: 'no system opener on this platform' } }
  const code = await spawn(argv)
  if (code !== 0) return { ok: false, error: { code: 'git-error', message: `the system opener exited ${String(code)}` } }
  return { ok: true, absolutePath: file }
}
