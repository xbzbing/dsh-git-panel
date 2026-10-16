import { dirname, join } from "node:path";
import { commitFromFields, parseStatus, sumNumstat } from "./parser.js";
import { parseRemote } from "./remote.js";
import { snapshotFingerprint } from "./snapshot-fingerprint.js";
import { isSafePath } from "./validate.js";
import { SUGGEST_LANGUAGE_DEFAULT, SUGGEST_LANGUAGES, SUGGEST_LIMITS } from "./types.js";
const DEFAULT_CONFIG = {
  timeoutMs: 8e3,
  maxBytes: 4 * 1024 * 1024,
  maxChanges: 1e3,
  refreshIntervalMs: 3e4,
  showInputPill: true,
  defaultDiffView: "unified",
  graphStyle: "parallel",
  suggestEnabled: true,
  suggestLanguage: SUGGEST_LANGUAGE_DEFAULT,
  suggestMaxBytes: SUGGEST_LIMITS.maxBytes.default,
  suggestMaxOutputTokens: SUGGEST_LIMITS.maxOutputTokens.default,
  suggestTimeoutMs: SUGGEST_LIMITS.timeoutMs.default
};
function normalizeConfig(raw) {
  const c = raw ?? {};
  const num = (v, d) => typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : d;
  const clampLimit = (v, limit) => {
    const raw2 = unwrapVolatile(v);
    return typeof raw2 === "number" && Number.isFinite(raw2) ? Math.min(limit.max, Math.max(limit.min, Math.floor(raw2))) : limit.default;
  };
  const hasProvider = typeof c.suggestProvider === "string" && c.suggestProvider !== "";
  const hasModel = typeof c.suggestModel === "string" && c.suggestModel !== "";
  const route = hasProvider && hasModel ? { suggestProvider: c.suggestProvider, suggestModel: c.suggestModel } : {};
  return {
    timeoutMs: num(c.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    maxBytes: num(c.maxBytes, DEFAULT_CONFIG.maxBytes),
    maxChanges: num(c.maxChanges, DEFAULT_CONFIG.maxChanges),
    refreshIntervalMs: num(c.refreshIntervalMs, DEFAULT_CONFIG.refreshIntervalMs),
    showInputPill: readBool(c.showInputPill, DEFAULT_CONFIG.showInputPill),
    defaultDiffView: readDiffView(c.defaultDiffView, DEFAULT_CONFIG.defaultDiffView),
    graphStyle: readGraphStyle(c.graphStyle, DEFAULT_CONFIG.graphStyle),
    suggestEnabled: readBool(c.suggestEnabled, DEFAULT_CONFIG.suggestEnabled),
    suggestLanguage: readSuggestLanguage(c.suggestLanguage, DEFAULT_CONFIG.suggestLanguage),
    suggestMaxBytes: clampLimit(c.suggestMaxBytes, SUGGEST_LIMITS.maxBytes),
    suggestMaxOutputTokens: clampLimit(c.suggestMaxOutputTokens, SUGGEST_LIMITS.maxOutputTokens),
    suggestTimeoutMs: clampLimit(c.suggestTimeoutMs, SUGGEST_LIMITS.timeoutMs),
    ...route
  };
}
function unwrapVolatile(value) {
  return value !== null && typeof value === "object" && "get" in value && typeof value.get === "function" ? value.get() : value;
}
function readDiffView(value, fallback) {
  const raw = unwrapVolatile(value);
  return raw === "unified" || raw === "split" ? raw : fallback;
}
function readGraphStyle(value, fallback) {
  const raw = unwrapVolatile(value);
  return raw === "parallel" || raw === "compact" ? raw : fallback;
}
function readSuggestLanguage(value, fallback) {
  const raw = unwrapVolatile(value);
  return typeof raw === "string" && SUGGEST_LANGUAGES.includes(raw) ? raw : fallback;
}
function readBool(value, fallback) {
  const raw = unwrapVolatile(value);
  return typeof raw === "boolean" ? raw : fallback;
}
const NEG_CACHE_MS = 15e3;
function parsePrimaryRemote(stdout) {
  const fetchUrls = /* @__PURE__ */ new Map();
  const order = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^(\S+)\t(\S+)\s+\(fetch\)$/);
    if (m === null) continue;
    const name2 = m[1];
    if (!fetchUrls.has(name2)) {
      fetchUrls.set(name2, m[2]);
      order.push(name2);
    }
  }
  if (order.length === 0) return null;
  const name = fetchUrls.has("origin") ? "origin" : order[0];
  return parseRemote(name, fetchUrls.get(name));
}
const STATS_FANOUT_LIMIT = 200;
async function resolveBrowseRoot(deps, sessionId) {
  const ws = await resolveWorkspace(deps, sessionId);
  if (ws.ok) return { ok: true, root: ws.root, isGitRepo: true };
  const err = ws.failure.error;
  if ((err.code === "not-a-git-repo" || err.code === "git-unavailable") && "cwd" in err && err.cwd !== void 0 && err.cwd !== "") {
    try {
      return { ok: true, root: await deps.fs.realpath(err.cwd), isGitRepo: false };
    } catch {
      return { ok: false, error: { code: "git-error" } };
    }
  }
  return { ok: false, error: mapWorkspaceFailure(ws.failure) };
}
async function resolveWorkspace(deps, sessionId) {
  let cwd = deps.sessions.liveCwd(sessionId);
  if (cwd === void 0 || cwd === "") {
    const meta = await deps.sessions.persistedMeta(sessionId);
    cwd = meta?.cwd;
  }
  if (cwd === void 0 || cwd === "") {
    return { ok: false, failure: { ok: false, error: { code: "cwd-unavailable", sessionId } } };
  }
  const cached = deps.rootCache?.get(cwd);
  if (cached !== void 0) return { ok: true, root: cached };
  const negAt = deps.rootNegCache?.get(cwd);
  if (negAt !== void 0) {
    if (Date.now() < negAt) return { ok: false, failure: { ok: false, error: { code: "not-a-git-repo", cwd } } };
    deps.rootNegCache?.delete(cwd);
  }
  const top = await runCommand(deps.run, ["git", "rev-parse", "--show-toplevel"], cwd, "toplevel", deps.signal);
  if ("failure" in top) {
    return { ok: false, failure: { ok: false, error: { ...mapRunFailure(top.failure), cwd } } };
  }
  if (top.run.cancelled) return { ok: false, failure: { ok: false, error: { code: "cancelled" } } };
  if (top.run.timedOut) return { ok: false, failure: { ok: false, error: { code: "timeout" } } };
  if (top.run.exitCode !== 0) {
    deps.rootNegCache?.set(cwd, Date.now() + NEG_CACHE_MS);
    return { ok: false, failure: { ok: false, error: { code: "not-a-git-repo", cwd } } };
  }
  const raw = top.run.stdout.trim();
  if (raw === "") {
    deps.rootNegCache?.set(cwd, Date.now() + NEG_CACHE_MS);
    return { ok: false, failure: { ok: false, error: { code: "not-a-git-repo", cwd } } };
  }
  let root = raw;
  try {
    root = await deps.fs.realpath(raw);
  } catch {
  }
  deps.rootCache?.set(cwd, root);
  return { ok: true, root };
}
async function runCommand(runner, argv, cwd, _label, signal, stdinData) {
  try {
    const run = await runner.run(argv, { cwd, ...signal ? { signal } : {}, ...stdinData !== void 0 ? { stdinData } : {} });
    return { run };
  } catch (error) {
    return { failure: error };
  }
}
function mapRunFailure(failure) {
  const message = failure instanceof Error ? failure.message : String(failure);
  return { code: "git-unavailable", detail: message };
}
async function detectGitRepo(deps, cwd) {
  let dir;
  try {
    dir = await deps.fs.realpath(cwd);
  } catch {
    dir = cwd;
  }
  for (let i = 0; i < 100; i++) {
    try {
      await deps.fs.stat(join(dir, ".git"));
      return true;
    } catch {
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}
function mapWorkspaceFailure(failure) {
  const error = failure.error;
  const message = "detail" in error ? error.detail : void 0;
  return { code: error.code, ...message !== void 0 ? { message } : {} };
}
async function snapshotForSession(deps, config, sessionId) {
  const workspace = await resolveWorkspace(deps, sessionId);
  if (!workspace.ok) {
    const failure = workspace.failure;
    if (failure.error.code === "not-a-git-repo") {
      return { ok: false, error: { ...failure.error, showInputPill: config.showInputPill } };
    }
    if (failure.error.code === "git-unavailable") {
      const cwd = failure.error.cwd;
      const isGitRepo = cwd !== void 0 && cwd !== "" ? await detectGitRepo(deps, cwd) : false;
      return { ok: false, error: { ...failure.error, isGitRepo } };
    }
    return failure;
  }
  const root = workspace.root;
  const [branchRes, headRes, statusRes, aheadBehindRes, lastCommitRes, worktreeNumRes, stagedNumRes, remoteRes] = await Promise.all([
    runCommand(deps.run, ["git", "symbolic-ref", "--quiet", "--short", "HEAD"], root, "branch", deps.signal),
    runCommand(deps.run, ["git", "rev-parse", "--short", "HEAD"], root, "head", deps.signal),
    runCommand(deps.run, ["git", "status", "--porcelain=v1", "-z"], root, "status", deps.signal),
    runCommand(deps.run, ["git", "rev-list", "--count", "--left-right", "@{upstream}...HEAD"], root, "aheadBehind", deps.signal),
    runCommand(deps.run, ["git", "log", "-1", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI"], root, "lastCommit", deps.signal),
    runCommand(deps.run, ["git", "diff", "--numstat"], root, "numstat-worktree", deps.signal),
    runCommand(deps.run, ["git", "diff", "--numstat", "--cached"], root, "numstat-staged", deps.signal),
    // `git remote -v` lists every remote's fetch/push URL; parsed into the
    // primary remote (origin, else the first) for the left-column status bar.
    runCommand(deps.run, ["git", "remote", "-v"], root, "remote", deps.signal)
  ]);
  const branch = "run" in branchRes && branchRes.run.exitCode === 0 ? branchRes.run.stdout.trim() || null : null;
  const unborn = "run" in headRes && headRes.run.exitCode !== 0;
  const head = "run" in headRes && headRes.run.exitCode === 0 ? headRes.run.stdout.trim() || null : null;
  let allChanges = [];
  let statusLossy = false;
  if ("run" in statusRes && !statusRes.run.timedOut && statusRes.run.exitCode === 0) {
    allChanges = parseStatus(statusRes.run.stdout);
    statusLossy = statusRes.run.stdoutLossy;
  }
  const truncated = allChanges.length > config.maxChanges || statusLossy;
  const changes = allChanges.length > config.maxChanges ? allChanges.slice(0, config.maxChanges) : allChanges;
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  for (const c of allChanges) {
    if (c.status === "untracked") untracked++;
    else if (c.staged) staged++;
    else modified++;
  }
  let ahead = 0;
  let behind = 0;
  const hasUpstream = "run" in aheadBehindRes && aheadBehindRes.run.exitCode === 0;
  if (hasUpstream && "run" in aheadBehindRes) {
    const parts = aheadBehindRes.run.stdout.trim().split(/\s+/);
    behind = Number(parts[0]) || 0;
    ahead = Number(parts[1]) || 0;
  }
  const remote = "run" in remoteRes && remoteRes.run.exitCode === 0 ? parsePrimaryRemote(remoteRes.run.stdout) : null;
  let lastCommit = null;
  if ("run" in lastCommitRes && lastCommitRes.run.exitCode === 0) {
    lastCommit = commitFromFields(lastCommitRes.run.stdout.trim().split(""));
  }
  const wt = "run" in worktreeNumRes && worktreeNumRes.run.exitCode === 0 ? sumNumstat(worktreeNumRes.run.stdout) : { insertions: 0, deletions: 0 };
  const stg = "run" in stagedNumRes && stagedNumRes.run.exitCode === 0 ? sumNumstat(stagedNumRes.run.stdout) : { insertions: 0, deletions: 0 };
  const statsDetailed = allChanges.length <= STATS_FANOUT_LIMIT;
  let untrackedInsertions = 0;
  if (statsDetailed) {
    const untrackedPaths = allChanges.filter((c) => c.status === "untracked" && !c.isDirectory).map((c) => c.path);
    const safeUntracked = untrackedPaths.filter(isSafePath);
    if (safeUntracked.length > 0) {
      const perFile = await Promise.all(
        safeUntracked.map((p) => runCommand(deps.run, ["git", "diff", "--numstat", "--no-index", "--", "/dev/null", p], root, "numstat-untracked", deps.signal))
      );
      for (const r of perFile) if ("run" in r) untrackedInsertions += sumNumstat(r.run.stdout).insertions;
    }
  }
  const lastChangeAt = statsDetailed ? await maxChangeMtime(deps, root, allChanges) : null;
  const distinct = new Set(allChanges.map((c) => c.path));
  const stats = {
    fileCount: distinct.size,
    staged,
    modified,
    untracked,
    insertions: wt.insertions + stg.insertions + untrackedInsertions,
    deletions: wt.deletions + stg.deletions,
    lastChangeAt,
    headCommittedAt: lastCommit?.dateIso ?? null,
    partial: !statsDetailed
  };
  const snapshot = {
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
    refreshIntervalMs: config.refreshIntervalMs,
    showInputPill: config.showInputPill,
    defaultDiffView: config.defaultDiffView,
    graphStyle: config.graphStyle,
    suggestEnabled: config.suggestEnabled,
    checkedAt: Date.now()
  };
  return { ok: true, value: { ...snapshot, stateFingerprint: snapshotFingerprint(snapshot) } };
}
async function maxChangeMtime(deps, root, changes, cap = 200) {
  let max = null;
  const slice = changes.slice(0, cap);
  await Promise.all(slice.map(async (c) => {
    if (c.isDirectory) return;
    try {
      const info = await deps.fs.stat(join(root, c.path));
      if (Number.isFinite(info.mtimeMs)) {
        max = max === null ? info.mtimeMs : Math.max(max, info.mtimeMs);
      }
    } catch {
    }
  }));
  return max;
}
export {
  DEFAULT_CONFIG,
  mapWorkspaceFailure,
  maxChangeMtime,
  normalizeConfig,
  parsePrimaryRemote,
  readBool,
  readDiffView,
  readGraphStyle,
  readSuggestLanguage,
  resolveBrowseRoot,
  resolveWorkspace,
  runCommand,
  snapshotForSession
};
