/**
 * Changes tab: stats bar + uncommitted change list (checkboxes) + commit box
 * (with Amend) on the left; the selected file's diff on the right.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { queryAs, type GitPanelRemote } from './rpc.js'
import { useChangesData } from './changes-hooks.js'
import { useCopyFeedback } from './copy-feedback.js'
import { pageVisibility } from './visibility.js'
import { useGitQuerySignal } from './registry.js'
import type { GitAction, GitChange, GitErrorCode, GitSnapshot, StashEntry } from './types.js'
import type { GitKey } from './locales.js'
import { ChangeStats } from './ChangeStats.js'
import { canPublish } from './push-policy.js'
import { diffSummary, type DiffMode } from './DiffView.js'
import { ChevronIcon, CloseIcon, SparkleIcon, StashIcon, TrashIcon, UploadIcon } from './icons.js'
import { statusChar, statusClass } from './status.js'
import { useResizableColumn, useStackedSplit } from './resizable.js'
import { renderAiHint, renderConfirmModal, renderModalFooter, renderModalShell } from './ops-modals.js'
import { inertAttr } from './inert.js'
import { NoticeBar, useDismissedNotices } from './notice.js'
import { buildTops, windowRange } from './virtual-list.js'
import { useViewportTracker } from './use-viewport.js'
import { useRowSlider } from './row-slider.js'
import { changeKey, groupPickState, pathOfKey, pickDiscardTargets, pickStageTargets, toggleGroupKeys } from './selection-keys.js'
import { DiscardPickedModal } from './DiscardPickedModal.js'
import { TipWrapper, useHoverTip } from './tip.js'
import { ChangesToolbar } from './ChangesToolbar.js'
import { PushModal } from './PushModal.js'
import { PublishModal } from './PublishModal.js'
import { ChangesDiffPane } from './ChangesDiffPane.js'
import { DiffCardBackdrop, useDiffCard } from './diff-card.js'
import { ReposSection, type RepositoriesHost } from './ReposSection.js'

interface ChangesTabProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly visible?: boolean
  readonly snapshot: GitSnapshot
  readonly onAction: (action: GitAction) => Promise<{ ok: boolean; error?: string }>
  readonly onRefresh: () => Promise<void>
  /** Toggle the controller's "expand all" mode (lifts the host list cap). */
  readonly onSetFullChanges: (full: boolean) => Promise<void>
  /** Compact (single-column drill-in) layout for a narrow panel. */
  readonly compact: boolean
  /** Stacked layout: a tall narrow right sidebar — commit editor + change list
   * above, the diff below; picking a row updates the diff in place. */
  readonly stacked: boolean
  /**
   * Narrow *and* short: vertical room is genuinely scarce, so height-saving
   * choices apply — the commit editor folds into a one-row bar until tapped and
   * the stats bar drops its timestamps. A narrow but tall panel (a desktop
   * squeezed by a sidebar, a large phone) is not cramped and keeps both.
   */
  readonly cramped: boolean
  /** Docked repository list above the change list; the panel withholds it in
   * the compact layout, which keeps the list in the overview's branch filter. */
  readonly repositories?: RepositoriesHost
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type GroupKey = 'staged' | 'unstaged' | 'untracked'

// Change-list virtualization: only the rows in (or near) the viewport mount, so
// a work tree with thousands of changes (issue #16) renders ~a screenful of
// nodes instead of all of them. Heights are fixed per row kind so the window
// math is exact; the CSS pins .gp-file-row / .gp-group-head to these values.
const VROW_H = 28
const VHEAD_H = 26
const VOVERSCAN = 8
// Assumed viewport height before the first layout measurement, so the initial
// paint mounts a bounded window instead of the whole list.
const VIEWPORT_FALLBACK = 600

type ListItem =
  | { readonly kind: 'head'; readonly g: { key: GroupKey; labelKey: GitKey; count: number; collapsible: boolean }; readonly items: readonly GitChange[] }
  | { readonly kind: 'row'; readonly c: GitChange }

