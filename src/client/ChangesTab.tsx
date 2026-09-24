/**
 * Changes tab: stats bar + uncommitted change list (checkboxes) + commit box
 * (with Amend) on the left; the selected file's diff on the right.
 */
import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { GitPanelRemote } from './rpc'
import type { GitAction, GitChange, GitSnapshot } from './types'
import type { GitKey } from './locales'
import { ChangeStats } from './ChangeStats'
import { DiffView, diffSummary, type DiffMode } from './DiffView'
import { ChevronIcon } from './icons'

interface ChangesTabProps {
  readonly remote: GitPanelRemote
  readonly sessionId: string
  readonly snapshot: GitSnapshot
  readonly refreshKey: number
  readonly onAction: (action: GitAction) => Promise<{ ok: boolean; error?: string }>
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

type GroupKey = 'staged' | 'unstaged' | 'untracked'

const statusChar: Record<string, string> = {
  added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: '!', typechange: 'T',
}

function statusClass(status: string): string {
  if (status === 'added' || status === 'untracked') return 'gp-status--added'
  if (status === 'deleted') return 'gp-status--deleted'
  if (status === 'renamed') return 'gp-status--renamed'
  return 'gp-status--modified'
}

export function ChangesTab({ remote, sessionId, snapshot, refreshKey, onAction, t }: ChangesTabProps): JSX.Element {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState<ReadonlySet<GroupKey>>(new Set())
  const [armedDiscard, setArmedDiscard] = useState<string | null>(null)
  const [diffPath, setDiffPath] = useState<{ path: string; base: 'worktree' | 'staged' } | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>('split')
  const [amendPrefilled, setAmendPrefilled] = useState(false)

  const staged = useMemo(() => snapshot.changes.filter((c) => c.staged).sort(byPath), [snapshot])
  const unstaged = useMemo(() => snapshot.changes.filter((c) => !c.staged && c.status !== 'untracked').sort(byPath), [snapshot])
  const untracked = useMemo(() => snapshot.changes.filter((c) => c.status === 'untracked').sort(byPath), [snapshot])

  const groups: Array<{ key: GroupKey; labelKey: GitKey; items: GitChange[] }> = [
    { key: 'staged' as GroupKey, labelKey: 'changes.groupStaged' as GitKey, items: staged },
    { key: 'unstaged' as GroupKey, labelKey: 'changes.groupUnstaged' as GitKey, items: unstaged },
    { key: 'untracked' as GroupKey, labelKey: 'changes.groupUntracked' as GitKey, items: untracked },
  ].filter((g) => g.items.length > 0)

  // Prune selection to living paths (avoid a stale path aborting a commit).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const alive = new Set(snapshot.changes.map((c) => c.path))
      const next = new Set<string>()
      let changed = false
      for (const p of prev) { if (alive.has(p)) next.add(p); else changed = true }
      return changed ? next : prev
    })
  }, [snapshot])

  // Prefill amend message from the last commit when the box is toggled on empty.
  useEffect(() => {
    if (!amend || amendPrefilled || message.trim() !== '') return
    let alive = true
    void remote.query({ sessionId, query: { kind: 'last-commit-message' } }).then((res) => {
      if (alive && res.ok && res.value.kind === 'last-commit-message') {
        setMessage(res.value.message)
        setAmendPrefilled(true)
      }
    })
    return () => { alive = false }
  }, [amend, amendPrefilled, message, remote, sessionId])

  const showDiff = useCallback(async (path: string, base: 'worktree' | 'staged') => {
    setDiffPath({ path, base })
    setDiffText(null)
    const res = await remote.query({ sessionId, query: { kind: 'diff', path, base } })
    if (res.ok && res.value.kind === 'diff') setDiffText(res.value.text)
    else setDiffText('')
  }, [remote, sessionId])

  // Re-pull the open diff after snapshot changes (content may have shifted).
  useEffect(() => {
    if (diffPath === null) return
    const stillThere = snapshot.changes.some((c) => c.path === diffPath.path)
    if (!stillThere) { setDiffPath(null); setDiffText(null); return }
    void showDiff(diffPath.path, diffPath.base)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot])

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
    const result = await onAction(action)
    setBusy(false)
    if (!result.ok) { setError(result.error ?? t('error.generic')); return false }
    return true
  }

  const commit = async (): Promise<void> => {
    const text = message.trim()
    if (text === '' && !amend) { setError(t('error.emptyMessage')); return }
    const paths = selected.size > 0 ? [...selected] : undefined
    const ok = await run({ kind: 'commit', message: text, ...(paths ? { paths } : {}), ...(amend ? { amend: true } : {}) })
    if (ok) { setMessage(''); setSelected(new Set()); setAmend(false); setAmendPrefilled(false) }
  }

  const toggleGroup = (key: GroupKey): void => {
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const summary = diffText !== null && diffText !== '' ? diffSummary(diffText) : null

  return h('div', { className: 'gp-changes' }, [
    // left
    h('div', { key: 'left', className: 'gp-changes__left' }, [
      h(ChangeStats, { key: 'stats', remote, sessionId, refreshKey, t }),
      h('div', { key: 'toolbar', className: 'gp-toolbar' }, [
        h('button', { key: 'sa', type: 'button', className: 'gp-btn', disabled: busy || snapshot.changes.length === 0, onClick: () => void run({ kind: 'stage-all' }) }, t('changes.stageAll')),
        h('button', { key: 'ua', type: 'button', className: 'gp-btn', disabled: busy || snapshot.staged === 0, onClick: () => void run({ kind: 'unstage-all' }) }, t('changes.unstageAll')),
      ]),
      error !== null ? h('div', { key: 'err', className: 'gp-feedback' }, error) : null,
      h('div', { key: 'list', className: 'gp-changes__list' },
        snapshot.changes.length === 0
          ? h('div', { className: 'gp-empty' }, t('changes.noChanges'))
          : groups.map((g) => h('div', { key: g.key }, [
            h('div', { key: 'head', className: 'gp-group-head', onClick: () => toggleGroup(g.key) }, [
              h(ChevronIcon, { key: 'chev', size: 12, open: !closed.has(g.key) }),
              `${t(g.labelKey)} (${g.items.length})`,
            ]),
            closed.has(g.key) ? null : g.items.map((c) => renderFileRow(c, {
              selected: selected.has(c.path),
              active: diffPath?.path === c.path,
              busy,
              armed: armedDiscard === c.path,
              onToggle: () => toggle(c.path),
              onOpen: () => void showDiff(c.path, c.staged ? 'staged' : 'worktree'),
              onStage: () => void run(c.staged ? { kind: 'unstage', paths: [c.path] } : { kind: 'stage', paths: [c.path] }),
              onDiscard: () => {
                if (armedDiscard === c.path) { void run({ kind: 'discard', paths: [c.path] }); setArmedDiscard(null) }
                else setArmedDiscard(c.path)
              },
              t,
            })),
          ]))),
      // commit box
      h('div', { key: 'box', className: 'gp-commitbox' }, [
        h('textarea', {
          key: 'msg',
          className: 'gp-commitbox__msg',
          placeholder: t('commit.placeholder'),
          value: message,
          onChange: (e: { target: { value: string } }) => setMessage(e.target.value),
        }),
        h('div', { key: 'row', className: 'gp-commitbox__row' }, [
          h('label', { key: 'amend', className: 'gp-commitbox__amend' }, [
            h('input', { key: 'cb', type: 'checkbox', className: 'gp-check', checked: amend, onChange: () => { setAmend((v) => !v); setAmendPrefilled(false) } }),
            t('commit.amend'),
          ]),
          h('div', { key: 'actions', className: 'gp-commitbox__actions' }, [
            h('button', { key: 'commit', type: 'button', className: 'gp-btn gp-btn--primary', disabled: busy, onClick: () => void commit() }, t('commit.commit')),
          ]),
        ]),
      ]),
    ]),
    // right diff
    h('div', { key: 'right', className: 'gp-changes__right' },
      diffPath === null
        ? h('div', { className: 'gp-empty' }, t('changes.selectFile'))
        : h('div', { className: 'gp-diff' }, [
          h('div', { key: 'tb', className: 'gp-diff__toolbar' }, [
            h('span', { key: 'path', className: 'gp-diff__path' }, diffPath.path),
            summary ? h('span', { key: 'sum', className: 'gp-stats__item', style: { marginLeft: 'auto' } }, [
              h('span', { key: 'a', className: 'gp-stats__add' }, `+${summary.add}`), ' ',
              h('span', { key: 'd', className: 'gp-stats__del' }, `\u2212${summary.del}`),
            ]) : null,
            h('div', { key: 'seg', className: 'gp-seg', style: summary ? {} : { marginLeft: 'auto' } }, (['split', 'before', 'after'] as DiffMode[]).map((m) =>
              h('button', { key: m, type: 'button', className: `gp-seg__btn${diffMode === m ? ' gp-seg__btn--active' : ''}`, onClick: () => setDiffMode(m) }, t(`diff.${m}` as GitKey)))),
          ]),
          h('div', { key: 'scroll', className: 'gp-diff__scroll' },
            diffText === null ? h('div', { className: 'gp-empty' }, t('common.loading')) : h(DiffView, { text: diffText, mode: diffMode, t })),
        ])),
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
      h('button', { key: 'stg', type: 'button', className: 'gp-icon-btn', title: c.staged ? a.t('changes.unstageAll') : a.t('changes.stageAll'), disabled: a.busy, onClick: (e: Event) => { e.stopPropagation(); a.onStage() } }, c.staged ? '\u2212' : '+'),
      h('button', { key: 'dis', type: 'button', className: 'gp-icon-btn', title: a.armed ? a.t('changes.discardConfirm') : a.t('changes.discard'), style: a.armed ? { color: 'var(--dsw-alias-state-error-primary)' } : {}, disabled: a.busy, onClick: (e: Event) => { e.stopPropagation(); a.onDiscard() } }, '\u21ba'),
    ]),
  ])
}
