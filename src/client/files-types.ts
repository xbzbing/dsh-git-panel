/**
 * Shared shape of the file-browser cache: one directory entry per path, in one
 * of three states. Kept out of FilesTab so the tree renderer can import the type
 * without pulling in the page component.
 */
import type { DirEntry } from './types.js'

export type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly entries: readonly DirEntry[]; readonly truncated: boolean }

/**
 * Whether the directory listing that contains `path` marked it .gitignore'd.
 * The preview bar and the tree both need the flag for the same file: the tree
 * reads it off the entry it renders, the preview only knows the selected path.
 * @param dirs - the browser's per-directory cache.
 * @param path - repository-relative path, '/' separated.
 */
export function entryIgnored(dirs: ReadonlyMap<string, Loaded>, path: string): boolean {
  const cut = path.lastIndexOf('/')
  const dirPath = cut === -1 ? '' : path.slice(0, cut)
  const name = cut === -1 ? path : path.slice(cut + 1)
  const loaded = dirs.get(dirPath)
  if (loaded === undefined || loaded.status !== 'ready') return false
  return loaded.entries.some((entry) => entry.name === name && entry.ignored === true)
}
