/**
 * Files tab: a lazy directory tree of the working tree on the left, a preview
 * of the selected file on the right. Directories fetch their children on
 * expand (dir-list); files fetch content on select (file-content). Code/text
 * uses the platform's lazy syntax highlighter; images render inline, other
 * binaries show a placeholder. Left column width is drag-resizable.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitPanelRemote } from './rpc'
import { queryAs } from './rpc'
import type { DirEntry } from './types'
import type { GitKey } from './locales'
import { ChevronIcon, FileIcon, FolderIcon } from './icons'
import { useResizableColumn } from './resizable'
import { languageForPath, MarkdownText, useCodeHighlighter, type HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'

interface FilesTabProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type Loaded = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly entries: readonly DirEntry[]; readonly truncated: boolean }

function isMarkdownPath(path: string): boolean { return /\.(?:md|markdown)$/i.test(path) }

type FileState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly path: string }
  | { readonly kind: 'text'; readonly path: string; readonly content: string; readonly lines: number }
  | { readonly kind: 'image'; readonly path: string; readonly dataUrl: string }
  | { readonly kind: 'binary'; readonly path: string }
  | { readonly kind: 'tooLarge'; readonly path: string }
  | { readonly kind: 'error'; readonly path: string }

export function FilesTab({ remote, sessionId, t }: FilesTabProps): JSX.Element {
  // Per-directory listing cache + expansion set, both keyed by relative path
  // ('' = root). The tree renders from these; expanding a dir fetches it once.
  const [dirs, setDirs] = useState<ReadonlyMap<string, Loaded>>(new Map())
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(['']))
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<FileState>({ kind: 'idle' })
  const [renderMarkdown, setRenderMarkdown] = useState(false)
  const markdownLabels = useMemo(() => ({ code: { copyLabel: t('files.copy'), copiedLabel: t('files.copied') }, footnotes: t('files.footnotes') }), [t])
  const fileSeq = useRef(0)

  const leftCol = useResizableColumn({ storageKey: 'gp.files.left', initial: 300, min: 180, reserve: 220, edge: 'end' })

  const loadDir = useCallback((path: string) => {
    setDirs((prev) => {
      const cur = prev.get(path)
      if (cur !== undefined && cur.status !== 'error') return prev
      const next = new Map(prev)
      next.set(path, { status: 'loading' })
      return next
    })
    void remote.query({ sessionId, query: { kind: 'dir-list', path } }).then((res) => {
      const dl = queryAs(res, 'dir-list')
      setDirs((prev) => {
        const next = new Map(prev)
        next.set(path, dl === null ? { status: 'error' } : { status: 'ready', entries: dl.entries, truncated: dl.truncated })
        return next
      })
    }).catch(() => {
      setDirs((prev) => { const next = new Map(prev); next.set(path, { status: 'error' }); return next })
    })
  }, [remote, sessionId])

  // Load the root once on mount / when the session changes.
  useEffect(() => { loadDir('') }, [loadDir])

  const toggleDir = useCallback((path: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(path)) { next.delete(path); return next }
      next.add(path)
      if (dirs.get(path) === undefined) loadDir(path)
      return next
    })
  }, [dirs, loadDir])

  const selectFile = useCallback((path: string) => {
    setSelected(path)
    setRenderMarkdown(false)
    const seq = ++fileSeq.current
    setFile({ kind: 'loading', path })
    void remote.query({ sessionId, query: { kind: 'file-content', path } }).then((res) => {
      if (seq !== fileSeq.current) return
      const fc = queryAs(res, 'file-content')
      if (fc === null) { setFile({ kind: 'error', path }); return }
      if (fc.tooLarge === true) { setFile({ kind: 'tooLarge', path }); return }
      if (fc.variant === 'image' && fc.dataUrl !== undefined) { setFile({ kind: 'image', path, dataUrl: fc.dataUrl }); return }
      if (fc.variant === 'text') { setFile({ kind: 'text', path, content: fc.content ?? '', lines: fc.lines ?? 0 }); return }
      setFile({ kind: 'binary', path })
    }).catch(() => { if (seq === fileSeq.current) setFile({ kind: 'error', path }) })
  }, [remote, sessionId])

  const treeRows = useMemo(() => renderTree('', 0, { dirs, open, selected, toggleDir, selectFile, t }), [dirs, open, selected, toggleDir, selectFile, t])

  return h('div', { className: 'gp-files' }, [
    h('div', { key: 'left', className: 'gp-files__tree', style: { flex: `0 0 ${leftCol.width}px` } }, treeRows),
    leftCol.divider,
    h('div', { key: 'right', className: 'gp-files__preview' }, [
      file.kind === 'text' && isMarkdownPath(file.path)
        ? h('div', { key: 'mode', className: 'gp-files__mode', role: 'group', 'aria-label': t('files.previewMode') }, [
          h('button', { key: 'source', type: 'button', className: `gp-files__mode-btn${!renderMarkdown ? ' gp-files__mode-btn--active' : ''}`, 'aria-pressed': !renderMarkdown, onClick: () => setRenderMarkdown(false) }, t('files.source')),
          h('button', { key: 'render', type: 'button', className: `gp-files__mode-btn${renderMarkdown ? ' gp-files__mode-btn--active' : ''}`, 'aria-pressed': renderMarkdown, onClick: () => setRenderMarkdown(true) }, t('files.render')),
        ])
        : null,
      h('div', { key: 'content', className: 'gp-files__preview-content' }, file.kind === 'text' && renderMarkdown && isMarkdownPath(file.path)
        ? h('div', { className: 'gp-files__markdown' }, h(MarkdownText, { text: file.content, labels: markdownLabels, variant: 'body' }))
        : renderPreview(file, t)),
    ]),
  ])
}

interface TreeCbs {
  dirs: ReadonlyMap<string, Loaded>
  open: ReadonlySet<string>
  selected: string | null
  toggleDir: (path: string) => void
  selectFile: (path: string) => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Recursively render the expanded tree from the per-directory cache. */
