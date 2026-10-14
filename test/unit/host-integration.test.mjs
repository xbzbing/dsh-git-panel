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
import { realpath, readFile, readdir, rm, stat, lstat, readlink } from 'node:fs/promises'
import { snapshotForSession, runAction, runQuery, createGitRunner, DEFAULT_CONFIG, normalizeConfig } from '../../lib/host/index.js'
import { DIFF_CONTEXT_DEFAULT, DIFF_CONTEXT_MAX, DIFF_COUNT_READ_MAX } from '../../lib/host/types.js'

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
      // Same shape as the production wiring: the link target text, else null.
      symlinkTarget: async (p) => {
        try { return (await lstat(p)).isSymbolicLink() ? await readlink(p) : null } catch { return null }
      },
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
  // DIFF_CONTEXT_DEFAULT is what the host applies when the request omits
  // `context`, DIFF_CONTEXT_MAX is both the clamp ceiling and the client's
  // expand-all request, and DIFF_COUNT_READ_MAX bounds the working-file read
  // that only feeds the count. A silent edit here changes behaviour on both
  // sides, so the magnitudes are asserted (as SUGGEST_LIMITS is).
  assert.equal(DIFF_CONTEXT_DEFAULT, 3, "matches git's own -U default")
  assert.equal(DIFF_CONTEXT_MAX, 100000)
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
  // The runner drops output at its collect/spill ceiling; the surviving prefix
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
  const slice = await runQuery(d, DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'file-lines', path: 'a.txt', base: 'staged', start: 1, end: 3 } })
  assert.equal(slice.ok, false, 'expansion must not serve a truncated prefix')
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

test('show on a merge commit yields empty stats and 0/0 lines', async () => {
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
    assert.equal(head.value.stats.length, 0, 'merge file list empty (git show default)')
    assert.equal(head.value.insertions, 0)
    assert.equal(head.value.deletions, 0)
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
    execFileSync('git', ['init', '-q', '--bare', origin])
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
