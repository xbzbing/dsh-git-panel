import type { SnapshotDeps, GitPanelConfig } from './core.ts';
import { isSafePath } from './validate.ts';
import type { GitAction, GitActionRequest, GitActionResult, GitErrorCode } from './types.ts';
export { isSafePath };
interface CommandPlan {
    readonly argv: readonly (readonly string[])[];
}
type PlanResult = CommandPlan | {
    readonly error: GitErrorCode;
    readonly message?: string;
};
/** Build the git command sequence for an action. */
export declare function planAction(action: GitAction, unborn: boolean): PlanResult;
/**
 * Classify a non-zero git exit into a wire error code + message. Order is
 * semantic and must not be reshuffled:
 *  - conflict first — a stash apply/pop conflict prints both "CONFLICT …" and
 *    "no changes added to commit", so it must win over the nothing-to-commit
 *    rule below (git keeps the stash entry on conflict → recoverable).
 *  - index.lock busy (another process holds the lock).
 *  - nothing-to-commit / no changes added (a real commit no-op).
 *  - not-found (missing ref / tag / stash).
 *  - local-changes-block (a dirty-worktree refusal; neutral wording covers both
 *    `git checkout` and `git stash apply`).
 *  - git-error fallback (surface the repo's own stderr).
 */
export declare function classifyActionFailure(stdout: string, stderr: string, exitCode: number): {
    code: GitErrorCode;
    message: string;
};
/** Execute a management action, returning the fresh snapshot on success. */
export declare function runAction(deps: SnapshotDeps, config: GitPanelConfig, request: GitActionRequest): Promise<GitActionResult>;
