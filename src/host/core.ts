/**
 * Workspace resolution + snapshot orchestration (framework-neutral).
 */
import { basename, dirname, join } from 'node:path'
import type { GitRunner } from './git.js'
import type { AgentDefaultModelFace, LlmFace, SessionModelSelection } from './llm-face.js'
import { commitFromFields, parseStatus, sumNumstat } from './parser.js'
import { parseRemote } from './remote.js'
import { snapshotFingerprint } from './snapshot-fingerprint.js'
import { isSafePath } from './validate.js'
import { repoDirFor, scanRepos, samePath, REPO_RESULT_LIMIT } from './repos.js'
import { parseWorktreePorcelain, worktreeCheckouts } from './worktrees.js'
import type { WorktreeCheckout } from './worktrees.js'
import { MAX_BYTES_LIMITS, SUGGEST_LANGUAGE_DEFAULT, SUGGEST_LANGUAGES, SUGGEST_LIMITS, FULL_CHANGES_MAX } from './types.js'
import type { DiffViewMode, FontDelta, GraphStyle, GitChange, GitCommit, GitErrorCode, GitPanelPlacement, GitRemote, GitRepoEntry, GitRepoList, GitSnapshot, GitSnapshotResult, SuggestLanguage, TruncationReason, WorktreeStats } from './types.js'

export interface GitPanelConfig {
  readonly timeoutMs: number
  /** Per-command stdout cap; also the per-side image-diff and image-preview
   * payload cap. Range 64 KiB – 64 MiB. */
  readonly maxBytes: number
  readonly maxChanges: number
  readonly refreshIntervalMs: number
  /** Probe worktrees and nested repositories for the repository list. Off →
   * the list is the cwd's own repository alone (none when the cwd is not one). */
  readonly detectCheckouts: boolean
  /** The file browser follows repository switches; off → it stays at the
   * project root (the workspace the cwd belongs to). */
  readonly filesFollowRepo: boolean
  /** Picking a repository folds the repository list; off → the list stays open
   * until its head line is clicked. */
  readonly collapseReposOnPick: boolean
  /** Whether the input-bar git marker pill is shown. */
  readonly showInputPill: boolean
  /** Where the panel is mounted: the view tab, the right sidebar, or both. */
  readonly placement: GitPanelPlacement
  /** Default diff layout the views open with (user can switch per-diff). */
  readonly defaultDiffView: DiffViewMode
  /** Commit-graph line style (parallel = VSCode-like, compact = git log). */
  readonly graphStyle: GraphStyle
  /** Panel font-size step: -1 / 0 / +1. */
  readonly fontDelta: FontDelta
  /** Whether the "AI suggest" button shows in the commit box. */
  readonly suggestEnabled: boolean
  /** Language the generated message is written in; `auto` follows repo history. */
  readonly suggestLanguage: SuggestLanguage
  /** Max diff bytes sent to the model; beyond this the diff is truncated. Range 16–512 KiB. */
  readonly suggestMaxBytes: number
  /** Model output token budget (reasoning tokens count against it on thinking models). Range 256–16384. */
  readonly suggestMaxOutputTokens: number
  /** Timeout for one suggest call. Range 5–120 s. */
  readonly suggestTimeoutMs: number
  /** Optional provider/model route override; absent → the agent default. */
  readonly suggestProvider?: string
  readonly suggestModel?: string
  /** Adapter-owned effort for the fixed route; absent → omit from the request
   * (the model / adapter default applies). Ignored when the route is not fixed. */
  readonly suggestReasoningEffort?: string
}

export const DEFAULT_CONFIG: GitPanelConfig = {
  timeoutMs: 8000,
  maxBytes: MAX_BYTES_LIMITS.default,
  maxChanges: 1000,
  refreshIntervalMs: 30000,
  detectCheckouts: true,
  filesFollowRepo: false,
  collapseReposOnPick: false,
  showInputPill: true,
  placement: 'all',
  defaultDiffView: 'unified',
  graphStyle: 'parallel',
  fontDelta: 0,
  suggestEnabled: true,
  suggestLanguage: SUGGEST_LANGUAGE_DEFAULT,
  suggestMaxBytes: SUGGEST_LIMITS.maxBytes.default,
  suggestMaxOutputTokens: SUGGEST_LIMITS.maxOutputTokens.default,
  suggestTimeoutMs: SUGGEST_LIMITS.timeoutMs.default,
}

