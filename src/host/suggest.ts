/**
 * AI commit-message suggestion endpoint.
 *
 * Collects the repository's uncommitted changes (or the user's selected paths)
 * — a file list plus the diff against HEAD, with untracked new files folded in
 * — frames them for the configured model, and returns the generated message.
 * The LLM face is typed against the real `@deepseek-ai/dsh-llm` contract
 * (type-only) and resolved per request, so the endpoint runs standalone,
 * stays unit-testable without a real model, and a wire-shape drift breaks
 * typecheck instead of passing silently. Framing policy mirrors
 * @deepseek-ai/dsh-session-title-llm: JSON-wrapped input, a bounded input
 * cap, an output token cap, a timeout, and finish-reason → error mapping.
 */
import type { FinishReason, GenerateOptions, MessageId, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GitPanelConfig, SnapshotDeps } from './core.js'
import { mapWorkspaceFailure, resolveWorkspace, runCommand } from './core.js'
import { isSafePath } from './validate.js'
import { parseStatus } from './parser.js'
import type { AgentDefaultModelFace, SessionModelSelection } from './llm-face.js'
import type { GitChange, GitSuggestRequest, GitSuggestResult, ResolvedLanguage, SuggestLanguage } from './types.js'

/** One endpoint failure (the inner envelope of GitSuggestResult). */
type SuggestFailure = Extract<GitSuggestResult, { ok: false }>

/** Commits read from history when inferring the repository's language. */
const HISTORY_SCAN = 60

/** Non-mechanical subjects handed to the model as style samples. */
const STYLE_SAMPLE_CAP = 12

/**
 * Subject length bound for a style sample. The cap above bounds how many
 * samples reach the prompt but not how large each one is, and git allows an
 * arbitrarily long subject: a repository whose commits are written by a bot
 * or a tool that dumps a paragraph into the first line would otherwise spend
 * the whole `suggestMaxBytes` budget on samples instead of on the diff.
 */
const STYLE_SAMPLE_MAX_CHARS = 200

/** Own-author samples below this count are too thin to speak for the repo. */
const OWN_AUTHOR_MIN = 3

/** Recency weight ratio for the language vote (each step back weighs 0.9×). */
const LANGUAGE_DECAY = 0.9

/**
 * Commits that say nothing about the author's own prose: releases, merges and
 * history repairs are machine-written. They are 100% English even in a
 * Chinese-written repository, so counting them outvotes the real style.
 * `merged?` covers the auto-generated phrasings: "Merge pull request #8",
 * "Merge branch 'x'", Bitbucket's "Merged in x (pull request #12)".
 */
const MECHANICAL_SUBJECT = /^(chore: release|merged?\b|revert\b|fixup!|squash!)/i

/** A subject counts as Chinese when it carries any Han character. */
const CJK = /[\u4e00-\u9fff]/

export function isCjkText(text: string): boolean {
  return CJK.test(text)
}

/**
 * Parse `git log -z --format=%ae%x1f%s` into the repository's own commit
 * subjects, newest first: mechanical commits dropped, and the current
 * author's commits preferred once they are numerous enough to represent the
 * repository (a shared checkout may mix identities). Subjects are trimmed to
 * `STYLE_SAMPLE_MAX_CHARS` code points so one runaway subject cannot consume
 * the generation budget; the closest commit's language still dominates.
 */
export function parseStyleHistory(stdout: string, ownEmail: string | undefined): string[] {
  const records: Array<{ email: string; subject: string }> = []
  for (const record of stdout.split('\u0000')) {
    const sep = record.indexOf('\u001f')
    if (sep === -1) continue
    const subject = record.slice(sep + 1).trim()
    if (subject === '' || MECHANICAL_SUBJECT.test(subject)) continue
    records.push({ email: record.slice(0, sep), subject })
  }
  const own = ownEmail === undefined || ownEmail === ''
    ? []
    : records.filter((r) => r.email === ownEmail)
  const pool = own.length >= OWN_AUTHOR_MIN ? own : records
  return pool.slice(0, STYLE_SAMPLE_CAP).map((r) => clampSubject(r.subject))
}

