/**
 * The file browser's editor: a CodeMirror view mounted from the lazy editor
 * chunk. This module holds the main bundle's only reference to that chunk
 * (`require.async('./client.editor.js')`); CodeMirror itself never enters
 * lib/client.js.
 *
 * The editor owns the buffer. React only learns whether it differs from the
 * disk version (`onDirty`) and reads the text through the handle when it
 * saves, stashes or leaves, so typing never re-renders the files tab. The view
 * is created once per mount; wrap and read-only changes go through the
 * handle, so undo history survives them.
 */
import { createElement as h, memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX, MutableRefObject } from 'react'
import type { EditorHandle, EditorOptions } from './editor-chunk.js'
import type { EditorLanguage, SyntaxIssue } from './edit-buffer.js'
import { KEYS_OWNER_ATTR } from './dialog-focus.js'
import type { GitKey } from './locales.js'

/** What the editor chunk exports. */
export interface EditorChunk {
  createEditor(parent: HTMLElement, options: EditorOptions): EditorHandle
  validateYaml(text: string): SyntaxIssue | null
}

export type { EditorHandle }

// The ModuleLoader factory's injected require; the chunk is package-local.
const asyncRequire = (require as unknown as { async(spec: string): Promise<unknown> }).async

let chunkPromise: Promise<EditorChunk> | undefined
let loadedChunk: EditorChunk | null = null

/** The editor chunk once it has loaded (a remount can then mount at once). */
export function editorChunkIfLoaded(): EditorChunk | null {
  return loadedChunk
}

/** Load the editor chunk; a failure drops the memo so the next call retries. */
export function loadEditorChunk(): Promise<EditorChunk> {
  chunkPromise ??= asyncRequire('./client.editor.js').then(
    (module) => {
      loadedChunk = module as EditorChunk
      return loadedChunk
    },
    (error) => {
      chunkPromise = undefined
      throw error
    },
  )
  return chunkPromise
}

export interface FileEditorProps {
  readonly chunk: EditorChunk
  readonly path: string
  /** Initial buffer and selection, read at mount only. A getter, so a view
   * rebuilt in the same commit that destroyed its predecessor reads the text
   * that predecessor reported from `onUnmount`. */
  readonly initial: () => { readonly doc: string; readonly selection?: { readonly anchor: number; readonly head: number } }
  /** The disk version "modified" is measured against (read at mount). */
  readonly baseline: string
  readonly language: EditorLanguage
  readonly indentUnit: string
  readonly wrap: boolean
  readonly readOnly: boolean
  readonly dirty: boolean
  readonly eol: 'lf' | 'crlf'
  readonly bom: boolean
  /** Kept mounted but not shown (Markdown draft preview), so undo survives. */
  readonly hidden: boolean
  readonly handleRef: MutableRefObject<EditorHandle | null>
  /** Last text and selection, reported right before the view is destroyed. */
  readonly onUnmount: (text: string, selection: { anchor: number; head: number }) => void
  readonly onDirty: (dirty: boolean) => void
  readonly onSave: () => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

function FileEditorImpl(props: FileEditorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [cursor, setCursor] = useState<{ line: number; column: number }>({ line: 1, column: 1 })
  // Callbacks are read through a ref: the view is built once, and parents pass
  // fresh arrows on every render.
  const live = useRef(props)
  useLayoutEffect(() => { live.current = props })

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return undefined
    const initial = live.current
    const start = initial.initial()
    const handle = initial.chunk.createEditor(host, {
      doc: start.doc,
      baseline: initial.baseline,
      language: initial.language,
      indentUnit: initial.indentUnit,
      wrap: initial.wrap,
      readOnly: initial.readOnly,
      ...(start.selection !== undefined ? { selection: start.selection } : {}),
      ariaLabel: initial.t('files.editorLabel', { path: initial.path }),
      onDirty: (dirty) => live.current.onDirty(dirty),
      onCursor: (line, column) => setCursor((prev) => (prev.line === line && prev.column === column ? prev : { line, column })),
      onSave: () => live.current.onSave(),
    })
    initial.handleRef.current = handle
    handle.focus()
    return () => {
      live.current.onUnmount(handle.getText(), handle.getSelection())
      if (initial.handleRef.current === handle) initial.handleRef.current = null
      handle.destroy()
    }
    // Mount-only: the buffer belongs to the view from here on.
  }, [props.chunk])

  useEffect(() => { props.handleRef.current?.setWrap(props.wrap) }, [props.wrap, props.handleRef])
  useEffect(() => { props.handleRef.current?.setReadOnly(props.readOnly) }, [props.readOnly, props.handleRef])

  const { t } = props
  const facts = [
    props.dirty ? t('files.editModified') : null,
    props.eol === 'crlf' ? 'CRLF' : 'LF',
    props.bom ? 'UTF-8 BOM' : 'UTF-8',
    t('files.editCursor', { line: cursor.line, column: cursor.column }),
  ].filter((part): part is string => part !== null)
  return h('div', {
    className: 'gp-files__editor',
    [KEYS_OWNER_ATTR]: '',
    ...(props.hidden ? { style: { display: 'none' } } : {}),
  }, [
    h('div', { key: 'cm', ref: hostRef, className: 'gp-files__editor-host' }),
    h('div', { key: 'status', className: 'gp-files__editor-status' }, [
      h('span', { key: 'facts', className: 'gp-files__editor-facts' }, facts.join(' · ')),
      h('span', { key: 'hint', className: 'gp-files__editor-hint' }, t('files.editTabHint')),
    ]),
  ])
}

export const FileEditor = memo(FileEditorImpl)