export function normalizeConfig(raw: unknown): GitPanelConfig {
  const c = (raw ?? {}) as Partial<GitPanelConfig>
  // Positive integers only: 0 / fractional / non-finite fall back to the
  // default, so a stray `maxChanges: 1.5` can't reach `slice(0, 1.5)`.
  const num = (v: unknown, d: number): number =>
    (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : d)
  // Suggest limits are volatile, user-configurable fields: unwrap the
  // schemastery `{ get() }` ref first (as readBool does — resolveConfig wraps
  // every .volatile() field in one), then clamp a legal number into range;
  // a silent default fallback would drop a live-edited value, and anything
  // non-numeric falls back.
  const clampLimit = (v: unknown, limit: { readonly min: number; readonly max: number; readonly default: number }): number => {
    const raw = unwrapVolatile(v)
    return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(limit.max, Math.max(limit.min, Math.floor(raw))) : limit.default
  }
  // Provider/model overrides must be supplied together; a lone half is ignored
  // so a mistyped profile degrades to the agent default route. The effort is
  // only meaningful on a fixed route, so an unpaired config drops it too —
  // no half-applied residual can survive a broken pair. All three are volatile:
  // unwrap the `{ get() }` ref before the pair check, or a live-edited route
  // never matches and suggest falls back to the session model.
  const provider = unwrapVolatile(c.suggestProvider)
  const model = unwrapVolatile(c.suggestModel)
  const effort = unwrapVolatile(c.suggestReasoningEffort)
  const route = typeof provider === 'string' && provider !== ''
    && typeof model === 'string' && model !== ''
    ? {
      suggestProvider: provider,
      suggestModel: model,
      ...(typeof effort === 'string' && effort !== '' ? { suggestReasoningEffort: effort } : {}),
    }
    : {}
  return {
    timeoutMs: num(c.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    maxBytes: clampLimit(c.maxBytes, MAX_BYTES_LIMITS),
    maxChanges: num(c.maxChanges, DEFAULT_CONFIG.maxChanges),
    refreshIntervalMs: num(c.refreshIntervalMs, DEFAULT_CONFIG.refreshIntervalMs),
    detectCheckouts: readBool(c.detectCheckouts, DEFAULT_CONFIG.detectCheckouts),
    filesFollowRepo: readBool(c.filesFollowRepo, DEFAULT_CONFIG.filesFollowRepo),
    collapseReposOnPick: readBool(c.collapseReposOnPick, DEFAULT_CONFIG.collapseReposOnPick),
    showInputPill: readBool(c.showInputPill, DEFAULT_CONFIG.showInputPill),
    placement: readPlacement(c.placement, DEFAULT_CONFIG.placement),
    defaultDiffView: readDiffView(c.defaultDiffView, DEFAULT_CONFIG.defaultDiffView),
    graphStyle: readGraphStyle(c.graphStyle, DEFAULT_CONFIG.graphStyle),
    fontDelta: readFontDelta(c.fontDelta),
    suggestEnabled: readBool(c.suggestEnabled, DEFAULT_CONFIG.suggestEnabled),
    suggestLanguage: readSuggestLanguage(c.suggestLanguage, DEFAULT_CONFIG.suggestLanguage),
    suggestMaxBytes: clampLimit(c.suggestMaxBytes, SUGGEST_LIMITS.maxBytes),
    suggestMaxOutputTokens: clampLimit(c.suggestMaxOutputTokens, SUGGEST_LIMITS.maxOutputTokens),
    suggestTimeoutMs: clampLimit(c.suggestTimeoutMs, SUGGEST_LIMITS.timeoutMs),
    ...route,
  }
}

/** Unwrap a schemastery volatile reference (`{ get() }`) to its live value;
 * pass non-volatile values through unchanged. */
function unwrapVolatile(value: unknown): unknown {
  return value !== null && typeof value === 'object' && 'get' in value && typeof (value as { get: unknown }).get === 'function'
    ? (value as { get(): unknown }).get()
    : value
}

/**
 * Read the panel-mount field, unwrapping a schemastery volatile ref. An
 * unknown string (a hand-edited profile, or a value from a newer version)
 * falls back to the default rather than mounting nowhere.
 */
export function readPlacement(value: unknown, fallback: GitPanelPlacement): GitPanelPlacement {
  const raw = unwrapVolatile(value)
  return raw === 'all' || raw === 'tab' || raw === 'sidebar' ? raw : fallback
}

/**
 * Read the default-diff-view field, unwrapping a schemastery volatile ref. */
export function readDiffView(value: unknown, fallback: DiffViewMode): DiffViewMode {
  const raw = unwrapVolatile(value)
  return raw === 'unified' || raw === 'split' ? raw : fallback
}

/** Read the commit-graph style field, unwrapping a schemastery volatile ref. */
export function readGraphStyle(value: unknown, fallback: GraphStyle): GraphStyle {
  const raw = unwrapVolatile(value)
  return raw === 'parallel' || raw === 'compact' ? raw : fallback
}

/** Read the panel font-size step, unwrapping a schemastery volatile ref. */
export function readFontDelta(value: unknown): FontDelta {
  const raw = unwrapVolatile(value)
  return raw === -1 || raw === 1 ? raw : 0
}

/**
 * Read the commit-message language field, unwrapping a schemastery volatile
 * ref. An unknown string (a hand-edited profile, or a value from a newer
 * version) falls back to the default rather than reaching the prompt.
 */
export function readSuggestLanguage(value: unknown, fallback: SuggestLanguage): SuggestLanguage {
  const raw = unwrapVolatile(value)
  return typeof raw === 'string' && (SUGGEST_LANGUAGES as readonly string[]).includes(raw)
    ? raw as SuggestLanguage
    : fallback
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
    /** `isDirectory` reports the *resolved* type (symlinks are followed). */
    stat(path: string): Promise<{ mtimeMs: number; size: number; isDirectory(): boolean }>
    /** Raw bytes (no encoding) — image sides for the image-diff query. */
    readFile(path: string): Promise<Buffer>
    /**
     * A symlink's target text, else null. git stores the LINK as the worktree
     * blob (mode 120000), so the diff's new side is the target string, not the
     * file it points at — following the link would describe a different file.
     */
    symlinkTarget(path: string): Promise<string | null>
    /** One directory's entries (name + is-directory) — the file browser. */
    readdir(path: string): Promise<ReadonlyArray<{ name: string; isDirectory: boolean }>>
    /** Recursive remove (force) — untracked discards pass whole directories; temp-blob cleanup passes files. */
    remove(path: string): Promise<void>
  }
  readonly sessions: {
    liveCwd(sessionId: string): string | undefined
    persistedMeta(sessionId: string): Promise<{ cwd?: string } | undefined>
  }
  readonly signal?: AbortSignal
  /**
   * Optional cwd+selector→root cache. Resolving the work-tree root runs a
   * `git rev-parse` + `realpath` on every call; sharing this map across a
   * session's snapshot/query/run calls collapses that to one spawn per distinct
   * (cwd, repository) pair. The key is built by `rootCacheKey`, so the default
   * repository and a nested one under the same cwd never alias.
   */
  readonly rootCache?: Map<string, string>
  /**
   * Optional negative cache (cwd+selector → expiry epoch ms), so a session whose
   * directory is not a git repo does not spawn `rev-parse` on every 30s poll.
   * Short-lived (see NEG_CACHE_MS) so a repo created under the cwd is picked up
   * soon after.
   */
  readonly rootNegCache?: Map<string, number>
  /**
   * Optional per-request resolvers for the host model services (see
   * llm-face.ts). Resolved on every suggest call — never frozen at
   * construction — so a provider fiber that activates late or restarts is
   * picked up. Absent in deployments without a model backend; the suggest
   * endpoint then reports `llm-unavailable` instead of failing activation.
   */
  readonly getLlm?: () => LlmFace | undefined
  readonly getAgentDefaultModel?: () => AgentDefaultModelFace | undefined
  /** The session's durable model selection (projection next); undefined when
   * the session has never selected a model. */
  readonly getSessionModel?: (sessionId: string) => SessionModelSelection | undefined
}

