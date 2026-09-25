/**
 * GitAction → command sequence construction + execution.
 */
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
/** Execute a management action, returning the fresh snapshot on success. */
export declare function runAction(deps: SnapshotDeps, config: GitPanelConfig, request: GitActionRequest): Promise<GitActionResult>;