export function ChangesTab({ remote, sessionId, visible = true, snapshot, onAction, onRefresh, onSetFullChanges, compact, stacked, cramped, repositories, t }: ChangesTabProps): JSX.Element {
  const { queryVisible, queryKey } = useGitQuerySignal(sessionId, visible, snapshot.root)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [actionBusy, setBusy] = useState(false)
  const [pushOpen, setPushOpen] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishBusy, setPublishBusy] = useState(false)
  // Expanding a truncated list is itself a snapshot flight: it locks the same
  // controls `busy` does so a pick cannot race the incoming full list.
  const [expanding, setExpanding] = useState(false)
  const busy = actionBusy || pushBusy || publishBusy || expanding
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState<ReadonlySet<GroupKey>>(new Set())
  const [armedDiscard, setArmedDiscard] = useState<string | null>(null)
  const [discardPickedOpen, setDiscardPickedOpen] = useState(false)
  const [discardAllOpen, setDiscardAllOpen] = useState(false)
  // Whether the user has expanded the list past the host cap in this mount.
  // Drives the expand-bar wording ("已展开" + collapse); a fresh mount starts
  // capped even if the controller kept its fullChanges mode.
  const [listExpanded, setListExpanded] = useState(false)
  const { stashes, diffPath, diffData, expanded, showDiff } = useChangesData(
    remote, sessionId, snapshot, queryVisible, () => setError(t('error.generic')), queryKey,
  )
  const [diffMode, setDiffMode] = useState<DiffMode>(() => snapshot.defaultDiffView)
  // The toolbar header path doubles as its copy control: click writes the
  // relative path to the clipboard; the confirmation appears in place as a
  // check mark + tint on the path itself (the visible text never swaps to the
  // phrase — a bare text node wraps when the toolbar squeezes the button).
  const pathCopy = useCopyFeedback(diffPath === null ? null : diffPath.path)
  const [amendPrefilled, setAmendPrefilled] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [armedSuggest, setArmedSuggest] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Snapshot-derived banners are dismissible until their text changes.
  const dismissedNotices = useDismissedNotices()
  // Compact drill-in: 'list' shows the change list + commit box, 'diff' the
  // selected file's diff. Ignored by the wide layout (both columns at once).
  const [pane, setPane] = useState<'list' | 'diff'>('list')
  // The working-tree diff enlarged in place (gp-diff--card) — the same surface
  // the overview uses for a commit's file diff. State, refs and the focus
  // lifecycle come from one hook so the card cannot be open here and not a
  // dialog there.
  const diffCard = useDiffCard({ hasDiff: diffPath !== null, compact, paneIsDiff: pane === 'diff' })
  // Cramped (narrow and short): the commit editor starts folded into a one-row
  // bar so the change list keeps the panel's scarce height; tapping the bar
  // opens it in place. A narrow-but-tall panel keeps the full editor (the fold
  // costs the AI entry).
  const [commitOpen, setCommitOpen] = useState(false)
  // The caret is in the message field. A phone keyboard shrinks the panel box
  // into cramped territory the moment it opens, so the fold gate below reads
  // this too: folding then unmounts the field being typed in, which closes the
  // keyboard and rebounds the panel into the full editor — nothing can be typed.
  const [msgFocused, setMsgFocused] = useState(false)
  // Stash stack (queried on demand), its collapse state, the push dialog, and
  // the drop-confirm target index.
  const [stashClosed, setStashClosed] = useState(true)
  const [stashPushOpen, setStashPushOpen] = useState(false)
  const [stashDrop, setStashDrop] = useState<StashEntry | null>(null)
  const msgRef = useRef<HTMLTextAreaElement | null>(null)
  const commitBoxRef = useRef<HTMLDivElement | null>(null)
  // Focus on mount when the folded bar is expanded from a tap: a callback ref
  // fires inside the click's own commit, so the iOS keyboard still opens.
  const setMsgEl = useCallback((el: HTMLTextAreaElement | null) => {
    msgRef.current = el
    if (el !== null && cramped && commitOpen) el.focus()
  }, [cramped, commitOpen])
  // Folding swaps the editor for the one-row bar, taking the field out of the
  // DOM — and a removed field fires no blur. The fold releases the caret itself,
  // so the focus flag cannot stay set and hold the editor open.
  const foldEditor = useCallback((): void => {
    if (cramped) msgRef.current?.blur()
    setCommitOpen(false)
  }, [cramped])
  // Virtualized change-list viewport, tracked by the shared hook (re-attaches
  // across the compact list↔diff remount).
  const { setEl: setListEl, viewport } = useViewportTracker()
  // Row action hints: the icon-only buttons explain themselves on hover, via the
  // shared fast tooltip (ported to body so the list's overflow cannot clip it).
  const { tipProps, tipNode, hideTip, showTipNow } = useHoverTip({ placement: 'above', maxWidth: 300 })

  const staged = useMemo(() => snapshot.changes.filter((c) => c.staged).sort(byPath), [snapshot])
  const unstaged = useMemo(() => snapshot.changes.filter((c) => !c.staged && c.status !== 'untracked').sort(byPath), [snapshot])
  const untracked = useMemo(() => snapshot.changes.filter((c) => c.status === 'untracked').sort(byPath), [snapshot])

  const allGroups: Array<{ key: GroupKey; labelKey: GitKey; items: GitChange[] }> = [
    { key: 'staged', labelKey: 'changes.groupStaged', items: staged },
    { key: 'unstaged', labelKey: 'changes.groupUnstaged', items: unstaged },
    { key: 'untracked', labelKey: 'changes.groupUntracked', items: untracked },
  ]
  // A capped list is only a prefix of the change set, but `stats` still counts
  // everything: keep a group visible (and its header honest) even when every one
  // of its rows fell past the cap. The record is exhaustive over GroupKey so a
  // future group cannot silently inherit another group's count.
  const counts: Record<GroupKey, number> = {
    staged: snapshot.stats.staged,
    unstaged: snapshot.stats.modified,
    untracked: snapshot.stats.untracked,
  }
  const groups = allGroups.filter((g) => g.items.length > 0 || (snapshot.truncated && counts[g.key] > 0))

  // Flatten the visible (non-collapsed) groups into one row list and precompute
  // each item's top offset, so the list can mount only the viewport window.
  const { items, tops, totalH } = useMemo(() => {
    const items: ListItem[] = []
    for (const g of groups) {
      const count = snapshot.truncated ? counts[g.key] : g.items.length
      items.push({ kind: 'head', g: { key: g.key, labelKey: g.labelKey, count, collapsible: g.items.length > 0 }, items: g.items })
      if (!closed.has(g.key)) for (const c of g.items) items.push({ kind: 'row', c })
    }
    const tops = buildTops(items.map((it) => (it.kind === 'head' ? VHEAD_H : VROW_H)))
    return { items, tops, totalH: tops[items.length]! }
    // staged/unstaged/untracked already memoize on snapshot; closed drives collapse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged, unstaged, untracked, closed, snapshot.truncated, snapshot.stats])

  // Mounted window [first, last): the items overlapping the viewport, padded by
  // VOVERSCAN rows each side. Before the first layout measurement a fallback
  // height bounds the initial paint.
  const effHeight = viewport.height > 0 ? viewport.height : VIEWPORT_FALLBACK
  const { first, last } = windowRange(tops, viewport.top, effHeight, VOVERSCAN * VROW_H)

  // A hovered row can vanish without a mouseleave — the virtualized window
  // slides, or a snapshot refresh replaces the list — so drop the bubble with
  // whichever of those moved.
  useEffect(() => { hideTip() }, [first, last, snapshot, hideTip])

  // The fill travels between files (see row-slider.tsx). The list is
  // virtualized, so the mounted window is part of what can move the row.
  const { attach: attachSlider, slider: rowSliderNode } = useRowSlider({ activeSelector: '.gp-file-row--active', deps: [diffPath, items, first, last] })
  // Two owners need the scroller: the paging observer and the fill's measuring.
  const listNode = useCallback((node: HTMLDivElement | null) => {
    attachSlider(node)
    setListEl(node)
  }, [attachSlider, setListEl])

  // Prune selection to living paths (avoid a stale path aborting a commit).
  // Selection keys are `path:s`/`path:w`; a key survives only if a change with
  // that path and side still exists.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set(snapshot.changes.map((c) => changeKey(c)))
      const next = new Set<string>()
      let changed = false
      for (const k of prev) { if (alive.has(k)) next.add(k); else changed = true }
      return changed ? next : prev
    })
  }, [snapshot])

  // Prefill amend message from the last commit when the box is toggled on empty.
  useEffect(() => {
    if (!queryVisible || !pageVisibility.isVisible() || !amend || amendPrefilled || message.trim() !== '') return
    let alive = true
    void remote.query({ sessionId, query: { kind: 'last-commit-message' } }).then((res) => {
      const msg = queryAs(res, 'last-commit-message')
      if (alive && msg !== null) {
        setMessage(msg.message)
        setAmendPrefilled(true)
      }
    })
    return () => { alive = false }
  }, [amend, amendPrefilled, message, remote, sessionId, queryVisible])

  // Path pruning belongs to the data hook even while hidden; keep compact
  // navigation in sync without gating local selection/draft cleanup.
  useEffect(() => { if (diffPath === null) setPane('list') }, [diffPath])
  // Drilling into a diff hides the list pane, which unmounts the field without a
  // blur: clear the focus flag too, so coming back to the list does not land on a
  // half-screen editor.
  useEffect(() => {
    if (pane !== 'diff') return
    setMsgFocused(false)
    foldEditor()
  }, [pane, foldEditor])
  // Folded editor: pressing anywhere outside it folds it back (blank list
  // space, the toolbar, another row). The draft stays in state, so folding
  // loses nothing; pointerdown keeps it ahead of the click a row still needs.
  useEffect(() => {
    if (!cramped || (!commitOpen && !msgFocused) || typeof document === 'undefined') return
    const onOutside = (e: PointerEvent): void => {
      // A generation in flight owns the editor: folding it would expose a Commit
      // for the pre-generation draft while the suggestion is still on its way.
      if (suggesting) return
      const box = commitBoxRef.current
      if (box !== null && e.target instanceof Node && box.contains(e.target)) return
      // Notice banners (and their close button) sit right above the editor while
      // AI suggest runs; interacting with them must not fold the editor away.
      if (e.target instanceof Element && e.target.closest('.gp-notice') !== null) return
      foldEditor()
    }
    document.addEventListener('pointerdown', onOutside)
    return () => document.removeEventListener('pointerdown', onOutside)
  }, [cramped, commitOpen, msgFocused, suggesting, foldEditor])
  // Returning from the editor (fold button or a successful commit) must not drop
  // focus to <body>; ring the collapsed bar's open control instead.
  const barOpenRef = useRef<HTMLButtonElement | null>(null)
  const wasCommitOpen = useRef(false)
  useEffect(() => {
    const was = wasCommitOpen.current
    wasCommitOpen.current = cramped && commitOpen
    if (cramped && was && !commitOpen) barOpenRef.current?.focus({ preventScroll: true })
  }, [cramped, commitOpen])

  // Disarm a pending discard confirmation when the snapshot changes (the row
  // may be gone) so the destructive "click again" state can't linger.
  useEffect(() => { setArmedDiscard(null) }, [snapshot])
  // Same for the suggest-overwrite confirmation: a fresh snapshot means the
  // message-in-box context may have moved on.
  useEffect(() => { setArmedSuggest(false) }, [snapshot])

  // Batch discard targets: the selected working-tree paths, plus the staged-only
  // picks the confirm dialog reports as unaffected instead of dropping silently.
  const discardTargets = useMemo(() => pickDiscardTargets(selected), [selected])
  // Batch stage targets: the checked working-tree rows. Index-side picks are
  // already staged and never widen the set; the fresh snapshot retires their
  // `:w` keys, so nothing stale is carried into the next action.
  const stageTargets = useMemo(() => pickStageTargets(selected), [selected])

  // A snapshot that removes every checked row empties the target set; close the
  // dialog rather than letting a stale "open" flag pop it back on the next pick.
  useEffect(() => {
    if (discardPickedOpen && discardTargets.paths.length === 0) setDiscardPickedOpen(false)
  }, [discardPickedOpen, discardTargets])

  // Keyed by selection key (`path:s`/`path:w`), not by bare path: the same path
  // can be picked on both sides and the two rows must toggle independently.
  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // Group head checkbox: one press picks the whole group (or clears it when
  // every row is already picked). The pure toggle lives in selection-keys.
  const toggleGroupPick = (items: readonly GitChange[]): void => {
    setSelected((prev) => toggleGroupKeys(prev, items))
  }

  const run = async (action: GitAction): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await onAction(action)
      if (!result.ok) { setError(result.error ?? t('error.generic')); return false }
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.generic'))
      return false
    } finally {
      setBusy(false)
    }
  }

  const commit = async (): Promise<void> => {
    const text = message.trim()
    if (text === '' && !amend) { setError(t('error.emptyMessage')); return }
    // Selection keys carry a :s/:w side suffix; commit works on bare paths.
    const paths = selected.size > 0 ? [...new Set([...selected].map((k) => pathOfKey(k)))] : undefined
    const ok = await run({ kind: 'commit', message: text, ...(paths ? { paths } : {}), ...(amend ? { amend: true } : {}) })
    if (ok) { setMessage(''); setSelected(new Set()); setAmend(false); setAmendPrefilled(false); foldEditor() }
  }

  // Stash: push the current changes (optional message), then apply / pop / drop
  // stack entries. Controller accept supplies one query signal for the fresh stack.
  const stashPush = async (message: string): Promise<void> => {
    const ok = await run({ kind: 'stash-push', ...(message.trim() !== '' ? { message } : {}) })
    if (ok) setStashPushOpen(false)
  }
  const stashApply = (index: number, sha: string): void => { void run({ kind: 'stash-apply', index, sha }) }
  const stashPop = (index: number, sha: string): void => { void run({ kind: 'stash-pop', index, sha }) }
  const stashDropConfirmed = async (index: number, sha: string): Promise<void> => {
    const ok = await run({ kind: 'stash-drop', index, sha })
    if (ok) setStashDrop(null)
  }
  // Batch discard of the checked files' working-tree changes (already confirmed
  // by the dialog). The refreshed snapshot prunes the now-clean rows, and the
  // selection with them.
  const discardPicked = async (): Promise<void> => {
    const paths = [...discardTargets.paths]
    if (paths.length === 0) { setDiscardPickedOpen(false); return }
    const ok = await run({ kind: 'discard', paths })
    if (ok) setDiscardPickedOpen(false)
  }

  // "Expand all": ask the controller to lift the host list cap and re-sample.
  // `expanding` locks the list the same way `busy` does, so no pick can race
  // the incoming full list (which would prune it on arrival).
  const expandList = async (): Promise<void> => {
    if (expanding) return
    setExpanding(true)
    setError(null)
    try { await onSetFullChanges(true) }
    finally { setExpanding(false) }
  }
  // Collapse back to the capped view: the next poll carries the cap again and
  // the selection prunes to the loaded rows.
  const collapseList = async (): Promise<void> => {
    if (expanding) return
    setExpanding(true)
    try { await onSetFullChanges(false) }
    finally { setExpanding(false) }
  }

  // "Discard all" (confirmed): one host-side action — it re-resolves the full
  // change set itself, so it stays correct even while the list is truncated.
  const discardAllConfirmed = async (): Promise<void> => {
    const ok = await run({ kind: 'discard-all' })
    if (ok) setDiscardAllOpen(false)
  }

  /** Map a suggest-endpoint failure to display text; the provider detail rides along. */
  const suggestErrorText = (code: GitErrorCode, detail: string | undefined): string => {
    switch (code) {
      case 'empty-diff': return t('error.emptyDiff')
      case 'llm-unavailable': return t('error.llmUnavailable')
      case 'suggest-disabled': return t('error.suggestDisabled')
      case 'llm-error':
      case 'llm-output': return detail === undefined ? t('error.llmFailed') : `${t('error.llmFailed')}: ${detail}`
      default: return detail ?? t('error.generic')
    }
  }

  // Generate a commit message from the current changes (scoped to the
  // selection) and fill the box. On failure the typed error shows above; the
  // user's existing draft is never overwritten by a failed generation. In
  // amend mode a non-empty box holds the previous commit's message as the
  // reference, so replacing it takes a second click (armed pattern, like
  // discard).
  const suggest = async (): Promise<void> => {
    if (suggesting) return
    if (amend && !armedSuggest && message.trim() !== '') {
      setArmedSuggest(true)
      setError(null)
      setNotice(t('commit.suggestOverwrite'))
      return
    }
    setArmedSuggest(false)
    // Selection keys carry a :s/:w side suffix; the suggestion scopes to bare paths.
    const paths = selected.size > 0 ? [...new Set([...selected].map((k) => pathOfKey(k)))] : undefined
    setSuggesting(true)
    setError(null)
    setNotice(null)
    try {
      const res = await remote.suggest({ sessionId, ...(paths && paths.length > 0 ? { paths } : {}) })
      if (res.ok) {
        setMessage(res.value.message)
        if (res.value.truncated === true) setNotice(t('commit.suggestTruncated'))
        msgRef.current?.focus()
      } else {
        setError(suggestErrorText(res.error.code, res.error.message))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.generic'))
    } finally {
      setSuggesting(false)
    }
  }

  const toggleGroup = (key: GroupKey): void => {
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const summary = diffData !== null && diffData.text !== '' ? diffSummary(diffData.text) : null

  // The left change-list column is drag-resizable; the right diff column takes
  // the rest. Width persists across mounts.
  const leftCol = useResizableColumn({ storageKey: 'gp.changes.left', initial: 380, min: 220, reserve: 200, edge: 'end', resetTitle: t('resizer.resetWidth') })
  // Stacked only reads it here (hooks run unconditionally); the shared split
  // keeps this tab's bands aligned with the overview and files tabs.
  const split = useStackedSplit(t('resizer.resetHeight'))

  // Open a file's diff; in compact drill into the diff pane.
  const openDiff = (path: string, base: 'worktree' | 'staged'): void => {
    void showDiff(path, base)
    if (compact) setPane('diff')
  }

  // Compact drops side-by-side (no room) and renders split as unified instead.
  const diffModes: DiffMode[] = compact ? ['unified', 'before', 'after'] : ['unified', 'split', 'before', 'after']
  const effDiffMode: DiffMode = compact && diffMode === 'split' ? 'unified' : diffMode

  // Commit box. Everywhere but a cramped panel: the full editor. When both axes
  // are scarce the editor folds into one bar (placeholder or the draft's first
  // line, the AI entry, commit) until tapped, which opens it in place — the
  // change list gets the height back. A field holding the caret never folds: the
  // keyboard that made the panel cramped would go down with it.
  const draft = message.trim()
  const draftLine = draft.split('\n')[0] ?? ''
  // One guard for both layouts: folding the editor must never expose a Commit
  // that the full editor would have disabled (a suggestion is in flight).
  const commitDisabled = busy || suggesting || draft === ''
  // Generating needs changes to read; both AI entries share the rule.
  const suggestDisabled = busy || suggesting || snapshot.changes.length === 0
  const commitEditor = h('div', { key: 'box', className: 'gp-commitbox', ref: commitBoxRef }, [
    h('div', {
      key: 'msg',
      className: `gp-commitbox__msg-wrap${suggesting ? ' gp-commitbox__msg-wrap--busy' : ''}`,
    }, [
      h('textarea', {
        key: 'ta',
        className: 'gp-commitbox__msg',
        placeholder: t('commit.placeholder'),
        value: message,
        ref: setMsgEl,
        // Locked while a suggestion is in flight so typing can't race the
        // incoming message (readOnly, not disabled: focus() lands on success).
        readOnly: suggesting,
        'aria-busy': suggesting,
        onFocus: () => setMsgFocused(true),
        onBlur: () => setMsgFocused(false),
        onChange: (e: { target: { value: string } }) => setMessage(e.target.value),
      }),
      // The platform loader inside the field itself: the lock should read as
      // "working", not as a broken input. Decorative — aria-busy above carries
      // the state.
      suggesting
        ? h('span', { key: 'spin', className: 'gp-commitbox__spin', 'aria-hidden': 'true' }, h(StateDot, { state: 'ongoing', size: 13 }))
        : null,
    ]),
    h('div', { key: 'row', className: 'gp-commitbox__row' }, [
      h('label', { key: 'amend', className: 'gp-commitbox__amend' }, [
        h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: amend, disabled: suggesting, onChange: () => { setAmend((v) => !v); setAmendPrefilled(false) } }),
        t('commit.amend'),
      ]),
      h('div', { key: 'actions', className: 'gp-commitbox__actions' }, [
        snapshot.suggestEnabled !== false
          ? h('button', {
            key: 'suggest', type: 'button', className: 'gp-btn',
            disabled: suggestDisabled,
            onClick: () => void suggest(),
            title: t('commit.suggest'),
          }, [h(SparkleIcon, { key: 'ic', size: 13 }), suggesting ? t('commit.suggesting') : t('commit.suggest')])
          : null,
        h('button', { key: 'commit', type: 'button', className: 'gp-btn gp-btn--primary', disabled: commitDisabled, onClick: () => void commit() }, t('commit.commit')),
        cramped
          ? h('button', {
            key: 'fold', type: 'button', className: 'gp-icon-btn gp-commitbox__fold',
            disabled: suggesting,
            title: t('commit.collapse'),
            'aria-label': t('commit.collapse'),
            onClick: foldEditor,
          }, h(ChevronIcon, { key: 'i', size: 13, open: true }))
          : null,
      ]),
    ]),
  ])
  const commitBox = !cramped || commitOpen || msgFocused
    ? commitEditor
    : h('div', { key: 'box', className: 'gp-commitbar' }, [
      h('button', {
        key: 'open', type: 'button', className: 'gp-commitbar__open',
        ref: barOpenRef,
        title: t('commit.edit'),
        'aria-label': t('commit.edit'),
        // One tap opens the editor and puts the caret in it (no extra step
        // compared with typing straight into a permanently visible field).
        onClick: () => setCommitOpen(true),
      }, draft === ''
        ? h('span', { key: 'ph', className: 'gp-commitbar__ph' }, t('commit.placeholder'))
        : h('span', { key: 'draft', className: 'gp-commitbar__draft' }, draftLine)),
      // The folded bar keeps the generation entry: one tap opens the editor and
      // starts generating, so the AI button is never lost to the fold.
      snapshot.suggestEnabled !== false
        ? h('button', {
          key: 'ai', type: 'button', className: 'gp-btn gp-commitbar__ai',
          disabled: suggestDisabled,
          title: t('commit.suggest'),
          'aria-label': t('commit.suggest'),
          onClick: () => { setCommitOpen(true); void suggest() },
        }, [h(SparkleIcon, { key: 'ic', size: 13 }), t('commit.ai')])
        : null,
      h('button', {
        key: 'commit', type: 'button', className: 'gp-btn gp-btn--primary gp-commitbar__commit',
        disabled: commitDisabled,
        onClick: () => void commit(),
      }, t('commit.commit')),
    ])

  // VSCode-style "Publish Branch" strip: the branch exists only locally, so
  // there is no upstream to push to yet. Rendered above the commit editor where
  // the eye lands right after committing, and kept out of the way whenever the
  // branch can be pushed normally (or has nowhere to go).
  const publishBar = canPublish(snapshot)
    ? h('div', { key: 'publishbar', className: 'gp-publishbar' }, h('button', {
      type: 'button', className: 'gp-btn gp-btn--primary gp-publishbar__btn',
      disabled: busy,
      title: t('commit.publishTitle'),
      onClick: () => { hideTip(); setPublishOpen(true) },
    }, [h(UploadIcon, { key: 'ic', size: 13 }), t('commit.publish')]))
    : null

  const collapsedNotice = t('changes.untrackedCollapsed')
  const truncatedNotice = t(
    snapshot.truncatedReason === 'lossy'
      ? 'changes.truncatedLossy'
      : snapshot.truncatedReason === 'cap' ? 'changes.truncatedCap' : 'changes.truncatedUnknown',
    { n: snapshot.changes.length },
  )

  const leftChildren = [
    // The same docked list the overview shows (one shared collapse state), so
    // switching repositories is one click away from this pane too.
    repositories === undefined ? null : h(ReposSection, { key: 'repos', choices: repositories.choices, current: repositories.current, snapshot, onChoose: repositories.onChoose, collapsed: repositories.collapsed ?? false, onToggleCollapse: repositories.onToggleCollapse, t }),
    h(ChangeStats, { key: 'stats', stats: snapshot.stats, compact, showTimes: !cramped, t }),
    h(ChangesToolbar, {
      key: 'toolbar', snapshot, busy, hasDiscardTargets: discardTargets.paths.length > 0,
      stageTargets,
      onStagePicked: (paths) => { if (paths.length > 0) void run({ kind: 'stage', paths: [...paths] }) },
      onStageAll: () => void run({ kind: 'stage-all' }),
      onUnstageAll: () => void run({ kind: 'unstage-all' }),
      onDiscard: () => { setError(null); setDiscardPickedOpen(true) },
      onDiscardAll: () => { setError(null); setDiscardAllOpen(true) },
      onStash: () => { setError(null); setStashPushOpen(true) },
      onPush: () => { hideTip(); setPushOpen(true) },
      onPublish: () => { hideTip(); setPublishOpen(true) },
      onRefresh, t,
    }),
    // Inline failure, dismissible: provider errors can be long and wrap, so the
    // close control shares the text row instead of costing one of its own.
    error !== null
      ? h('div', { key: 'err', className: 'gp-feedback gp-feedback--dismissible' }, [
        h('span', { key: 'txt', className: 'gp-feedback__text' }, error),
        h('button', {
          key: 'close', type: 'button', className: 'gp-feedback__close',
          title: t('common.close'), 'aria-label': t('common.close'),
          onClick: () => setError(null),
        }, h(CloseIcon, { key: 'i', size: 12 })),
      ])
      : null,
    notice !== null
      ? h(NoticeBar, { key: 'notice', text: notice, closeLabel: t('common.close'), onClose: () => setNotice(null) })
      : null,
    // The list can be incomplete in two independent ways; both are surfaced so
    // an entry never disappears from the panel without an explanation. They
    // appear after a poll, so `role="status"` announces them once.
    snapshot.untrackedCollapsed === true && !dismissedNotices.isDismissed(collapsedNotice)
      ? h(NoticeBar, { key: 'collapsed', status: true, text: collapsedNotice, closeLabel: t('common.close'), onClose: () => dismissedNotices.dismiss(collapsedNotice) })
      : null,
    snapshot.truncated && !dismissedNotices.isDismissed(truncatedNotice)
      ? h(NoticeBar, { key: 'truncated', status: true, text: truncatedNotice, closeLabel: t('common.close'), onClose: () => dismissedNotices.dismiss(truncatedNotice) })
      : null,
    h('div', { key: 'list', className: 'gp-changes__list', ref: listNode }, [
      rowSliderNode,
      snapshot.changes.length === 0
        ? h('div', { className: 'gp-empty' }, t('changes.noChanges'))
        : h('div', { className: 'gp-changes__vlist', style: { height: totalH } },
          items.slice(first, last).map((it, k) => {
            const idx = first + k
            if (it.kind === 'head') {
              const g = it.g
              // A group kept only for its full count (every row fell past the cap)
              // has nothing to toggle: render a static head instead of a chevron
              // that silently does nothing.
              // The head checkbox picks the whole group (or clears it when all
              // rows are already picked); its press must not also collapse the
              // group, so it stops propagation.
              const pick = groupPickState(selected, it.items)
              return h('div', {
                key: `h:${g.key}`, className: 'gp-changes__vrow', style: { top: tops[idx], height: VHEAD_H },
              }, h('div', {
                className: `gp-group-head${g.collapsible ? '' : ' gp-group-head--static'}`,
                ...(g.collapsible ? { onClick: () => toggleGroup(g.key) } : {}),
              }, [
                g.collapsible
                  ? h(ChevronIcon, { key: 'chev', size: 12, open: !closed.has(g.key) })
                  : h('span', { key: 'chev', className: 'gp-group-head__chev-spacer' }),
                // Hidden while the group is truncated past the list cap: the
                // head count comes from the full stats but only the prefix is
                // loaded, so a select-all would read as checked while covering
                // just those rows. Expanding the list restores the checkbox.
                it.items.length > 0 && it.items.length >= g.count
                  ? h('span', {
                    key: 'pick', className: 'gp-group-head__pick',
                    onClick: (e: Event) => e.stopPropagation(),
                  }, h('input', {
                    type: 'checkbox', className: 'gp-check',
                    checked: pick === 'all',
                    // `indeterminate` is not in React's DOM property table — a
                    // JSX prop would land as a content attribute, which never
                    // sets the IDL property. The ref sets it directly; the
                    // inline identity is load-bearing (React re-runs a callback
                    // ref only when the function identity changes), so do not
                    // wrap it in useCallback.
                    ref: (el: HTMLInputElement | null) => { if (el !== null) el.indeterminate = pick === 'partial' },
                    disabled: busy,
                    'aria-label': t('changes.selectAllGroup', { group: t(g.labelKey) }),
                    onChange: () => toggleGroupPick(it.items),
                  }))
                  : null,
                `${t(g.labelKey)} (${g.count})`,
              ]))
            }
            // A path staged AND modified appears in two rows; key selection /
            // active / armed by path+side so acting on one row doesn't light up
            // the other.
            const c = it.c
            const rowKey = changeKey(c)
            // The diff query names the side with its own vocabulary; spell the
            // mapping once for the row instead of twice inside the props below.
            const base = c.staged ? 'staged' : 'worktree'
            return h('div', {
              key: rowKey, className: 'gp-changes__vrow', style: { top: tops[idx], height: VROW_H },
            }, renderFileRow(c, {
              selected: selected.has(rowKey),
              active: diffPath?.path === c.path && diffPath.base === base,
              busy,
              armed: armedDiscard === rowKey,
              onToggle: () => toggle(rowKey),
              onOpen: () => openDiff(c.path, base),
              onStage: () => void run(c.staged ? { kind: 'unstage', paths: [c.path] } : { kind: 'stage', paths: [c.path] }),
              onDiscard: () => {
                if (armedDiscard === rowKey) { void run({ kind: 'discard', paths: [c.path] }); setArmedDiscard(null) }
                else setArmedDiscard(rowKey)
              },
              tipProps,
              hideTip,
              showTipNow,
              t,
            }))
          })),
    ]),
    // Truncation control: expand lifts the host list cap (fullChanges mode,
    // kept for the controller's lifetime so the next poll does not re-truncate
    // and prune the selection); collapse returns to the capped poll. While
    // `expanding` the label reads as loading and `busy` already locks picks.
    snapshot.truncated || listExpanded
      ? h('div', { key: 'expandbar', className: 'gp-changes__expandbar' }, [
        h('span', { key: 'txt', className: 'gp-changes__expandbar__text' },
          expanding
            ? t('changes.expanding')
            : listExpanded
              ? t('changes.expandedAll', { n: snapshot.changes.length })
              : t('changes.truncatedCap', { n: snapshot.changes.length })),
        expanding
          ? null
          : h('button', {
            key: 'btn', type: 'button', className: 'gp-btn gp-btn--sm',
            disabled: busy,
            onClick: () => {
              const next = !listExpanded
              void (next ? expandList() : collapseList()).then(() => setListExpanded(next))
            },
          }, t(listExpanded ? 'changes.collapseList' : 'changes.expandAll')),
      ])
      : null,
    // stash list (collapsible)
    stashes.length > 0 ? h('div', { key: 'stashes', className: 'gp-stash' }, [
      h('div', { key: 'head', className: 'gp-group-head', onClick: () => setStashClosed((v) => !v) }, [
        h(ChevronIcon, { key: 'chev', size: 12, open: !stashClosed }),
        `${t('stash.section')} (${stashes.length})`,
      ]),
      stashClosed ? null : h('div', { key: 'items' }, stashes.map((s) => renderStashRow(s, {
        busy,
        onApply: () => stashApply(s.index, s.sha),
        onPop: () => stashPop(s.index, s.sha),
        onDrop: () => { setError(null); setStashDrop(s) },
        t,
      }))),
    ]) : null,
    publishBar,
    commitBox,
  ]

  const diffBlock = h(ChangesDiffPane, {
    diffPath, diffData, summary,
    card: diffCard,
    mode: { options: diffModes, current: effDiffMode, onChange: setDiffMode },
    copy: { feedback: pathCopy.feedback, onCopy: () => pathCopy.copy() },
    expanded,
    compact, queryVisible, remote, sessionId, t,
    onToggleExpand: () => { if (diffPath !== null) void showDiff(diffPath.path, diffPath.base, !expanded) },
    onBackToList: () => setPane('list'),
  })

  // Write-op dialogs (stash push / stash drop / batch discard), portaled;
  // rendered by both layouts.
  const modals: (JSX.Element | null)[] = [
    // Backdrop for the in-place enlarged diff (gp-diff--card). A plain fixed
    // sibling of the diff — no portal, no second DiffView; the card itself IS
    // the inline pane restyled. `card.visible` is the same predicate the card's
    // dialog attributes use, so a compact back-navigation (which unmounts the
    // diff) cannot strand a backdrop over the panel.
    diffCard.visible ? h(DiffCardBackdrop, { key: 'diff-backdrop', onClose: diffCard.close }) : null,
    pushOpen ? h(PushModal, { key: 'remote-push', remote, sessionId, snapshot, onAction, onClose: () => setPushOpen(false), onBusyChange: setPushBusy, t }) : null,
    publishOpen ? h(PublishModal, { key: 'remote-publish', snapshot, onAction, onClose: () => setPublishOpen(false), onBusyChange: setPublishBusy, t }) : null,
    stashPushOpen ? h(StashPushModal, { key: 'push', onClose: () => setStashPushOpen(false), onStash: stashPush, error, t }) : null,
    stashDrop !== null ? renderConfirmModal({
      title: t('stash.dropTitle'),
      body: t('stash.dropConfirm', { name: stashDrop.message }),
      confirmLabel: t('stash.drop'),
      danger: true,
      error,
      onConfirm: () => void stashDropConfirmed(stashDrop.index, stashDrop.sha),
      onClose: () => setStashDrop(null),
      t,
    }) : null,
    discardPickedOpen && discardTargets.paths.length > 0
      ? h(DiscardPickedModal, {
        key: 'discard-picked',
        paths: discardTargets.paths,
        stagedOnly: discardTargets.stagedOnly,
        snapshot,
        busy,
        error,
        onConfirm: () => void discardPicked(),
        onClose: () => setDiscardPickedOpen(false),
        t,
      })
      : null,
    // "Discard all": counts come from the snapshot's full stats (honest even
    // while the list is truncated); the host re-resolves the paths itself.
    discardAllOpen
      ? renderConfirmModal({
        title: t('changes.discardAllTitle'),
        body: t('changes.discardAllBody', { count: snapshot.stats.modified + snapshot.stats.untracked }),
        extra: (() => {
          const notes: JSX.Element[] = []
          if (snapshot.stats.untracked > 0) {
            notes.push(h('div', { key: 'untracked', className: 'gp-modal__confirmtext' }, t('changes.discardAllUntracked', { count: snapshot.stats.untracked })))
          }
          if (snapshot.stats.staged > 0) {
            notes.push(h('div', { key: 'staged', className: 'gp-modal__confirmtext' }, t('changes.discardAllStaged', { count: snapshot.stats.staged })))
          }
          return notes.length > 0 ? h('div', { key: 'notes' }, notes) : null
        })(),
        confirmLabel: t('changes.discard'),
        danger: true,
        error,
        confirmBusy: busy,
        busyLabel: t('changes.discarding'),
        onConfirm: () => void discardAllConfirmed(),
        onClose: () => setDiscardAllOpen(false),
        t,
      })
      : null,
  ]

  // Stacked: a tall narrow sidebar keeps the editor + list band on top and the
  // diff below — picking a row swaps the diff in place, nothing drills. The
  // full commit editor stays (stacked is tall, so it is not cramped).
  if (stacked) {
    return h('div', { className: 'gp-changes gp-changes--stacked' }, [
      ...modals,
      tipNode,
      h('div', { key: 'left', className: 'gp-changes__left', style: { flex: `0 0 ${split.pct}%` }, ...inertAttr(diffCard.visible) }, leftChildren),
      h('div', {
        key: 'split', className: 'gp-resizer gp-resizer--row', role: 'separator',
        'aria-orientation': 'horizontal',
        ...split.dividerProps,
      }),
      h('div', { key: 'right', className: 'gp-changes__right' }, diffBlock),
    ])
  }

  // Compact: a single column drilling from the change list into the diff.
  if (compact) {
    return h('div', { className: 'gp-changes gp-changes--compact' }, [
      ...modals,
      tipNode,
      pane === 'diff'
        ? h('div', { key: 'right', className: 'gp-changes__right' }, diffBlock)
        : h('div', { key: 'left', className: 'gp-changes__left' }, leftChildren),
    ])
  }

  return h('div', { className: 'gp-changes' }, [
    ...modals,
    tipNode,
    // left
    h('div', { key: 'left', className: 'gp-changes__left', style: { flex: `0 0 ${leftCol.width}px` }, ...inertAttr(diffCard.visible) }, leftChildren),
    leftCol.divider,
    // right diff
    h('div', { key: 'right', className: 'gp-changes__right' }, diffBlock),
  ])
}

