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
import Schema from '@deepseek-ai/schemastery'
import { readFile, realpath, rm, stat } from 'node:fs/promises'
import { createGitRunner, type SubprocessLike } from './git.ts'
import { normalizeConfig, snapshotForSession, type GitPanelConfig, type SnapshotDeps } from './core.ts'
import { runAction } from './actions.ts'
import { runQuery } from './queries.ts'
import { checkLatestVersion, readVersionInfo } from './version.ts'
import type { GitActionRequest, GitActionResult, GitQueryRequest, GitQueryResponse, GitSnapshotRequest, GitSnapshotResult, GitVersionInfo, GitVersionRequest } from './types.ts'

export type {
  GitSnapshot, GitSnapshotResult, GitSnapshotRequest, GitFailure, GitCommit, GraphCommit, GitRef,
  GitChange, GitChangeStatus, GitAction, GitActionRequest, GitActionResult, GitErrorCode,
  GitQuery, GitQueryRequest, GitQueryResponse, GitQueryResult, GitBranch, GitFileStat, WorktreeStats,
  GitVersionRequest, GitVersionInfo,
} from './types.ts'
export { normalizeConfig, DEFAULT_CONFIG, snapshotForSession, resolveWorkspace } from './core.ts'
export { createGitRunner } from './git.ts'
export { parseStatus, parseGraphLog, parseBranches, parseNameStatus, sumNumstat } from './parser.ts'
export { isSafePath, planAction, runAction } from './actions.ts'
export { runQuery } from './queries.ts'
export { readVersionInfo, checkLatestVersion, compareVersions, parseRepository } from './version.ts'

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

  /**
   * Config schema surfaced on the plugin detail page. Only `showInputPill` is
   * `.volatile()`, so the settings host renders it as a live-editable toggle;
   * the operational limits stay profile-only and out of the UI form.
   */
  static Config = Schema.object({
    showInputPill: Schema.boolean().default(true).volatile().description('显示输入框的 Git 分支标记'),
  })

  private readonly deps: SnapshotDeps
  private config: GitPanelConfig
  private readonly rawConfig: unknown

  constructor(ctx: Context, config: unknown) {
    super(ctx, 'gitPanel')
    this.rawConfig = config
    this.config = normalizeConfig(config)
    this.deps = this.buildDeps(ctx, this.config)
  }

  private buildDeps(ctx: Context, config: GitPanelConfig): SnapshotDeps {
    const rootCache = new Map<string, string>()
    const get = (key: string): unknown => (ctx as unknown as { get(k: string): unknown }).get(key)
    const subprocess = get('subprocess') as SubprocessLike | undefined
    if (subprocess === undefined) {
      return {
        run: { run: async () => { throw new Error('subprocess service unavailable') } },
        fs: { realpath, stat: async (p) => stat(p), readFile, remove: async (p) => { await rm(p, { force: true }) } },
        sessions: { liveCwd: () => undefined, persistedMeta: async () => undefined },
        rootCache,
      }
    }
    const sessions = get('sessions') as SessionsService | undefined
    const persistence = get('sessionPersistence') as SessionPersistenceLike | undefined
    return {
      run: createGitRunner(subprocess, config.timeoutMs, config.maxBytes),
      fs: { realpath, stat: async (p) => stat(p), readFile, remove: async (p) => { await rm(p, { force: true }) } },
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
      rootCache,
    }
  }

  @Remote('snapshot')
  async snapshot(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult> {
    return snapshotForSession(this.withSignal(signal), this.liveConfig(), request.sessionId)
  }

  @Remote('run')
  async run(request: GitActionRequest, signal?: AbortSignal): Promise<GitActionResult> {
    return runAction(this.withSignal(signal), this.liveConfig(), request)
  }

  @Remote('query')
  async query(request: GitQueryRequest, signal?: AbortSignal): Promise<GitQueryResponse> {
    return runQuery(this.withSignal(signal), this.liveConfig(), request)
  }

  @Remote('version')
  async version(request: GitVersionRequest): Promise<GitVersionInfo> {
    return request.check === true ? checkLatestVersion() : readVersionInfo()
  }

  /** Re-read config so a live-edited volatile field (showInputPill) is current. */
  private liveConfig(): GitPanelConfig {
    this.config = normalizeConfig(this.rawConfig)
    return this.config
  }

  private withSignal(signal?: AbortSignal): SnapshotDeps {
    if (signal === undefined) return this.deps
    return { ...this.deps, signal }
  }
}

export default GitPanelService