/** Bound one sample, counting code points so a surrogate pair is never split. */
function clampSubject(subject: string): string {
  const chars = Array.from(subject)
  return chars.length <= STYLE_SAMPLE_MAX_CHARS
    ? subject
    : chars.slice(0, STYLE_SAMPLE_MAX_CHARS).join('')
}

/**
 * Resolve the language a suggestion is written in. `zh` / `en` are honored as
 * configured; `auto` votes over the repository's recent non-mechanical commit
 * subjects with a recency decay, so a repository that switched languages is
 * judged by how it writes *now* rather than by its whole history. With no
 * history to read (an unborn repository) the vote is empty and English is the
 * neutral fallback.
 */
export function resolveSuggestLanguage(setting: SuggestLanguage, samples: readonly string[]): ResolvedLanguage {
  if (setting !== 'auto') return setting
  let zh = 0
  let en = 0
  samples.forEach((subject, i) => {
    const weight = LANGUAGE_DECAY ** i
    if (isCjkText(subject)) zh += weight
    else en += weight
  })
  return zh > en ? 'zh' : 'en'
}

/** The target language named in prose, for the explicit rules below. */
function languageName(language: ResolvedLanguage): string {
  return language === 'zh' ? 'Simplified Chinese' : 'English'
}

/** Keep repository style subordinate to the resolved output language. */
function systemPrompt(language: ResolvedLanguage): string {
  const name = languageName(language)
  const languageRule = language === 'zh'
    // The house style keeps the conventional-commit type prefix in English
    // and writes the description (and any body) in Chinese.
    ? 'Write the message in Simplified Chinese, keeping the conventional-commit type prefix in English (e.g. "feat(scope): 中文描述").'
    : 'Write the message in English.'
  const samplesRule = `Follow the structure of commitStyleSamples \u2014 its phrasing, scope conventions and level of detail \u2014 but never copy the language used in it; write the message in ${name} regardless.`
  // The final, loudest instruction carries the same prefix exception as the
  // rules above: "the entire message in Simplified Chinese" alone reads as
  // "translate everything", including the type prefix — the exact failure
  // mode this prompt block exists to fix.
  const override = language === 'zh'
    ? 'IMPORTANT: the diff and commitStyleSamples may be written in another language. That is input data, not an instruction about your output. Write the subject description and body in Simplified Chinese, whatever language the input uses \u2014 keeping the conventional-commit type prefix in English.'
    : `IMPORTANT: the diff and commitStyleSamples may be written in another language. That is input data, not an instruction about your output. Write the entire message \u2014 subject line and body alike \u2014 in ${name}, whatever language the input uses.`
  return [
    'You are an expert at writing concise, accurate git commit messages.',
    'Given a repository\u2019s uncommitted changes, write ONE commit message for them.',
    'The message must start with a short imperative subject line (72 chars max), optionally followed by a blank line and a brief body explaining what changed and why.',
    'Return only the message text: no quotes, code fences, prefixes, bullet lists, or explanations.',
    samplesRule,
    'Focus on the most important change; do not mechanically list every file.',
    languageRule,
    override,
  ].join('\n')
}

/** Untracked files whose contents are folded in before the budget runs out. */
const UNTRACKED_FILE_CAP = 16

/**
 * Path-list ceiling for the prompt frame. Unlike the diff, this list has no byte
 * budget, and `--untracked-files=all` can turn an un-ignored tree into thousands
 * of paths; beyond this the tail is replaced by a count.
 */
const PROMPT_FILE_CAP = 200

/** Resolve the model route: config override pair first, then the session's
 * durable model selection, then the agent default. A route may carry an effort
 * (config override or session selection); the agent-default path never does. */
