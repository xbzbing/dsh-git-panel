/**
 * Workspace resolution + snapshot orchestration (framework-neutral).
 */
import { join } from 'node:path'
import type { GitRunner } from './git.ts'
import { parseStatus } from './parser.ts'
import type { GitChange, GitCommit, GitSnapshot, GitSnapshotResult } from './types.ts'

export interface GitPanelConfig {
  readonly timeoutMs: number
  readonly maxBytes: number
  readonly maxChanges: number
  readonly refreshIntervalMs: number
  /** Whether the input-bar git marker pill is shown. */
  readonly showInputPill: boolean
}

export const DEFAULT_CONFIG: GitPanelConfig = {
  timeoutMs: 8000,
  maxBytes: 4 * 1024 * 1024,
  maxChanges: 1000,
  refreshIntervalMs: 30000,
  showInputPill: true,
}

export function normalizeConfig(raw: unknown): GitPanelConfig {
  const c = (raw ?? {}) as Partial<GitPanelConfig>
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d)
  return {
    timeoutMs: num(c.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    maxBytes: num(c.maxBytes, DEFAULT_CONFIG.maxBytes),
    maxChanges: num(c.maxChanges, DEFAULT_CONFIG.maxChanges),
    refreshIntervalMs: num(c.refreshIntervalMs, DEFAULT_CONFIG.refreshIntervalMs),
    showInputPill: readBool(c.showInputPill, DEFAULT_CONFIG.showInputPill),
  }
}

/**
 * Read a boolean config field, unwrapping a schemastery volatile reference
 * (`{ get() }`) so a live-editable toggle reflects the latest value. Absent or
 * unrecognized shapes fall back to the default.
 */
export function readBool(value: unknown, fallback: boolean): boolean {
  const raw = value !== null && typeof value === 'object' && 'get' in value && typeof (value as { get: unknown }).get === 'function'
    ? (value as { get(): unknown }).get()
    : value
  return typeof raw === 'boolean' ? raw : fallback
}

/** Host capabilities the snapshot needs, structurally injected. */
export interface SnapshotDeps {
  readonly run: GitRunner
  readonly fs: {
    realpath(path: string): Promise<string>
    stat(path: string): Promise<{ mtimeMs: number }>
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
}

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
  const top = await runCommand(deps.run, ['git', 'rev-parse', '--show-toplevel'], cwd, 'toplevel', deps.signal)
  if ('failure' in top) {
    return { ok: false, failure: { ok: false, error: mapRunFailure(top.failure) } }
  }
  if (top.run.timedOut) return { ok: false, failure: { ok: false, error: { code: 'timeout' } } }
  if (top.run.exitCode !== 0) {
    return { ok: false, failure: { ok: false, error: { code: 'not-a-git-repo', cwd } } }
  }
  const raw = top.run.stdout.trim()
  if (raw === '') return { ok: false, failure: { ok: false, error: { code: 'not-a-git-repo', cwd } } }
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

  const [branchRes, headRes, statusRes, aheadBehindRes, lastCommitRes] = await Promise.all([
    runCommand(deps.run, ['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], root, 'branch', deps.signal),
    runCommand(deps.run, ['git', 'rev-parse', '--short', 'HEAD'], root, 'head', deps.signal),
    runCommand(deps.run, ['git', 'status', '--porcelain=v1', '-z'], root, 'status', deps.signal),
    runCommand(deps.run, ['git', 'rev-list', '--count', '--left-right', '@{upstream}...HEAD'], root, 'aheadBehind', deps.signal),
    runCommand(deps.run, ['git', 'log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI'], root, 'lastCommit', deps.signal),
  ])

  const branch = 'run' in branchRes && branchRes.run.exitCode === 0 ? branchRes.run.stdout.trim() || null : null
  const unborn = 'run' in headRes && headRes.run.exitCode !== 0
  const head = unborn ? null : ('run' in headRes ? headRes.run.stdout.trim() || null : null)

  let allChanges: GitChange[] = []
  if ('run' in statusRes && !statusRes.run.timedOut && statusRes.run.exitCode === 0) {
    allChanges = parseStatus(statusRes.run.stdout)
  }
  const truncated = allChanges.length > config.maxChanges
  const changes = truncated ? allChanges.slice(0, config.maxChanges) : allChanges

  let staged = 0
  let modified = 0
  let untracked = 0
  for (const c of changes) {
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

  const snapshot: GitSnapshot = {
    root,
    branch,
    head,
    unborn,
    dirty: changes.length > 0,
    staged,
    modified,
    untracked,
    ahead,
    behind,
    lastCommit,
    changes,
    truncated,
    refreshIntervalMs: config.refreshIntervalMs,
    showInputPill: config.showInputPill,
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
