/**
 * The commit file-diff dialog: a portaled card around the same DiffView the
 * changes pane renders inline, with the shared toolbar controls both surfaces
 * draw from (`diff-controls.tsx`: `renderDiffExpand` + `renderDiffModes`).
 */
import { createElement as h } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import type { GitDiffPayload } from './types.js'
import type { GitKey } from './locales.js'
import { CheckIcon, CloseIcon, CopyIcon, FileIcon } from './icons.js'
import { DiffView, diffSummary, type DiffMode } from './DiffView.js'
import { isBinaryDiff } from './diff.js'
import { OVERLAY_ATTR } from './dialog-focus.js'
import { pathCopyButton } from './path-copy-button.js'
import type { CopyFeedback } from './copy-feedback.js'
import type { GitPanelRemote } from './rpc.js'
import { renderDiffExpand, renderDiffModes } from './diff-controls.js'
import { CodePreview } from './files-preview.js'
import type { FileVersionState } from './file-version.js'

/** The read-only file view and the copy action share one version read. Both
 * surfaces above (the commit overlay and the revision comparison) hand this
 * bundle down; `undefined` keeps the dialog diff-only. */
export interface FileVersionModal {
  readonly view: 'diff' | 'file'
  readonly onView: (view: 'diff' | 'file') => void
  readonly state: FileVersionState
  readonly copyBusy: boolean
  readonly copyFeedback: CopyFeedback
  readonly copyFailure: GitKey | null
  readonly onCopy: () => void
}

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
  /** Read-only file view + copy. Absent keeps the dialog diff-only. */
  version?: FileVersionModal
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Centered dialog showing a commit's file diff. Portaled to document.body so
 * it floats above the whole panel; Esc / backdrop click / the close button
 * dismiss it (Esc is wired by the caller). */
/** What a file-diff overlay compares: a commit against its first parent, or a
 * revision against the work tree (the "compare with" flow). */
export type FileDiffTarget =
  | { readonly path: string; readonly hash: string; readonly shortHash: string }
  | { readonly path: string; readonly rev: string; readonly label: string }

