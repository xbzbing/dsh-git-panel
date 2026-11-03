/**
 * Change-list rows and their dialogs: the per-file row (status badge, stage and
 * two-step discard buttons), the directory row of the tree view, the group
 * header, the stash rows, and the stash-push dialog. The head/dir/file dispatch
 * the tab's virtual window mounts lives here as `renderChangeRow`, so the tab
 * only assembles the context (selection, dialogs, queries) and the row contract
 * and the orchestration stay separately readable.
 */
import { createElement as h, useState } from 'react'
import type { JSX } from 'react'
import type { GitChange } from './types.js'
import type { StashEntry } from './types.js'
import type { GitKey } from './locales.js'
import { ChevronIcon, FolderIcon, StashIcon, TrashIcon } from './icons.js'
import { statusChar, statusClass } from './status.js'
import { changeKey, groupPickState, type GroupPickState } from './selection-keys.js'
import { dirDiscardPaths, dirKey, dirStageAction, ROW_H, type ChangeGroupKey, type ChangeListRow } from './changes-tree.js'
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
  // One write at a time: a second Enter or a click on Save while the first is
  // in flight would push the same stash twice. The guard lifts when the write
  // settles — success closes this dialog anyway, a failure keeps it open with
  // the error visible and the button usable for a retry.
  const [saving, setSaving] = useState(false)
  const save = (): void => {
    if (saving) return
    setSaving(true)
    void Promise.resolve(onStash(message)).finally(() => setSaving(false))
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

export interface RowActions {
  /** Tree depth: each level indents the row, 0 in the flat list. */
  depth: number
  /** Repeat the directory after the name (flat list); the tree already shows it. */
  showDir: boolean
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

/** Indent shared by tree rows of every kind: one directory level per step. */
const INDENT = 14

/** Group header label of each list (the row model carries no display text). */
const GROUP_LABEL: Record<ChangeGroupKey, GitKey> = {
  staged: 'changes.groupStaged', unstaged: 'changes.groupUnstaged', untracked: 'changes.groupUntracked',
}

/**
 * The tab's orchestration, injected into one row render: selection, the diff
 * query, the dialogs and the hover tips all stay in ChangesTab; this file only
 * decides how a row kind presents them.
 */
export interface ChangeRowCtx {
  /** Flat list repeats the directory after the name; the tree already shows it. */
  readonly showDir: boolean
  readonly selected: ReadonlySet<string>
  /** Path / side of the row whose diff is open (both must match to read active). */
  readonly activePath: string | null
  readonly activeBase: 'staged' | 'worktree' | null
  readonly busy: boolean
  readonly armedDiscard: string | null
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  readonly tipProps: (text: string) => Record<string, unknown>
  readonly hideTip: () => void
  readonly showTipNow: (el: HTMLElement, text: string) => void
  readonly onToggleGroup: (group: ChangeGroupKey) => void
  readonly onToggleDir: (group: ChangeGroupKey, path: string) => void
  /** Group / directory select-all over its descendant changes. */
  readonly onPick: (changes: readonly GitChange[]) => void
  readonly onToggleRow: (rowKey: string) => void
  readonly onOpenRow: (path: string, base: 'staged' | 'worktree') => void
  readonly onStageRow: (change: GitChange) => void
  /** Executes or arms the two-press discard; returns whether it armed. */
  readonly onDiscardRow: (rowKey: string, detail: number) => boolean
  readonly onStageDir: (action: { readonly kind: 'stage' | 'unstage'; readonly paths: readonly string[] }) => void
  readonly onOpenDirDiscard: (group: ChangeGroupKey, path: string) => void
}

/**
 * One row of the virtualized list: the wrapper carries the window's offset and
 * the fixed height for its kind; the kind maps to its own controls.
 */
export function renderChangeRow(row: ChangeListRow, ctx: ChangeRowCtx, top: number): JSX.Element {
  const box = (key: string, inner: JSX.Element): JSX.Element =>
    h('div', { key, className: 'gp-changes__vrow', style: { top, height: ROW_H[row.kind] } }, inner)
  if (row.kind === 'head') {
    const labelKey = GROUP_LABEL[row.group]
    const pick = groupPickState(ctx.selected, row.items)
    // A group kept only for its full count (every row fell past the cap) has
    // nothing to toggle: the static modifier drops the chevron and the hand.
    const modifier = row.collapsible ? '' : ' gp-group-head--static'
    return box(`h:${row.group}`, h('div', {
      className: `gp-group-head${modifier}`,
      ...(row.collapsible ? { onClick: () => ctx.onToggleGroup(row.group) } : {}),
    }, [
      row.collapsible
        ? h(ChevronIcon, { key: 'chev', size: 12, open: !row.collapsed })
        : h('span', { key: 'chev', className: 'gp-group-head__chev-spacer' }),
      // Hidden while the group is capped past the list cap: the head count
      // comes from the full stats but only the prefix is loaded, so a
      // select-all would read as checked while covering just those rows.
      // Expanding the list restores the checkbox.
      row.items.length > 0 && !row.truncated
        ? h('span', {
          key: 'pick', className: 'gp-group-head__pick',
          onClick: (e: Event) => e.stopPropagation(),
        }, h('input', {
          type: 'checkbox', className: 'gp-check',
          checked: pick === 'all',
          // `indeterminate` is not in React's DOM property table — a JSX prop
          // would land as a content attribute, which never sets the IDL
          // property. The ref sets it directly; the inline identity is
          // load-bearing (React re-runs a callback ref only when the function
          // identity changes), so do not wrap it in useCallback.
          ref: (el: HTMLInputElement | null) => { if (el !== null) el.indeterminate = pick === 'partial' },
          disabled: ctx.busy,
          'aria-label': ctx.t('changes.selectAllGroup', { group: ctx.t(labelKey) }),
          onChange: () => ctx.onPick(row.items),
        }))
        : null,
      `${ctx.t(labelKey)} (${row.count})`,
    ]))
  }
  if (row.kind === 'dir') {
    // The directory's own controls carry what its rows would: a tri-state pick
    // over its descendants (the existing group select-all), and stage /
    // unstage / discard for the subtree.
    const stage = dirStageAction(row.group, row.changes)
    const discardPaths = dirDiscardPaths(row.changes)
    return box(`d:${dirKey(row.group, row.path)}`, renderDirRow({
      path: row.path,
      name: row.name,
      depth: row.depth,
      collapsed: row.collapsed,
      count: row.changes.length,
      pick: groupPickState(ctx.selected, row.changes),
      busy: ctx.busy,
      toggleTitle: ctx.t('changes.dirToggle'),
      selectAllLabel: ctx.t('changes.selectAllDir', { n: row.changes.length }),
      stage: stage === null ? null : {
        glyph: stage.kind === 'stage' ? '+' : '\u2212',
        label: ctx.t(stage.kind === 'stage' ? 'changes.dirStage' : 'changes.dirUnstage'),
        tip: ctx.t(stage.kind === 'stage' ? 'changes.dirStageTip' : 'changes.dirUnstageTip', { n: stage.paths.length }),
        onAct: () => ctx.onStageDir(stage),
      },
      discard: discardPaths.length === 0 ? null : {
        label: ctx.t('changes.dirDiscard'),
        tip: ctx.t('changes.dirDiscardTip', { n: discardPaths.length }),
        onAct: () => ctx.onOpenDirDiscard(row.group, row.path),
      },
      onToggle: () => ctx.onToggleDir(row.group, row.path),
      onTogglePick: () => ctx.onPick(row.changes),
      tipProps: ctx.tipProps,
      hideTip: ctx.hideTip,
    }))
  }
  // A path staged AND modified appears in two rows; key selection / active /
  // armed by path+side so acting on one row doesn't light up the other.
  const c = row.change
  const rowKey = changeKey(c)
  // The diff query names the side with its own vocabulary; spell the mapping
  // once for the row instead of twice inside the props below.
  const base = c.staged ? 'staged' : 'worktree'
  return box(rowKey, renderFileRow(c, {
    depth: row.depth,
    // The tree already places the row under its directory; repeating the
    // directory text would read as a second, wrong path.
    showDir: ctx.showDir,
    selected: ctx.selected.has(rowKey),
    active: ctx.activePath === c.path && ctx.activeBase === base,
    busy: ctx.busy,
    armed: ctx.armedDiscard === rowKey,
    onToggle: () => ctx.onToggleRow(rowKey),
    onOpen: () => ctx.onOpenRow(c.path, base),
    onStage: () => ctx.onStageRow(c),
    onDiscard: (detail: number) => ctx.onDiscardRow(rowKey, detail),
    tipProps: ctx.tipProps,
    hideTip: ctx.hideTip,
    showTipNow: ctx.showTipNow,
    t: ctx.t,
  }))
}

export function renderFileRow(c: GitChange, a: RowActions): JSX.Element {
  const name = c.path.split('/').pop() ?? c.path
  const dir = c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : ''
  // A rename names its source: the badge alone says "moved", not where from.
  const title = c.oldPath === undefined ? c.path : `${c.oldPath} → ${c.path}`
  return h('div', {
    key: changeKey(c),
    className: `gp-file-row${a.active ? ' gp-file-row--active' : ''}`,
    style: { paddingLeft: 20 + a.depth * INDENT },
    onClick: a.onOpen,
  }, [
    h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: a.selected, disabled: a.busy, onClick: (e: Event) => e.stopPropagation(), onChange: a.onToggle }),
    h('span', { key: 'st', className: `gp-status-badge ${statusClass(c.status)}` }, statusChar[c.status] ?? '?'),
    h('span', { key: 'nm', className: 'gp-tree-name', title }, [
      name,
      // The flat list repeats the directory after the name — unless a rename
      // already carries its source path, which names a directory too: one
      // "from" per row, not two.
      dir !== '' && a.showDir && c.oldPath === undefined
        ? h('span', { key: 'd', className: 'gp-file-row__aside' }, dir)
        : null,
      c.oldPath === undefined
        ? null
        : h('span', { key: 'o', className: 'gp-file-row__aside gp-file-row__from' }, `\u2190 ${c.oldPath}`),
    ]),
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

/** One directory-level control: its wording is the caller's (the side differs). */
export interface DirRowButton {
  readonly label: string
  readonly tip: string
  readonly glyph: string
  readonly onAct: () => void
}

export interface DirRowActions {
  readonly path: string
  readonly name: string
  readonly depth: number
  readonly collapsed: boolean
  /** Descendant change count, shown as a badge. */
  readonly count: number
  /** Tri-state of the directory's rows against the current selection. */
  readonly pick: GroupPickState
  readonly busy: boolean
  /** Stage / unstage of the subtree; null when it has nothing to act on. */
  readonly stage: DirRowButton | null
  /** Working-tree discard of the subtree; null on the index side. */
  readonly discard: Omit<DirRowButton, 'glyph'> | null
  readonly onToggle: () => void
  readonly onTogglePick: () => void
  readonly toggleTitle: string
  readonly selectAllLabel: string
  readonly tipProps: (text: string) => Record<string, unknown>
  readonly hideTip: () => void
}

/**
 * Directory row of the tree view: collapse control, descendant count, select-all
 * over the subtree, and the directory's own stage / discard. The fold control is
 * a real button (Enter / Space work natively, the row announces `aria-expanded`)
 * while the select-all and the actions sit beside it, so no interactive control
 * is nested inside another.
 */
export function renderDirRow(a: DirRowActions): JSX.Element {
  const stage = a.stage
  const discard = a.discard
  return h('div', {
    key: a.path,
    className: `gp-dir-row${a.collapsed ? ' gp-dir-row--collapsed' : ''}`,
    style: { paddingLeft: 10 + a.depth * INDENT },
  }, [
    h('span', { key: 'pick', className: 'gp-dir-row__pick' }, h('input', {
      type: 'checkbox', className: 'gp-check',
      checked: a.pick === 'all',
      ref: (el: HTMLInputElement | null) => { if (el !== null) el.indeterminate = a.pick === 'partial' },
      disabled: a.busy,
      'aria-label': a.selectAllLabel,
      // Like the group head's checkbox: never let a click here also land on
      // whatever the row gains as a parent click target later (fold etc.).
      onClick: (e: Event) => e.stopPropagation(),
      onChange: a.onTogglePick,
    })),
    // The fold control fills the row between the pick and the actions, so a
    // click anywhere in that stretch folds it.
    h('button', {
      key: 'toggle', type: 'button', className: 'gp-dir-row__toggle',
      title: a.toggleTitle,
      'aria-expanded': !a.collapsed,
      onClick: a.onToggle,
    }, [
      h(ChevronIcon, { key: 'chev', size: 12, open: !a.collapsed }),
      h('span', { key: 'ic', className: 'gp-dir-row__icon', 'aria-hidden': 'true' }, h(FolderIcon, { size: 13 })),
      h('span', { key: 'n', className: 'gp-dir-row__name', title: a.path }, a.name),
      h('span', { key: 'cnt', className: 'gp-dir-row__count' }, a.count),
    ]),
    h('span', { key: 'act', className: 'gp-dir-row__actions' }, [
      stage === null ? null : h(TipWrapper, { key: 'stg', tipProps: a.tipProps(stage.tip) }, h('button', {
        type: 'button', className: 'gp-icon-btn',
        'aria-label': stage.label,
        disabled: a.busy,
        onClick: () => { a.hideTip(); stage.onAct() },
      }, stage.glyph)),
      discard === null ? null : h(TipWrapper, { key: 'dis', tipProps: a.tipProps(discard.tip) }, h('button', {
        type: 'button', className: 'gp-icon-btn',
        'aria-label': discard.label,
        disabled: a.busy,
        // A subtree discard is confirmed by its dialog, not by an armed button:
        // the same two-press gesture that is fine for one file is too cheap for
        // a directory.
        onClick: () => { a.hideTip(); discard.onAct() },
      }, h('span', { 'aria-hidden': true }, h(TrashIcon, { size: 14 })))),
    ]),
  ])
}