interface StashPushCbs {
  onClose: () => void
  onStash: (message: string) => void | Promise<void>
  error: string | null
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** Portaled dialog: an optional message for the stash about to be pushed.
 * renderModalShell owns the SSR/portal guard, so this is a single component. */
function StashPushModal({ onClose, onStash, error, t }: StashPushCbs): JSX.Element | null {
  const [message, setMessage] = useState('')
  return renderModalShell({
    onClose, title: t('stash.title'), icon: h(StashIcon, { size: 15 }),
    portalKey: 'stash-push-modal', t,
    body: [
      h('input', {
        key: 'msg', className: 'gp-input', placeholder: t('stash.messagePlaceholder'), value: message, autoFocus: true,
        onChange: (e: { target: { value: string } }) => setMessage(e.target.value),
        onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') void onStash(message) },
      }),
      renderAiHint(t),
      error !== null ? h('div', { key: 'err', className: 'gp-feedback' }, error) : null,
    ],
    footer: renderModalFooter({ onClose, onConfirm: () => void onStash(message), confirmLabel: t('stash.save'), confirmDisabled: false, danger: false, t }),
  })
}

interface StashRowCbs {
  busy: boolean
  onApply: () => void
  onPop: () => void
  onDrop: () => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

function renderStashRow(s: StashEntry, cb: StashRowCbs): JSX.Element {
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

function byPath(a: GitChange, b: GitChange): number {
  return a.path.localeCompare(b.path)
}

interface RowActions {
  selected: boolean
  active: boolean
  busy: boolean
  armed: boolean
  onToggle: () => void
  onOpen: () => void
  onStage: () => void
  onDiscard: () => void
  /** Hover explanation for the icon-only row buttons (see `tip.tsx`). */
  tipProps: (text: string) => Record<string, unknown>
  hideTip: () => void
  /** Raise a hint at once (no hover wait) — the arming press uses it. */
  showTipNow: (el: HTMLElement, text: string) => void
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

function renderFileRow(c: GitChange, a: RowActions): JSX.Element {
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
          if (a.armed) { a.hideTip(); a.onDiscard(); return }
          a.onDiscard()
          a.showTipNow(e.currentTarget as HTMLElement, a.t('changes.discardTipArmed'))
        },
      }, h('span', { 'aria-hidden': true }, h(TrashIcon, { size: 14 })))),
    ]),
  ])
}
