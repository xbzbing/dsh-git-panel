import type { GitPanelConfig, SnapshotDeps } from './core.ts';
import type { GitSuggestRequest, GitSuggestResult } from './types.ts';
/** Generate a commit message for the session's uncommitted changes. */
export declare function runSuggest(deps: SnapshotDeps, config: GitPanelConfig, request: GitSuggestRequest): Promise<GitSuggestResult>;
