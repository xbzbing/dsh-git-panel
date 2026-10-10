/**
 * dsh-git-panel host wire data model — the authoritative type source.
 * The client half (src/client/rpc.ts) reuses these types directly, so the
 * wire contract has a single definition and cannot drift.
 */

// ── snapshot ─────────────────────────────────────────────────────────────

/** Diff layout: `unified` = single inline column, `split` = side-by-side. */
export type DiffViewMode = 'unified' | 'split'

/** Commit-graph line style: `compact` = converge a shared ancestor into one
 * lane (git log --graph); `parallel` = keep each merge's first parent in its
 * own lane, converging only at the ancestor (VSCode / GUI tools). */
export type GraphStyle = 'compact' | 'parallel'

/** Wire request: the browser sends only session identity, never a path. */
export interface GitSnapshotRequest {
  readonly sessionId: string
}

export type GitSnapshotResult =
  | { readonly ok: true; readonly value: GitSnapshot }
  | { readonly ok: false; readonly error: GitFailure }

export type GitFailure =
  | { readonly code: 'cwd-unavailable'; readonly sessionId: string }
  | { readonly code: 'not-a-git-repo'; readonly cwd?: string; readonly showInputPill?: boolean }
  // git not installed / not on PATH: the spawn itself failed, so neither the
  // work-tree root nor repo membership can be learned from git. `cwd` carries
  // the session directory (so the browser can still file-browse it); `isGitRepo`
  // is a filesystem-only probe (`.git` found walking up) telling the client
  // whether to surface the "git not installed" notice (inside a repo) or
  // degrade silently to the file browser (outside one).
  | { readonly code: 'git-unavailable'; readonly detail: string; readonly cwd?: string; readonly isGitRepo?: boolean }
  | { readonly code: 'timeout' }
  | { readonly code: 'cancelled' }

/** Immutable snapshot of one repository's status at `checkedAt`. */
export interface GitSnapshot {
  /** Realpath of the repository root (work tree top). */
  readonly root: string
  /** Current branch name; null when detached. */
  readonly branch: string | null
  /** Short HEAD hash; null when the repository has no commits (unborn). */
  readonly head: string | null
  /** True when the repository has no commits yet. */
  readonly unborn: boolean
  /** staged + modified + untracked > 0. */
  readonly dirty: boolean
  readonly staged: number
  readonly modified: number
  readonly untracked: number
  readonly ahead: number
  readonly behind: number
  readonly lastCommit: GitCommit | null
  readonly changes: readonly GitChange[]
  /** Working-tree statistics for the changes-page header (single source). */
  readonly stats: WorktreeStats
  /** True when the change list was capped at maxChanges. */
  readonly truncated: boolean
  /** Polling interval the client should use after this snapshot (0 = off). */
  readonly refreshIntervalMs: number
  /** Whether the input-bar git marker pill should render (user preference). */
  readonly showInputPill: boolean
  /** Default diff layout the views open with (user preference). */
  readonly defaultDiffView: DiffViewMode
  /** Commit-graph line style (user preference). */
  readonly graphStyle: GraphStyle
  /** Whether the commit box shows the AI-suggest button (user preference). */
  readonly suggestEnabled: boolean
  /** Epoch millis of the snapshot. */
  readonly checkedAt: number
}

export interface GitCommit {
  readonly hash: string
  readonly shortHash: string
  readonly subject: string
  readonly author: string
  readonly dateIso: string
}

/** A commit with parent links and ref decorations (graph rendering). */
export interface GraphCommit extends GitCommit {
  readonly parents: readonly string[]
  readonly refs: readonly GitRef[]
}

export interface GitRef {
  readonly kind: 'branch' | 'remote' | 'tag'
  readonly name: string
  /** True for the `HEAD -> name` current branch. */
  readonly head: boolean
}

export type GitChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  | 'typechange'

/**
 * One changed-file entry. A mixed porcelain XY (e.g. MM/AM) is split into two
 * entries: a `staged: true` side (X column) and a `staged: false` side (Y
 * column), so the UI can list "Staged" vs "Changes" IDE-style.
 */
export interface GitChange {
  readonly path: string
  readonly status: GitChangeStatus
  readonly staged: boolean
  readonly isDirectory: boolean
}