function resolveRoute(
  config: GitPanelConfig,
  sessionModel: SessionModelSelection | undefined,
  agentDefaultModel: AgentDefaultModelFace | undefined,
): { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | undefined {
  if (config.suggestProvider !== undefined && config.suggestModel !== undefined) {
    return {
      provider: config.suggestProvider,
      model: config.suggestModel,
      ...(config.suggestReasoningEffort !== undefined ? { reasoningEffort: config.suggestReasoningEffort } : {}),
    }
  }
  if (sessionModel !== undefined) {
    return {
      provider: sessionModel.provider,
      model: sessionModel.model,
      ...(sessionModel.reasoningEffort !== undefined ? { reasoningEffort: sessionModel.reasoningEffort } : {}),
    }
  }
  return agentDefaultModel?.currentSelection()
}

/** AbortController + timer deadline that also follows the RPC signal. */
function withDeadline(
  timeoutMs: number,
  parent?: AbortSignal,
): { readonly signal: AbortSignal; readonly expired: () => boolean; readonly dispose: () => void } {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  const onAbort = (): void => { controller.abort() }
  if (parent !== undefined) {
    if (parent.aborted) { controller.abort() }
    else parent.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    expired: () => timedOut,
    dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', onAbort) },
  }
}

/** Truncate `text` to the largest UTF-8 prefix within `maxBytes`. */
function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (Buffer.byteLength(text.slice(0, mid), 'utf8') <= maxBytes) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo)
}

/** A diff line longer than this is replaced by a one-line marker before the
 * model-input budget is applied. Build output is minified into single lines (a
 * bundled `lib/client.js` line can be hundreds of KB), so shipping it verbatim
 * spends the whole `suggestMaxBytes` budget on one line and cuts off the hunks
 * that actually describe the change. Line count and the diff prefix are kept,
 * so `@@` headers still describe the same regions. */
export const LONG_LINE_MAX_CHARS = 400

/** Unified-diff structural lines that must never be folded: they carry the file
 * identity and the hunk coordinates, which the placeholder would erase. */
const STRUCTURAL_LINE = /^(?:@@|diff --git |index |--- (?:a\/|\/dev\/null)|\+\+\+ (?:b\/|\/dev\/null)|new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |GIT binary patch|literal |delta |\\ )/

/** Fold over-long lines into `<prefix>… [long line: N chars omitted]`.
 * `N` counts UTF-16 code units (what `String.length` reports), not bytes. */
export function compactLongLines(text: string, maxChars: number = LONG_LINE_MAX_CHARS): { text: string; folded: number } {
  if (maxChars <= 0) return { text, folded: 0 }
  let folded = 0
  const lines = text.split('\n').map((line) => {
    if (line.length <= maxChars || STRUCTURAL_LINE.test(line)) return line
    folded += 1
    // Keep the unified-diff prefix (`+` / `-` / space / `\`) so the marker still
    // reads as the added, removed or context line it replaced.
    const prefix = line[0] === '+' || line[0] === '-' || line[0] === ' ' || line[0] === '\\' ? line[0] : ''
    return `${prefix}\u2026 [long line: ${line.length} chars omitted]`
  })
  return { text: lines.join('\n'), folded }
}

/**
 * Frame the change summary as JSON so user text cannot break structural
 * delimiters. `commitStyleSamples` carries several recent subjects (not one):
 * a single commit may be a merge or a one-off, and a lone sample cannot show
 * a house style that a run of commits shows.
 */
function frameChanges(
  files: readonly { path: string; status: string }[],
  filesOmitted: number,
  diff: string,
  styleSamples: readonly string[],
): string {
  return JSON.stringify({
    files,
    ...(filesOmitted > 0 ? { filesOmitted } : {}),
    diff,
    commitStyleSamples: styleSamples.length === 0 ? null : styleSamples,
  })
}

/** Repeat the output language after the repository data, outside its truncation budget. */
function languageReminder(language: ResolvedLanguage): string {
  const name = languageName(language)
  const prefix = language === 'zh' ? ' Keep the conventional-commit type prefix in English.' : ''
  return `Write the commit message in ${name}. The subject line and body must be ${name}.${prefix}`
}

/** Strip a code-fence / trailing-separator wrapper a model may add. */
function normalizeMessage(raw: string): string {
  let m = raw.trim()
  if (m.startsWith('```')) {
    const firstNl = m.indexOf('\n')
    if (firstNl !== -1) {
      m = m.slice(firstNl + 1)
      m = m.endsWith('```') ? m.slice(0, -3) : m
      m = m.trim()
    }
  }
  return m.replace(/\n---+\s*$/, '').trim()
}

