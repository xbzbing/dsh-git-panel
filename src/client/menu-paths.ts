/**
 * Path joins for the browser's menu targets.
 *
 * The tree addresses entries with '/'-separated paths relative to the browse
 * root, while the platform's file actions want an absolute path. The separator
 * follows the root's own spelling: a Windows root (`C:\work`) gets backslashes,
 * a POSIX root keeps '/'. A root already ending in a separator is not doubled.
 */
import type { TreeTargetValue } from './menu-owners.js'

/** Whether a root is spelled the Windows way (drive letter or backslash). */
function windowsRoot(root: string): boolean {
  return root.includes('\\') || /^[A-Za-z]:/.test(root)
}

/**
 * Join a browse root with a relative tree path.
 * @param root - absolute root, or null while the panel has not resolved one.
 * @param relative - '/'-separated path below the root; '' for the root itself.
 * @returns the absolute path, or the relative one when no root is known.
 */
export function absPath(root: string | null, relative: string): string {
  if (root === null || root === '') return relative
  const separator = windowsRoot(root) ? '\\' : '/'
  const base = root.replace(/[/\\]+$/, '')
  const tail = relative.replace(/^(?:\.?[/\\])+/, '')
  if (tail === '') return base === '' ? separator : base
  const joined = tail.split('/').filter((part) => part !== '').join(separator)
  if (base === '') return `${separator}${joined}`
  return `${base}${separator}${joined}`
}

/** The last path segment of a '/'- or '\'-separated path. */
export function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * A download name for one side of a diff: the file's own name with the revision
 * inserted before the extension, so two panes of the same file do not collide in
 * the download folder (`logo@a1b2c3d.png`, `logo@HEAD.png`).
 * @param path - the file's path.
 * @param revision - short label of the side (short hash, `HEAD`, `staged`).
 */
export function revisionName(path: string, revision: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return `${name}@${revision}`
  return `${name.slice(0, dot)}@${revision}${name.slice(dot)}`
}

/**
 * The old side's label for an image diff, used as the download suffix. Each base
 * names a different *version* on the left, not the comparison it belongs to:
 * `worktree` compares the index, `staged` compares HEAD, `commit` compares the
 * commit's parent, `rev` compares the revision. The name says which one, so two
 * downloads of the same picture cannot pass for each other.
 * @param base - the diff base.
 * @param commit - the commit hash when `base` is `commit`.
 * @param rev - the revision when `base` is `rev`.
 * @returns the label, or undefined when the base names no old side.
 */
export function imageSideLabel(base: string | undefined, commit: string | undefined, rev: string | undefined): string | undefined {
  if (base === 'commit' && commit !== undefined) return `${commit.slice(0, 7)}^`
  if (base === 'staged') return 'HEAD'
  if (base === 'rev' && rev !== undefined) return rev.split('/').pop()
  if (base === undefined) return undefined
  return 'index'
}

/** The platform target value for a tree entry: the browser's relative path
 * resolved to an absolute one, which is what the platform's actions operate on
 * (a nested checkout or worktree would otherwise resolve against the session
 * cwd instead of the browser's root). */
export function platformPathFor(value: TreeTargetValue, browseRoot: string | null): string {
  return absPath(value.root ?? browseRoot, value.path)
}
