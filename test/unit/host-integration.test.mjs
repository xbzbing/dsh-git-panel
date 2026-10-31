/**
 * Host integration test: drives the real host endpoints against a throwaway
 * git repository created in a temp dir, using a Node child_process-backed
 * subprocess stand-in that matches the SubprocessLike face.
 *
 * Covers snapshot, worktree-stats, history (graph + refs), branches, diff
 * (tracked + untracked), show, last-commit-message, and a stage→commit round
 * trip. No dsh server is started; nothing outside the temp dir is touched.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn as nodeSpawn, execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { snapshotForSession, runAction, runQuery, createGitRunner, planAction, DEFAULT_CONFIG, normalizeConfig } from '../../lib/host/index.js'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import { DIFF_CONTEXT_DEFAULT, DIFF_CONTEXT_MAX, DIFF_EXPAND_CONTEXT, DIFF_COUNT_READ_MAX, FILE_COPY_MAX_BYTES, MAX_BYTES_LIMITS } from '../../lib/host/types.js'

let repo
let repoImg
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

function depsAt(dir) {
  return {
    run: createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes),
    // The production wiring itself, never a mirror: identical wiring is what
    // makes these tests evidence about the host rather than about a copy.
    fs: createFsDeps(),
    sessions: { liveCwd: () => dir, persistedMeta: async () => undefined },
  }
}

function deps() {
  return depsAt(repo)
}

before(async () => {
  repo = mkdtempSync(join(tmpdir(), 'gp-it-'))
  await runGit(repo, ['init', '-q'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'init: first commit'])
  // one committed file with many lines, then modify a middle line + add an
  // untracked file. The long committed body lets the diff-context test show
  // the effect of expand-all (default 3 context lines vs the whole file).
  const { writeFileSync } = await import('node:fs')
  const base = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n') + '\n'
  writeFileSync(join(repo, 'a.txt'), base)
  await runGit(repo, ['add', 'a.txt'])
  await runGit(repo, ['commit', '-qm', 'feat: add a'])
  writeFileSync(join(repo, 'a.txt'), base.replace('line10', 'line10-changed'))
  writeFileSync(join(repo, 'd.txt'), 'new\n')

  // Image fixture repo: committed png (v1) then a worktree edit (v2) and an
  // untracked png, kept separate so its staged counts never leak into the
  // text-diff tests above.
  repoImg = mkdtempSync(join(tmpdir(), 'gp-img-'))
  await runGit(repoImg, ['init', '-q'])
  await runGit(repoImg, ['config', 'user.email', 't@t.co'])
  await runGit(repoImg, ['config', 'user.name', 'Tester'])
  writeFileSync(join(repoImg, 'img.png'), Buffer.from('PNG-v1-bytes'))
  writeFileSync(join(repoImg, 'notes.txt'), 'plain\n')
  // An SVG is served as an image and also carries its markup, so both faces of
  // the preview come from one read; the binary-bodied one proves the markup
  // half is gated on the bytes being text.
  writeFileSync(join(repoImg, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg">\n  <rect width="10" height="10"/>\n</svg>\n')
  writeFileSync(join(repoImg, 'blob.svg'), Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x3e, 0x00, 0x3c, 0x2f, 0x73, 0x76, 0x67, 0x3e]))
  await runGit(repoImg, ['add', '.'])
  await runGit(repoImg, ['commit', '-qm', 'img v1'])
  writeFileSync(join(repoImg, 'img.png'), Buffer.from('PNG-v2-bytes'))
  writeFileSync(join(repoImg, 'img2.png'), Buffer.from('PNG-untracked'))
})

after(() => {
  if (repo) rmSync(repo, { recursive: true, force: true })
  if (repoImg) rmSync(repoImg, { recursive: true, force: true })
})

test('snapshot reports branch, dirty, and the change set', async () => {
  const res = await snapshotForSession(deps(), DEFAULT_CONFIG, SID)
  assert.equal(res.ok, true)
  const s = res.value
  assert.equal(s.dirty, true)
  assert.ok(s.branch === 'main' || s.branch === 'master')
  const paths = s.changes.map((c) => c.path).sort()
  assert.deepEqual(paths, ['a.txt', 'd.txt'])
  assert.equal(s.changes.find((c) => c.path === 'd.txt').status, 'untracked')
  assert.equal(s.showInputPill, true, 'pill preference defaults to shown')
  assert.match(s.stateFingerprint, /^[0-9a-f]{64}$/, 'final snapshot carries a SHA-256 business fingerprint')
})

test('snapshot business fingerprint is stable in a real unchanged repository and tracks preferences', async () => {
  const first = await snapshotForSession(deps(), DEFAULT_CONFIG, SID)
  const second = await snapshotForSession(deps(), DEFAULT_CONFIG, SID)
  const hidden = await snapshotForSession(deps(), { ...DEFAULT_CONFIG, showInputPill: false }, SID)
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(hidden.ok, true)
  assert.match(first.value.stateFingerprint, /^[0-9a-f]{64}$/)
  assert.equal(first.value.stateFingerprint, second.value.stateFingerprint)
  assert.notEqual(first.value.stateFingerprint, hidden.value.stateFingerprint)
})

test('showInputPill config flows into the snapshot and normalizes volatile refs', async () => {
  // Default true; explicit false hides; a schemastery volatile ref is unwrapped.
  assert.equal(normalizeConfig({}).showInputPill, true)
  assert.equal(normalizeConfig({ showInputPill: false }).showInputPill, false)
  assert.equal(normalizeConfig({ showInputPill: { get: () => false } }).showInputPill, false)
  const hidden = await snapshotForSession(deps(), { ...DEFAULT_CONFIG, showInputPill: false }, SID)
  assert.equal(hidden.ok, true)
  assert.equal(hidden.value.showInputPill, false)
})

test('detectCheckouts config flows into the snapshot and normalizes volatile refs', async () => {
  // Default on; explicit off honored; a schemastery volatile ref is unwrapped.
  assert.equal(normalizeConfig({}).detectCheckouts, true)
  assert.equal(normalizeConfig({ detectCheckouts: false }).detectCheckouts, false)
  assert.equal(normalizeConfig({ detectCheckouts: { get: () => false } }).detectCheckouts, false)
  const off = await snapshotForSession(deps(), { ...DEFAULT_CONFIG, detectCheckouts: false }, SID)
  assert.equal(off.ok, true)
  assert.equal(off.value.detectCheckouts, false)
  // The flag is business state: the client re-answers the repository list when
  // it flips, which only a fingerprint change can trigger.
  assert.notEqual(off.value.stateFingerprint, (await snapshotForSession(deps(), DEFAULT_CONFIG, SID)).value.stateFingerprint)
})

test('filesFollowRepo config flows into the snapshot and normalizes volatile refs', async () => {
  // Default off; explicit on honored; a schemastery volatile ref is unwrapped.
  assert.equal(normalizeConfig({}).filesFollowRepo, false)
  assert.equal(normalizeConfig({ filesFollowRepo: true }).filesFollowRepo, true)
  assert.equal(normalizeConfig({ filesFollowRepo: { get: () => true } }).filesFollowRepo, true)
  const base = await snapshotForSession(deps(), DEFAULT_CONFIG, SID)
  assert.equal(base.ok, true)
  assert.equal(base.value.filesFollowRepo, false)
  const on = await snapshotForSession(deps(), { ...DEFAULT_CONFIG, filesFollowRepo: true }, SID)
  assert.equal(on.value.filesFollowRepo, true)
  // A flip re-arms every session's default on the client, which only a
  // fingerprint change delivers.
  assert.notEqual(on.value.stateFingerprint, base.value.stateFingerprint)
})

test('collapseReposOnPick config flows into the snapshot and normalizes volatile refs', async () => {
  // Default off; explicit on honored; a schemastery volatile ref is unwrapped.
  assert.equal(normalizeConfig({}).collapseReposOnPick, false)
  assert.equal(normalizeConfig({ collapseReposOnPick: true }).collapseReposOnPick, true)
  assert.equal(normalizeConfig({ collapseReposOnPick: { get: () => true } }).collapseReposOnPick, true)
  const base = await snapshotForSession(deps(), DEFAULT_CONFIG, SID)
  assert.equal(base.ok, true)
  assert.equal(base.value.collapseReposOnPick, false)
  const on = await snapshotForSession(deps(), { ...DEFAULT_CONFIG, collapseReposOnPick: true }, SID)
  assert.equal(on.value.collapseReposOnPick, true)
})

test('placement config normalizes and unwraps volatile refs', () => {
  // Default all; each known value honored; unknown falls back; volatile ref
  // unwrapped. It is deliberately NOT carried in the snapshot (it is a mount
  // preference, not repo state) — so there is no snapshot assertion here.
  assert.equal(normalizeConfig({}).placement, 'all')
  assert.equal(normalizeConfig({ placement: 'all' }).placement, 'all')
  assert.equal(normalizeConfig({ placement: 'tab' }).placement, 'tab')
  assert.equal(normalizeConfig({ placement: 'sidebar' }).placement, 'sidebar')
  assert.equal(normalizeConfig({ placement: 'nowhere' }).placement, 'all')
  assert.equal(normalizeConfig({ placement: 42 }).placement, 'all')
  assert.equal(normalizeConfig({ placement: { get: () => 'sidebar' } }).placement, 'sidebar')
})

test('maxBytes config clamps into the range shared with the shipped row', () => {
  // The cap doubles as the per-command stdout cap and the image payload cap, so
  // both ends are bounded: a huge value collects that much into the host per
  // command, a tiny one turns every command's output lossy (the panel looks
  // empty). In-range values are kept exactly, and a volatile ref is unwrapped.
  assert.equal(DEFAULT_CONFIG.maxBytes, MAX_BYTES_LIMITS.default)
  assert.equal(normalizeConfig({}).maxBytes, MAX_BYTES_LIMITS.default)
  assert.equal(normalizeConfig({ maxBytes: 8 * 1024 * 1024 }).maxBytes, 8 * 1024 * 1024)
  assert.equal(normalizeConfig({ maxBytes: Number.MAX_SAFE_INTEGER }).maxBytes, MAX_BYTES_LIMITS.max)
  assert.equal(normalizeConfig({ maxBytes: 1 }).maxBytes, MAX_BYTES_LIMITS.min)
  assert.equal(normalizeConfig({ maxBytes: -5 }).maxBytes, MAX_BYTES_LIMITS.min)
  assert.equal(normalizeConfig({ maxBytes: 'big' }).maxBytes, MAX_BYTES_LIMITS.default)
  assert.equal(normalizeConfig({ maxBytes: { get: () => 2 * 1024 * 1024 } }).maxBytes, 2 * 1024 * 1024)
})

test('defaultDiffView config normalizes, unwraps volatile refs, and flows into the snapshot', async () => {
  // Default unified; explicit split honored; unknown falls back; volatile ref unwrapped.
  assert.equal(normalizeConfig({}).defaultDiffView, 'unified')
  assert.equal(normalizeConfig({ defaultDiffView: 'split' }).defaultDiffView, 'split')
  assert.equal(normalizeConfig({ defaultDiffView: 'bogus' }).defaultDiffView, 'unified')
  assert.equal(normalizeConfig({ defaultDiffView: { get: () => 'split' } }).defaultDiffView, 'split')
  const def = await snapshotForSession(deps(), DEFAULT_CONFIG, SID)
  assert.equal(def.ok, true)
  assert.equal(def.value.defaultDiffView, 'unified', 'snapshot carries the default view')
  const split = await snapshotForSession(deps(), { ...DEFAULT_CONFIG, defaultDiffView: 'split' }, SID)
  assert.equal(split.ok, true)
  assert.equal(split.value.defaultDiffView, 'split')
})

test('fontDelta config normalizes, unwraps volatile refs, and flows into the snapshot', async () => {
  // Default 0; explicit 1 honored; unknown falls back; volatile ref unwrapped.
  assert.equal(normalizeConfig({}).fontDelta, 0)
  assert.equal(normalizeConfig({ fontDelta: 1 }).fontDelta, 1)
  assert.equal(normalizeConfig({ fontDelta: -1 }).fontDelta, -1)
  assert.equal(normalizeConfig({ fontDelta: 2 }).fontDelta, 0)
  assert.equal(normalizeConfig({ fontDelta: 'bogus' }).fontDelta, 0)
  assert.equal(normalizeConfig({ fontDelta: { get: () => -1 } }).fontDelta, -1)
  const def = await snapshotForSession(deps(), DEFAULT_CONFIG, SID)
  assert.equal(def.ok, true)
  assert.equal(def.value.fontDelta, 0, 'snapshot carries the default step')
  const larger = await snapshotForSession(deps(), { ...DEFAULT_CONFIG, fontDelta: 1 }, SID)
  assert.equal(larger.ok, true)
  assert.equal(larger.value.fontDelta, 1)
})

test('worktree-stats totals files and +/- lines, plus times', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'worktree-stats' } })
  assert.equal(res.ok, true)
  const st = res.value.stats
  assert.equal(st.fileCount, 2)
  assert.equal(st.untracked, 1)
  assert.ok(st.insertions >= 2, 'a.txt +1 and d.txt +1 at least')
  assert.ok(st.lastChangeAt !== null)
  assert.ok(typeof st.headCommittedAt === 'string')
  assert.equal(st.partial, false, 'a small change set keeps the detailed fan-out')
})

test('history returns commits with parents and refs', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 10, skip: 0 } })
  assert.equal(res.ok, true)
  assert.equal(res.value.kind, 'history')
  assert.ok(res.value.commits.length >= 2)
  const head = res.value.commits[0]
  assert.ok(head.shortHash.length >= 4)
  assert.ok(head.refs.some((r) => r.head), 'HEAD ref is decorated')
})

test('history filtered by a ref that is also a work-tree path', async () => {
  // A tracked directory and a branch sharing one name: without the trailing
  // `--`, `git log <ref>` is fatal ("both revision and filename") and the page
  // came back empty with no error.
  const dir = await freshRepo('gp-ref-path-')
  try {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'observatory'))
    writeFileSync(join(dir, 'observatory', 'pkg.py'), 'x = 1\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'feat: add observatory package'])
    await runGit(dir, ['branch', 'observatory'])
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, {
      sessionId: SID,
      query: { kind: 'history', limit: 5, skip: 0, ref: 'observatory' },
    })
    assert.equal(res.ok, true, JSON.stringify(res.error ?? {}))
    assert.equal(res.value.total, 2, 'the count walk resolves the same ref')
    assert.deepEqual(res.value.commits.map((c) => c.subject), ['feat: add observatory package', 'init'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unfiltered history survives a tracked file named HEAD', async () => {
  // The visible-refs walk ends with the literal HEAD operand, so the same
  // ambiguity hits the default view when a work-tree file is named HEAD.
  const dir = await freshRepo('gp-head-path-')
  try {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'HEAD'), 'not a ref\n')
    await runGit(dir, ['add', 'HEAD'])
    await runGit(dir, ['commit', '-qm', 'chore: add HEAD file'])
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, {
      sessionId: SID,
      query: { kind: 'history', limit: 5, skip: 0 },
    })
    assert.equal(res.ok, true, JSON.stringify(res.error ?? {}))
    assert.equal(res.value.total, 2)
    assert.equal(res.value.commits.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('history surfaces a real ambiguous-argument failure instead of an empty page', async () => {
  // The empty pages are reserved for a hash-jump miss and a genuinely unknown
  // ref; an ambiguity that survives the `--` is a broken query, not a branch
  // without commits.
  const base = deps()
  const runner = {
    run: (argv, opts) => (argv.includes('log') && argv.includes('--end-of-options')
      ? Promise.resolve({
        exitCode: 128,
        stdout: '',
        stderr: "fatal: ambiguous argument 'x': both revision and filename\n",
        timedOut: false,
        cancelled: false,
        stdoutLossy: false,
      })
      : base.run.run(argv, opts)),
  }
  const res = await runQuery({ ...base, run: runner }, DEFAULT_CONFIG, {
    sessionId: SID,
    query: { kind: 'history', limit: 5, skip: 0, ref: 'HEAD' },
  })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'git-error')
  assert.match(res.error.message, /ambiguous argument/)
})

test('branches lists the current branch', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'branches' } })
  assert.equal(res.ok, true)
  assert.ok(res.value.current === 'main' || res.value.current === 'master')
  assert.ok(res.value.local.length >= 1)
})

test('diff renders tracked change and synthesizes untracked via --no-index', async () => {
  const tracked = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'a.txt', base: 'worktree' } })
  assert.equal(tracked.ok, true)
  assert.match(tracked.value.text, /\+line10-changed/)
  const untracked = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'd.txt', base: 'worktree' } })
  assert.equal(untracked.ok, true)
  assert.match(untracked.value.text, /\+new/)
})

test('diff context expansion shows more surrounding unchanged lines', async () => {
  // With default context (3) only a window around line10 shows; expand-all
  // (huge context) includes the far lines (line1 / line20) too.
  const tight = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'a.txt', base: 'worktree' } })
  const wide = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'a.txt', base: 'worktree', context: DIFF_CONTEXT_MAX } })
  assert.equal(tight.ok, true)
  assert.equal(wide.ok, true)
  assert.doesNotMatch(tight.value.text, /^ line1$/m, 'default context omits the first line')
  assert.match(wide.value.text, /^ line1$/m, 'expand-all includes the first line')
  assert.match(wide.value.text, /^ line20$/m, 'expand-all includes the last line')
})

test('diff reports the new-side line count so the trailing gap can be exact', async () => {
  // a.txt has 20 lines, both before and after the worktree edit.
  const tracked = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'a.txt', base: 'worktree' } })
  assert.equal(tracked.value.newLines, 20)
  const untracked = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'd.txt', base: 'worktree' } })
  assert.equal(untracked.value.newLines, 1, 'untracked file counts its working-tree lines')
  // A deleted side has no lines: 0 keeps the view from offering a trailing control.
  const missing = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'nope.txt', base: 'commit', commit: 'HEAD' } })
  assert.equal(missing.value.newLines, 0)
})

test('diff constants are pinned: they drive both halves and the poll cost', () => {
  // DIFF_CONTEXT_DEFAULT is what the host applies when a request omits
  // `context`, DIFF_EXPAND_CONTEXT is what the client asks for on "expand all"
  // (DIFF_CONTEXT_MAX stays the host's clamp ceiling), and DIFF_COUNT_READ_MAX
  // bounds the working-file read that only feeds the count. A silent edit here
  // changes behaviour on both sides, so the magnitudes are asserted (as
  // SUGGEST_LIMITS is).
  assert.equal(DIFF_CONTEXT_DEFAULT, 3, "matches git's own -U default")
  assert.equal(DIFF_CONTEXT_MAX, 100000, 'host clamp ceiling')
  assert.equal(DIFF_EXPAND_CONTEXT, 2000, "client's expand-all request")
  assert.equal(DIFF_COUNT_READ_MAX, 8 * 1024 * 1024)
})

test('the new-side count matches the file\'s real line count in every shape', async () => {
  // The count shares its trailing-newline convention with the slice, and the
  // slice is built by splitting while the count walks newlines: both must agree
  // with `wc -l`-style truth for a trailing newline, none, and trailing blanks.
  const { writeFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'gp-count-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const shapes = [
      { name: 'trailing-nl.txt', committed: 'a\nb\nc\n', working: 'a\nB\nc\n', lines: 3 },
      { name: 'no-trailing-nl.txt', committed: 'a\nb\nc', working: 'a\nB\nc', lines: 3 },
      { name: 'trailing-blanks.txt', committed: 'a\nb\n\n\n', working: 'a\nB\n\n\n', lines: 4 },
      { name: 'single-line.txt', committed: 'only\n', working: 'changed\n', lines: 1 },
    ]
    for (const shape of shapes) {
      writeFileSync(join(dir, shape.name), shape.committed)
    }
    await runGit(dir, ['add', '-A'])
    await runGit(dir, ['commit', '-qm', 'feat: shapes'])
    for (const shape of shapes) writeFileSync(join(dir, shape.name), shape.working)

    const d = depsAt(dir)
    for (const shape of shapes) {
      const diff = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: shape.name, base: 'worktree' } })
      assert.equal(diff.value.newLines, shape.lines, `${shape.name} count`)
      const slice = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: shape.name, base: 'worktree', start: 1, end: shape.lines + 5 } })
      assert.equal(slice.value.lines.length, shape.lines, `${shape.name} slice length agrees with the count`)
      assert.equal(slice.value.eof, true, `${shape.name} slice reaches EOF`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a diff without hunks (binary) reports no trailing count', async () => {
  // No hunk → no gap row can exist → the count cannot matter, so the read is
  // skipped and a binary file reports 0 rather than its number of newline bytes.
  const { writeFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'gp-bin-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const p = join(dir, 'blob.bin')
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a, 0x01]))
    await runGit(dir, ['add', 'blob.bin'])
    await runGit(dir, ['commit', '-qm', 'feat: binary'])
    writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a, 0x1a, 0x0a, 0x02]))

    const bin = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'blob.bin', base: 'worktree' } })
    assert.equal(bin.ok, true)
    assert.match(bin.value.text, /Binary files/)
    assert.equal(bin.value.newLines, 0, 'no hunk needs a count')
    assert.ok(!bin.value.text.includes('@@'), 'and the text really has no hunk')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the count read is capped above DIFF_COUNT_READ_MAX, expansion is not', async () => {
  const { writeFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'gp-big-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const row = 'x'.repeat(15) + '\n'
    const rows = Math.ceil(DIFF_COUNT_READ_MAX / row.length) + 4
    writeFileSync(join(dir, 'big.txt'), row.repeat(rows))
    await runGit(dir, ['add', 'big.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: big'])
    writeFileSync(join(dir, 'big.txt'), 'HEAD-1\n' + row.repeat(rows - 1)) // 1-line change at the top

    const d = depsAt(dir)
    const diff = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'big.txt', base: 'worktree' } })
    assert.equal(diff.ok, true)
    assert.doesNotMatch(diff.value.text, /^ HEAD-1$/m)
    assert.equal(diff.value.newLines, 0, 'above the ceiling the count is unknown')
    const slice = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'big.txt', base: 'worktree', start: 1, end: 2 } })
    assert.deepEqual(slice.value.lines, ['HEAD-1', 'x'.repeat(15)], 'on-demand expansion stays uncapped')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('worktree slices are normalized like the blob git diffs', async () => {
  const { writeFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'gp-crlf-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['config', 'core.autocrlf', 'input'])
    const p = join(dir, 'c.txt')
    writeFileSync(p, 'r1\nr2\nr3\nr4\n')
    await runGit(dir, ['add', 'c.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: crlf'])
    writeFileSync(p, 'r1\r\nr2\r\nr3\r\nCHANGED\r\nr5\r\n') // CRLF worktree, one change

    const d = depsAt(dir)
    const diff = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'c.txt', base: 'worktree' } })
    assert.equal(diff.value.newLines, 5)
    const slice = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'c.txt', base: 'worktree', start: 1, end: 5 } })
    assert.deepEqual(slice.value.lines, ['r1', 'r2', 'r3', 'CHANGED', 'r5'], 'no CR leaks into revealed lines')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('file-lines numbers the worktree slice against the working file, not the index', async () => {
  // Own repo: this test commits a file of its own, and the shared fixture repo
  // must not be left with an extra dirty path for the tests that follow.
  const { writeFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'gp-grow-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const path = join(dir, 'grow.txt')
    writeFileSync(path, 'l1\nl2\nl3\n')
    await runGit(dir, ['add', 'grow.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: grow'])
    writeFileSync(path, 'l1\nl2\nl3\nl4\nl5\n') // index copy: 5 lines
    await runGit(dir, ['add', 'grow.txt'])
    writeFileSync(path, 'NEW-A\nl1\nl2\nl3\nl4\nl5\nNEW-B\n') // working file: 7 lines

    const d = depsAt(dir)
    const diff = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'grow.txt', base: 'worktree' } })
    assert.equal(diff.value.newLines, 7, 'worktree count follows the working file')
    const tail = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'grow.txt', base: 'worktree', start: 1, end: 2 } })
    assert.equal(tail.ok, true)
    assert.deepEqual(tail.value.lines, ['NEW-A', 'l1'], 'worktree slice reads the working file')
    // The staged side of the same file is the index copy (5 lines): neither the
    // count nor the slice may come from the 7-line working file.
    const staged = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'grow.txt', base: 'staged' } })
    assert.equal(staged.value.newLines, 5, 'staged diff counts the index blob')
    const stagedTail = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'grow.txt', base: 'staged', start: 4, end: 5 } })
    assert.deepEqual(stagedTail.value.lines, ['l4', 'l5'], 'staged slice reads the index blob')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a retargeted symlink counts the link text git diffed, not the target file', async () => {
  // git stores a symlink as a blob whose content is the target string (mode
  // 120000), so the diff's new side has one line. Following the link would
  // report (and reveal) the target file's lines, i.e. content git never diffed.
  const { writeFileSync, symlinkSync, unlinkSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'gp-link-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const body = Array.from({ length: 40 }, (_, i) => `r${i + 1}`).join('\n') + '\n'
    writeFileSync(join(dir, 'real.txt'), body)
    writeFileSync(join(dir, 'other.txt'), body.replace(/^r/gm, 'o'))
    symlinkSync('real.txt', join(dir, 'link.txt'))
    await runGit(dir, ['add', '-A'])
    await runGit(dir, ['commit', '-qm', 'link: v1'])
    unlinkSync(join(dir, 'link.txt'))
    symlinkSync('other.txt', join(dir, 'link.txt')) // retargeted in the worktree

    const d = depsAt(dir)
    const diff = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'link.txt', base: 'worktree' } })
    assert.match(diff.value.text, /^\+other\.txt$/m, 'git diffs the link blob')
    assert.equal(diff.value.newLines, 1, 'one line: the link target text')
    const slice = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'link.txt', base: 'worktree', start: 2, end: 40 } })
    assert.deepEqual(slice.value.lines, [], 'nothing to reveal below a one-line link')
    assert.equal(slice.value.eof, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a truncated (lossy) git-show read is refused, not reported as a count', async () => {
  // The runner drops output at its collect/spill ceiling; the surviving tail
  // would make newLines a plausible lie, so it has to read as unknown (0).
  const lossy = {
    spawn(spec) {
      const child = nodeSpawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd })
      child.stdin.end()
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
          stdout: { readFrom: () => ({ text: out, lossy: true, spillPath: undefined }) },
          stderr: { readFrom: () => ({ text: err, lossy: false }) },
        },
      }
    },
  }
  const d = { ...deps(), run: createGitRunner(lossy, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes) }
  const diff = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'a.txt', base: 'staged' } })
  assert.equal(diff.ok, true)
  assert.equal(diff.value.newLines, 0, 'truncated read → unknown → no trailing control')
  assert.equal(diff.value.truncated, true, 'a truncated diff is flagged so the view can say so')
  const slice = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'a.txt', base: 'staged', start: 1, end: 3 } })
  assert.equal(slice.ok, false, 'expansion must refuse a lossy read rather than slice its tail')
  assert.equal(slice.error.code, 'git-error')
})

test('a failed git-show stays an error where a missing side is empty', async () => {
  // A bad rev is not "this version has no such path": it must not look like a
  // deleted file, which is what `file-lines` reports for a genuinely absent side.
  const bad = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'a.txt', base: 'commit', commit: 'no-such-ref', start: 1, end: 3 } })
  assert.equal(bad.ok, false)
  assert.match(bad.error.message, /invalid|bad|unknown|no-such-ref/i)
  const absent = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'nope.txt', base: 'commit', commit: 'HEAD', start: 1, end: 3 } })
  assert.equal(absent.ok, true, 'a genuinely absent side is an empty slice')
  assert.deepEqual(absent.value.lines, [])
  assert.equal(absent.value.eof, true)
})

test('file-lines serves a worktree slice for on-demand context expansion', async () => {
  // a.txt has 20 lines (line10 modified in the worktree); a slice reads the
  // working-tree file's exact lines, EOF-flagged when the end is reached.
  const mid = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'a.txt', base: 'worktree', start: 3, end: 5 } })
  assert.equal(mid.ok, true)
  assert.equal(mid.value.kind, 'file-lines')
  assert.deepEqual(mid.value.lines, ['line3', 'line4', 'line5'])
  assert.equal(mid.value.start, 3)
  assert.equal(mid.value.eof, false)
  const tail = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'a.txt', base: 'worktree', start: 19, end: 40 } })
  assert.equal(tail.ok, true)
  assert.deepEqual(tail.value.lines, ['line19', 'line20'])
  assert.equal(tail.value.eof, true, 'clamped to file end flags eof')
})

test('file-lines reads a commit blob by new-side line number', async () => {
  const hist = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 5, skip: 0 } })
  const ref = hist.value.commits.find((c) => c.subject.includes('add a')).hash
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'a.txt', base: 'commit', commit: ref, start: 1, end: 2 } })
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.lines, ['line1', 'line2'])
})

test('file-lines rejects an unsafe path', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: '../escape', base: 'worktree', start: 1, end: 1 } })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid-path')
})

test('dir-list lists the root, dirs-first, skipping .git', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'dir-list', path: '' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.kind, 'dir-list')
  const names = res.value.entries.map((e) => e.name)
  assert.ok(!names.includes('.git'), '.git is filtered from the root listing')
  assert.ok(names.includes('a.txt') && names.includes('d.txt'))
  const aTxt = res.value.entries.find((e) => e.name === 'a.txt')
  assert.equal(aTxt.dir, false)
  assert.ok(typeof aTxt.size === 'number' && aTxt.size > 0, 'files carry a byte size')
})

test('file browser lists a non-git cwd and previews a file without exposing .git', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-nongit-'))
  try {
    const { writeFileSync, mkdirSync, symlinkSync, realpathSync } = await import('node:fs')
    writeFileSync(join(dir, 'note.md'), '# hello\n')
    mkdirSync(join(dir, '.git'))
    writeFileSync(join(dir, '.git', 'config'), 'secret')
    symlinkSync(join(dir, '.git'), join(dir, 'git-alias'))
    const d = depsAt(dir)
    const listed = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'dir-list', path: '' } })
    assert.equal(listed.ok, true)
    assert.deepEqual(listed.value.entries.map((e) => e.name), ['git-alias', 'note.md'])
    assert.ok(listed.value.entries.every((entry) => entry.ignored !== true), 'non-git directories have no ignore status')
    const preview = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'note.md' } })
    assert.equal(preview.ok, true)
    assert.equal(preview.value.content, '# hello\n')
    // The rendered-Markdown image resolver joins relative destinations beside
    // this path, so the text variant must carry the document's absolute path.
    assert.equal(preview.value.absolutePath, join(realpathSync(dir), 'note.md'))
    for (const path of ['.git', 'git-alias']) {
      const blocked = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'dir-list', path } })
      assert.equal(blocked.ok, false)
      assert.equal(blocked.error.code, 'invalid-path')
    }
    const blockedFile = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: '.git/config' } })
    assert.equal(blockedFile.ok, false)
    assert.equal(blockedFile.error.code, 'invalid-path')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('dir-list marks ignored files and directories using git rules only in repositories', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-ignored-'))
  try {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    await runGit(dir, ['init', '-q'])
    writeFileSync(join(dir, '.gitignore'), '*.log\ncache/\n*.tmp\n!important.tmp\n')
    mkdirSync(join(dir, 'cache'))
    mkdirSync(join(dir, 'nested'))
    writeFileSync(join(dir, 'ignored.log'), 'ignored')
    writeFileSync(join(dir, 'tracked.log'), 'tracked')
    writeFileSync(join(dir, 'important.tmp'), 'kept')
    writeFileSync(join(dir, '-danger.tmp'), 'ignored')
    writeFileSync(join(dir, 'nested', '.gitignore'), 'secret.txt\n')
    writeFileSync(join(dir, 'nested', 'secret.txt'), 'ignored')
    await runGit(dir, ['add', '-f', 'tracked.log'])
    const root = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'dir-list', path: '' } })
    assert.equal(root.ok, true)
    const entries = Object.fromEntries(root.value.entries.map((entry) => [entry.name, entry]))
    assert.equal(entries['ignored.log'].ignored, true)
    assert.equal(entries['cache'].ignored, true)
    assert.equal(entries['-danger.tmp'].ignored, true, 'leading dash is safely passed to git')
    assert.notEqual(entries['tracked.log'].ignored, true, 'tracked files are not dimmed')
    assert.notEqual(entries['important.tmp'].ignored, true, 'negated patterns stay visible')
    const nested = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'dir-list', path: 'nested' } })
    assert.equal(nested.ok, true)
    assert.equal(nested.value.entries.find((entry) => entry.name === 'secret.txt')?.ignored, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('dir-list rejects an unsafe path', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'dir-list', path: '../escape' } })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid-path')
})

test('file-content returns a text file body + line count', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'a.txt' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.variant, 'text')
  assert.ok(res.value.content.includes('line10-changed'))
  assert.equal(res.value.lines, 20)
  // The properties dialog rides on the stat the read already performed.
  assert.equal(res.value.size, Buffer.byteLength(res.value.content))
  assert.ok(Number.isFinite(res.value.mtimeMs) && res.value.mtimeMs > 0)
})

test('file-content floors a text read at the copy envelope when maxBytes is smaller', async () => {
  // Every document the copy button may copy must load, so a tiny profile
  // stdout cap cannot reject the body before the shared 10 MiB envelope.
  const tinyCap = { ...DEFAULT_CONFIG, maxBytes: 4 }
  const res = await runQuery(deps(), tinyCap, { sessionId: SID, query: { kind: 'file-content', path: 'a.txt' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.variant, 'text')
  assert.equal(res.value.tooLarge, undefined)
  assert.ok(res.value.content.includes('line10-changed'))
})

test('file-content flags a text file over the copy envelope as tooLarge', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-fc-envelope-'))
  try {
    const { writeFileSync } = await import('node:fs')
    await runGit(dir, ['init', '-q'])
    writeFileSync(join(dir, 'huge.txt'), Buffer.alloc(FILE_COPY_MAX_BYTES + 1, 0x61))
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'huge.txt' } })
    assert.equal(res.ok, true)
    assert.equal(res.value.tooLarge, true)
    // size/mtimeMs survive the over-cap early return — a large file is exactly
    // when the user wants to see its size.
    assert.ok(res.value.size > FILE_COPY_MAX_BYTES)
    assert.ok(Number.isFinite(res.value.mtimeMs) && res.value.mtimeMs > 0)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('file-content loads a text file exactly at the copy envelope with the default cap', async () => {
  // Pins the floor itself: under DEFAULT_CONFIG (maxBytes 4 MiB) a document of
  // exactly FILE_COPY_MAX_BYTES must load. Together with the +1 → tooLarge
  // case above this forces the cap to equal the envelope exactly — a drifted
  // floor (e.g. 5 MiB) would turn copyable documents into tooLarge and hide
  // their copy button while every other test stayed green.
  const dir = mkdtempSync(join(tmpdir(), 'gp-fc-edge-'))
  try {
    const { writeFileSync } = await import('node:fs')
    await runGit(dir, ['init', '-q'])
    writeFileSync(join(dir, 'edge.txt'), Buffer.alloc(FILE_COPY_MAX_BYTES, 0x61))
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'edge.txt' } })
    assert.equal(res.ok, true)
    assert.equal(res.value.variant, 'text')
    assert.equal(res.value.tooLarge, undefined)
    assert.equal(res.value.content.length, FILE_COPY_MAX_BYTES)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('file-content still applies maxBytes to images over the cap', async () => {
  const tinyCap = { ...DEFAULT_CONFIG, maxBytes: 4 }
  const res = await runQuery(depsAt(repoImg), tinyCap, { sessionId: SID, query: { kind: 'file-content', path: 'img.png' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.tooLarge, true)
  assert.equal(res.value.variant, 'image')
})

test('file-content serves an image as a data URL', async () => {
  const res = await runQuery(depsAt(repoImg), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'img.png' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.variant, 'image')
  assert.ok(res.value.dataUrl.startsWith('data:image/png;base64,'))
  assert.equal(res.value.size, Buffer.from('PNG-v2-bytes').length)
  assert.ok(Number.isFinite(res.value.mtimeMs) && res.value.mtimeMs > 0)
})

test('file-content serves an SVG as an image plus its markup', async () => {
  const res = await runQuery(depsAt(repoImg), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'logo.svg' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.variant, 'image')
  assert.ok(res.value.dataUrl.startsWith('data:image/svg+xml;base64,'))
  // The same read answers the preview's source face — no second round trip.
  assert.ok(res.value.content.startsWith('<svg xmlns="http://www.w3.org/2000/svg">'))
  assert.equal(res.value.content.split('\n').length - 1, res.value.lines)
  assert.equal(res.value.lines, 3)
})

test('file-content leaves a non-text SVG image-only', async () => {
  const res = await runQuery(depsAt(repoImg), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'blob.svg' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.variant, 'image')
  assert.ok(res.value.dataUrl.startsWith('data:image/svg+xml;base64,'))
  assert.equal(res.value.content, undefined, 'bytes with a NUL never become source text')
  assert.equal(res.value.lines, undefined)
})

test('file-content serves an SVG above the image cap as its source', async () => {
  // An SVG is markup, so past the image cap it degrades to the text shape
  // (readable, copyable, source-only) instead of `tooLarge`, which would hide
  // the file outright. A 4-byte cap puts the fixture over it, and the read still
  // floors at the copy envelope rather than stopping at the image cap.
  const tinyCap = { ...DEFAULT_CONFIG, maxBytes: 4 }
  const res = await runQuery(depsAt(repoImg), tinyCap, { sessionId: SID, query: { kind: 'file-content', path: 'logo.svg' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.variant, 'text')
  assert.equal(res.value.tooLarge, undefined)
  assert.equal(res.value.dataUrl, undefined, 'no picture face past the image cap')
  assert.ok(res.value.content.startsWith('<svg xmlns="http://www.w3.org/2000/svg">'))
  assert.equal(res.value.lines, 3)
  assert.equal(res.value.size, Buffer.byteLength(res.value.content))
  assert.equal(res.value.absolutePath, join(realpathSync(repoImg), 'logo.svg'))
})

test('file-content keeps a non-text SVG too large past the image cap', async () => {
  // NUL-bearing bytes have no trustworthy source face, so this one stays
  // unreadable rather than being served as text.
  const tinyCap = { ...DEFAULT_CONFIG, maxBytes: 4 }
  const res = await runQuery(depsAt(repoImg), tinyCap, { sessionId: SID, query: { kind: 'file-content', path: 'blob.svg' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.tooLarge, true)
  assert.equal(res.value.variant, 'image')
})


test('file-content marks a NUL-containing file as binary', async () => {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(repo, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00, 0x41]))
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'blob.bin' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.variant, 'binary')
  assert.equal(res.value.content, undefined)
  assert.equal(res.value.size, 5)
  assert.ok(Number.isFinite(res.value.mtimeMs) && res.value.mtimeMs > 0)
})

test('file-content rejects an unsafe path', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: '../../etc/hosts' } })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid-path')
})

test('file-content reports a deleted file as file-not-found, not a generic error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-gone-'))
  try {
    const { writeFileSync, rmSync } = await import('node:fs')
    writeFileSync(join(dir, 'gone.txt'), 'here')
    const d = depsAt(dir)
    const before = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'gone.txt' } })
    assert.equal(before.ok, true)
    rmSync(join(dir, 'gone.txt'))
    const after = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'gone.txt' } })
    assert.equal(after.ok, false)
    assert.equal(after.error.code, 'file-not-found')
    // A directory that vanished between listing and expansion reads the same.
    const dirAfter = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'dir-list', path: 'vanished' } })
    assert.equal(dirAfter.ok, false)
    assert.equal(dirAfter.error.code, 'file-not-found')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('show returns commit meta + changed files', async () => {  const hist = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 5, skip: 0 } })
  const ref = hist.value.commits.find((c) => c.subject.includes('add a')).hash
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'show', ref } })
  assert.equal(res.ok, true)
  assert.equal(res.value.commit.subject, 'feat: add a')
  assert.ok(res.value.stats.some((s) => s.path === 'a.txt'))
  // a.txt added with 20 lines → +20 / −0, one changed file.
  assert.equal(res.value.stats.length, 1)
  assert.equal(res.value.insertions, 20)
  assert.equal(res.value.deletions, 0)
})

test('show counts a binary file as changed but contributes 0 lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-bin-'))
  try {
    const { writeFileSync } = await import('node:fs')
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    // Real binary (embedded NUL) + a one-line text file in the same commit.
    writeFileSync(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]))
    writeFileSync(join(dir, 'notes.txt'), 'plain\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'add binary + text'])
    const d = depsAt(dir)
    const res = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'show', ref: 'HEAD' } })
    assert.equal(res.ok, true)
    assert.ok(res.value.stats.some((s) => s.path === 'blob.bin'), 'binary file in file list')
    assert.equal(res.value.stats.length, 2, 'binary + text both counted as files')
    assert.equal(res.value.insertions, 1, 'only the text file contributes a line')
    assert.equal(res.value.deletions, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('show on a merge commit describes the first-parent diff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-merge-'))
  try {
    const { writeFileSync } = await import('node:fs')
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'root'])
    await runGit(dir, ['checkout', '-qb', 'feature'])
    writeFileSync(join(dir, 'f.txt'), 'feature\n')
    await runGit(dir, ['add', 'f.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: f'])
    await runGit(dir, ['checkout', '-q', '-'])
    writeFileSync(join(dir, 'm.txt'), 'main\n')
    await runGit(dir, ['add', 'm.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: m'])
    await runGit(dir, ['merge', '--no-ff', '-q', '-m', 'merge: feature', 'feature'])
    const d = depsAt(dir)
    const head = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'show', ref: 'HEAD' } })
    assert.equal(head.ok, true)
    assert.equal(head.value.commit.subject, 'merge: feature')
    // The merge brought f.txt into main. git's default combined diff lists
    // nothing here, so a merge must read as what it added to its first parent.
    assert.deepEqual(head.value.stats.map((s) => s.path), ['f.txt'])
    assert.equal(head.value.stats[0].status, 'added')
    assert.equal(head.value.insertions, 1)
    assert.equal(head.value.deletions, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('merge commit list, totals and per-file diff describe the same (first-parent) diff', async () => {
  // The b6d16f1 shape: each hunk of the merge result matches one parent, so
  // git's default --cc patch is empty while --name-status still lists the file
  // (it differs from both parents at blob level) and --numstat serves a
  // first-parent diff. The panel used to pair that 1-file list with the other
  // diff's totals and open an empty pane showing +0/−0.
  const dir = mkdtempSync(join(tmpdir(), 'gp-merge-fp-'))
  try {
    const { writeFileSync } = await import('node:fs')
    const lines = Array.from({ length: 60 }, (_, i) => `line${i + 1}`)
    const withLine = (index, text) => lines.map((l, i) => (i === index ? text : l)).join('\n') + '\n'
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    writeFileSync(join(dir, 'common.txt'), lines.join('\n') + '\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'root'])
    await runGit(dir, ['checkout', '-qb', 'feature'])
    writeFileSync(join(dir, 'common.txt'), withLine(54, 'line55-feature'))
    writeFileSync(join(dir, 'feature.txt'), 'feature\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'feat: feature side'])
    await runGit(dir, ['checkout', '-q', '-'])
    writeFileSync(join(dir, 'common.txt'), withLine(4, 'line5-main'))
    await runGit(dir, ['add', 'common.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: main side'])
    await runGit(dir, ['merge', '--no-ff', '-q', '-m', 'merge: feature', 'feature'])

    const d = depsAt(dir)
    const head = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'show', ref: 'HEAD' } })
    assert.equal(head.ok, true)
    assert.deepEqual(head.value.stats.map((s) => s.path).sort(), ['common.txt', 'feature.txt'],
      'the merge file list is the change it brought into its first parent')
    assert.equal(head.value.insertions, 2)
    assert.equal(head.value.deletions, 1)

    const diff = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'common.txt', base: 'commit', commit: 'HEAD' } })
    assert.equal(diff.ok, true)
    assert.match(diff.value.text, /^@@/m)
    assert.match(diff.value.text, /^-line55$/m)
    assert.match(diff.value.text, /^\+line55-feature$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('merge commit built from a conflict resolution reads as its first-parent diff', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-merge-cr-'))
  try {
    const { writeFileSync } = await import('node:fs')
    const write = (name, text) => writeFileSync(join(dir, name), text)
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    write('common.txt', 'base\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'root'])
    await runGit(dir, ['checkout', '-qb', 'feature'])
    write('common.txt', 'feature\n')
    write('other.txt', 'other\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'feat: feature side'])
    await runGit(dir, ['checkout', '-q', '-'])
    write('common.txt', 'main\n')
    await runGit(dir, ['add', 'common.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: main side'])
    assert.throws(
      () => execFileSync('git', ['merge', '--no-ff', '-m', 'merge: feature', 'feature'], { cwd: dir, stdio: 'pipe' }),
      'the merge must conflict so the result differs from both parents',
    )
    write('common.txt', 'resolved\n')
    await runGit(dir, ['add', 'common.txt'])
    await runGit(dir, ['commit', '--no-edit', '-q'])

    const d = depsAt(dir)
    const head = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'show', ref: 'HEAD' } })
    assert.equal(head.ok, true)
    // First parent (main) → merge: common.txt edited (+1/−1) + other.txt added.
    assert.deepEqual(head.value.stats.map((s) => s.path).sort(), ['common.txt', 'other.txt'])
    assert.equal(head.value.insertions, 2)
    assert.equal(head.value.deletions, 1)

    const diff = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'common.txt', base: 'commit', commit: 'HEAD' } })
    assert.equal(diff.ok, true)
    assert.match(diff.value.text, /^@@/m)
    assert.match(diff.value.text, /^-main$/m)
    assert.match(diff.value.text, /^\+resolved$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stage then commit advances HEAD', async () => {
  const staged = await runAction(deps(), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'stage', paths: ['a.txt'] } })
  assert.equal(staged.ok, true)
  assert.equal(staged.snapshot.staged, 1)
  const committed = await runAction(deps(), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'commit', message: 'chore: update a', paths: ['a.txt'] } })
  assert.equal(committed.ok, true)
  const msg = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'last-commit-message' } })
  assert.equal(msg.value.message, 'chore: update a')
})

test('commit with nothing staged reports nothing-to-commit, not a raw git line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-it-nothing-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const refused = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'commit', message: 'chore: noop' } })
    assert.equal(refused.ok, false)
    // git explains this refusal on stdout and leaves stderr empty; the code is
    // what the client localizes.
    assert.equal(refused.error.code, 'nothing-to-commit')
    assert.equal(refused.error.message, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('image-diff serves old/new data URLs per base', async () => {
  const d = depsAt(repoImg)
  const b64 = (s) => Buffer.from(s).toString('base64')
  const url = (s) => `data:image/png;base64,${b64(s)}`
  const query = (q) => runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: q })

  // worktree row: index (v1) vs working file (v2).
  const wt = await query({ kind: 'image-diff', path: 'img.png', base: 'worktree' })
  assert.equal(wt.ok, true)
  assert.equal(wt.value.kind, 'image-diff')
  assert.equal(wt.value.mime, 'image/png')
  assert.equal(wt.value.old, url('PNG-v1-bytes'))
  assert.equal(wt.value.new, url('PNG-v2-bytes'))

  // untracked image: only the new side exists.
  const un = await query({ kind: 'image-diff', path: 'img2.png', base: 'worktree' })
  assert.equal(un.ok, true)
  assert.equal(un.value.old, undefined)
  assert.equal(un.value.new, url('PNG-untracked'))

  // staged row: HEAD (v1) vs index (v2 after add).
  await runGit(repoImg, ['add', 'img.png'])
  const st = await query({ kind: 'image-diff', path: 'img.png', base: 'staged' })
  assert.equal(st.ok, true)
  assert.equal(st.value.old, url('PNG-v1-bytes'))
  assert.equal(st.value.new, url('PNG-v2-bytes'))

  // commit row: parent (v1) vs commit (v2).
  await runGit(repoImg, ['commit', '-qm', 'img v2'])
  const hist = await query({ kind: 'history', limit: 1, skip: 0 })
  const hash = hist.value.commits[0].hash
  const cm = await query({ kind: 'image-diff', path: 'img.png', base: 'commit', commit: hash })
  assert.equal(cm.ok, true)
  assert.equal(cm.value.old, url('PNG-v1-bytes'))
  assert.equal(cm.value.new, url('PNG-v2-bytes'))
})

test('image-diff guards: non-image mime, missing side, invalid path', async () => {
  const d = depsAt(repoImg)
  const query = (q) => runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: q })

  // A non-image extension resolves mime: null so the client keeps the text path.
  const txt = await query({ kind: 'image-diff', path: 'notes.txt', base: 'worktree' })
  assert.equal(txt.ok, true)
  assert.equal(txt.value.mime, null)
  assert.equal(txt.value.old, undefined)

  // Deleted file: the worktree side is gone (it was never indexed either).
  const { unlinkSync } = await import('node:fs')
  unlinkSync(join(repoImg, 'img2.png'))
  const del = await query({ kind: 'image-diff', path: 'img2.png', base: 'worktree' })
  assert.equal(del.ok, true)
  assert.equal(del.value.new, undefined)
  assert.equal(del.value.old, undefined)

  // Path traversal is rejected before any git/fs work.
  const bad = await query({ kind: 'image-diff', path: '../evil.png', base: 'worktree' })
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'invalid-path')
})

test('image-diff flags a side over the configured payload cap', async () => {
  // The per-side cap rides config.maxBytes; a tiny cap makes any real file
  // exceed it, so both sides resolve to tooLarge without a large fixture.
  const tinyCap = { ...DEFAULT_CONFIG, maxBytes: 8 }
  const res = await runQuery(depsAt(repoImg), tinyCap, { sessionId: SID, query: { kind: 'image-diff', path: 'img.png', base: 'worktree' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.kind, 'image-diff')
  assert.equal(res.value.tooLarge, true)
  assert.equal(res.value.old, undefined)
  assert.equal(res.value.new, undefined)
})

// ── injection regression (C1/C2): a `-`-prefixed ref must never reach an
//    option position; the classic vector `--output=<file>` writes outside the
//    output cap. We assert the endpoint rejects it AND no file lands on disk.
test('history rejects an option-injecting ref and writes no file', async () => {
  const marker = join(repo, 'HIST_INJECT_MARKER')
  const res = await runQuery(deps(), DEFAULT_CONFIG, {
    sessionId: SID,
    query: { kind: 'history', limit: 5, skip: 0, ref: `--output=${marker}` },
  })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid-name')
  await assert.rejects(stat(marker), 'no file was written by the injected --output')
})

test('show rejects an option-injecting ref', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'show', ref: '--output=/tmp/gp-show-inject' } })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid-name')
})

test('commit-base diff rejects an option-injecting commit', async () => {
  const marker = join(repo, 'DIFF_INJECT_MARKER')
  const res = await runQuery(deps(), DEFAULT_CONFIG, {
    sessionId: SID,
    query: { kind: 'diff', path: 'a.txt', base: 'commit', commit: `--output=${marker}` },
  })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid-name')
  await assert.rejects(stat(marker), 'no file was written by the injected --output')
})

test('branch-checkout rejects a dash-prefixed name (would run git checkout -f)', async () => {
  const res = await runAction(deps(), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'branch-checkout', name: '-f' } })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid-name')
})

// ── branch switch (checkout) ─────────────────────────────────────────────
/** A repo whose HEAD and the branch `other` differ on a.txt, so a local edit to
 * a.txt is what git refuses to clobber on a switch. */
