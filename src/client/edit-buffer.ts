/**
 * Pure helpers for the file-browser editor: the editor language and indent
 * unit for a file, turning a `file-content` body into the LF editor buffer,
 * and the pre-save JSON / XML syntax checks. YAML is checked by the editor
 * chunk (`validateYaml`), which returns the same `SyntaxIssue` shape.
 */
import type { FileEditBlock, FileEditInfo } from './types.js'
import type { GitKey } from './locales.js'

/** The slice of the preview state the edit button reads. */
export type EditableFile =
  | { readonly kind: 'text'; readonly sha256?: string; readonly edit?: FileEditInfo }
  | { readonly kind: 'tooLarge'; readonly edit?: FileEditInfo }
  | { readonly kind: 'idle' | 'loading' | 'image' | 'binary' | 'error' }

/** Whether the edit button shows, and why it is disabled when it is. */
export type EditAvailability =
  | { readonly state: 'hidden' }
  | { readonly state: 'disabled'; readonly reason: GitKey }
  | { readonly state: 'ready' }

const BLOCK_REASON: Record<FileEditBlock, GitKey> = {
  'too-large': 'files.editBlockedTooLarge',
  encoding: 'files.editBlockedEncoding',
  'mixed-eol': 'files.editBlockedMixedEol',
  'read-only': 'files.editBlockedReadOnly',
}

/** Copy key for one edit block: the disabled button's tip, and a save the
 * host refused for the same reason. */
export function editBlockKey(reason: FileEditBlock): GitKey {
  return BLOCK_REASON[reason]
}

/** Edit button state for the file on screen. */
export function editAvailability(file: EditableFile): EditAvailability {
  if (file.kind !== 'text' && file.kind !== 'tooLarge') return { state: 'hidden' }
  const edit = file.edit
  if (edit === undefined) return { state: 'hidden' }
  if (!edit.ok) return { state: 'disabled', reason: BLOCK_REASON[edit.reason] }
  return file.kind === 'text' && file.sha256 !== undefined ? { state: 'ready' } : { state: 'hidden' }
}


/** Editor language for one allow-listed file. */
export type EditorLanguage = 'json' | 'xml' | 'markdown' | 'yaml' | 'toml' | 'properties' | 'text'

/** Languages whose buffer is syntax-checked before a save. */
export type CheckedLanguage = 'json' | 'xml' | 'yaml'

/** First problem a pre-save check found (1-based line / column; 0 = unknown),
 * plus how many problems there are in total. */
export interface SyntaxIssue {
  readonly line: number
  readonly column: number
  readonly message: string
  readonly count: number
}

function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? '').toLowerCase()
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1)
}

/** Editor language for a path (callers only ask for allow-listed files). */
export function editorLanguageFor(path: string): EditorLanguage {
  const name = baseName(path)
  if (name === '.editorconfig' || name === '.env') return 'properties'
  switch (extensionOf(name)) {
    case 'json': return 'json'
    case 'xml': return 'xml'
    case 'md': case 'markdown': return 'markdown'
    case 'yaml': case 'yml': return 'yaml'
    case 'toml': return 'toml'
    case 'properties': case 'ini': case 'cfg': return 'properties'
    default: return 'text'
  }
}

/** Whole file names of well-known JSON files whose readers accept comments
 * (and trailing commas). */
const JSONC_NAMES = new Set([
  'devcontainer.json', '.devcontainer.json', '.eslintrc.json', '.babelrc.json', 'babel.config.json',
  'deno.json', 'tslint.json', 'api-extractor.json', 'language-configuration.json',
])

/**
 * JSON files that conventionally carry comments (JSONC): `JSON.parse` would
 * flag every one of them, so they skip the check.
 */
export function isJsoncName(path: string): boolean {
  const parts = path.toLowerCase().split(/[\\/]/)
  const name = parts.at(-1) ?? ''
  if (/^[tj]sconfig(\..+)?\.json$/.test(name)) return true
  if (JSONC_NAMES.has(name)) return true
  // Every settings file VS Code reads from a project folder is JSONC.
  return parts.length >= 2 && parts.at(-2) === '.vscode'
}

/** Which pre-save check applies to a path, if any. */
export function checkedLanguageFor(path: string): CheckedLanguage | null {
  const language = editorLanguageFor(path)
  if (language === 'json') return isJsoncName(path) ? null : 'json'
  if (language === 'xml' || language === 'yaml') return language
  return null
}

/** The editor buffer for a file body: no leading BOM, LF line endings. */
export function toEditBuffer(content: string): string {
  const body = content.startsWith('\uFEFF') ? content.slice(1) : content
  return body.replace(/\r\n?/g, '\n')
}

/**
 * Indent unit for a buffer: a tab when the first indented line starts with
 * one, else the smallest space indent among the first indented lines (2 when
 * nothing is indented). Capped at 8 spaces.
 */