function renderTree(dirPath: string, depth: number, cb: TreeCbs): JSX.Element[] {
  const loaded = cb.dirs.get(dirPath)
  if (loaded === undefined || loaded.status === 'loading') {
    if (depth === 0) return [h('div', { key: 'l', className: 'gp-empty' }, cb.t('common.loading'))]
    return [h('div', { key: `l${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 10 + depth * 14 } }, cb.t('common.loading'))]
  }
  if (loaded.status === 'error') {
    return [h('div', { key: `e${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 10 + depth * 14 } }, cb.t('files.loadFailed'))]
  }
  const rows: JSX.Element[] = []
  for (const entry of loaded.entries) {
    const path = dirPath === '' ? entry.name : `${dirPath}/${entry.name}`
    if (entry.dir) {
      const isOpen = cb.open.has(path)
      rows.push(h('div', {
        key: path, className: 'gp-tree-row', style: { paddingLeft: 10 + depth * 14 },
        onClick: () => cb.toggleDir(path),
      }, [
        h('span', { key: 'c', className: 'gp-tree-chev' }, h(ChevronIcon, { size: 11, open: isOpen })),
        h('span', { key: 'i', className: 'gp-tree-ic' }, h(FolderIcon, { size: 13, open: isOpen })),
        h('span', { key: 'n', className: 'gp-tree-name' }, entry.name),
      ]))
      if (isOpen) rows.push(...renderTree(path, depth + 1, cb))
    } else {
      const active = cb.selected === path
      rows.push(h('div', {
        key: path, className: `gp-tree-row${active ? ' gp-tree-row--active' : ''}`, style: { paddingLeft: 10 + depth * 14 },
        onClick: () => cb.selectFile(path),
      }, [
        h('span', { key: 'c', className: 'gp-tree-chev' }),
        h('span', { key: 'i', className: 'gp-tree-ic' }, h(FileIcon, { size: 13 })),
        h('span', { key: 'n', className: 'gp-tree-name' }, entry.name),
      ]))
    }
  }
  if (loaded.truncated) {
    rows.push(h('div', { key: `t${dirPath}`, className: 'gp-tree-row gp-tree-row--muted', style: { paddingLeft: 10 + depth * 14 } }, cb.t('files.truncated')))
  }
  return rows
}

function renderPreview(file: FileState, t: (key: GitKey, params?: Record<string, string | number>) => string): JSX.Element {
  switch (file.kind) {
    case 'idle': return h('div', { className: 'gp-empty' }, t('files.selectFile'))
    case 'loading': return h('div', { className: 'gp-empty' }, t('common.loading'))
    case 'error': return h('div', { className: 'gp-empty' }, t('files.loadFailed'))
    case 'tooLarge': return h('div', { className: 'gp-empty' }, t('files.tooLarge'))
    case 'binary': return h('div', { className: 'gp-empty' }, t('files.binary'))
    case 'image':
      return h('div', { className: 'gp-files__image' }, h('img', { src: file.dataUrl, alt: file.path }))
    case 'text':
      return h('div', { className: 'gp-files__code gp-diff__scroll' }, h(CodePreview, { content: file.content, path: file.path }))
  }
}

/** Read-only numbered code view with lazy syntax highlighting. */
function CodePreview({ content, path }: { content: string; path: string }): JSX.Element {
  const lang = languageForPath(path)
  const highlight = useCodeHighlighter(lang)
  const lines = useMemo(() => {
    const arr = content.split('\n')
    if (arr.length > 0 && arr[arr.length - 1] === '') arr.pop()
    return arr
  }, [content])
  const highlighted = useMemo(() => highlight(lines.join('\n')), [highlight, lines])
  return h('div', { className: 'gp-files__single' }, lines.flatMap((line, i) => [
    h('div', { key: `n${i}`, className: 'gp-diff-no' }, i + 1),
    h('div', { key: `c${i}`, className: 'gp-diff-cell' }, line === '' ? '\u00a0' : highlighted?.[i] !== undefined
      ? highlighted[i].map((span: HighlightSpan, j: number) => h('span', { key: j, style: span.style }, span.text))
      : line),
  ]))
}
