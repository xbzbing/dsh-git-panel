/**
 * The file browser's directory tree: one level per call, expanded children
 * appended recursively from the per-directory cache.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type { GitKey } from './locales.js'
import { FileTypeIcon, IconFolderCloseRegular, IconFolderOpenRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Loaded } from './files-types.js'

export interface TreeCbs {
  dirs: ReadonlyMap<string, Loaded>
  open: ReadonlySet<string>
  selected: string | null
  toggleDir: (path: string) => void
  selectFile: (path: string) => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Recursively render the expanded tree from the per-directory cache. */
export function renderTree(dirPath: string, depth: number, cb: TreeCbs): JSX.Element[] {
  const loaded = cb.dirs.get(dirPath)
  if (loaded === undefined || loaded.status === 'loading') {
    if (depth === 0) return [h('div', { key: 'l', className: 'gp-empty' }, cb.t('common.loading'))]
    return [h('div', { key: `l${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 8 + depth * 16 } }, cb.t('common.loading'))]
  }
  if (loaded.status === 'error') {
    return [h('div', { key: `e${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 8 + depth * 16 } }, cb.t('files.loadFailed'))]
  }
  // An expanded directory that lists nothing says so, one level under the dir
  // — flipping only the folder glyph is the sole sign otherwise. The root's
  // empty listing stays blank (its loading state is already a centered pane);
  // a truncated listing always carries entries, so it never reaches here.
  if (loaded.entries.length === 0 && !loaded.truncated) {
    if (depth === 0) return []
    return [h('div', { key: `empty${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 8 + depth * 16 } }, cb.t('files.emptyDir'))]
  }
  const rows: JSX.Element[] = []
  for (const entry of loaded.entries) {
    const path = dirPath === '' ? entry.name : `${dirPath}/${entry.name}`
    if (entry.dir) {
      const isOpen = cb.open.has(path)
      rows.push(h('button', {
        key: path, type: 'button', className: `gp-tree-row gp-files__entry gp-files__entry--dir${entry.ignored ? ' gp-tree-row--ignored' : ''}`,
        style: { paddingLeft: 8 + depth * 16 }, 'aria-expanded': isOpen,
        'aria-label': entry.ignored ? `${entry.name} (${cb.t('files.ignored')})` : entry.name,
        onClick: () => cb.toggleDir(path),
      }, [
        // The official file lists mark expansion with the folder glyph itself
        // instead of a separate chevron.
        h('span', { key: 'i', className: 'gp-tree-ic' }, isOpen
          ? h(IconFolderOpenRegular, { size: 16 })
          : h(IconFolderCloseRegular, { size: 16 })),
        h('span', { key: 'n', className: 'gp-tree-name' }, entry.name),
      ]))
      if (isOpen) rows.push(...renderTree(path, depth + 1, cb))
    } else {
      const active = cb.selected === path
      rows.push(h('button', {
        key: path, type: 'button', className: `gp-tree-row gp-files__entry${active ? ' gp-tree-row--active' : ''}${entry.ignored ? ' gp-tree-row--ignored' : ''}`,
        style: { paddingLeft: 8 + depth * 16 }, 'aria-current': active ? 'true' : undefined,
        'aria-label': entry.ignored ? `${entry.name} (${cb.t('files.ignored')})` : entry.name,
        onClick: () => cb.selectFile(path),
      }, [
        h('span', { key: 'i', className: 'gp-tree-ic' }, h(FileTypeIcon, { path, size: 16 })),
        h('span', { key: 'n', className: 'gp-tree-name' }, entry.name),
      ]))
    }
  }
  if (loaded.truncated) {
    rows.push(h('div', { key: `t${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 8 + depth * 16 } }, cb.t('files.truncated')))
  }
  return rows
}