async function switchRepo(prefix) {
  const dir = await freshRepo(prefix)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(dir, 'a.txt'), 'two\n')
  await runGit(dir, ['add', 'a.txt'])
  await runGit(dir, ['commit', '-qm', 'feat: two'])
  await runGit(dir, ['branch', 'other', 'HEAD~1'])
  return dir
}

test('branch-checkout into a conflicting dirty work tree is refused (local-changes-block)', async () => {
  const dir = await switchRepo('gp-switch-dirty-')
  try {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'a.txt'), 'local edit\n')
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'branch-checkout', name: 'other' } })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'local-changes-block')
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'local edit\n', 'a refused switch leaves the work tree untouched')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stash-then-switch stashes the local changes and switches the branch', async () => {
  const dir = await switchRepo('gp-switch-stash-')
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'a.txt'), 'local edit\n')
    writeFileSync(join(dir, 'untracked.txt'), 'new\n')
    const res = await runAction(d, DEFAULT_CONFIG, {
      sessionId: SID,
      action: { kind: 'branch-checkout', name: 'other', stashMessage: 'gp: switch to other' },
    })
    assert.equal(res.ok, true, JSON.stringify(res.error ?? {}))
    assert.equal(res.snapshot.branch, 'other')
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'one\n', 'the switch landed on the target branch content')
    await assert.rejects(stat(join(dir, 'untracked.txt')), 'the untracked file went into the stash (git -u) too')
    const stash = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })
    assert.equal(stash.value.entries.length, 1, 'the changes are recoverable from the stash stack')
    assert.match(stash.value.entries[0].message, /gp: switch to other/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stash-then-switch with nothing stashable reports the block, not a stashed state', async () => {
  const dir = await switchRepo('gp-switch-noop-')
  try {
    const d = depsAt(dir)
    // A clean work tree: `git stash push -u` prints "No local changes to save"
    // and exits 0, so the checkout that follows would be refused again —
    // reporting a stash (or a plain refusal) here would both be misleading.
    const res = await runAction(d, DEFAULT_CONFIG, {
      sessionId: SID,
      action: { kind: 'branch-checkout', name: 'other', stashMessage: 'gp: switch' },
    })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'local-changes-block')
    const stash = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })
    assert.equal(stash.value.entries.length, 0, 'no stash entry was created')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stash-then-switch keeps the stash and reports stash-switch-failed when the switch still fails', async () => {
  const dir = await switchRepo('gp-switch-partial-')
  const wt = mkdtempSync(join(tmpdir(), 'gp-switch-wt-'))
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    // `other` is checked out in a second worktree, so git refuses to switch to
    // it here — but only after the stash step already moved the changes.
    await runGit(dir, ['worktree', 'add', '-q', wt, 'other'])
    writeFileSync(join(dir, 'a.txt'), 'local edit\n')
    const res = await runAction(d, DEFAULT_CONFIG, {
      sessionId: SID,
      action: { kind: 'branch-checkout', name: 'other', stashMessage: 'gp: switch' },
    })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'stash-switch-failed', JSON.stringify(res.error))
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'two\n', 'the stash took the local edit away')
    const stash = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })
    assert.equal(stash.value.entries.length, 1, 'the stash is kept, so the changes are recoverable')
  } finally {
    await runGit(dir, ['worktree', 'remove', '--force', wt]).catch(() => {})
    rmSync(wt, { recursive: true, force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stash-then-switch reports stash-switch-failed when the switch step times out, is cancelled, or git is unavailable', async () => {
  const dir = await switchRepo('gp-switch-transport-')
  try {
    const d = depsAt(dir)
    const realRun = d.run.run.bind(d.run)
    const { writeFileSync } = await import('node:fs')
    // Transport-level failures are not git refusals, but the stash step has
    // already moved the changes: all three must report the partial state (with
    // the underlying cause riding along) instead of a plain timeout/cancel that
    // reads as "nothing happened".
    const stubCheckout = (impl) => ({ run: (argv, opts) => (argv.includes('checkout') ? impl() : realRun(argv, opts)) })
    const idle = { exitCode: null, stdout: '', stderr: '', timedOut: false, cancelled: false, stdoutLossy: false }
    const modes = [
      { stub: stubCheckout(async () => ({ ...idle, timedOut: true })), reason: /timed out/ },
      { stub: stubCheckout(async () => ({ ...idle, cancelled: true })), reason: /cancelled/ },
      { stub: stubCheckout(async () => { throw new Error('spawn git ENOENT') }), reason: /spawn git ENOENT/ },
    ]
    for (const [i, mode] of modes.entries()) {
      // Each attempt must really stash: the checkout is stubbed (HEAD never
      // moves), so write a fresh edit that differs from HEAD every round —
      // re-writing the same content would make `git stash push` a no-op.
      writeFileSync(join(dir, 'a.txt'), `local edit ${i}\n`)
      const res = await runAction({ ...d, run: mode.stub }, DEFAULT_CONFIG, {
        sessionId: SID,
        action: { kind: 'branch-checkout', name: 'other', stashMessage: 'gp: switch' },
      })
      assert.equal(res.ok, false, JSON.stringify(res.error ?? {}))
      assert.equal(res.error.code, 'stash-switch-failed', JSON.stringify(res.error))
      assert.match(res.error.message, mode.reason, 'the underlying cause rides along')
      assert.match(res.error.message, /step 2\/2/, 'the failing step is identified')
    }
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'two\n', 'the switch never landed')
    const stash = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })
    assert.equal(stash.value.entries.length, modes.length, 'every attempt left its stash entry recoverable')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('branch-checkout of a missing branch maps to not-found', async () => {
  const dir = await freshRepo('gp-switch-missing-')
  try {
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'branch-checkout', name: 'nope' } })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'not-found')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('branch-checkout with createFrom creates a local branch that tracks the remote ref', async () => {
  const dir = await freshRepo('gp-switch-track-')
  try {
    const d = depsAt(dir)
    await runGit(dir, ['remote', 'add', 'origin', 'https://example.invalid/x.git'])
    await runGit(dir, ['update-ref', 'refs/remotes/origin/dev', 'HEAD'])
    const res = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'branch-checkout', name: 'dev', createFrom: 'origin/dev' } })
    assert.equal(res.ok, true, JSON.stringify(res.error ?? {}))
    assert.equal(res.snapshot.branch, 'dev')
    const upstream = execFileSync('git', ['config', '--get', 'branch.dev.merge'], { cwd: dir }).toString().trim()
    assert.equal(upstream, 'refs/heads/dev', 'the new branch tracks the remote branch, not a detached HEAD')
    assert.equal(execFileSync('git', ['config', '--get', 'branch.dev.remote'], { cwd: dir }).toString().trim(), 'origin')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('branch-checkout with createFrom on a stale remote ref fails without creating the branch', async () => {
  const dir = await freshRepo('gp-switch-stale-')
  try {
    // A refs/remotes entry whose remote is no longer configured: git can create
    // the branch but cannot set up tracking, so it aborts before switching.
    await runGit(dir, ['update-ref', 'refs/remotes/origin/dev', 'HEAD'])
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'branch-checkout', name: 'dev', createFrom: 'origin/dev' } })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'git-error')
    assert.match(res.error.message, /tracking information/)
    const branches = execFileSync('git', ['branch', '--list', 'dev'], { cwd: dir }).toString().trim()
    assert.equal(branches, '', 'no half-created branch is left behind')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── snapshot edge states (T3) ────────────────────────────────────────────
