/**
 * dsh-git-panel host wire data model — the authoritative type source.
 * The client half (src/client/rpc.ts) reuses these types directly, so the
 * wire contract has a single definition and cannot drift.
 */
/** Wire request: the browser sends only session identity, never a path. */
export interface GitSnapshotRequest {
    readonly sessionId: string;
}
export type GitSnapshotResult = {
    readonly ok: true;
    readonly value: GitSnapshot;
} | {
    readonly ok: false;
    readonly error: GitFailure;
};
export type GitFailure = {
    readonly code: 'session-not-found';
    readonly sessionId: string;
} | {
    readonly code: 'cwd-unavailable';
    readonly sessionId: string;
} | {
    readonly code: 'not-a-git-repo';
    readonly cwd?: string;
} | {
    readonly code: 'git-unavailable';
    readonly detail: string;
} | {
    readonly code: 'timeout';
};
/** Immutable snapshot of one repository's status at `checkedAt`. */
export interface GitSnapshot {
    /** Realpath of the repository root (work tree top). */
    readonly root: string;
    /** Current branch name; null when detached. */
    readonly branch: string | null;
    /** Short HEAD hash; null when the repository has no commits (unborn). */
    readonly head: string | null;
    /** True when the repository has no commits yet. */
    readonly unborn: boolean;
    /** staged + modified + untracked > 0. */
    readonly dirty: boolean;
    readonly staged: number;
    readonly modified: number;
    readonly untracked: number;
    readonly ahead: number;
    readonly behind: number;
    readonly lastCommit: GitCommit | null;
    readonly changes: readonly GitChange[];
    /** True when the change list was capped at maxChanges. */
    readonly truncated: boolean;
    /** Polling interval the client should use after this snapshot (0 = off). */
    readonly refreshIntervalMs: number;
    /** Epoch millis of the snapshot. */
    readonly checkedAt: number;
}
export interface GitCommit {
    readonly hash: string;
    readonly shortHash: string;
    readonly subject: string;
    readonly author: string;
    readonly dateIso: string;
}
/** A commit with parent links and ref decorations (graph rendering). */
export interface GraphCommit extends GitCommit {
    readonly parents: readonly string[];
    readonly refs: readonly GitRef[];
}
export interface GitRef {
    readonly kind: 'branch' | 'remote' | 'tag';
    readonly name: string;
    /** True for the `HEAD -> name` current branch. */
    readonly head: boolean;
}
export type GitChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'typechange';
/**
 * One changed-file entry. A mixed porcelain XY (e.g. MM/AM) is split into two
 * entries: a `staged: true` side (X column) and a `staged: false` side (Y
 * column), so the UI can list "Staged" vs "Changes" IDE-style.
 */
