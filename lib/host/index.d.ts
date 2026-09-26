/**
 * dsh-git-panel host half: Cordis + typert Remote service.
 *
 * `GitPanelService` binds the `gitPanel` namespace and exposes three @Remote
 * endpoints (snapshot / run / query) that delegate to the framework-neutral
 * command layer. Host services (subprocess / sessions / sessionPersistence)
 * are adapted into a structural `SnapshotDeps` face.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { GitActionRequest, GitActionResult, GitQueryRequest, GitQueryResponse, GitSnapshotRequest, GitSnapshotResult, GitVersionInfo, GitVersionRequest } from './types.ts';
export type { GitSnapshot, GitSnapshotResult, GitSnapshotRequest, GitFailure, GitCommit, GraphCommit, GitRef, GitChange, GitChangeStatus, GitAction, GitActionRequest, GitActionResult, GitErrorCode, GitQuery, GitQueryRequest, GitQueryResponse, GitQueryResult, GitBranch, GitFileStat, WorktreeStats, GitVersionRequest, GitVersionInfo, DiffViewMode, } from './types.ts';
export { normalizeConfig, DEFAULT_CONFIG, snapshotForSession, resolveWorkspace } from './core.ts';
export { createGitRunner } from './git.ts';
export { parseStatus, parseGraphLog, parseBranches, parseNameStatus, sumNumstat } from './parser.ts';
export { isSafePath, planAction, runAction } from './actions.ts';
export { runQuery } from './queries.ts';
export { readVersionInfo, checkLatestVersion, compareVersions, parseRepository } from './version.ts';
export declare class GitPanelService extends TypertRemoteService {
    static inject: string[];
    /**
     * Config schema surfaced on the plugin detail page. `showInputPill` and
     * `defaultDiffView` are `.volatile()`, so the settings host renders them as
     * live-editable controls; the operational limits stay profile-only and out
     * of the UI form.
     */
    static Config: Schema<Schemastery.ObjectS<NoInfer<{
        showInputPill: Schema<boolean, boolean, "volatile-defined">;
        defaultDiffView: Schema<"split" | "unified", "split" | "unified", "volatile-defined">;
    }>>, Schemastery.ObjectT<NoInfer<{
        showInputPill: Schema<boolean, boolean, "volatile-defined">;
        defaultDiffView: Schema<"split" | "unified", "split" | "unified", "volatile-defined">;
    }>>, "plain">;
    private readonly deps;
    private config;
    private readonly rawConfig;
    constructor(ctx: Context, config: unknown);
    private buildDeps;
    snapshot(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult>;
    run(request: GitActionRequest, signal?: AbortSignal): Promise<GitActionResult>;
    query(request: GitQueryRequest, signal?: AbortSignal): Promise<GitQueryResponse>;
    version(request: GitVersionRequest): Promise<GitVersionInfo>;
    /** Re-read config so a live-edited volatile field (showInputPill) is current. */
    private liveConfig;
    private withSignal;
}
export default GitPanelService;