// ── actions (run endpoint) ────────────────────────────────────────────────

export type GitAction =
  | { readonly kind: 'stage'; readonly paths: readonly string[] }
  | { readonly kind: 'stage-all' }
  | { readonly kind: 'unstage'; readonly paths: readonly string[] }
  | { readonly kind: 'unstage-all' }
  | { readonly kind: 'discard'; readonly paths: readonly string[] }
  | {
    readonly kind: 'commit'
    readonly message: string
    /** Commit only these paths; absent/empty commits everything staged. */
    readonly paths?: readonly string[]
    /** True → git commit --amend (replace the previous commit). */
    readonly amend?: boolean
  }
  | { readonly kind: 'branch-checkout'; readonly name: string }
  | { readonly kind: 'fetch' }
  // Tag write operations (issue #12). `message` non-empty → annotated tag (-a).
  | { readonly kind: 'tag-create'; readonly name: string; readonly commit: string; readonly message?: string }
  | { readonly kind: 'tag-delete'; readonly name: string }
  // Stash operations (issue #12). `index` is the stash stack position (0 = top);
  // `sha` is the stash commit the client saw, so the host can reject a stale
  // index (the stack may have shifted under a shared worktree) before acting.
  | { readonly kind: 'stash-push'; readonly message?: string }
  | { readonly kind: 'stash-apply'; readonly index: number; readonly sha: string }
  | { readonly kind: 'stash-pop'; readonly index: number; readonly sha: string }
  | { readonly kind: 'stash-drop'; readonly index: number; readonly sha: string }
  // Commit undo operations (issue #12 P2). `revert` appends a reverse commit
  // (keeps the work tree); `reset` moves the current branch HEAD to `commit`.
  // `hard` additionally discards every uncommitted change — the one mode that
  // can wipe in-flight work (incl. the dsh AI's), so the UI gates it hardest.
  | { readonly kind: 'revert'; readonly commit: string }
  | { readonly kind: 'reset'; readonly commit: string; readonly mode: ResetMode }

/** `git reset` modes, from least to most destructive. Single source so the
 * client dialog and the command builder cannot drift. */
export type ResetMode = 'soft' | 'mixed' | 'hard'

export type GitErrorCode =
  | 'cwd-unavailable'
  | 'not-a-git-repo'
  | 'git-unavailable'
  | 'invalid-path'
  | 'invalid-name'
  | 'invalid-index'
  | 'git-error'
  | 'timeout'
  | 'cancelled'
  | 'empty-message'
  | 'local-changes-block'
  // Stash apply/pop left the work tree with merge conflicts (stash kept).
  | 'conflict'
  // A revert hit a content conflict and was auto-aborted (work tree restored).
  | 'revert-conflict'
  // A revert conflicted AND the auto-abort failed: the repo is still mid-revert.
  | 'revert-stuck'
  // Reverting a merge commit needs a mainline parent the panel can't choose.
  | 'revert-merge'
  // A named tag / stash entry does not exist.
  | 'not-found'
  // Another git process holds the index lock (.git/index.lock).
  | 'index-busy'
  // AI commit-message suggestion endpoint.
  | 'empty-diff'
  | 'llm-unavailable'
  | 'llm-error'
  | 'llm-output'
  | 'suggest-disabled'

export type GitActionResult =
  | { readonly ok: true; readonly snapshot: GitSnapshot; readonly output?: string }
  | { readonly ok: false; readonly error: { readonly code: GitErrorCode; readonly message?: string } }

export interface GitActionRequest {
  readonly sessionId: string
  readonly action: GitAction
}

// ── queries (read-only endpoint) ──────────────────────────────────────────