test('snapshot on an unborn repo reports unborn / null branch head', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-unborn-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const res = await snapshotForSession(depsAt(dir), DEFAULT_CONFIG, SID)
    assert.equal(res.ok, true)
    assert.equal(res.value.unborn, true)
    assert.equal(res.value.head, null)
    assert.equal(res.value.dirty, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('snapshot on a clean committed repo is not dirty and has zero counts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-clean-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const res = await snapshotForSession(depsAt(dir), DEFAULT_CONFIG, SID)
    assert.equal(res.ok, true)
    assert.equal(res.value.unborn, false)
    assert.equal(res.value.dirty, false)
    assert.equal(res.value.staged + res.value.modified + res.value.untracked, 0)
    assert.equal(res.value.stats.fileCount, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('resolveWorkspace failures surface typed codes', async () => {
  // No cwd for the session → cwd-unavailable.
  const noCwd = { ...depsAt(repo), sessions: { liveCwd: () => undefined, persistedMeta: async () => undefined } }
  const a = await snapshotForSession(noCwd, DEFAULT_CONFIG, SID)
  assert.equal(a.ok, false)
  assert.equal(a.error.code, 'cwd-unavailable')

  // A cwd that is not a git repo → not-a-git-repo (pill preference preserved).
  const plainDir = mkdtempSync(join(tmpdir(), 'gp-plain-'))
  try {
    const b = await snapshotForSession(depsAt(plainDir), DEFAULT_CONFIG, SID)
    assert.equal(b.ok, false)
    assert.equal(b.error.code, 'not-a-git-repo')
    assert.equal(b.error.showInputPill, true)
  } finally {
    rmSync(plainDir, { recursive: true, force: true })
  }
})

/** deps whose git runner always fails to spawn — simulates git not installed. */
function depsNoGit(dir) {
  return { ...depsAt(dir), run: { run: async () => { throw new Error('spawn git ENOENT') } } }
}

test('git-not-installed inside a repo → git-unavailable with isGitRepo true', async () => {
  // `repo` has a real `.git`, so the filesystem probe reports a repo even though
  // git itself cannot run.
  const res = await snapshotForSession(depsNoGit(repo), DEFAULT_CONFIG, SID)
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'git-unavailable')
  assert.equal(res.error.isGitRepo, true)
  assert.ok(res.error.cwd !== undefined && res.error.cwd !== '', 'cwd is carried for the browse fallback')
})

test('git-not-installed outside a repo → git-unavailable with isGitRepo false', async () => {
  const plainDir = mkdtempSync(join(tmpdir(), 'gp-nogit-plain-'))
  try {
    const res = await snapshotForSession(depsNoGit(plainDir), DEFAULT_CONFIG, SID)
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'git-unavailable')
    assert.equal(res.error.isGitRepo, false)
  } finally {
    rmSync(plainDir, { recursive: true, force: true })
  }
})

test('git-not-installed still lists the directory via the cwd browse root', async () => {
  // The file browser must keep working with git absent: dir-list falls back to
  // the plain cwd (no git ignore info, hence no `ignored` flags).
  const dir = mkdtempSync(join(tmpdir(), 'gp-nogit-browse-'))
  try {
    const { writeFileSync, mkdirSync } = await import('node:fs')
    writeFileSync(join(dir, 'top.txt'), 'hi\n')
    mkdirSync(join(dir, 'sub'))
    const res = await runQuery(depsNoGit(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'dir-list', path: '' } })
    assert.equal(res.ok, true, 'dir-list succeeds without git')
    const names = res.value.entries.map((e) => e.name).sort()
    assert.deepEqual(names, ['sub', 'top.txt'])
    assert.ok(res.value.entries.every((e) => e.ignored === undefined), 'no git ignore info without git')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('worktree-stats sums insertions across multiple untracked files (H1)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-unt-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'u1.txt'), 'a\nb\n')
    writeFileSync(join(dir, 'u2.txt'), 'c\nd\ne\n')
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'worktree-stats' } })
    assert.equal(res.ok, true)
    assert.equal(res.value.stats.untracked, 2)
    // 2 + 3 = 5 insertions across the two untracked files (previously 0 because
    // a single multi-path --no-index run failed with exit 129).
    assert.equal(res.value.stats.insertions, 5)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discard removes an untracked file from the work tree (H6)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-disc-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { writeFileSync, existsSync } = await import('node:fs')
    writeFileSync(join(dir, 'u.txt'), 'junk\n')
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'discard', paths: ['u.txt'] } })
    assert.equal(res.ok, true, 'discard of an untracked file succeeds instead of failing on pathspec')
    assert.equal(existsSync(join(dir, 'u.txt')), false, 'the untracked file is deleted')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discard restores a tracked file and removes only the selected nested untracked leaf in one batch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-discmixed-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const { mkdirSync, writeFileSync, existsSync, readFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'tracked.txt'), 'original\n')
    await runGit(dir, ['add', 'tracked.txt'])
    await runGit(dir, ['commit', '-qm', 'base'])
    writeFileSync(join(dir, 'tracked.txt'), 'changed\n')
    mkdirSync(join(dir, 'newdir', 'sub'), { recursive: true })
    writeFileSync(join(dir, 'newdir', 'sub', 'selected.txt'), 'remove me\n')
    writeFileSync(join(dir, 'newdir', 'sub', 'sibling.txt'), 'keep me\n')
    const deps = depsAt(dir)
    const snap = await snapshotForSession(deps, DEFAULT_CONFIG, SID)
    assert.equal(snap.ok, true)
    assert.equal(snap.value.untrackedCollapsed ?? false, false)
    assert.equal(snap.value.truncated, false)
    assert.deepEqual(snap.value.changes.map((c) => [c.path, c.status, c.staged, c.isDirectory]), [
      ['tracked.txt', 'modified', false, false],
      ['newdir/sub/selected.txt', 'untracked', false, false],
      ['newdir/sub/sibling.txt', 'untracked', false, false],
    ])
    const paths = snap.value.changes
      .filter((c) => c.path === 'tracked.txt' || c.path === 'newdir/sub/selected.txt')
      .map((c) => c.path)
    assert.equal(paths.length, 2, 'the batch selects both snapshot rows')
    const res = await runAction(deps, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'discard', paths } })
    assert.equal(res.ok, true)
    assert.equal(readFileSync(join(dir, 'tracked.txt'), 'utf8'), 'original\n', 'the tracked half was restored')
    assert.equal(existsSync(join(dir, 'newdir', 'sub', 'selected.txt')), false, 'the selected leaf was deleted')
    assert.equal(readFileSync(join(dir, 'newdir', 'sub', 'sibling.txt'), 'utf8'), 'keep me\n', 'the unselected sibling is untouched')
    assert.equal(res.snapshot.untrackedCollapsed ?? false, false)
    assert.deepEqual(res.snapshot.changes.map((c) => [c.path, c.status]), [['newdir/sub/sibling.txt', 'untracked']])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

