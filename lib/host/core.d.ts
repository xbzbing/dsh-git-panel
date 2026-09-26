import type { GitRunner } from './git.ts';
import type { DiffViewMode, GitChange, GitErrorCode, GitSnapshotResult } from './types.ts';
export interface GitPanelConfig {
    readonly timeoutMs: number;
    /** Per-command stdout cap; also the per-side image-diff payload cap. */
    readonly maxBytes: number;
    readonly maxChanges: number;
    readonly refreshIntervalMs: number;
    /** Whether the input-bar git marker pill is shown. */
    readonly showInputPill: boolean;
    /** Default diff layout the views open with (user can switch per-diff). */
    readonly defaultDiffView: DiffViewMode;
}
export declare const DEFAULT_CONFIG: GitPanelConfig;
export declare function normalizeConfig(raw: unknown): GitPanelConfig;
/** Read the default-diff-view field, unwrapping a schemastery volatile ref. */
export declare function readDiffView(value: unknown, fallback: DiffViewMode): DiffViewMode;
/**
 * Read a boolean config field, unwrapping a schemastery volatile reference
 * (`{ get() }`) so a live-editable toggle reflects the latest value. Absent or
 * unrecognized shapes fall back to the default.
 */
export declare function readBool(value: unknown, fallback: boolean): boolean;
/** Host capabilities the snapshot needs, structurally injected. */
export interface SnapshotDeps {
    readonly run: GitRunner;
    readonly fs: {
        realpath(path: string): Promise<string>;
        stat(path: string): Promise<{
            mtimeMs: number;
            size: number;
        }>;
        /** Raw bytes (no encoding) — image sides for the image-diff query. */
        readFile(path: string): Promise<Buffer>;
        /** Best-effort unlink (force) — temp-blob cleanup. */
        remove(path: string): Promise<void>;
    };
    readonly sessions: {
        liveCwd(sessionId: string): string | undefined;
        persistedMeta(sessionId: string): Promise<{
            cwd?: string;
        } | undefined>;
    };
    readonly signal?: AbortSignal;
    /**
     * Optional cwd→root cache, keyed by the resolved cwd. Resolving the work-tree
     * root runs a `git rev-parse` + `realpath` on every call; sharing this map
     * across a session's snapshot/query/run calls collapses that to one spawn per
     * distinct cwd (a session's cwd is effectively stable).
     */
    readonly rootCache?: Map<string, string>;
    /**
     * Optional negative cache (cwd → expiry epoch ms) for non-repo cwds, so a
     * session whose directory is not a git repo does not spawn `rev-parse` on
     * every 30s poll. Short-lived (see NEG_CACHE_MS) so a repo created under the
     * cwd is picked up soon after.
     */
    readonly rootNegCache?: Map<string, number>;
}
export type WorkspaceResolution = {
    readonly ok: true;
    readonly root: string;
} | {
    readonly ok: false;
    readonly failure: GitSnapshotResult & {
        ok: false;
    };
};
/** Resolve the git work-tree root for a session's cwd. */
export declare function resolveWorkspace(deps: SnapshotDeps, sessionId: string): Promise<WorkspaceResolution>;
/** Run one git command; a spawn-level failure returns { failure }. */
export declare function runCommand(runner: GitRunner, argv: readonly string[], cwd: string, _label: string, signal?: AbortSignal): Promise<{
    run: Awaited<ReturnType<GitRunner['run']>>;
} | {
    failure: unknown;
}>;
/**
 * Collapse a workspace-resolution failure into the `{ code, message }` shape
 * the run/query endpoints return. `GitFailure` already carries only endpoint
 * codes, so no membership test is needed (the previous per-endpoint ternary
 * that re-listed every code was always true — dead). `detail` becomes message.
 */
export declare function mapWorkspaceFailure(failure: GitSnapshotResult & {
    ok: false;
}): {
    code: GitErrorCode;
    message?: string;
};
/** Produce a full snapshot for a session. */
export declare function snapshotForSession(deps: SnapshotDeps, config: GitPanelConfig, sessionId: string): Promise<GitSnapshotResult>;
/** Max mtime among changed files (epoch ms), capped for large sets. */
export declare function maxChangeMtime(deps: SnapshotDeps, root: string, changes: readonly GitChange[], cap?: number): Promise<number | null>;