/** Non-repo negative-cache lifetime; short so a freshly-created repo is seen. */
const NEG_CACHE_MS = 15_000

/**
 * Pick the primary remote from `git remote -v` output and parse its fetch URL.
 * Prefers `origin`; otherwise the first remote listed. Lines look like
 * `origin\thttps://…\t(fetch)` — only `(fetch)` rows are considered.
 */
export function parsePrimaryRemote(stdout: string): GitRemote | null {
  const fetchUrls = new Map<string, string>()
  const order: string[] = []
  for (const line of stdout.split('\n')) {
    const m = line.match(/^(\S+)\t(\S+)\s+\(fetch\)$/)
    if (m === null) continue
    const name = m[1]!
    if (!fetchUrls.has(name)) { fetchUrls.set(name, m[2]!); order.push(name) }
  }
  if (order.length === 0) return null
  const name = fetchUrls.has('origin') ? 'origin' : order[0]!
  return parseRemote(name, fetchUrls.get(name)!)
}

/**
 * mtime fan-out ceiling. `maxChangeMtime` spawns one `fs.stat` per changed
 * file; on a work tree with thousands of changes — issue #16's pathological
 * case, e.g. an un-ignored build/deps directory — that flooded the host every
 * poll. Above this many total changes the mtime pass is skipped and the stats
 * are marked `partial`; the cheap O(n) counts stay exact. The untracked line
 * pass has its own, lower ceiling (UNTRACKED_NUMSTAT_LIMIT) because it spawns a
 * git process per file.
 */
