/**
 * The commit file-diff dialog: a portaled card around the same DiffView the
 * changes pane renders inline, with the toolbar both surfaces share
 * (`diffToolbarControls`).
 */
import { createElement as h } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import type { GitDiffPayload } from './types.js'
import type { GitKey } from './locales.js'
import { CloseIcon, FileIcon } from './icons.js'
import { DiffView, diffSummary, type DiffMode } from './DiffView.js'
import { OVERLAY_ATTR } from './dialog-focus.js'
import { pathCopyButton } from './path-copy-button.js'
import type { CopyFeedback } from './copy-feedback.js'
import type { GitPanelRemote } from './rpc.js'
import { renderDiffExpand, renderDiffModeSeg } from './diff-controls.js'

export interface FileDiffModalCbs {
  visible: boolean
  /** Diff text + new-side line count from the same query (null while loading). */
  data: GitDiffPayload | null
  error: boolean
  mode: DiffMode
  onMode: (mode: DiffMode) => void
  expanded: boolean
  onExpand: (expand: boolean) => void
  onClose: () => void
  /** Click-to-copy state of the header path: idle until the user copies. */
  pathFeedback: CopyFeedback
  /** Writes the open diff's relative path (`copy()` defaults to it). */
  onCopyPath: () => void
  remote: GitPanelRemote
  sessionId: string
  compact: boolean
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Centered dialog showing a commit's file diff. Portaled to document.body so
 * it floats above the whole panel; Esc / backdrop click / the close button
 * dismiss it (Esc is wired by the caller). */
export function renderFileDiffModal(
  fileDiff: { path: string; hash: string; shortHash: string } | null,
  cb: FileDiffModalCbs,
): JSX.Element | null {
  if (fileDiff === null || typeof document === 'undefined') return null
  const { visible, data, error, mode, onMode, expanded, onExpand, onClose, pathFeedback, onCopyPath, remote, sessionId, compact, t } = cb
  // Compact drops the side-by-side mode (no room on a phone) and renders split
  // as unified instead; the preference itself is left untouched.
  const modes: DiffMode[] = compact ? ['unified', 'before', 'after'] : ['unified', 'split', 'before', 'after']
  const effMode: DiffMode = compact && mode === 'split' ? 'unified' : mode
  const sumEl = data !== null && data.text !== '' ? (() => { const s = diffSummary(data.text); return h('span', { key: 'sum', className: 'gp-modal__sum' }, [h('span', { key: 'a', className: 'gp-stats__add' }, `+${s.add}`), h('span', { key: 'd', className: 'gp-stats__del' }, `\u2212${s.del}`)]) })() : null
  // Icon-only, matching the changes pane's toolbar (shared controls).
  const controls = {
    mode: effMode, modes, onMode, expanded, onToggleExpand: () => onExpand(!expanded), t,
  }
  const expandEl = renderDiffExpand(controls)
  const segEl = renderDiffModeSeg(controls)
  const closeEl = h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-modal__close', title: t('common.close'), onClick: onClose }, h(CloseIcon, { size: 15 }))
  // The header path doubles as its copy control, in the same shape as the
  // changes pane's and the files toolbar's (path-copy-button.tsx). `--copy`
  // carries the button affordance because the bare `.gp-modal__path` class is
  // shared with plain titles.
  const pathEl = pathCopyButton({
    elementKey: 'path',
    path: fileDiff.path,
    feedback: pathFeedback,
    onCopy: onCopyPath,
    t,
    rootClass: 'gp-modal__path',
    extraClass: 'gp-modal__path--copy',
    dirClass: 'gp-modal__dir',
    nameClass: 'gp-modal__name',
    checkSize: 12,
    separator: 'attached',
  })
  const barHead = [
    h('span', { key: 'fileicon', className: 'gp-modal__fileicon' }, h(FileIcon, { size: 15 })),
    pathEl,
    h('span', { key: 'hash', className: 'gp-modal__hash' }, fileDiff.shortHash),
    sumEl,
    expandEl,
  ]
  // Compact mirrors the changes-pane toolbar: one row cannot fit header +
  // mode seg + close at phone widths, so the seg and a bordered close button
  // move to a dedicated second row (close at its far right).
  const barChildren = compact
    ? [
      h('div', { key: 'brow1', className: 'gp-modal__bar-row' }, barHead),
      h('div', { key: 'brow2', className: 'gp-modal__bar-row gp-modal__bar-row--controls' }, [segEl, closeEl]),
    ]
    : [...barHead, segEl, closeEl]
  const modal = h('div', {
    className: 'gp-modal-backdrop',
    // Declares this dialog as an overlay above the page, so the branch drawer's
    // Escape handler yields the keystroke instead of closing both layers.
    [OVERLAY_ATTR]: '',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) onClose() },
  }, h('div', { className: 'gp-modal', role: 'dialog', 'aria-modal': true }, [
    h('div', { key: 'bar', className: 'gp-modal__bar' }, barChildren),
    h('div', { key: 'scroll', className: 'gp-modal__scroll' },
      data === null
        ? h('div', { className: 'gp-empty' }, error ? t('overview.diffFailed') : t('common.loading'))
        : h(DiffView, { key: 'diff', visible, text: data.text, mode: effMode, path: fileDiff.path, remote, sessionId, base: 'commit', commit: fileDiff.hash, expanded, truncated: data.truncated === true, newLines: data.newLines, t })),
  ]))
  return createPortal(modal, document.body, 'file-diff-modal')
}


