/**
 * Repository list of the Git panel.
 *
 * The panes of the panel act on exactly one checkout; the panel docks this
 * list above the overview's branch tree and at the top of the changes column,
 * so picking one keeps the branches, the commit list, the change list and the
 * list itself on screen together. Rows are
 * compact — the column is narrow — one line for the name (with the checkout's
 * branch chip and the change count at the right) and one for the badges and
 * the path. The block also states the current checkout's absolute path
 * outright, click-to-copy; each row hovers to a tip that stacks what the row
 * elides — disabled reason, branch, absolute root — one line each. The block
 * boots collapsed; its head line names the checkout in use.
 *
 * One rule governs what a row prints: **state on a row may only come from data
 * that row itself was sampled with.** The one snapshot the panel holds belongs
 * to the checked row; every other row may show only what the repository list
 * carries for it — for a worktree that includes its branch (git reports it for
 * free), for a scanned foreign repository nothing until it is checked.
 */
import { createElement as h, useId, useMemo, useRef } from 'react'
import type { JSX } from 'react'
import { BranchIcon, CheckIcon, ChevronIcon, CloseIcon, CopyIcon, RepoIcon, SearchIcon, SparkleIcon, WorktreeIcon } from './icons.js'
import type { RepoChoice, RepoGroup } from './repo-list.js'
import { repoDetail, repoDisabledKey, repoGroups, repoLabel, repoRowTip } from './repo-list.js'
import { filterRepoChoices, repoSearchDetail, repoSearchHighlight, repoSearchTokens } from './repo-search.js'
import type { RepoSearchSegment } from './repo-search.js'
import { repoTipContent } from './repo-tip.js'
import { useCopyFeedback } from './copy-feedback.js'
import { useRowSlider } from './row-slider.js'
import { inertAttr } from './inert.js'
import { baseName } from './path-name.js'
import { workspaceInvalidKey } from './workspace-hint.js'
import { useHoverTip } from './tip.js'
import { rtlPathText } from './rtl-path.js'
import type { GitRepoList, GitSnapshot } from './types.js'
import type { GitKey } from './locales.js'

/** One line as hit / plain runs; without a query the plain string, so the
 * unfiltered rows keep their exact markup. */
function renderRuns(text: string, segments: readonly RepoSearchSegment[] | null): (string | JSX.Element)[] | string {
  if (segments === null) return text
  return segments.map((segment, index) => segment.hit
    ? h('mark', { key: index, className: 'gp-repolist__hit' }, segment.text)
    : segment.text)
}

/** The docked list block as the panel hands it to a pane — the overview's left
 * column and the changes column share one, so the collapse state and the
 * choice wiring stay in sync across panes. */
export interface RepositoriesHost {
  readonly choices: readonly RepoChoice[]
  /** Request tag of the checkout the panes act on ('' = cwd). */
  readonly current: string
  readonly onChoose: (path: string) => void
  /** Collapsed head of the block; the panel owns the state so it survives
   * switching panes. */
  readonly collapsed?: boolean
  readonly onToggleCollapse?: () => void
  /** Right-click props for one row (absent on hosts without context menus, and
   * on a row that cannot be chosen). */
  readonly rowMenu?: (choice: RepoChoice) => Record<string, unknown>
  /** Recognition state of the session's `.code-workspace` file. `available`
   * means the setting is off but the cwd holds one: the block offers to turn it
   * on from the row instead of leaving the feature undiscoverable (ADR-0035). */
  readonly workspaceHint?: GitRepoList['codeWorkspace']
  /** Turn the setting on for the plugin; absent when the settings service is
   * unreachable. The write is plugin-wide, which the row says in its text. */
  readonly onEnableWorkspace?: () => void
  /** That write is in flight (the row's action reports it). */
  readonly workspaceEnabling?: boolean
  /** That write was refused by the settings service. The row keeps the offer
   * and states the failure: a click that changes nothing reads as a dead
   * control otherwise. */
  readonly workspaceFailed?: boolean
  /** Live search text over the listed rows (issue #161). Owned by the panel so
   * it survives switching panes; an empty string shows the whole list. */
  readonly query?: string
  readonly onQueryChange?: (query: string) => void
}

