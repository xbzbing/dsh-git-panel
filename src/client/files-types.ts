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
