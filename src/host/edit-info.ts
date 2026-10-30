/**
 * Edit rules shared by the read (`file-content`) and write (`writeFile`) paths:
 * whether a file's bytes can be edited without loss, and how an LF editor
 * buffer is turned back into bytes in the file's own encoding style.
 *
 * Pure functions over bytes; no filesystem access.
 */
import { createHash } from 'node:crypto'
import { EDIT_MAX_BYTES, type FileEditInfo } from './types.js'

const BOM = Buffer.from([0xef, 0xbb, 0xbf])

/** sha256 (hex) of the exact bytes. */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Line-ending style of `text`: `lf` (also for text with no line break),
 * `crlf`, or `mixed` when both appear or a lone CR does. CodeMirror splits on
 * every line-break form and emits LF, so a mixed file cannot be saved back
 * as it was.
 */
export function eolStyle(text: string): 'lf' | 'crlf' | 'mixed' {
  let crlf = 0
  let lf = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 13) {
      if (text.charCodeAt(i + 1) !== 10) return 'mixed'
      crlf++
      i++
    } else if (c === 10) {
      lf++
    }
    if (crlf > 0 && lf > 0) return 'mixed'
  }
  return crlf > 0 ? 'crlf' : 'lf'
}

/**
 * Whether these bytes can be edited: at most EDIT_MAX_BYTES, no NUL byte
 * anywhere (the preview's binary probe only reads the first 8 KB), UTF-8 that
 * survives a decode/encode round trip (otherwise saving would replace the bad
 * bytes with U+FFFD), and a single line-ending style. Write permission is a
 * fact about the file, not the bytes: callers check it separately.
 */
export function editInfo(buf: Buffer): FileEditInfo {
  if (buf.length > EDIT_MAX_BYTES) return { ok: false, reason: 'too-large' }
  if (buf.includes(0)) return { ok: false, reason: 'encoding' }
  const text = buf.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(buf)) return { ok: false, reason: 'encoding' }
  const eol = eolStyle(text)
  if (eol === 'mixed') return { ok: false, reason: 'mixed-eol' }
  return { ok: true, eol, bom: buf.length >= 3 && buf.subarray(0, 3).equals(BOM) }
}

/**
 * Bytes for an editor buffer in the target file's style: stray CRs are folded
 * into LF first, then LF expands to CRLF for a CRLF file, and a BOM is put
 * back when the file had one. A BOM the buffer itself carries is dropped
 * first so it can never double.
 */
export function encodeEdit(content: string, eol: 'lf' | 'crlf', bom: boolean): Buffer {
  let text = content.replace(/\r\n?/g, '\n')
  if (text.startsWith('\uFEFF')) text = text.slice(1)
  if (eol === 'crlf') text = text.replace(/\n/g, '\r\n')
  const body = Buffer.from(text, 'utf8')
  return bom ? Buffer.concat([BOM, body]) : body
}
