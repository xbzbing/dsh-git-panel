/**
 * dsh-git-panel host half: Cordis + typert Remote service.
 *
 * `GitPanelService` binds the `gitPanel` namespace and exposes three @Remote
 * endpoints (snapshot / run / query) that delegate to the framework-neutral
 * command layer. Host services (subprocess / sessions / sessionPersistence)
 * are adapted into a structural `SnapshotDeps` face.
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { realpath, stat } from 'node:fs/promises'
import { createGitRunner, type SubprocessLike } from './git.ts'
import { normalizeConfig, snapshotForSession, type GitPanelConfig, type SnapshotDeps } from './core.ts'
import { runAction } from './actions.ts'
import { runQuery } from './queries.ts'
import type { GitActionRequest, GitActionResult, GitQueryRequest, GitQueryResponse, GitSnapshotRequest, GitSnapshotResult } from './types.ts'

export type {
  GitSnapshot, GitSnapshotResult, GitSnapshotRequest, GitFailure, GitCommit, GraphCommit, GitRef,
  GitChange, GitChangeStatus, GitAction, GitActionRequest, GitActionResult, GitErrorCode,
  GitQuery, GitQueryRequest, GitQueryResponse, GitQueryResult, GitBranch, GitFileStat, WorktreeStats,
} from './types.ts'
export { normalizeConfig, DEFAULT_CONFIG, snapshotForSession, resolveWorkspace } from './core.ts'
export { createGitRunner } from './git.ts'
export { parseStatus, parseGraphLog, parseBranches, parseNameStatus, sumNumstat } from './parser.ts'
export { isSafePath, planAction, runAction } from './actions.ts'
export { runQuery } from './queries.ts'

/** Structural slice of the Cordis sessions store (live cwd). */
interface SessionsService {
  get(id: string): { readonly header?: { readonly cwd?: string } } | undefined
}

/** Structural slice of the sessionPersistence service (persisted cwd). */
interface SessionPersistenceLike {
  stat(id: string): Promise<{ readonly header?: { readonly cwd?: string } } | undefined>
}

export class GitPanelService extends TypertRemoteService {
  static inject = ['subprocess', 'sessions', 'sessionPersistence']

  private readonly deps: SnapshotDeps
  private readonly config: GitPanelConfig

  constructor(ctx: Context, config: unknown) {
    super(ctx, 'gitPanel')
    this.config = normalizeConfig(config)
    this.deps = this.buildDeps(ctx, this.config)
  }

  private buildDeps(ctx: Context, config: GitPanelConfig): SnapshotDeps {
    const get = (key: string): unknown => (ctx as unknown as { get(k: string): unknown }).get(key)
    const subprocess = get('subprocess') as SubprocessLike | undefined
    if (subprocess === undefined) {
      return {
        run: { run: async () => { throw new Error('subprocess service unavailable') } },
        fs: { realpath, stat: async (p) => stat(p) },
        sessions: { liveCwd: () => undefined, persistedMeta: async () => undefined },
      }
    }
    const sessions = get('sessions') as SessionsService | undefined
    const persistence = get('sessionPersistence') as SessionPersistenceLike | undefined
    return {
      run: createGitRunner(subprocess, config.timeoutMs, config.maxBytes),
      fs: { realpath, stat: async (p) => stat(p) },
      sessions: {
        liveCwd: (id) => sessions?.get(id)?.header?.cwd,
        persistedMeta: async (id) => {
          if (persistence === undefined) return undefined
          try {
            const snap = await persistence.stat(id)
            return snap?.header?.cwd === undefined ? undefined : { cwd: snap.header.cwd }
          } catch {
            return undefined
          }
        },
      },
    }
  }

  @Remote('snapshot')
  async snapshot(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult> {
    return snapshotForSession(this.withSignal(signal), this.config, request.sessionId)
  }

  @Remote('run')
  async run(request: GitActionRequest, signal?: AbortSignal): Promise<GitActionResult> {
    return runAction(this.withSignal(signal), this.config, request)
  }

  @Remote('query')
  async query(request: GitQueryRequest, signal?: AbortSignal): Promise<GitQueryResponse> {
    return runQuery(this.withSignal(signal), this.config, request)
  }

  private withSignal(signal?: AbortSignal): SnapshotDeps {
    if (signal === undefined) return this.deps
    return { ...this.deps, signal }
  }
}

export default GitPanelService
