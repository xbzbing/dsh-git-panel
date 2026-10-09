/**
 * Suggest-endpoint tests: real git repositories in a temp dir drive the diff
 * collection; a stub LLM stream drives the model-call side. Covers framing
 * (files + diff + recent message), path filtering, unborn repos, truncation,
 * route resolution (agent default vs config override), finish-reason error
 * mapping, timeout, and missing-service degradation.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath, readFile, readdir, rm, stat } from 'node:fs/promises'
import { runSuggest, createGitRunner, DEFAULT_CONFIG } from '../../lib/host/index.js'

let repo
let unborn
const SID = 'test-session'

/** child_process-backed subprocess service matching SubprocessLike. */
const subprocess = {
  spawn(spec) {
    const child = nodeSpawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd })
    if (typeof spec.stdio.stdin === 'object') child.stdin.end(spec.stdio.stdin.data)
    else child.stdin.end()
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    const done = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code, signal) => resolve({ exitCode: code, signal }))
    })
    return {
      done,
      collected: {
        stdout: { readFrom: () => ({ text: out, lossy: false }) },
        stderr: { readFrom: () => ({ text: err, lossy: false }) },
      },
    }
  },
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const c = nodeSpawn('git', args, { cwd })
    let err = ''
    c.stderr.on('data', (d) => { err += d })
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')}: ${err}`))))
  })
}

function depsFor(dir, extra = {}) {
  return {
    run: createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes),
    fs: {
      realpath, stat: (p) => stat(p), readFile: (p) => readFile(p),
      readdir: async (p) => (await readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
      remove: (p) => rm(p, { force: true }),
    },
    sessions: { liveCwd: () => dir, persistedMeta: async () => undefined },
    ...extra,
  }
}

/** A stub LLM face recording every call and replaying a chunk script. */
function stubLlm(chunks, { streamError, onSignalAbort } = {}) {
  const calls = []
  const face = {
    calls,
    async *stream(options) {
      calls.push(options)
      if (onSignalAbort !== undefined) {
        await new Promise((resolve) => {
          const abort = () => resolve()
          if (options.signal?.aborted === true) abort()
          else options.signal?.addEventListener('abort', abort, { once: true })
        })
        if (streamError !== undefined) throw streamError
      }
      for (const chunk of chunks) yield chunk
    },
  }
  return face
}

const OK_CHUNKS = [
  { type: 'text-delta', index: 0, text: 'fix(parser): handle NUL records' },
  { type: 'text-delta', index: 0, text: '\n\nBody line' },
  { type: 'finish', index: 0, kind: 'stop' },
]

before(async () => {
  repo = mkdtempSync(join(tmpdir(), 'gp-suggest-'))
  await runGit(repo, ['init', '-q'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'init: first commit'])
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1\n')
  await runGit(repo, ['add', 'a.ts'])
  await runGit(repo, ['commit', '-qm', 'feat: add a.ts'])
  // A long file makes diffs long enough to exercise truncation caps.
  writeFileSync(join(repo, 'b.ts'), Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n')
  await runGit(repo, ['add', 'b.ts'])
  await runGit(repo, ['commit', '-qm', 'feat: add b.ts'])
  writeFileSync(join(repo, 'b.ts'), 'line 0\nchanged line\n' + Array.from({ length: 198 }, (_, i) => `line ${i + 2}`).join('\n') + '\n')
  writeFileSync(join(repo, 'new.txt'), 'brand new\n')
  writeFileSync(join(repo, 'unselected.txt'), 'not in selection\n')

  unborn = mkdtempSync(join(tmpdir(), 'gp-suggest-unborn-'))
  await runGit(unborn, ['init', '-q'])
  writeFileSync(join(unborn, 'x.txt'), 'hello\n')
})

after(() => {
  rmSync(repo, { recursive: true, force: true })
  rmSync(unborn, { recursive: true, force: true })
})

test('success: returns the assembled message and both delta texts', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p1', model: 'm1' }) } })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.value.message, 'fix(parser): handle NUL records\n\nBody line')
    assert.equal(res.value.provider, 'p1')
    assert.equal(res.value.model, 'm1')
    assert.equal(res.value.truncated, undefined)
  }
  assert.equal(llm.calls.length, 1)
})

