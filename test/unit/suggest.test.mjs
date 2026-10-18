/**
 * Suggest-endpoint tests: real git repositories in a temp dir drive the diff
 * collection; a stub LLM stream drives the model-call side. Covers framing
 * (files + diff + recent message), untracked fold-in, path filtering, unborn
 * repos, truncation, route resolution (agent default vs config override),
 * finish-reason error mapping against the real `{ type:'finish'; reason }`
 * chunk envelope, timeout, suggest-disabled, and missing-service degradation.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath, readFile, readdir, rm, stat } from 'node:fs/promises'
import { runSuggest, snapshotForSession, createGitRunner, DEFAULT_CONFIG, normalizeConfig, resolveSuggestLanguage, parseStyleHistory, isCjkText, compactLongLines, LONG_LINE_MAX_CHARS } from '../../lib/host/index.js'
import { SUGGEST_LIMITS, SUGGEST_LANGUAGES } from '../../lib/host/types.js'

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
    // In-memory collect semantics of the real service, no spill (equivalent to
    // its spill-unavailable degradation): over the per-stream cap the collector
    // drops from the *head*, so the read is the retained tail and lossy.
    const collect = (text, cap) => {
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes <= cap) return { text, lossy: false }
      return { text: Buffer.from(text, 'utf8').subarray(bytes - cap).toString('utf8'), lossy: true }
    }
    return {
      done,
      collected: {
        stdout: { readFrom: () => collect(out, spec.stdio.stdout.collect.maxBytes) },
        stderr: { readFrom: () => collect(err, spec.stdio.stderr.collect.maxBytes) },
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

/** The default-model face returning a fixed route. */
function defaultRoute(provider = 'p1', model = 'm1') {
  return { currentSelection: () => ({ provider, model }) }
}

/** getSessionModel returning a fixed session selection. */
function sessionRoute(provider, model, reasoningEffort) {
  return () => ({ provider, model, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) })
}

/**
 * A stub LLM face recording every call and replaying a chunk script. Chunks
 * use the real StreamChunk envelope: text-delta carries `text`, the terminal
 * finish chunk carries `reason` (never a top-level `kind`).
 */
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
  { type: 'finish', reason: { kind: 'stop' } },
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
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
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

test('frames files, diff, and commit style samples as JSON for the model', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  const options = llm.calls[0]
  assert.equal(options.provider, 'p1')
  assert.equal(options.model, 'm1')
  assert.equal(options.maxTokens, DEFAULT_CONFIG.suggestMaxOutputTokens)
  assert.equal(options.temperature, 0.3)
  assert.match(options.system, /commit messages/)
  // The one-shot message satisfies the durable Message contract (id + source).
  assert.equal(options.messages[0].role, 'user')
  assert.equal(options.messages[0].source.kind, 'user')
  assert.equal(typeof options.messages[0].id, 'string')
  const frame = JSON.parse(options.messages[0].content[0].text)
  const changed = frame.files.map((f) => `${f.status}:${f.path}`).sort()
  // b.ts modified in the worktree, new.txt + unselected.txt untracked; a.ts clean.
  assert.deepEqual(changed, ['modified:b.ts', 'untracked:new.txt', 'untracked:unselected.txt'])
  assert.match(frame.diff, /changed line/)
  assert.match(frame.diff, /diff --git a\/b.ts/)
  // Untracked new files are folded into the diff, not left as bare paths.
  assert.match(frame.diff, /brand new/)
  assert.match(frame.diff, /not in selection/)
  assert.equal(frame.commitStyleSamples.includes('feat: add b.ts'), true)
  // The language is stated outright — without it the model has no way to know
  // which language this repository is written in, which is why the output used
  // to come back in English regardless of the repository.
  assert.match(options.system, /Write the message in English\./)
})

// Repository samples provide structure; the resolved setting controls language.
// These assertions guard request construction, not probabilistic model compliance.
test('prompt subordinates style samples to the language rule, which comes last', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  await runSuggest(deps, { ...DEFAULT_CONFIG, suggestLanguage: 'en' }, { sessionId: SID })
  const system = llm.calls[0].system
  const samplesAt = system.search(/commitStyleSamples/)
  const samplesRuleAt = system.indexOf('never copy the language used in it')
  const languageAt = system.indexOf('Write the message in English.')
  const overrideAt = system.indexOf('IMPORTANT: the diff and commitStyleSamples')

  // The samples rule is narrowed to structure instead of "follow its phrasing
  // and scope conventions" — that phrasing was read as a licence to copy the
  // language too.
  assert.notEqual(samplesRuleAt, -1, 'style samples must be explicitly scoped to structure')
  assert.ok(samplesRuleAt > samplesAt)
  assert.match(system, /write the message in English regardless/)

  // The language rule is restated after the samples rule, and the override
  // that names the input as data rather than instruction closes the prompt.
  assert.ok(languageAt > samplesRuleAt, 'language rule must follow the samples rule')
  assert.ok(overrideAt > languageAt, 'override must come last')
  assert.match(system, /subject line and body alike/)
  // Nothing follows the override to dilute it: it is the final line.
  assert.equal(system.slice(overrideAt).includes('\n'), false)
})

