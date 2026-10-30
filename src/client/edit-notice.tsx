/**
 * The edit mode's notice bar: what went wrong with a save (or the editor
 * chunk) and the ways forward from there. Pure rendering; the actions are
 * callbacks into `useFileEdit`.
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type { GitKey } from './locales.js'
import type { SyntaxIssue } from './edit-buffer.js'
import type { CopyFeedback } from './copy-feedback.js'
import { CloseIcon } from './icons.js'

type T = (key: GitKey, params?: Record<string, string | number>) => string

export type EditNotice =
  | { readonly kind: 'chunk-failed' }
  | { readonly kind: 'syntax'; readonly language: 'json' | 'xml' | 'yaml'; readonly issue: SyntaxIssue }
  | { readonly kind: 'conflict'; readonly currentSha256: string }
  | { readonly kind: 'gone' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'error'; readonly text: string }

export interface EditNoticeActions {
  readonly t: T
  readonly close: () => void
  readonly retryChunk: () => void
  readonly saveAnyway: () => void
  readonly copy: () => void
  /** Outcome of the last "copy my text", shown on that button. */
  readonly copyFeedback: CopyFeedback
  readonly reload: () => void
  readonly overwrite: (currentSha256: string) => void
}

export function renderEditNotice(notice: EditNotice | null, cb: EditNoticeActions): JSX.Element | null {
  if (notice === null) return null
  const { t } = cb
  const action = (key: string, label: string, onClick: () => void): JSX.Element =>
    h('button', { key, type: 'button', className: 'gp-btn gp-files__edit-notice-btn', onClick }, label)
  const copyLabel = t(cb.copyFeedback === 'copied' ? 'files.contentCopied' : cb.copyFeedback === 'error' ? 'files.contentCopyFailed' : 'files.editCopyDraft')
  const copyAction = action('copy', copyLabel, cb.copy)
  let text: string
  let actions: JSX.Element[] = []
  switch (notice.kind) {
    case 'chunk-failed':
      text = t('files.editorLoadFailed')
      actions = [action('retry', t('files.editRetry'), cb.retryChunk)]
      break
    case 'syntax': {
      const where = notice.issue.line > 0
        ? t('files.editSyntaxAt', { lang: notice.language.toUpperCase(), line: notice.issue.line, column: notice.issue.column })
        : t('files.editSyntax', { lang: notice.language.toUpperCase() })
      const more = notice.issue.count > 1 ? t('files.editSyntaxMore', { n: notice.issue.count }) : ''
      text = `${where}${notice.issue.message}${more}`
      actions = [action('anyway', t('files.editSaveAnyway'), cb.saveAnyway)]
      break
    }
    case 'conflict':
      text = t('files.editConflict')
      actions = [
        copyAction,
        action('reload', t('files.editReload'), cb.reload),
        action('overwrite', t('files.editOverwrite'), () => cb.overwrite(notice.currentSha256)),
      ]
      break
    case 'gone':
      text = t('files.editGone')
      actions = [copyAction]
      break
    case 'disabled':
      text = t('files.editDisabled')
      actions = [copyAction]
      break
    case 'error':
      text = t('files.editSaveFailed', { reason: notice.text })
      actions = [copyAction]
      break
  }
  return h('div', { key: 'edit-notice', className: 'gp-notice gp-files__edit-notice', role: 'alert' }, [
    h('span', { key: 'txt', className: 'gp-notice__text' }, text),
    h('span', { key: 'acts', className: 'gp-files__edit-notice-actions' }, actions),
    // The copy outcome is otherwise only on the button face.
    h('span', { key: 'live', className: 'gp-copy-live', 'aria-live': 'polite' },
      cb.copyFeedback === 'idle' ? '' : copyLabel),
    h('button', {
      key: 'close', type: 'button', className: 'gp-notice__close',
      title: t('common.close'), 'aria-label': t('common.close'), onClick: cb.close,
    }, h(CloseIcon, { size: 12 })),
  ])
}

/** The standing note over a draft whose root the browser has left: the tree
 * shows another root, the draft still saves to the file it was read from. */
export function renderDetachedNote(root: string | null, path: string, t: T): JSX.Element {
  return h('div', { key: 'edit-detached', className: 'gp-notice gp-files__edit-notice gp-files__edit-detached', role: 'status' }, [
    h('span', { key: 'txt', className: 'gp-notice__text' }, t('files.editDetached', { file: root === null ? path : `${root}/${path}` })),
  ])
}