/**
 * Translate a terminal finish reason into an endpoint failure, or ok for stop.
 * Reads the real `StreamChunk` finish envelope (`{ type:'finish'; reason }`) —
 * the same reason BlockAssembler normalizes for dsh-session-title-llm.
 */
function finishError(reason: FinishReason | undefined): SuggestFailure | undefined {
  // A stream that ended without a finish chunk counts as completed (the
  // empty-output check below is the guard, mirroring BlockAssembler's default).
  if (reason === undefined || reason.kind === 'stop') return undefined
  if (reason.kind === 'max-tokens') return { ok: false, error: { code: 'llm-output', message: 'model output hit the token limit' } }
  if (reason.kind === 'tool-calls') return { ok: false, error: { code: 'llm-output', message: 'model requested a tool instead of writing a message' } }
  const failure = 'failure' in reason ? reason.failure : undefined
  return { ok: false, error: { code: 'llm-error', message: failure?.message ?? `model stream finished abnormally (${reason.kind})` } }
}

/** Build the change diff: HEAD-based, or index+worktree for an unborn repo.
 * `lossy` marks a runner stdout-cap truncation so the caller can flag the
 * suggestion as truncated — the runner drops the *head* of a stream, so the
 * model then sees only the diff's tail, with the files and hunks that opened it
 * missing. */