export interface GitChange {
    readonly path: string;
    readonly status: GitChangeStatus;
    readonly staged: boolean;
    readonly isDirectory: boolean;
}
export type GitAction = {
    readonly kind: 'stage';
    readonly paths: readonly string[];
} | {
    readonly kind: 'stage-all';
} | {
    readonly kind: 'unstage';
    readonly paths: readonly string[];
} | {
    readonly kind: 'unstage-all';
} | {
    readonly kind: 'discard';
    readonly paths: readonly string[];
} | {
    readonly kind: 'commit';
    readonly message: string;
    /** Commit only these paths; absent/empty commits everything staged. */
    readonly paths?: readonly string[];
    /** True → git commit --amend (replace the previous commit). */
    readonly amend?: boolean;
} | {
    readonly kind: 'branch-checkout';
    readonly name: string;
} | {
    readonly kind: 'fetch';
};
export type GitErrorCode = 'session-not-found' | 'cwd-unavailable' | 'not-a-git-repo' | 'git-unavailable' | 'invalid-path' | 'invalid-name' | 'git-error' | 'timeout' | 'empty-message' | 'local-changes-block';
export type GitActionResult = {
    readonly ok: true;
    readonly snapshot: GitSnapshot;
    readonly output?: string;
} | {
    readonly ok: false;
    readonly error: {
        readonly code: GitErrorCode;
        readonly message?: string;
    };
};
export interface GitActionRequest {
    readonly sessionId: string;
    readonly action: GitAction;
}
export type GitQuery = {
    readonly kind: 'history';
    readonly limit: number;
    readonly skip: number;
    /** Optional ref filter (branch/remote/tag); absent = --all. */
    readonly ref?: string;
    /** Text search: 7+ hex chars = hash prefix jump; else message regex (-i -E). */
    readonly search?: string;
    /** Author filter (--author). */
    readonly author?: string;
    /** Date lower bound (--since). */
    readonly since?: string;
} | {
    readonly kind: 'diff';
    readonly path: string;
    readonly base: 'worktree' | 'staged';
    readonly context?: number;
} | {
    readonly kind: 'diff';
    readonly path: string;
    readonly base: 'commit';
    readonly commit: string;
    readonly context?: number;
} | {
    readonly kind: 'show';
    readonly ref: string;
} | {
    readonly kind: 'branches';
} | {
    readonly kind: 'tags';
} | {
    readonly kind: 'authors';
} | {
    readonly kind: 'last-commit-message';
} | {
    readonly kind: 'worktree-stats';
};
/** One commit's changed-file line (from --name-status). */
export interface GitFileStat {
    readonly path: string;
    readonly status: GitChangeStatus;
}
export interface GitBranch {
    readonly name: string;
    readonly shortHash: string | null;
    readonly ahead?: number;
    readonly behind?: number;
}
/** Working-tree statistics for the changes page header. */
export interface WorktreeStats {
    /** Distinct changed-file paths (staged ∪ modified ∪ untracked). */
    readonly fileCount: number;
    readonly staged: number;
    readonly modified: number;
    readonly untracked: number;
    /** Summed added lines across worktree + index diff (binary skipped). */
    readonly insertions: number;
    /** Summed deleted lines. */
    readonly deletions: number;
    /** Max mtime (epoch ms) among changed files; null when none/unavailable. */
    readonly lastChangeAt: number | null;
    /** HEAD commit time ISO; null when unborn. */
    readonly headCommittedAt: string | null;
}
export type GitQueryResult = {
    readonly kind: 'history';
    readonly commits: readonly GraphCommit[];
    readonly total: number;
} | {
    readonly kind: 'diff';
    readonly path: string;
    readonly text: string;
} | {
    readonly kind: 'show';
    readonly ref: string;
    readonly commit: GitCommit | null;
    /** Full commit body (without the subject line); right-pane comment. */
    readonly body: string;
    readonly stats: readonly GitFileStat[];
} | {
    readonly kind: 'branches';
    readonly current: string | null;
    readonly defaultBranch: string | null;
    readonly local: readonly GitBranch[];
    readonly remote: readonly GitBranch[];
} | {
    readonly kind: 'tags';
    readonly tags: readonly GitBranch[];
} | {
    readonly kind: 'authors';
    readonly authors: readonly string[];
} | {
    readonly kind: 'last-commit-message';
    readonly message: string;
} | {
    readonly kind: 'worktree-stats';
    readonly stats: WorktreeStats;
};
export type GitQueryResponse = {
    readonly ok: true;
    readonly value: GitQueryResult;
} | {
    readonly ok: false;
    readonly error: {
        readonly code: GitErrorCode;
        readonly message?: string;
    };
};
export interface GitQueryRequest {
    readonly sessionId: string;
    readonly query: GitQuery;
}
export interface GitVersionRequest {
    /** True → query the GitHub releases API; false/absent → local view only. */
    readonly check?: boolean;
}
export interface GitVersionInfo {
    readonly current: string;
    readonly repositoryUrl?: string;
    readonly latest?: string;
    readonly updateAvailable: boolean;
    readonly releaseUrl?: string;
    readonly checkedRemote: boolean;
    readonly error?: string;
}
