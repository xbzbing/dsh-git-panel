/**
 * The branch list's `Git Flow` entry: one button at the right end of the
 * `全部分支` row plus the grouped menu the reference flow editor shows. The
 * button lives in `renderBranchList` (overview-branches.tsx), so every surface
 * that draws the branch list — the wide left column, the stacked band, the
 * tight drawer, the phone drawer and the compact bottom sheet — gets the same
 * entry without a second copy.
 *
 * The menu only decides *what* to do; the panel owns the dialogs, so a branch
 * row's context menu raises the same ones. The host actions that execute them
 * arrive in the next step.
 */
import { createElement as h, useState } from 'react'
import type { JSX } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { MergeIcon } from './icons.js'
import { flowMenuItems, type FlowDialog, type FlowMenuItemId } from './flow.js'
import type { GitKey } from './locales.js'

export interface FlowMenuProps {
  readonly current: string | null
  readonly local: readonly string[]
  readonly defaultBranch: string | null
  /** Any pane write in flight; the entries are disabled while it runs. */
  readonly busy: boolean
  /** The panel's dialog opener: the same one the branch rows' menus use. */
  readonly onOpen: (dialog: FlowDialog) => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

const LABELS: Record<FlowMenuItemId, GitKey> = {
  'start-feature': 'flow.menu.startFeature',
  'integrate-develop': 'flow.menu.integrate',
  'finish-feature': 'flow.menu.finishFeature',
  'start-hotfix': 'flow.menu.startHotfix',
  'finish-hotfix': 'flow.menu.finishHotfix',
  'start-release': 'flow.menu.startRelease',
  'finish-release': 'flow.menu.finishRelease',
}

export function FlowMenu({ current, local, defaultBranch, busy, onOpen, t }: FlowMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const items = flowMenuItems({ current, local, defaultBranch, busy })

  const entries: MenuEntry[] = []
  let group: number | null = null
  for (const item of items) {
    if (group !== null && item.group !== group) entries.push({ type: 'separator', id: `flow-sep-${item.group}` })
    group = item.group
    entries.push({ id: item.id, label: t(LABELS[item.id]), disabled: item.disabled })
  }
  // The explanation sits below the operations, fenced off: it is read-only, so
  // it stays available even while a write is in flight.
  entries.push({ type: 'separator', id: 'flow-sep-about' })
  entries.push({ id: 'about-flow', label: t('flow.about.menu') })

  const choose = (id: string): void => {
    setOpen(false)
    const finish = (flow: 'feature' | 'hotfix' | 'release'): void => {
      if (current !== null) onOpen({ type: 'finish', flow, branch: current })
    }
    switch (id) {
      case 'start-feature': onOpen({ type: 'start', flow: 'feature' }); return
      case 'start-hotfix': onOpen({ type: 'start', flow: 'hotfix' }); return
      case 'start-release': onOpen({ type: 'start', flow: 'release' }); return
      case 'finish-feature': finish('feature'); return
      case 'finish-hotfix': finish('hotfix'); return
      case 'finish-release': finish('release'); return
      case 'integrate-develop': onOpen({ type: 'integrate' }); return
      case 'about-flow': onOpen({ type: 'about' }); return
      default: return
    }
  }

  const trigger = h('button', {
    key: 'trigger', type: 'button', className: 'gp-flow-btn',
    'aria-haspopup': 'menu', 'aria-expanded': open,
    title: t('flow.button'),
    onClick: () => setOpen((v) => !v),
  }, [
    h(MergeIcon, { key: 'i', size: 12 }),
    h('span', { key: 'l', className: 'gp-flow-btn__label' }, t('flow.button')),
  ])

  return h('span', { className: 'gp-flow' }, [
    h(Menu, {
      key: 'menu',
      open,
      anchor: trigger,
      items: entries,
      align: 'end',
      portal: true,
      onClose: () => setOpen(false),
      onSelect: choose,
    }),
  ])
}
