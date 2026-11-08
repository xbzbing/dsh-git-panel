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
  /** Open the "delete branch" confirmation for one local branch (issue #112);
   * the safe `-d` runs first and only an unmerged refusal unlocks the forced
   * `-D` step. */
  readonly openBranchDelete: (value: BranchTargetValue) => void
  /** Open the "delete remote branch" confirmation for one remote row. The host
   * resolves the tracking ref to a configured remote; nothing local is deleted. */
  readonly openRemoteBranchDelete: (value: BranchTargetValue) => void
  /** Open the "create branch" form for one start point — a branch row's tip or
   * a commit row's hash (issue #118). The branch is created without switching
   * to it; `label` is what the dialog shows, `start` what the host resolves. */
  readonly openBranchCreate: (target: { readonly start: string; readonly label: string }) => void
  /** Open the merge confirmation: the row's ref merges into the current
   * branch (issue #118). Same `start`/`label` split as the create form. */
  readonly openBranchMerge: (target: { readonly start: string; readonly label: string }) => void
  /** Open the cherry-pick confirmation for one commit onto the current
   * branch (issue #118). */
  readonly openCherryPick: (value: CommitTargetValue) => void
  /** Put the commit's reference into the session's composer (quote.ts). */
  readonly quote: (text: string) => void
}

/** Whether a write is in flight: switching, resetting and reverting all move the
 * work tree or HEAD, so they are offered but disabled while busy. */
export interface OverviewMenuFacts {
  readonly busy: boolean
  /** The short hash HEAD resolves to: checking out that commit would detach a
   * HEAD that is already there, so the entry is not offered for it. Short
   * because that is what the snapshot carries (`rev-parse --short HEAD`). */
  readonly head?: string | null
  /** The host declared `capabilities.commitCheckout`. */
  readonly commitCheckout?: boolean
  /** The host declared `capabilities.branchDelete`. */
  readonly branchDelete?: boolean
  /** The host declared `capabilities.remoteBranchDelete`. */
  readonly remoteBranchDelete?: boolean
  /** The host declared `capabilities.branchCreate` / `branchMerge` /
   * `cherryPick` (issue #118). */
  readonly branchCreate?: boolean
  readonly branchMerge?: boolean
  readonly cherryPick?: boolean
  /** The checked-out local branch; null on a detached HEAD. Merge and pick
   * land on the current branch, so their entries are offered only while one
   * exists. */
  readonly currentBranch?: string | null
}

/** Branch-row entries: switch, create / merge (issue #118), history filter,
 * copy, then the fenced delete entries. */
