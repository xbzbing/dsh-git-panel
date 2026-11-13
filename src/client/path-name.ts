/**
 * File names for labels that have room for the name only.
 *
 * Kept apart from `rtl-path.ts` (display shaping) and `repo-list.ts` (list
 * semantics): the repository switcher's workspace hint and the file browser's
 * notice both name a workspace file that the host reports by absolute path, and
 * two copies of the split rule drift the moment one of them learns about a
 * separator the other does not.
 */

/** Last path segment, POSIX or Windows. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}