test('prompt override names Simplified Chinese when the target is zh', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  await runSuggest(deps, { ...DEFAULT_CONFIG, suggestLanguage: 'zh' }, { sessionId: SID })
  const system = llm.calls[0].system
  assert.match(system, /write the message in Simplified Chinese regardless/)
  // The loudest, final instruction carries the same prefix exception as the
  // rules above — "the entire message in Simplified Chinese" alone would
  // license translating the `feat(scope):` prefix too.
  const overrideAt = system.indexOf('IMPORTANT: the diff and commitStyleSamples')
  assert.notEqual(overrideAt, -1)
  const override = system.slice(overrideAt)
  assert.match(override, /Write the subject description and body in Simplified Chinese/)
  assert.match(override, /keeping the conventional-commit type prefix in English/)
  assert.equal(override.includes('\n'), false, 'the override stays the final line')
})

test('prompt never tells the model to copy the samples language', async () => {
  for (const language of ['auto', 'zh', 'en']) {
    const llm = stubLlm(OK_CHUNKS)
    const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
    await runSuggest(deps, { ...DEFAULT_CONFIG, suggestLanguage: language }, { sessionId: SID })
    const system = llm.calls[0].system
    // The old wording — "Follow the repository's existing commit style as shown
    // by commitStyleSamples: its phrasing, scope conventions and level of
    // detail." — was read as a licence to copy the samples' language too.
    assert.doesNotMatch(system, /follow the repository\u2019s existing commit style/i)
    // The samples rule that survives is the scoped one, and the sentence that
    // scopes it carries no "copy the language" reading.
    assert.match(system, /Follow the structure of commitStyleSamples/)
    assert.match(system, /never copy the language used in it/)
  }
})

for (const [setting, historyLanguage, target] of [
  ['en', 'zh', 'English'],
  ['zh', 'en', 'Simplified Chinese'],
  ['auto', 'zh', 'Simplified Chinese'],
  ['auto', 'en', 'English'],
]) {
  test(`language: ${setting} with ${historyLanguage} history repeats ${target} after truncated data`, async () => {
    const llm = stubLlm(OK_CHUNKS)
    const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
    const run = deps.run
    deps.run = { run: (argv, opts) => argv[1] === 'log'
      ? Promise.resolve({ exitCode: 0, stdout: `t@t.co\u001f${historyLanguage === 'zh' ? 'feat: 中文历史' : 'feat: English history'}\0`, stderr: '', timedOut: false, cancelled: false, stdoutLossy: false })
      : run.run(argv, opts) }
    const result = await runSuggest(deps, {
      ...DEFAULT_CONFIG, suggestLanguage: setting, suggestMaxBytes: 24,
    }, { sessionId: SID, paths: ['b.ts'] })
    assert.equal(result.ok, true)
    assert.equal(result.value.truncated, true)
    const options = llm.calls[0]
    const content = options.messages.at(-1).content
    assert.match(JSON.parse(content[0].text).diff, /\[diff truncated\]/)
    assert.ok(content.length > 1, 'the model needs a language instruction after the repository data')
    const instruction = content.at(-1).text
    assert.ok(instruction.includes(`Write the commit message in ${target}.`))
    assert.ok(instruction.includes(`subject line and body must be ${target}`))
    assert.ok(options.system.includes(`write the message in ${target} regardless`))
    if (target === 'Simplified Chinese') assert.match(instruction, /conventional-commit type prefix in English/)
  })
}

test('paths filter restricts both the file list and the diff', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID, paths: ['new.txt'] })
  assert.equal(res.ok, true)
  const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
  assert.deepEqual(frame.files, [{ path: 'new.txt', status: 'untracked' }])
  // `git diff HEAD` misses untracked paths; the fold-in supplies their content.
  assert.match(frame.diff, /brand new/)
  assert.doesNotMatch(frame.diff, /changed line/)
  assert.equal(res.ok && res.value.message.length > 0, true)
})

