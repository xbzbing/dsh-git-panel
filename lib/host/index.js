var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name, symbol) => (symbol = Symbol[name]) ? symbol : Symbol.for("Symbol." + name);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name]() {
    return __privateGet(this, extra);
  }, set [name](x) {
    return __privateSet(this, extra, x);
  } }, name));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name) : __name(target, name);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name, desc), p ? k ^ 4 ? extra : desc : target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// src/host/index.ts
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import Schema from "@deepseek-ai/schemastery";
import { readFile as readFile3, realpath, rm, stat } from "node:fs/promises";

// src/host/git.ts
import { readFile } from "node:fs/promises";
function createGitRunner(subprocess, timeoutMs, maxBytes) {
  const spillMaxBytes = maxBytes * 16;
  return {
    async run(argv, opts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const signal = opts.signal === void 0 ? controller.signal : AbortSignal.any([controller.signal, opts.signal]);
        const handle = subprocess.spawn({
          argv,
          cwd: opts.cwd,
          stdio: {
            stdin: "ignore",
            stdout: { collect: { maxBytes, spill: { maxBytes: spillMaxBytes } } },
            stderr: { collect: { maxBytes, spill: { maxBytes: spillMaxBytes } } }
          },
          graceMs: 200,
          signal
        });
        let outcome;
        try {
          outcome = await handle.done;
        } catch (error) {
          if (controller.signal.aborted || opts.signal?.aborted === true) {
            return { exitCode: null, stdout: "", stderr: "", timedOut: true, stdoutLossy: false };
          }
          throw error;
        }
        const stdout = handle.collected.stdout?.readFrom(0);
        const stderr = handle.collected.stderr?.readFrom(0);
        const resolved = await resolveStdout(stdout);
        return {
          exitCode: outcome.exitCode,
          stdout: resolved.text,
          stderr: stderr?.text ?? "",
          timedOut: controller.signal.aborted || opts.signal?.aborted === true,
          stdoutLossy: resolved.lossy
        };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
async function resolveStdout(read) {
  if (read === void 0) return { text: "", lossy: false };
  if (!read.lossy || read.spillPath === void 0) return { text: read.text, lossy: read.lossy };
  try {
    return { text: await readFile(read.spillPath, "utf8"), lossy: false };
  } catch {
    return { text: read.text, lossy: true };
  }
}

// src/host/core.ts
import { join } from "node:path";

// src/host/parser.ts
function statusOf(code) {
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "added";
    case "T":
      return "typechange";
    case "U":
      return "conflicted";
    case "?":
      return "untracked";
    default:
      return "modified";
  }
}
function parseStatus(stdout) {
  const out = [];
  const records = stdout.split("\0");
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec === void 0 || rec.length < 3) continue;
    const x = rec[0];
    const y = rec[1];
    let path = rec.slice(3);
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      i++;
    }
    const isDirectory = path.endsWith("/");
    if (isDirectory) path = path.replace(/\/+$/, "");
    if (x === "?" && y === "?") {
      out.push({ path, status: "untracked", staged: false, isDirectory });
      continue;
    }
    if (x === "U" || y === "U" || x === "A" && y === "A" || x === "D" && y === "D") {
      out.push({ path, status: "conflicted", staged: false, isDirectory });
      continue;
    }
    if (x !== " " && x !== "?") {
      out.push({ path, status: statusOf(x), staged: true, isDirectory });
    }
    if (y !== " " && y !== "?") {
      out.push({ path, status: statusOf(y), staged: false, isDirectory });
    }
  }
  return out;
}
function parseGraphLog(stdout) {
  const out = [];
  for (const record of stdout.split("")) {
    const rec = record.replace(/^\n+/, "");
    if (rec.trim() === "") continue;
    const parts = rec.split("");
    if (parts.length < 7) continue;
    const [hash, shortHash, parentsRaw, author, dateIso, decoration, subject] = parts;
    const parents = (parentsRaw ?? "").trim() === "" ? [] : parentsRaw.trim().split(/\s+/);
    out.push({
      hash: hash ?? "",
      shortHash: shortHash ?? "",
      subject: subject ?? "",
      author: author ?? "",
      dateIso: dateIso ?? "",
      parents,
      refs: parseRefs(decoration ?? "")
    });
  }
  return out;
}
function parseRefs(decoration) {
  const refs = [];
  for (const raw of decoration.split(",")) {
    let token = raw.trim();
    if (token === "") continue;
    let head = false;
    if (token.startsWith("HEAD -> ")) {
      head = true;
      token = token.slice("HEAD -> ".length).trim();
    } else if (token === "HEAD") {
      continue;
    }
    if (token.startsWith("tag: ")) {
      refs.push({ kind: "tag", name: token.slice("tag: ".length).trim(), head: false });
    } else if (token.startsWith("origin/") || token.includes("/")) {
      refs.push({ kind: "remote", name: token, head });
    } else {
      refs.push({ kind: "branch", name: token, head });
    }
  }
  return refs;
}
function parseBranches(stdout) {
  const out = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const [name, shortHash = "", track = ""] = line.split("\0");
    if (name === void 0 || name === "") continue;
    const branch = {
      name,
      shortHash: shortHash === "" ? null : shortHash
    };
    const ahead = /ahead (\d+)/.exec(track);
    const behind = /behind (\d+)/.exec(track);
    if (ahead) branch.ahead = Number(ahead[1]);
    if (behind) branch.behind = Number(behind[1]);
    out.push(branch);
  }
  return out;
}
function parseNameStatus(stdout) {
  const out = [];
  const tokens = stdout.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === void 0 || tok === "") continue;
    const code = tok[0];
    if (code === void 0 || !/[AMDRCTU]/.test(code)) continue;
    if (code === "R" || code === "C") {
      const newPath = tokens[i + 2];
      i += 2;
      if (newPath) out.push({ path: newPath, status: statusOf(code) });
      continue;
    }
    const path = tokens[i + 1];
    i += 1;
    if (path) out.push({ path, status: statusOf(code) });
  }
  return out;
}
function sumNumstat(stdout) {
  let insertions = 0;
  let deletions = 0;
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("	");
    if (parts.length < 2) continue;
    const add = Number(parts[0]);
    const del = Number(parts[1]);
    if (Number.isFinite(add)) insertions += add;
    if (Number.isFinite(del)) deletions += del;
  }
  return { insertions, deletions };
}

