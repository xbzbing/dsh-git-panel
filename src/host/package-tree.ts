/**
 * Package-tree helpers for the file browser's Java/Kotlin layout.
 *
 * Two path conventions are recognised, nothing else: a directory chain whose
 * members are all valid package segments folds into one dotted row
 * (`com.example.demo`), and a project directory's `src` child is projected into
 * source-root rows (`src/main/java`) instead of spending two levels on the
 * Maven skeleton. Build files, language servers and manifests are not read —
 * an unusual layout simply keeps the physical tree.
 */

/** Conventional source-root tails, relative to any project directory. */
const SOURCE_ROOT_TAILS: readonly (readonly string[])[] = [
  ['src', 'main', 'java'],
  ['src', 'main', 'kotlin'],
  ['src', 'main', 'scala'],
  ['src', 'main', 'groovy'],
  ['src', 'test', 'java'],
  ['src', 'test', 'kotlin'],
  ['src', 'test', 'scala'],
  ['src', 'test', 'groovy'],
  ['src', 'androidTest', 'java'],
  ['src', 'androidTest', 'kotlin'],
]

/** Source-set directories whose children are projected out of `src`. */
export const SOURCE_SETS: readonly string[] = ['main', 'test', 'androidTest']

/** Cap on a folded package chain: a runaway generated tree must not hold the
 * listing open, and the last row is still a real directory. */
export const MAX_PACKAGE_SEGMENTS = 12
/** Cap on directory reads spent folding chains for one listing; every row
 * shares the budget, so a wide source root cannot multiply the cost. */
export const MAX_PACKAGE_READS = 32
/** Wall-clock budget for folding chains in one listing. */
export const PACKAGE_DEADLINE_MS = 120
/** Cap on projected source-root rows; past it the physical tree is shown
 * rather than silently dropping part of `src`. */
export const MAX_PROJECTED_ROOTS = 64

/**
 * The source root `rel` sits at or inside, as a repository-relative path, or
 * null when it is outside every conventional source root. The innermost match
 * wins, so a checked-in generated tree nested in another source root still
 * folds relative to its own root.
 */
export function sourceRootOf(rel: string): string | null {
  if (rel === '') return null
  const segments = rel.split('/')
  // Walk from the deepest possible start: the last matching tail is the
  // innermost source root, and a prefix that merely contains `src/main/java`
  // earlier must not win.
  for (let start = segments.length - 1; start >= 0; start--) {
    for (const tail of SOURCE_ROOT_TAILS) {
      if (start + tail.length > segments.length) continue
      let matches = true
      for (let i = 0; i < tail.length; i++) {
        if (segments[start + i] !== tail[i]) {
          matches = false
          break
        }
      }
      if (matches) return segments.slice(0, start + tail.length).join('/')
    }
  }
  return null
}

/** A package segment: letters, digits, `_` and `$` — what Java/Kotlin package
 * names are built from. Reserved words are not excluded (a directory named
 * `switch` is still a collapsible package), and a decomposed identifier with
 * combining marks is simply not folded. */
export function isPackageSegment(segment: string): boolean {
  return /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(segment)
}

/**
 * The source-root rows projected out of a directory's `src` child. `direct`
 * lists every child of `src` (all directories by contract); `setChildren`
 * carries the directory children of each source set that exists. Null means
 * "keep the physical tree": either nothing conventional is below `src`, or
 * the projection would exceed its cap.
 */
export function projectSourceRoots(
  direct: readonly string[],
  setChildren: ReadonlyMap<string, readonly string[]>,
): readonly string[] | null {
  const roots: string[] = []
  for (const name of direct) {
    const children = setChildren.get(name)
    if (children === undefined || children.length === 0) {
      // A plain `src` child, or a source set holding no directory: keep it as
      // one row so an empty directory is not erased from the tree.
      roots.push(`src/${name}`)
      continue
    }
    for (const child of children) {
      roots.push(`src/${name}/${child}`)
      if (roots.length > MAX_PROJECTED_ROOTS) return null
    }
  }
  if (roots.length > MAX_PROJECTED_ROOTS) return null
  // Hiding `src` and the source set is only worth it when at least one real
  // source root comes out; otherwise this is a lookalike layout (a JS project
  // under `src/main/...`) and the physical tree is the honest one.
  return roots.some((path) => sourceRootOf(path) === path) ? roots : null
}
