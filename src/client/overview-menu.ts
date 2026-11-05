/**
 * Menu actions for the Git overview: branch rows and commit rows.
 *
 * A pure builder, like menu-actions.ts for the browser: the panel supplies a
 * translate, the clipboard face and the overview's own entry points, and every
 * test can assert the offered entries without React. Anything destructive opens
 * the overview's existing confirmation dialog — the same one the inline buttons
 * open — instead of acting from the menu.
 */
import type { BranchTargetValue, CommitTargetValue } from './menu-owners.js'
import type { MenuAction } from './menu-types.js'
import type { GitKey } from './locales.js'
import { copyText } from './menu-actions.js'
import type { MenuEnv } from './menu-actions.js'

/** What the overview's own entries need to run. */
export interface OverviewMenuCommands {
  /** Switch to the row's branch (a remote ref creates and tracks the local one);
   * a dirty work tree opens the stash confirmation first. */
  readonly switchBranch: (value: BranchTargetValue) => void
  /** Filter the history to one ref (null clears it). */
  readonly filterRef: (ref: string | null) => void
  /** Open the "create tag here" form for one commit. */
  readonly openTagCreate: (value: CommitTargetValue) => void
  /** Open the revert confirmation for one commit (moves no ref). */
  readonly openRevert: (value: CommitTargetValue) => void
  /** Open the reset confirmation for one commit (three modes). */
  readonly openReset: (value: CommitTargetValue) => void
}

/** Whether a write is in flight: switching, resetting and reverting all move the
 * work tree or HEAD, so they are offered but disabled while busy. */
export interface OverviewMenuFacts {
  readonly busy: boolean
  /** The host declared `capabilities.revDiff`; compare entries are gated on it. */
  readonly revDiff?: boolean
}

/** Branch-row entries: switch, history filter, copy, and the compare entry when
 * the row names a ref the panel can compare against. */
export function branchMenuActions(
  value: BranchTargetValue, env: MenuEnv, cmds: OverviewMenuCommands, facts: OverviewMenuFacts,
): MenuAction[] {
  const group: MenuAction[] = []
  if (!value.isCurrent) {
    group.push({
      id: 'switch-branch',
      label: env.t(value.isRemote ? 'menu.switchToTracking' : 'menu.switchBranch'),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.switchBranch(value),
    })
  }
  group.push({
    id: 'show-history',
    label: env.t(value.isCurrent ? 'menu.showHistory' : 'menu.showThisHistory'),
    run: () => cmds.filterRef(value.name),
  })
  group.push({
    id: 'copy-branch',
    label: env.t('menu.copyBranchName'),
    failureLabel: env.t('menu.copyFailed'),
    run: () => copyText(env, value.name),
  })
  return group
}

/** Commit-row entries: copy identities and text, then the write dialogs. */
export function commitMenuActions(
  value: CommitTargetValue, env: MenuEnv, cmds: OverviewMenuCommands, facts: OverviewMenuFacts,
): MenuAction[] {
  return [
    {
      id: 'copy-hash',
      label: env.t('menu.copyHash'),
      failureLabel: env.t('menu.copyFailed'),
      run: () => copyText(env, value.hash),
    },
    {
      id: 'copy-short-hash',
      label: env.t('menu.copyShortHash'),
      failureLabel: env.t('menu.copyFailed'),
      run: () => copyText(env, value.shortHash),
    },
    {
      id: 'copy-subject',
      label: env.t('menu.copySubject'),
      failureLabel: env.t('menu.copyFailed'),
      run: () => copyText(env, value.subject),
    },
    {
      id: 'create-tag',
      label: env.t('menu.createTagHere'),
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openTagCreate(value),
    },
    {
      id: 'revert',
      label: env.t('menu.revertCommit'),
      danger: true,
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openRevert(value),
    },
    {
      id: 'reset',
      label: env.t('menu.resetToHere'),
      danger: true,
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openReset(value),
    },
  ]
}

/** Labels are read through the panel's translate; this keeps the keys in one
 * place for the locale test to see. */
export const OVERVIEW_MENU_LABELS = {
  switchBranch: 'menu.switchBranch',
  switchToTracking: 'menu.switchToTracking',
  showHistory: 'menu.showHistory',
  showThisHistory: 'menu.showThisHistory',
  copyBranchName: 'menu.copyBranchName',
  copyHash: 'menu.copyHash',
  copyShortHash: 'menu.copyShortHash',
  copySubject: 'menu.copySubject',
  createTagHere: 'menu.createTagHere',
  revertCommit: 'menu.revertCommit',
  resetToHere: 'menu.resetToHere',
} as const satisfies Record<string, GitKey>
