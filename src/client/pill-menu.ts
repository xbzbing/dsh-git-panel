/**
 * Menu actions for the input-bar pill.
 *
 * The pill is a status marker with a click; the menu gives it navigation (the
 * panel's three pages) and answers about the checkout it stands for (copy the
 * branch name or the root, run the remote check). No write operations: the pill
 * owns no op runner and no confirmation dialogs, and a menu reachable from the
 * input bar must not move the work tree.
 *
 * The pill is mounted per session and exists while the panel is not on screen
 * (its click is what opens the panel), so its actions cannot go through the
 * panel's owner: the identity the target carries is the pill's own token.
 */
import type { PillTargetValue } from './menu-owners.js'
import type { MenuAction } from './menu-types.js'
import { copyText } from './menu-actions.js'
import type { MenuEnv } from './menu-actions.js'

/** What the pill's entries need to run, read at resolve time. */
export interface PillMenuCommands {
  /** Open the panel's overview / changes / files page (the sub-tab request the
   * pill's own click uses as well). */
  readonly openTab: (tab: 'overview' | 'changes' | 'files') => void
  /** Run `git fetch` for the pill's checkout and report through the toast. */
  readonly fetch: (repoTag: string) => void
}

/** Whether the fetch entry is offered: a checkout without a remote has nothing
 * to ask. Hidden rather than disabled — a dim entry the pill cannot explain is
 * worse than no entry. */
export interface PillMenuFacts {
  readonly canFetch: boolean
}

/**
 * Compose the pill's menu. Order: navigation (the pill's primary job is
 * reaching the panel), then the answers, then the remote check.
 */
export function pillMenuActions(
  value: PillTargetValue, env: MenuEnv, cmds: PillMenuCommands, facts: PillMenuFacts,
): MenuAction[] {
  const group: MenuAction[] = [
    { id: 'open-overview', label: env.t('menu.openOverview'), run: () => cmds.openTab('overview') },
    { id: 'open-changes', label: env.t('menu.openChanges'), run: () => cmds.openTab('changes') },
    { id: 'open-files', label: env.t('menu.openFiles'), run: () => cmds.openTab('files') },
  ]
  // A detached HEAD has no branch name to copy; the root is always there.
  if (value.branch !== null) {
    const branch = value.branch
    group.push({
      id: 'copy-branch',
      label: env.t('menu.copyBranchName'),
      failureLabel: env.t('menu.copyFailed'),
      run: () => copyText(env, branch),
    })
  }
  group.push({
    id: 'copy-root',
    label: env.t('overview.copyRoot'),
    failureLabel: env.t('menu.copyFailed'),
    run: () => copyText(env, value.root),
  })
  if (facts.canFetch) {
    group.push({
      id: 'fetch-remote',
      label: env.t('menu.checkRemote'),
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.fetch(value.repo),
    })
  }
  return group
}
