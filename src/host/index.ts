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
import { createGitRunner, type SubprocessLike } from './git.js'
import { createFsDeps } from './fs-deps.js'
import { normalizeConfig, resolveBrowseRoot, snapshotForSession, DEFAULT_CONFIG, type GitPanelConfig, type SnapshotDeps } from './core.js'
import { canOpenWithSystem, openWithSystem } from './open-file.js'
import { runAction } from './actions.js'
import { runQuery } from './queries.js'
import { runSuggest } from './suggest.js'
import type { AgentDefaultModelFace, LlmFace } from './llm-face.js'
import { sessionModelReader } from './session-model.js'
import { checkLatestVersion, readVersionInfo } from './version.js'
import type { GitActionRequest, GitActionResult, GitOpenFileRequest, GitOpenFileResult, GitQueryRequest, GitQueryResponse, GitSnapshotRequest, GitSnapshotResult, GitSuggestRequest, GitSuggestResult, GitVersionInfo, GitVersionRequest } from './types.js'

export type {
  GitSnapshot, GitSnapshotResult, GitSnapshotRequest, GitFailure, GitCommit, GraphCommit, GitRef,
  GitChange, GitChangeStatus, GitAction, GitActionRequest, GitActionResult, GitErrorCode,
  GitQuery, GitQueryRequest, GitQueryResponse, GitQueryResult, GitBranch, GitFileStat, WorktreeStats, StashEntry,
  GitVersionRequest, GitVersionInfo, DiffViewMode, GraphStyle, DirEntry, ResetMode, GitPanelPlacement,
  GitSuggestRequest, GitSuggestResult, GitRemote, RemoteHostKind, SuggestLanguage, ResolvedLanguage,
  GitOpenFileRequest, GitOpenFileResult, GitRepoEntry, GitRepoList,
  ModelCatalogGroup, ModelCatalogModel, ModelCatalogEffort, ModelCatalogFailure,
} from './types.js'
export { normalizeConfig, DEFAULT_CONFIG, snapshotForSession, resolveWorkspace, listSessionRepos, parsePrimaryRemote, readSuggestLanguage, readPlacement } from './core.js'
export { createGitRunner } from './git.js'
export { parseStatus, parseGraphLog, parseBranches, parseNameStatus, parseStashList, parseTags, sumNumstat } from './parser.js'
export { parseRemote, classifyHost } from './remote.js'
export { isSafePath, planAction, runAction, classifyActionFailure } from './actions.js'
export { openerArgv, canOpenWithSystem, openWithSystem } from './open-file.js'
export { runQuery } from './queries.js'
export { runSuggest, resolveSuggestLanguage, parseStyleHistory, isCjkText, compactLongLines, LONG_LINE_MAX_CHARS } from './suggest.js'
export { readVersionInfo, checkLatestVersion, compareVersions, parseRepository } from './version.js'

/**
 * Run one OS-opener argv through the host subprocess service.
 *
 * Output is discarded: an opener reports success through its exit code, and its
 * stderr is not something the panel can act on. Resolves null when the spawn
 * itself fails (no handler installed, binary missing).
 */
async function spawnDetached(subprocess: SubprocessLike, argv: readonly string[]): Promise<number | null> {
  try {
    const handle = subprocess.spawn({
      argv,
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { collect: { maxBytes: 4096 } },
        stderr: { collect: { maxBytes: 4096 } },
      },
      graceMs: 200,
    })
    const outcome = await handle.done
    return outcome.exitCode
  } catch {
    return null
  }
}