test('a selected file inside an untracked directory reaches the model (issue #41)', async () => {
  // The changes page now lists untracked files individually, so it selects
  // `newdir/a.txt`; suggest's own status must use the same file-level form or
  // the exact-path filter finds nothing and reports a bogus empty-diff.
  const dir = mkdtempSync(join(tmpdir(), 'gp-suggest-undir-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    writeFileSync(join(dir, 'root.txt'), 'root\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'init'])
    mkdirSync(join(dir, 'newdir'))
    writeFileSync(join(dir, 'newdir', 'a.txt'), 'brand new in dir\n')
    writeFileSync(join(dir, 'newdir', 'b.txt'), 'unselected sibling\n')
    writeFileSync(join(dir, 'newdir', 'a.txt.bak'), 'unselected filename prefix\n')
    const llm = stubLlm(OK_CHUNKS)
    const deps = depsFor(dir, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
    const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID, paths: ['newdir/a.txt'] })
    assert.equal(res.ok, true, 'selecting a file inside an untracked directory is not an empty diff')
    const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
    assert.deepEqual(frame.files, [{ path: 'newdir/a.txt', status: 'untracked' }])
    assert.match(frame.diff, /brand new in dir/)
    assert.doesNotMatch(frame.diff, /unselected sibling|unselected filename prefix/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const withTracked of [false, true]) {
  test(`a collapsed untracked directory selection includes descendants${withTracked ? ' alongside a tracked selection' : ''}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-suggest-collapsed-'))
    try {
      await runGit(dir, ['init', '-q'])
      await runGit(dir, ['config', 'user.email', 't@t.co'])
      await runGit(dir, ['config', 'user.name', 'Tester'])
      writeFileSync(join(dir, 'root.txt'), 'root\n')
      await runGit(dir, ['add', '.'])
      await runGit(dir, ['commit', '-qm', 'init'])
      mkdirSync(join(dir, 'newdir', 'nested'), { recursive: true })
      const contents = new Map([
        ['newdir/a.txt', 'new directory first file'],
        ['newdir/b.txt', 'new directory second file'],
        ['newdir/c.txt', 'new directory third file'],
        ['newdir/nested/d.txt', 'new directory nested file'],
      ])
      for (const [path, content] of contents) writeFileSync(join(dir, path), `${content}\n`)
      mkdirSync(join(dir, 'newdir-other'))
      writeFileSync(join(dir, 'newdir-other', 'excluded.txt'), 'unrelated sibling content\n')
      if (withTracked) writeFileSync(join(dir, 'root.txt'), 'selected tracked change\n')

      const llm = stubLlm(OK_CHUNKS)
      const deps = depsFor(dir, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
      const config = { ...DEFAULT_CONFIG, maxChanges: 3 }
      const snapshot = await snapshotForSession(deps, config, SID)
      assert.equal(snapshot.ok, true)
      assert.equal(snapshot.value.untrackedCollapsed, true)
      assert.equal(snapshot.value.truncated, false)
      const collapsed = snapshot.value.changes.find((c) => c.path === 'newdir')
      assert.ok(collapsed, 'select the directory row returned by the real snapshot fallback')
      assert.equal(collapsed.status, 'untracked')
      assert.equal(collapsed.isDirectory, true)
      const selected = [collapsed.path]
      if (withTracked) {
        const tracked = snapshot.value.changes.find((c) => c.path === 'root.txt')
        assert.ok(tracked)
        selected.push(tracked.path)
      }

      const res = await runSuggest(deps, config, { sessionId: SID, paths: selected })
      assert.equal(res.ok, true, 'a collapsed selection must not become an empty diff')
      const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
      const expected = [...contents.keys()].map((path) => ({ path, status: 'untracked' }))
      if (withTracked) expected.push({ path: 'root.txt', status: 'modified' })
      assert.deepEqual(frame.files.sort((a, b) => a.path.localeCompare(b.path)), expected.sort((a, b) => a.path.localeCompare(b.path)))
      for (const content of contents.values()) assert.ok(frame.diff.includes(content), `missing untracked content: ${content}`)
      if (withTracked) assert.match(frame.diff, /selected tracked change/)
      assert.doesNotMatch(frame.diff, /newdir-other|unrelated sibling content/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('unsafe path in the request is rejected', async () => {
  const llm = stubLlm([])
  const deps = depsFor(repo, { getLlm: () => llm })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID, paths: ['../evil.txt'] })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'invalid-path')
})

test('unborn repo: diff comes from index + worktree, untracked content folded', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(unborn, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, true)
  const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
  assert.deepEqual(frame.files, [{ path: 'x.txt', status: 'untracked' }])
  assert.match(frame.diff, /hello/)
  // `git log` exits 128 here (no commits yet) — the sampling has to degrade to
  // "no history" rather than failing the endpoint.
  assert.equal(frame.commitStyleSamples, null)
  assert.match(llm.calls[0].system, /Write the message in English\./)
})

test('no uncommitted changes reports empty-diff', async () => {
  const clean = mkdtempSync(join(tmpdir(), 'gp-suggest-clean-'))
  try {
    await runGit(clean, ['init', '-q'])
    const llm = stubLlm([])
    const deps = depsFor(clean, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
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
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const config = { ...DEFAULT_CONFIG, suggestMaxBytes: 64 }
  const res = await runSuggest(deps, config, { sessionId: SID })
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.value.truncated, true)
  const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
  assert.match(frame.diff, /diff truncated/)
  assert.ok(Buffer.byteLength(frame.diff, 'utf8') <= 64 + '\n... [diff truncated]'.length)
})

test('runner stdout-cap truncation is flagged as truncated, not silently dropped', async () => {
  // The diff overruns the runner's per-command stdout cap (profile `maxBytes`
  // below the diff size) while fitting the model-input budget: the suggestion
  // must carry truncated=true, not pass the cut diff off as whole. The cap
  // stays above the workspace-resolution outputs (`rev-parse --show-toplevel`
  // is the longest) so only the diff is lossy.
  const cappedRepo = mkdtempSync(join(tmpdir(), 'gp-suggest-cap-'))
  try {
    await runGit(cappedRepo, ['init', '-q'])
    await runGit(cappedRepo, ['config', 'user.email', 't@t.co'])
    await runGit(cappedRepo, ['config', 'user.name', 'Tester'])
    writeFileSync(join(cappedRepo, 'big.txt'), Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n')
    await runGit(cappedRepo, ['add', 'big.txt'])
    await runGit(cappedRepo, ['commit', '-qm', 'feat: add big.txt'])
    // ~2 KB of diff: comfortably over the 512-byte cap below.
    writeFileSync(join(cappedRepo, 'big.txt'), Array.from({ length: 200 }, (_, i) => i < 100 ? `changed ${i}` : `line ${i}`).join('\n') + '\n')
    const llm = stubLlm(OK_CHUNKS)
    const capped = depsFor(cappedRepo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
    capped.run = createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, 512)
    const res = await runSuggest(capped, DEFAULT_CONFIG, { sessionId: SID })
    assert.equal(res.ok, true)
    if (res.ok) assert.equal(res.value.truncated, true)
  } finally {
    rmSync(cappedRepo, { recursive: true, force: true })
  }
})

test('lossy untracked-file diff is flagged as truncated too', async () => {
  // `git diff HEAD` never carries untracked files; their content is folded in
  // by appendUntracked via per-file `--no-index` runs. A lossy runner read
  // there keeps only the tail — the file's diff header and opening hunks are
  // gone — so the suggestion must carry truncated=true instead of passing the
  // cut file off as whole (the tracked diff alone is empty, so nothing else
  // flags it).
  const cappedRepo = mkdtempSync(join(tmpdir(), 'gp-suggest-cap-untracked-'))
  try {
    await runGit(cappedRepo, ['init', '-q'])
    await runGit(cappedRepo, ['config', 'user.email', 't@t.co'])
    await runGit(cappedRepo, ['config', 'user.name', 'Tester'])
    await runGit(cappedRepo, ['commit', '--allow-empty', '-qm', 'init: empty'])
    // ~3 KB of new-file content: comfortably over the 512-byte cap below.
    writeFileSync(join(cappedRepo, 'new.txt'), Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n')
    const llm = stubLlm(OK_CHUNKS)
    const capped = depsFor(cappedRepo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
    capped.run = createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, 512)
    const res = await runSuggest(capped, DEFAULT_CONFIG, { sessionId: SID })
    assert.equal(res.ok, true)
    if (res.ok) assert.equal(res.value.truncated, true)
  } finally {
    rmSync(cappedRepo, { recursive: true, force: true })
  }
})

test('finish error maps to llm-error with the provider message, even with partial text', async () => {
  // The real chunk envelope is { type:'finish', reason:{ kind, failure } }; a
  // half-streamed message must NOT come back as success (review regression).
  const llm = stubLlm([
    { type: 'text-delta', index: 0, text: 'half a message' },
    { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'quota exceeded' } } },
  ])
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'llm-error')
    assert.match(res.error.message ?? '', /quota exceeded/)
  }
})

test('aborted finish maps to llm-error', async () => {
  const llm = stubLlm([
    { type: 'text-delta', index: 0, text: 'partial' },
    { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'stream aborted' } } },
  ])
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'llm-error')
    assert.match(res.error.message ?? '', /stream aborted/)
  }
})

test('max-tokens finish maps to llm-output even when partial text arrived', async () => {
  // Truncated output must not be returned as a complete message (review case).
  const llm = stubLlm([
    { type: 'text-delta', index: 0, text: 'feat: a message cut off mid-sen' },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  ])
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'llm-output')
    assert.match(res.error.message ?? '', /token limit/)
  }
})

test('empty model output maps to llm-output', async () => {
  const llm = stubLlm([{ type: 'text-delta', index: 0, text: '   ' }, { type: 'finish', reason: { kind: 'stop' } }])
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'llm-output')
})

test('code-fence wrapper is stripped from the message', async () => {
  const llm = stubLlm([
    { type: 'text-delta', index: 0, text: '```\nfeat: wrapped in fences\n```' },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.value.message, 'feat: wrapped in fences')
})

test('suggestEnabled=false refuses at the host gate without calling anything', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const config = { ...DEFAULT_CONFIG, suggestEnabled: false }
  const res = await runSuggest(deps, config, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'suggest-disabled')
  assert.equal(llm.calls.length, 0)
})

test('language: zh pins the system prompt regardless of history', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  await runSuggest(deps, { ...DEFAULT_CONFIG, suggestLanguage: 'zh' }, { sessionId: SID })
  assert.match(llm.calls[0].system, /Write the message in Simplified Chinese/)
  // The conventional-commit type prefix stays English even in Chinese mode.
  assert.match(llm.calls[0].system, /conventional-commit type prefix in English/)
  assert.doesNotMatch(llm.calls[0].system, /Write the message in English\./)
})

test('language: auto follows a Chinese-written history', async () => {
  // The fixture repo is English-written; a Chinese run must outvote it by
  // recency, which is the whole point of decaying the vote.
  const subjects = ['feat: 新增中文说明', 'fix: 修复按钮样式', 'docs: 补充使用说明']
  for (const subject of subjects) await runGit(repo, ['commit', '--allow-empty', '-qm', subject])
  try {
    const llm = stubLlm(OK_CHUNKS)
    const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
    await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
    assert.match(llm.calls[0].system, /Write the message in Simplified Chinese/)
  } finally {
    await runGit(repo, ['reset', '--hard', `HEAD~${subjects.length}`])
  }
})

test('language: resolveSuggestLanguage votes with recency over samples', () => {
  // A repository that switched to Chinese: the recent run is what it writes now.
  assert.equal(resolveSuggestLanguage('auto', ['feat: 甲', 'feat: 乙', 'feat: 丙', 'feat: add a', 'feat: add b']), 'zh')
  // An older language cannot outvote a recent run; decay weighs by position.
  assert.equal(resolveSuggestLanguage('auto', ['docs: 中文', 'feat: a', 'feat: b', 'feat: c']), 'en')
  // Explicit settings win outright, whatever the history says.
  assert.equal(resolveSuggestLanguage('zh', ['feat: plain english']), 'zh')
  assert.equal(resolveSuggestLanguage('en', ['feat: 全中文']), 'en')
  // No history at all (unborn repository) → the neutral fallback.
  assert.equal(resolveSuggestLanguage('auto', []), 'en')
})

test('language: parseStyleHistory drops mechanical commits and prefers the author', () => {
  const SEP = '\u001f'
  const NUL = '\u0000'
  const rec = (email, subject) => `${email}${SEP}${subject}`
  const mixed = [
    rec('me@x.co', 'chore: release v1.2.3'),
    rec('me@x.co', 'Merge pull request #8 from a/b'),
    rec('me@x.co', 'Merged in feature/x (pull request #12)'),
    rec('me@x.co', 'Revert "feat: x"'),
    rec('me@x.co', 'fixup! feat: x'),
    rec('me@x.co', 'feat: 新增按钮'),
  ].join(NUL)
  // Releases / merges / reverts are machine-written and 100% English even in a
  // Chinese repository — counting them would flip the verdict.
  assert.deepEqual(parseStyleHistory(mixed, 'me@x.co'), ['feat: 新增按钮'])
  assert.equal(isCjkText('feat: 新增按钮'), true)
  assert.equal(isCjkText('feat: add a button'), false)
  // Own-author commits win once there are enough of them to speak for the repo.
  const shared = [
    rec('other@x.co', 'feat: add a'), rec('other@x.co', 'fix: b'), rec('other@x.co', 'docs: c'),
    rec('me@x.co', 'feat: 甲'), rec('me@x.co', 'fix: 乙'), rec('me@x.co', 'docs: 丙'),
  ].join(NUL)
  assert.deepEqual(parseStyleHistory(shared, 'me@x.co'), ['feat: 甲', 'fix: 乙', 'docs: 丙'])
  // Too few own commits → fall back to everyone (a shared checkout). Only the
  // mechanical commit is dropped here, so all three survive.
  const thin = [rec('other@x.co', 'feat: add a'), rec('other@x.co', 'fix: b'), rec('me@x.co', 'docs: mine')].join(NUL)
  assert.deepEqual(parseStyleHistory(thin, 'me@x.co'), ['feat: add a', 'fix: b', 'docs: mine'])
  // Unknown identity → no bias at all.
  assert.equal(parseStyleHistory(shared, undefined).length, 6)
})

test('language: parseStyleHistory bounds each sample so samples cannot crowd out the diff', () => {
  const SEP = '\u001f'
  const long = 'x'.repeat(5000)
  const stdout = [
    `me@x.co${SEP}${long}`,
    `me@x.co${SEP}feat: 短`,
    `me@x.co${SEP}fix: 也短`,
  ].join('\u0000')

  const samples = parseStyleHistory(stdout, 'me@x.co')
  // The count cap is not enough on its own: git allows an arbitrarily long
  // subject, and a bot-written one would otherwise eat the whole input budget.
  assert.equal(samples[0].length, 200)
  assert.deepEqual(samples.slice(1), ['feat: 短', 'fix: 也短'])
  assert.equal(samples.length, 3)

  // Truncation counts code points, so a surrogate pair is never halved into a
  // lone surrogate (which JSON.stringify would emit as a broken escape).
  const emoji = '\u{1F600}'.repeat(300)
  const astral = parseStyleHistory(`me@x.co${SEP}${emoji}`, 'me@x.co')
  assert.equal(Array.from(astral[0]).length, 200)
  assert.equal(astral[0].includes('\uFFFD'), false)
  // Well-formed rather than merely "ends with an emoji": a half-sliced pair
  // would survive JSON.stringify as a lone surrogate but not round-trip.
  assert.equal(JSON.parse(JSON.stringify(astral[0])), astral[0])
  assert.equal(astral[0].isWellFormed(), true)
})

test('missing llm service reports llm-unavailable without calling anything', async () => {
  const deps = depsFor(repo) // no getLlm, no getAgentDefaultModel
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.error.code, 'llm-unavailable')
})

test('config provider/model override beats the agent default route', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute('agent-p', 'agent-m') })
  const config = { ...DEFAULT_CONFIG, suggestProvider: 'cfg-p', suggestModel: 'cfg-m' }
  await runSuggest(deps, config, { sessionId: SID })
  assert.equal(llm.calls[0].provider, 'cfg-p')
  assert.equal(llm.calls[0].model, 'cfg-m')
  assert.equal('reasoningEffort' in llm.calls[0], false, 'no effort key when unset')
})

test('the session model selection beats the agent default route', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, {
    getLlm: () => llm,
    getAgentDefaultModel: () => defaultRoute('agent-p', 'agent-m'),
    getSessionModel: sessionRoute('sess-p', 'sess-m'),
  })
  await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(llm.calls[0].provider, 'sess-p')
  assert.equal(llm.calls[0].model, 'sess-m')
  assert.equal('reasoningEffort' in llm.calls[0], false, 'session without effort sends none')
})

test('the session model selection carries its reasoningEffort', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, {
    getLlm: () => llm,
    getSessionModel: sessionRoute('sess-p', 'sess-m', 'high'),
  })
  const res = await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(llm.calls[0].reasoningEffort, 'high')
  if (res.ok) assert.equal(res.value.reasoningEffort, 'high')
})

test('config override still beats the session model selection', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, {
    getLlm: () => llm,
    getSessionModel: sessionRoute('sess-p', 'sess-m', 'low'),
  })
  const config = { ...DEFAULT_CONFIG, suggestProvider: 'cfg-p', suggestModel: 'cfg-m' }
  await runSuggest(deps, config, { sessionId: SID })
  assert.equal(llm.calls[0].provider, 'cfg-p')
  assert.equal(llm.calls[0].model, 'cfg-m')
  assert.equal('reasoningEffort' in llm.calls[0], false, 'config without effort sends none, not the session effort')
})

test('falls back to the agent default when the session has no selection', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, {
    getLlm: () => llm,
    getAgentDefaultModel: () => defaultRoute('agent-p', 'agent-m'),
    getSessionModel: () => undefined,
  })
  await runSuggest(deps, DEFAULT_CONFIG, { sessionId: SID })
  assert.equal(llm.calls[0].provider, 'agent-p')
  assert.equal(llm.calls[0].model, 'agent-m')
})

test('a fixed route with an effort sends reasoningEffort', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const config = { ...DEFAULT_CONFIG, suggestProvider: 'cfg-p', suggestModel: 'cfg-m', suggestReasoningEffort: 'high' }
  const res = await runSuggest(deps, config, { sessionId: SID })
  assert.equal(llm.calls[0].reasoningEffort, 'high')
  if (res.ok) assert.equal(res.value.reasoningEffort, 'high')
})

test('the agent-default route never sends an effort, even if config has one', async () => {
  const llm = stubLlm(OK_CHUNKS)
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute('agent-p', 'agent-m') })
  // Unpaired provider with an effort: normalizeConfig drops the whole route;
  // resolveRoute also never attaches effort on the agent-default path.
  const config = normalizeConfig({ suggestReasoningEffort: 'high' })
  await runSuggest(deps, config, { sessionId: SID })
  assert.equal(llm.calls[0].provider, 'agent-p')
  assert.equal('reasoningEffort' in llm.calls[0], false)
})

test('normalizeConfig keeps effort only on a complete provider/model pair', () => {
  const pair = normalizeConfig({ suggestProvider: 'p', suggestModel: 'm', suggestReasoningEffort: 'low' })
  assert.equal(pair.suggestProvider, 'p')
  assert.equal(pair.suggestModel, 'm')
  assert.equal(pair.suggestReasoningEffort, 'low')
  // Lone provider + effort: whole route dropped, no residual effort.
  const lone = normalizeConfig({ suggestProvider: 'p', suggestReasoningEffort: 'low' })
  assert.equal(lone.suggestProvider, undefined)
  assert.equal(lone.suggestModel, undefined)
  assert.equal(lone.suggestReasoningEffort, undefined)
  // Empty effort on a pair is normalized to absent (omit from the request).
  const blank = normalizeConfig({ suggestProvider: 'p', suggestModel: 'm', suggestReasoningEffort: '' })
  assert.equal(blank.suggestProvider, 'p')
  assert.equal(blank.suggestReasoningEffort, undefined)
})

test('normalizeConfig unwraps volatile refs for the fixed model route', () => {
  // cordis resolveConfig wraps every .volatile() field in a { get() } ref —
  // without unwrapping, the pair check fails and suggest silently uses the
  // session model instead of the configured override.
  const vol = normalizeConfig({
    suggestProvider: { get: () => 'vp' },
    suggestModel: { get: () => 'vm' },
    suggestReasoningEffort: { get: () => 'high' },
  })
  assert.equal(vol.suggestProvider, 'vp')
  assert.equal(vol.suggestModel, 'vm')
  assert.equal(vol.suggestReasoningEffort, 'high')
  // Empty volatile string is still "absent".
  const empty = normalizeConfig({
    suggestProvider: { get: () => 'vp' },
    suggestModel: { get: () => '' },
    suggestReasoningEffort: { get: () => 'low' },
  })
  assert.equal(empty.suggestProvider, undefined)
  assert.equal(empty.suggestModel, undefined)
  assert.equal(empty.suggestReasoningEffort, undefined)
})

test('timeout: a stream that never finishes maps to llm-error', async () => {
  const llm = stubLlm([], { onSignalAbort: true, streamError: new Error('aborted by signal') })
  const deps = depsFor(repo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
  const config = { ...DEFAULT_CONFIG, suggestTimeoutMs: 60 }
  const res = await runSuggest(deps, config, { sessionId: SID })
  assert.equal(res.ok, false)
  if (!res.ok) {
    assert.equal(res.error.code, 'llm-error')
    assert.match(res.error.message ?? '', /timed out/)
  }
})

test('suggest defaults: 200 KiB diff budget, 4096 output tokens, 15 s timeout', () => {
  // The output default mirrors dsh-base session-title-llm (maxOutputTokens
  // 4096): reasoning a model cannot switch off counts against it.
  assert.equal(DEFAULT_CONFIG.suggestMaxBytes, 200 * 1024)
  assert.equal(DEFAULT_CONFIG.suggestMaxOutputTokens, 4096)
  assert.equal(DEFAULT_CONFIG.suggestTimeoutMs, 15000)
})

test('normalizeConfig clamps suggest limits to their ranges', () => {
  const base = normalizeConfig({})
  assert.equal(base.suggestMaxBytes, 200 * 1024)
  assert.equal(base.suggestMaxOutputTokens, 4096)
  assert.equal(base.suggestTimeoutMs, 15000)
  // Legal but out-of-range values clamp to the boundary (a typed 999999
  // becomes 512 KiB instead of silently falling back to the default).
  assert.equal(normalizeConfig({ suggestMaxBytes: 8 * 1024 }).suggestMaxBytes, 16 * 1024)
  assert.equal(normalizeConfig({ suggestMaxBytes: 4 * 1024 * 1024 }).suggestMaxBytes, 512 * 1024)
  assert.equal(normalizeConfig({ suggestMaxOutputTokens: 10 }).suggestMaxOutputTokens, 256)
  assert.equal(normalizeConfig({ suggestMaxOutputTokens: 999999 }).suggestMaxOutputTokens, 16384)
  assert.equal(normalizeConfig({ suggestTimeoutMs: 100 }).suggestTimeoutMs, 5000)
  assert.equal(normalizeConfig({ suggestTimeoutMs: 9999999 }).suggestTimeoutMs, 120000)
  // Fractional floors; non-numeric falls back to the default.
  assert.equal(normalizeConfig({ suggestMaxOutputTokens: 2048.9 }).suggestMaxOutputTokens, 2048)
  assert.equal(normalizeConfig({ suggestMaxBytes: 'bogus' }).suggestMaxBytes, 200 * 1024)
  assert.equal(normalizeConfig({ suggestTimeoutMs: null }).suggestTimeoutMs, 15000)
  // In-range values pass through untouched.
  const kept = normalizeConfig({ suggestMaxBytes: 64 * 1024, suggestMaxOutputTokens: 1024, suggestTimeoutMs: 30000 })
  assert.equal(kept.suggestMaxBytes, 64 * 1024)
  assert.equal(kept.suggestMaxOutputTokens, 1024)
  assert.equal(kept.suggestTimeoutMs, 30000)
})

test('normalizeConfig unwraps volatile refs for the suggest limits', () => {
  // cordis resolveConfig wraps every .volatile() field in a { get() } ref —
  // the shape rawConfig actually carries in production. Without the unwrap
  // (readBool's unwrapVolatile), a live-edited value silently falls back to
  // the default while the settings form echoes the written value.
  assert.equal(normalizeConfig({ suggestMaxBytes: { get: () => 98304 } }).suggestMaxBytes, 98304)
  assert.equal(normalizeConfig({ suggestMaxOutputTokens: { get: () => 2048 } }).suggestMaxOutputTokens, 2048)
  assert.equal(normalizeConfig({ suggestTimeoutMs: { get: () => 45000 } }).suggestTimeoutMs, 45000)
  // The unwrap runs before the range check: a ref to an out-of-range value
  // clamps to the boundary rather than falling back to the default.
  assert.equal(normalizeConfig({ suggestMaxBytes: { get: () => 4 * 1024 * 1024 } }).suggestMaxBytes, 512 * 1024)
  // A ref yielding a non-number still falls back to the default.
  assert.equal(normalizeConfig({ suggestMaxOutputTokens: { get: () => 'nope' } }).suggestMaxOutputTokens, 4096)
})

test('normalizeConfig reads the suggest language, unwrapping volatile refs', () => {
  assert.equal(DEFAULT_CONFIG.suggestLanguage, 'auto')
  assert.deepEqual([...SUGGEST_LANGUAGES], ['auto', 'zh', 'en'])
  assert.equal(normalizeConfig({}).suggestLanguage, 'auto')
  assert.equal(normalizeConfig({ suggestLanguage: 'zh' }).suggestLanguage, 'zh')
  assert.equal(normalizeConfig({ suggestLanguage: 'en' }).suggestLanguage, 'en')
  // resolveConfig wraps every .volatile() field in a `{ get() }` ref.
  assert.equal(normalizeConfig({ suggestLanguage: { get: () => 'zh' } }).suggestLanguage, 'zh')
  // An unknown value (hand-edited profile, or one from a newer version) falls
  // back to the default rather than reaching the prompt.
  assert.equal(normalizeConfig({ suggestLanguage: 'fr' }).suggestLanguage, 'auto')
  assert.equal(normalizeConfig({ suggestLanguage: 42 }).suggestLanguage, 'auto')
  assert.equal(normalizeConfig({ suggestLanguage: null }).suggestLanguage, 'auto')
})

test('suggest limit display units divide exactly', () => {
  // The client form derives its display units (KiB / seconds) from these
  // host-unit constants; a non-multiple would make the derived range disagree
  // with what normalizeConfig enforces.
  assert.equal(SUGGEST_LIMITS.maxBytes.min % 1024, 0)
  assert.equal(SUGGEST_LIMITS.maxBytes.max % 1024, 0)
  assert.equal(SUGGEST_LIMITS.timeoutMs.min % 1000, 0)
  assert.equal(SUGGEST_LIMITS.timeoutMs.max % 1000, 0)
})

test('compactLongLines folds minified lines but keeps the diff skeleton', () => {
  const input = [
    'diff --git a/lib/client.js b/lib/client.js',
    '@@ -1 +1 @@',
    '+const x=1',
    '+' + 'y'.repeat(5000),
    '-short',
    ' context',
  ].join('\n') + '\n'
  const out = compactLongLines(input)
  const lines = out.text.split('\n')
  assert.equal(out.folded, 1)
  assert.equal(lines.length, input.split('\n').length, 'line count is preserved')
  assert.equal(lines[2], '+const x=1')
  assert.equal(lines[3], '+\u2026 [long line: 5001 chars omitted]')
  assert.equal(lines[4], '-short')
  assert.equal(compactLongLines('a\nb').folded, 0)
  assert.equal(compactLongLines('x'.repeat(LONG_LINE_MAX_CHARS)).folded, 0, 'a line at the cap is left alone')
  const cjk = compactLongLines('+' + '中'.repeat(LONG_LINE_MAX_CHARS))
  assert.equal(cjk.folded, 1, 'wide characters count by character, not byte')
  assert.match(cjk.text, /^\+\u2026 \[long line: 401 chars omitted\]$/)
  // Structural lines stay byte-exact: folding them would erase the hunk
  // coordinates / file identity the model needs to place the change.
  const hunk = '@@ -1,3 +1,3 @@ ' + 'f'.repeat(500)
  const header = `diff --git a/${'p'.repeat(500)} b/${'p'.repeat(500)}`
  const structural = compactLongLines(`${hunk}\n${header}\n+${'x'.repeat(500)}`)
  assert.equal(structural.folded, 1, 'only the content line folds')
  assert.equal(structural.text.split('\n')[0], hunk)
  assert.equal(structural.text.split('\n')[1], header)
})

test('long minified lines are folded before the budget instead of truncated out', async () => {
  const longRepo = mkdtempSync(join(tmpdir(), 'gp-suggest-long-'))
  try {
    await runGit(longRepo, ['init', '-q'])
    await runGit(longRepo, ['config', 'user.email', 't@t.co'])
    await runGit(longRepo, ['config', 'user.name', 'Tester'])
    writeFileSync(join(longRepo, 'lib.js'), 'export const x = 1\n')
    await runGit(longRepo, ['add', 'lib.js'])
    await runGit(longRepo, ['commit', '-qm', 'feat: add lib.js'])
    // The build rewrites the bundle as one enormous line.
    writeFileSync(join(longRepo, 'lib.js'), 'export const x=1;' + 'y'.repeat(5000) + '\n')
    // An untracked file with a long line is folded the same way.
    writeFileSync(join(longRepo, 'bundle.min.js'), 'z'.repeat(4000) + '\n')
    const llm = stubLlm(OK_CHUNKS)
    const deps = depsFor(longRepo, { getLlm: () => llm, getAgentDefaultModel: () => defaultRoute() })
    // A real budget (1 KiB) keeps the ordering under test: if truncation ran
    // before folding, the 9 KB of minified lines would leave only a header and
    // `truncated` would be set. The folded prompt fits with room for the
    // untracked chunk, so every marker below must survive.
    const res = await runSuggest(deps, { ...DEFAULT_CONFIG, suggestMaxBytes: 1024 }, { sessionId: SID })
    assert.equal(res.ok, true)
    if (!res.ok) return
    assert.equal(res.value.truncated, undefined, 'folding is not a budget truncation')
    const frame = JSON.parse(llm.calls[0].messages[0].content[0].text)
    assert.doesNotMatch(frame.diff, /\[diff truncated\]/, 'the folded diff fits the budget')
    assert.match(frame.diff, /\+\u2026 \[long line: \d+ chars omitted\]/)
    assert.match(frame.diff, /\+\u2026 \[long line: \d+ chars omitted\][\s\S]*\+\u2026 \[long line: \d+ chars omitted\]/)
    assert.doesNotMatch(frame.diff, /y{1000}/)
    assert.doesNotMatch(frame.diff, /z{1000}/)
    assert.ok(frame.diff.length < 5000, 'the prompt diff stays small')
  } finally {
    rmSync(longRepo, { recursive: true, force: true })
  }
})
