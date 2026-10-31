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
import { createElement as h, useId } from 'react'
import type { JSX } from 'react'
import { BranchIcon, CheckIcon, ChevronIcon, CopyIcon, RepoIcon, WorktreeIcon } from './icons.js'
import type { RepoChoice, RepoGroup } from './repo-list.js'
import { repoDetail, repoDisabledKey, repoGroups, repoLabel, repoRowTip } from './repo-list.js'
import { repoTipContent } from './repo-tip.js'
import { useCopyFeedback } from './copy-feedback.js'
import { useRowSlider } from './row-slider.js'
import { inertAttr } from './inert.js'
import { useHoverTip } from './tip.js'
import { rtlPathText } from './rtl-path.js'
import type { GitSnapshot } from './types.js'
import type { GitKey } from './locales.js'

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
}

export function ReposSection({ choices, current, snapshot, onChoose, t, collapsed = false, onToggleCollapse }: ReposSectionProps): JSX.Element | null {
  // One checkout is not a choice: a single row would only repeat the pill, and
  // the branch tree below already names it.
  const listId = useId()
  // The checked row's fill is one block that travels from the old row to the
  // new one instead of two rows swapping colours in a single frame: the block
  // is measured from the checked row after every render that can move it, and
  // the rows keep no fill of their own (see css/repos.ts). The first paint is
  // placed without a transition — arriving at a pane must not animate from a
  // stale position.
  const { ref: listBox, slider } = useRowSlider({
    activeSelector: '.gp-repolist__item--active',
    deps: [current, choices, collapsed],
    collapsed,
  })
  // The block's path line: the absolute root of the checkout the panes act on,
  // click-to-copy with the shared 1.6 s feedback.
  const currentChoice = choices.find((choice) => choice.path === current)
  const rootPath = currentChoice !== undefined && currentChoice.root !== '' ? currentChoice.root : null
  const rootCopy = useCopyFeedback(rootPath)
  // One tip serves the collapsed head's chip and the root path line; hover or
  // keyboard focus only, never touch (see tip.tsx).
  const tip = useHoverTip({ placement: 'below' })
  if (choices.length < 2) return null
  const branch = snapshot === null ? undefined : snapshot.branch
  const changed = snapshot === null ? 0 : snapshot.staged + snapshot.modified + snapshot.untracked
  const groups = repoGroups(choices)
  const grouped = groups.length > 1
  const disabledCount = choices.filter((c) => c.disabled !== undefined).length
  const groupTitle = (group: RepoGroup): string => (group.key === 'own' ? t('repos.group.own') : t('repos.group.foreign'))

  const row = (choice: RepoChoice): JSX.Element => {
    const active = choice.path === current
    const label = repoLabel(choice)
    const disabledKey = repoDisabledKey(choice)
    const detail = disabledKey === null ? repoDetail(choice) : t(disabledKey)
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
      }, [
        h('span', { key: 'icon', className: 'gp-repolist__icon' }, icon),
        h('span', { key: 'text', className: 'gp-repolist__text' }, [
          h('span', { key: 'line', className: 'gp-repolist__line' }, [
            h('span', { key: 'name', className: 'gp-repolist__name' }, label),
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
              detail === '' ? null : h('span', { key: 'path', className: 'gp-repolist__path' }, detail),
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
    : h('ul', { key: 'rows', className: 'gp-repolist__rows', role: 'list', 'aria-label': t('tab.repos') }, choices.map(row))

  // The scroll container also anchors the travelling fill: the slider is its
  // first child, absolutely placed, so it scrolls with the rows and its
  // bounds always sit in the scrolled content.
  const list = h('div', { key: 'list', id: listId, className: 'gp-repolist__list', ref: listBox }, [slider, rowGroups])

  // While collapsed the head names the checkout the panes act on: its label
  // shrinks to a repository icon so the selected chip keeps the width, with
  // the absolute root as the hover hint. Expanding restores the text label.
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
      className: collapsed ? 'gp-repolist__label gp-repolist__label--ic' : 'gp-repolist__label',
      ...(collapsed ? { role: 'img', 'aria-label': t('tab.repos') } : {}),
    }, collapsed ? h(RepoIcon, { size: 14 }) : t('tab.repos')),
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

  // The path line and the rows share one folding track: animating the track's
  // size unfolds downwards and folds upwards, where toggling [hidden] snapped
  // the block in a single frame. The rows stay mounted while folded — the
  // transition needs their real height — so the folded body also leaves the
  // tab order and the accessibility tree.
  const fold = h('div', { key: 'fold', className: 'gp-repolist__fold' }, [rootLine, list])
  return h('div', { className: 'gp-repolist' }, [
    head,
    h('div', {
      key: 'body',
      className: 'gp-repolist__body',
      'data-collapsed': collapsed ? 'true' : 'false',
      ...inertAttr(collapsed),
    }, fold),
    tip.tipNode,
  ])
}
