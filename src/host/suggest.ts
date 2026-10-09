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
import type { FinishReason, GenerateOptions, MessageId } from '@deepseek-ai/dsh-llm'
import type { GitPanelConfig, SnapshotDeps } from './core.ts'
import { mapWorkspaceFailure, resolveWorkspace, runCommand } from './core.ts'
import { isSafePath } from './validate.ts'
import { parseStatus } from './parser.ts'
import type { AgentDefaultModelFace } from './llm-face.ts'
import type { GitChange, GitSuggestRequest, GitSuggestResult } from './types.ts'

/** One endpoint failure (the inner envelope of GitSuggestResult). */
type SuggestFailure = Extract<GitSuggestResult, { ok: false }>

/** System instruction for the one-shot commit-message call. */
const SYSTEM_PROMPT = [
  'You are an expert at writing concise, accurate git commit messages.',
  'Given a repository\u2019s uncommitted changes, write ONE commit message for them.',
  'The message must start with a short imperative subject line (72 chars max), optionally followed by a blank line and a brief body explaining what changed and why.',
  'Return only the message text: no quotes, code fences, prefixes, bullet lists, or explanations.',
  'Match the language and style of the recent commit message when one is provided; otherwise write in English.',
  'Focus on the most important change; do not mechanically list every file.',
].join('\n')

/** Untracked files whose contents are folded in before the budget runs out. */
const UNTRACKED_FILE_CAP = 16

/** Resolve the model route: config override pair first, then the agent default. */
function resolveRoute(
  config: GitPanelConfig,
  agentDefaultModel: AgentDefaultModelFace | undefined,
): { readonly provider: string; readonly model: string } | undefined {
  if (config.suggestProvider !== undefined && config.suggestModel !== undefined) {
    return { provider: config.suggestProvider, model: config.suggestModel }
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

/** Frame the change summary as JSON so user text cannot break structural delimiters. */
function frameChanges(files: readonly { path: string; status: string }[], diff: string, recentCommitMessage: string): string {
  return JSON.stringify({
    files,
    diff,
    recentCommitMessage: recentCommitMessage === '' ? null : recentCommitMessage,
  })
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

/** Build the change diff: HEAD-based, or index+worktree for an unborn repo. */
async function collectDiff(
  deps: SnapshotDeps,
  root: string,
  hasHead: boolean,
  pathArgs: readonly string[],
): Promise<string | SuggestFailure> {
  const cmds: readonly (readonly string[])[] = hasHead
    ? [['git', 'diff', 'HEAD', ...pathArgs]]
    : [['git', 'diff', '--cached', ...pathArgs], ['git', 'diff', ...pathArgs]]
  const runs = await Promise.all(cmds.map((argv) => runCommand(deps.run, argv, root, 'suggest-diff', deps.signal)))
  let diff = ''
  for (const res of runs) {
    if ('failure' in res) return { ok: false, error: { code: 'git-unavailable', message: 'diff failed' } }
    if (res.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
    if (res.run.timedOut) return { ok: false, error: { code: 'timeout' } }
    if (res.run.exitCode !== 0) {
      return { ok: false, error: { code: 'git-error', message: res.run.stderr.trim() || 'git diff failed' } }
    }
    diff += res.run.stdout
  }
  return diff
}

/**
 * Fold untracked new files into the diff within the byte budget: `git diff
 * HEAD` never includes them, so a change made only of new files would
 * otherwise reach the model as a bare path list. Each candidate runs
 * `git diff --no-index -- /dev/null <path>` (exit 1 merely means "differences";
 * only spawn failures/cancellation are skipped), a `--`-separated argv, with
 * paths re-validated by isSafePath. Stops at the cap or when budget runs out.
 */
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
    const chunk = res.run.stdout
    if (chunk === '') continue
    if (Buffer.byteLength(chunk, 'utf8') > remaining) {
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

  // Round 1, parallel: change list, HEAD probe (unborn repos have no HEAD), and
  // the recent commit message for style. Non-zero exits are legal for head/last
  // (unborn → no HEAD diff; no commits → no recent message); status failing is
  // a real error since the file list cannot be built.
  const [statusRes, headRes, lastRes] = await Promise.all([
    runCommand(deps.run, ['git', 'status', '--porcelain=v1', '-z'], root, 'suggest-status', deps.signal),
    runCommand(deps.run, ['git', 'rev-parse', '--verify', 'HEAD'], root, 'suggest-head', deps.signal),
    runCommand(deps.run, ['git', 'log', '-1', '--format=%B'], root, 'suggest-last', deps.signal),
  ])
  if ('failure' in statusRes) return { ok: false, error: { code: 'git-unavailable', message: 'status failed' } }
  if (statusRes.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
  if (statusRes.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (statusRes.run.exitCode !== 0) {
    return { ok: false, error: { code: 'git-error', message: statusRes.run.stderr.trim() || 'git status failed' } }
  }
  const hasHead = 'run' in headRes && headRes.run.exitCode === 0
  const recentCommitMessage = 'run' in lastRes && lastRes.run.exitCode === 0 ? lastRes.run.stdout.replace(/\n+$/, '') : ''

  // A lossy status (output over the runner's cap) cannot name the files;
  // degrade to an empty list — the diff below still carries the change.
  const all = statusRes.run.stdoutLossy ? [] : parseStatus(statusRes.run.stdout)
  const files = pathSet.size > 0
    ? all.filter((c) => pathSet.has(c.path))
    : all

  // Round 2: the diff, then fold untracked contents in while budget remains.
  const collected = await collectDiff(deps, root, hasHead, pathArgs)
  if (typeof collected !== 'string') return collected

  if (files.length === 0 && collected.trim() === '') {
    return { ok: false, error: { code: 'empty-diff', message: 'no uncommitted changes to summarize' } }
  }

  let diff = collected
  let truncated = false
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
  const route = resolveRoute(config, deps.getAgentDefaultModel?.())
  if (llm === undefined || route === undefined) {
    return { ok: false, error: { code: 'llm-unavailable', message: 'no model service or route is configured' } }
  }

  const frame = frameChanges(
    files.map((c) => ({ path: c.path, status: c.status })),
    diff,
    recentCommitMessage,
  )
  const deadline = withDeadline(config.suggestTimeoutMs, deps.signal)
  // A hand-built one-shot request (never persisted): `messages` must satisfy
  // the durable Message contract across dsh-llm versions (id + source are
  // required there; newer versions also allow an id-less RequestUserInput),
  // so the identity is a constant type-carrier — no session log ever sees it.
  const options: GenerateOptions = {
    provider: route.provider,
    model: route.model,
    system: SYSTEM_PROMPT,
    messages: [{
      id: 'git-panel-suggest' as MessageId,
      role: 'user',
      content: [{ type: 'text', text: frame }],
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
      ...(truncated ? { truncated: true } : {}),
    },
  }
}