const STATS_FANOUT_LIMIT = 200

/**
 * Untracked line counts need one `git diff --no-index` subprocess per file,
 * which is three orders of magnitude more expensive than the mtime fan-out's
 * `fs.stat` (measured: 32 spawns ≈ 157ms, 150 ≈ 0.6–0.8s; 150 stats ≈ 0.35ms).
 * With `--untracked-files=all` a brand-new directory turns into many file
 * entries, so this fan-out gets its own, much lower ceiling: beyond it the
 * untracked lines are omitted and the stats are marked partial instead of
 * flooding the host on every poll.
 */
const UNTRACKED_NUMSTAT_LIMIT = 32

export type WorkspaceResolution =
  | { readonly ok: true; readonly root: string }
  | { readonly ok: false; readonly failure: GitSnapshotResult & { ok: false } }

/**
 * Resolve a directory root for the file browser, which must work outside a git
 * repository too. Inside a repo it is the work-tree top; otherwise it falls
 * back to the session's cwd (realpath'd) so directory listing / file preview
 * still function. Only a missing cwd is a hard failure.
 *
 * A selector that no longer names a repository reports the failure instead of
 * browsing something else, so the file tree can never disagree with the picker.
 * Failures that answer nothing about the selector — git missing — keep the cwd
 * fallback: every listing would fail otherwise, with no way back to the default.
 */
export async function resolveBrowseRoot(
  deps: SnapshotDeps,
  sessionId: string,
  repo?: string,
): Promise<{ ok: true; root: string; isGitRepo: boolean } | { ok: false; error: { code: GitErrorCode; message?: string } }> {
  const ws = await resolveWorkspace(deps, sessionId, repo)
  if (ws.ok) return { ok: true, root: ws.root, isGitRepo: true }
  const err = ws.failure.error
  // A selector the host cannot resolve is the picker's own stale state: browsing
  // the cwd instead would show a tree the list does not mark as selected.
  if (err.code === 'invalid-repo') return { ok: false, error: mapWorkspaceFailure(ws.failure) }
  // Both "not a git repo" and "git not installed" still browse the cwd: in the
  // former git told us it's not a repo, in the latter git never ran at all, but
  // either way the directory listing / file preview run off the plain cwd. A
  // selector backed by a missing git lands here too — no entry could be
  // confirmed, and the browser would otherwise be dead on every path.
  if ((err.code === 'not-a-git-repo' || err.code === 'git-unavailable') && 'cwd' in err && err.cwd !== undefined && err.cwd !== '') {
    try {
      return { ok: true, root: await deps.fs.realpath(err.cwd), isGitRepo: false }
    } catch {
      return { ok: false, error: { code: 'git-error' } }
    }
  }
  return { ok: false, error: mapWorkspaceFailure(ws.failure) }
}

/** The session's cwd: the live session header first, then the persisted one. */
export async function resolveSessionCwd(
  deps: SnapshotDeps,
  sessionId: string,
): Promise<{ readonly ok: true; readonly cwd: string } | { readonly ok: false; readonly failure: GitSnapshotResult & { ok: false } }> {
  let cwd = deps.sessions.liveCwd(sessionId)
  if (cwd === undefined || cwd === '') {
    const meta = await deps.sessions.persistedMeta(sessionId)
    cwd = meta?.cwd
  }
  if (cwd === undefined || cwd === '') {
    return { ok: false, failure: { ok: false, error: { code: 'cwd-unavailable', sessionId } } }
  }
  return { ok: true, cwd }
}

/**
 * Cache key for one (cwd, repository) pair. NUL cannot occur in either half, so
 * the default repository ('') and a nested one never collide with each other or
 * with a longer path.
 */
function rootCacheKey(cwd: string, repo: string): string {
  return repo === '' ? cwd : cwd + '\u0000' + repo
}

/**
 * Resolve the git work-tree root for a session's cwd.
 *
 * 'repo' selects which repository (see GitRepoEntry): absent or '' keeps the
 * original behavior — git walks up from the cwd to the enclosing top, which may
 * be a parent of the cwd. A non-empty selector must name a work-tree *top*
 * inside the cwd: an ordinary subdirectory of a repository is rejected rather
 * than silently resolving to its parent, because the repository list only ever
 * offers tops.
 */
