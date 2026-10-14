import { join, sep } from "node:path";
import { mapWorkspaceFailure, resolveBrowseRoot, resolveWorkspace, runCommand, snapshotForSession } from "./core.js";
import { isSafePath, isSafeRev } from "./validate.js";
import { commitFromFields, parseBranches, parseGraphLog, parseNameStatus, parseStashList, parseTags, sumNumstat } from "./parser.js";
import { imageMimeFor, DIFF_CONTEXT_DEFAULT, DIFF_CONTEXT_MAX, DIFF_COUNT_READ_MAX } from "./types.js";
const GRAPH_FORMAT = "--format=%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e";
const VISIBLE_REFS = ["--branches", "--remotes", "--tags", "HEAD"];
function isHexLike(text) {
  return /^[0-9a-fA-F]{7,40}$/.test(text.trim());
}
async function runQuery(deps, config, request) {
  const q = request.query;
  if (q.kind === "dir-list" || q.kind === "file-content") {
    const browse = await resolveBrowseRoot(deps, request.sessionId);
    if (!browse.ok) return { ok: false, error: browse.error };
    try {
      return q.kind === "dir-list" ? await queryDirList(deps, browse.root, q, browse.isGitRepo) : await queryFileContent(deps, config, browse.root, q);
    } catch (error) {
      return { ok: false, error: { code: "git-error", message: error instanceof Error ? error.message : String(error) } };
    }
  }
  const workspace = await resolveWorkspace(deps, request.sessionId);
  if (!workspace.ok) return { ok: false, error: mapWorkspaceFailure(workspace.failure) };
  const root = workspace.root;
  try {
    switch (q.kind) {
      case "history":
        return await queryHistory(deps, root, q);
      case "diff":
        return await queryDiff(deps, root, q);
      case "file-lines":
        return await queryFileLines(deps, root, q);
      case "image-diff":
        return await queryImageDiff(deps, config, root, q);
      case "show":
        return await queryShow(deps, root, q.ref);
      case "branches":
        return await queryBranches(deps, root);
      case "tags":
        return await queryTags(deps, root);
      case "stash-list":
        return await queryStashList(deps, root);
      case "authors":
        return await queryAuthors(deps, root);
      case "last-commit-message":
        return await queryLastCommitMessage(deps, root);
      case "worktree-stats":
        return await queryWorktreeStats(deps, config, request.sessionId);
      case "pull-preview":
        return await queryPullPreview(deps, root);
      case "push-preview":
        return await queryPushPreview(deps, root);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { code: "git-error", message } };
  }
}
async function queryHistory(deps, root, q) {
  const limit = Number.isFinite(q.limit) ? Math.min(500, Math.max(1, Math.trunc(q.limit))) : 100;
  const skip = Number.isFinite(q.skip) ? Math.max(0, Math.trunc(q.skip)) : 0;
  const args = ["git", "log", "--topo-order", "--decorate=full", GRAPH_FORMAT, `--max-count=${limit}`, `--skip=${skip}`];
  const search = q.search?.trim() ?? "";
  const hexJump = search !== "" && isHexLike(search);
  const countArgs = ["git", "rev-list", "--count"];
  if (!hexJump) {
    const filters = [];
    if (search !== "") filters.push("-i", "-E", `--grep=${search}`);
    if (q.author !== void 0 && q.author !== "") filters.push(`--author=${q.author}`);
    if (q.since !== void 0 && q.since !== "") filters.push(`--since=${q.since}`);
    if (q.ref !== void 0 && q.ref !== "") {
      if (!isSafeRev(q.ref)) return { ok: false, error: { code: "invalid-name", message: `unsafe ref: ${q.ref}` } };
      filters.push("--end-of-options", q.ref);
    } else {
      filters.push(...VISIBLE_REFS);
    }
    args.push(...filters);
    countArgs.push(...filters);
  } else {
    args.push("--end-of-options", search);
  }
  const [res, countRes] = await Promise.all([
    runCommand(deps.run, args, root, "history", deps.signal),
    hexJump ? Promise.resolve(null) : runCommand(deps.run, countArgs, root, "history-count", deps.signal)
  ]);
  if (!("run" in res)) return { ok: false, error: { code: "git-unavailable" } };
  if (res.run.cancelled) return { ok: false, error: { code: "cancelled" } };
  if (res.run.timedOut) return { ok: false, error: { code: "timeout" } };
  if (res.run.exitCode !== 0) {
    const stderr = res.run.stderr.trim();
    if (hexJump || /unknown revision|bad revision|does not have any commits|ambiguous argument/i.test(stderr)) {
      return { ok: true, value: { kind: "history", commits: [], total: 0 } };
    }
    return { ok: false, error: { code: "git-error", message: stderr || `git exited ${res.run.exitCode}` } };
  }
  const commits = parseGraphLog(res.run.stdout);
  let total = -1;
  if (!hexJump && countRes !== null && "run" in countRes && countRes.run.exitCode === 0) {
    const n = Number(countRes.run.stdout.trim());
    if (Number.isFinite(n)) total = n;
  }
  return { ok: true, value: { kind: "history", commits, total } };
}
async function queryDiff(deps, root, q) {
  if (!isSafePath(q.path)) return { ok: false, error: { code: "invalid-path", message: q.path } };
  const ctx = q.context !== void 0 && Number.isFinite(q.context) ? Math.max(0, Math.min(DIFF_CONTEXT_MAX, Math.floor(q.context))) : DIFF_CONTEXT_DEFAULT;
  const unified = `-U${ctx}`;
  let args;
  if (q.base === "staged") {
    args = ["git", "diff", unified, "--cached", "--", q.path];
  } else if (q.base === "commit") {
    if (!isSafeRev(q.commit)) return { ok: false, error: { code: "invalid-name", message: `unsafe commit: ${q.commit}` } };
    args = ["git", "show", unified, "--end-of-options", q.commit, "--", q.path];
  } else {
    args = ["git", "diff", unified, "--", q.path];
  }
  const res = await runCommand(deps.run, args, root, "diff", deps.signal);
  if (!("run" in res)) return { ok: false, error: { code: "git-unavailable" } };
  if (res.run.cancelled) return { ok: false, error: { code: "cancelled" } };
  if (res.run.timedOut) return { ok: false, error: { code: "timeout" } };
  let text = res.run.stdout;
  if (q.base === "worktree" && text.trim() === "") {
    const tracked = await runCommand(deps.run, ["git", "ls-files", "--error-unmatch", "--", q.path], root, "diff-tracked-probe", deps.signal);
    const isUntracked = !("run" in tracked) || tracked.run.exitCode !== 0;
    if (isUntracked) {
      const noIndex = await runCommand(deps.run, ["git", "diff", unified, "--no-index", "--", "/dev/null", q.path], root, "diff-untracked", deps.signal);
      if ("run" in noIndex) text = noIndex.run.stdout;
    }
  }
  return { ok: true, value: { kind: "diff", path: q.path, text, newLines: await countNewSideLines(deps, root, q, text) } };
}
async function countNewSideLines(deps, root, q, diffText) {
  if (!diffText.includes("@@")) return 0;
  const side = await readNewSide(deps, root, q, { worktreeMaxBytes: DIFF_COUNT_READ_MAX });
  if (!side.ok || side.text === null) return 0;
  return countLines(side.text);
}
function countLines(content) {
  if (content === "") return 0;
  let lines = 1;
  for (let at = content.indexOf("\n"); at !== -1; at = content.indexOf("\n", at + 1)) lines++;
  return content.endsWith("\n") ? lines - 1 : lines;
}
function splitLines(content) {
  const all = content.split("\n");
  if (all[all.length - 1] === "") all.pop();
  return all;
}
async function queryFileLines(deps, root, q) {
  if (!isSafePath(q.path)) return { ok: false, error: { code: "invalid-path", message: q.path } };
  const start = Number.isFinite(q.start) ? Math.max(1, Math.floor(q.start)) : 1;
  const end = Number.isFinite(q.end) ? Math.max(start, Math.floor(q.end)) : start;
  const side = await readNewSide(deps, root, q);
  if (!side.ok) return { ok: false, error: { code: side.code, message: side.message } };
  return sliceLines(q.path, side.text ?? "", start, end);
}
const ABSENT_SIDE_RE = /does not exist in|exists on disk, but not in the index|no such path/i;
async function readNewSide(deps, root, q, opts) {
  if (q.base === "worktree") return { ok: true, text: await readWorktreeSide(deps, root, q.path, opts?.worktreeMaxBytes) };
  if (q.base === "commit" && !isSafeRev(q.commit)) return { ok: false, code: "invalid-name", message: `unsafe commit: ${q.commit}` };
  const spec = q.base === "commit" ? `${q.commit}:${q.path}` : `:${q.path}`;
  const res = await runCommand(deps.run, ["git", "show", "--end-of-options", spec], root, "new-side", deps.signal);
  if (!("run" in res)) return { ok: false, code: "git-unavailable", message: "git unavailable" };
  if (res.run.cancelled) return { ok: false, code: "cancelled", message: "cancelled" };
  if (res.run.timedOut) return { ok: false, code: "timeout", message: "timed out" };
  if (res.run.exitCode !== 0) {
    return ABSENT_SIDE_RE.test(res.run.stderr) ? { ok: true, text: null } : { ok: false, code: "git-error", message: res.run.stderr.trim() || "git show failed" };
  }
  if (res.run.stdoutLossy) return { ok: false, code: "git-error", message: "git show output exceeded the output cap" };
  return { ok: true, text: res.run.stdout };
}
async function readWorktreeSide(deps, root, path, maxBytes) {
  const file = join(root, path);
  const link = await deps.fs.symlinkTarget(file);
  if (link !== null) return link;
  if (maxBytes !== void 0) {
    const size = await deps.fs.stat(file).catch(() => null);
    if (size === null || size.size > maxBytes) return null;
  }
  const text = await readWorktreeText(deps, root, path);
  return text === null ? null : text.replace(/\r\n/g, "\n");
}
async function readWorktreeText(deps, root, path) {
  try {
    const file = join(root, path);
    const real = await deps.fs.realpath(file);
    const rootReal = await deps.fs.realpath(root);
    if (real !== rootReal && !real.startsWith(rootReal + sep)) return null;
    const buf = await deps.fs.readFile(file);
    return buf.toString("utf8");
  } catch {
    return null;
  }
}
function sliceLines(path, content, start, end) {
  const all = splitLines(content);
  const from = Math.min(start, all.length + 1);
  const to = Math.min(end, all.length);
  const lines = from <= to ? all.slice(from - 1, to) : [];
  const eof = to >= all.length;
  return { ok: true, value: { kind: "file-lines", path, start: from, lines, eof } };
}
async function queryImageDiff(deps, config, root, q) {
  if (!isSafePath(q.path)) return { ok: false, error: { code: "invalid-path", message: q.path } };
  if (q.base === "commit" && !isSafeRev(q.commit)) return { ok: false, error: { code: "invalid-name", message: `unsafe commit: ${q.commit}` } };
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
  const file = join(gitDir, name);
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
    const file = join(root, path);
    const real = await deps.fs.realpath(file);
    const rootReal = await deps.fs.realpath(root);
    if (real !== rootReal && !real.startsWith(rootReal + sep)) return void 0;
    const info = await deps.fs.stat(file);
    if (info.size > cap) return { tooLarge: true };
    const buf = await deps.fs.readFile(file);
    if (buf.length > cap) return { tooLarge: true };
    return { data: buf.toString("base64") };
  } catch {
    return void 0;
  }
}
const DIR_ENTRY_CAP = 2e3;
async function queryDirList(deps, root, q, isGitRepo) {
  const rel = q.path;
  if (rel !== "" && !isSafePath(rel) || hasGitSegment(rel)) return { ok: false, error: { code: "invalid-path", message: rel } };
  const dir = rel === "" ? root : join(root, rel);
  const inside = await isInsideRoot(deps, root, dir, true);
  if (!inside) return { ok: false, error: { code: "invalid-path", message: rel } };
  let raw;
  try {
    raw = await deps.fs.readdir(dir);
  } catch (error) {
    return { ok: false, error: { code: "git-error", message: error instanceof Error ? error.message : "readdir failed" } };
  }
  const filtered = raw.filter((e) => e.name !== ".git");
  filtered.sort((a, b) => a.isDirectory !== b.isDirectory ? a.isDirectory ? -1 : 1 : a.name.localeCompare(b.name));
  const truncated = filtered.length > DIR_ENTRY_CAP;
  const slice = truncated ? filtered.slice(0, DIR_ENTRY_CAP) : filtered;
  const ignored = isGitRepo ? await ignoredEntries(deps, root, rel, slice.map((e) => e.name)) : /* @__PURE__ */ new Set();
  const entries = await Promise.all(slice.map(async (e) => {
    const ignoreFlag = ignored.has(e.name) ? { ignored: true } : {};
    if (e.isDirectory) return { name: e.name, dir: true, ...ignoreFlag };
    let size;
    try {
      size = (await deps.fs.stat(join(dir, e.name))).size;
    } catch {
      size = void 0;
    }
    return { name: e.name, dir: false, ...size !== void 0 ? { size } : {}, ...ignoreFlag };
  }));
  const path = rel === "" ? "" : rel.replace(/\/+$/, "");
  return { ok: true, value: { kind: "dir-list", path, entries, truncated } };
}
async function ignoredEntries(deps, root, parent, names) {
  const ignored = /* @__PURE__ */ new Set();
  const paths = names.map((name) => parent === "" ? name : `${parent}/${name}`);
  for (let index = 0; index < paths.length; ) {
    const batch = [];
    let bytes = 0;
    while (index < paths.length && batch.length < 128) {
      const candidate = paths[index];
      const size = Buffer.byteLength(candidate) + 1;
      if (batch.length > 0 && bytes + size > 32 * 1024) break;
      batch.push(candidate);
      bytes += size;
      index++;
    }
    const result = await runCommand(deps.run, ["git", "check-ignore", "-z", "--stdin"], root, "dir-ignore", deps.signal, `${batch.join("\0")}\0`);
    if ("failure" in result || result.run.timedOut || result.run.cancelled || result.run.stdoutLossy || ![0, 1].includes(result.run.exitCode ?? -1)) continue;
    const matches = new Set(result.run.stdout.split("\0"));
    for (const path of batch) if (matches.has(path)) ignored.add(parent === "" ? path : path.slice(parent.length + 1));
  }
  return ignored;
}
async function queryFileContent(deps, config, root, q) {
  if (!isSafePath(q.path) || hasGitSegment(q.path)) return { ok: false, error: { code: "invalid-path", message: q.path } };
  const file = join(root, q.path);
  const inside = await isInsideRoot(deps, root, file, true);
  if (!inside) return { ok: false, error: { code: "invalid-path", message: q.path } };
  const cap = config.maxBytes;
  let info;
  try {
    info = await deps.fs.stat(file);
  } catch (error) {
    return { ok: false, error: { code: "git-error", message: error instanceof Error ? error.message : "stat failed" } };
  }
  const mime = imageMimeFor(q.path);
  const tooLarge = { ok: true, value: { kind: "file-content", path: q.path, variant: mime !== null ? "image" : "text", tooLarge: true } };
  if (info.size > cap) return tooLarge;
  let buf;
  try {
    buf = await deps.fs.readFile(file);
  } catch (error) {
    return { ok: false, error: { code: "git-error", message: error instanceof Error ? error.message : "read failed" } };
  }
  if (buf.length > cap) return tooLarge;
  if (mime !== null) {
    return { ok: true, value: { kind: "file-content", path: q.path, variant: "image", dataUrl: `data:${mime};base64,${buf.toString("base64")}` } };
  }
  if (isBinaryBuffer(buf)) return { ok: true, value: { kind: "file-content", path: q.path, variant: "binary" } };
  const content = buf.toString("utf8");
  const lines = content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  return { ok: true, value: { kind: "file-content", path: q.path, variant: "text", content, lines } };
}
function hasGitSegment(path) {
  return path.split(/[\\/]/).includes(".git");
}
async function isInsideRoot(deps, root, path, hideGit = false) {
  try {
    const real = await deps.fs.realpath(path);
    const rootReal = await deps.fs.realpath(root);
    if (real !== rootReal && !real.startsWith(rootReal + sep)) return false;
    return !hideGit || !hasGitSegment(real.slice(rootReal.length + 1));
  } catch {
    return false;
  }
}
function isBinaryBuffer(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}
async function queryShow(deps, root, ref) {
  if (!isSafeRev(ref)) return { ok: false, error: { code: "invalid-name", message: `unsafe ref: ${ref}` } };
  const metaFormat = "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%b";
  const [metaRes, statRes, numstatRes] = await Promise.all([
    runCommand(deps.run, ["git", "show", "-s", metaFormat, "--end-of-options", ref], root, "show-meta", deps.signal),
    runCommand(deps.run, ["git", "show", "--name-status", "-z", "--format=", "--end-of-options", ref], root, "show-stat", deps.signal),
    runCommand(deps.run, ["git", "show", "--numstat", "--format=", "--end-of-options", ref], root, "show-numstat", deps.signal)
  ]);
  if (!("run" in metaRes)) return { ok: false, error: { code: "git-unavailable" } };
  if (metaRes.run.cancelled) return { ok: false, error: { code: "cancelled" } };
  if (metaRes.run.timedOut) return { ok: false, error: { code: "timeout" } };
  if (metaRes.run.exitCode !== 0) {
    return { ok: false, error: { code: "git-error", message: metaRes.run.stderr.trim() || "unknown ref" } };
  }
  const parts = metaRes.run.stdout.split("");
  const commit = commitFromFields(parts);
  const body = commit === null ? "" : parts.slice(5).join("").trim();
  const stats = "run" in statRes && statRes.run.exitCode === 0 ? parseNameStatus(statRes.run.stdout) : [];
  const { insertions, deletions } = stats.length > 0 && "run" in numstatRes && numstatRes.run.exitCode === 0 ? sumNumstat(numstatRes.run.stdout) : { insertions: 0, deletions: 0 };
  return { ok: true, value: { kind: "show", ref, commit, body, stats, insertions, deletions } };
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
  const tags = "run" in res && res.run.exitCode === 0 ? parseTags(res.run.stdout) : [];
  return { ok: true, value: { kind: "tags", tags } };
}
async function queryStashList(deps, root) {
  const res = await runCommand(deps.run, ["git", "stash", "list", "-z", "--format=%gd%x1f%H%x1f%gs%x1f%cr"], root, "stash-list", deps.signal);
  const entries = "run" in res && res.run.exitCode === 0 ? parseStashList(res.run.stdout) : [];
  return { ok: true, value: { kind: "stash-list", entries } };
}
async function queryAuthors(deps, root) {
  const res = await runCommand(deps.run, ["git", "log", ...VISIBLE_REFS, "--format=%an", "--max-count=2000"], root, "authors", deps.signal);
  const authors = "run" in res && res.run.exitCode === 0 ? [...new Set(res.run.stdout.split("\n").map((s) => s.trim()).filter((s) => s !== ""))].sort((a, b) => a.localeCompare(b)) : [];
  return { ok: true, value: { kind: "authors", authors } };
}
async function queryLastCommitMessage(deps, root) {
  const res = await runCommand(deps.run, ["git", "log", "-1", "--format=%B"], root, "last-message", deps.signal);
  const message = "run" in res && res.run.exitCode === 0 ? res.run.stdout.replace(/\n+$/, "") : "";
  return { ok: true, value: { kind: "last-commit-message", message } };
}
async function queryPullPreview(deps, root) {
  const empty = { kind: "pull-preview", hasUpstream: false, commits: 0, files: 0, insertions: 0, deletions: 0 };
  const commitsRes = await runCommand(deps.run, ["git", "rev-list", "--count", "--end-of-options", "HEAD..@{upstream}"], root, "pull-preview-count", deps.signal);
  if (!("run" in commitsRes) || commitsRes.run.exitCode !== 0) return { ok: true, value: empty };
  const commits = Number(commitsRes.run.stdout.trim()) || 0;
  const diffRes = await runCommand(deps.run, ["git", "diff", "--numstat", "--end-of-options", "HEAD", "@{upstream}"], root, "pull-preview-diff", deps.signal);
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  if ("run" in diffRes && diffRes.run.exitCode === 0) {
    files = diffRes.run.stdout.split("\n").filter((l) => l.trim() !== "").length;
    const sum = sumNumstat(diffRes.run.stdout);
    insertions = sum.insertions;
    deletions = sum.deletions;
  }
  return { ok: true, value: { kind: "pull-preview", hasUpstream: true, commits, files, insertions, deletions } };
}
async function queryPushPreview(deps, root) {
  const empty = { kind: "push-preview", hasUpstream: false, commits: 0, files: 0, insertions: 0, deletions: 0 };
  const commitsRes = await runCommand(deps.run, ["git", "rev-list", "--count", "--end-of-options", "@{upstream}..HEAD"], root, "push-preview-count", deps.signal);
  if (!("run" in commitsRes) || commitsRes.run.exitCode !== 0) return { ok: true, value: empty };
  const commits = Number(commitsRes.run.stdout.trim()) || 0;
  const diffRes = await runCommand(deps.run, ["git", "diff", "--numstat", "--end-of-options", "@{upstream}", "HEAD"], root, "push-preview-diff", deps.signal);
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  if ("run" in diffRes && diffRes.run.exitCode === 0) {
    files = diffRes.run.stdout.split("\n").filter((l) => l.trim() !== "").length;
    const sum = sumNumstat(diffRes.run.stdout);
    insertions = sum.insertions;
    deletions = sum.deletions;
  }
  return { ok: true, value: { kind: "push-preview", hasUpstream: true, commits, files, insertions, deletions } };
}
async function queryWorktreeStats(deps, config, sessionId) {
  const snapshot = await snapshotForSession(deps, config, sessionId);
  if (!snapshot.ok) return { ok: false, error: { code: "git-error", message: "snapshot failed" } };
  return { ok: true, value: { kind: "worktree-stats", stats: snapshot.value.stats } };
}
export {
  runQuery
};