// src/host/core.ts
var DEFAULT_CONFIG = {
  timeoutMs: 8e3,
  maxBytes: 4 * 1024 * 1024,
  maxChanges: 1e3,
  refreshIntervalMs: 3e4,
  showInputPill: true
};
function normalizeConfig(raw) {
  const c = raw ?? {};
  const num = (v, d) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d;
  return {
    timeoutMs: num(c.timeoutMs, DEFAULT_CONFIG.timeoutMs),
    maxBytes: num(c.maxBytes, DEFAULT_CONFIG.maxBytes),
    maxChanges: num(c.maxChanges, DEFAULT_CONFIG.maxChanges),
    refreshIntervalMs: num(c.refreshIntervalMs, DEFAULT_CONFIG.refreshIntervalMs),
    showInputPill: readBool(c.showInputPill, DEFAULT_CONFIG.showInputPill)
  };
}
function readBool(value, fallback) {
  const raw = value !== null && typeof value === "object" && "get" in value && typeof value.get === "function" ? value.get() : value;
  return typeof raw === "boolean" ? raw : fallback;
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
  const top = await runCommand(deps.run, ["git", "rev-parse", "--show-toplevel"], cwd, "toplevel", deps.signal);
  if ("failure" in top) {
    return { ok: false, failure: { ok: false, error: mapRunFailure(top.failure) } };
  }
  if (top.run.timedOut) return { ok: false, failure: { ok: false, error: { code: "timeout" } } };
  if (top.run.exitCode !== 0) {
    return { ok: false, failure: { ok: false, error: { code: "not-a-git-repo", cwd } } };
  }
  const raw = top.run.stdout.trim();
  if (raw === "") return { ok: false, failure: { ok: false, error: { code: "not-a-git-repo", cwd } } };
  let root = raw;
  try {
    root = await deps.fs.realpath(raw);
  } catch {
    root = raw;
  }
  deps.rootCache?.set(cwd, root);
  return { ok: true, root };
}
async function runCommand(runner, argv, cwd, _label, signal) {
  try {
    const run = await runner.run(argv, { cwd, ...signal ? { signal } : {} });
    return { run };
  } catch (error) {
    return { failure: error };
  }
}
function mapRunFailure(failure) {
  const message = failure instanceof Error ? failure.message : String(failure);
  return { code: "git-unavailable", detail: message };
}
async function snapshotForSession(deps, config, sessionId) {
  const workspace = await resolveWorkspace(deps, sessionId);
  if (!workspace.ok) {
    const failure = workspace.failure;
    if (failure.error.code === "not-a-git-repo") {
      return { ok: false, error: { ...failure.error, showInputPill: config.showInputPill } };
    }
    return failure;
  }
  const root = workspace.root;
  const [branchRes, headRes, statusRes, aheadBehindRes, lastCommitRes] = await Promise.all([
    runCommand(deps.run, ["git", "symbolic-ref", "--quiet", "--short", "HEAD"], root, "branch", deps.signal),
    runCommand(deps.run, ["git", "rev-parse", "--short", "HEAD"], root, "head", deps.signal),
    runCommand(deps.run, ["git", "status", "--porcelain=v1", "-z"], root, "status", deps.signal),
    runCommand(deps.run, ["git", "rev-list", "--count", "--left-right", "@{upstream}...HEAD"], root, "aheadBehind", deps.signal),
    runCommand(deps.run, ["git", "log", "-1", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI"], root, "lastCommit", deps.signal)
  ]);
  const branch = "run" in branchRes && branchRes.run.exitCode === 0 ? branchRes.run.stdout.trim() || null : null;
  const unborn = "run" in headRes && headRes.run.exitCode !== 0;
  const head = unborn ? null : "run" in headRes ? headRes.run.stdout.trim() || null : null;
  let allChanges = [];
  if ("run" in statusRes && !statusRes.run.timedOut && statusRes.run.exitCode === 0) {
    allChanges = parseStatus(statusRes.run.stdout);
  }
  const truncated = allChanges.length > config.maxChanges;
  const changes = truncated ? allChanges.slice(0, config.maxChanges) : allChanges;
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  for (const c of changes) {
    if (c.status === "untracked") untracked++;
    else if (c.staged) staged++;
    else modified++;
  }
  let ahead = 0;
  let behind = 0;
  if ("run" in aheadBehindRes && aheadBehindRes.run.exitCode === 0) {
    const parts = aheadBehindRes.run.stdout.trim().split(/\s+/);
    behind = Number(parts[0]) || 0;
    ahead = Number(parts[1]) || 0;
  }
  let lastCommit = null;
  if ("run" in lastCommitRes && lastCommitRes.run.exitCode === 0) {
    const parts = lastCommitRes.run.stdout.trim().split("");
    if (parts.length >= 5 && parts[0]) {
      lastCommit = {
        hash: parts[0],
        shortHash: parts[1] ?? "",
        subject: parts[2] ?? "",
        author: parts[3] ?? "",
        dateIso: parts[4] ?? ""
      };
    }
  }
  const snapshot = {
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
    checkedAt: Date.now()
  };
  return { ok: true, value: snapshot };
}
async function maxChangeMtime(deps, root, changes, cap = 200) {
  let max = null;
  const slice = changes.slice(0, cap);
  await Promise.all(slice.map(async (c) => {
    if (c.isDirectory) return;
    try {
      const info = await deps.fs.stat(join(root, c.path));
      if (typeof info.mtimeMs === "number" && Number.isFinite(info.mtimeMs)) {
        max = max === null ? info.mtimeMs : Math.max(max, info.mtimeMs);
      }
    } catch {
    }
  }));
  return max;
}

// src/host/actions.ts
import { isAbsolute, normalize } from "node:path";
function isSafePath(path) {
  if (path === "" || isAbsolute(path)) return false;
  const norm = normalize(path);
  if (norm === ".." || norm.startsWith("../") || norm.startsWith("..\\")) return false;
  return true;
}
function withPaths(prefixes, paths) {
  if (paths.length === 0) return { error: "invalid-path", message: "no paths given" };
  for (const path of paths) {
    if (!isSafePath(path)) return { error: "invalid-path", message: `unsafe path: ${path}` };
  }
  return { argv: prefixes.map((prefix) => [...prefix, ...paths]) };
}
function planAction(action, unborn) {
  switch (action.kind) {
    case "stage":
      return withPaths([["git", "add", "--"]], action.paths);
    case "stage-all":
      return { argv: [["git", "add", "-A"]] };
    case "unstage":
      return unborn ? withPaths([["git", "rm", "--cached", "-r", "--"]], action.paths) : withPaths([["git", "restore", "--staged", "--"]], action.paths);
    case "unstage-all":
      return unborn ? { argv: [["git", "rm", "--cached", "-r", "--", "."]] } : { argv: [["git", "restore", "--staged", "--", "."]] };
    case "discard":
      return withPaths([["git", "restore", "--"]], action.paths);
    case "commit": {
      const message = action.message.trim();
      const amendFlag = action.amend === true ? ["--amend"] : [];
      if (message === "" && action.amend !== true) return { error: "empty-message" };
      const msgArgs = message === "" ? [] : ["-m", message];
      if (action.paths === void 0 || action.paths.length === 0) {
        return { argv: [["git", "commit", ...amendFlag, ...msgArgs]] };
      }
      const staged = withPaths([["git", "add", "--"]], action.paths);
      if ("error" in staged) return staged;
      const commitCmd = ["git", "commit", ...amendFlag, ...msgArgs, "--", ...action.paths];
      for (const path of action.paths) {
        if (!isSafePath(path)) return { error: "invalid-path", message: `unsafe path: ${path}` };
      }
      return { argv: [...staged.argv, commitCmd] };
    }
    case "branch-checkout":
      return { argv: [["git", "checkout", action.name]] };
    case "fetch":
      return { argv: [["git", "fetch", "--all", "--prune"]] };
  }
}
async function runAction(deps, config, request) {
  const workspace = await resolveWorkspace(deps, request.sessionId);
  if (!workspace.ok) {
    const error = workspace.failure.error;
    return { ok: false, error: { code: error.code, message: "detail" in error ? error.detail : void 0 } };
  }
  const root = workspace.root;
  const headProbe = await runCommand(deps.run, ["git", "rev-parse", "--verify", "HEAD"], root, "head-probe", deps.signal);
  const unborn = !("run" in headProbe) || headProbe.run.exitCode !== 0;
  const plan = planAction(request.action, unborn);
  if ("error" in plan) return { ok: false, error: { code: plan.error, ...plan.message ? { message: plan.message } : {} } };
  let lastOutput = "";
  for (const argv of plan.argv) {
    const outcome = await runCommand(deps.run, argv, root, "action", deps.signal);
    if ("failure" in outcome) {
      const message = outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure);
      return { ok: false, error: { code: "git-unavailable", message } };
    }
    if (outcome.run.timedOut) return { ok: false, error: { code: "timeout" } };
    lastOutput = outcome.run.stdout || outcome.run.stderr;
    if (outcome.run.exitCode !== 0) {
      const stderr = outcome.run.stderr;
      if (/nothing to commit|no changes added/i.test(stderr + lastOutput)) {
        return { ok: false, error: { code: "git-error", message: stderr.trim() || "nothing to commit" } };
      }
      if (/would be overwritten by checkout|local changes/i.test(stderr)) {
        return { ok: false, error: { code: "local-changes-block", message: stderr.trim() } };
      }
      return { ok: false, error: { code: "git-error", message: stderr.trim() || `git exited ${outcome.run.exitCode}` } };
    }
  }
  const snapshot = await snapshotForSession(deps, config, request.sessionId);
  if (!snapshot.ok) {
    return { ok: false, error: { code: "git-error", message: "snapshot after action failed" } };
  }
  return { ok: true, snapshot: snapshot.value, output: lastOutput.trim() };
}

// src/host/queries.ts
import { join as join2 } from "node:path";

// src/host/types.ts
var IMAGE_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff"
};
function imageMimeFor(path) {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return IMAGE_MIME[path.slice(dot + 1).toLowerCase()] ?? null;
}