async function assertUntrackedDirectorySnapshot(deps, config, paths, collapsed) {
  const snap = await snapshotForSession(deps, config, SID)
  assert.equal(snap.ok, true)
  assert.deepEqual(snap.value.changes.map((c) => [c.path, c.status, c.isDirectory]), paths.map((path) => [path, 'untracked', true]))
  assert.equal(snap.value.untrackedCollapsed ?? false, collapsed)
  assert.equal(snap.value.truncated, false, 'every selected directory fits in the snapshot')
}

test('discard removes a collapsed untracked directory (recursively) from the work tree', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-discdir-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs')
    mkdirSync(join(dir, 'newdir', 'sub'), { recursive: true })
    writeFileSync(join(dir, 'newdir', 'a.txt'), 'x\n')
    writeFileSync(join(dir, 'newdir', 'sub', 'b.txt'), 'y\n')
    // Two leaf entries exceed the cap; normal status folds them into one row.
    const config = { ...DEFAULT_CONFIG, maxChanges: 1 }
    await assertUntrackedDirectorySnapshot(depsAt(dir), config, ['newdir'], true)
    const res = await runAction(depsAt(dir), config, { sessionId: SID, action: { kind: 'discard', paths: ['newdir'] } })
    assert.equal(res.ok, true, 'discarding an untracked directory succeeds instead of no-oping on EISDIR')
    assert.equal(existsSync(join(dir, 'newdir')), false, 'the directory and its contents are gone')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discard refuses an untracked directory that is itself a repository (issue #46)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-nested-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs')
    mkdirSync(join(dir, 'nested'))
    await runGit(join(dir, 'nested'), ['init', '-q'])
    writeFileSync(join(dir, 'nested', 'x.txt'), 'x\n')
    await assertUntrackedDirectorySnapshot(depsAt(dir), DEFAULT_CONFIG, ['nested'], false)
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'discard', paths: ['nested'] } })
    assert.equal(res.ok, false, 'a nested repository is refused instead of deleted')
    assert.equal(res.error.code, 'nested-repo')
    assert.equal(existsSync(join(dir, 'nested', '.git')), true, 'the inner repository is intact')
    assert.equal(existsSync(join(dir, 'nested', 'x.txt')), true, 'nothing inside it was removed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discard refuses a submodule-style entry (its .git is a file)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-submod-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs')
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', '.git'), 'gitdir: ../.git/modules/sub\n')
    writeFileSync(join(dir, 'sub', 'y.txt'), 'y\n')
    writeFileSync(join(dir, 'sub', 'z.txt'), 'z\n')
    // An unresolved gitdir file is expanded by -uall; collapse its two leaves
    // so the selected row reaches the .git-file repository guard.
    const config = { ...DEFAULT_CONFIG, maxChanges: 1 }
    await assertUntrackedDirectorySnapshot(depsAt(dir), config, ['sub'], true)
    const res = await runAction(depsAt(dir), config, { sessionId: SID, action: { kind: 'discard', paths: ['sub'] } })
    assert.equal(res.ok, false, 'a submodule-shaped entry is refused too')
    assert.equal(res.error.code, 'nested-repo')
    assert.equal(existsSync(join(dir, 'sub', '.git')), true, 'the gitdir file is intact')
    assert.equal(existsSync(join(dir, 'sub', 'y.txt')), true, 'the entry is untouched')
    assert.equal(existsSync(join(dir, 'sub', 'z.txt')), true, 'neither leaf was removed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discard refuses a bare repository directory (no .git, HEAD + objects + refs)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-bare-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    await runGit(dir, ['init', '--bare', '-q', 'bare.git'])
    const { existsSync } = await import('node:fs')
    const expanded = await snapshotForSession(depsAt(dir), DEFAULT_CONFIG, SID)
    assert.equal(expanded.ok, true)
    assert.equal(expanded.value.untrackedCollapsed ?? false, false)
    assert.ok(expanded.value.changes.length > 1)
    assert.ok(expanded.value.changes.every((c) => c.path.startsWith('bare.git/') && c.status === 'untracked' && !c.isDirectory), 'bare repository files are expanded by default')
    const config = { ...DEFAULT_CONFIG, maxChanges: 1 }
    await assertUntrackedDirectorySnapshot(depsAt(dir), config, ['bare.git'], true)
    const res = await runAction(depsAt(dir), config, { sessionId: SID, action: { kind: 'discard', paths: ['bare.git'] } })
    assert.equal(res.ok, false, 'a bare repository is refused too')
    assert.equal(res.error.code, 'nested-repo')
    assert.equal(existsSync(join(dir, 'bare.git', 'HEAD')), true, 'the bare repository is intact')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a plain directory that merely contains a repository is still discarded as a whole (#46 boundary)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-outerdir-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs')
    mkdirSync(join(dir, 'outer', 'inner'), { recursive: true })
    await runGit(join(dir, 'outer', 'inner'), ['init', '-q'])
    writeFileSync(join(dir, 'outer', 'inner', 'z.txt'), 'z\n')
    writeFileSync(join(dir, 'outer', 'ordinary.txt'), 'ordinary\n')
    // The nested repository row plus the ordinary file exceed the cap and
    // collapse to outer. Only an entry that is itself a repository is refused.
    const config = { ...DEFAULT_CONFIG, maxChanges: 1 }
    await assertUntrackedDirectorySnapshot(depsAt(dir), config, ['outer'], true)
    const res = await runAction(depsAt(dir), config, { sessionId: SID, action: { kind: 'discard', paths: ['outer'] } })
    assert.equal(res.ok, true)
    assert.equal(existsSync(join(dir, 'outer')), false, 'the containing directory goes away as a whole')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed untracked removal surfaces as an error instead of a silent success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-discfail-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const { writeFileSync, existsSync, readFileSync } = await import('node:fs')
    writeFileSync(join(dir, 't.txt'), 'v1\n')
    await runGit(dir, ['add', 't.txt'])
    await runGit(dir, ['commit', '-qm', 'add t'])
    writeFileSync(join(dir, 't.txt'), 'v2\n')
    writeFileSync(join(dir, 'u.txt'), 'junk\n')
    const deps = depsAt(dir)
    deps.fs.remove = async () => { throw new Error('EACCES: permission denied') }
    // The batch carries a tracked path too: it never reaches `git restore`
    // (the untracked deletions run first and abort), so the message must say
    // so — "could not discard 1" alone would hide the un-restored tracked half.
    const res = await runAction(deps, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'discard', paths: ['u.txt', 't.txt'] } })
    assert.equal(res.ok, false, 'the removal failure is reported, not swallowed')
    assert.equal(res.error.code, 'git-error')
    assert.match(res.error.message, /could not discard 1 path\(s\): u\.txt: EACCES/, 'names the path that failed')
    assert.match(res.error.message, /1 tracked path\(s\) not restored$/, 'also names the tracked half that was skipped')
    assert.equal(existsSync(join(dir, 'u.txt')), true, 'the file is still there — the ui must not claim success')
    assert.equal(readFileSync(join(dir, 't.txt'), 'utf8'), 'v2\n', 'the tracked file really was not restored')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a directory of three plain files named like bare markers is not mistaken for a repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-lookalike-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs')
    mkdirSync(join(dir, 'plain'))
    writeFileSync(join(dir, 'plain', 'HEAD'), 'not a repo\n')
    writeFileSync(join(dir, 'plain', 'objects'), 'a file, not a directory\n')
    writeFileSync(join(dir, 'plain', 'refs'), 'a file, not a directory\n')
    // The bare-layout check types the markers: only a HEAD *file* beside
    // objects/ and refs/ *directories* counts, so this ordinary folder must
    // be discarded rather than refused as a repository.
    const config = { ...DEFAULT_CONFIG, maxChanges: 1 }
    await assertUntrackedDirectorySnapshot(depsAt(dir), config, ['plain'], true)
    const res = await runAction(depsAt(dir), config, { sessionId: SID, action: { kind: 'discard', paths: ['plain'] } })
    assert.equal(res.ok, true, 'files named like bare markers do not make a repository')
    assert.equal(existsSync(join(dir, 'plain')), false, 'the ordinary directory is discarded as a whole')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a bare repository whose objects/ is a symlink to a directory is still refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-baresym-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    await runGit(dir, ['init', '--bare', '-q', 'bare.git'])
    const { mkdirSync, symlinkSync, existsSync } = await import('node:fs')
    // Shared-object layouts point objects/ at a sibling directory. The marker
    // typing must follow the symlink: refusing is the safe direction here.
    rmSync(join(dir, 'bare.git', 'objects'), { recursive: true, force: true })
    mkdirSync(join(dir, 'shared-objects'))
    symlinkSync(join(dir, 'shared-objects'), join(dir, 'bare.git', 'objects'))
    const config = { ...DEFAULT_CONFIG, maxChanges: 1 }
    await assertUntrackedDirectorySnapshot(depsAt(dir), config, ['bare.git'], true)
    const res = await runAction(depsAt(dir), config, { sessionId: SID, action: { kind: 'discard', paths: ['bare.git'] } })
    assert.equal(res.ok, false, 'a bare repository with a symlinked objects/ is refused too')
    assert.equal(res.error.code, 'nested-repo')
    assert.equal(existsSync(join(dir, 'bare.git', 'HEAD')), true, 'the bare repository is intact')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a dangling objects symlink (shared store gone) is still refused as a repository', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-baredangle-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    await runGit(dir, ['init', '--bare', '-q', 'bare.git'])
    const { symlinkSync, existsSync, rmSync: rm } = await import('node:fs')
    // A shared-object layout whose target is not there right now (unmounted
    // volume, moved directory). refs/ and HEAD are still real data, so the
    // entry must count as a repository rather than be deleted as a stale dir.
    rm(join(dir, 'bare.git', 'objects'), { recursive: true, force: true })
    symlinkSync(join(dir, 'nowhere-objects'), join(dir, 'bare.git', 'objects'))
    const config = { ...DEFAULT_CONFIG, maxChanges: 1 }
    await assertUntrackedDirectorySnapshot(depsAt(dir), config, ['bare.git'], true)
    const res = await runAction(depsAt(dir), config, { sessionId: SID, action: { kind: 'discard', paths: ['bare.git'] } })
    assert.equal(res.ok, false, 'a bare repository with a dangling objects/ symlink is refused')
    assert.equal(res.error.code, 'nested-repo')
    assert.equal(existsSync(join(dir, 'bare.git', 'HEAD')), true, 'its HEAD/refs were not deleted')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a bare repository whose refs/ or HEAD is a dangling symlink is refused too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-baredangle2-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { writeFileSync, symlinkSync, existsSync, rmSync: rm } = await import('node:fs')
    // Same rule for the other two markers: an unreadable symlink is a store
    // that is not where it should be, not an ordinary untracked directory.
    await runGit(dir, ['init', '--bare', '-q', 'refs-link.git'])
    rm(join(dir, 'refs-link.git', 'refs'), { recursive: true, force: true })
    symlinkSync(join(dir, 'nowhere-refs'), join(dir, 'refs-link.git', 'refs'))
    const config = { ...DEFAULT_CONFIG, maxChanges: 2 }
    await assertUntrackedDirectorySnapshot(depsAt(dir), config, ['refs-link.git'], true)
    const viaRefs = await runAction(depsAt(dir), config, { sessionId: SID, action: { kind: 'discard', paths: ['refs-link.git'] } })
    assert.equal(viaRefs.ok, false, 'a dangling refs/ symlink stays a repository')
    assert.equal(viaRefs.error.code, 'nested-repo')
    assert.equal(existsSync(join(dir, 'refs-link.git', 'HEAD')), true, 'its HEAD was not deleted')

    // A plain directory whose HEAD is a dangling symlink, beside real objects/
    // and refs/ directories, is refused for the same reason.
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(dir, 'head-link', 'objects'), { recursive: true })
    mkdirSync(join(dir, 'head-link', 'refs'), { recursive: true })
    writeFileSync(join(dir, 'head-link', 'objects', 'x'), 'x\n')
    writeFileSync(join(dir, 'head-link', 'objects', 'y'), 'y\n')
    symlinkSync(join(dir, 'nowhere-head'), join(dir, 'head-link', 'HEAD'))
    await assertUntrackedDirectorySnapshot(depsAt(dir), config, ['head-link', 'refs-link.git'], true)
    const viaHead = await runAction(depsAt(dir), config, { sessionId: SID, action: { kind: 'discard', paths: ['head-link'] } })
    assert.equal(viaHead.ok, false, 'a dangling HEAD symlink stays a repository')
    assert.equal(viaHead.error.code, 'nested-repo')
    assert.equal(existsSync(join(dir, 'head-link')), true, 'the entry was not removed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a repository appearing after the batch pre-flight is caught by the per-path re-check', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-race-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs')
    mkdirSync(join(dir, 'morph'))
    await runGit(join(dir, 'morph'), ['init', '-q'])
    writeFileSync(join(dir, 'morph', 'x.txt'), 'x\n')
    const deps = depsAt(dir)
    await assertUntrackedDirectorySnapshot(deps, DEFAULT_CONFIG, ['morph'], false)
    // `morph` really is a nested repository, but the pre-flight's probe of its
    // `.git` misses (ENOENT) — the shape of a repository appearing after the
    // batch scan. Only the last-moment re-check in the remove loop sees it.
    const realStat = deps.fs.stat
    let probes = 0
    deps.fs.stat = async (p) => {
      if (p.endsWith(`${sep}morph${sep}.git`)) {
        probes += 1
        if (probes === 1) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e }
      }
      return realStat(p)
    }
    const res = await runAction(deps, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'discard', paths: ['morph'] } })
    assert.equal(res.ok, false, 'the racing repository is refused instead of deleted')
    assert.equal(res.error.code, 'nested-repo')
    assert.ok(probes >= 2, 'the entry was probed again immediately before removal')
    assert.equal(existsSync(join(dir, 'morph', '.git')), true, 'the repository that appeared mid-request is intact')
    assert.equal(existsSync(join(dir, 'morph', 'x.txt')), true, 'nothing inside it was removed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a mid-batch repository refusal says earlier paths were already deleted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-racepart-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { mkdirSync, writeFileSync, existsSync } = await import('node:fs')
    // `aa` sorts first and is deleted for real; `morph` is the repository whose
    // pre-flight probe is made to miss, so the refusal lands after `aa` is gone.
    mkdirSync(join(dir, 'aa'))
    writeFileSync(join(dir, 'aa', 'a.txt'), 'a\n')
    writeFileSync(join(dir, 'aa', 'b.txt'), 'b\n')
    mkdirSync(join(dir, 'morph'))
    await runGit(join(dir, 'morph'), ['init', '-q'])
    writeFileSync(join(dir, 'morph', 'x.txt'), 'x\n')
    const deps = depsAt(dir)
    // Two ordinary leaves plus the nested repository exceed the cap, while
    // both collapsed directory rows fit and can be classified by the action.
    const config = { ...DEFAULT_CONFIG, maxChanges: 2 }
    await assertUntrackedDirectorySnapshot(deps, config, ['aa', 'morph'], true)
    const realStat = deps.fs.stat
    let probes = 0
    deps.fs.stat = async (p) => {
      if (p.endsWith(`${sep}morph${sep}.git`)) {
        probes += 1
        if (probes === 1) { const e = new Error(`ENOENT: ${p}`); e.code = 'ENOENT'; throw e }
      }
      return realStat(p)
    }
    const res = await runAction(deps, config, { sessionId: SID, action: { kind: 'discard', paths: ['aa', 'morph'] } })
    assert.equal(res.ok, false)
    // A generic `nested-repo` here would claim the batch was untouched while
    // `aa` is already gone; the partial code is what makes the copy honest.
    assert.equal(res.error.code, 'nested-repo-partial')
    assert.match(res.error.message, /1 path\(s\) already removed/)
    assert.ok(probes >= 2, 'the repository was re-checked after the earlier deletion')
    assert.equal(existsSync(join(dir, 'aa')), false, 'the earlier path really was deleted')
    assert.equal(existsSync(join(dir, 'morph', '.git')), true, 'the repository is intact')
    assert.equal(existsSync(join(dir, 'morph', 'x.txt')), true, 'the later entry contents were not removed')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('snapshot counts reflect the full change set even when the list is truncated (H2)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-trunc-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { writeFileSync } = await import('node:fs')
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.txt`), 'x\n')
    const cap = { ...DEFAULT_CONFIG, maxChanges: 2 }
    const res = await snapshotForSession(depsAt(dir), cap, SID)
    assert.equal(res.ok, true)
    assert.equal(res.value.truncated, true)
    assert.equal(res.value.changes.length, 2, 'the list is capped')
    assert.equal(res.value.untracked, 5, 'but counts reflect all 5 files')
    assert.equal(res.value.dirty, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a huge change set skips the per-file stats fan-out and marks stats partial (issue #16)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-huge-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { writeFileSync } = await import('node:fs')
    // 250 untracked files > STATS_FANOUT_LIMIT (200): the untracked numstat
    // fan-out would otherwise spawn one `git diff --no-index` per file.
    for (let i = 0; i < 250; i++) writeFileSync(join(dir, `u${i}.txt`), 'a\nb\nc\n')
    const res = await snapshotForSession(depsAt(dir), DEFAULT_CONFIG, SID)
    assert.equal(res.ok, true)
    const st = res.value.stats
    assert.equal(st.untracked, 250, 'counts stay exact')
    assert.equal(st.fileCount, 250)
    assert.equal(st.partial, true, 'stats flagged partial above the fan-out limit')
    assert.equal(st.lastChangeAt, null, 'mtime fan-out skipped')
    assert.equal(st.insertions, 0, 'untracked line counting skipped (only tracked diffs counted)')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('snapshot expands an untracked directory into file entries (issue #41)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-expand-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'newdir', 'sub'), { recursive: true })
    writeFileSync(join(dir, 'newdir', 'a.txt'), 'a\nb\n')
    writeFileSync(join(dir, 'newdir', 'sub', 'b.txt'), 'c\n')
    const res = await snapshotForSession(depsAt(dir), DEFAULT_CONFIG, SID)
    assert.equal(res.ok, true)
    assert.deepEqual(res.value.changes.map((c) => c.path).sort(), ['newdir/a.txt', 'newdir/sub/b.txt'])
    assert.ok(res.value.changes.every((c) => c.status === 'untracked' && !c.isDirectory), 'untracked entries are file-level')
    assert.equal(res.value.untracked, 2)
    assert.equal(res.value.stats.fileCount, 2)
    assert.equal(res.value.stats.insertions, 3, 'untracked lines stay exact below the numstat ceiling')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a nested git repository keeps its single directory entry (issue #41)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-nested-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'nested'))
    await runGit(join(dir, 'nested'), ['init', '-q'])
    writeFileSync(join(dir, 'nested', 'x.txt'), 'x\n')
    const res = await snapshotForSession(depsAt(dir), DEFAULT_CONFIG, SID)
    assert.equal(res.ok, true)
    const nested = res.value.changes.find((c) => c.path === 'nested')
    assert.ok(nested, 'the nested repository is listed')
    assert.equal(nested.isDirectory, true, 'a nested repository cannot be expanded into files')
    assert.equal(nested.status, 'untracked')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('untracked line counting stops at its own ceiling (issue #41)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-numstat-cap-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { writeFileSync } = await import('node:fs')
    // Exactly the ceiling: the fan-out runs and the counts stay exact.
    for (let i = 0; i < 32; i++) writeFileSync(join(dir, `u${i}.txt`), 'a\nb\n')
    const exact = await snapshotForSession(depsAt(dir), DEFAULT_CONFIG, SID)
    assert.equal(exact.value.stats.untracked, 32)
    assert.equal(exact.value.stats.insertions, 64)
    assert.equal(exact.value.stats.partial, false)
    // One past it: counts stay exact but no per-file git process is spawned for
    // the untracked lines, so the stats degrade explicitly.
    writeFileSync(join(dir, 'u32.txt'), 'a\nb\n')
    const capped = await snapshotForSession(depsAt(dir), DEFAULT_CONFIG, SID)
    assert.equal(capped.value.stats.untracked, 33)
    assert.equal(capped.value.stats.insertions, 0, 'untracked line counting skipped past the ceiling')
    assert.equal(capped.value.stats.partial, true)
    assert.ok(capped.value.stats.lastChangeAt > 0, 'the cheap mtime pass still ran (its own ceiling is higher)')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a huge untracked directory falls back to collapsed entries instead of flooding the list (issue #41)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-collapse-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'newdir'))
    for (let i = 0; i < 4; i++) writeFileSync(join(dir, 'newdir', `f${i}.txt`), 'x\n')
    const res = await snapshotForSession(depsAt(dir), { ...DEFAULT_CONFIG, maxChanges: 2 }, SID)
    assert.equal(res.ok, true)
    assert.deepEqual(res.value.changes.map((c) => c.path), ['newdir'], 'the fallback collapses the untracked directory')
    assert.equal(res.value.changes[0].isDirectory, true)
    assert.equal(res.value.untrackedCollapsed, true, 'the snapshot says why the directory was not expanded')
    assert.equal(res.value.truncated, false, 'collapsing keeps the list within the cap')
    assert.equal(res.value.stats.untracked, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('truncatedReason reports the list cap when the change set overflows maxChanges (issue #41)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-reason-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const { writeFileSync } = await import('node:fs')
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.txt`), 'a\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'base'])
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.txt`), 'b\n')
    const res = await snapshotForSession(depsAt(dir), { ...DEFAULT_CONFIG, maxChanges: 2 }, SID)
    assert.equal(res.ok, true)
    assert.equal(res.value.truncated, true)
    assert.equal(res.value.truncatedReason, 'cap')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fullChanges lifts the list cap so an expanded snapshot carries every change', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-full-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const { writeFileSync } = await import('node:fs')
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.txt`), 'a\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'base'])
    for (let i = 0; i < 5; i++) writeFileSync(join(dir, `f${i}.txt`), 'b\n')
    const config = { ...DEFAULT_CONFIG, maxChanges: 2 }
    const capped = await snapshotForSession(depsAt(dir), config, SID)
    assert.equal(capped.ok, true)
    assert.equal(capped.value.truncated, true, 'the default cap truncates the list')
    assert.equal(capped.value.changes.length, 2, 'the capped list carries only the prefix')
    const full = await snapshotForSession(depsAt(dir), config, SID, { fullChanges: true })
    assert.equal(full.ok, true)
    assert.equal(full.value.truncated, false, 'the expanded snapshot is complete')
    assert.equal(full.value.changes.length, 5, 'every change arrives past the normal cap')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discard-all clears the working tree but keeps the index and never lies about a lossy status', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-discall-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const { writeFileSync, existsSync, readFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'tracked.txt'), 'original\n')
    writeFileSync(join(dir, 'staged.txt'), 'staged-base\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'base'])
    // Working-tree modification (unstaged) + a new untracked file + a staged
    // edit: discard-all must take the first two and leave the index alone.
    writeFileSync(join(dir, 'tracked.txt'), 'dirty\n')
    writeFileSync(join(dir, 'staged.txt'), 'staged-edit\n')
    await runGit(dir, ['add', 'staged.txt'])
    writeFileSync(join(dir, 'new.txt'), 'untracked\n')
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'discard-all' } })
    assert.equal(res.ok, true, JSON.stringify(res))
    assert.equal(readFileSync(join(dir, 'tracked.txt'), 'utf8'), 'original\n', 'the working-tree edit was restored')
    assert.equal(existsSync(join(dir, 'new.txt')), false, 'the untracked file was deleted')
    assert.equal(readFileSync(join(dir, 'staged.txt'), 'utf8'), 'staged-edit\n', 'the staged edit survives — discard-all never touches the index')
    assert.deepEqual(res.snapshot.changes.map((c) => [c.path, c.staged]), [['staged.txt', true]], 'only the staged row remains')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discard-all on a clean working tree is a no-op success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-discall0-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'discard-all' } })
    assert.equal(res.ok, true, 'nothing to discard is still a success')
    assert.equal(res.snapshot.changes.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('planAction refuses a raw discard-all instead of planning a bare restore', () => {
  const plan = planAction({ kind: 'discard-all' }, false)
  assert.ok('error' in plan, 'discard-all never reaches the planner from runAction')
})

test('diff of a clean tracked file is empty, not an all-new file (N4)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-clean-diff-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'tracked.txt'), 'line1\nline2\n')
    await runGit(dir, ['add', '.'])
    await runGit(dir, ['commit', '-qm', 'add tracked'])
    // A clean tracked path has no worktree diff; the --no-index synthesis must
    // NOT kick in (that would render the whole file as an addition).
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'tracked.txt', base: 'worktree' } })
    assert.equal(res.ok, true)
    assert.equal(res.value.text.trim(), '', 'clean tracked file yields an empty diff')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('history hash-jump ignores filters and returns total -1 (N5)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-hexjump-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'one'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'two'])
    const all = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 10, skip: 0 } })
    const head = all.value.commits[0].hash
    const jump = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 10, skip: 0, search: head } })
    assert.equal(jump.ok, true)
    assert.equal(jump.value.total, -1, 'hash-jump reports -1 (page-by-fill), not a fixed count')
    assert.ok(jump.value.commits.length >= 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('history keeps a detached HEAD chain visible (visible-refset rides HEAD)', async () => {
  // Bisect / rebase-in-flight / checkout <sha> shape: a commit no branch,
  // remote, or tag points at. The visible-refset walk must still list it
  // (`--all` officially covers refs/ "along with HEAD"); a branches-only
  // refset would drop it from the graph and desync the total count.
  const dir = mkdtempSync(join(tmpdir(), 'gp-detached-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'one'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'two'])
    const at = (expr) => execFileSync('git', ['rev-parse', expr], { cwd: dir, encoding: 'utf8' }).trim()
    const dangling = execFileSync(
      'git',
      ['commit-tree', at('HEAD^{tree}'), '-p', at('HEAD'), '-m', 'detached'],
      { cwd: dir, encoding: 'utf8' },
    ).trim()
    await runGit(dir, ['checkout', '-q', '--detach', dangling])
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 10, skip: 0 } })
    assert.equal(res.ok, true)
    assert.equal(res.value.kind, 'history')
    assert.ok(
      res.value.commits.some((c) => c.hash === dangling),
      'the ref-less detached HEAD commit must appear in the history',
    )
    assert.equal(res.value.total, 3, 'page log and count share the refset')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('image-diff refuses a worktree symlink escaping the repo root (N6)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-symlink-'))
  const secret = mkdtempSync(join(tmpdir(), 'gp-secret-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    await runGit(dir, ['commit', '--allow-empty', '-qm', 'init'])
    const { writeFileSync, symlinkSync } = await import('node:fs')
    writeFileSync(join(secret, 'secret.png'), 'SECRET-BYTES-OUTSIDE-REPO')
    // A .png symlink in the worktree pointing outside the repo root.
    symlinkSync(join(secret, 'secret.png'), join(dir, 'evil.png'))
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'image-diff', path: 'evil.png', base: 'worktree' } })
    assert.equal(res.ok, true)
    // The escaping side is refused → no bytes leak into the pane.
    assert.equal(res.value.new, undefined, 'symlinked-out file is not read into the image pane')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(secret, { recursive: true, force: true })
  }
})

