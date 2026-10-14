/**
 * Client-side re-export of the host wire types. The host is the authoritative
 * source (src/host/types.ts); this file mirrors the type surface so client
 * modules import from one place without reaching across into host code.
 */
export type {
  GitSnapshot, GitSnapshotResult, GitSnapshotRequest, GitFailure, GitCommit, GraphCommit, GitRef,
  GitChange, GitChangeStatus, GitAction, GitActionRequest, GitActionResult, GitErrorCode,
  GitQuery, GitQueryRequest, GitQueryResponse, GitQueryResult, GitBranch, GitFileStat, WorktreeStats, StashEntry,
  GitVersionRequest, GitVersionInfo, DiffViewMode, GraphStyle, DirEntry, ResetMode,
  GitSuggestRequest, GitSuggestResult, GitRemote, RemoteHostKind,
} from '../host/types.js'

export { imageMimeFor, SUGGEST_LIMITS, DIFF_CONTEXT_MAX } from '../host/types.js'
import type { GitQueryResult } from '../host/types.js'

/**
 * The diff query's payload as the views carry it: text and new-side line count
 * travel together (they come from one query and are cleared together), so the
 * projection is derived from the wire type instead of being respelled per view.
 */
export type GitDiffPayload = Pick<Extract<GitQueryResult, { kind: 'diff' }>, 'text' | 'newLines'>
