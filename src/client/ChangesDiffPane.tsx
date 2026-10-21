/**
 * The changes tab's diff area: the toolbar (path copy, stats, expand, in-place
 * card toggle, view mode) over the DiffView. It also owns the enlarged card's
 * DOM contract — the dialog attributes on the card root, the focus lifecycle
 * and the backdrop — because they all describe this one element. The card is
 * the SAME inline .gp-diff restyled (the reader's in-place trick), never a
 * portal, so the DiffView cannot remount (ADR-0016 / ADR-0023).
 */
import { createElement as h, type RefObject } from 'react'
import type { JSX } from 'react'
import type { GitPanelRemote } from './rpc.js'
import type { GitKey } from './locales.js'
import { DiffView, type DiffMode } from './DiffView.js'
import { ArrowLeftIcon, CheckIcon, CloseIcon, ExpandAllIcon, ExitFullscreenIcon, FullscreenIcon } from './icons.js'
import { segButtons } from './seg.js'
import { useDialogFocus } from './dialog-focus.js'
import type { CopyFeedback } from './copy-feedback.js'

export interface ChangesDiffPaneProps {
  /** The open diff target, or null when no file is selected. */
  readonly diffPath: { readonly path: string; readonly base: 'worktree' | 'staged' } | null
  readonly diffData: { readonly text: string; readonly newLines: number; readonly truncated?: boolean } | null
  readonly summary: { readonly add: number; readonly del: number } | null
  /** The enlarged card is up (the toolbar's toggle reports its pressed state). */
  readonly cardOpen: boolean
  readonly expanded: boolean
  readonly modes: readonly DiffMode[]
  readonly mode: DiffMode
  readonly copyFeedback: CopyFeedback
  readonly compact: boolean
  /** Diff queries are gated by page visibility; the DiffView follows it. */
  readonly queryVisible: boolean
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  readonly onMode: (mode: DiffMode) => void
  readonly onToggleExpand: () => void
  readonly onCopyPath: () => void
  readonly onToggleCard: () => void
  readonly onCloseCard: () => void
  /** Compact only: drill back from the diff to the change list. */
  readonly onBackToList: () => void
  readonly cardRef: RefObject<HTMLDivElement | null>
  readonly triggerRef: RefObject<HTMLButtonElement | null>
  readonly closeRef: RefObject<HTMLButtonElement | null>
}