export async function resolveWorkspace(deps: SnapshotDeps, sessionId: string, repo?: string): Promise<WorkspaceResolution> {
  const resolved = await resolveSessionCwd(deps, sessionId)
  if (!resolved.ok) return resolved
  const cwd = resolved.cwd
  const rel = repo ?? ''
  const key = rootCacheKey(cwd, rel)
  const cached = deps.rootCache?.get(key)
  if (cached !== undefined) return { ok: true, root: cached }
  const negAt = deps.rootNegCache?.get(key)
  if (negAt !== undefined) {
    if (Date.now() < negAt) {
      return { ok: false, failure: { ok: false, error: rel === '' ? { code: 'not-a-git-repo', cwd } : { code: 'invalid-repo', cwd } } }
    }
    deps.rootNegCache?.delete(key)
  }
  // Where git runs: the cwd itself for the default repository, or the selected
  // nested repository's real directory.
  let start = cwd
  if (rel !== '') {
    const target = await repoDirFor(deps.fs, cwd, rel)
    if (!target.ok) {
      deps.rootNegCache?.set(key, Date.now() + NEG_CACHE_MS)
      return { ok: false, failure: { ok: false, error: { code: 'invalid-repo', cwd } } }
    }
    start = target.dir
  }
  const top = await runCommand(deps.run, ['git', 'rev-parse', '--show-toplevel'], start, 'toplevel', deps.signal)
  if ('failure' in top) {
    // Spawn-level failure (git missing / not on PATH): keep the cwd on the
    // failure so the browse-root fallback and the "git not installed" probe
    // can still work without git.
    return { ok: false, failure: { ok: false, error: { ...mapRunFailure(top.failure), cwd } } }
  }
  if (top.run.cancelled) return { ok: false, failure: { ok: false, error: { code: 'cancelled' } } }
  if (top.run.timedOut) return { ok: false, failure: { ok: false, error: { code: 'timeout' } } }
  const out = top.run.exitCode === 0 ? top.run.stdout.trim() : ''
  if (out === '') {
    deps.rootNegCache?.set(key, Date.now() + NEG_CACHE_MS)
    return { ok: false, failure: { ok: false, error: rel === '' ? { code: 'not-a-git-repo', cwd } : { code: 'invalid-repo', cwd } } }
  }
  let root = out
  try {
    root = await deps.fs.realpath(out)
  } catch {
    // realpath failed (e.g. permissions) — keep the raw path already in root.
  }
  // A selector addresses a repository root, so git must resolve to that very
  // directory: an ancestor here means the selector named a plain subdirectory.
  if (rel !== '' && !samePath(root, start)) {
    deps.rootNegCache?.set(key, Date.now() + NEG_CACHE_MS)
    return { ok: false, failure: { ok: false, error: { code: 'invalid-repo', cwd } } }
  }
  deps.rootCache?.set(key, root)
  return { ok: true, root }
}

/**
 * Every checkout of the repository the session's cwd belongs to, from
 * `git worktree list --porcelain -z` (NUL-separated, so a path holding a
 * newline parses). A git that predates `-z` (< 2.36) refuses the flag; the
 * newline form is the fallback there. Any other failure — git missing,
 * unexpected output — returns no rows at all: the caller then lists only what
 * the filesystem scan finds, which is exactly a workspace without worktrees.
 */
async function workspaceWorktrees(
  deps: SnapshotDeps,
  cwd: string,
  root: string,
): Promise<readonly WorktreeCheckout[]> {
  let run = await runCommand(deps.run, ['git', 'worktree', 'list', '--porcelain', '-z'], root, 'worktrees', deps.signal)
  if ('failure' in run) return []
  if (run.run.cancelled || run.run.timedOut) return []
  if (run.run.exitCode !== 0) {
    run = await runCommand(deps.run, ['git', 'worktree', 'list', '--porcelain'], root, 'worktrees', deps.signal)
    if ('failure' in run) return []
    if (run.run.cancelled || run.run.timedOut || run.run.exitCode !== 0) return []
  }
  const infos = parseWorktreePorcelain(run.run.stdout)
  if (infos.length === 0) return []
  return worktreeCheckouts(deps.fs, cwd, root, infos)
}

/** Selectable worktree rows first (the ones the user can act on), then the
 * disabled ones, each group by path so the switcher order is stable. */
function bySelectabilityThenPath(a: WorktreeCheckout, b: WorktreeCheckout): number {
  const ad = a.disabled !== undefined ? 1 : 0
  const bd = b.disabled !== undefined ? 1 : 0
  if (ad !== bd) return ad - bd
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}