test('file-content refuses a worktree symlink escaping the repo root', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-fc-esc-'))
  const secret = mkdtempSync(join(tmpdir(), 'gp-fc-secret-'))
  try {
    await runGit(dir, ['init', '-q'])
    const { writeFileSync, symlinkSync } = await import('node:fs')
    writeFileSync(join(secret, 'id_rsa'), 'PRIVATE-KEY-OUTSIDE-REPO')
    symlinkSync(join(secret, 'id_rsa'), join(dir, 'leak.txt'))
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'leak.txt' } })
    assert.equal(res.ok, false, 'a symlink escaping the root is refused')
    assert.equal(res.error.code, 'invalid-path')
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(secret, { recursive: true, force: true })
  }
})

/** Build a throwaway repo with one commit and a dirty working file. */
async function freshRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  await runGit(dir, ['init', '-q'])
  await runGit(dir, ['config', 'user.email', 't@t.co'])
  await runGit(dir, ['config', 'user.name', 'Tester'])
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  await runGit(dir, ['add', 'a.txt'])
  await runGit(dir, ['commit', '-qm', 'init'])
  return dir
}

test('tag-create (lightweight + annotated) then tag-delete flow through run + tags query', async () => {
  const dir = await freshRepo('gp-tag-')
  try {
    const d = depsAt(dir)
    const head = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 1, skip: 0 } })
    const hash = head.value.commits[0].hash
    const light = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'tag-create', name: 'v1.0', commit: hash } })
    assert.equal(light.ok, true, 'lightweight tag created')
    const ann = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'tag-create', name: 'v2.0', commit: hash, message: 'release two' } })
    assert.equal(ann.ok, true, 'annotated tag created')
    const listed = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'tags' } })
    const names = listed.value.tags.map((t) => t.name).sort()
    assert.deepEqual(names, ['v1.0', 'v2.0'])
    const del = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'tag-delete', name: 'v1.0' } })
    assert.equal(del.ok, true, 'tag deleted')
    const after = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'tags' } })
    assert.deepEqual(after.value.tags.map((t) => t.name), ['v2.0'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tag-delete of a missing tag maps to not-found', async () => {
  const dir = await freshRepo('gp-tag-nf-')
  try {
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'tag-delete', name: 'nope' } })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'not-found')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stash push → list → apply → drop lifecycle', async () => {
  const dir = await freshRepo('gp-stash-')
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\n')
    const push = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'stash-push', message: 'wip change' } })
    assert.equal(push.ok, true, 'stash push ok')
    assert.equal(push.snapshot.dirty, false, 'work tree clean after stash')
    const list = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })
    assert.equal(list.value.entries.length, 1)
    assert.equal(list.value.entries[0].index, 0)
    assert.equal(list.value.entries[0].message, 'wip change')
    assert.match(list.value.entries[0].sha, /^[0-9a-f]{7,64}$/, 'stash entry carries a SHA')
    const sha = list.value.entries[0].sha
    const apply = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'stash-apply', index: 0, sha } })
    assert.equal(apply.ok, true, 'apply restores the change')
    assert.equal(apply.snapshot.dirty, true, 'work tree dirty again')
    const stillThere = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })
    assert.equal(stillThere.value.entries.length, 1, 'apply keeps the stash entry')
    const drop = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'stash-drop', index: 0, sha } })
    assert.equal(drop.ok, true, 'drop ok')
    const empty = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })
    assert.equal(empty.value.entries.length, 0, 'stack empty after drop')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stash-push with only untracked files reports failure (not a silent no-op)', async () => {
  const dir = await freshRepo('gp-stash-ut-')
  try {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'brand-new.txt'), 'untracked only\n')
    const push = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'stash-push', message: 'x' } })
    assert.equal(push.ok, false, 'nothing to stash is a failure, not ok')
    assert.match(push.error.message ?? '', /No local changes to save/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a stale stash index/sha is rejected before the destructive op runs', async () => {
  const dir = await freshRepo('gp-stash-stale-')
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'a.txt'), 'first\n')
    await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'stash-push', message: 'first' } })
    const list = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })
    const staleSha = list.value.entries[0].sha
    // A second stash pushes to index 0 and shifts the first to index 1; the
    // client still holds the OLD (index 0, staleSha) pairing.
    writeFileSync(join(dir, 'a.txt'), 'second\n')
    await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'stash-push', message: 'second' } })
    const drop = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'stash-drop', index: 0, sha: staleSha } })
    assert.equal(drop.ok, false, 'index 0 now holds a different stash → rejected')
    assert.equal(drop.error.code, 'not-found')
    const after = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })
    assert.equal(after.value.entries.length, 2, 'nothing was dropped')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stash pop that conflicts reports conflict and keeps the stash entry', async () => {
  const dir = await freshRepo('gp-stash-cf-')
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    // Stash an edit, then commit a *different* edit to the same line; popping
    // now triggers a real 3-way merge conflict (not a "local changes" refusal),
    // and git keeps the stash entry so recovery stays possible.
    writeFileSync(join(dir, 'a.txt'), 'stashed\n')
    await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'stash-push', message: 'first' } })
    const sha = (await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })).value.entries[0].sha
    writeFileSync(join(dir, 'a.txt'), 'committed\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'conflicting commit'])
    const pop = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'stash-pop', index: 0, sha } })
    assert.equal(pop.ok, false, 'pop into a conflicting commit fails')
    assert.equal(pop.error.code, 'conflict')
    const kept = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'stash-list' } })
    assert.equal(kept.value.entries.length, 1, 'conflicted pop keeps the stash entry')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('revert appends a reverse commit and undoes the change (work tree kept)', async () => {
  const dir = await freshRepo('gp-revert-')
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: two'])
    const head = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 1, skip: 0 } })
    const hash = head.value.commits[0].hash
    const res = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'revert', commit: hash } })
    assert.equal(res.ok, true, 'revert succeeds')
    assert.equal((await readFile(join(dir, 'a.txt'), 'utf8')), 'one\n', 'the change is undone on disk')
    const msg = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'last-commit-message' } })
    assert.match(msg.value.message, /^Revert /, 'HEAD is a reverse commit')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('revert into a conflicting dirty work tree is refused (local-changes-block)', async () => {
  const dir = await freshRepo('gp-revert-dirty-')
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: two'])
    const hash = (await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 1, skip: 0 } })).value.commits[0].hash
    // An uncommitted edit to the same file git would overwrite on revert.
    writeFileSync(join(dir, 'a.txt'), 'local edit\n')
    const res = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'revert', commit: hash } })
    assert.equal(res.ok, false, 'revert refuses rather than clobbering the dirty file')
    assert.equal(res.error.code, 'local-changes-block')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a content-conflicting revert is auto-aborted and reported as revert-conflict', async () => {
  const dir = await freshRepo('gp-revert-cf-')
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    // init(a=one) → two(a=two) → three(a=three). Reverting the middle "two"
    // commit while HEAD is "three" produces a content conflict on a.txt.
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'two'])
    const two = (await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 1, skip: 0 } })).value.commits[0].hash
    writeFileSync(join(dir, 'a.txt'), 'three\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'three'])
    const res = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'revert', commit: two } })
    assert.equal(res.ok, false, 'the conflicting revert fails')
    assert.equal(res.error.code, 'revert-conflict')
    // Auto-abort cleared the sequencer: no REVERT_HEAD, work tree intact + clean.
    assert.throws(() => execFileSync('git', ['rev-parse', '--verify', '--quiet', 'REVERT_HEAD'], { cwd: dir }), 'REVERT_HEAD is gone (revert aborted)')
    assert.equal((await readFile(join(dir, 'a.txt'), 'utf8')), 'three\n', 'the work tree is restored')
    const snap = await snapshotForSession(d, DEFAULT_CONFIG, SID)
    assert.equal(snap.value.dirty, false, 'no half-applied conflict left behind')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reverting a merge commit is reported as revert-merge, leaving no stuck state', async () => {
  const dir = await freshRepo('gp-revert-merge-')
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    const base = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
    // Diverge a feature branch and the base on different files, then merge
    // --no-ff so HEAD is a (conflict-free) merge commit.
    await runGit(dir, ['checkout', '-q', '-b', 'feature'])
    writeFileSync(join(dir, 'c.txt'), 'c\n')
    await runGit(dir, ['add', 'c.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: c'])
    await runGit(dir, ['checkout', '-q', base])
    writeFileSync(join(dir, 'd.txt'), 'd\n')
    await runGit(dir, ['add', 'd.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: d'])
    await runGit(dir, ['merge', '--no-ff', '-m', 'merge feature', 'feature'])
    const mergeSha = (await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 1, skip: 0 } })).value.commits[0].hash
    const res = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'revert', commit: mergeSha } })
    assert.equal(res.ok, false, 'reverting a merge commit from the panel is refused')
    assert.equal(res.error.code, 'revert-merge')
    // git refuses before creating REVERT_HEAD → no mid-revert state, no spurious abort.
    assert.throws(() => execFileSync('git', ['rev-parse', '--verify', '--quiet', 'REVERT_HEAD'], { cwd: dir }), 'no REVERT_HEAD left behind')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reset --mixed moves HEAD back and keeps the change in the work tree', async () => {
  const dir = await freshRepo('gp-reset-mixed-')
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: two'])
    const hist = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 5, skip: 0 } })
    const first = hist.value.commits.find((c) => c.subject === 'init').hash
    const res = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'reset', commit: first, mode: 'mixed' } })
    assert.equal(res.ok, true, 'reset --mixed succeeds')
    assert.equal(res.snapshot.dirty, true, 'the undone change is now uncommitted')
    assert.equal((await readFile(join(dir, 'a.txt'), 'utf8')), 'two\n', 'the file content is retained')
    const msg = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'last-commit-message' } })
    assert.equal(msg.value.message, 'init', 'HEAD moved back to the first commit')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reset --hard moves HEAD back and discards the work-tree change', async () => {
  const dir = await freshRepo('gp-reset-hard-')
  try {
    const d = depsAt(dir)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'a.txt'), 'two\n')
    await runGit(dir, ['add', 'a.txt'])
    await runGit(dir, ['commit', '-qm', 'feat: two'])
    const first = (await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 5, skip: 0 } })).value.commits.find((c) => c.subject === 'init').hash
    const res = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'reset', commit: first, mode: 'hard' } })
    assert.equal(res.ok, true, 'reset --hard succeeds')
    assert.equal(res.snapshot.dirty, false, 'the work tree is clean after a hard reset')
    assert.equal((await readFile(join(dir, 'a.txt'), 'utf8')), 'one\n', 'the change is discarded on disk')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reset to a nonexistent commit maps to not-found', async () => {
  const dir = await freshRepo('gp-reset-nf-')
  try {
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'reset', commit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', mode: 'mixed' } })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'not-found')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reset / revert reject an option-injecting commit', async () => {
  const dir = await freshRepo('gp-undo-inject-')
  try {
    const d = depsAt(dir)
    const r1 = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'reset', commit: '--hard', mode: 'hard' } })
    assert.equal(r1.ok, false)
    assert.equal(r1.error.code, 'invalid-name')
    const r2 = await runAction(d, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'revert', commit: '-n' } })
    assert.equal(r2.ok, false)
    assert.equal(r2.error.code, 'invalid-name')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull-preview on a branch without an upstream reports hasUpstream:false', async () => {
  const dir = await freshRepo('gp-pp-noup-')
  try {
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'pull-preview' } })
    assert.equal(res.ok, true)
    assert.equal(res.value.kind, 'pull-preview')
    assert.equal(res.value.hasUpstream, false)
    assert.equal(res.value.commits, 0)
    assert.equal(res.value.files, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pull-preview reports the incoming fast-forward scope (commits/files/+-lines)', async () => {
  const { writeFileSync } = await import('node:fs')
  const base = mkdtempSync(join(tmpdir(), 'gp-pp-up-'))
  const origin = join(base, 'origin.git')
  const a = join(base, 'a')
  const b = join(base, 'b')
  try {
    // `--initial-branch` pins origin's HEAD: a bare repo created without it
    // points HEAD at the machine's default branch name, and `git push` never
    // repoints an unborn HEAD, so B's clone below would land on a branch with
    // no upstream wherever that default is not `main` (CI runners: master).
    execFileSync('git', ['init', '-q', '--bare', '--initial-branch=main', origin])
    // Clone A, seed one commit, push main as the upstream.
    execFileSync('git', ['clone', '-q', origin, a])
    await runGit(a, ['config', 'user.email', 't@t.co'])
    await runGit(a, ['config', 'user.name', 'Tester'])
    writeFileSync(join(a, 'f1.txt'), 'l1\nl2\nl3\n')
    await runGit(a, ['add', 'f1.txt'])
    await runGit(a, ['commit', '-qm', 'c1'])
    await runGit(a, ['branch', '-M', 'main'])
    await runGit(a, ['push', '-q', '-u', 'origin', 'main'])
    // Clone B from the same origin — its main tracks origin/main, up to date.
    execFileSync('git', ['clone', '-q', origin, b])
    await runGit(b, ['config', 'user.email', 't@t.co'])
    await runGit(b, ['config', 'user.name', 'Tester'])
    // A advances origin by one commit touching two files.
    writeFileSync(join(a, 'f1.txt'), 'l1\nl2-changed\nl3\nl4\n')
    writeFileSync(join(a, 'f2.txt'), 'new1\nnew2\n')
    await runGit(a, ['add', '.'])
    await runGit(a, ['commit', '-qm', 'c2'])
    await runGit(a, ['push', '-q'])
    // B fetches (objects now local) → it is one commit behind.
    await runGit(b, ['fetch', '-q'])
    const res = await runQuery(depsAt(b), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'pull-preview' } })
    assert.equal(res.ok, true)
    assert.equal(res.value.kind, 'pull-preview')
    assert.equal(res.value.hasUpstream, true)
    assert.equal(res.value.commits, 1, 'one commit behind')
    assert.equal(res.value.files, 2, 'two files changed (f1 modified, f2 added)')
    assert.ok(res.value.insertions >= 3, 'incoming insertions counted')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('push-preview on a branch without an upstream reports hasUpstream:false', async () => {
  const dir = await freshRepo('gp-push-noup-')
  try {
    const res = await runQuery(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'push-preview' } })
    assert.equal(res.ok, true)
    assert.equal(res.value.kind, 'push-preview')
    assert.equal(res.value.hasUpstream, false)
    assert.equal(res.value.commits, 0)
    assert.equal(res.value.files, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('push-preview reports the outgoing scope (commits/files/+-lines)', async () => {
  const { writeFileSync } = await import('node:fs')
  const base = mkdtempSync(join(tmpdir(), 'gp-push-up-'))
  const origin = join(base, 'origin.git')
  const a = join(base, 'a')
  try {
    execFileSync('git', ['init', '-q', '--bare', origin])
    execFileSync('git', ['clone', '-q', origin, a])
    await runGit(a, ['config', 'user.email', 't@t.co'])
    await runGit(a, ['config', 'user.name', 'Tester'])
    writeFileSync(join(a, 'f1.txt'), 'l1\nl2\nl3\n')
    await runGit(a, ['add', 'f1.txt'])
    await runGit(a, ['commit', '-qm', 'c1'])
    await runGit(a, ['branch', '-M', 'main'])
    await runGit(a, ['push', '-q', '-u', 'origin', 'main'])
    // Two local commits touching two files, not yet pushed → strictly ahead.
    writeFileSync(join(a, 'f1.txt'), 'l1\nl2-changed\nl3\nl4\n')
    await runGit(a, ['commit', '-aqm', 'c2'])
    writeFileSync(join(a, 'f2.txt'), 'new1\nnew2\n')
    await runGit(a, ['add', 'f2.txt'])
    await runGit(a, ['commit', '-qm', 'c3'])
    const res = await runQuery(depsAt(a), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'push-preview' } })
    assert.equal(res.ok, true)
    assert.equal(res.value.kind, 'push-preview')
    assert.equal(res.value.hasUpstream, true)
    assert.equal(res.value.commits, 2, 'two commits ahead')
    assert.equal(res.value.files, 2, 'two files changed (f1 modified, f2 added)')
    assert.ok(res.value.insertions >= 3, 'outgoing insertions counted')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('push advances the upstream when strictly ahead', async () => {
  const { writeFileSync } = await import('node:fs')
  const base = mkdtempSync(join(tmpdir(), 'gp-push-act-'))
  const origin = join(base, 'origin.git')
  const a = join(base, 'a')
  try {
    execFileSync('git', ['init', '-q', '--bare', origin])
    execFileSync('git', ['clone', '-q', origin, a])
    await runGit(a, ['config', 'user.email', 't@t.co'])
    await runGit(a, ['config', 'user.name', 'Tester'])
    writeFileSync(join(a, 'f1.txt'), 'x\n')
    await runGit(a, ['add', 'f1.txt'])
    await runGit(a, ['commit', '-qm', 'c1'])
    await runGit(a, ['branch', '-M', 'main'])
    await runGit(a, ['push', '-q', '-u', 'origin', 'main'])
    writeFileSync(join(a, 'f1.txt'), 'x\ny\n')
    await runGit(a, ['commit', '-aqm', 'c2'])
    const res = await runAction(depsAt(a), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'push' } })
    assert.equal(res.ok, true)
    // Origin now points at the local tip; the snapshot is back to synced.
    const local = execFileSync('git', ['-C', a, 'rev-parse', 'HEAD']).toString().trim()
    const remoteTip = execFileSync('git', ['--git-dir', origin, 'rev-parse', 'refs/heads/main']).toString().trim()
    assert.equal(remoteTip, local, 'origin/main fast-forwarded to the pushed tip')
    assert.equal(res.snapshot.ahead, 0)
    assert.equal(res.snapshot.behind, 0)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('publish creates the remote branch and sets upstream (push -u)', async () => {
  const { writeFileSync } = await import('node:fs')
  const base = mkdtempSync(join(tmpdir(), 'gp-publish-'))
  const origin = join(base, 'origin.git')
  const a = join(base, 'a')
  try {
    execFileSync('git', ['init', '-q', '--bare', origin])
    execFileSync('git', ['clone', '-q', origin, a])
    await runGit(a, ['config', 'user.email', 't@t.co'])
    await runGit(a, ['config', 'user.name', 'Tester'])
    writeFileSync(join(a, 'f1.txt'), 'x\n')
    await runGit(a, ['add', 'f1.txt'])
    await runGit(a, ['commit', '-qm', 'c1'])
    await runGit(a, ['branch', '-M', 'feature/x'])
    // No upstream yet: snapshot reflects that before publishing.
    const before = await snapshotForSession(depsAt(a), DEFAULT_CONFIG, SID)
    assert.equal(before.ok, true)
    assert.equal(before.value.hasUpstream, false)
    const res = await runAction(depsAt(a), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'publish', remote: before.value.remote.name } })
    assert.equal(res.ok, true)
    // The same-named branch now exists on origin and HEAD tracks it.
    const remoteTip = execFileSync('git', ['--git-dir', origin, 'rev-parse', 'refs/heads/feature/x']).toString().trim()
    const local = execFileSync('git', ['-C', a, 'rev-parse', 'HEAD']).toString().trim()
    assert.equal(remoteTip, local)
    assert.equal(res.snapshot.hasUpstream, true, 'upstream set after publish')
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('publish rejects a hostile remote name before spawning git', async () => {
  const dir = await freshRepo('gp-publish-bad-')
  try {
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'publish', remote: '--upload-pack=touch /tmp/pwn' } })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'invalid-name')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('publish refuses a detached HEAD instead of leaking a git refspec hint', async () => {
  const dir = await freshRepo('gp-publish-detached-')
  try {
    await runGit(dir, ['checkout', '-q', '--detach'])
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'publish', remote: 'origin' } })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'no-branch')
    assert.ok(!/refspec|full refname/i.test(res.error.message ?? ''), 'no raw git hint reaches the client')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('publish reports a branch probe that never ran as itself, not as a detached HEAD', async () => {
  const dir = await freshRepo('gp-publish-probe-')
  // Fail only the publish branch probe; workspace resolution and the unborn
  // check still run for real against the temp repo.
  const failing = {
    spawn(spec) {
      if (spec.argv.includes('symbolic-ref') && spec.argv.includes('--short')) throw new Error('spawn git ENOENT')
      return subprocess.spawn(spec)
    },
  }
  try {
    const deps = { ...depsAt(dir), run: createGitRunner(failing, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes) }
    const res = await runAction(deps, DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'publish', remote: 'origin' } })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'git-unavailable', 'a probe that never ran says nothing about the branch')
    assert.match(res.error.message ?? '', /ENOENT/, 'the underlying spawn failure rides along')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('publish refuses a repository with no commits to send', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gp-publish-unborn-'))
  try {
    await runGit(dir, ['init', '-q'])
    await runGit(dir, ['config', 'user.email', 't@t.co'])
    await runGit(dir, ['config', 'user.name', 'Tester'])
    const res = await runAction(depsAt(dir), DEFAULT_CONFIG, { sessionId: SID, action: { kind: 'publish', remote: 'origin' } })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'no-branch')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