/** The diff area. `keys` stay on the returned nodes so React reuses them. */
export function ChangesDiffPane(props: ChangesDiffPaneProps): JSX.Element {
  const {
    diffPath, diffData, summary, cardOpen, expanded, modes, mode, copyFeedback,
    compact, queryVisible, remote, sessionId, t,
    onMode, onToggleExpand, onCopyPath, onToggleCard, onCloseCard, onBackToList,
    cardRef, triggerRef, closeRef,
  } = props
  return diffPath === null
    ? h('div', { className: 'gp-empty' }, t('changes.selectFile'))
    : h('div', {
      className: `gp-diff${cardOpen ? ' gp-diff--card' : ''}`,
      ref: cardRef,
      // In place, not portaled: the card IS the inline pane restyled, so it
      // takes the dialog contract where it sits (the reader card's pattern).
      ...(cardOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': diffPath.path } : {}),
    }, [
      h('div', { key: 'tb', className: `gp-diff__toolbar${compact ? ' gp-diff__toolbar--compact' : ''}` }, (() => {
        const back = compact
          ? h('button', { key: 'back', type: 'button', className: 'gp-subhead__back', onClick: () => onBackToList() }, [h(ArrowLeftIcon, { key: 'i', size: 14 }), t('changes.backToList')])
          : null
        // The filename must stay whole: the directory shrinks first, eliding
        // from its left (tail kept, right-to-left run), and the full relative
        // path rides on the native tooltip instead of the clipped text. The
        // element is a button: clicking copies that relative path. The path
        // itself NEVER swaps out for the confirmation (a bare text node wraps
        // when the toolbar squeezes the button below the phrase's width, which
        // balloons the row): on success the directory slot trades places with
        // a check mark, on failure only the color changes — dir/name keep
        // their nowrap/ellipsis either way. The phrase rides `aria-label`,
        // `title` (feedback period only) and a visually-hidden live region.
        const slash = diffPath.path.lastIndexOf('/')
        const copyState = copyFeedback
        const copyKey = copyState === 'copied' ? 'files.pathCopied' : 'files.pathCopyFailed'
        const copyText = t(copyState === 'idle' ? 'files.copyPath' : copyKey)
        const path = h('button', {
          key: 'path',
          type: 'button',
          className: `gp-diff__path${copyState === 'copied' ? ' gp-diff__path--copied' : copyState === 'error' ? ' gp-diff__path--error' : ''}`,
          title: copyState === 'idle' ? diffPath.path : `${t(copyKey)} ${diffPath.path}`,
          'aria-label': `${copyText} ${diffPath.path}`,
          onClick: () => onCopyPath(),
        }, [
          copyState === 'copied'
            ? h(CheckIcon, { key: 'ok', size: 11 })
            : slash < 0
              ? null
              : [
                h('span', { key: 'd', className: 'gp-diff__path-dir' }, diffPath.path.slice(0, slash)),
                h('span', { key: 's', className: 'gp-diff__path-sep' }, '/'),
              ],
          slash < 0
            ? diffPath.path
            : h('span', { key: 'n', className: 'gp-diff__path-name' }, diffPath.path.slice(slash + 1)),
          h('span', { key: 'live', className: 'gp-copy-live', 'aria-live': 'polite' }, copyState === 'idle' ? '' : t(copyKey)),
        ])
        const sum = summary ? h('span', { key: 'sum', className: 'gp-stats__item', style: { marginLeft: 'auto' } }, [
          h('span', { key: 'a', className: 'gp-stats__add' }, `+${summary.add}`), ' ',
          h('span', { key: 'd', className: 'gp-stats__del' }, `\u2212${summary.del}`),
        ]) : null
        // Icon-only: the text label costs the path the room, and the toggle
        // state rides the pressed tint (aria-pressed) plus the title swap.
        const expandLabel = t(expanded ? 'diff.collapse' : 'diff.expandAll')
        const expand = h('button', {
          key: 'expand', type: 'button',
          className: 'gp-icon-btn gp-diff__expand',
          style: summary || compact ? {} : { marginLeft: 'auto' },
          disabled: mode !== 'split' && mode !== 'unified',
          'aria-pressed': expanded,
          title: expandLabel,
          'aria-label': expandLabel,
          onClick: () => onToggleExpand(),
        }, h(ExpandAllIcon, { size: 14 }))
        // The enlarged-diff toggle — same glyphs the files preview uses for
        // its fullscreen control. The "modal" is THIS inline .gp-diff restyled
        // into a card (gp-diff--card, the reader's in-place trick), so the
        // DiffView never remounts; pressed state marks the card being up.
        const modalBtn = h('button', {
          key: 'modal', ref: triggerRef, type: 'button',
          className: 'gp-icon-btn gp-diff__modal-btn',
          title: t('diff.openModal'),
          'aria-label': t('diff.openModal'),
          'aria-pressed': cardOpen,
          onClick: () => onToggleCard(),
        }, h(cardOpen ? ExitFullscreenIcon : FullscreenIcon, { size: 14 }))
        const cardClose = cardOpen
          ? h('button', {
            key: 'cardclose', ref: closeRef, type: 'button',
            className: 'gp-icon-btn gp-diff__card-close',
            title: t('common.close'), 'aria-label': t('common.close'),
            onClick: () => onCloseCard(),
          }, h(CloseIcon, { size: 15 }))
          : null
        const seg = h('div', { key: 'seg', className: 'gp-seg' },
          segButtons<DiffMode>(modes, mode, onMode, (m) => t(`diff.${m}` as GitKey)))
        // One row cannot fit back + path + stats + expand + mode seg at phone
        // widths (the seg buttons squeezed into stacked wrapping); compact
        // splits the controls onto a dedicated second row instead.
        if (compact) {
          return [
            h('div', { key: 'row1', className: 'gp-diff__toolbar-row' }, [back, path, sum]),
            h('div', { key: 'row2', className: 'gp-diff__toolbar-row gp-diff__toolbar-row--controls' }, [expand, modalBtn, seg, cardClose]),
          ]
        }
        return [back, path, sum, expand, modalBtn, seg, cardClose]
      })()),
      diffData === null
        ? h('div', { key: 'scroll', className: 'gp-diff__scroll' }, h('div', { className: 'gp-empty' }, t('common.loading')))
        : h(DiffView, { key: 'diff', visible: queryVisible, text: diffData.text, mode: mode, path: diffPath.path, remote, sessionId, base: diffPath.base, expanded, truncated: diffData.truncated === true, newLines: diffData.newLines, t }),
    ])
}

/**
 * Focus lifecycle of the enlarged diff card. A component of its own so the
 * shared dialog contract only runs while the card is open — wrapping the diff
 * in a conditional component instead would remount the DiffView.
 */
export function DiffCardFocus(props: {
  cardRef: RefObject<HTMLDivElement | null>
  initialRef: RefObject<HTMLButtonElement | null>
  restoreRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
}): null {
  useDialogFocus(props.cardRef, props.onClose, props.initialRef, props.restoreRef)
  return null
}

/** Backdrop of the in-place card: a click target, hidden from assistive tech. */
export function DiffCardBackdrop(props: { onClose: () => void }): JSX.Element {
  return h('div', {
    key: 'diff-backdrop', className: 'gp-diff-backdrop', 'aria-hidden': 'true',
    onClick: (e: { target: unknown; currentTarget: unknown }) => {
      if (e.target === e.currentTarget) props.onClose()
    },
  })
}
