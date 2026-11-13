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
import { diffSummary, type DiffMode } from './DiffView.js'
import { ChevronIcon, CloseIcon, SparkleIcon } from './icons.js'
import { useResizableColumn, useStackedSplit } from './resizable.js'
import { renderConfirmModal } from './ops-modals.js'
import { StashPushModal, renderChangeRow, renderStashRow, type ChangeRowCtx } from './changes-rows.js'
import { buildChangeRows, dirDiscardPaths, dirKey, normalizeViewMode, ROW_H, type ChangeGroupKey, type ChangeViewMode } from './changes-tree.js'
import { inertAttr } from './inert.js'
import { NoticeBar, useDismissedNotices } from './notice.js'
import { buildTops, windowRange, VIEWPORT_FALLBACK, VOVERSCAN } from './virtual-list.js'
import { useViewportTracker } from './use-viewport.js'
import { useRowSlider } from './row-slider.js'
import { changeKey, pathOfKey, pickDiscardTargets, pickStageTargets, sideOf, toggleGroupKeys } from './selection-keys.js'
import type { ChangesMenuCommands, ChangesMenuFacts } from './changes-menu.js'
import type { PanelMenu } from './menu-bindings.js'
import { MENU_KIND } from './menu-owners.js'
import { DiscardPickedModal } from './DiscardPickedModal.js'
import { useHoverTip } from './tip.js'
import { ChangesToolbar } from './ChangesToolbar.js'
import { PublishModal } from './PublishModal.js'
import { SetUpstreamModal } from './SetUpstreamModal.js'
import { canPush, canSetUpstream } from './push-policy.js'
import { ChangesDiffPane } from './ChangesDiffPane.js'
import { DiffCardBackdrop, useDiffCard } from './diff-card.js'
import { ReposSection, type RepositoriesHost } from './ReposSection.js'

