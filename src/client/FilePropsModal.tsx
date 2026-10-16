/**
 * File-properties dialog for the Files tab. Read-only, list layout: untitled
 * basic block (name/type/copyable paths) + "size & stats" / "timestamps"
 * groups, emphasis carried by weight and color. The footer status bar is
 * always rendered at a fixed height (so copy feedback never resizes the
 * dialog): Git state chips pinned left (tracked + working-tree states; no
 * branch row — the pill carries that context), copy feedback right. No action
 * buttons and no AI hint (nothing here writes). Everything derives from data
 * already on screen (file-content stat fields + the panel snapshot), so
 * opening never issues a request.
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { renderModalShell, type OpT } from './ops-modals.js'
import { formatBytes } from './bytes.js'
import { langLabel } from './lang-label.js'
import { absoluteDateTime, timeAgo } from './time.js'
import { isUntrackedPath, statusClass } from './status.js'
import { FileTypeIcon, languageForPath, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { imageMimeFor, type GitChange, type GitSnapshot } from './types.js'

export interface FilePropsInput {
  readonly path: string
  /** Preview variant; drives the type row and which stat rows apply. */
  readonly kind: 'text' | 'image' | 'binary' | 'tooLarge'
  readonly size?: number
  readonly mtimeMs?: number
  /** Text variant only. */
  readonly lines?: number
  /** Image variant only — the data URL already loaded for the preview. */
  readonly dataUrl?: string
  /** True when Git ignores the file (from the parent dir-listing entry). */
  readonly ignored: boolean
}

/** Human label for the type row: language / image format / binary. */
function propsTypeLabel(input: FilePropsInput, t: OpT): string {
  const ext = extOf(input.path)
  if (input.kind === 'binary') return t('files.propsTypeBinary')
  const mime = imageMimeFor(input.path)
  if ((input.kind === 'image' || input.kind === 'tooLarge') && mime !== null) {
    const fmt = mime.slice('image/'.length).toUpperCase()
    return t('files.propsTypeFmt', { label: t('files.propsTypeImage', { fmt }), ext })
  }
  const lang = languageForPath(input.path)
  // An over-cap file was never probed for text/binary, so without a name-derived
  // language the honest label is "too large to read", not "text file".
  const known = lang !== undefined && lang !== ''
  const label = known ? langLabel(lang) : input.kind === 'tooLarge' ? t('files.propsTypeUnread') : t('files.propsTypeText')
  return ext === '' ? label : t('files.propsTypeFmt', { label, ext })
}

function extOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : ''
}

interface RowSpec { readonly label: string; readonly value: JSX.Element; readonly key: string }

function row(label: string, value: JSX.Element | string, key: string): RowSpec {
  return { label, value: typeof value === 'string' ? h('span', {}, value) : value, key }
}

/** Group heading (null = no title, for the untitled basic block) + rows. */
function group(title: string | null, rows: readonly RowSpec[], key: string): JSX.Element {
  return h('div', { key, className: 'gp-props__group' }, [
    title !== null ? h('div', { key: 't', className: 'gp-props__group-title' }, title) : null,
    ...rows.map((r) => h('div', { key: r.key, className: 'gp-props__row' }, [
      h('span', { key: 'l', className: 'gp-props__label' }, r.label),
      h('span', { key: 'v', className: 'gp-props__value' }, r.value),
    ])),
  ])
}

/** A path value that copies itself on click (hover shows the affordance). */
function copyButton(text: string, hint: string, onCopy: () => void): JSX.Element {
  return h('button', {
    type: 'button', className: 'gp-props__copy',
    title: hint, 'aria-label': hint, onClick: onCopy,
  }, h('code', { className: 'gp-props__mono' }, text))
}

/** Working-tree chips for one path: staged / per-status side. Untracked is the
 * tracked-state chip's fact (first in the footer), so it is not repeated. */
function stateBadges(changes: readonly GitChange[], path: string, t: OpT): JSX.Element[] {
  const rows: JSX.Element[] = []
  const entries = changes.filter((c) => c.path === path && !c.isDirectory)
  if (entries.some((c) => c.staged)) rows.push(h('span', { key: 'staged', className: 'gp-props__badge gp-status--added' }, t('files.propsStaged')))
  for (const c of entries) {
    // Untracked is chip #1's fact; staged entries are covered by the chip above.
    if (c.staged || c.status === 'untracked') continue
    rows.push(h('span', { key: c.status, className: `gp-props__badge ${statusClass(c.status)}` }, statusText(c.status, t)))
  }
  return rows
}

function statusText(status: GitChange['status'], t: OpT): string {
  switch (status) {
    case 'added': return t('files.stAdded')
    case 'modified': return t('files.stModified')
    case 'deleted': return t('files.stDeleted')
    case 'renamed': return t('files.stRenamed')
    case 'untracked': return t('files.propsUntracked')
    case 'conflicted': return t('files.stConflicted')
    case 'typechange': return t('files.stTypechange')
  }
}

