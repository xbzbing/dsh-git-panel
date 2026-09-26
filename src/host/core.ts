/**
 * Workspace resolution + snapshot orchestration (framework-neutral).
 */
import { join } from 'node:path'
import type { GitRunner } from './git.ts'
import { parseStatus, sumNumstat } from './parser.ts'
import { isSafePath } from './validate.ts'
import type { DiffViewMode, GitChange, GitCommit, GitErrorCode, GitSnapshot, GitSnapshotResult, WorktreeStats } from './types.ts'

export interface GitPanelConfig {
  readonly timeoutMs: number
  /** Per-command stdout cap; also the per-side image-diff payload cap. */
  readonly maxBytes: number
  readonly maxChanges: number
  readonly refreshIntervalMs: number
  /** Whether the input-bar git marker pill is shown. */
  readonly showInputPill: boolean
  /** Default diff layout the views open with (user can switch per-diff). */
  readonly defaultDiffView: DiffViewMode
}

export const DEFAULT_CONFIG: GitPanelConfig = {
  timeoutMs: 8000,
  maxBytes: 4 * 1024 * 1024,
  maxChanges: 1000,
  refreshIntervalMs: 30000,
  showInputPill: true,
  defaultDiffView: 'unified',
}

export function normalizeConfig(raw: unknown): GitPanelConfig {
  const c = (raw ?? {}) as Partial<GitPanelConfig>
  // Positive integers only: 0 / fractional / non-finite fall back to the
  // default, so a stray `maxChanges: 1.5` can't reach `slice(0, 1.5)`.
  const num = (v: unknown, d: number): number =>
    (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : d)
  return {
    timeoutMs: num(c.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    maxBytes: num(c.maxBytes, DEFAULT_CONFIG.maxBytes),
    maxChanges: num(c.maxChanges, DEFAULT_CONFIG.maxChanges),
    refreshIntervalMs: num(c.refreshIntervalMs, DEFAULT_CONFIG.refreshIntervalMs),
    showInputPill: readBool(c.showInputPill, DEFAULT_CONFIG.showInputPill),
    defaultDiffView: readDiffView(c.defaultDiffView, DEFAULT_CONFIG.defaultDiffView),
  }
}

/** Unwrap a schemastery volatile reference (`{ get() }`) to its live value;
 * pass non-volatile values through unchanged. */
function unwrapVolatile(value: unknown): unknown {
  return value !== null && typeof value === 'object' && 'get' in value && typeof (value as { get: unknown }).get === 'function'
    ? (value as { get(): unknown }).get()
    : value
}

/** Read the default-diff-view field, unwrapping a schemastery volatile ref. */
export function readDiffView(value: unknown, fallback: DiffViewMode): DiffViewMode {
  const raw = unwrapVolatile(value)
  return raw === 'unified' || raw === 'split' ? raw : fallback
}

/**
 * Read a boolean config field, unwrapping a schemastery volatile reference
 * (`{ get() }`) so a live-editable toggle reflects the latest value. Absent or
 * unrecognized shapes fall back to the default.
 */
export function readBool(value: unknown, fallback: boolean): boolean {
  const raw = unwrapVolatile(value)
  return typeof raw === 'boolean' ? raw : fallback
}

/** Host capabilities the snapshot needs, structurally injected. */
export interface SnapshotDeps {
  readonly run: GitRunner
  readonly fs: {
    realpath(path: string): Promise<string>
    stat(path: string): Promise<{ mtimeMs: number; size: number }>
    /** Raw bytes (no encoding) — image sides for the image-diff query. */
    readFile(path: string): Promise<Buffer>
    /** One directory's entries (name + is-directory) — the file browser. */
    readdir(path: string): Promise<ReadonlyArray<{ name: string; isDirectory: boolean }>>
    /** Best-effort unlink (force) — temp-blob cleanup. */
    remove(path: string): Promise<void>
  }
  readonly sessions: {
    liveCwd(sessionId: string): string | undefined
    persistedMeta(sessionId: string): Promise<{ cwd?: string } | undefined>
  }
  readonly signal?: AbortSignal
  /**
   * Optional cwd→root cache, keyed by the resolved cwd. Resolving the work-tree
   * root runs a `git rev-parse` + `realpath` on every call; sharing this map
   * across a session's snapshot/query/run calls collapses that to one spawn per
   * distinct cwd (a session's cwd is effectively stable).
   */
  readonly rootCache?: Map<string, string>
  /**
   * Optional negative cache (cwd → expiry epoch ms) for non-repo cwds, so a
   * session whose directory is not a git repo does not spawn `rev-parse` on
   * every 30s poll. Short-lived (see NEG_CACHE_MS) so a repo created under the
   * cwd is picked up soon after.
   */
  readonly rootNegCache?: Map<string, number>
}

/** Non-repo negative-cache lifetime; short so a freshly-created repo is seen. */
const NEG_CACHE_MS = 15_000

export type WorkspaceResolution =
  | { readonly ok: true; readonly root: string }
  | { readonly ok: false; readonly failure: GitSnapshotResult & { ok: false } }

/** Resolve the git work-tree root for a session's cwd. */
export async function resolveWorkspace(deps: SnapshotDeps, sessionId: string): Promise<WorkspaceResolution> {
  let cwd = deps.sessions.liveCwd(sessionId)
  if (cwd === undefined || cwd === '') {
    const meta = await deps.sessions.persistedMeta(sessionId)
    cwd = meta?.cwd
  }
  if (cwd === undefined || cwd === '') {
    return { ok: false, failure: { ok: false, error: { code: 'cwd-unavailable', sessionId } } }
  }
  const cached = deps.rootCache?.get(cwd)
  if (cached !== undefined) return { ok: true, root: cached }
  const negAt = deps.rootNegCache?.get(cwd)
  if (negAt !== undefined) {
    if (Date.now() < negAt) return { ok: false, failure: { ok: false, error: { code: 'not-a-git-repo', cwd } } }
    deps.rootNegCache?.delete(cwd)
  }
  const top = await runCommand(deps.run, ['git', 'rev-parse', '--show-toplevel'], cwd, 'toplevel', deps.signal)
  if ('failure' in top) {
    return { ok: false, failure: { ok: false, error: mapRunFailure(top.failure) } }
  }
  if (top.run.cancelled) return { ok: false, failure: { ok: false, error: { code: 'cancelled' } } }
  if (top.run.timedOut) return { ok: false, failure: { ok: false, error: { code: 'timeout' } } }
  if (top.run.exitCode !== 0) {
    deps.rootNegCache?.set(cwd, Date.now() + NEG_CACHE_MS)
    return { ok: false, failure: { ok: false, error: { code: 'not-a-git-repo', cwd } } }
  }
  const raw = top.run.stdout.trim()
  if (raw === '') {
    deps.rootNegCache?.set(cwd, Date.now() + NEG_CACHE_MS)
    return { ok: false, failure: { ok: false, error: { code: 'not-a-git-repo', cwd } } }
  }
  let root = raw
  try {
    root = await deps.fs.realpath(raw)
  } catch {
    root = raw
  }
  deps.rootCache?.set(cwd, root)
  return { ok: true, root }
}

/** Run one git command; a spawn-level failure returns { failure }. */
export async function runCommand(
  runner: GitRunner,
  argv: readonly string[],
  cwd: string,
  _label: string,
  signal?: AbortSignal,
): Promise<{ run: Awaited<ReturnType<GitRunner['run']>> } | { failure: unknown }> {
  try {
    const run = await runner.run(argv, { cwd, ...(signal ? { signal } : {}) })
    return { run }
  } catch (error) {
    return { failure: error }
  }
}

function mapRunFailure(failure: unknown): { code: 'git-unavailable'; detail: string } {
  const message = failure instanceof Error ? failure.message : String(failure)
  return { code: 'git-unavailable', detail: message }
}

/**
 * Collapse a workspace-resolution failure into the `{ code, message }` shape
 * the run/query endpoints return. `GitFailure` already carries only endpoint
 * codes, so no membership test is needed (the previous per-endpoint ternary
 * that re-listed every code was always true — dead). `detail` becomes message.
 */
export function mapWorkspaceFailure(
  failure: GitSnapshotResult & { ok: false },
): { code: GitErrorCode; message?: string } {
  const error = failure.error
  const message = 'detail' in error ? error.detail : undefined
  return { code: error.code, ...(message !== undefined ? { message } : {}) }
}

/** Produce a full snapshot for a session. */
export async function snapshotForSession(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  sessionId: string,
): Promise<GitSnapshotResult> {
  const workspace = await resolveWorkspace(deps, sessionId)
  if (!workspace.ok) {
    // Surface the pill preference even on the not-a-git-repo path, where the
    // client still renders the directory-name marker.
    const failure = workspace.failure
    if (failure.error.code === 'not-a-git-repo') {
      return { ok: false, error: { ...failure.error, showInputPill: config.showInputPill } }
    }
    return failure
  }
  const root = workspace.root

  const [branchRes, headRes, statusRes, aheadBehindRes, lastCommitRes, worktreeNumRes, stagedNumRes] = await Promise.all([
    runCommand(deps.run, ['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], root, 'branch', deps.signal),
    runCommand(deps.run, ['git', 'rev-parse', '--short', 'HEAD'], root, 'head', deps.signal),
    runCommand(deps.run, ['git', 'status', '--porcelain=v1', '-z'], root, 'status', deps.signal),
    runCommand(deps.run, ['git', 'rev-list', '--count', '--left-right', '@{upstream}...HEAD'], root, 'aheadBehind', deps.signal),
    runCommand(deps.run, ['git', 'log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI'], root, 'lastCommit', deps.signal),
    runCommand(deps.run, ['git', 'diff', '--numstat'], root, 'numstat-worktree', deps.signal),
    runCommand(deps.run, ['git', 'diff', '--numstat', '--cached'], root, 'numstat-staged', deps.signal),
  ])

  const branch = 'run' in branchRes && branchRes.run.exitCode === 0 ? branchRes.run.stdout.trim() || null : null
  const unborn = 'run' in headRes && headRes.run.exitCode !== 0
  const head = unborn ? null : ('run' in headRes ? headRes.run.stdout.trim() || null : null)

  let allChanges: GitChange[] = []
  let statusLossy = false
  if ('run' in statusRes && !statusRes.run.timedOut && statusRes.run.exitCode === 0) {
    allChanges = parseStatus(statusRes.run.stdout)
    statusLossy = statusRes.run.stdoutLossy
  }
  // Truncated either because the list exceeded the cap or because the status
  // stream itself was clipped (a lossy read may drop a trailing entry).
  const truncated = allChanges.length > config.maxChanges || statusLossy
  const changes = allChanges.length > config.maxChanges ? allChanges.slice(0, config.maxChanges) : allChanges

  // Counts and `dirty` reflect the full change set; only the `changes` list is
  // bounded. Counting the truncated slice would under-report on large repos.
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const c of allChanges) {
    if (c.status === 'untracked') untracked++
    else if (c.staged) staged++
    else modified++
  }

  let ahead = 0
  let behind = 0
  if ('run' in aheadBehindRes && aheadBehindRes.run.exitCode === 0) {
    const parts = aheadBehindRes.run.stdout.trim().split(/\s+/)
    behind = Number(parts[0]) || 0
    ahead = Number(parts[1]) || 0
  }

  let lastCommit: GitCommit | null = null
  if ('run' in lastCommitRes && lastCommitRes.run.exitCode === 0) {
    const parts = lastCommitRes.run.stdout.trim().split('\x1f')
    if (parts.length >= 5 && parts[0]) {
      lastCommit = {
        hash: parts[0]!,
        shortHash: parts[1] ?? '',
        subject: parts[2] ?? '',
        author: parts[3] ?? '',
        dateIso: parts[4] ?? '',
      }
    }
  }

  // Worktree statistics fold into the single snapshot (no separate endpoint
  // fan-out): line counts from the two numstat runs above, untracked lines and
  // mtimes best-effort, HEAD time from lastCommit.
  const wt = 'run' in worktreeNumRes && worktreeNumRes.run.exitCode === 0 ? sumNumstat(worktreeNumRes.run.stdout) : { insertions: 0, deletions: 0 }
  const stg = 'run' in stagedNumRes && stagedNumRes.run.exitCode === 0 ? sumNumstat(stagedNumRes.run.stdout) : { insertions: 0, deletions: 0 }
  let untrackedInsertions = 0
  const untrackedPaths = allChanges.filter((c) => c.status === 'untracked' && !c.isDirectory).map((c) => c.path)
  const safeUntracked = untrackedPaths.filter(isSafePath).slice(0, 200)
  if (safeUntracked.length > 0) {
    const perFile = await Promise.all(
      safeUntracked.map((p) => runCommand(deps.run, ['git', 'diff', '--numstat', '--no-index', '--', '/dev/null', p], root, 'numstat-untracked', deps.signal)),
    )
    for (const r of perFile) if ('run' in r) untrackedInsertions += sumNumstat(r.run.stdout).insertions
  }
  const lastChangeAt = await maxChangeMtime(deps, root, allChanges)
  const distinct = new Set(allChanges.map((c) => c.path))
  const stats: WorktreeStats = {
    fileCount: distinct.size,
    staged,
    modified,
    untracked,
    insertions: wt.insertions + stg.insertions + untrackedInsertions,
    deletions: wt.deletions + stg.deletions,
    lastChangeAt,
    headCommittedAt: lastCommit?.dateIso ?? null,
  }

  const snapshot: GitSnapshot = {
    root,
    branch,
    head,
    unborn,
    dirty: allChanges.length > 0,
    staged,
    modified,
    untracked,
    ahead,
    behind,
    lastCommit,
    changes,
    stats,
    truncated,
    refreshIntervalMs: config.refreshIntervalMs,
    showInputPill: config.showInputPill,
    defaultDiffView: config.defaultDiffView,
    checkedAt: Date.now(),
  }
  return { ok: true, value: snapshot }
}

/** Max mtime among changed files (epoch ms), capped for large sets. */
export async function maxChangeMtime(
  deps: SnapshotDeps,
  root: string,
  changes: readonly GitChange[],
  cap = 200,
): Promise<number | null> {
  let max: number | null = null
  const slice = changes.slice(0, cap)
  await Promise.all(slice.map(async (c) => {
    if (c.isDirectory) return
    try {
      const info = await deps.fs.stat(join(root, c.path))
      if (typeof info.mtimeMs === 'number' && Number.isFinite(info.mtimeMs)) {
        max = max === null ? info.mtimeMs : Math.max(max, info.mtimeMs)
      }
    } catch {
      // path gone — skip
    }
  }))
  return max
}