interface ChangesTabProps {
  /** The panel's menu face (rows bind through it). */
  readonly panelMenu?: PanelMenu
  /** Refs the panel owns: this tab publishes its runs, busy flag and checked
   * set each render, and the menu owner reads them at resolve time. */
  readonly menuCommandsRef?: { current: ChangesMenuCommands | null }
  readonly menuFactsRef?: { current: ChangesMenuFacts }
  readonly menuPickRef?: { current: ReadonlySet<string> }
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
  /** Write the changes-list view to the plugin config (the settings form's
   * write contract); resolves false when the write could not land. */
  readonly onSetChangesView: (view: ChangeViewMode) => Promise<boolean>
  /** Docked repository list above the change list; the panel withholds it in
   * the compact layout, which keeps the list in the overview's branch filter. */
  readonly repositories?: RepositoriesHost
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

// Change-list virtualization: only the rows in (or near) the viewport mount, so
// a work tree with thousands of changes (issue #16) renders ~a screenful of
// nodes instead of all of them. Fixed per-kind heights make the window math
// exact; the table is the row model's (`ROW_H` in changes-tree.ts) and the CSS
// pins the same kinds to it — both sides are asserted in
// test/unit/changes-row-heights.test.mjs, the rendered geometry in e2e.
/** Rows sort by path within their own staged/unstaged/untracked list. */
const byPath = (a: GitChange, b: GitChange): number => a.path.localeCompare(b.path)
// How long a row's discard button stays armed. The confirmation is a second
// deliberate click, not a mode: a checkout that never changes never fires the
// snapshot effect that would disarm it, so without a deadline an armed button
// would wait indefinitely for a stray click.
const DISCARD_ARM_MS = 4000

export function ChangesTab({ panelMenu, menuCommandsRef, menuFactsRef, menuPickRef,  remote, sessionId, visible = true, snapshot, onAction, onRefresh, onSetFullChanges, onSetChangesView, compact, stacked, cramped, repositories, t }: ChangesTabProps): JSX.Element {
  const { queryVisible, queryKey } = useGitQuerySignal(sessionId, visible, snapshot.root)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [actionBusy, setBusy] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishBusy, setPublishBusy] = useState(false)
  // Set-upstream always opens its chooser; the modal reports its in-flight
  // state here so the rest of the toolbar locks with it.
  const [setUpstreamOpen, setSetUpstreamOpen] = useState(false)
  const [setUpstreamBusy, setSetUpstreamBusy] = useState(false)
  // Expanding a truncated list is itself a snapshot flight: it locks the same
  // controls `busy` does so a pick cannot race the incoming full list.
  const [expanding, setExpanding] = useState(false)
  const busy = actionBusy || publishBusy || setUpstreamBusy || expanding
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState<ReadonlySet<ChangeGroupKey>>(new Set())
  // The list's presentation: one row per file, or one per directory. It is an
  // install-level setting (host config, default flat); the toolbar's icon
  // group writes it and the snapshot carries it back. The local copy only
  // covers the write's round-trip so the switch feels immediate.
  const [viewMode, setViewMode] = useState<ChangeViewMode>(() => normalizeViewMode(snapshot.changesView))
  useEffect(() => { setViewMode(normalizeViewMode(snapshot.changesView)) }, [snapshot.changesView])
  // Directory collapse state, keyed by group + path: the same directory appears
  // in "staged" and "changes" and the two rows collapse independently.
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(new Set())
  // Directory discard confirm target: a directory has no armed-button gesture
  // (one stray pair of clicks would wipe a whole subtree), so it reuses the
  // batch-discard dialog with the directory's own scope. Only the identity is
  // stored — the path list is re-derived from the live rows on every render
  // (`discardDirPaths`), so the dialog's count always equals what confirming
  // would actually send.
  const [discardDir, setDiscardDir] = useState<{ group: ChangeGroupKey; path: string } | null>(null)
  const [armedDiscard, setArmedDiscard] = useState<string | null>(null)
  const [discardPickedOpen, setDiscardPickedOpen] = useState(false)
  // The paths a menu entry captured, when the entry (not the toolbar) opened the
  // confirm. The dialog then reports exactly what the gesture named instead of
  // whatever happens to be checked — a row that is not part of the pick must not
  // turn "discard this file" into "discard the checked files".
  const [discardRequest, setDiscardRequest] = useState<readonly string[] | null>(null)
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

  const allGroups: Array<{ key: ChangeGroupKey; items: readonly GitChange[] }> = [
    { key: 'staged', items: staged },
    { key: 'unstaged', items: unstaged },
    { key: 'untracked', items: untracked },
  ]
  // A capped list is only a prefix of the change set, but `stats` still counts
  // everything: keep a group visible (and its header honest) even when every one
  // of its rows fell past the cap. The record is exhaustive over ChangeGroupKey
  // so a future group cannot silently inherit another group's count.
  const counts: Record<ChangeGroupKey, number> = {
    staged: snapshot.stats.staged,
    unstaged: snapshot.stats.modified,
    untracked: snapshot.stats.untracked,
  }
  const groups = allGroups.filter((g) => g.items.length > 0 || (snapshot.truncated && counts[g.key] > 0))

  // The directory dialog's targets, re-derived from the live rows on every
  // render: same group, same directory prefix — so a poll that removes files
  // shrinks the count instead of letting the confirmation promise paths the
  // panel no longer knows about.
  const discardDirPaths = useMemo(() => {
    if (discardDir === null) return []
    const items = discardDir.group === 'staged' ? staged
      : discardDir.group === 'unstaged' ? unstaged
        : untracked
    const prefix = `${discardDir.path}/`
    return dirDiscardPaths(items.filter((c) => c.path.startsWith(prefix)))
  }, [discardDir, staged, unstaged, untracked])