export function FilePropsModal({ input, snapshot, onClose, t }: {
  readonly input: FilePropsInput
  readonly snapshot: GitSnapshot | null
  readonly onClose: () => void
  readonly t: OpT
}): JSX.Element | null {
  // Image natural dimensions, probed once from the already-loaded data URL.
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    if (input.kind !== 'image' || input.dataUrl === undefined) return
    let alive = true
    const img = new Image()
    img.onload = () => { if (alive) setDims({ w: img.naturalWidth, h: img.naturalHeight }) }
    img.src = input.dataUrl
    return () => { alive = false }
  }, [input.kind, input.dataUrl])

  // Click-to-copy feedback for both path rows, shown in the footer status bar
  // (always rendered at a fixed height so the dialog never resizes); cleared
  // by timer or file switch.
  const [copyFeedback, setCopyFeedback] = useState<'copied' | 'error' | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => { setCopyFeedback(null) }, [input.path])
  useEffect(() => () => { if (copyTimer.current !== undefined) clearTimeout(copyTimer.current) }, [])
  const copyPath = (text: string): void => {
    // Async Clipboard path is unavailable on a remote plain-HTTP origin; the
    // platform helper falls back to execCommand there (same as the toolbar).
    void writeClipboard(text).then((ok) => {
      setCopyFeedback(ok ? 'copied' : 'error')
      if (copyTimer.current !== undefined) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopyFeedback(null), 1600)
    })
  }

  const slash = input.path.lastIndexOf('/')
  const name = slash < 0 ? input.path : input.path.slice(slash + 1)

  const basic: RowSpec[] = [
    row(t('files.propsName'), h('span', { className: 'gp-props__strong' }, name), 'name'),
    row(t('files.propsType'), propsTypeLabel(input, t), 'type'),
    row(t('files.propsRelPath'), copyButton(input.path, t('files.propsCopyHint'), () => copyPath(input.path)), 'rel'),
  ]
  if (snapshot !== null) {
    const abs = `${snapshot.root}/${input.path}`
    basic.push(row(t('files.propsAbsPath'), copyButton(abs, t('files.propsCopyHint'), () => copyPath(abs)), 'abs'))
  }

  const stats: RowSpec[] = []
  if (input.size !== undefined) {
    // Bold rounded size; the parenthetical raw byte count renders muted via a
    // separate span (one string cannot carry two colors). Sub-KiB sizes are
    // already exact, so the parenthetical would just repeat them.
    const value = input.size >= 1024
      ? h('span', {}, [
        h('span', { key: 'h', className: 'gp-props__strong' }, formatBytes(input.size)),
        h('span', { key: 'b', className: 'gp-props__sub' }, t('files.propsSizeBytes', { bytes: input.size.toLocaleString('en-US') })),
      ])
      : h('span', { className: 'gp-props__strong' }, formatBytes(input.size))
    stats.push(row(t('files.propsSize'), value, 'size'))
  }
  if (input.kind === 'text' && input.lines !== undefined) {
    stats.push(row(t('files.propsLines'), h('span', { className: 'gp-props__strong' }, String(input.lines)), 'lines'))
  }
  if (dims !== null) {
    stats.push(row(t('files.propsImageSize'), h('span', { className: 'gp-props__strong' }, t('files.propsImageSizeFmt', dims)), 'dims'))
  }

  const time: RowSpec[] = []
  if (input.mtimeMs !== undefined) {
    time.push(row(t('files.propsMtime'), h('span', { title: timeAgo(input.mtimeMs, Date.now(), t) }, absoluteDateTime(input.mtimeMs)), 'mtime'))
  }

  const body: (JSX.Element | null)[] = [
    group(null, basic, 'g-basic'),
    stats.length > 0 ? group(t('files.propsGroupStats'), stats, 'g-stats') : null,
    time.length > 0 ? group(t('files.propsGroupTime'), time, 'g-time') : null,
  ]

  // Git chips ride in the footer's left side (tracked + working-tree states);
  // the branch row is gone — the pill and overview carry that context.
  const gitChips: JSX.Element[] = []
  if (snapshot !== null) {
    gitChips.push(input.ignored
      ? h('span', { key: 'ig', className: 'gp-props__badge gp-props__badge--muted' }, t('files.ignored'))
      : isUntrackedPath(snapshot.changes, input.path)
        ? h('span', { key: 'un', className: 'gp-props__badge gp-props__badge--muted' }, t('files.propsUntracked'))
        : h('span', { key: 'tr', className: 'gp-props__badge gp-props__badge--ok' }, t('files.propsTrackedYes')))
    gitChips.push(...stateBadges(snapshot.changes, input.path, t))
  }

  // Footer status bar: always rendered (fixed height) so copy feedback never
  // changes the dialog height; aria-live announces it to screen readers.
  const statusBar = h('div', {
    key: 'status', className: 'gp-modal__footer gp-props__statusbar', 'aria-live': 'polite',
  }, [
    gitChips.length > 0 ? h('span', { key: 'chips', className: 'gp-props__footer-chips' }, gitChips) : null,
    copyFeedback !== null
      ? h('span', { key: 'fb', className: `gp-props__copied${copyFeedback === 'error' ? ' gp-props__copied--err' : ''}` },
        t(copyFeedback === 'copied' ? 'files.pathCopied' : 'files.pathCopyFailed'))
      : null,
  ])

  return renderModalShell({
    onClose,
    title: t('files.propsTitle'),
    icon: h(FileTypeIcon, { path: input.path, size: 15 }),
    body,
    footer: statusBar,
    portalKey: 'file-props',
    t,
  })
}
