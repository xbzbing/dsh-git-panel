/**
 * The changes tab's diff area: the toolbar (path copy, stats, expand, in-place
 * card toggle, view mode) over the DiffView. Whether the card is up, and the
 * focus/backdrop contract that goes with it, come from `useDiffCard`; this
 * component only paints them on the card root. The card is the SAME inline
 * .gp-diff restyled — never a portal, so the DiffView cannot remount
 * (ADR-0016 / ADR-0023).
 */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type { GitPanelRemote } from './rpc.js'
import type { GitKey } from './locales.js'
import { DiffView, type DiffMode } from './DiffView.js'
import { renderDiffExpand, renderDiffModeSeg } from './diff-controls.js'
import { ArrowLeftIcon, CloseIcon, ExitFullscreenIcon, FullscreenIcon } from './icons.js'
import { pathCopyButton } from './path-copy-button.js'
import type { CopyFeedback } from './copy-feedback.js'
import { DiffCardFocus, type DiffCard } from './diff-card.js'

/** The view-mode switch, grouped so its three parts travel together. */
interface DiffModeSwitch {
  readonly options: readonly DiffMode[]
  readonly current: DiffMode
  readonly onChange: (mode: DiffMode) => void
}

/** Path-copy state and the write, as handed out by `useCopyFeedback`. */
interface PathCopyControl {
  readonly feedback: CopyFeedback
  readonly onCopy: () => void
}

interface ChangesDiffPaneProps {
  /** The open diff target, or null when no file is selected. */
  readonly diffPath: { readonly path: string; readonly base: 'worktree' | 'staged' } | null
  readonly diffData: { readonly text: string; readonly newLines: number; readonly truncated?: boolean } | null
  readonly summary: { readonly add: number; readonly del: number } | null
  readonly card: DiffCard
  readonly mode: DiffModeSwitch
  readonly copy: PathCopyControl
  readonly expanded: boolean
  readonly compact: boolean
  /** Diff queries are gated by page visibility; the DiffView follows it. */
  readonly queryVisible: boolean
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  readonly onToggleExpand: () => void
  /** Compact only: drill back from the diff to the change list. */
  readonly onBackToList: () => void
}

/** The diff area. `keys` stay on the returned nodes so React reuses them. */
export function ChangesDiffPane(props: ChangesDiffPaneProps): JSX.Element {
  const { diffPath, diffData, summary, card, mode: modeSwitch, copy, expanded, compact, queryVisible, remote, sessionId, t, onToggleExpand, onBackToList } = props
  const { visible: cardOpen, cardRef } = card
  return diffPath === null
    ? h('div', { className: 'gp-empty' }, t('changes.selectFile'))
    : h('div', {
      className: `gp-diff${cardOpen ? ' gp-diff--card' : ''}`,
      ref: cardRef,
      // In place, not portaled: the card IS the inline pane restyled, so it
      // takes the dialog contract where it sits (the reader card's pattern).
      ...(cardOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': diffPath.path } : {}),
    }, [
      // Renders null: it exists so the shared dialog hook mounts with the card
      // and unmounts with it (wrapping the diff instead would remount DiffView).
      cardOpen
        ? h(DiffCardFocus, { key: 'focus', cardRef: card.cardRef, initialRef: card.closeRef, restoreRef: card.triggerRef, onClose: card.close })
        : null,
      h('div', { key: 'tb', className: `gp-diff__toolbar${compact ? ' gp-diff__toolbar--compact' : ''}` }, (() => {
        const back = compact
          ? h('button', { key: 'back', type: 'button', className: 'gp-subhead__back', onClick: () => onBackToList() }, [h(ArrowLeftIcon, { key: 'i', size: 14 }), t('changes.backToList')])
          : null
        // The filename stays whole (the directory elides first) and doubles as
        // the copy control; shape, feedback and the phrase's placement are the
        // shared path-copy contract (see path-copy-button.tsx).
        const path = pathCopyButton({
          elementKey: 'path',
          path: diffPath.path,
          feedback: copy.feedback,
          onCopy: copy.onCopy,
          t,
          rootClass: 'gp-diff__path',
          dirClass: 'gp-diff__path-dir',
          nameClass: 'gp-diff__path-name',
        })
        const sum = summary ? h('span', { key: 'sum', className: 'gp-stats__item', style: { marginLeft: 'auto' } }, [
          h('span', { key: 'a', className: 'gp-stats__add' }, `+${summary.add}`), ' ',
          h('span', { key: 'd', className: 'gp-stats__del' }, `\u2212${summary.del}`),
        ]) : null
        // Icon-only: the text label costs the path the room, and the toggle
        // state rides the pressed tint (aria-pressed) plus the title swap.
        // Shared with the commit file-diff dialog: same glyph, same pressed
        // contract, so the two toolbars cannot drift.
        const expand = renderDiffExpand({
          mode: modeSwitch.current, modes: modeSwitch.options, onMode: modeSwitch.onChange,
          expanded, onToggleExpand: onToggleExpand, t,
        })
        // The enlarged-diff toggle — same glyphs the files preview uses for
        // its fullscreen control. The "modal" is THIS inline .gp-diff restyled
        // into a card (gp-diff--card, the reader's in-place trick), so the
        // DiffView never remounts; pressed state marks the card being up.
        const modalBtn = h('button', {
          key: 'modal', ref: card.triggerRef, type: 'button',
          className: 'gp-icon-btn gp-diff__modal-btn',
          title: t('diff.openModal'),
          'aria-label': t('diff.openModal'),
          'aria-pressed': cardOpen,
          onClick: () => card.toggle(),
        }, h(cardOpen ? ExitFullscreenIcon : FullscreenIcon, { size: 14 }))
        const cardClose = cardOpen
          ? h('button', {
            key: 'cardclose', ref: card.closeRef, type: 'button',
            className: 'gp-icon-btn gp-diff__card-close',
            title: t('common.close'), 'aria-label': t('common.close'),
            onClick: () => card.close(),
          }, h(CloseIcon, { size: 15 }))
          : null
        const seg = renderDiffModeSeg({
          mode: modeSwitch.current, modes: modeSwitch.options, onMode: modeSwitch.onChange,
          expanded, onToggleExpand: onToggleExpand, t,
        })
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
        : h(DiffView, { key: 'diff', visible: queryVisible, text: diffData.text, mode: modeSwitch.current, path: diffPath.path, remote, sessionId, base: diffPath.base, expanded, truncated: diffData.truncated === true, newLines: diffData.newLines, t }),
    ])
}