/**
 * Repositories a session's cwd offers: the repository the cwd belongs to (when
 * it does) plus — when `detectCheckouts` is on — every checkout below it: the
 * worktrees `git worktree list` certifies (unbounded in depth, and honest about
 * branches / locks / lost directories) and the nested repositories the
 * filesystem scan finds. The scan is filesystem-only — a '.git' entry is the
 * marker — so it still works when git cannot run at all. Both probes are off
 * with `detectCheckouts`: neither `git worktree list` nor the scan runs, and
 * the list is the cwd's own repository alone. `resultLimit` is the switcher's
 * ceiling for scanned repositories (tests shrink it).
 */
export async function listSessionRepos(
  deps: SnapshotDeps,
  sessionId: string,
  detectCheckouts: boolean,
  resultLimit: number = REPO_RESULT_LIMIT,
): Promise<{ readonly ok: true; readonly value: GitRepoList } | { readonly ok: false; readonly error: { readonly code: GitErrorCode; readonly message?: string } }> {
  const resolved = await resolveSessionCwd(deps, sessionId)
  if (!resolved.ok) return { ok: false, error: mapWorkspaceFailure(resolved.failure) }
  const cwd = await deps.fs.realpath(resolved.cwd).catch(() => resolved.cwd)
  const repos: GitRepoEntry[] = []
  const workspace = await resolveWorkspace(deps, sessionId)
  const worktrees = workspace.ok && detectCheckouts ? await workspaceWorktrees(deps, cwd, workspace.root) : []
  const linked = worktrees.filter((w) => w.path !== '').sort(bySelectabilityThenPath)
  const own = worktrees.find((w) => w.path === '')
  if (workspace.ok) {
    repos.push({
      path: '',
      root: workspace.root,
      name: basename(workspace.root),
      kind: 'workspace',
      ...(own !== undefined
        ? { role: own.role, branch: own.branch, ...(own.locked ? { locked: true } : {}) }
        : {}),
    })
  }
  for (const w of linked) {
    repos.push({
      path: w.path,
      root: w.root,
      name: w.name,
      kind: 'nested',
      role: w.role,
      branch: w.branch,
      ...(w.disabled !== undefined ? { disabled: w.disabled } : {}),
      ...(w.locked ? { locked: true } : {}),
    })
  }
  // Every worktree row is authoritative and listed whole; the filesystem scan
  // fills what is left of the ceiling. A directory git already claimed as a
  // worktree is that worktree's row, not a foreign repository — the scanner
  // reads its `.git` file like any other — so the scan runs with room for the
  // claimed hits and the cap applies after they are dropped: a shallow worktree
  // must not use up a slot a deeper repository needs.
  const scanLimit = Math.max(0, resultLimit - linked.length)
  const claimed: readonly string[] = worktrees
    .filter((w) => w.path !== '' && w.disabled === undefined)
    .map((w) => w.root)
  const scanned = detectCheckouts && scanLimit > 0
    ? await scanRepos(deps.fs, cwd, { resultLimit: scanLimit + claimed.length + (workspace.ok ? 1 : 0) })
    : []
  let foreign = 0
  for (const found of scanned) {
    if (foreign >= scanLimit) break
    // The scanner only descends into children, but a symlinked or
    // case-insensitive path can still alias the workspace root; identity is
    // the realpath.
    if (workspace.ok && samePath(found.root, workspace.root)) continue
    if (claimed.some((root) => samePath(found.root, root))) continue
    repos.push({ path: found.path, root: found.root, name: found.name, kind: 'nested', role: 'repo' })
    foreign += 1
  }
  return { ok: true, value: { cwd, repos } }
}

