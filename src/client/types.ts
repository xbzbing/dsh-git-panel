/**
 * Client-side re-export of the host wire types. The host is the authoritative
 * source (src/host/types.ts); this file mirrors the type surface so client
 * modules import from one place without reaching across into host code.
 */
export type {
  GitSnapshot, GitSnapshotResult, GitSnapshotRequest, GitFailure, GitCommit, GraphCommit, GitRef,
  GitChange, GitChangeStatus, GitAction, GitActionRequest, GitActionResult, GitErrorCode,
  GitQuery, GitQueryRequest, GitQueryResponse, GitQueryResult, GitBranch, GitFileStat, WorktreeStats,
} from '../host/types.ts'
