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
import { copyText } from './menu-actions.js'
import { menuIcon } from './menu-icons.js'
import { commitQuote } from './quote.js'
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
  /** Open the "detach HEAD here" confirmation for one commit. */
  readonly openCheckout: (value: CommitTargetValue) => void
  /** Put the commit's reference into the session's composer (quote.ts). */
  readonly quote: (text: string) => void
}

/** Whether a write is in flight: switching, resetting and reverting all move the
 * work tree or HEAD, so they are offered but disabled while busy. */
export interface OverviewMenuFacts {
  readonly busy: boolean
  /** HEAD's commit: checking it out would detach a HEAD that is already there,
   * so the entry is not offered for it. */
  readonly head?: string | null
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
      icon: menuIcon('branch'),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.switchBranch(value),
    })
  }
  group.push({
    id: 'show-history',
    label: env.t(value.isCurrent ? 'menu.showHistory' : 'menu.showThisHistory'),
    icon: menuIcon('history'),
    run: () => cmds.filterRef(value.name),
  })
  group.push({
    id: 'copy-branch',
    label: env.t('menu.copyBranchName'),
    icon: menuIcon('copy'),
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
      icon: menuIcon('copy'),
      failureLabel: env.t('menu.copyFailed'),
      run: () => copyText(env, value.hash),
    },
    {
      id: 'copy-short-hash',
      label: env.t('menu.copyShortHash'),
      icon: menuIcon('copy'),
      failureLabel: env.t('menu.copyFailed'),
      run: () => copyText(env, value.shortHash),
    },
    {
      id: 'copy-subject',
      label: env.t('menu.copySubject'),
      icon: menuIcon('copy'),
      failureLabel: env.t('menu.copyFailed'),
      run: () => copyText(env, value.subject),
    },
    // Offered only where a composer exists to take it (the panel probes the
    // session's conversation service); elsewhere the row keeps its copies.
    ...(env.facts.canQuote === true
      ? [{
          id: 'quote-commit',
          label: env.t('menu.quoteCommit'),
          icon: menuIcon('quote'),
          failureLabel: env.t('menu.copyFailed'),
          run: () => cmds.quote(commitQuote(value.shortHash, value.subject)),
        }]
      : []),
    {
      id: 'create-tag',
      label: env.t('menu.createTagHere'),
      icon: menuIcon('tag'),
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openTagCreate(value),
    },
    ...(facts.head === value.hash ? [] : [{
      id: 'checkout',
      label: env.t('menu.checkoutCommit'),
      icon: menuIcon('checkout'),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openCheckout(value),
    }]),
    {
      id: 'revert',
      label: env.t('menu.revertCommit'),
      icon: menuIcon('revert'),
      // Revert and reset both write history: they sit below one separator, so
      // the copy entries above are never one slip away from a rewrite.
      separatorBefore: true,
      danger: true,
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openRevert(value),
    },
    {
      id: 'reset',
      label: env.t('menu.resetToHere'),
      icon: menuIcon('reset'),
      // Destructive: separated from the entries above it.
      separatorBefore: true,
      danger: true,
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openReset(value),
    },
  ]
}
