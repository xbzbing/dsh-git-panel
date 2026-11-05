/**
 * Menu actions for one row of the repository selector.
 *
 * The row is a chooser entry, not a file: the platform's directory family is
 * borrowed for the two things a checkout root offers — reveal it in the file
 * manager and copy its absolute path — and the only entry this plugin adds is
 * the remote check, which no platform menu knows about. Everything else the
 * selector does stays on the click.
 *
 * A pure builder like the other `*-menu.ts` modules: the panel supplies the
 * translate, the toast face and the fetch run, the proxy supplies the platform
 * group, and the test asserts the composition without React.
 */
import type { RepoTargetValue } from './menu-owners.js'
import type { MenuAction } from './menu-types.js'
import type { GitKey } from './locales.js'
import type { MenuEnv } from './menu-actions.js'

/** What the remote check needs to run, read at resolve time. */
export interface ReposMenuCommands {
  /** Run `git fetch` in the row's checkout and report the result through the
   * menu toast (the row is not the panel's selection, so there is no status bar
   * to report into). */
  readonly fetch: (repoTag: string) => void
}

/** Whether the remote check is offered. A checkout without a remote has nothing
 * to ask; the pill's panel knows its own sample, a foreign row answers when
 * asked (the fetch report says so). */
export interface ReposMenuFacts {
  readonly canFetch: boolean
}

/**
 * Compose one repository row's menu.
 * @param value - the captured row.
 * @param env - translate, menu service, Git facts (the Git group does not
 *   apply: these actions are about the checkout directory, not about a path
 *   inside it).
 * @param platform - the whitelisted platform directory actions (reveal, copy
 *   path), already resolved for this row's absolute root.
 * @param cmds - the fetch run.
 * @param facts - live gating state.
 */
export function repoRowMenuActions(
  value: RepoTargetValue,
  env: MenuEnv,
  platform: readonly MenuAction[],
  cmds: ReposMenuCommands,
  facts: ReposMenuFacts,
): MenuAction[] {
  const group: MenuAction[] = [...platform]
  // Hidden rather than disabled when the checkout has no remote: a dim entry the
  // row cannot explain reads as a bug, and there is nothing to ask.
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

/** Labels are read through the panel's translate; this keeps the keys in one
 * place for the locale test to see. */
export const REPOS_MENU_LABELS = {
  checkRemote: 'menu.checkRemote',
} as const satisfies Record<string, GitKey>

/** The fetch report's labels, also shared with the pill's menu. */
export const FETCH_MENU_LABELS = {
  done: 'menu.fetchDone',
  noRemote: 'menu.fetchNoRemote',
  failed: 'common.operationFailed',
} as const satisfies Record<string, GitKey>