/** Structural slice of the Cordis sessions store (live session objects). */
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
   * Config schema surfaced on the plugin detail page. `showInputPill`,
   * `defaultDiffView`, `graphStyle`, `detectCheckouts`, `filesFollowRepo`,
   * `collapseReposOnPick` and the suggest fields are `.volatile()`, so the settings host renders them as
   * live-editable controls; the operational limits stay profile-only and out
   * of the UI form.
   */
  static Config = Schema.object({
    showInputPill: Schema.boolean().default(true).volatile().description('显示输入框的 Git 分支标记'),
    placement: Schema.union([
      Schema.const('all').description('标签页和侧边栏都显示'),
      Schema.const('tab').description('只在对话区的标签页显示'),
      Schema.const('sidebar').description('只在右侧边栏显示'),
    ]).default('all').volatile().description('Git 面板入口位置'),
    defaultDiffView: Schema.union([
      Schema.const('unified').description('统一视图（单栏行内对比）'),
      Schema.const('split').description('并排视图（左右分栏对比）'),
    ]).default('unified').volatile().description('差异对比默认视图'),
    graphStyle: Schema.union([
      Schema.const('parallel').description('平行线（VSCode 风格，分支各占一列）'),
      Schema.const('compact').description('紧凑（git log 风格，共享祖先合并为一列）'),
    ]).default('parallel').volatile().description('提交历史图线条样式'),
    fontDelta: Schema.union([
      Schema.const(-1).description('较小'),
      Schema.const(0).description('默认'),
      Schema.const(1).description('较大'),
    ]).default(0).volatile().description('面板字号'),
    detectCheckouts: Schema.boolean().default(true).volatile().description('探测 worktree 和子仓库（关闭后存储库列表只保留工作区主仓库；当前目录不是仓库时列表为空）'),
    filesFollowRepo: Schema.boolean().default(false).volatile().description('文件浏览跟随 Git 仓库切换（关闭时文件浏览停在项目根目录）'),
    collapseReposOnPick: Schema.boolean().default(false).volatile().description('切换存储库后立即收起存储库列表（关闭时列表保持展开，只由标题行收起）'),
    suggestEnabled: Schema.boolean().default(true).volatile().description('提交框显示 AI 生成按钮'),
    suggestLanguage: Schema.union([
      Schema.const('auto').description('自动跟随仓库历史提交的语言'),
      Schema.const('zh').description('中文'),
      Schema.const('en').description('English'),
    ]).default(DEFAULT_CONFIG.suggestLanguage).volatile().description('AI 生成提交信息的语言'),
    // Defaults come from DEFAULT_CONFIG (which itself reads SUGGEST_LIMITS) —
    // a literal here could silently drift from what normalizeConfig enforces.
    suggestMaxBytes: Schema.number().default(DEFAULT_CONFIG.suggestMaxBytes).volatile().description('AI 生成输入预算（diff 字节上限，16–512 KiB）'),
    suggestMaxOutputTokens: Schema.number().default(DEFAULT_CONFIG.suggestMaxOutputTokens).volatile().description('AI 生成输出上限（tokens，256–16384）'),
    suggestTimeoutMs: Schema.number().default(DEFAULT_CONFIG.suggestTimeoutMs).volatile().description('AI 生成超时（毫秒，5–120 秒）'),
    // Fixed model route: both halves of the pair must be non-empty to take
    // effect (normalizeConfig); effort is omitted from the request when blank.
    // No .default(): without one the field stays optional in the object schema.
    suggestProvider: Schema.string().volatile().description('AI 生成固定模型的 provider（留空 = 跟随会话默认）'),
    suggestModel: Schema.string().volatile().description('AI 生成固定模型的 model id（须与 provider 成对）'),
    suggestReasoningEffort: Schema.string().volatile().description('AI 生成固定模型的推理强度（留空 = 不设置，用模型默认）'),
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
    const rootNegCache = new Map<string, number>()
    const get = (key: string): unknown => (ctx as unknown as { get(k: string): unknown }).get(key)
    const fs: SnapshotDeps['fs'] = createFsDeps()
    // `static inject` gates activation on subprocess, so it is always present
    // here; the runner throws only if a future refactor drops that guard.
    const subprocess = get('subprocess') as SubprocessLike | undefined
    const run = subprocess === undefined
      ? { run: async (): Promise<never> => { throw new Error('subprocess service unavailable') } }
      : createGitRunner(subprocess, config.timeoutMs, config.maxBytes)
    // The system opener is not git: it needs one short argv and an exit code,
    // so it keeps the raw service face instead of the git-configured runner.
    this.spawnOpener = subprocess === undefined
      ? null
      : (argv) => spawnDetached(subprocess, argv)
    const sessions = get('sessions') as SessionsService | undefined
    const persistence = get('sessionPersistence') as SessionPersistenceLike | undefined
    return {
      run,
      fs,
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
      rootNegCache,
      // Optional model services, resolved per request so a provider fiber that
      // activates late or restarts is picked up — absent in deployments without
      // a model backend, where the suggest endpoint reports `llm-unavailable`
      // rather than failing activation (kept out of `static inject` on purpose).
      getLlm: () => get('llm') as LlmFace | undefined,
      getAgentDefaultModel: () => get('agentDefaultModel') as AgentDefaultModelFace | undefined,
      // Session model selection, resolved per request like the services above:
      // sessionProjections is not in `static inject`, so it may come up after
      // activation or restart under a live plugin.
      getSessionModel: sessionModelReader(get),
    }
  }

  @Remote('snapshot')
  async snapshot(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult> {
    return snapshotForSession(this.withSignal(signal), this.liveConfig(), request.sessionId, { fullChanges: request.fullChanges === true, repo: request.repo })
  }

  @Remote('run')
  async run(request: GitActionRequest, signal?: AbortSignal): Promise<GitActionResult> {
    return runAction(this.withSignal(signal), this.liveConfig(), request)
  }

  @Remote('query')
  async query(request: GitQueryRequest, signal?: AbortSignal): Promise<GitQueryResponse> {
    return runQuery(this.withSignal(signal), this.liveConfig(), request)
  }

  @Remote('suggest')
  async suggest(request: GitSuggestRequest, signal?: AbortSignal): Promise<GitSuggestResult> {
    return runSuggest(this.withSignal(signal), this.liveConfig(), request)
  }

  @Remote('version')
  async version(request: GitVersionRequest): Promise<GitVersionInfo> {
    // The only endpoint that reads/parses package.json; a missing or corrupt
    // manifest must degrade to a typed value, not reject the RPC.
    try {
      return request.check === true ? await checkLatestVersion() : await readVersionInfo()
    } catch (error) {
      return { current: '0.0.0', updateAvailable: false, checkedRemote: false, error: error instanceof Error ? error.message : 'version unavailable' }
    }
  }

  /** Re-read config so a live-edited volatile field (showInputPill) is current. */
  /** Runs one OS-opener argv; null when the host has no subprocess service. */
  private spawnOpener: ((argv: readonly string[]) => Promise<number | null>) | null = null

  @Remote('openFile')
  async openFile(request: GitOpenFileRequest): Promise<GitOpenFileResult> {
    if (!canOpenWithSystem(process.platform)) {
      return { ok: false, error: { code: 'git-error', message: 'this host cannot open files in a desktop application' } }
    }
    if (this.spawnOpener === null) {
      return { ok: false, error: { code: 'git-error', message: 'subprocess service unavailable' } }
    }
    const browse = await resolveBrowseRoot(this.withSignal(undefined), request.sessionId, request.repo)
    if (!browse.ok) return { ok: false, error: browse.error }
    try {
      return await openWithSystem(this.deps, browse.root, request.path, this.spawnOpener)
    } catch (error) {
      return { ok: false, error: { code: 'git-error', message: error instanceof Error ? error.message : String(error) } }
    }
  }

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