async function collectDiff(
  deps: SnapshotDeps,
  root: string,
  hasHead: boolean,
  pathArgs: readonly string[],
): Promise<{ diff: string; lossy: boolean } | SuggestFailure> {
  const cmds: readonly (readonly string[])[] = hasHead
    ? [['git', 'diff', 'HEAD', ...pathArgs]]
    : [['git', 'diff', '--cached', ...pathArgs], ['git', 'diff', ...pathArgs]]
  const runs = await Promise.all(cmds.map((argv) => runCommand(deps.run, argv, root, 'suggest-diff', deps.signal)))
  let diff = ''
  let lossy = false
  for (const res of runs) {
    if ('failure' in res) return { ok: false, error: { code: 'git-unavailable', message: 'diff failed' } }
    if (res.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
    if (res.run.timedOut) return { ok: false, error: { code: 'timeout' } }
    if (res.run.exitCode !== 0) {
      return { ok: false, error: { code: 'git-error', message: res.run.stderr.trim() || 'git diff failed' } }
    }
    if (res.run.stdoutLossy) lossy = true
    diff += res.run.stdout
  }
  return { diff, lossy }
}

/**
 * Fold untracked new files into the diff within the byte budget: `git diff
 * HEAD` never includes them, so a change made only of new files would
 * otherwise reach the model as a bare path list. Each candidate runs
 * `git diff --no-index -- /dev/null <path>` (exit 1 merely means "differences";
 * only spawn failures/cancellation are skipped), a `--`-separated argv, with
 * paths re-validated by isSafePath. Stops at the cap or when budget runs out;
 * a lossy runner read (stdout cap with spill degraded) likewise stops the fold
 * and flags the result truncated. */
async function appendUntracked(
  deps: SnapshotDeps,
  root: string,
  files: readonly GitChange[],
  diff: string,
  budget: number,
): Promise<{ diff: string; truncated: boolean }> {
  let text = diff
  let truncated = false
  const candidates = files.filter((c) => c.status === 'untracked' && !c.isDirectory && isSafePath(c.path))
  for (const c of candidates.slice(0, UNTRACKED_FILE_CAP)) {
    const remaining = budget - Buffer.byteLength(text, 'utf8')
    if (remaining <= 0) { truncated = true; break }
    const res = await runCommand(deps.run, ['git', 'diff', '--no-index', '--', '/dev/null', c.path], root, 'suggest-untracked', deps.signal)
    if ('failure' in res || res.run.cancelled || res.run.timedOut) continue
    const chunk = compactLongLines(res.run.stdout).text
    if (chunk === '') continue
    // A lossy runner read (stdout cap hit with spill degraded) kept only the
    // stream's tail — this file's diff lost its header and opening hunks: keep
    // what arrived, flag the loss, and stop folding — unrelated diffs after a
    // cut file would only bury the truncation.
    const lossy = res.run.stdoutLossy
    if (lossy || Buffer.byteLength(chunk, 'utf8') > remaining) {
      text += truncateUtf8(chunk, remaining) + '\n... [diff truncated]'
      truncated = true
      break
    }
    text += chunk
  }
  return { diff: text, truncated }
}

/** Generate a commit message for the session's uncommitted changes. */
export async function runSuggest(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  request: GitSuggestRequest,
): Promise<GitSuggestResult> {
  // Host-side guard: the client hides the button on a snapshot with
  // suggestEnabled=false, so a direct RPC here is a stale or hostile call.
  if (!config.suggestEnabled) {
    return { ok: false, error: { code: 'suggest-disabled', message: 'AI suggest is turned off in the plugin config' } }
  }
  const workspace = await resolveWorkspace(deps, request.sessionId)
  if (!workspace.ok) return { ok: false, error: mapWorkspaceFailure(workspace.failure) }
  const root = workspace.root

  // Every path is untrusted argv material after `--`: validate each one.
  const paths = request.paths ?? []
  for (const path of paths) {
    if (!isSafePath(path)) return { ok: false, error: { code: 'invalid-path', message: path } }
  }
  const pathArgs: readonly string[] = paths.length > 0 ? ['--', ...paths] : []
  const pathSet = new Set(paths)

  // Round 1, parallel: change list, HEAD probe (unborn repos have no HEAD), the
  // recent commit subjects for style/language, and the author identity to weigh
  // them by. Non-zero exits are legal for head/log/config (unborn → no HEAD
  // diff; no commits → no history; unset user.email → no own-author bias);
  // status failing is a real error since the file list cannot be built.
  const [statusRes, headRes, logRes, emailRes] = await Promise.all([
    runCommand(deps.run, ['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], root, 'suggest-status', deps.signal),
    runCommand(deps.run, ['git', 'rev-parse', '--verify', 'HEAD'], root, 'suggest-head', deps.signal),
    runCommand(deps.run, ['git', 'log', `-n${HISTORY_SCAN}`, '-z', '--format=%ae\u001f%s'], root, 'suggest-log', deps.signal),
    runCommand(deps.run, ['git', 'config', 'user.email'], root, 'suggest-email', deps.signal),
  ])
  if ('failure' in statusRes) return { ok: false, error: { code: 'git-unavailable', message: 'status failed' } }
  if (statusRes.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
  if (statusRes.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (statusRes.run.exitCode !== 0) {
    return { ok: false, error: { code: 'git-error', message: statusRes.run.stderr.trim() || 'git status failed' } }
  }
  const hasHead = 'run' in headRes && headRes.run.exitCode === 0
  // A lossy log — output beyond the runner's spill ceiling, meaning ~1 MiB per
  // subject across 60 records — leaves the runner's in-memory *tail*, which for
  // this newest-first scan is the oldest commits. The vote and the samples then
  // run on that stale slice instead of recent history: accepted degradation,
  // not an error case. An unborn repo makes the log itself fail, which degrades
  // to "no history" rather than an error.
  const styleSamples = 'run' in logRes && logRes.run.exitCode === 0
    ? parseStyleHistory(logRes.run.stdout, 'run' in emailRes && emailRes.run.exitCode === 0 ? emailRes.run.stdout.trim() : undefined)
    : []
  const language = resolveSuggestLanguage(config.suggestLanguage, styleSamples)

  // A lossy status (output over the runner's cap) cannot name the files;
  // degrade to an empty list — the diff below still carries the change.
  const all = statusRes.run.stdoutLossy ? [] : parseStatus(statusRes.run.stdout)
  const files = pathSet.size > 0
    ? all.filter((c) => {
      if (pathSet.has(c.path)) return true
      // Snapshot fallback can select a collapsed directory instead of its files.
      for (let slash = c.path.indexOf('/'); slash !== -1; slash = c.path.indexOf('/', slash + 1)) {
        if (pathSet.has(c.path.slice(0, slash))) return true
      }
      return false
    })
    : all

  // Round 2: the diff, then fold untracked contents in while budget remains.
  const collected = await collectDiff(deps, root, hasHead, pathArgs)
  if (!('diff' in collected)) return collected

  if (files.length === 0 && collected.diff.trim() === '') {
    return { ok: false, error: { code: 'empty-diff', message: 'no uncommitted changes to summarize' } }
  }

  // Fold minified single-line blobs first: they would otherwise eat the whole
  // byte budget and cut off the hunks that explain the change.
  let diff = compactLongLines(collected.diff).text
  // A runner stdout-cap truncation (profile `maxBytes` below the diff size)
  // is just as lossy as the model-input cap — flag it, not silently drop it.
  let truncated = collected.lossy
  if (Buffer.byteLength(diff, 'utf8') > config.suggestMaxBytes) {
    diff = truncateUtf8(diff, config.suggestMaxBytes) + '\n... [diff truncated]'
    truncated = true
  }
  const untracked = await appendUntracked(deps, root, files, diff, config.suggestMaxBytes)
  diff = untracked.diff
  truncated = truncated || untracked.truncated

  // Resolved per request so a model service that activates late or restarts
  // is picked up (never frozen at construction).
  const llm = deps.getLlm?.()
  const route = resolveRoute(config, deps.getSessionModel?.(request.sessionId), deps.getAgentDefaultModel?.())
  if (llm === undefined || route === undefined) {
    return { ok: false, error: { code: 'llm-unavailable', message: 'no model service or route is configured' } }
  }

  const frame = frameChanges(
    files.slice(0, PROMPT_FILE_CAP).map((c) => ({ path: c.path, status: c.status })),
    Math.max(0, files.length - PROMPT_FILE_CAP),
    diff,
    styleSamples,
  )
  const deadline = withDeadline(config.suggestTimeoutMs, deps.signal)
  // A hand-built one-shot request (never persisted): `messages` must satisfy
  // the durable Message contract across dsh-llm versions (id + source are
  // required there; newer versions also allow an id-less RequestUserInput),
  // so the identity is a constant type-carrier — no session log ever sees it.
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    // Catalog effort ids come from the same adapter surface GenerateOptions
    // accepts; the brand is compile-time only (the runtime factory lives in
    // @deepseek-ai/dsh-llm, which is externalized), so a cast is the boundary.
    ...(route.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort as ReasoningEffortId } : {}),
    system: systemPrompt(language),
    messages: [{
      id: 'git-panel-suggest' as MessageId,
      role: 'user',
      content: [
        { type: 'text', text: frame },
        { type: 'text', text: languageReminder(language) },
      ],
      source: { kind: 'user' },
    }],
    maxTokens: config.suggestMaxOutputTokens,
    temperature: 0.3,
    signal: deadline.signal,
  }

  let output = ''
  let finish: FinishReason | undefined
  try {
    for await (const chunk of llm.stream(options)) {
      if (chunk.type === 'text-delta') output += chunk.text
      else if (chunk.type === 'finish') finish = chunk.reason
    }
  } catch (error) {
    if (deps.signal?.aborted === true) return { ok: false, error: { code: 'cancelled' } }
    if (deadline.expired()) return { ok: false, error: { code: 'llm-error', message: `model call timed out after ${config.suggestTimeoutMs}ms` } }
    return { ok: false, error: { code: 'llm-error', message: error instanceof Error ? error.message : 'model stream failed' } }
  } finally {
    deadline.dispose()
  }

  if (deps.signal?.aborted === true) return { ok: false, error: { code: 'cancelled' } }
  if (deadline.expired()) return { ok: false, error: { code: 'llm-error', message: `model call timed out after ${config.suggestTimeoutMs}ms` } }
  const terminal = finishError(finish)
  if (terminal !== undefined) return terminal

  const message = normalizeMessage(output)
  if (message === '') return { ok: false, error: { code: 'llm-output', message: 'model produced no message text' } }

  return {
    ok: true,
    value: {
      message,
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort } : {}),
      ...(truncated ? { truncated: true } : {}),
    },
  }
}
