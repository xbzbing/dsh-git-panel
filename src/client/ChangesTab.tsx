/**
 * Changes tab: stats bar + uncommitted change list (checkboxes) + commit box
 * (with Amend) on the left; the selected file's diff on the right.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GitPanelRemote } from './rpc'
import { queryAs } from './rpc'
import type { GitAction, GitChange, GitErrorCode, GitSnapshot, StashEntry } from './types'
import type { GitKey } from './locales'
import { ChangeStats } from './ChangeStats'
import { DiffView, diffSummary, type DiffMode } from './DiffView'
import { ArrowLeftIcon, ChevronIcon, SparkleIcon, StashIcon, TrashIcon } from './icons'
import { statusChar, statusClass } from './status'
import { useResizableColumn } from './resizable'
import { segButtons } from './seg'
import { renderAiHint, renderConfirmModal, renderModalFooter, renderModalShell } from './ops-modals'

interface ChangesTabProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly snapshot: GitSnapshot
  readonly onAction: (action: GitAction) => Promise<{ ok: boolean; error?: string }>
  /** Compact (single-column drill-in) layout for a narrow panel. */
  readonly compact: boolean
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type GroupKey = 'staged' | 'unstaged' | 'untracked'

export function ChangesTab({ remote, sessionId, snapshot, onAction, compact, t }: ChangesTabProps): JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState<ReadonlySet<GroupKey>>(new Set())
  const [armedDiscard, setArmedDiscard] = useState<string | null>(null)
  const [diffPath, setDiffPath] = useState<{ path: string; base: 'worktree' | 'staged' } | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>(() => snapshot.defaultDiffView)
  const [expanded, setExpanded] = useState(false)
  const [amendPrefilled, setAmendPrefilled] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [armedSuggest, setArmedSuggest] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // Compact drill-in: 'list' shows the change list + commit box, 'diff' the
  // selected file's diff. Ignored by the wide layout (both columns at once).
  const [pane, setPane] = useState<'list' | 'diff'>('list')
  // Stash stack (queried on demand), its collapse state, the push dialog, and
  // the drop-confirm target index.
  const [stashes, setStashes] = useState<readonly StashEntry[]>([])
  const [stashClosed, setStashClosed] = useState(true)
  const [stashPushOpen, setStashPushOpen] = useState(false)
  const [stashDrop, setStashDrop] = useState<StashEntry | null>(null)
  const msgRef = useRef<HTMLTextAreaElement | null>(null)
  const diffSeq = useRef(0)

  const loadStashes = useCallback(async () => {
    const res = await remote.query({ sessionId, query: { kind: 'stash-list' } })
    const sl = queryAs(res, 'stash-list')
    setStashes(sl?.entries ?? [])
  }, [remote, sessionId])

  // Reload the stash list whenever the snapshot advances (a push/pop changes the
  // work tree and bumps checkedAt) and on first mount.
  useEffect(() => { void loadStashes() }, [loadStashes, snapshot.checkedAt])

  const staged = useMemo(() => snapshot.changes.filter((c) => c.staged).sort(byPath), [snapshot])
  const unstaged = useMemo(() => snapshot.changes.filter((c) => !c.staged && c.status !== 'untracked').sort(byPath), [snapshot])
  const untracked = useMemo(() => snapshot.changes.filter((c) => c.status === 'untracked').sort(byPath), [snapshot])

  const allGroups: Array<{ key: GroupKey; labelKey: GitKey; items: GitChange[] }> = [
    { key: 'staged', labelKey: 'changes.groupStaged', items: staged },
    { key: 'unstaged', labelKey: 'changes.groupUnstaged', items: unstaged },
    { key: 'untracked', labelKey: 'changes.groupUntracked', items: untracked },
  ]
  const groups = allGroups.filter((g) => g.items.length > 0)

  // Prune selection to living paths (avoid a stale path aborting a commit).
  // Selection keys are `path:s`/`path:w`; a key survives only if a change with
  // that path and side still exists.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set(snapshot.changes.map((c) => c.path + (c.staged ? ':s' : ':w')))
      const next = new Set<string>()
      let changed = false
      for (const k of prev) { if (alive.has(k)) next.add(k); else changed = true }
      return changed ? next : prev
    })
  }, [snapshot])

  // Prefill amend message from the last commit when the box is toggled on empty.
  useEffect(() => {
    if (!amend || amendPrefilled || message.trim() !== '') return
    let alive = true
    void remote.query({ sessionId, query: { kind: 'last-commit-message' } }).then((res) => {
      const msg = queryAs(res, 'last-commit-message')
      if (alive && msg !== null) {
        setMessage(msg.message)
        setAmendPrefilled(true)
      }
    })
    return () => { alive = false }
  }, [amend, amendPrefilled, message, remote, sessionId])

  const showDiff = useCallback(async (path: string, base: 'worktree' | 'staged', expand = false, keepPrevious = false) => {
    const seq = ++diffSeq.current
    setDiffPath({ path, base })
    // Only blank the pane on a user-initiated open; a background re-pull keeps
    // the current text so a poll/snapshot tick doesn't flash "Loading".
    if (!keepPrevious) setDiffText(null)
    setExpanded(expand)
    const res = await remote.query({ sessionId, query: { kind: 'diff', path, base, ...(expand ? { context: 100000 } : {}) } })
    if (seq !== diffSeq.current) return
    const diff = queryAs(res, 'diff')
    if (diff !== null) setDiffText(diff.text)
    else setDiffText('')
  }, [remote, sessionId])

  // Re-pull the open diff after snapshot changes (content may have shifted);
  // keep the old text visible during the refetch to avoid a Loading flash.
  useEffect(() => {
    if (diffPath === null) return
    const stillThere = snapshot.changes.some((c) => c.path === diffPath.path)
    if (!stillThere) { setDiffPath(null); setDiffText(null); setPane('list'); return }
    void showDiff(diffPath.path, diffPath.base, expanded, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot])

  // Disarm a pending discard confirmation when the snapshot changes (the row
  // may be gone) so the destructive "click again" state can't linger.
  useEffect(() => { setArmedDiscard(null) }, [snapshot])
  // Same for the suggest-overwrite confirmation: a fresh snapshot means the
  // message-in-box context may have moved on.
  useEffect(() => { setArmedSuggest(false) }, [snapshot])

  const toggle = (path: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
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
    const paths = selected.size > 0 ? [...new Set([...selected].map((k) => k.replace(/:[sw]$/, '')))] : undefined
    const ok = await run({ kind: 'commit', message: text, ...(paths ? { paths } : {}), ...(amend ? { amend: true } : {}) })
    if (ok) { setMessage(''); setSelected(new Set()); setAmend(false); setAmendPrefilled(false) }
  }

  // Stash: push the current changes (optional message), then apply / pop / drop
  // stack entries. The snapshot-driven effect reloads the list, but push/drop
  // also reload immediately so the dialog closes against a fresh stack.
  const stashPush = async (message: string): Promise<void> => {
    const ok = await run({ kind: 'stash-push', ...(message.trim() !== '' ? { message } : {}) })
    if (ok) { setStashPushOpen(false); void loadStashes() }
  }
  const stashApply = (index: number, sha: string): void => { void run({ kind: 'stash-apply', index, sha }).then((ok) => { if (ok) void loadStashes() }) }
  const stashPop = (index: number, sha: string): void => { void run({ kind: 'stash-pop', index, sha }).then((ok) => { if (ok) void loadStashes() }) }
  const stashDropConfirmed = async (index: number, sha: string): Promise<void> => {
    const ok = await run({ kind: 'stash-drop', index, sha })
    if (ok) { setStashDrop(null); void loadStashes() }
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
    const paths = selected.size > 0 ? [...new Set([...selected].map((k) => k.replace(/:[sw]$/, '')))] : undefined
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

  const summary = diffText !== null && diffText !== '' ? diffSummary(diffText) : null

  // The left change-list column is drag-resizable; the right diff column takes
  // the rest. Width persists across mounts.
  const leftCol = useResizableColumn({ storageKey: 'gp.changes.left', initial: 380, min: 220, reserve: 200, edge: 'end' })

  // Open a file's diff; in compact drill into the diff pane.
  const openDiff = (path: string, base: 'worktree' | 'staged'): void => {
    void showDiff(path, base)
    if (compact) setPane('diff')
  }

  // Compact drops side-by-side (no room) and renders split as unified instead.
  const diffModes: DiffMode[] = compact ? ['unified', 'before', 'after'] : ['unified', 'split', 'before', 'after']
  const effDiffMode: DiffMode = compact && diffMode === 'split' ? 'unified' : diffMode

  const leftChildren = [
    h(ChangeStats, { key: 'stats', stats: snapshot.stats, t }),
    h('div', { key: 'toolbar', className: 'gp-toolbar' }, [
      h('button', { key: 'sa', type: 'button', className: 'gp-btn', disabled: busy || snapshot.changes.length === 0, onClick: () => void run({ kind: 'stage-all' }) }, t('changes.stageAll')),
      h('button', { key: 'ua', type: 'button', className: 'gp-btn', disabled: busy || snapshot.staged === 0, onClick: () => void run({ kind: 'unstage-all' }) }, t('changes.unstageAll')),
      h('button', { key: 'stash', type: 'button', className: 'gp-btn', disabled: busy || (snapshot.staged === 0 && snapshot.modified === 0), title: t('changes.stash'), onClick: () => { setError(null); setStashPushOpen(true) } }, [h(StashIcon, { key: 'ic', size: 13 }), t('changes.stash')]),
    ]),
    error !== null ? h('div', { key: 'err', className: 'gp-feedback' }, error) : null,
    notice !== null ? h('div', { key: 'notice', className: 'gp-notice' }, notice) : null,
    h('div', { key: 'list', className: 'gp-changes__list' },
      snapshot.changes.length === 0
        ? h('div', { className: 'gp-empty' }, t('changes.noChanges'))
        : groups.map((g) => h('div', { key: g.key }, [
          h('div', { key: 'head', className: 'gp-group-head', onClick: () => toggleGroup(g.key) }, [
            h(ChevronIcon, { key: 'chev', size: 12, open: !closed.has(g.key) }),
            `${t(g.labelKey)} (${g.items.length})`,
          ]),
          closed.has(g.key) ? null : g.items.map((c) => {
            // A path staged AND modified appears in two rows; key selection /
            // active / armed by path+side so acting on one row doesn't light
            // up the other (React key on the row is already path+side).
            const rowKey = c.path + (c.staged ? ':s' : ':w')
            return renderFileRow(c, {
              selected: selected.has(rowKey),
              active: diffPath?.path === c.path && diffPath.base === (c.staged ? 'staged' : 'worktree'),
              busy,
              armed: armedDiscard === rowKey,
              onToggle: () => toggle(rowKey),
              onOpen: () => openDiff(c.path, c.staged ? 'staged' : 'worktree'),
              onStage: () => void run(c.staged ? { kind: 'unstage', paths: [c.path] } : { kind: 'stage', paths: [c.path] }),
              onDiscard: () => {
                if (armedDiscard === rowKey) { void run({ kind: 'discard', paths: [c.path] }); setArmedDiscard(null) }
                else setArmedDiscard(rowKey)
              },
              t,
            })
          }),
        ]))),
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
    // commit box
    h('div', { key: 'box', className: 'gp-commitbox' }, [
      h('textarea', {
        key: 'msg',
        className: 'gp-commitbox__msg',
        placeholder: t('commit.placeholder'),
        value: message,
        ref: msgRef,
        onChange: (e: { target: { value: string } }) => setMessage(e.target.value),
      }),
      h('div', { key: 'row', className: 'gp-commitbox__row' }, [
        h('label', { key: 'amend', className: 'gp-commitbox__amend' }, [
          h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: amend, onChange: () => { setAmend((v) => !v); setAmendPrefilled(false) } }),
          t('commit.amend'),
        ]),
        h('div', { key: 'actions', className: 'gp-commitbox__actions' }, [
          snapshot.suggestEnabled !== false
            ? h('button', {
              key: 'suggest', type: 'button', className: 'gp-btn',
              disabled: busy || suggesting || snapshot.changes.length === 0,
              onClick: () => void suggest(),
              title: t('commit.suggest'),
            }, [h(SparkleIcon, { key: 'ic', size: 13 }), suggesting ? t('commit.suggesting') : t('commit.suggest')])
            : null,
          h('button', { key: 'commit', type: 'button', className: 'gp-btn gp-btn--primary', disabled: busy || suggesting || message.trim() === '', onClick: () => void commit() }, t('commit.commit')),
        ]),
      ]),
    ]),
  ]

  const diffBlock = diffPath === null
    ? h('div', { className: 'gp-empty' }, t('changes.selectFile'))
    : h('div', { className: 'gp-diff' }, [
      h('div', { key: 'tb', className: 'gp-diff__toolbar' }, [
        compact ? h('button', { key: 'back', type: 'button', className: 'gp-subhead__back', onClick: () => setPane('list') }, [h(ArrowLeftIcon, { key: 'i', size: 14 }), t('changes.backToList')]) : null,
        h('span', { key: 'path', className: 'gp-diff__path' }, diffPath.path),
        summary ? h('span', { key: 'sum', className: 'gp-stats__item', style: { marginLeft: 'auto' } }, [
          h('span', { key: 'a', className: 'gp-stats__add' }, `+${summary.add}`), ' ',
          h('span', { key: 'd', className: 'gp-stats__del' }, `\u2212${summary.del}`),
        ]) : null,
        h('button', {
          key: 'expand', type: 'button',
          className: `gp-seg__btn gp-diff__expand${expanded ? ' gp-seg__btn--active' : ''}`,
          style: summary ? {} : { marginLeft: 'auto' },
          disabled: effDiffMode !== 'split' && effDiffMode !== 'unified',
          title: t(expanded ? 'diff.collapse' : 'diff.expandAll'),
          onClick: () => void showDiff(diffPath.path, diffPath.base, !expanded),
        }, t(expanded ? 'diff.collapse' : 'diff.expandAll')),
        h('div', { key: 'seg', className: 'gp-seg' },
          segButtons<DiffMode>(diffModes, effDiffMode, setDiffMode, (m) => t(`diff.${m}` as GitKey))),
      ]),
      h('div', { key: 'scroll', className: 'gp-diff__scroll' },
        diffText === null ? h('div', { className: 'gp-empty' }, t('common.loading')) : h(DiffView, { text: diffText, mode: effDiffMode, path: diffPath.path, remote, sessionId, imageSpec: { base: diffPath.base }, t })),
    ])

  // Stash dialogs (push + drop confirm), portaled; included in both layouts.
  const stashModals: (JSX.Element | null)[] = [
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
  ]

  // Compact: a single column drilling from the change list into the diff.
  if (compact) {
    return h('div', { className: 'gp-changes gp-changes--compact' }, [
      ...stashModals,
      pane === 'diff'
        ? h('div', { key: 'right', className: 'gp-changes__right' }, diffBlock)
        : h('div', { key: 'left', className: 'gp-changes__left' }, leftChildren),
    ])
  }

  return h('div', { className: 'gp-changes' }, [
    ...stashModals,
    // left
    h('div', { key: 'left', className: 'gp-changes__left', style: { flex: `0 0 ${leftCol.width}px` } }, leftChildren),
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
  t: (key: GitKey, params?: Record<string, string | number>) => string
}

function renderFileRow(c: GitChange, a: RowActions): JSX.Element {
  const name = c.path.split('/').pop() ?? c.path
  const dir = c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : ''
  return h('div', { key: c.path + (c.staged ? ':s' : ':w'), className: `gp-file-row${a.active ? ' gp-file-row--active' : ''}`, onClick: a.onOpen }, [
    h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: a.selected, onClick: (e: Event) => e.stopPropagation(), onChange: a.onToggle }),
    h('span', { key: 'st', className: `gp-status-badge ${statusClass(c.status)}` }, statusChar[c.status] ?? '?'),
    h('span', { key: 'nm', className: 'gp-tree-name', title: c.path }, [name, dir ? h('span', { key: 'd', style: { color: 'var(--dsw-alias-label-tertiary)', marginLeft: 6, fontSize: 11 } }, dir) : null]),
    h('span', { key: 'act', className: 'gp-file-row__actions' }, [
      h('button', { key: 'stg', type: 'button', className: 'gp-icon-btn', title: c.staged ? a.t('changes.unstage') : a.t('changes.stage'), disabled: a.busy, onClick: (e: Event) => { e.stopPropagation(); a.onStage() } }, c.staged ? '\u2212' : '+'),
      h('button', { key: 'dis', type: 'button', className: 'gp-icon-btn', title: a.armed ? a.t('changes.discardConfirm') : a.t('changes.discard'), style: a.armed ? { color: 'var(--dsw-alias-state-error-primary)' } : {}, disabled: a.busy, onClick: (e: Event) => { e.stopPropagation(); a.onDiscard() } }, '\u21ba'),
    ]),
  ])
}
