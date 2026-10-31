/**
 * Change-list rows and their dialogs: the per-file row (status badge, stage and
 * two-step discard buttons), the stash rows, and the stash-push dialog. Split
 * out of ChangesTab so the row contract and the tab's orchestration stay
 * separately readable.
 */
import { createElement as h, useState } from 'react'
import type { JSX } from 'react'
import type { GitChange } from './types.js'
import type { StashEntry } from './types.js'
import type { GitKey } from './locales.js'
import { StashIcon, TrashIcon } from './icons.js'
import { statusChar, statusClass } from './status.js'
import { changeKey } from './selection-keys.js'
import { renderAiHint, renderModalFooter, renderModalShell } from './ops-modals.js'
import { TipWrapper } from './tip.js'

export interface StashPushCbs {
  onClose: () => void
  onStash: (message: string) => void | Promise<void>
  error: string | null
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Portaled dialog: an optional message for the stash about to be pushed.
 * renderModalShell owns the SSR/portal guard, so this is a single component. */
export function StashPushModal({ onClose, onStash, error, t }: StashPushCbs): JSX.Element | null {
  const [message, setMessage] = useState('')
  // The write settles only when the caller closes this dialog; until then a
  // second Enter or a click on Save would push the same stash twice.
  const [saving, setSaving] = useState(false)
  const save = (): void => {
    if (saving) return
    setSaving(true)
    void onStash(message)
  }
  return renderModalShell({
    onClose, title: t('stash.title'), icon: h(StashIcon, { size: 15 }),
    portalKey: 'stash-push-modal', t,
    ...(saving ? { busy: true } : {}),
    body: [
      h('input', {
        key: 'msg', className: 'gp-input', placeholder: t('stash.messagePlaceholder'), value: message, autoFocus: true,
        onChange: (e: { target: { value: string } }) => setMessage(e.target.value),
        onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') save() },
      }),
      renderAiHint(t),
      error !== null ? h('div', { key: 'err', className: 'gp-feedback' }, error) : null,
    ],
    footer: renderModalFooter({ onClose, onConfirm: save, confirmLabel: t('stash.save'), confirmDisabled: saving, danger: false, t }),
  })
}

export interface StashRowCbs {
  busy: boolean
  onApply: () => void
  onPop: () => void
  onDrop: () => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function renderStashRow(s: StashEntry, cb: StashRowCbs): JSX.Element {
  return h('div', { key: s.index, className: 'gp-stash-row' }, [
    h('div', { key: 'info', className: 'gp-stash-row__info' }, [
      h('span', { key: 'm', className: 'gp-stash-row__msg', title: s.message }, s.message),
      h('span', { key: 'meta', className: 'gp-stash-row__meta' }, [
        s.branch !== null ? h('span', { key: 'b' }, cb.t('stash.onBranch', { branch: s.branch })) : null,
        s.relTime !== '' ? h('span', { key: 't' }, s.relTime) : null,
      ]),
    ]),
    h('div', { key: 'act', className: 'gp-stash-row__actions' }, [
      h('button', { key: 'apply', type: 'button', className: 'gp-btn gp-btn--sm', disabled: cb.busy, onClick: cb.onApply }, cb.t('stash.apply')),
      h('button', { key: 'pop', type: 'button', className: 'gp-btn gp-btn--sm', disabled: cb.busy, onClick: cb.onPop }, cb.t('stash.pop')),
      h('button', { key: 'drop', type: 'button', className: 'gp-icon-btn', disabled: cb.busy, title: cb.t('stash.drop'), onClick: cb.onDrop }, h(TrashIcon, { size: 14 })),
    ]),
  ])
}

export function byPath(a: GitChange, b: GitChange): number {
  return a.path.localeCompare(b.path)
}

export interface RowActions {
  selected: boolean
  active: boolean
  busy: boolean
  armed: boolean
  onToggle: () => void
  onOpen: () => void
  onStage: () => void
  /** Returns whether the press armed the confirmation (so the caller only
   * raises the hint when it did). */
  onDiscard: (detail: number) => boolean
  /** Hover explanation for the icon-only row buttons (see `tip.tsx`). */
  tipProps: (text: string) => Record<string, unknown>
  hideTip: () => void
  /** Raise a hint at once (no hover wait) — the arming press uses it. */
  showTipNow: (el: HTMLElement, text: string) => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function renderFileRow(c: GitChange, a: RowActions): JSX.Element {
  const name = c.path.split('/').pop() ?? c.path
  const dir = c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : ''
  return h('div', { key: changeKey(c), className: `gp-file-row${a.active ? ' gp-file-row--active' : ''}`, onClick: a.onOpen }, [
    h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: a.selected, disabled: a.busy, onClick: (e: Event) => e.stopPropagation(), onChange: a.onToggle }),
    h('span', { key: 'st', className: `gp-status-badge ${statusClass(c.status)}` }, statusChar[c.status] ?? '?'),
    h('span', { key: 'nm', className: 'gp-tree-name', title: c.path }, [name, dir ? h('span', { key: 'd', style: { color: 'var(--dsw-alias-label-tertiary)', marginLeft: 6, fontSize: 11 } }, dir) : null]),
    h('span', { key: 'act', className: 'gp-file-row__actions' }, [
      // Icon-only buttons carry their meaning in a fast hover tooltip + an
      // aria-label, never a bare glyph. Tip handlers live on a non-disabled
      // wrapper so a busy (`disabled`) row still explains itself on hover.
      h(TipWrapper, {
        key: 'stg', tipProps: a.tipProps(c.staged ? a.t('changes.unstageTip') : a.t('changes.stageTip')),
      }, h('button', {
        type: 'button', className: 'gp-icon-btn',
        'aria-label': c.staged ? a.t('changes.unstage') : a.t('changes.stage'),
        disabled: a.busy,
        onClick: (e: Event) => { e.stopPropagation(); a.hideTip(); a.onStage() },
      }, c.staged ? '\u2212' : '+')),
      // Discard is a working-tree operation (`git restore --`), so it lives on
      // the working-tree side only: an index-side row has nothing to discard
      // (and a staged delete makes the command fail outright).
      c.staged ? null : h(TipWrapper, {
        key: 'dis', tipProps: a.tipProps(a.armed ? a.t('changes.discardTipArmed') : a.t('changes.discardTip')),
      }, h('button', {
        type: 'button', className: 'gp-icon-btn',
        'aria-label': a.armed ? a.t('changes.discardConfirm') : a.t('changes.discard'),
        style: a.armed ? { color: 'var(--dsw-alias-state-error-primary)' } : {},
        disabled: a.busy,
        // The first press only arms, so it raises the confirm wording itself
        // instead of waiting for another hover; the second press executes.
        onClick: (e: Event) => {
          e.stopPropagation()
          const detail = (e as MouseEvent).detail ?? 1
          if (a.armed) a.hideTip()
          // The handler decides whether this press armed or executed; a
          // double-click's second press is ignored there.
          if (a.onDiscard(detail)) a.showTipNow(e.currentTarget as HTMLElement, a.t('changes.discardTipArmed'))
        },
      }, h('span', { 'aria-hidden': true }, h(TrashIcon, { size: 14 })))),
    ]),
  ])
}

