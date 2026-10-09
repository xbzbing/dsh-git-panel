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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath, readFile, readdir, rm, stat } from 'node:fs/promises'
import { snapshotForSession, runAction, runQuery, createGitRunner, DEFAULT_CONFIG, normalizeConfig } from '../../lib/host/index.js'

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
    fs: {
      realpath, stat: (p) => stat(p), readFile: (p) => readFile(p),
      readdir: async (p) => (await readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
      remove: (p) => rm(p, { force: true }),
    },
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

test('worktree-stats totals files and +/- lines, plus times', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'worktree-stats' } })
  assert.equal(res.ok, true)
  const st = res.value.stats
  assert.equal(st.fileCount, 2)
  assert.equal(st.untracked, 1)
  assert.ok(st.insertions >= 2, 'a.txt +1 and d.txt +1 at least')
  assert.ok(st.lastChangeAt !== null)
  assert.ok(typeof st.headCommittedAt === 'string')
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
  const wide = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'a.txt', base: 'worktree', context: 100000 } })
  assert.equal(tight.ok, true)
  assert.equal(wide.ok, true)
  assert.doesNotMatch(tight.value.text, /^ line1$/m, 'default context omits the first line')
  assert.match(wide.value.text, /^ line1$/m, 'expand-all includes the first line')
  assert.match(wide.value.text, /^ line20$/m, 'expand-all includes the last line')
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
    const { writeFileSync, mkdirSync, symlinkSync } = await import('node:fs')
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
})

test('file-content flags an over-cap file as tooLarge', async () => {
  const tinyCap = { ...DEFAULT_CONFIG, maxBytes: 4 }
  const res = await runQuery(deps(), tinyCap, { sessionId: SID, query: { kind: 'file-content', path: 'a.txt' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.tooLarge, true)
})

test('file-content serves an image as a data URL', async () => {
  const res = await runQuery(depsAt(repoImg), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'img.png' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.variant, 'image')
  assert.ok(res.value.dataUrl.startsWith('data:image/png;base64,'))
})

test('file-content marks a NUL-containing file as binary', async () => {
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(repo, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00, 0x41]))
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: 'blob.bin' } })
  assert.equal(res.ok, true)
  assert.equal(res.value.variant, 'binary')
  assert.equal(res.value.content, undefined)
})

test('file-content rejects an unsafe path', async () => {
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-content', path: '../../etc/hosts' } })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid-path')
})

test('show returns commit meta + changed files', async () => {  const hist = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 5, skip: 0 } })
  const ref = hist.value.commits.find((c) => c.subject.includes('add a')).hash
  const res = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'show', ref } })
  assert.equal(res.ok, true)
  assert.equal(res.value.commit.subject, 'feat: add a')
  assert.ok(res.value.stats.some((s) => s.path === 'a.txt'))
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
