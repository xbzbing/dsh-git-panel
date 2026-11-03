import { createElement as h, useState } from 'react'
import type { JSX } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { CommitIcon, FolderIcon } from './icons.js'
import { HISTORY_PATH_SEARCH_MAX_LENGTH } from './types.js'
import type { GitKey } from './locales.js'
import type { PathSearchSupport } from './overview-hooks.js'

export type HistorySearchScope = 'message' | 'path'

interface HistorySearchProps {
  readonly value: string
  readonly scope: HistorySearchScope
  readonly support: PathSearchSupport
  /** Hide the scope label text (narrow toolbar or compact panel). */
  readonly labelNarrow: boolean
  /** Shorten the placeholder (its hint cannot be rewritten by CSS). */
  readonly narrow: boolean
  readonly onChange: (value: string) => void
  readonly onScopeChange: (scope: HistorySearchScope) => void
  readonly t: (key: GitKey) => string
}

/** Scope and text share one toolbar item in every panel layout. */
export function HistorySearch({ value, scope, support, labelNarrow, narrow, onChange, onScopeChange, t }: HistorySearchProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const scopeLabel = t(scope === 'path' ? 'overview.searchPath' : 'overview.searchMessage')
  const unavailable = support === 'supported' ? null
    : t(support === 'unknown' ? 'overview.searchPathPending' : 'overview.searchPathUnsupported')
  const menu = h(Menu, {
    key: 'scope', open, onClose: () => setOpen(false),
    items: [
      { id: 'message', label: t('overview.searchMessage') },
      { id: 'path', disabled: unavailable !== null, label: h('span', { title: unavailable ?? t('overview.searchPathHelp') }, [
        h('span', { key: 'label' }, t('overview.searchPath')),
        unavailable === null ? null : h('small', { key: 'reason', className: 'gp-search-scope__reason' }, unavailable),
      ]) },
    ],
    selectedId: scope,
    onSelect: (id: string) => {
      setOpen(false)
      if (id === 'message' || (id === 'path' && support === 'supported')) onScopeChange(id)
    },
    align: 'start', portal: true, className: 'gp-filter gp-search-scope',
    anchor: h('button', {
      type: 'button', className: 'gp-select-trigger gp-search-scope__trigger',
      'aria-haspopup': 'menu', 'aria-expanded': open,
      'aria-label': `${t('overview.searchScope')}: ${scopeLabel}`,
      onClick: () => setOpen((previous) => !previous),
    }, [
      h(scope === 'path' ? FolderIcon : CommitIcon, { key: 'icon', size: 14 }),
      labelNarrow ? null : h('span', { key: 'label', className: 'gp-select-trigger__label' }, scopeLabel),
      h(IconChevronDownOutlineRegular, { key: 'chevron', className: 'gp-select-trigger__chevron', size: 12 }),
    ]),
  })
  return h('div', { className: 'gp-history-search', 'data-search-scope': scope }, [
    menu,
    h('input', {
      key: 'input', className: 'gp-search',
      placeholder: t(scope === 'path'
        ? (narrow ? 'overview.searchPathShort' : 'overview.searchPathHint')
        : (narrow ? 'overview.searchShort' : 'overview.search')),
      'aria-label': t(scope === 'path' ? 'overview.searchPathHint' : 'overview.search'),
      title: scope === 'path' ? t('overview.searchPathHelp') : undefined,
      maxLength: scope === 'path' ? HISTORY_PATH_SEARCH_MAX_LENGTH : undefined,
      value,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    }),
  ])
}