export type GitQuery =
  | {
    readonly kind: 'history'
    readonly limit: number
    readonly skip: number
    /** Optional ref filter (branch/remote/tag); absent = --all. */
    readonly ref?: string
    /** Text search: 7+ hex chars = hash prefix jump; else message regex (-i -E). */
    readonly search?: string
    /** Author filter (--author). */
    readonly author?: string
    /** Date lower bound (--since). */
    readonly since?: string
  }
  | { readonly kind: 'diff'; readonly path: string; readonly base: 'worktree' | 'staged'; readonly context?: number }
  | { readonly kind: 'diff'; readonly path: string; readonly base: 'commit'; readonly commit: string; readonly context?: number }
  // On-demand hidden-context expansion: a slice of the post-change file, by
  // 1-based new-side line numbers. `base`/`commit` mirror the diff request so
  // the revealed lines come from the exact version the diff compared against.
  | { readonly kind: 'file-lines'; readonly path: string; readonly base: 'worktree' | 'staged'; readonly start: number; readonly end: number }
  | { readonly kind: 'file-lines'; readonly path: string; readonly base: 'commit'; readonly commit: string; readonly start: number; readonly end: number }
  | { readonly kind: 'image-diff'; readonly path: string; readonly base: 'worktree' | 'staged' }
  | { readonly kind: 'image-diff'; readonly path: string; readonly base: 'commit'; readonly commit: string }
  // File browser: list one working-tree directory (lazy, one level down), and
  // read one working-tree file (text slice / image data URL / binary marker).
  // Both take an in-tree relative path; `''` is the repository root.
  | { readonly kind: 'dir-list'; readonly path: string }
  | { readonly kind: 'file-content'; readonly path: string }
  | { readonly kind: 'show'; readonly ref: string }
  | { readonly kind: 'branches' }
  | { readonly kind: 'tags' }
  | { readonly kind: 'stash-list' }
  | { readonly kind: 'authors' }
  | { readonly kind: 'last-commit-message' }
  | { readonly kind: 'worktree-stats' }

/** One entry in a `dir-list` result. */
export interface DirEntry {
  readonly name: string
  readonly dir: boolean
  /** File byte size; absent for directories. */
  readonly size?: number
  /** True when Git excludes an untracked item; absent outside a repository. */
  readonly ignored?: boolean
}

/** One commit's changed-file line (from --name-status). */
export interface GitFileStat {
  readonly path: string
  readonly status: GitChangeStatus
}

export interface GitBranch {
  readonly name: string
  readonly shortHash: string | null
  readonly ahead?: number
  readonly behind?: number
}

/** One entry in the stash stack (`git stash list`). */
export interface StashEntry {
  /** Stack position (0 = most recent). */
  readonly index: number
  /** The stash commit SHA — a stable id the index position is not (see run). */
  readonly sha: string
  /** The stash message (custom `-m` text, or the auto "WIP on …" subject). */
  readonly message: string
  /** Branch the stash was taken on; null when it could not be parsed. */
  readonly branch: string | null
  /** Human relative time (e.g. "2 hours ago"). */
  readonly relTime: string
}

/** Working-tree statistics for the changes page header. */
export interface WorktreeStats {
  /** Distinct changed-file paths (staged ∪ modified ∪ untracked). */
  readonly fileCount: number
  readonly staged: number
  readonly modified: number
  readonly untracked: number
  /** Summed added lines across worktree + index diff (binary skipped). */
  readonly insertions: number
  /** Summed deleted lines. */
  readonly deletions: number
  /** Max mtime (epoch ms) among changed files; null when none/unavailable. */
  readonly lastChangeAt: number | null
  /** HEAD commit time ISO; null when unborn. */
  readonly headCommittedAt: string | null
  /**
   * True when the per-file fan-outs were skipped because the change set was too
   * large (issue #16): `insertions` then omits untracked lines and
   * `lastChangeAt` is null. Counts (fileCount/staged/modified/untracked) and
   * tracked insertions/deletions stay exact.
   */
  readonly partial: boolean
}

