/**
 * The key test behind the split commit button's accelerator (issue #152):
 * `Ctrl`/`⌘`+`Alt`+`K` always means "commit and push", whatever the button is
 * armed with, and never changes that choice.
 *
 * Pure on purpose: the component still decides *where* the keystroke counts
 * (this tab's subtree, no overlay, not a text field other than the commit
 * message), but the chord itself is one testable rule.
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
}

export function isCommitShortcut(keys: CommitShortcutKeys): boolean {
  if (!(keys.ctrlKey || keys.metaKey) || !keys.altKey || keys.shiftKey) return false
  return keys.code === 'KeyK' || keys.key.toLowerCase() === 'k'
}
