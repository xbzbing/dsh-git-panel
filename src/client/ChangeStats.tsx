/** Changes-page statistics bar: file count / line changes / last-change time. */
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type { WorktreeStats } from './types'
import type { GitKey } from './locales'
import { absoluteTime, timeAgo } from './time'

interface StatsProps {
  /** Stats ride the snapshot (single git source); no separate query. */
  readonly stats: WorktreeStats
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

export function ChangeStats({ stats, t }: StatsProps): JSX.Element {
  const now = Date.now()

  const items: JSX.Element[] = [
    h('span', { key: 'files', className: 'gp-stats__item' }, t('stats.files', { n: stats.fileCount })),
    h('span', { key: 'lines', className: 'gp-stats__item' }, [
      h('span', { key: 'a', className: 'gp-stats__add' }, `+${stats.insertions}`),
      ' ',
      h('span', { key: 'd', className: 'gp-stats__del' }, `\u2212${stats.deletions}`),
    ]),
  ]
  if (stats.staged > 0) items.push(h('span', { key: 'st', className: 'gp-stats__item' }, t('stats.staged', { n: stats.staged })))
  if (stats.modified > 0) items.push(h('span', { key: 'mo', className: 'gp-stats__item' }, t('stats.modified', { n: stats.modified })))
  if (stats.untracked > 0) items.push(h('span', { key: 'un', className: 'gp-stats__item' }, t('stats.untracked', { n: stats.untracked })))
  if (stats.lastChangeAt !== null) {
    items.push(h('span', { key: 'lc', className: 'gp-stats__item', title: absoluteTime(stats.lastChangeAt) }, t('stats.lastChange', { time: timeAgo(stats.lastChangeAt, now, t) })))
  }
  if (stats.headCommittedAt !== null) {
    items.push(h('span', { key: 'hc', className: 'gp-stats__item', title: absoluteTime(stats.headCommittedAt) }, t('stats.lastCommit', { time: timeAgo(stats.headCommittedAt, now, t) })))
  }

  return h('div', { className: 'gp-stats' }, items)
}