  // Flatten the groups into the row list the window mounts — flat or nested,
  // filter applied, collapsed directories hidden — and precompute each row's
  // top offset so only the viewport's rows render.
  const { items, tops, totalH } = useMemo(() => {
    const rows = buildChangeRows({
      groups: groups.map((g) => ({ key: g.key, items: g.items, count: snapshot.truncated ? counts[g.key] : g.items.length })),
      closedGroups: closed,
      mode: viewMode,
      collapsedDirs,
    })
    const tops = buildTops(rows.map((row) => ROW_H[row.kind]))
    return { items: rows, tops, totalH: tops[rows.length]! }
    // staged/unstaged/untracked already memoize on snapshot; the rest is the
    // view state the builder reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged, unstaged, untracked, closed, viewMode, collapsedDirs, snapshot.truncated, snapshot.stats])

  // Mounted window [first, last): the items overlapping the viewport, padded by
  // VOVERSCAN rows each side. Before the first layout measurement a fallback
  // height bounds the initial paint.
  const effHeight = viewport.height > 0 ? viewport.height : VIEWPORT_FALLBACK
  const { first, last } = windowRange(tops, viewport.top, effHeight, VOVERSCAN * ROW_H.file)

  // A hovered row can vanish without a mouseleave — the virtualized window
  // slides, a snapshot refresh replaces the list, or the tree collapses above
  // the row — so drop the bubble with whatever moved.
  useEffect(() => { hideTip() }, [first, last, snapshot, items, hideTip])

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

  // Collapsed directories belong to one checkout: another repository has its
  // own tree, and a stale path would hide a directory the reader never folded.
  useEffect(() => { setCollapsedDirs(new Set()) }, [snapshot.root])

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
  // may be gone) so the destructive "click again" state can't linger. The
  // timeout covers the other half: a snapshot that keeps its fingerprint (an
  // idle checkout) never fires the effect above, and an armed button left for
  // hours must not execute on a stray click.
  useEffect(() => { setArmedDiscard(null) }, [snapshot])
  useEffect(() => {
    if (armedDiscard === null) return
    const timer = setTimeout(() => setArmedDiscard(null), DISCARD_ARM_MS)
    return () => clearTimeout(timer)
  }, [armedDiscard])
  // The pinned "click again" bubble belongs to the armed state: once the arm
  // expires (timer) or a snapshot disarms it, nothing else would ever take the
  // press-pinned tip down — it would stay over the row describing an action the
  // button no longer performs.
  const armWasArmed = useRef(false)
  useEffect(() => {
    if (armedDiscard !== null) { armWasArmed.current = true; return }
    if (armWasArmed.current) { armWasArmed.current = false; hideTip() }
  }, [armedDiscard, hideTip])
  // Same for the suggest-overwrite confirmation: a fresh snapshot means the
  // message-in-box context may have moved on.
  useEffect(() => { setArmedSuggest(false) }, [snapshot])

  // Batch discard targets: the selected working-tree paths, plus the staged-only
  // picks the confirm dialog reports as unaffected instead of dropping silently.
  const discardTargets = useMemo(() => pickDiscardTargets(selected), [selected])
  // What the confirm will discard: the entry's captured paths when it opened the
  // dialog, else the toolbar's checked set.
  const discardPaths = discardRequest ?? discardTargets.paths
  const discardStagedOnly = discardRequest === null ? discardTargets.stagedOnly : []
  // Batch stage targets: the checked working-tree rows. Index-side picks are
  // already staged and never widen the set; the fresh snapshot retires their
  // `:w` keys, so nothing stale is carried into the next action.
  const stageTargets = useMemo(() => pickStageTargets(selected), [selected])

  // A snapshot that removes every checked row empties the target set; close the
  // dialog rather than letting a stale "open" flag pop it back on the next pick.
  useEffect(() => {
    if (!discardPickedOpen || discardPaths.length > 0) return
    setDiscardPickedOpen(false)
    setDiscardRequest(null)
  }, [discardPickedOpen, discardPaths])

  // A directory whose rows all left the work tree closes its dialog; a partial
  // shrink does not, it just narrows the re-derived path list below — the
  // count the reader confirms is never larger than the action.
  useEffect(() => {
    if (discardDir !== null && discardDirPaths.length === 0) setDiscardDir(null)
  }, [discardDir, discardDirPaths])

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

  // Directory collapse state survives a snapshot (the tree rarely changes shape
  // between polls) but not a repository switch — see the reset effect above.
  const toggleDir = (group: ChangeGroupKey, path: string): void => {
    const key = dirKey(group, path)
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const pickView = (next: ChangeViewMode): void => {
    if (next === viewMode) return
    const prev = viewMode
    setViewMode(next)
    // The write round-trips through the settings service; a failure falls back
    // to the last value the snapshot actually carries.
    void onSetChangesView(next).then((ok) => { if (!ok) setViewMode(prev) })
  }

  // Double-click window guards for the direct remote controls: `run`'s `busy`
  // state lags a synchronous second press by one paint, and two writes must not
  // both fire.
  const pushInFlight = useRef(false)
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
    // Selection keys carry a :s/:w side suffix; commit works on bare paths. A
    // path picked only on its staged side means "commit what is staged": staging
    // it again would fold the unstaged hunks into the commit and undo a partial
    // `git add -p`, so those paths are handed to the host as indexOnly. A
    // working-tree pick (or both sides) covers the whole file either way.
    const sides = new Map<string, { staged: boolean; worktree: boolean }>()
    for (const key of selected) {
      const path = pathOfKey(key)
      const entry = sides.get(path) ?? { staged: false, worktree: false }
      if (sideOf(key) === 's') entry.staged = true
      else entry.worktree = true
      sides.set(path, entry)
    }
    const paths = sides.size > 0 ? [...sides.keys()] : undefined
    const indexOnly = [...sides].filter(([, s]) => s.staged && !s.worktree).map(([path]) => path)
    const ok = await run({
      kind: 'commit',
      message: text,
      ...(paths ? { paths } : {}),
      ...(indexOnly.length > 0 ? { indexOnly } : {}),
      ...(amend ? { amend: true } : {}),
    })
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
  const discardPicked = async (paths: readonly string[]): Promise<void> => {
    if (paths.length === 0) { setDiscardPickedOpen(false); setDiscardRequest(null); return }
    const ok = await run({ kind: 'discard', paths: [...paths] })
    if (ok) { setDiscardPickedOpen(false); setDiscardRequest(null) }
  }
  // Directory discard: the dialog already collected the confirmation, so this
  // is the ordinary batch discard scoped to that directory's work-tree rows —
  // the list is re-derived above, so it is current by construction.
  const discardDirectory = async (): Promise<void> => {
    const paths = discardDirPaths
    if (discardDir === null || paths.length === 0) { setDiscardDir(null); return }
    const ok = await run({ kind: 'discard', paths })
    if (ok) setDiscardDir(null)
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

  const toggleGroup = (key: ChangeGroupKey): void => {
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

  const collapsedNotice = t('changes.untrackedCollapsed')
  const truncatedNotice = t(
    snapshot.truncatedReason === 'lossy'
      ? 'changes.truncatedLossy'
      : snapshot.truncatedReason === 'cap' ? 'changes.truncatedCap' : 'changes.truncatedUnknown',
    { n: snapshot.changes.length },
  )

  // One context for the row dispatch: the tab owns selection, dialogs, queries
  // and the fold state; the row file owns how each row kind presents them.
  // The runs the change / dir / stash menus offer. The panel reads the
  // published object at resolve time (menuCommandsRef), so a fresh one each
  // render keeps the closures current without re-registering anything.
  const changesMenuCommands: ChangesMenuCommands = {
    openDiff: (path, staged) => showDiff(path, staged ? 'staged' : 'worktree'),
    stage: (paths, staged) => { void run({ kind: staged ? 'unstage' : 'stage', paths: [...paths] }) },
    // The toolbar's own path into the batch-discard dialog, with the entry's
    // captured paths standing in for the checked set: the confirm then lists
    // exactly what the gesture named (and cannot open over an empty pick).
    openDiscard: (paths) => {
      if (paths.length === 0) return
      setError(null)
      setDiscardRequest([...paths].sort())
      setDiscardPickedOpen(true)
    },
    stashApply: (sha) => { const s = stashes.find((it) => it.sha === sha); if (s !== undefined) stashApply(s.index, sha) },
    stashPop: (sha) => { const s = stashes.find((it) => it.sha === sha); if (s !== undefined) stashPop(s.index, sha) },
    openStashDrop: (sha) => { const s = stashes.find((it) => it.sha === sha); if (s !== undefined) { setError(null); setStashDrop(s) } },
  }
  if (menuCommandsRef !== undefined) menuCommandsRef.current = changesMenuCommands
  if (menuFactsRef !== undefined) menuFactsRef.current = { busy }
  if (menuPickRef !== undefined) menuPickRef.current = selected

  // Row binders: the row supplies its own fields, the panel adds the identity at
  // gesture time (use-panel-menu.ts).
  const menuRow = panelMenu === undefined
    ? undefined
    : (value: { path: string; staged: boolean }) => panelMenu.bind(MENU_KIND.change, value)
  const menuDir = panelMenu === undefined
    ? undefined
    : (value: { path: string; staged: boolean; paths: readonly string[]; discardable: readonly string[] }) =>
      panelMenu.bind(MENU_KIND.changeDir, value)
  const menuStash = panelMenu === undefined
    ? undefined
    : (value: { sha: string; label: string }) => panelMenu.bind(MENU_KIND.stash, value)

  const rowCtx: ChangeRowCtx = {
    showDir: viewMode === 'flat',
    selected,
    activePath: diffPath?.path ?? null,
    activeBase: diffPath?.base ?? null,
    busy,
    armedDiscard,
    t,
    tipProps,
    hideTip,
    showTipNow,
    onToggleGroup: toggleGroup,
    onToggleDir: toggleDir,
    onPick: toggleGroupPick,
    onToggleRow: toggle,
    onOpenRow: openDiff,
    onStageRow: (c) => { void run(c.staged ? { kind: 'unstage', paths: [c.path] } : { kind: 'stage', paths: [c.path] }) },
    onDiscardRow: (rowKey, detail) => {
      // Two presses confirm. A double click delivers its second press with
      // `detail > 1` inside one gesture, and that press must not count as the
      // confirmation — for an untracked path it deletes the file. A deliberate
      // second click always reports detail 1.
      if (detail > 1) return false
      if (armedDiscard === rowKey) {
        void run({ kind: 'discard', paths: [pathOfKey(rowKey)] })
        setArmedDiscard(null)
        return false
      }
      setArmedDiscard(rowKey)
      return true
    },
    onStageDir: (action) => { void run(action) },
    ...(menuRow === undefined ? {} : { menuRow }),
    ...(menuDir === undefined ? {} : { menuDir }),
    onOpenDirDiscard: (group, path) => { setError(null); setDiscardDir({ group, path }) },
  }

  const leftChildren = [
    // The same docked list the overview shows (one shared collapse state), so
    // switching repositories is one click away from this pane too.
    repositories === undefined ? null : h(ReposSection, { key: 'repos', choices: repositories.choices, current: repositories.current, snapshot, onChoose: repositories.onChoose, collapsed: repositories.collapsed ?? false, onToggleCollapse: repositories.onToggleCollapse, rowMenu: repositories.rowMenu, workspaceHint: repositories.workspaceHint, onEnableWorkspace: repositories.onEnableWorkspace, workspaceEnabling: repositories.workspaceEnabling, t }),
    h(ChangeStats, { key: 'stats', stats: snapshot.stats, compact, showTimes: !cramped, t }),
    h(ChangesToolbar, {
      key: 'toolbar', snapshot, busy, hasDiscardTargets: discardTargets.paths.length > 0,
      stageTargets, viewMode, onPickView: pickView,
      onStagePicked: (paths) => { if (paths.length > 0) void run({ kind: 'stage', paths: [...paths] }) },
      onStageAll: () => void run({ kind: 'stage-all' }),
      onUnstageAll: () => void run({ kind: 'unstage-all' }),
      onDiscard: () => { setError(null); setDiscardRequest(null); setDiscardPickedOpen(true) },
      onDiscardAll: () => { setError(null); setDiscardAllOpen(true) },
      onStash: () => { setError(null); setStashPushOpen(true) },
      // Push runs straight from the toolbar: it is a fast-forward-only push
      // (the host refuses otherwise), so `run`'s busy guard + inline error
      // banner are all the ceremony it needs.
      // The ref closes the double-click window before React paints `busy`:
      // two synchronous presses must send exactly one push.
      onPush: () => {
        hideTip()
        if (pushInFlight.current || !canPush(snapshot)) return
        pushInFlight.current = true
        void run({ kind: 'push' }).finally(() => { pushInFlight.current = false })
      },
      // Config-only, but always asks which remote to attach (even with one
      // candidate). The modal re-checks the snapshot and owns the busy lock.
      onSetUpstream: () => {
        hideTip()
        if (!canSetUpstream(snapshot)) return
        setSetUpstreamOpen(true)
      },
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
            items.slice(first, last).map((it, k) => renderChangeRow(it, rowCtx, tops[first + k]))),
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
              // The flag follows the promise, not the click: a failed expand
              // must not leave the bar claiming the whole list is loaded (and
              // the rejection must not surface as an unhandled one).
              void (next ? expandList() : collapseList())
                .then(() => setListExpanded(next))
                .catch(() => setError(t('error.generic')))
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
        ...(menuStash === undefined ? {} : { menu: menuStash }),
        t,
      }))),
    ]) : null,
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
    publishOpen ? h(PublishModal, { key: 'remote-publish', snapshot, onAction, onClose: () => setPublishOpen(false), onBusyChange: setPublishBusy, t }) : null,
    setUpstreamOpen ? h(SetUpstreamModal, { key: 'remote-set-upstream', snapshot, onAction, onClose: () => setSetUpstreamOpen(false), onBusyChange: setSetUpstreamBusy, t }) : null,
    stashPushOpen ? h(StashPushModal, { key: 'push', onClose: () => setStashPushOpen(false), onStash: stashPush, error, t }) : null,
    stashDrop !== null ? renderConfirmModal({
      title: t('stash.dropTitle'),
      body: t('stash.dropConfirm', { name: stashDrop.message }),
      confirmLabel: t('stash.drop'),
      danger: true,
      error,
      // A drop is unrecoverable: the dialog must stay (and keep its error line)
      // until the write settles.
      confirmBusy: busy,
      busyLabel: t('stash.dropping'),
      onConfirm: () => void stashDropConfirmed(stashDrop.index, stashDrop.sha),
      onClose: () => setStashDrop(null),
      t,
    }) : null,
    discardPickedOpen && discardPaths.length > 0
      ? h(DiscardPickedModal, {
        key: 'discard-picked',
        paths: discardPaths,
        stagedOnly: discardStagedOnly,
        snapshot,
        busy,
        error,
        onConfirm: () => void discardPicked(discardPaths),
        onClose: () => { setDiscardPickedOpen(false); setDiscardRequest(null) },
        t,
      })
      : null,
    // A directory's discard reuses that dialog: same counts, same untracked
    // warning, only the title names the scope instead of "selected changes".
    // The paths are re-derived every render, so the count the dialog shows is
    // exactly what confirming sends.
    discardDir !== null && discardDirPaths.length > 0
      ? h(DiscardPickedModal, {
        key: 'discard-dir',
        title: t('changes.discardDirTitle', { name: discardDir.path }),
        paths: discardDirPaths,
        stagedOnly: [],
        snapshot,
        busy,
        error,
        onConfirm: () => void discardDirectory(),
        onClose: () => setDiscardDir(null),
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