/** Run one git command; a spawn-level failure returns { failure }. */
export async function runCommand(
  runner: GitRunner,
  argv: readonly string[],
  cwd: string,
  _label: string,
  signal?: AbortSignal,
  stdinData?: string,
): Promise<{ run: Awaited<ReturnType<GitRunner['run']>> } | { failure: unknown }> {
  try {
    const run = await runner.run(argv, { cwd, ...(signal ? { signal } : {}), ...(stdinData !== undefined ? { stdinData } : {}) })
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
 * Filesystem-only probe for git-repo membership, used when git itself cannot
 * run (not installed / not on PATH). Walks up from `cwd` looking for a `.git`
 * entry (a directory in a normal clone, a file in a worktree/submodule). No git
 * process is spawned, so it works even with git absent; a bounded ancestor walk
 * guards against pathological depths.
 */
async function detectGitRepo(deps: SnapshotDeps, cwd: string): Promise<boolean> {
  let dir: string
  try {
    dir = await deps.fs.realpath(cwd)
  } catch {
    dir = cwd
  }
  for (let i = 0; i < 100; i++) {
    try {
      await deps.fs.stat(join(dir, '.git'))
      return true
    } catch {
      // no `.git` here — ascend
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return false
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
  opts?: { readonly fullChanges?: boolean; readonly repo?: string },
): Promise<GitSnapshotResult> {
  // A `fullChanges` request (the client's "expand all") lifts the list cap to
  // FULL_CHANGES_MAX so a big-but-sane change set arrives complete; everything
  // else (counts, stats fan-out, status fallback) keeps its normal bounds.
  const changeLimit = opts?.fullChanges === true ? Math.max(config.maxChanges, FULL_CHANGES_MAX) : config.maxChanges
  const workspace = await resolveWorkspace(deps, sessionId, opts?.repo)
  if (!workspace.ok) {
    // Surface the pill preference even on the not-a-git-repo path, where the
    // client still renders the directory-name marker.
    const failure = workspace.failure
    if (failure.error.code === 'not-a-git-repo') {
      return { ok: false, error: { ...failure.error, showInputPill: config.showInputPill } }
    }
    // git not installed: probe the filesystem for a `.git` so the client knows
    // whether to show the "git not installed" notice (inside a repo) or degrade
    // silently to the file browser (outside one). Either way the panel falls
    // back to file browsing.
    if (failure.error.code === 'git-unavailable') {
      const cwd = failure.error.cwd
      const isGitRepo = cwd !== undefined && cwd !== '' ? await detectGitRepo(deps, cwd) : false
      return { ok: false, error: { ...failure.error, isGitRepo } }
    }
    return failure
  }
  const root = workspace.root

  const [branchRes, headRes, statusRes, aheadBehindRes, lastCommitRes, worktreeNumRes, stagedNumRes, remoteRes] = await Promise.all([
    runCommand(deps.run, ['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], root, 'branch', deps.signal),
    runCommand(deps.run, ['git', 'rev-parse', '--short', 'HEAD'], root, 'head', deps.signal),
    runCommand(deps.run, ['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], root, 'status', deps.signal),
    runCommand(deps.run, ['git', 'rev-list', '--count', '--left-right', '@{upstream}...HEAD'], root, 'aheadBehind', deps.signal),
    runCommand(deps.run, ['git', 'log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI'], root, 'lastCommit', deps.signal),
    runCommand(deps.run, ['git', 'diff', '--numstat'], root, 'numstat-worktree', deps.signal),
    runCommand(deps.run, ['git', 'diff', '--numstat', '--cached'], root, 'numstat-staged', deps.signal),
    // `git remote -v` lists every remote's fetch/push URL; parsed into the
    // primary remote (origin, else the first) for the left-column status bar.
    runCommand(deps.run, ['git', 'remote', '-v'], root, 'remote', deps.signal),
  ])

  const branch = 'run' in branchRes && branchRes.run.exitCode === 0 ? branchRes.run.stdout.trim() || null : null
  const unborn = 'run' in headRes && headRes.run.exitCode !== 0
  const head = 'run' in headRes && headRes.run.exitCode === 0 ? headRes.run.stdout.trim() || null : null

  let allChanges: GitChange[] = []
  let statusLossy = false
  if ('run' in statusRes && !statusRes.run.timedOut && statusRes.run.exitCode === 0) {
    allChanges = parseStatus(statusRes.run.stdout)
    statusLossy = statusRes.run.stdoutLossy
  }
  // `--untracked-files=all` lifts untracked entries to file level, matching what
  // `git add` stages and what the changes list renders. An un-ignored build or
  // deps tree would flood that list (or clip the status stream), so past the list
  // cap the untracked side falls back to git's collapsed `?? dir/` entries and
  // the snapshot says so instead of silently truncating.
  let untrackedCollapsed = false
  const untrackedEntries = allChanges.filter((c) => c.status === 'untracked')
  // Only a whole untracked directory folds into one `?? dir/` entry; a flood of
  // root-level files cannot collapse, so the count branch skips the extra status
  // run unless some untracked path could belong to such a directory.
  const collapseCandidate = untrackedEntries.some((c) => c.path.includes('/'))
  if (statusLossy || (untrackedEntries.length > changeLimit && collapseCandidate)) {
    const collapsed = await runCommand(deps.run, ['git', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'], root, 'status-collapsed', deps.signal)
    if ('run' in collapsed && !collapsed.run.timedOut && collapsed.run.exitCode === 0) {
      const list = parseStatus(collapsed.run.stdout)
      untrackedCollapsed = list.some((c) => c.status === 'untracked' && c.isDirectory)
      allChanges = list
      statusLossy = collapsed.run.stdoutLossy
    }
  }
  // Truncated either because the list exceeded the cap or because the status
  // stream itself was clipped (a lossy read drops the head, so the leading
  // entries are the ones that go missing). The reason drives the UI wording.
  const truncated = allChanges.length > changeLimit || statusLossy
  const truncatedReason: TruncationReason | undefined = statusLossy
    ? 'lossy'
    : allChanges.length > changeLimit ? 'cap' : undefined
  const changes = allChanges.length > changeLimit ? allChanges.slice(0, changeLimit) : allChanges

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
  // A non-zero exit means `@{upstream}` does not resolve: the branch has no
  // tracking remote, so ahead/behind are undefined (stay 0) and the sync UI
  // must not offer a pull.
  const hasUpstream = 'run' in aheadBehindRes && aheadBehindRes.run.exitCode === 0
  if (hasUpstream && 'run' in aheadBehindRes) {
    const parts = aheadBehindRes.run.stdout.trim().split(/\s+/)
    behind = Number(parts[0]) || 0
    ahead = Number(parts[1]) || 0
  }

  const remote = 'run' in remoteRes && remoteRes.run.exitCode === 0 ? parsePrimaryRemote(remoteRes.run.stdout) : null

  let lastCommit: GitCommit | null = null
  if ('run' in lastCommitRes && lastCommitRes.run.exitCode === 0) {
    lastCommit = commitFromFields(lastCommitRes.run.stdout.trim().split('\x1f'))
  }

  // Worktree statistics fold into the single snapshot (no separate endpoint
  // fan-out): line counts from the two numstat runs above, untracked lines and
  // mtimes best-effort, HEAD time from lastCommit.
  const wt = 'run' in worktreeNumRes && worktreeNumRes.run.exitCode === 0 ? sumNumstat(worktreeNumRes.run.stdout) : { insertions: 0, deletions: 0 }
  const stg = 'run' in stagedNumRes && stagedNumRes.run.exitCode === 0 ? sumNumstat(stagedNumRes.run.stdout) : { insertions: 0, deletions: 0 }
  // The two per-file passes below are O(changes) but differ by orders of
  // magnitude in cost, so they get separate ceilings: mtime (`fs.stat`, cheap)
  // by total changes, untracked line counts (a git process per file) by the
  // untracked count. See STATS_FANOUT_LIMIT / UNTRACKED_NUMSTAT_LIMIT.
  const statsDetailed = allChanges.length <= STATS_FANOUT_LIMIT
  const untrackedPaths = allChanges.filter((c) => c.status === 'untracked' && !c.isDirectory).map((c) => c.path)
  const untrackedCountable = untrackedPaths.length <= UNTRACKED_NUMSTAT_LIMIT
  let untrackedInsertions = 0
  if (untrackedCountable) {
    const safeUntracked = untrackedPaths.filter(isSafePath)
    if (safeUntracked.length > 0) {
      const perFile = await Promise.all(
        safeUntracked.map((p) => runCommand(deps.run, ['git', 'diff', '--numstat', '--no-index', '--', '/dev/null', p], root, 'numstat-untracked', deps.signal)),
      )
      for (const r of perFile) if ('run' in r) untrackedInsertions += sumNumstat(r.run.stdout).insertions
    }
  }
  const lastChangeAt = statsDetailed ? await maxChangeMtime(deps, root, allChanges) : null
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
    // Collapsed untracked directories have no per-file line counts and count as
    // one entry each, so the stats are an explicit lower bound there too.
    partial: !statsDetailed || !untrackedCountable || untrackedCollapsed,
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
    hasUpstream,
    remote,
    lastCommit,
    changes,
    stats,
    truncated,
    ...(truncatedReason !== undefined ? { truncatedReason } : {}),
    ...(untrackedCollapsed ? { untrackedCollapsed: true as const } : {}),
    refreshIntervalMs: config.refreshIntervalMs,
    showInputPill: config.showInputPill,
    defaultDiffView: config.defaultDiffView,
    graphStyle: config.graphStyle,
    fontDelta: config.fontDelta,
    suggestEnabled: config.suggestEnabled,
    detectCheckouts: config.detectCheckouts,
    filesFollowRepo: config.filesFollowRepo,
    collapseReposOnPick: config.collapseReposOnPick,
    checkedAt: Date.now(),
  }
  return { ok: true, value: { ...snapshot, stateFingerprint: snapshotFingerprint(snapshot) } }
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
      if (Number.isFinite(info.mtimeMs)) {
        max = max === null ? info.mtimeMs : Math.max(max, info.mtimeMs)
      }
    } catch {
      // path gone — skip
    }
  }))
  return max
}