export function branchMenuActions(
  value: BranchTargetValue, env: MenuEnv, cmds: OverviewMenuCommands, facts: OverviewMenuFacts,
): MenuAction[] {
  const group: MenuAction[] = []
  // A tag row reaches this builder through the shared row renderer. Its
  // `isCurrent` is false and its name is not in the switch map, so the entries
  // that address a local branch are gated on `isTag` explicitly rather than
  // relying on a silent no-op lookup.
  const isBranch = value.isTag !== true
  if (isBranch && !value.isCurrent) {
    group.push({
      id: 'switch-branch',
      label: env.t(value.isRemote ? 'menu.switchToTracking' : 'menu.switchBranch'),
      icon: menuIcon('branch'),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.switchBranch(value),
    })
  }
  // The row's addressable ref (issue #118): local rows fall back to their
  // short name — git resolves it and the host revalidates it — while a remote
  // row needs the full tracking ref, because `origin/x` is display text until
  // it is named as `refs/remotes/origin/x` (a same-named tag or local branch
  // must never be picked up instead). A row that cannot produce one gets
  // neither entry below rather than an address git could misread.
  const start = value.isRemote
    ? (value.ref?.startsWith('refs/remotes/') === true ? value.ref : null)
    : (value.ref ?? value.name)
  // Create a branch at this row's tip without switching to it: a pure ref
  // write like tag-create, gated on the host capability. The current branch
  // keeps its entry — starting a branch from the one you are on is the common
  // case, and creating one moves nothing.
  if (facts.branchCreate === true && isBranch && start !== null) {
    group.push({
      id: 'create-branch',
      label: env.t('menu.createBranchFrom'),
      icon: menuIcon('branch'),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openBranchCreate({ start, label: value.name }),
    })
  }
  // Merge this row's branch into the current one: never the row naming the
  // branch already checked out (a no-op), and only while HEAD sits on a local
  // branch with somewhere to land. A remote row merges through its full
  // tracking ref, so `origin/main` on a `main` behind its upstream fast-forwards
  // without a same-named local tag shadowing the argument.
  if (facts.branchMerge === true && isBranch && start !== null
    && facts.currentBranch != null && !value.isCurrent) {
    group.push({
      id: 'merge-branch',
      label: env.t('menu.mergeBranch'),
      icon: menuIcon('merge'),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openBranchMerge({ start, label: value.name }),
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
  // Local branches only: the panel deletes a ref under `refs/heads` and never
  // touches the remote, so a remote row has nothing this entry could delete.
  // Tags share the branch list's row renderer, so they reach this builder too;
  // a tag delete has its own path, and `git branch -d <tag>` would name a
  // same-named branch or fail. The checked-out branch is git's own refusal
  // (`branch-checked-out`), but the row already says HEAD, so the entry is not
  // offered for it at all.
  if (facts.branchDelete === true && isBranch && !value.isRemote && !value.isCurrent) {
    group.push({
      id: 'delete-branch',
      label: env.t('menu.deleteBranch'),
      icon: menuIcon('delete'),
      // Below one separator: the delete is never one slip away from "copy".
      separatorBefore: true,
      danger: true,
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openBranchDelete(value),
    })
  }
  // A remote row can only be deleted on its server, and the entry needs the
  // full tracking ref to name it: the row's short name is ambiguous when a
  // remote name itself contains a slash. Older host data without `ref` keeps
  // the entry out instead of guessing.
  if (facts.remoteBranchDelete === true && value.isRemote && value.ref?.startsWith('refs/remotes/') === true) {
    group.push({
      id: 'delete-remote-branch',
      label: env.t('menu.deleteRemoteBranch'),
      icon: menuIcon('delete'),
      separatorBefore: true,
      danger: true,
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openRemoteBranchDelete(value),
    })
  }
  return group
}

/** Commit-row entries: copy identities and text, then the write dialogs —
 * tag / branch creation at the commit, checkout, cherry-pick (issue #118), and
 * the fenced revert / reset band. */
export function commitMenuActions(
  value: CommitTargetValue, env: MenuEnv, cmds: OverviewMenuCommands, facts: OverviewMenuFacts,
): MenuAction[] {
  // The snapshot carries HEAD as the *short* hash and the row carries the full
  // one, so equality would never hold: compare as a prefix. A row on HEAD's
  // commit would otherwise be offered a detach that lands nowhere.
  const atHead = facts.head !== undefined && facts.head !== null && facts.head !== ''
    && value.hash.startsWith(facts.head)
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
    // Create a branch pointing at this commit, without checking it out: the
    // start point is the full hash, so no ref of the same name can shadow it.
    ...(facts.branchCreate === true ? [{
      id: 'create-branch',
      label: env.t('menu.createBranchHere'),
      icon: menuIcon('branch'),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openBranchCreate({ start: value.hash, label: value.shortHash }),
    }] : []),
    ...(atHead || facts.commitCheckout !== true ? [] : [{
      id: 'checkout',
      label: env.t('menu.checkoutCommit'),
      icon: menuIcon('checkout'),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openCheckout(value),
    }]),
    // Apply this commit's change onto the current branch as a new commit.
    // Offered only while HEAD sits on a local branch: a detached HEAD would
    // take the picked commit nowhere the user can follow.
    ...(facts.cherryPick === true && facts.currentBranch != null ? [{
      id: 'cherry-pick',
      label: env.t('menu.cherryPickCommit'),
      icon: menuIcon('pick'),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openCherryPick(value),
    }] : []),
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
      // Revert already opened the destructive band: a second separator here
      // would split the two rewrites instead of fencing them off together.
      danger: true,
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openReset(value),
    },
  ]
}
