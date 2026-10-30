/**
 * Save one allow-listed working-tree file from the file browser's editor.
 *
 * The write is a compare-and-swap against the version the edit started from
 * (`baseSha256`), so a change made meanwhile (by the AI session or any other
 * program) is reported as `file-changed` instead of being overwritten. The
 * new bytes reach the target through a temp file in the same directory and a
 * `rename`, so a reader never sees a half-written file. The path goes through
 * the same `isSafePath` + realpath containment check as `file-content`, and
 * both the requested name and the realpath's name must be on the allow-list.
 *
 * No git command runs here: editing is a plain file write.
 */
import { randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import type { GitPanelConfig, SnapshotDeps } from './core.js'
import { editInfo, encodeEdit, sha256Hex } from './edit-info.js'
import { countLines, hasGitSegment, resolveInsideRoot } from './queries.js'
import { EDIT_MAX_BYTES, isEditablePath, type FileEditBlock, type GitErrorCode, type GitWriteFileResult } from './types.js'
import { isSafePath } from './validate.js'

/** Per-realpath queue: two saves of one file in this process run one after the
 * other, so the second compares against what the first wrote. */
const locks = new Map<string, Promise<void>>()

async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => held)
  locks.set(key, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (locks.get(key) === tail) locks.delete(key)
  }
}

function fail(code: GitErrorCode, message?: string): GitWriteFileResult {
  return { ok: false, error: message === undefined ? { code } : { code, message } }
}

function blocked(reason: FileEditBlock): GitWriteFileResult {
  return { ok: false, error: { code: 'not-editable', reason } }
}

function errnoOf(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** A filesystem failure as a wire error. The OS message names absolute paths
 * (the temp file's included), so only the errno code travels. */
function fsFailure(error: unknown): GitWriteFileResult {
  const errno = errnoOf(error)
  if (errno === 'ENOENT') return fail('file-not-found')
  if (errno === 'EACCES' || errno === 'EPERM' || errno === 'EROFS') return fail('write-denied', errno)
  return fail('write-failed', errno ?? 'unknown')
}

/**
 * Write `content` over `root/path` when the disk bytes still match `baseSha256`.
 *
 * @param deps Host fs face.
 * @param config Live config (`allowFileEdit`).
 * @param root Browse root for the session.
 * @param request Path (untrusted, browse-root relative), LF editor text, and
 *   the base fingerprint.
 * @returns The file-content view of the bytes now on disk, or a typed failure;
 *   on any failure nothing was written.
 */
export async function writeWorkspaceFile(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  root: string,
  request: { readonly path: string; readonly content: string; readonly baseSha256: string },
): Promise<GitWriteFileResult> {
  if (!config.allowFileEdit) return fail('edit-disabled')
  const { path, content, baseSha256 } = request
  if (typeof path !== 'string' || !isSafePath(path) || hasGitSegment(path)) return fail('invalid-path')
  if (typeof content !== 'string' || typeof baseSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(baseSha256)) {
    return fail('not-editable')
  }
  if (!isEditablePath(path)) return fail('not-editable')
  // Every UTF-16 code unit encodes to at least one UTF-8 byte, so text longer
  // than the cap in code units is over it in bytes: refused before any I/O.
  if (content.length > EDIT_MAX_BYTES) return blocked('too-large')
  const file = join(root, path)
  // One realpath resolution: the path that passed containment is the one the
  // write replaces.
  const inside = await resolveInsideRoot(deps, root, file, true)
  if (inside.state !== 'inside') return fail(inside.state === 'missing' ? 'file-not-found' : 'invalid-path')
  const real = inside.real
  // A link inside the root still may not lead an allow-listed name to a
  // script: the target's own name is checked too.
  if (!isEditablePath(real)) return fail('not-editable')

  let mode: number
  try {
    const info = await deps.fs.stat(real)
    if (!info.isFile()) return fail('not-editable')
    if (info.size > EDIT_MAX_BYTES) return blocked('too-large')
    mode = info.mode & 0o7777
  } catch (error) {
    return fsFailure(error)
  }
  // `rename` only needs the directory to be writable: without this a
  // read-only file would be replaced.
  if (!(await deps.fs.writable(real))) return blocked('read-only')

  return withFileLock(real, async () => {
    let current: Buffer
    try {
      current = await deps.fs.readFile(real)
    } catch (error) {
      return fsFailure(error)
    }
    const currentSha256 = sha256Hex(current)
    if (currentSha256 !== baseSha256) return { ok: false, error: { code: 'file-changed', currentSha256 } }
    const info = editInfo(current)
    if (!info.ok) return blocked(info.reason)
    const bytes = encodeEdit(content, info.eol, info.bom)
    if (bytes.length > EDIT_MAX_BYTES) return blocked('too-large')

    const temp = join(dirname(real), `.${basename(real)}.gp-${randomBytes(6).toString('hex')}.tmp`)
    try {
      await deps.fs.writeExclusive(temp, bytes, mode)
    } catch (error) {
      // EEXIST: the name was already taken, and that entry is not ours to
      // remove. Any other failure may have left a partial temp file.
      if (errnoOf(error) !== 'EEXIST') await deps.fs.unlink(temp).catch(() => undefined)
      return fsFailure(error)
    }
    try {
      await deps.fs.rename(temp, real)
    } catch (error) {
      await deps.fs.unlink(temp).catch(() => undefined)
      return fsFailure(error)
    }

    let mtimeMs: number
    try {
      mtimeMs = Math.round((await deps.fs.stat(real)).mtimeMs)
    } catch {
      mtimeMs = Date.now()
    }
    const text = bytes.toString('utf8')
    return { ok: true, value: {
      kind: 'file-content', path, variant: 'text',
      content: text, lines: countLines(text), absolutePath: file,
      size: bytes.length, mtimeMs,
      sha256: sha256Hex(bytes), edit: editInfo(bytes),
    } }
  })
}
