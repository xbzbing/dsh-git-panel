/**
 * What counts as the split commit button's accelerator (issue #152), and which
 * focused element keeps the keystroke for itself.
 *
 * `Ctrl`/`⌘`+`Alt`+`K` always means "commit and push", whatever the button is
 * armed with. Three things must never produce a write:
 *
 * - a held key: the auto-repeat keydown would fire again after the chain lands,
 *   by which time the message box is empty, so the user would see "the message
 *   is empty" right after a successful commit;
 * - AltGr, which Windows reports as Ctrl+Alt: on a layout where AltGr+K types a
 *   character (Latvian ķ), typing it in the commit box would commit;
 * - an element that takes typed text (the diff's review box, a search field).
 *   The commit message is the one field the accelerator is meant for, so the
 *   caller exempts it by class before asking here.
 *
 * Pure on purpose: the component still decides where the keystroke counts (this
 * tab's subtree, no overlay), but the chord and the field rule are testable.
 */
export interface CommitShortcutKeys {
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  /** `KeyboardEvent.code`: layout-independent, and the only reliable fact on
   * macOS where Option+K types "˚" instead of "k". */
  readonly code: string
  readonly key: string
  /** A key held down by the OS auto-repeat. */
  readonly repeat?: boolean
  /** `getModifierState('AltGraph')`: AltGr arrives as Ctrl+Alt on Windows. */
  readonly altGraph?: boolean
}

export function isCommitShortcut(keys: CommitShortcutKeys): boolean {
  if (keys.repeat === true) return false
  if (keys.altGraph === true) return false
  if (!(keys.ctrlKey || keys.metaKey) || !keys.altKey || keys.shiftKey) return false
  return keys.code === 'KeyK' || keys.key.toLowerCase() === 'k'
}

/**
 * Input types that take typed text. Everything else — checkbox, radio, button,
 * submit, reset, file, range, color, image, hidden — receives the click keys but
 * not characters, so the accelerator must still work while it has focus. That
 * includes the Amend checkbox: after clicking it the focus stays on the
 * checkbox, and the accelerator must still work there while the main button is
 * armed and enabled.
 */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text', 'search', 'url', 'tel', 'email', 'password', 'number',
  'date', 'datetime-local', 'month', 'week', 'time',
])

export function isTextInputType(type: string | null | undefined): boolean {
  // An INPUT without a type attribute is a text field.
  const normalized = type === null || type === undefined || type === '' ? 'text' : type.toLowerCase()
  return TEXT_INPUT_TYPES.has(normalized)
}

/** Whether the focused element owns the keystroke because typing into it
 * produces text. Reads only what a DOM element exposes, so the rule is testable
 * without a document. */
export function ownsTypedText(el: Element): boolean {
  if (el.closest('[contenteditable]:not([contenteditable="false"])') !== null) return true
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') return isTextInputType(el.getAttribute('type'))
  return false
}