export type GitQueryResult =
  | { readonly kind: 'history'; readonly commits: readonly GraphCommit[]; readonly total: number }
  | { readonly kind: 'diff'; readonly path: string; readonly text: string }
  // A slice of a file's post-change content for on-demand context expansion:
  // `lines` are 1-based new-side numbers `start..end` (clamped to the file);
  // `eof` marks that `end` reached the last line (no more to reveal below).
  | { readonly kind: 'file-lines'; readonly path: string; readonly start: number; readonly lines: readonly string[]; readonly eof: boolean }
  | {
    /**
     * Old/new images for a binary image diff, as data URLs. The sides mirror
     * what the text diff compares: worktree rows read index vs working file,
     * staged rows read HEAD vs index, commit rows read parent vs commit.
     */
    readonly kind: 'image-diff'
    readonly path: string
    /** null → the extension is not a browser-renderable image. */
    readonly mime: string | null
    /** Pre-change image; absent when that side does not exist (added/untracked/root). */
    readonly old?: string
    /** Post-change image; absent when that side does not exist (deleted). */
    readonly new?: string
    /** A side exceeded the byte cap, so no URLs are returned. */
    readonly tooLarge?: true
  }
  | {
    readonly kind: 'show'
    readonly ref: string
    readonly commit: GitCommit | null
    /** Full commit body (without the subject line); right-pane comment. */
    readonly body: string
    readonly stats: readonly GitFileStat[]
  }
  | { readonly kind: 'branches'; readonly current: string | null; readonly defaultBranch: string | null; readonly local: readonly GitBranch[]; readonly remote: readonly GitBranch[] }
  | { readonly kind: 'tags'; readonly tags: readonly GitBranch[] }
  | { readonly kind: 'stash-list'; readonly entries: readonly StashEntry[] }
  | { readonly kind: 'authors'; readonly authors: readonly string[] }
  | { readonly kind: 'last-commit-message'; readonly message: string }
  | { readonly kind: 'worktree-stats'; readonly stats: WorktreeStats }
  // File-browser directory listing (one level). `truncated` is set when the
  // entry count was capped.
  | { readonly kind: 'dir-list'; readonly path: string; readonly entries: readonly DirEntry[]; readonly truncated: boolean }
  // File-browser file content. Exactly one shape applies:
  //   text  → a UTF-8 text file (`content` is the whole file, `lines` its count)
  //   image → a browser-renderable image (`dataUrl` is a data: URL)
  //   binary→ neither (no preview); tooLarge → over the byte cap.
  | {
    readonly kind: 'file-content'
    readonly path: string
    readonly variant: 'text' | 'image' | 'binary'
    /** text variant: the file's full UTF-8 content. */
    readonly content?: string
    /** text variant: total line count. */
    readonly lines?: number
    /** image variant: a `data:<mime>;base64,…` URL. */
    readonly dataUrl?: string
    /** The file exceeded the byte cap, so no content is returned. */
    readonly tooLarge?: true
  }

export type GitQueryResponse =
  | { readonly ok: true; readonly value: GitQueryResult }
  | { readonly ok: false; readonly error: { readonly code: GitErrorCode; readonly message?: string } }

export interface GitQueryRequest {
  readonly sessionId: string
  readonly query: GitQuery
}

// ── AI commit-message suggestion ─────────────────────────────────────────

/**
 * Wire request for the suggest endpoint: ask the configured model to write a
 * commit message from the repository's uncommitted changes. `paths` restricts
 * the diff to the user's selection (bare repo-relative paths); absent means
 * all uncommitted changes.
 */
export interface GitSuggestRequest {
  readonly sessionId: string
  readonly paths?: readonly string[]
}

export type GitSuggestResult =
  | { readonly ok: true; readonly value: {
      /** The generated message, ready for the user to edit and commit. */
      readonly message: string
      /** Actual provider/model route used (display only). */
      readonly provider?: string
      readonly model?: string
      /** The diff exceeded the model input cap and was truncated. */
      readonly truncated?: boolean
    } }
  | { readonly ok: false; readonly error: { readonly code: GitErrorCode; readonly message?: string } }

/**
 * Extensions the image-diff query serves, mapped to MIME types. Part of the
 * query's contract, so both halves gate on this one list and cannot drift.
 */
export const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
}

/** MIME for a path's extension; null when it is not a served image type. */
export function imageMimeFor(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  return IMAGE_MIME[path.slice(dot + 1).toLowerCase()] ?? null
}

// ── version (update check) ────────────────────────────────────────────────

export interface GitVersionRequest {
  /** True → query the GitHub releases API; false/absent → local view only. */
  readonly check?: boolean
}

export interface GitVersionInfo {
  readonly current: string
  readonly repositoryUrl?: string
  readonly latest?: string
  readonly updateAvailable: boolean
  readonly releaseUrl?: string
  readonly checkedRemote: boolean
  readonly error?: string
}
