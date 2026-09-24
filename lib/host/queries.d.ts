/**
 * Read-only query endpoint: history / diff / show / branches / tags / authors
 * / last-commit-message / worktree-stats.
 */
import type { SnapshotDeps, GitPanelConfig } from './core.ts';
import type { GitQueryRequest, GitQueryResponse } from './types.ts';
export declare function runQuery(deps: SnapshotDeps, config: GitPanelConfig, request: GitQueryRequest): Promise<GitQueryResponse>;