test('frames files, diff, and recent commit message as JSON for the model', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p1', model: 'm1' }) } })
  await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  const options = llm.calls[0]
  assert.equal(options.provider, 'p1')
  assert.equal(options.model, 'm1')
  assert.equal(options.maxTokens, DEFAULT_CONFIG.suggestMaxOutputTokens)
  assert.equal(options.temperature, 0.3)
  assert.match(options.system, /commit messages/)
  const frame = JSON.parse(options.messages[0].content[0].text)
  const changed = frame.files.map((f) => `${f.status}:${f.path}`).sort()
  // b.ts modified in the worktree, new.txt + unselected.txt untracked; a.ts clean.
  assert.deepEqual(changed, ['modified:b.ts', 'untracked:new.txt', 'untracked:unselected.txt'])
  assert.match(frame.diff, /changed line/)
  assert.match(frame.diff, /diff --git a\/b.ts/)
  assert.equal(frame.recentCommitMessage, 'feat: add b.ts')
})

test('paths filter restricts both the file list and the diff', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p1', model: 'm1' }) } })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID, paths: ['new.txt'] })
  assert.equal(res.ok, true)
  const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
  assert.deepEqual(frame.files, [{ path: 'new.txt', status: 'untracked' }])
  // Untracked files produce no HEAD diff, but the path still reached the frame.
  assert.equal(frame.diff, '')
  assert.equal(res.ok && res.value.message.length > 0, true)
})

test('unsafe path in the request is rejected', async () => {
  const llm = stubLlm([])
  const deps = depsFor(repo, { llm })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID, paths: ['../evil.txt'] })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'invalid-path')
})

test('unborn repo: diff comes from index + worktree, no HEAD required', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(unborn, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p1', model: 'm1' }) } })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, true)
  const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
  assert.deepEqual(frame.files, [{ path: 'x.txt', status: 'untracked' }])
})

test('no uncommitted changes reports empty-diff', async () => {
  const clean = mkdtempSync(join(tmpdir(), 'gp-suggest-clean-'))
  try {
    await runGit(clean, ['init', '-q'])
    const llm = stubLlm([])
    const deps = depsFor(clean, { llm })
    const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.error.code, 'empty-diff')
    assert.equal(llm.calls.length, 0, 'no model call when there is nothing to summarize')
  } finally {
    rmSync(clean, { recursive: true, force: true })
  }
})

test('oversized diff is truncated and flagged', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p1', model: 'm1' }) } })
  const config = { ...DEFAULT_CONFIG, suggestMaxBytes: 64 }
  const res = await runSuggest(deps, config, { sessionId: SID })
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.value.truncated, true)
  const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
  assert.ok(Buffer.byteLength(frame.diff, 'utf8') <= 64 + '[diff truncated]'.length + 8)
  assert.match(frame.diff, /diff truncated/)
})

test('finish error maps to llm-error with the provider message', async () => {
  const llm = stubLlm([{ type: 'finish', kind: 'error', failure: { code: 'RATE_LIMIT', message: 'quota exceeded' } }])
  const deps = depsFor(repo, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p1', model: 'm1' }) } })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'llm-error')
    assert.match(res.error.message ?? '', /quota exceeded/)
  }
})

test('max-tokens finish maps to llm-output', async () => {
  const llm = stubLlm([{ type: 'finish', kind: 'max-tokens' }])
  const deps = depsFor(repo, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p1', model: 'm1' }) } })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'llm-output')
})

test('empty model output maps to llm-output', async () => {
  const llm = stubLlm([{ type: 'text-delta', index: 0, text: '   ' }, { type: 'finish', kind: 'stop' }])
  const deps = depsFor(repo, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p1', model: 'm1' }) } })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'llm-output')
})

test('code-fence wrapper is stripped from the message', async () => {
  const llm = stubLlm([
    { type: 'text-delta', index: 0, text: '```\nfeat: wrapped in fences\n```' },
    { type: 'finish', kind: 'stop' },
  ])
  const deps = depsFor(repo, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p1', model: 'm1' }) } })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.value.message, 'feat: wrapped in fences')
})

test('missing llm service reports llm-unavailable without calling anything', async () => {
  const deps = depsFor(repo) // no llm, no agentDefaultModel
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'llm-unavailable')
})

test('config provider/model override beats the agent default route', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'agent-p', model: 'agent-m' }) } })
  const config = { ...DEFAULT_CONFIG, suggestProvider: 'cfg-p', suggestModel: 'cfg-m' }
  await runSuggest(deps, config, { sessionId: SID })
  assert.equal(llm.calls[0].provider, 'cfg-p')
  assert.equal(llm.calls[0].model, 'cfg-m')
})

test('timeout: a stream that never finishes maps to llm-error', async () => {
  const llm = stubLlm([], { onSignalAbort: true, streamError: new Error('aborted by signal') })
  const deps = depsFor(repo, { llm, agentDefaultModel: { currentSelection: () => ({ provider: 'p1', model: 'm1' }) } })
  const config = { ...DEFAULT_CONFIG, suggestTimeoutMs: 60 }
  const res = await runSuggest(deps, config, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'llm-error')
    assert.match(res.error.message ?? '', /timed out/)
  }
})