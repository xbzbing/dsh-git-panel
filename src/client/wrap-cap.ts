/**
 * Whether a source view may lay its lines out as flowing paragraphs instead of
 * the fixed-height grid. Above either cap the flow layout's cost explodes:
 * every line mounts, and a short file of 5000-char lines reaches tens of MB of
 * layout work under the 10 MB text read cap, stalling first paint. Line count
 * alone is not enough of a guard, hence two caps.
 */

/** Rows above which wrapping is refused (flow layout mounts every line). */
export const MAX_WRAP_LINES = 2000
/** Bytes above which wrapping is refused (same reason, sized by content). */
export const MAX_WRAP_BYTES = 1024 * 1024

export function wrapCapOk(content: string, lines: number): boolean {
  return lines <= MAX_WRAP_LINES && content.length <= MAX_WRAP_BYTES
}