export function renderFileDiffModal(
  fileDiff: FileDiffTarget | null,
  cb: FileDiffModalCbs,
): JSX.Element | null {
  if (fileDiff === null || typeof document === 'undefined') return null
  const commitSide = 'hash' in fileDiff
  const { visible, data, error, mode, onMode, expanded, onExpand, onClose, pathFeedback, onCopyPath, remote, sessionId, compact, version, t } = cb
  const view = version?.view ?? 'diff'
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
  const modesEl = renderDiffModes(controls)
  const closeEl = h('button', { key: 'close', type: 'button', className: 'gp-icon-btn gp-modal__close', title: t('common.close'), onClick: onClose }, h(CloseIcon, { size: 15 }))
  // A text diff has something to read/copy; a binary/image diff does not. A
  // version the host reported unavailable keeps the control visible (its title
  // names the reason) instead of making the button vanish mid-click.
  const copyable = data !== null && data.text !== '' && !isBinaryDiff(data.text)
  const versionIssue: GitKey | null = version === undefined
    ? null
    : version.copyFailure ?? (version.state.kind === 'tooLarge'
      ? 'diff.versionTooLarge'
      : version.state.kind === 'binary'
        ? 'diff.versionBinary'
        : version.state.kind === 'absent' ? 'diff.versionAbsent' : null)
  const copyLabel = versionIssue !== null
    ? t(versionIssue)
    : version !== undefined && version.copyFeedback === 'copied'
      ? t('diff.copyAfterDone')
      : t('diff.copyAfter')
  const copyEl = version === undefined || !copyable
    ? null
    : h('button', {
      key: 'copy', type: 'button',
      className: `gp-icon-btn gp-modal__copy${version.copyFeedback === 'copied' ? ' gp-modal__copy--copied' : ''}${version.copyFeedback === 'error' || versionIssue !== null ? ' gp-modal__copy--error' : ''}`,
      title: copyLabel,
      'aria-label': copyLabel,
      'aria-busy': version.copyBusy,
      disabled: version.copyBusy || versionIssue !== null,
      onClick: version.onCopy,
    }, [
      version.copyFeedback === 'copied' ? h(CheckIcon, { key: 'ok', size: 14 }) : h(CopyIcon, { key: 'i', size: 14 }),
      h('span', { key: 'live', className: 'gp-copy-live', 'aria-live': 'polite' },
        versionIssue !== null
          ? t(versionIssue)
          : version.copyFeedback === 'copied'
            ? t('diff.copyAfterDone')
            : version.copyFeedback === 'error' ? t('files.contentCopyFailed') : ''),
    ])
  const viewEl = version === undefined
    ? null
    : h('button', {
      key: 'view', type: 'button',
      className: `gp-icon-btn gp-modal__view${view === 'file' ? ' gp-modal__view--file' : ''}`,
      'aria-pressed': view === 'file',
      title: t(view === 'file' ? 'diff.backToDiff' : 'diff.fileView'),
      'aria-label': t(view === 'file' ? 'diff.backToDiff' : 'diff.fileView'),
      onClick: () => version.onView(view === 'file' ? 'diff' : 'file'),
    }, h(FileIcon, { size: 14 }))
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
    h('span', { key: 'hash', className: 'gp-modal__hash' }, commitSide ? fileDiff.shortHash : fileDiff.label),
    sumEl,
  ]
  // Compact mirrors the changes-pane toolbar: one row cannot fit header +
  // controls + close at phone widths, so the controls and a bordered close
  // button move to a dedicated second row (close at its far right).
  const barControls = [
    viewEl,
    copyEl,
    view === 'diff' ? expandEl : null,
    view === 'diff' ? modesEl : null,
    closeEl,
  ]
  const barChildren = compact
    ? [
      h('div', { key: 'brow1', className: 'gp-modal__bar-row' }, barHead),
      h('div', { key: 'brow2', className: 'gp-modal__bar-row gp-modal__bar-row--controls' }, barControls),
    ]
    : [...barHead, ...barControls]
  const versionBody = ((): JSX.Element | null => {
    if (version === undefined) return null
    const state = version.state
    if (state.kind === 'idle' || state.kind === 'loading') return h('div', { className: 'gp-empty' }, t('common.loading'))
    if (state.kind === 'ready') {
      return h('div', { key: 'file', className: 'gp-modal__file' },
        h(CodePreview, { content: state.content, path: fileDiff.path, wrap: true, t }))
    }
    if (state.kind === 'tooLarge') return h('div', { className: 'gp-empty' }, t('diff.versionTooLarge'))
    if (state.kind === 'binary') return h('div', { className: 'gp-empty' }, t('diff.versionBinary'))
    if (state.kind === 'absent') return h('div', { className: 'gp-empty' }, t('diff.versionAbsent'))
    return h('div', { className: 'gp-empty' }, t('files.loadFailed'))
  })()
  const body = view === 'file'
    ? versionBody
    : data === null
      ? h('div', { className: 'gp-empty' }, error ? t('overview.diffFailed') : t('common.loading'))
      : h(DiffView, {
        key: 'diff', visible, text: data.text, mode: effMode, path: fileDiff.path, remote, sessionId,
        expanded, truncated: data.truncated === true, newLines: data.newLines, t,
        ...(commitSide ? { base: 'commit' as const, commit: fileDiff.hash } : { base: 'rev' as const, rev: fileDiff.rev }),
      })
  const modal = h('div', {
    className: 'gp-modal-backdrop',
    // Declares this dialog as an overlay above the page, so the branch drawer's
    // Escape handler yields the keystroke instead of closing both layers.
    [OVERLAY_ATTR]: '',
    onClick: (e: { target: unknown; currentTarget: unknown }) => { if (e.target === e.currentTarget) onClose() },
  }, h('div', { className: 'gp-modal', role: 'dialog', 'aria-modal': true }, [
    h('div', { key: 'bar', className: 'gp-modal__bar' }, barChildren),
    h('div', { key: 'scroll', className: `gp-modal__scroll${view === 'file' ? ' gp-modal__scroll--file' : ''}` }, body),
  ]))
  return createPortal(modal, document.body, 'file-diff-modal')
}


