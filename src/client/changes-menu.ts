/**
 * Menu actions for the changes list: one changed file, one directory row, one
 * stash row.
 *
 * Pure builders like the overview's (overview-menu.ts): the panel supplies the
 * runs, and every destructive entry opens the dialog the inline button opens
 * instead of acting from the menu. The multi-select rule is decided here from
 * the captured pick set (Q4): the row is inside the checked set, and the set has
 * more than one entry, the actions target the whole set; otherwise just the row.
 */
import type { ChangeDirTargetValue, ChangeTargetValue, StashTargetValue } from './menu-owners.js'
import type { MenuAction } from './menu-types.js'
import type { GitKey } from './locales.js'
import { copyText } from './menu-actions.js'
import type { MenuEnv } from './menu-actions.js'
import { changeKey, pickDiscardTargets, pickStageTargets, pickUnstageTargets } from './selection-keys.js'

/** The changes tab's own runs. */
export interface ChangesMenuCommands {
  /** Open the row's diff (path + side). */
  readonly openDiff: (path: string, staged: boolean) => void
  /** Stage / unstage a path list. */
  readonly stage: (paths: readonly string[], staged: boolean) => void
  /** Open the discard confirm for a path list (working-tree rows only). */
  readonly openDiscard: (paths: readonly string[]) => void
  /** Apply / pop / drop one stash. */
  readonly stashApply: (sha: string) => void
  readonly stashPop: (sha: string) => void
  /** Open the stash-drop confirm. */
  readonly openStashDrop: (sha: string, label: string) => void
}

/** Live state the entries read. */
export interface ChangesMenuFacts {
  readonly busy: boolean
}

/** Change-row entries. `pick` is the checked set (keys `path:s` / `path:w`);
 * an empty / single / outside pick falls back to the row itself. */
export function changeMenuActions(
  value: ChangeTargetValue, env: MenuEnv, cmds: ChangesMenuCommands, facts: ChangesMenuFacts,
  pick: ReadonlySet<string>,
): MenuAction[] {
  const key = changeKey(value)
  const group = pick.has(key) && pick.size > 1
  // Each direction acts only on its own side. A path can be listed twice (a
  // file edited after being partly staged), and handing the other side's path to
  // `git add` would stage the whole file — wiping the hunks `git add -p` left in
  // the index. Discard is a working-tree operation for the same reason, and an
  // index-side pick has nothing to drop, so its count must not promise more
  // files than the action can touch.
  const paths: readonly string[] = group
    ? (value.staged ? pickUnstageTargets(pick) : pickStageTargets(pick))
    : [value.path]
  const discardPaths: readonly string[] = group ? pickDiscardTargets(pick).paths : [value.path]
  const groupLabel = (key: GitKey): string => env.t(key, { n: paths.length })
  return [
    {
      id: 'open-diff',
      label: env.t('menu.openDiff'),
      failureLabel: env.t('overview.diffFailed'),
      run: () => cmds.openDiff(value.path, value.staged),
    },
    {
      id: 'stage',
      label: groupLabel(value.staged ? 'menu.unstagePicked' : 'menu.stagePicked'),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.stage(paths, value.staged),
    },
    // Discard is a working-tree operation: an index-side row has nothing to
    // discard, and the confirm is the batch one the toolbar opens.
    ...(value.staged || discardPaths.length === 0 ? [] : [{
      id: 'discard',
      label: env.t('menu.discardPicked', { n: discardPaths.length }),
      danger: true,
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openDiscard(discardPaths),
    }]),
  ]
}

/** Directory-row entries: stage / unstage / discard the subtree, exactly what
 * the row's own buttons do. */
export function changeDirMenuActions(
  value: ChangeDirTargetValue, env: MenuEnv, cmds: ChangesMenuCommands, facts: ChangesMenuFacts,
): MenuAction[] {
  return [
    {
      id: 'stage-dir',
      label: env.t(value.staged ? 'menu.unstagePicked' : 'menu.stagePicked', { n: value.paths.length }),
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.stage(value.paths, value.staged),
    },
    ...(value.discardable.length === 0 ? [] : [{
      id: 'discard-dir',
      label: env.t('menu.discardPicked', { n: value.discardable.length }),
      danger: true,
      disabled: facts.busy,
      failureLabel: env.t('common.operationFailed'),
      run: () => cmds.openDiscard(value.discardable),
    }]),
  ]
}

/** Stash-row entries: apply / pop / drop (drop opens the confirm) / copy. */
export function stashMenuActions(
  value: StashTargetValue, env: MenuEnv, cmds: ChangesMenuCommands, facts: ChangesMenuFacts,
): MenuAction[] {
  return [
    { id: 'stash-apply', label: env.t('menu.stashApply'), disabled: facts.busy, failureLabel: env.t('common.operationFailed'), run: () => cmds.stashApply(value.sha) },
    { id: 'stash-pop', label: env.t('menu.stashPop'), disabled: facts.busy, failureLabel: env.t('common.operationFailed'), run: () => cmds.stashPop(value.sha) },
    { id: 'stash-drop', label: env.t('menu.stashDrop'), danger: true, disabled: facts.busy, failureLabel: env.t('common.operationFailed'), run: () => cmds.openStashDrop(value.sha, value.label) },
    { id: 'copy-message', label: env.t('menu.copySubject'), failureLabel: env.t('menu.copyFailed'), run: () => copyText(env, value.label) },
  ]
}