export function inferIndentUnit(text: string): string {
  let smallest = 0
  let seen = 0
  for (const match of text.matchAll(/^([ \t]+)\S/gm)) {
    const lead = match[1] ?? ''
    if (seen === 0 && lead.startsWith('\t')) return '\t'
    if (!lead.startsWith('\t')) {
      const width = lead.length
      if (smallest === 0 || width < smallest) smallest = width
    }
    if (++seen >= 200) break
  }
  return ' '.repeat(smallest === 0 ? 2 : Math.min(smallest, 8))
}

/** 1-based line and column of a UTF-16 offset. */
export function lineColumnAt(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length))
  let line = 1
  let start = 0
  for (let at = text.indexOf('\n'); at !== -1 && at < clamped; at = text.indexOf('\n', at + 1)) {
    line++
    start = at + 1
  }
  return { line, column: clamped - start + 1 }
}

/**
 * Offset of the first JSON syntax error (RFC 8259), or null when the scan
 * cannot tell (nesting too deep for the stack). Engines word `JSON.parse`
 * failures differently and V8 often names no position at all, so the location
 * comes from this scan; the engine's message is kept as the description.
 */
export function jsonErrorOffset(text: string): number | null {
  let i = 0
  const n = text.length
  const fail = (): never => { throw new JsonStop(i) }
  const ws = (): void => {
    while (i < n) {
      const c = text.charCodeAt(i)
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break
      i++
    }
  }
  const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
  const string = (): void => {
    i++
    while (i < n) {
      const c = text[i] ?? ''
      if (c === '"') { i++; return }
      if (c === '\\') {
        const e = text[i + 1] ?? ''
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail()
          i += 6
        } else if ('"\\/bfnrt'.includes(e) && e !== '') {
          i += 2
        } else {
          fail()
        }
        continue
      }
      if (c.charCodeAt(0) < 0x20) fail()
      i++
    }
    fail()
  }
  const value = (): void => {
    ws()
    const c = text[i]
    if (c === '{') {
      i++
      ws()
      if (text[i] === '}') { i++; return }
      for (;;) {
        ws()
        if (text[i] !== '"') fail()
        string()
        ws()
        if (text[i] !== ':') fail()
        i++
        value()
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === '}') { i++; return }
        fail()
      }
    }
    if (c === '[') {
      i++
      ws()
      if (text[i] === ']') { i++; return }
      for (;;) {
        value()
        ws()
        if (text[i] === ',') { i++; continue }
        if (text[i] === ']') { i++; return }
        fail()
      }
    }
    if (c === '"') { string(); return }
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) { i += word.length; return }
    }
    NUMBER.lastIndex = i
    if (NUMBER.exec(text) === null) fail()
    i = NUMBER.lastIndex
  }
  try {
    value()
    ws()
    return i < n ? i : null
  } catch (error) {
    if (error instanceof JsonStop) return error.offset
    return null
  }
}

class JsonStop {
  constructor(readonly offset: number) {}
}

/** A character for a message: quoted when visible, `U+XXXX` when it is a
 * control or format character (a BOM, a zero-width space) that would print
 * as nothing. */
function describeChar(code: number): string {
  const invisible = code < 0x20 || (code >= 0x7f && code < 0xa0) || code === 0xfeff || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e)
  return invisible ? `U+${code.toString(16).toUpperCase().padStart(4, '0')}` : JSON.stringify(String.fromCharCode(code))
}

/** `JSON.parse` check; the location comes from `jsonErrorOffset`. */
export function checkJson(text: string): SyntaxIssue | null {
  try {
    JSON.parse(text)
    return null
  } catch (error) {
    const offset = jsonErrorOffset(text)
    // The engine's own wording quotes a slice of the document and varies by
    // browser; the scan names the character it stopped at instead.
    const message = offset === null
      ? (error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error))
      : offset >= text.length ? 'unexpected end of input' : `unexpected ${describeChar(text.charCodeAt(offset))}`
    return { ...lineColumnAt(text, offset ?? text.length), message, count: 1 }
  }
}

/** XML well-formedness through the browser's own parser. */
export function checkXml(text: string, parser: { parseFromString(text: string, type: 'application/xml'): Document }): SyntaxIssue | null {
  const doc = parser.parseFromString(text, 'application/xml')
  // The parser's report lives in a namespace of its own (XHTML in Chromium,
  // Mozilla's in Firefox); a `<parsererror>` the document itself declares has
  // none and is content, not an error.
  const error = Array.from(doc.getElementsByTagName('parsererror')).find((el) => el.namespaceURI !== null && el.namespaceURI !== '')
  if (error === undefined) return null
  const message = (error.textContent ?? '').trim().replace(/\s+/g, ' ')
  // Chromium: "error on line 3 at column 5"; Firefox: "Line Number 3, Column 5".
  const match = /line (\d+) at column (\d+)/i.exec(message) ?? /Line Number (\d+), Column (\d+)/i.exec(message)
  return { line: match === null ? 0 : Number(match[1]), column: match === null ? 0 : Number(match[2]), message, count: 1 }
}