// src/host/queries.ts
var GRAPH_FORMAT = "--format=%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e";
function isHexLike(text) {
  return /^[0-9a-fA-F]{7,40}$/.test(text.trim());
}
async function runQuery(deps, config, request) {
  const workspace = await resolveWorkspace(deps, request.sessionId);
  if (!workspace.ok) {
    const error = workspace.failure.error;
    return {
      ok: false,
      error: {
        code: error.code === "not-a-git-repo" || error.code === "cwd-unavailable" || error.code === "session-not-found" || error.code === "timeout" || error.code === "git-unavailable" ? error.code : "git-error",
        ..."detail" in error ? { message: error.detail } : {}
      }
    };
  }
  const root = workspace.root;
  const q = request.query;
  try {
    switch (q.kind) {
      case "history":
        return await queryHistory(deps, root, q);
      case "diff":
        return await queryDiff(deps, root, q);
      case "image-diff":
        return await queryImageDiff(deps, config, root, q);
      case "show":
        return await queryShow(deps, root, q.ref);
      case "branches":
        return await queryBranches(deps, root);
      case "tags":
        return await queryTags(deps, root);
      case "authors":
        return await queryAuthors(deps, root);
      case "last-commit-message":
        return await queryLastCommitMessage(deps, root);
      case "worktree-stats":
        return await queryWorktreeStats(deps, config, root, request.sessionId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { code: "git-error", message } };
  }
}
async function queryHistory(deps, root, q) {
  const args = ["git", "log", GRAPH_FORMAT, `--max-count=${q.limit}`, `--skip=${q.skip}`];
  const search = q.search?.trim() ?? "";
  const hexJump = search !== "" && isHexLike(search);
  const countArgs = ["git", "rev-list", "--count"];
  if (!hexJump) {
    if (q.ref !== void 0 && q.ref !== "") {
      args.push(q.ref);
      countArgs.push(q.ref);
    } else {
      args.push("--all");
      countArgs.push("--all");
    }
    if (search !== "") {
      args.push("-i", "-E", `--grep=${search}`);
      countArgs.push("-i", "-E", `--grep=${search}`);
    }
    if (q.author !== void 0 && q.author !== "") {
      args.push(`--author=${q.author}`);
      countArgs.push(`--author=${q.author}`);
    }
    if (q.since !== void 0 && q.since !== "") {
      args.push(`--since=${q.since}`);
      countArgs.push(`--since=${q.since}`);
    }
  } else {
    args.push(search);
  }
  const [res, countRes] = await Promise.all([
    runCommand(deps.run, args, root, "history", deps.signal),
    hexJump ? Promise.resolve(null) : runCommand(deps.run, countArgs, root, "history-count", deps.signal)
  ]);
  if (!("run" in res)) return { ok: false, error: { code: "git-unavailable" } };
  if (res.run.timedOut) return { ok: false, error: { code: "timeout" } };
  if (res.run.exitCode !== 0) {
    return { ok: true, value: { kind: "history", commits: [], total: 0 } };
  }
  const commits = parseGraphLog(res.run.stdout);
  let total = -1;
  if (hexJump) {
    total = commits.length;
  } else if (countRes !== null && "run" in countRes && countRes.run.exitCode === 0) {
    const n = Number(countRes.run.stdout.trim());
    if (Number.isFinite(n)) total = n;
  }
  return { ok: true, value: { kind: "history", commits, total } };
}
async function queryDiff(deps, root, q) {
  if (!isSafePath(q.path)) return { ok: false, error: { code: "invalid-path", message: q.path } };
  const ctx = q.context !== void 0 && Number.isFinite(q.context) ? Math.max(0, Math.min(1e5, Math.floor(q.context))) : 3;
  const unified = `-U${ctx}`;
  let args;
  if (q.base === "staged") {
    args = ["git", "diff", unified, "--cached", "--", q.path];
  } else if (q.base === "commit") {
    args = ["git", "show", unified, `${q.commit}`, "--", q.path];
  } else {
    args = ["git", "diff", unified, "--", q.path];
  }
  const res = await runCommand(deps.run, args, root, "diff", deps.signal);
  if (!("run" in res)) return { ok: false, error: { code: "git-unavailable" } };
  if (res.run.timedOut) return { ok: false, error: { code: "timeout" } };
  let text = res.run.stdout;
  if (q.base === "worktree" && text.trim() === "") {
    const noIndex = await runCommand(deps.run, ["git", "diff", unified, "--no-index", "--", "/dev/null", q.path], root, "diff-untracked", deps.signal);
    if ("run" in noIndex) text = noIndex.run.stdout;
  }
  return { ok: true, value: { kind: "diff", path: q.path, text } };
}
async function queryImageDiff(deps, config, root, q) {
  if (!isSafePath(q.path)) return { ok: false, error: { code: "invalid-path", message: q.path } };
  const mime = imageMimeFor(q.path);
  if (mime === null) return { ok: true, value: { kind: "image-diff", path: q.path, mime } };
  const oldSpec = q.base === "staged" ? `HEAD:${q.path}` : q.base === "commit" ? `${q.commit}^1:${q.path}` : `:${q.path}`;
  const newSpec = q.base === "staged" ? `:${q.path}` : q.base === "commit" ? `${q.commit}:${q.path}` : null;
  const [oldOid, newOid] = await Promise.all([
    resolveOid(deps, root, oldSpec),
    newSpec === null ? Promise.resolve(void 0) : resolveOid(deps, root, newSpec)
  ]);
  const cap = config.maxBytes;
  const gitDir = oldOid !== void 0 || newOid !== void 0 ? await absoluteGitDir(deps, root) : "";
  const [oldSide, newSide] = await Promise.all([
    oldOid === void 0 ? Promise.resolve(void 0) : blobSide(deps, gitDir, oldOid, cap),
    newOid !== void 0 ? blobSide(deps, gitDir, newOid, cap) : q.base === "worktree" ? worktreeSide(deps, root, q.path, cap) : Promise.resolve(void 0)
  ]);
  const sides = [oldSide, newSide];
  if (sides.some((s) => s !== void 0 && "tooLarge" in s)) {
    return { ok: true, value: { kind: "image-diff", path: q.path, mime, tooLarge: true } };
  }
  const old64 = sides[0] !== void 0 && !("tooLarge" in sides[0]) ? sides[0].data : void 0;
  const new64 = sides[1] !== void 0 && !("tooLarge" in sides[1]) ? sides[1].data : void 0;
  return {
    ok: true,
    value: {
      kind: "image-diff",
      path: q.path,
      mime,
      ...old64 !== void 0 ? { old: `data:${mime};base64,${old64}` } : {},
      ...new64 !== void 0 ? { new: `data:${mime};base64,${new64}` } : {}
    }
  };
}
async function resolveOid(deps, root, spec) {
  const res = await runCommand(deps.run, ["git", "rev-parse", "--verify", "--quiet", spec], root, "image-oid", deps.signal);
  if (!("run" in res) || res.run.exitCode !== 0) return void 0;
  const oid = res.run.stdout.trim();
  return /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(oid) ? oid : void 0;
}
async function absoluteGitDir(deps, root) {
  const res = await runCommand(deps.run, ["git", "rev-parse", "--absolute-git-dir"], root, "git-dir", deps.signal);
  if (!("run" in res) || res.run.exitCode !== 0) throw new Error("git dir unavailable");
  return res.run.stdout.trim();
}
async function blobSide(deps, gitDir, oid, cap) {
  const sizeRes = await runCommand(deps.run, ["git", "cat-file", "-s", oid], gitDir, "image-size", deps.signal);
  if (!("run" in sizeRes) || sizeRes.run.exitCode !== 0) return void 0;
  const size = Number(sizeRes.run.stdout.trim());
  if (!Number.isFinite(size)) return void 0;
  if (size > cap) return { tooLarge: true };
  const nameRes = await runCommand(deps.run, ["git", "unpack-file", oid], gitDir, "image-unpack", deps.signal);
  if (!("run" in nameRes) || nameRes.run.exitCode !== 0) return void 0;
  const name = nameRes.run.stdout.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return void 0;
  const file = join2(gitDir, name);
  try {
    const buf = await deps.fs.readFile(file);
    if (buf.length > cap) return { tooLarge: true };
    return { data: buf.toString("base64") };
  } catch {
    return void 0;
  } finally {
    await deps.fs.remove(file).catch(() => {
    });
  }
}
async function worktreeSide(deps, root, path, cap) {
  try {
    const file = join2(root, path);
    const info = await deps.fs.stat(file);
    if (info.size > cap) return { tooLarge: true };
    const buf = await deps.fs.readFile(file);
    if (buf.length > cap) return { tooLarge: true };
    return { data: buf.toString("base64") };
  } catch {
    return void 0;
  }
}
async function queryShow(deps, root, ref) {
  const metaFormat = "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%b";
  const [metaRes, statRes] = await Promise.all([
    runCommand(deps.run, ["git", "show", "-s", metaFormat, ref], root, "show-meta", deps.signal),
    runCommand(deps.run, ["git", "show", "--name-status", "-z", "--format=", ref], root, "show-stat", deps.signal)
  ]);
  if (!("run" in metaRes)) return { ok: false, error: { code: "git-unavailable" } };
  if (metaRes.run.timedOut) return { ok: false, error: { code: "timeout" } };
  if (metaRes.run.exitCode !== 0) {
    return { ok: false, error: { code: "git-error", message: metaRes.run.stderr.trim() || "unknown ref" } };
  }
  const parts = metaRes.run.stdout.split("");
  let commit = null;
  let body = "";
  if (parts.length >= 5 && parts[0]) {
    commit = {
      hash: parts[0],
      shortHash: parts[1] ?? "",
      subject: parts[2] ?? "",
      author: parts[3] ?? "",
      dateIso: parts[4] ?? ""
    };
    body = (parts[5] ?? "").trim();
  }
  const stats = "run" in statRes && statRes.run.exitCode === 0 ? parseNameStatus(statRes.run.stdout) : [];
  return { ok: true, value: { kind: "show", ref, commit, body, stats } };
}
async function queryBranches(deps, root) {
  const fmt = "--format=%(refname:short)%00%(objectname:short)%00%(upstream:track)";
  const [localRes, remoteRes, currentRes, defaultRes] = await Promise.all([
    runCommand(deps.run, ["git", "for-each-ref", "--sort=-committerdate", fmt, "refs/heads"], root, "branches-local", deps.signal),
    runCommand(deps.run, ["git", "for-each-ref", "--sort=-committerdate", fmt, "refs/remotes"], root, "branches-remote", deps.signal),
    runCommand(deps.run, ["git", "symbolic-ref", "--quiet", "--short", "HEAD"], root, "branch-current", deps.signal),
    runCommand(deps.run, ["git", "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], root, "branch-default", deps.signal)
  ]);
  const local = "run" in localRes && localRes.run.exitCode === 0 ? parseBranches(localRes.run.stdout) : [];
  const remote = "run" in remoteRes && remoteRes.run.exitCode === 0 ? parseBranches(remoteRes.run.stdout).filter((b) => !b.name.endsWith("/HEAD")) : [];
  const current = "run" in currentRes && currentRes.run.exitCode === 0 ? currentRes.run.stdout.trim() || null : null;
  let defaultBranch = null;
  if ("run" in defaultRes && defaultRes.run.exitCode === 0) {
    const raw = defaultRes.run.stdout.trim();
    defaultBranch = raw.replace(/^origin\//, "") || null;
  }
  return { ok: true, value: { kind: "branches", current, defaultBranch, local, remote } };
}
async function queryTags(deps, root) {
  const res = await runCommand(deps.run, ["git", "for-each-ref", "--sort=-creatordate", "--format=%(refname:short)%00%(objectname:short)", "refs/tags"], root, "tags", deps.signal);
  const tags = "run" in res && res.run.exitCode === 0 ? res.run.stdout.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    const [name, shortHash = ""] = line.split("\0");
    return name ? [{ name, shortHash: shortHash === "" ? null : shortHash }] : [];
  }) : [];
  return { ok: true, value: { kind: "tags", tags } };
}
async function queryAuthors(deps, root) {
  const res = await runCommand(deps.run, ["git", "log", "--all", "--format=%an", "--max-count=2000"], root, "authors", deps.signal);
  const authors = "run" in res && res.run.exitCode === 0 ? [...new Set(res.run.stdout.split("\n").map((s) => s.trim()).filter((s) => s !== ""))].sort((a, b) => a.localeCompare(b)) : [];
  return { ok: true, value: { kind: "authors", authors } };
}
async function queryLastCommitMessage(deps, root) {
  const res = await runCommand(deps.run, ["git", "log", "-1", "--format=%B"], root, "last-message", deps.signal);
  const message = "run" in res && res.run.exitCode === 0 ? res.run.stdout.replace(/\n+$/, "") : "";
  return { ok: true, value: { kind: "last-commit-message", message } };
}
async function queryWorktreeStats(deps, config, root, sessionId) {
  const snapshot = await snapshotForSession(deps, config, sessionId);
  if (!snapshot.ok) return { ok: false, error: { code: "git-error", message: "snapshot failed" } };
  const snap = snapshot.value;
  const distinct = new Set(snap.changes.map((c) => c.path));
  const [worktreeNum, stagedNum, headTime] = await Promise.all([
    runCommand(deps.run, ["git", "diff", "--numstat"], root, "numstat-worktree", deps.signal),
    runCommand(deps.run, ["git", "diff", "--numstat", "--cached"], root, "numstat-staged", deps.signal),
    runCommand(deps.run, ["git", "log", "-1", "--format=%aI"], root, "head-time", deps.signal)
  ]);
  const a = "run" in worktreeNum && worktreeNum.run.exitCode === 0 ? sumNumstat(worktreeNum.run.stdout) : { insertions: 0, deletions: 0 };
  const b = "run" in stagedNum && stagedNum.run.exitCode === 0 ? sumNumstat(stagedNum.run.stdout) : { insertions: 0, deletions: 0 };
  let untrackedInsertions = 0;
  const untrackedPaths = snap.changes.filter((c) => c.status === "untracked" && !c.isDirectory).map((c) => c.path);
  if (untrackedPaths.length > 0) {
    const safe = untrackedPaths.filter(isSafePath).slice(0, 200);
    if (safe.length > 0) {
      const noIndex = await runCommand(deps.run, ["git", "diff", "--numstat", "--no-index", "--", "/dev/null", ...safe], root, "numstat-untracked", deps.signal);
      if ("run" in noIndex) untrackedInsertions = sumNumstat(noIndex.run.stdout).insertions;
    }
  }
  const lastChangeAt = await maxChangeMtime(deps, root, snap.changes);
  const headCommittedAt = "run" in headTime && headTime.run.exitCode === 0 ? headTime.run.stdout.trim() || null : null;
  const stats = {
    fileCount: distinct.size,
    staged: snap.staged,
    modified: snap.modified,
    untracked: snap.untracked,
    insertions: a.insertions + b.insertions + untrackedInsertions,
    deletions: a.deletions + b.deletions,
    lastChangeAt,
    headCommittedAt
  };
  return { ok: true, value: { kind: "worktree-stats", stats } };
}

// src/host/version.ts
import { readFile as readFile2 } from "node:fs/promises";
import { dirname, join as join3 } from "node:path";
import { fileURLToPath } from "node:url";
function manifestPath() {
  return join3(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
}
function stringField(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
function parseRepository(repository) {
  const raw = typeof repository === "string" ? repository : typeof repository === "object" && repository !== null ? stringField(repository.url) : void 0;
  if (raw === void 0) return void 0;
  const fromHost = raw.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:$|[/#?])/i);
  if (fromHost !== null) return { owner: fromHost[1], repo: fromHost[2] };
  const shorthand = raw.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  if (shorthand !== null) return { owner: shorthand[1], repo: shorthand[2] };
  return void 0;
}
function compareVersions(a, b) {
  const split = (value) => {
    const trimmed = value.trim().replace(/^v/i, "");
    const [core, ...rest] = trimmed.split("-");
    return {
      core: core.split(".").map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part)),
      prerelease: rest.length > 0 && rest.join("-") !== ""
    };
  };
  const left = split(a);
  const right = split(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < length; index += 1) {
    const l = left.core[index] ?? 0;
    const r = right.core[index] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  return left.prerelease ? -1 : 1;
}
async function readManifest(path) {
  const raw = await readFile2(path, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) throw new Error("package.json is not an object");
  return parsed;
}
async function readVersionInfo(options = {}) {
  const manifest = await readManifest(options.manifestPath ?? manifestPath());
  const current = stringField(manifest.version) ?? "0.0.0";
  const repo = parseRepository(manifest.repository);
  const repositoryUrl = repo === void 0 ? void 0 : `https://github.com/${repo.owner}/${repo.repo}`;
  return {
    current,
    ...repositoryUrl ? { repositoryUrl } : {},
    updateAvailable: false,
    checkedRemote: false
  };
}
async function checkLatestVersion(options = {}) {
  const base = await readVersionInfo({ manifestPath: options.manifestPath });
  const repo = parseRepository((await readManifest(options.manifestPath ?? manifestPath())).repository);
  if (repo === void 0) {
    return { ...base, checkedRemote: false, error: "repository is not configured" };
  }
  const fetchFn = options.fetchFn ?? fetch;
  try {
    const response = await fetchFn(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "dsh-git-panel" }
    });
    if (!response.ok) {
      return { ...base, checkedRemote: true, error: `GitHub responded with ${response.status}` };
    }
    const body = await response.json();
    const tag = typeof body === "object" && body !== null ? stringField(body.tag_name) : void 0;
    const htmlUrl = typeof body === "object" && body !== null ? stringField(body.html_url) : void 0;
    if (tag === void 0) {
      return { ...base, checkedRemote: true, error: "GitHub response did not include a release tag" };
    }
    const latest = tag.replace(/^v/i, "");
    return {
      ...base,
      checkedRemote: true,
      latest,
      updateAvailable: compareVersions(latest, base.current) > 0,
      releaseUrl: htmlUrl ?? `${base.repositoryUrl ?? ""}/releases/latest`
    };
  } catch (error) {
    return { ...base, checkedRemote: true, error: error instanceof Error ? error.message : "Unable to reach GitHub" };
  }
}

// src/host/index.ts
var _version_dec, _query_dec, _run_dec, _snapshot_dec, _a, _init;
var GitPanelService = class extends (_a = TypertRemoteService, _snapshot_dec = [Remote("snapshot")], _run_dec = [Remote("run")], _query_dec = [Remote("query")], _version_dec = [Remote("version")], _a) {
  constructor(ctx, config) {
    super(ctx, "gitPanel");
    __runInitializers(_init, 5, this);
    __publicField(this, "deps");
    __publicField(this, "config");
    __publicField(this, "rawConfig");
    this.rawConfig = config;
    this.config = normalizeConfig(config);
    this.deps = this.buildDeps(ctx, this.config);
  }
  buildDeps(ctx, config) {
    const rootCache = /* @__PURE__ */ new Map();
    const get = (key) => ctx.get(key);
    const subprocess = get("subprocess");
    if (subprocess === void 0) {
      return {
        run: { run: async () => {
          throw new Error("subprocess service unavailable");
        } },
        fs: { realpath, stat: async (p) => stat(p), readFile: readFile3, remove: async (p) => {
          await rm(p, { force: true });
        } },
        sessions: { liveCwd: () => void 0, persistedMeta: async () => void 0 },
        rootCache
      };
    }
    const sessions = get("sessions");
    const persistence = get("sessionPersistence");
    return {
      run: createGitRunner(subprocess, config.timeoutMs, config.maxBytes),
      fs: { realpath, stat: async (p) => stat(p), readFile: readFile3, remove: async (p) => {
        await rm(p, { force: true });
      } },
      sessions: {
        liveCwd: (id) => sessions?.get(id)?.header?.cwd,
        persistedMeta: async (id) => {
          if (persistence === void 0) return void 0;
          try {
            const snap = await persistence.stat(id);
            return snap?.header?.cwd === void 0 ? void 0 : { cwd: snap.header.cwd };
          } catch {
            return void 0;
          }
        }
      },
      rootCache
    };
  }
  async snapshot(request, signal) {
    return snapshotForSession(this.withSignal(signal), this.liveConfig(), request.sessionId);
  }
  async run(request, signal) {
    return runAction(this.withSignal(signal), this.liveConfig(), request);
  }
  async query(request, signal) {
    return runQuery(this.withSignal(signal), this.liveConfig(), request);
  }
  async version(request) {
    return request.check === true ? checkLatestVersion() : readVersionInfo();
  }
  /** Re-read config so a live-edited volatile field (showInputPill) is current. */
  liveConfig() {
    this.config = normalizeConfig(this.rawConfig);
    return this.config;
  }
  withSignal(signal) {
    if (signal === void 0) return this.deps;
    return { ...this.deps, signal };
  }
};
_init = __decoratorStart(_a);
__decorateElement(_init, 1, "snapshot", _snapshot_dec, GitPanelService);
__decorateElement(_init, 1, "run", _run_dec, GitPanelService);
__decorateElement(_init, 1, "query", _query_dec, GitPanelService);
__decorateElement(_init, 1, "version", _version_dec, GitPanelService);
__decoratorMetadata(_init, GitPanelService);
__publicField(GitPanelService, "inject", ["subprocess", "sessions", "sessionPersistence"]);
/**
 * Config schema surfaced on the plugin detail page. Only `showInputPill` is
 * `.volatile()`, so the settings host renders it as a live-editable toggle;
 * the operational limits stay profile-only and out of the UI form.
 */
__publicField(GitPanelService, "Config", Schema.object({
  showInputPill: Schema.boolean().default(true).volatile().description("\u663E\u793A\u8F93\u5165\u6846\u7684 Git \u5206\u652F\u6807\u8BB0")
}));
var index_default = GitPanelService;
export {
  DEFAULT_CONFIG,
  GitPanelService,
  checkLatestVersion,
  compareVersions,
  createGitRunner,
  index_default as default,
  isSafePath,
  normalizeConfig,
  parseBranches,
  parseGraphLog,
  parseNameStatus,
  parseRepository,
  parseStatus,
  planAction,
  readVersionInfo,
  resolveWorkspace,
  runAction,
  runQuery,
  snapshotForSession,
  sumNumstat
};
