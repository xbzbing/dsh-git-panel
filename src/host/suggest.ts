/**
 * AI commit-message suggestion endpoint.
 *
 * Collects the repository's uncommitted changes (or the user's selected paths)
 * — a file list plus the diff against HEAD — frames them for the configured
 * model, and returns the generated message. The LLM surface is the structural
 * `LlmFace` slice of the host `llm` service, so the endpoint runs standalone
 * and stays unit-testable without a real model. All framing policy mirrors
 * @deepseek-ai/dsh-session-title-llm: JSON-wrapped input, a bounded input
 * cap, an output token cap, a timeout, and finish-reason → error mapping.
 */
import type { GitPanelConfig, SnapshotDeps } from './core.ts'
import { mapWorkspaceFailure, resolveWorkspace, runCommand } from './core.ts'
import { isSafePath } from './validate.ts'
import { parseStatus } from './parser.ts'
import type { LlmStreamOptions } from './llm-face.ts'
import type { GitSuggestRequest, GitSuggestResult } from './types.ts'

/** System instruction for the one-shot commit-message call. */
const SYSTEM_PROMPT = [
  'You are an expert at writing concise, accurate git commit messages.',
  'Given a repository\u2019s uncommitted changes, write ONE commit message for them.',
  'The message must start with a short imperative subject line (72 chars max), optionally followed by a blank line and a brief body explaining what changed and why.',
  'Return only the message text: no quotes, code fences, prefixes, bullet lists, or explanations.',
  'Match the language and style of the recent commit message when one is provided; otherwise write in English.',
  'Focus on the most important change; do not mechanically list every file.',
].join('\n')

/** Resolve the model route: config override pair first, then the agent default. */
function resolveRoute(
  config: GitPanelConfig,
  agentDefaultModel: SnapshotDeps['agentDefaultModel'],
): { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | undefined {
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

/** Translate a terminal finish reason into an endpoint failure, or ok for stop. */
function finishError(finish: {
  readonly kind?: string
  readonly failure?: { readonly code?: string; readonly message?: string }
}): GitSuggestResult | undefined {
  const kind = finish.kind
  if (kind === undefined || kind === 'stop') return undefined
  if (kind === 'max-tokens') return { ok: false, error: { code: 'llm-output', message: 'model output hit the token limit' } }
  if (kind === 'tool-calls') return { ok: false, error: { code: 'llm-output', message: 'model requested a tool instead of writing a message' } }
  return { ok: false, error: { code: 'llm-error', message: finish.failure?.message ?? `model stream finished abnormally (${kind})` } }
}

/** Build the git command sequence producing the change diff. */
async function collectDiff(
  deps: SnapshotDeps,
  root: string,
  hasHead: boolean,
  pathArgs: readonly string[],
): Promise<{ ok: true; diff: string } | { ok: false; error: GitSuggestResult & { ok: false } }> {
  const cmds: readonly (readonly string[])[] = hasHead
    ? [['git', 'diff', 'HEAD', ...pathArgs]]
    : [['git', 'diff', '--cached', ...pathArgs], ['git', 'diff', ...pathArgs]]
  const runs = await Promise.all(cmds.map((argv) => runCommand(deps.run, argv, root, 'suggest-diff', deps.signal)))
  let diff = ''
  for (const res of runs) {
    if ('failure' in res) return { ok: false, error: { ok: false, error: { code: 'git-unavailable', message: 'diff failed' } } }
    if (res.run.cancelled) return { ok: false, error: { ok: false, error: { code: 'cancelled' } } }
    if (res.run.timedOut) return { ok: false, error: { ok: false, error: { code: 'timeout' } } }
    if (res.run.exitCode !== 0) {
      return { ok: false, error: { ok: false, error: { code: 'git-error', message: res.run.stderr.trim() || 'git diff failed' } } }
    }
    diff += res.run.stdout
  }
  return { ok: true, diff }
}

/** Generate a commit message for the session's uncommitted changes. */
export async function runSuggest(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  request: GitSuggestRequest,
): Promise<GitSuggestResult> {
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
  // the recent commit message for style. All non-zero exits are legal here and
  // handled per command (unborn → no HEAD diff; no commits → no recent message).
  const [statusRes, headRes, lastRes] = await Promise.all([
    runCommand(deps.run, ['git', 'status', '--porcelain=v1', '-z'], root, 'suggest-status', deps.signal),
    runCommand(deps.run, ['git', 'rev-parse', '--verify', 'HEAD'], root, 'suggest-head', deps.signal),
    runCommand(deps.run, ['git', 'log', '-1', '--format=%B'], root, 'suggest-last', deps.signal),
  ])
  if ('failure' in statusRes) return { ok: false, error: { code: 'git-unavailable', message: 'status failed' } }
  if (statusRes.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
  if (statusRes.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  const hasHead = 'run' in headRes && headRes.run.exitCode === 0
  const recentCommitMessage = 'run' in lastRes && lastRes.run.exitCode === 0 ? lastRes.run.stdout.replace(/\n+$/, '') : ''

  const all = statusRes.run.exitCode === 0 && !statusRes.run.stdoutLossy ? parseStatus(statusRes.run.stdout) : []
  const files = pathSet.size > 0
    ? all.filter((c) => pathSet.has(c.path))
    : all

  // Round 2: the diff (HEAD-based, or index+worktree for an unborn repo).
  const diffRes = await collectDiff(deps, root, hasHead, pathArgs)
  if (!diffRes.ok) return diffRes.error

  if (files.length === 0 && diffRes.diff.trim() === '') {
    return { ok: false, error: { code: 'empty-diff', message: 'no uncommitted changes to summarize' } }
  }

  let diff = diffRes.diff
  let truncated = false
  if (Buffer.byteLength(diff, 'utf8') > config.suggestMaxBytes) {
    diff = truncateUtf8(diff, config.suggestMaxBytes) + '\n... [diff truncated]'
    truncated = true
  }

  const route = resolveRoute(config, deps.agentDefaultModel)
  if (deps.llm === undefined || route === undefined) {
    return { ok: false, error: { code: 'llm-unavailable', message: 'no model service or route is configured' } }
  }

  const frame = frameChanges(
    files.map((c) => ({ path: c.path, status: c.status })),
    diff,
    recentCommitMessage,
  )
  const deadline = withDeadline(config.suggestTimeoutMs, deps.signal)
  const options: LlmStreamOptions = {
    provider: route.provider,
    model: route.model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: [{ type: 'text', text: frame }] }],
    maxTokens: config.suggestMaxOutputTokens,
    temperature: 0.3,
    ...(route.reasoningEffort !== undefined ? { reasoningEffort: route.reasoningEffort } : {}),
    signal: deadline.signal,
  }

  let output = ''
  let finish: { kind?: string; failure?: { code?: string; message?: string } } = {}
  try {
    for await (const chunk of deps.llm.stream(options)) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') output += chunk.text
      else if (chunk.type === 'finish') finish = chunk
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
      ...(route.provider !== undefined ? { provider: route.provider } : {}),
      ...(route.model !== undefined ? { model: route.model } : {}),
      ...(truncated ? { truncated: true } : {}),
    },
  }
}