interface ReposSectionProps {
  readonly choices: readonly RepoChoice[]
  /** Request tag of the checkout the panes currently act on ('' = cwd). */
  readonly current: string
  /** Snapshot of `current` only: the other rows have no cheap state of their own. */
  readonly snapshot: GitSnapshot | null
  readonly onChoose: (path: string) => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  /** Collapsed head of the block (the toggle is handed in so the panel owns
   * the state and it survives navigating between panes). */
  readonly collapsed?: boolean
  readonly onToggleCollapse?: () => void
  /** Right-click props for one row: reveal the checkout or copy its path. Only
   * a row that can be chosen gets one — a disabled row states its reason on
   * hover and offers nothing to act on. */
  readonly rowMenu?: (choice: RepoChoice) => Record<string, unknown>
  readonly workspaceHint?: GitRepoList['codeWorkspace']
  readonly onEnableWorkspace?: () => void
  readonly workspaceEnabling?: boolean
  readonly workspaceFailed?: boolean
  readonly query?: string
  readonly onQueryChange?: (query: string) => void
}

export function ReposSection({ choices, current, snapshot, onChoose, t, collapsed = false, onToggleCollapse, rowMenu, workspaceHint, onEnableWorkspace, workspaceEnabling = false, workspaceFailed = false, query = '', onQueryChange }: ReposSectionProps): JSX.Element | null {
  // One checkout is not a choice: a single row would only repeat the pill, and
  // the branch tree below already names it.
  const listId = useId()
  // The search box: a display-only filter over the rows the host already
  // listed (issue #161). No RPC, no rescan — a query that re-scanned the
  // workspace could offer repositories this list never certified.
  const searchRef = useRef<HTMLInputElement | null>(null)
  // Memoised on the query alone: the filtered list rides `useRowSlider`'s deps,
  // and a fresh array on every render would re-measure the travelling fill on
  // each tip or copy re-render while a query is typed (row-slider.ts asks for
  // a stable value there).
  const tokens = useMemo(() => repoSearchTokens(query), [query])
  const searching = tokens.length > 0
  // The block's path line: the absolute root of the checkout the panes act on,
  // click-to-copy with the shared 1.6 s feedback. Read off the full list, not
  // the filtered one: a query that hides the checked row must not take its
  // path with it — the line is what says which checkout the panes act on.
  const currentChoice = choices.find((choice) => choice.path === current)
  const visible = useMemo(() => filterRepoChoices(choices, tokens), [choices, tokens])
  // One clear for both exits (the button and the empty state): empties the
  // query and hands focus back to the input that filters.
  const clearQuery = (): void => { onQueryChange?.(''); searchRef.current?.focus() }
  // The checked row's fill is one block that travels from the old row to the
  // new one instead of two rows swapping colours in a single frame: the block
  // is measured from the checked row after every render that can move it, and
  // the rows keep no fill of their own (see css/repos.ts). The first paint is
  // placed without a transition — arriving at a pane must not animate from a
  // stale position.
  const { ref: listBox, slider } = useRowSlider({
    activeSelector: '.gp-repolist__item--active',
    // `visible` rides along: filtering moves the checked row (or hides it),
    // and the fill must re-measure instead of pointing at empty space.
    deps: [current, choices, visible, collapsed],
    collapsed,
  })
  const rootPath = currentChoice !== undefined && currentChoice.root !== '' ? currentChoice.root : null
  const rootCopy = useCopyFeedback(rootPath)
  // One tip serves the collapsed head's chip and the root path line; hover or
  // keyboard focus only, never touch (see tip.tsx).
  const tip = useHoverTip({ placement: 'below' })
  // The workspace-file row. With the setting off, a file sitting in the cwd is
  // the only clue that multi-root support exists at all, so the block states it
  // and offers the one-click switch; a configured but unusable file states why
  // instead of leaving the list unchanged without explanation (ADR-0035). It is
  // not a repository row — it cannot be chosen, only acted on.
  const hintFile = workspaceHint?.file === undefined ? null : baseName(workspaceHint.file)
  let hint: { readonly text: string; readonly action: boolean; readonly warn: boolean } | null = null
  if (workspaceFailed) {
    hint = { text: t('repos.workspaceEnableFailed'), action: false, warn: true }
  } else if (workspaceHint !== undefined) {
    if (workspaceHint.state === 'available') {
      const count = workspaceHint.count ?? (workspaceHint.file === undefined ? 0 : 1)
      hint = count > 1
        ? { text: t('repos.workspaceMany', { n: count }), action: false, warn: false }
        : { text: t('repos.workspaceAvailable', { file: hintFile ?? '' }), action: onEnableWorkspace !== undefined, warn: false }
    } else if (workspaceHint.state === 'missing') {
      hint = { text: t('repos.workspaceMissing', { file: hintFile ?? '' }), action: false, warn: true }
    } else if (workspaceHint.state === 'invalid') {
      hint = { text: t(workspaceInvalidKey(workspaceHint.reason), { file: hintFile ?? '' }), action: false, warn: true }
    } else if (workspaceHint.state === 'ambiguous') {
      hint = { text: t('repos.workspaceAmbiguous'), action: false, warn: true }
    } else if (workspaceHint.state === 'applied' && workspaceHint.roots === 0) {
      // Enabled, parsed, and the file produced no root at all. The count is the
      // host's answer, not a guess from the rows: a root this list already
      // carries (a worktree of the session's own repository) merges into that
      // row instead of adding an `external` one, so the rows cannot tell "the
      // file names nothing" from "the file names something already listed".
      // An older host sends no count, and guessing there would state the wrong
      // thing (ADR-0035).
      hint = { text: t('repos.workspaceEmpty'), action: false, warn: true }
    }
  }
  const hintRow = hint === null
    ? null
    : h('div', { key: 'whint', className: `gp-repolist__hint${hint.warn ? ' gp-repolist__hint--warn' : ''}` }, [
      h(SparkleIcon, { key: 'ic', size: 13 }),
      h('span', { key: 'tx', className: 'gp-repolist__hint-text' }, hint.text),
      hint.action
        ? h('button', {
          key: 'go', type: 'button', className: 'gp-repolist__hint-act',
          disabled: workspaceEnabling,
          onClick: () => { tip.hideTip(); onEnableWorkspace?.() },
        }, workspaceEnabling ? t('repos.workspaceEnabling') : t('repos.workspaceEnable'))
        : null,
    ])
  // A single checkout is not a choice — unless there is something to say about
  // the workspace file, which is exactly the case this block exists for now.
  if (choices.length < 2 && hintRow === null) return null
  const branch = snapshot === null ? undefined : snapshot.branch
  const changed = snapshot === null ? 0 : snapshot.staged + snapshot.modified + snapshot.untracked
  // The groups are cut from the filtered rows: a family with no match earns no
  // header, and each header counts what the query left. Without a query
  // `visible` IS `choices`, so the unfiltered block is byte-for-byte today's.
  const groups = repoGroups(visible)
  const grouped = groups.length > 1
  // The head badge stays the list's total — a query narrows what you see, not
  // what the workspace holds, and the count is how you notice a scan cap.
  const disabledCount = choices.filter((c) => c.disabled !== undefined).length
  const groupTitle = (group: RepoGroup): string => (group.key === 'own' ? t('repos.group.own') : t('repos.group.foreign'))

  const row = (choice: RepoChoice): JSX.Element => {
    const active = choice.path === current
    const label = repoLabel(choice)
    const disabledKey = repoDisabledKey(choice)
    // A query may have matched through the absolute root, which the ordinary
    // detail line does not print — the row then states a fragment of it, so
    // every surviving row shows where its match came from.
    const detail = disabledKey === null
      ? (searching ? repoSearchDetail(choice, tokens) : repoDetail(choice))
      : t(disabledKey)
    // Disabled rows keep their reason unhighlighted: the terms matched the row's
    // identity, not the translated sentence explaining why it cannot be chosen.
    const nameRuns = disabledKey === null && searching ? repoSearchHighlight(label, tokens) : null
    const detailRuns = disabledKey === null && searching ? repoSearchHighlight(detail, tokens) : null
    const isOwn = choice.kind === 'workspace' || choice.kind === 'worktree'
    // The checked row reports what its snapshot says (the freshest truth); any
    // other row may only repeat what the list itself carries — the worktree's
    // branch, which git reported for free, or nothing at all for a scanned
    // repository nobody has sampled.
    const knownBranch = active ? (snapshot !== null ? branch : choice.branch) : isOwn ? choice.branch : undefined
    const tags: string[] = []
    if (choice.role === 'main') tags.push(t('repos.mainTag'))
    if (choice.locked === true) tags.push(t('repos.lockedTag'))
    const itemClass = 'gp-repolist__item'
      + (active ? ' gp-repolist__item--active' : '')
      + (disabledKey !== null ? ' gp-repolist__item--disabled' : '')
    const icon = choice.role === 'linked' ? h(WorktreeIcon, { size: 14 }) : h(RepoIcon, { size: 14 })
    // The row's hover detail: branch and absolute root on their own lines (the
    // column truncates both), with the disabled reason first when it applies.
    // The handlers live on the row, not the button: a disabled button drops
    // mouse events, and the row box equals the button box anyway.
    const tipLines = repoRowTip(choice, knownBranch, { detached: t('pill.detached'), disabled: disabledKey === null ? null : t(disabledKey) })
    // The menu handlers live on the row box, the tip's precedent: a disabled
    // button swallows context-menu events, and the row box equals the button box
    // anyway. A row that cannot be chosen carries no menu at all.
    const menuProps = rowMenu === undefined || disabledKey !== null ? {} : rowMenu(choice)
    return h('li', { key: choice.path === '' ? '__root' : choice.path, className: 'gp-repolist__row', ...tip.tipProps(repoTipContent(tipLines)) },
      h('button', {
        type: 'button',
        className: itemClass,
        // The list is a chooser, not a set of links: aria-current names the one
        // the panes act on, and picking it again is a no-op. A disabled row
        // states its reason and cannot be focused or clicked.
        'aria-current': active ? 'true' : undefined,
        disabled: disabledKey !== null,
        onClick: () => { tip.hideTip(); if (!active) onChoose(choice.path) },
        ...menuProps,
      }, [
        h('span', { key: 'icon', className: 'gp-repolist__icon' }, icon),
        h('span', { key: 'text', className: 'gp-repolist__text' }, [
          h('span', { key: 'line', className: 'gp-repolist__line' }, [
            h('span', { key: 'name', className: 'gp-repolist__name' }, renderRuns(label, nameRuns)),
            // Detached is a real reported state (null), not an absence: the
            // chip distinguishes "HEAD is detached" from "nothing sampled".
            knownBranch !== undefined && knownBranch !== null
              ? h('span', { key: 'branch', className: 'gp-repolist__branch' }, [h(BranchIcon, { key: 'i', size: 11 }), knownBranch])
              : null,
            knownBranch === null
              ? h('span', { key: 'branch', className: 'gp-repolist__branch gp-repolist__branch--detached' }, t('pill.detached'))
              : null,
            // A bare count carries no meaning read on its own: the badge is one
            // image-like unit whose label states what is being counted.
            active && changed > 0
              ? h('span', { key: 'count', className: 'gp-repolist__count', role: 'img', 'aria-label': t('repos.changedCount', { n: changed }) }, String(changed))
              : null,
          ]),
          tags.length === 0 && detail === ''
            ? null
            : h('span', { key: 'meta', className: 'gp-repolist__meta' }, [
              ...tags.map((tag) => h('span', { key: tag, className: 'gp-repolist__tag' }, tag)),
              detail === '' ? null : h('span', { key: 'path', className: 'gp-repolist__path' }, renderRuns(detail, detailRuns)),
            ]),
        ]),
      ]))
  }

  // One group keeps today's flat markup: the header would only restate the
  // block's own title. Two groups buy the separator, each with its count.
  const rowGroups = grouped
    ? h('div', { key: 'groups', className: 'gp-repolist__groups' }, groups.map((group) =>
      h('div', { key: group.key, className: 'gp-repolist__group', role: 'group', 'aria-label': groupTitle(group) }, [
        h('div', { key: 'hd', className: 'gp-repolist__grouphd' }, [
          h('span', { key: 'title', className: 'gp-repolist__grouptitle' }, groupTitle(group)),
          h('span', {
            key: 'count',
            className: 'gp-repolist__groupcount',
            role: 'img',
            'aria-label': t('repos.countAria', { n: group.selectable, m: group.items.length }),
          }, group.selectable === group.items.length ? String(group.items.length) : `${group.selectable}/${group.items.length}`),
        ]),
        h('ul', { key: 'rows', className: 'gp-repolist__rows', role: 'list', 'aria-label': groupTitle(group) }, group.items.map(row)),
      ])))
    : h('ul', { key: 'rows', className: 'gp-repolist__rows', role: 'list', 'aria-label': t('tab.repos') }, visible.map(row))

  // A query with no match says so in place, with the way out: an empty scroller
  // would read as a broken list, and the row count in the head still says the
  // workspace holds repositories.
  const emptyState = searching && visible.length === 0
    ? h('div', { key: 'empty', className: 'gp-repolist__empty' }, [
      // A live region: typing into zero results announces the state instead of
      // leaving a screen reader on a list that silently stopped.
      h('span', { key: 'msg', className: 'gp-repolist__empty-msg', role: 'status' }, t('repos.searchEmpty')),
      h('button', {
        key: 'clear', type: 'button', className: 'gp-repolist__empty-clear',
        onClick: clearQuery,
      }, t('repos.searchClear')),
    ])
    : null

  // The scroll container also anchors the travelling fill: the slider is its
  // first child, absolutely placed, so it scrolls with the rows and its
  // bounds always sit in the scrolled content. Arrow keys walk the rows so a
  // keyboard user can traverse a filtered list without Tab'ing every entry;
  // disabled rows are skipped — they cannot be chosen, so they are not stops.
  const onListKeyDown = (event: { key: string; target: EventTarget | null; preventDefault: () => void }): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains('gp-repolist__item')) return
    const rows = [...(listBox.current?.querySelectorAll<HTMLButtonElement>('.gp-repolist__item:not([disabled])') ?? [])]
    const at = rows.indexOf(target as HTMLButtonElement)
    if (at === -1) return
    const next = rows[at + (event.key === 'ArrowDown' ? 1 : -1)]
    if (next === undefined) return
    event.preventDefault()
    next.focus()
  }
  const list = h('div', { key: 'list', id: listId, className: 'gp-repolist__list', ref: listBox, onKeyDown: onListKeyDown }, [slider, emptyState ?? rowGroups])

  // While collapsed the head names the checkout the panes act on: its label
  // shrinks to the repository icon so the selected chip keeps the width, with
  // the absolute root as the hover hint. Expanded, the icon stays and the text
  // label follows it.
  const selectedLabel = currentChoice === undefined ? null : repoLabel(currentChoice)
  const selectedTitle = currentChoice === undefined || currentChoice.root === '' ? selectedLabel : currentChoice.root

  // The whole head line is the toggle: an 18px chevron is a poor hit target on
  // a touch panel, and the line already belongs to this block. The chevron is
  // an indicator now. Collapsing stays explicit — a pick never folds the list
  // the user is switching in.
  const toggleLabel = collapsed ? t('repos.expand') : t('repos.collapse')
  // A label that only names the action hides the block's own words (its name,
  // the count, and the collapsed checkout chip) from a screen reader. Composed
  // from keys that are already translated instead of a new string that would
  // need all eight locales for one sentence.
  const countLabel = disabledCount > 0
    ? t('repos.countAria', { n: choices.length - disabledCount, m: choices.length })
    : String(choices.length)
  const headLabel = selectedLabel === null || selectedLabel === ''
    ? `${toggleLabel}: ${t('tab.repos')} (${countLabel})`
    : `${toggleLabel}: ${t('tab.repos')} (${countLabel}) ${selectedLabel}`
  // While collapsed the head carries the checkout's absolute path as its hint;
  // expanded, the path line below states it outright and needs no tip.
  const headTip = collapsed && selectedTitle !== null ? tip.tipProps(selectedTitle) : undefined
  const headChildren: (JSX.Element | null)[] = [
    h('span', {
      key: 'label',
      className: `gp-repolist__label${collapsed ? ' gp-repolist__label--icon' : ''}`,
      ...(collapsed ? { role: 'img', 'aria-label': t('tab.repos') } : {}),
    }, collapsed
      ? h(RepoIcon, { size: 14 })
      : [
          h(RepoIcon, { key: 'ic', size: 14 }),
          h('span', { key: 'tx', className: 'gp-repolist__labeltext' }, t('tab.repos')),
        ]),
    h('span', {
      key: 'n',
      className: 'gp-repolist__badge',
      ...(disabledCount > 0 ? { role: 'img', 'aria-label': t('repos.countAria', { n: choices.length - disabledCount, m: choices.length }) } : {}),
    }, disabledCount > 0 ? `${choices.length - disabledCount}/${choices.length}` : String(choices.length)),
    collapsed && selectedLabel !== null && selectedLabel !== ''
      ? h('span', { key: 'sel', className: 'gp-repolist__selected' }, selectedLabel)
      : null,
    // The block collapses to its head line: a permanent worktree family would
    // otherwise hold a third of the left column forever.
    onToggleCollapse === undefined
      ? null
      : h('span', { key: 'chevron', className: 'gp-repolist__collapse' }, h(ChevronIcon, { size: 14, open: !collapsed })),
  ]
  const head = onToggleCollapse === undefined
    ? h('div', { key: 'head', className: 'gp-repolist__head gp-repolist__head--static', ...headTip }, headChildren)
    : h('button', {
      key: 'head',
      type: 'button',
      className: 'gp-repolist__head',
      'aria-expanded': collapsed ? 'false' : 'true',
      'aria-controls': listId,
      'aria-label': headLabel,
      ...headTip,
      onClick: onToggleCollapse,
    }, headChildren)

  // The current checkout's absolute path, click-to-copy with ✓ for 1.6 s.
  // Hidden while collapsed. The body elides from the left (direction:rtl
  // keeps the tail); an invisible LRM anchors the leading '/' so the
  // ellipsis swallows it together with the head instead of pinning it.
  const rootLine = rootPath === null
    ? null
    : h('button', {
        key: 'root', type: 'button',
        className: `gp-repolist__root${rootCopy.feedback === 'copied' ? ' gp-repolist__root--copied' : ''}`,
        'aria-label': rootCopy.feedback === 'copied' ? t('repos.rootCopied') : t('repos.copyRoot'),
        ...tip.tipProps(rootCopy.feedback === 'copied' ? t('repos.rootCopied') : rootPath),
        hidden: collapsed || undefined,
        onClick: () => { tip.hideTip(); rootCopy.copy(rootPath) },
      }, [
        h('code', { key: 'p', className: 'gp-repolist__root-code' },
          h('span', { key: 'body', className: 'gp-repolist__root-body' }, rtlPathText(rootPath))),
        rootCopy.feedback === 'copied'
          ? h(CheckIcon, { key: 'ok', size: 12 })
          : h(CopyIcon, { key: 'i', size: 12 }),
        h('span', { key: 'live', className: 'gp-copy-live', 'aria-live': 'polite' },
          rootCopy.feedback === 'copied' ? t('repos.rootCopied') : ''),
      ])

  // The search row sits between the path line and the rows, inside the fold:
  // it must not scroll away with the results it filters. The count beside it
  // is the match count, never the list total — the head badge keeps that.
  // A list of one is not a choice, so the box goes with it — unless a query is
  // live: hiding the box while its word still filters would leave a narrowed
  // list with no visible way back (the empty state's clear cannot appear for a
  // query that still matches that one row).
  const searchRow = onQueryChange === undefined || (choices.length < 2 && query === '')
    ? null
    : h('div', { key: 'search', className: 'gp-repolist__search' }, [
      h(SearchIcon, { key: 'ic', size: 13 }),
      h('input', {
        key: 'input',
        ref: searchRef,
        className: 'gp-repolist__search-input',
        type: 'search',
        placeholder: t('repos.searchPlaceholder'),
        'aria-label': t('repos.searchPlaceholder'),
        value: query,
        // The native widget clears with its own ✕; ours is the single clear
        // with the count, so the built-in one is hidden in CSS.
        onChange: (event: { target: { value: string } }) => onQueryChange(event.target.value),
        onKeyDown: (event: { key: string; preventDefault: () => void; stopPropagation: () => void; nativeEvent?: { isComposing?: boolean } }) => {
          // Escape during IME composition cancels the candidate list, not the
          // query — and must not reach the sheet/drawer listener beneath.
          if (event.nativeEvent?.isComposing === true) { event.stopPropagation(); return }
          // The input owns Escape while it has focus and claims it even with an
          // empty query (the comment form's precedent): an unhandled keystroke
          // would fall through to the sheet/drawer document listeners.
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (query !== '') onQueryChange('')
            return
          }
          // ↓ steps into the results; Enter types, it never picks — a query
          // must not switch the checkout the user is still editing.
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            const first = listBox.current?.querySelector<HTMLButtonElement>('.gp-repolist__item:not([disabled])')
            first?.focus()
          }
        },
      }),
      searching
        ? h('span', { key: 'n', className: 'gp-repolist__search-count', role: 'img', 'aria-live': 'polite', 'aria-label': t('repos.searchCount', { n: visible.length }) }, String(visible.length))
        : null,
      query === ''
        ? null
        : h('button', {
          key: 'clear', type: 'button', className: 'gp-repolist__search-clear',
          'aria-label': t('repos.searchClear'),
          onClick: clearQuery,
        }, h(CloseIcon, { size: 11 })),
    ])

  // The path line and the rows share one folding track: animating the track's
  // size unfolds downwards and folds upwards, where toggling [hidden] snapped
  // the block in a single frame. The rows stay mounted while folded — the
  // transition needs their real height — so the folded body also leaves the
  // tab order and the accessibility tree.
  const fold = h('div', { key: 'fold', className: 'gp-repolist__fold' }, [rootLine, searchRow, list])
  return h('div', { className: 'gp-repolist' }, [
    head,
    // Outside the fold on purpose: the block boots collapsed, and an offer
    // hidden behind a chevron is the same silence that made the setting
    // undiscoverable (ADR-0035).
    hintRow,
    h('div', {
      key: 'body',
      className: 'gp-repolist__body',
      'data-collapsed': collapsed ? 'true' : 'false',
      ...inertAttr(collapsed),
    }, fold),
    tip.tipNode,
  ])
}
