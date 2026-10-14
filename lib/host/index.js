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
var _version_dec, _suggest_dec, _query_dec, _run_dec, _snapshot_dec, _a, _init;
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import Schema from "@deepseek-ai/schemastery";
import { lstat, readFile, readdir, readlink, realpath, rm, stat } from "node:fs/promises";
import { createGitRunner } from "./git.js";
import { normalizeConfig, snapshotForSession, DEFAULT_CONFIG } from "./core.js";
import { runAction } from "./actions.js";
import { runQuery } from "./queries.js";
import { runSuggest } from "./suggest.js";
import { checkLatestVersion, readVersionInfo } from "./version.js";
import { normalizeConfig as normalizeConfig2, DEFAULT_CONFIG as DEFAULT_CONFIG2, snapshotForSession as snapshotForSession2, resolveWorkspace, parsePrimaryRemote } from "./core.js";
import { createGitRunner as createGitRunner2 } from "./git.js";
import { parseStatus, parseGraphLog, parseBranches, parseNameStatus, parseStashList, parseTags, sumNumstat } from "./parser.js";
import { parseRemote, classifyHost } from "./remote.js";
import { isSafePath, planAction, runAction as runAction2, classifyActionFailure } from "./actions.js";
import { runQuery as runQuery2 } from "./queries.js";
import { runSuggest as runSuggest2 } from "./suggest.js";
import { readVersionInfo as readVersionInfo2, checkLatestVersion as checkLatestVersion2, compareVersions, parseRepository } from "./version.js";
class GitPanelService extends (_a = TypertRemoteService, _snapshot_dec = [Remote("snapshot")], _run_dec = [Remote("run")], _query_dec = [Remote("query")], _suggest_dec = [Remote("suggest")], _version_dec = [Remote("version")], _a) {
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
    const rootNegCache = /* @__PURE__ */ new Map();
    const get = (key) => ctx.get(key);
    const fs = {
      realpath,
      stat: async (p) => stat(p),
      readFile,
      symlinkTarget: async (p) => {
        try {
          return (await lstat(p)).isSymbolicLink() ? await readlink(p) : null;
        } catch {
          return null;
        }
      },
      readdir: async (p) => (await readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
      remove: async (p) => {
        await rm(p, { force: true });
      }
    };
    const subprocess = get("subprocess");
    const run = subprocess === void 0 ? { run: async () => {
      throw new Error("subprocess service unavailable");
    } } : createGitRunner(subprocess, config.timeoutMs, config.maxBytes);
    const sessions = get("sessions");
    const persistence = get("sessionPersistence");
    return {
      run,
      fs,
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
      rootCache,
      rootNegCache,
      // Optional model services, resolved per request so a provider fiber that
      // activates late or restarts is picked up — absent in deployments without
      // a model backend, where the suggest endpoint reports `llm-unavailable`
      // rather than failing activation (kept out of `static inject` on purpose).
      getLlm: () => get("llm"),
      getAgentDefaultModel: () => get("agentDefaultModel")
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
  async suggest(request, signal) {
    return runSuggest(this.withSignal(signal), this.liveConfig(), request);
  }
  async version(request) {
    try {
      return request.check === true ? await checkLatestVersion() : await readVersionInfo();
    } catch (error) {
      return { current: "0.0.0", updateAvailable: false, checkedRemote: false, error: error instanceof Error ? error.message : "version unavailable" };
    }
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
}
_init = __decoratorStart(_a);
__decorateElement(_init, 1, "snapshot", _snapshot_dec, GitPanelService);
__decorateElement(_init, 1, "run", _run_dec, GitPanelService);
__decorateElement(_init, 1, "query", _query_dec, GitPanelService);
__decorateElement(_init, 1, "suggest", _suggest_dec, GitPanelService);
__decorateElement(_init, 1, "version", _version_dec, GitPanelService);
__decoratorMetadata(_init, GitPanelService);
__publicField(GitPanelService, "inject", ["subprocess", "sessions", "sessionPersistence"]);
/**
 * Config schema surfaced on the plugin detail page. `showInputPill`,
 * `defaultDiffView`, `graphStyle` and the suggest fields are `.volatile()`,
 * so the settings host renders them as live-editable controls; the
 * operational limits stay profile-only and out of the UI form.
 */
__publicField(GitPanelService, "Config", Schema.object({
  showInputPill: Schema.boolean().default(true).volatile().description("\u663E\u793A\u8F93\u5165\u6846\u7684 Git \u5206\u652F\u6807\u8BB0"),
  defaultDiffView: Schema.union([
    Schema.const("unified").description("\u7EDF\u4E00\u89C6\u56FE\uFF08\u5355\u680F\u884C\u5185\u5BF9\u6BD4\uFF09"),
    Schema.const("split").description("\u5E76\u6392\u89C6\u56FE\uFF08\u5DE6\u53F3\u5206\u680F\u5BF9\u6BD4\uFF09")
  ]).default("unified").volatile().description("\u5DEE\u5F02\u5BF9\u6BD4\u9ED8\u8BA4\u89C6\u56FE"),
  graphStyle: Schema.union([
    Schema.const("parallel").description("\u5E73\u884C\u7EBF\uFF08VSCode \u98CE\u683C\uFF0C\u5206\u652F\u5404\u5360\u4E00\u5217\uFF09"),
    Schema.const("compact").description("\u7D27\u51D1\uFF08git log \u98CE\u683C\uFF0C\u5171\u4EAB\u7956\u5148\u5408\u5E76\u4E3A\u4E00\u5217\uFF09")
  ]).default("parallel").volatile().description("\u63D0\u4EA4\u5386\u53F2\u56FE\u7EBF\u6761\u6837\u5F0F"),
  suggestEnabled: Schema.boolean().default(true).volatile().description("\u63D0\u4EA4\u6846\u663E\u793A AI \u751F\u6210\u6309\u94AE"),
  // Defaults come from DEFAULT_CONFIG (which itself reads SUGGEST_LIMITS) —
  // a literal here could silently drift from what normalizeConfig enforces.
  suggestMaxBytes: Schema.number().default(DEFAULT_CONFIG.suggestMaxBytes).volatile().description("AI \u751F\u6210\u8F93\u5165\u9884\u7B97\uFF08diff \u5B57\u8282\u4E0A\u9650\uFF0C16\u2013512 KiB\uFF09"),
  suggestMaxOutputTokens: Schema.number().default(DEFAULT_CONFIG.suggestMaxOutputTokens).volatile().description("AI \u751F\u6210\u8F93\u51FA\u4E0A\u9650\uFF08tokens\uFF0C256\u201316384\uFF09"),
  suggestTimeoutMs: Schema.number().default(DEFAULT_CONFIG.suggestTimeoutMs).volatile().description("AI \u751F\u6210\u8D85\u65F6\uFF08\u6BEB\u79D2\uFF0C5\u2013120 \u79D2\uFF09")
}));
var index_default = GitPanelService;
export {
  DEFAULT_CONFIG2 as DEFAULT_CONFIG,
  GitPanelService,
  checkLatestVersion2 as checkLatestVersion,
  classifyActionFailure,
  classifyHost,
  compareVersions,
  createGitRunner2 as createGitRunner,
  index_default as default,
  isSafePath,
  normalizeConfig2 as normalizeConfig,
  parseBranches,
  parseGraphLog,
  parseNameStatus,
  parsePrimaryRemote,
  parseRemote,
  parseRepository,
  parseStashList,
  parseStatus,
  parseTags,
  planAction,
  readVersionInfo2 as readVersionInfo,
  resolveWorkspace,
  runAction2 as runAction,
  runQuery2 as runQuery,
  runSuggest2 as runSuggest,
  snapshotForSession2 as snapshotForSession,
  sumNumstat
};
