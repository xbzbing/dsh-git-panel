/**
 * Lazy editor chunk: the only place CodeMirror and the `yaml` parser exist in
 * the shipped tree. The main client bundle loads it through
 * `require.async('./client.editor.js')` the first time the user presses
 * "edit", so the panel's steady-state download stays editor-free.
 *
 * The extension set is deliberately small (no autocomplete, auto-close or
 * folding): config and document files need highlighting, line numbers,
 * undo, search and indentation, and auto-closing fights phone IMEs. Colors
 * come from the host theme variables only (`--dsw-alias-*` for the chrome,
 * `--shiki-*` for syntax), so light and dark themes follow automatically.
 */
import { Compartment, EditorState, Prec, type Extension, type Text } from '@codemirror/state'
import {
  drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter,
  highlightSpecialChars, keymap, lineNumbers,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching, HighlightStyle, indentOnInput, indentUnit, LanguageSupport,
  StreamLanguage, syntaxHighlighting,
} from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { markdownLanguage } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { tags } from '@lezer/highlight'
import type { EditorLanguage } from './edit-buffer.js'

export { validateYaml } from './yaml-check.js'

/** What the panel passes when it mounts an editor. */
export interface EditorOptions {
  readonly doc: string
  /** The text "unmodified" is measured against (the disk version). */
  readonly baseline: string
  readonly language: EditorLanguage
  readonly indentUnit: string
  readonly wrap: boolean
  readonly readOnly: boolean
  readonly selection?: { readonly anchor: number; readonly head: number }
  readonly ariaLabel: string
  /** Called when the buffer starts or stops differing from the baseline. */
  readonly onDirty: (dirty: boolean) => void
  /** Called with the 1-based cursor line / column after each selection move. */
  readonly onCursor: (line: number, column: number) => void
  /** Ctrl/Cmd+S. */
  readonly onSave: () => void
}

/** Live handle on one mounted editor. */
export interface EditorHandle {
  getText(): string
  getSelection(): { anchor: number; head: number }
  setWrap(wrap: boolean): void
  setReadOnly(readOnly: boolean): void
  /** Replace the whole buffer (undoable) and optionally move the baseline. */
  replaceAll(text: string, baseline?: string): void
  /** Make the current text the new baseline (after a save). */
  markClean(): void
  focus(): void
  destroy(): void
}

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.tagName, tags.heading], color: 'var(--shiki-token-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.monospace, tags.quote], color: 'var(--shiki-token-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.meta, tags.processingInstruction], color: 'var(--shiki-token-comment)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal, tags.typeName], color: 'var(--shiki-token-constant)' },
  { tag: [tags.propertyName, tags.definition(tags.propertyName), tags.definition(tags.variableName), tags.labelName], color: 'var(--shiki-token-function)' },
  { tag: [tags.attributeName, tags.variableName], color: 'var(--shiki-token-parameter)' },
  { tag: [tags.punctuation, tags.bracket, tags.separator, tags.angleBracket, tags.contentSeparator], color: 'var(--shiki-token-punctuation)' },
  { tag: [tags.link, tags.url], color: 'var(--shiki-token-link)', textDecoration: 'underline' },
  { tag: tags.heading, fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.invalid, color: 'var(--dsw-alias-state-error-primary)' },
])

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--shiki-foreground, var(--dsw-alias-label-primary))',
    backgroundColor: 'var(--dsw-alias-bg-layer-1)',
    fontSize: 'inherit',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--dsw-font-mono, ui-monospace, monospace)', lineHeight: '1.55', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--dsw-alias-label-primary)', padding: '6px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--dsw-alias-label-primary)' },
  '.cm-gutters': {
    backgroundColor: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-tertiary)',
    borderRight: '1px solid var(--dsw-alias-border-l2)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 28%, transparent)',
  },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent)' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)', outline: '1px solid var(--dsw-alias-border-l2)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--dsw-alias-border-l2)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--dsw-alias-border-l2)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { font: 'inherit' },
  '.cm-textfield': {
    backgroundColor: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '4px',
  },
  '.cm-button': {
    backgroundImage: 'none', backgroundColor: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
    border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '4px',
  },
})

function languageExtension(language: EditorLanguage): Extension {
  switch (language) {
    case 'json': return json()
    case 'xml': return xml()
    // The bare language, not `markdown()`: no nested code-block languages and
    // no HTML tag completion, which would pull the HTML/CSS/JS grammars in.
    case 'markdown': return new LanguageSupport(markdownLanguage)
    case 'yaml': return yaml()
    case 'toml': return StreamLanguage.define(toml)
    case 'properties': return StreamLanguage.define(properties)
    case 'text': return []
  }
}

/** Mount an editor into `parent`. */
export function createEditor(parent: HTMLElement, options: EditorOptions): EditorHandle {
  const wrap = new Compartment()
  const readOnly = new Compartment()
  let baseline: Text = EditorState.create({ doc: options.baseline }).doc
  let dirty = false
  const report = (doc: Text): void => {
    const next = !doc.eq(baseline)
    if (next === dirty) return
    dirty = next
    options.onDirty(next)
  }
  const docLength = options.doc.length
  const selection = options.selection === undefined
    ? undefined
    : { anchor: Math.min(options.selection.anchor, docLength), head: Math.min(options.selection.head, docLength) }
  const state = EditorState.create({
    doc: options.doc,
    ...(selection === undefined ? {} : { selection }),
    extensions: [
      Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { options.onSave(); return true } }])),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      indentUnit.of(options.indentUnit),
      EditorState.tabSize.of(options.indentUnit === '\t' ? 4 : options.indentUnit.length),
      keymap.of([...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
      syntaxHighlighting(highlight),
      theme,
      languageExtension(options.language),
      wrap.of(options.wrap ? EditorView.lineWrapping : []),
      readOnly.of(EditorState.readOnly.of(options.readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': options.ariaLabel, 'aria-multiline': 'true' }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) report(update.state.doc)
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head
          const line = update.state.doc.lineAt(head)
          options.onCursor(line.number, head - line.from + 1)
        }
      }),
    ],
  })
  const view = new EditorView({ state, parent })
  report(view.state.doc)
  {
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    options.onCursor(line.number, head - line.from + 1)
  }
  return {
    getText: () => view.state.doc.toString(),
    getSelection: () => ({ anchor: view.state.selection.main.anchor, head: view.state.selection.main.head }),
    setWrap: (on) => view.dispatch({ effects: wrap.reconfigure(on ? EditorView.lineWrapping : []) }),
    setReadOnly: (on) => view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(on)) }),
    replaceAll: (text, nextBaseline) => {
      if (nextBaseline !== undefined) baseline = EditorState.create({ doc: nextBaseline }).doc
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
      report(view.state.doc)
    },
    markClean: () => {
      baseline = view.state.doc
      report(view.state.doc)
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  }
}
