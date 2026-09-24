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
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { snapshotForSession, runAction, runQuery, createGitRunner, DEFAULT_CONFIG } from '../../lib/host/index.js'

let repo
const SID = 'test-session'

/** child_process-backed subprocess service matching SubprocessLike. */
const subprocess = {
  spawn(spec) {
    const child = nodeSpawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd })
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

function deps() {
  return {
    run: createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes),
    fs: { realpath, stat: (p) => stat(p) },
    sessions: { liveCwd: () => repo, persistedMeta: async () => undefined },
  }
}

before(async () => {
  repo = mkdtempSync(join(tmpdir(), 'gp-it-'))
  await runGit(repo, ['init', '-q'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'init: first commit'])
  // one committed file, then modify it + add an untracked file
  await runGit(repo, ['-c', 'core.autocrlf=false', 'stash'])
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(repo, 'a.txt'), 'line1\n')
  await runGit(repo, ['add', 'a.txt'])
  await runGit(repo, ['commit', '-qm', 'feat: add a'])
  writeFileSync(join(repo, 'a.txt'), 'line1\nline2\n')
  writeFileSync(join(repo, 'd.txt'), 'new\n')
})

after(() => { if (repo) rmSync(repo, { recursive: true, force: true }) })

test('snapshot reports branch, dirty, and the change set', async () => {
  const res = await snapshotForSession(deps(), DEFAULT_CONFIG, SID)
  assert.equal(res.ok, true)
  const s = res.value
  assert.equal(s.dirty, true)
  assert.ok(s.branch === 'main' || s.branch === 'master')
  const paths = s.changes.map((c) => c.path).sort()
  assert.deepEqual(paths, ['a.txt', 'd.txt'])
  assert.equal(s.changes.find((c) => c.path === 'd.txt').status, 'untracked')
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
  assert.match(tracked.value.text, /\+line2/)
  const untracked = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'diff', path: 'd.txt', base: 'worktree' } })
  assert.equal(untracked.ok, true)
  assert.match(untracked.value.text, /\+new/)
})

test('show returns commit meta + changed files', async () => {
  const hist = await runQuery(deps(), DEFAULT_CONFIG, { sessionId: SID, query: { kind: 'history', limit: 5, skip: 0 } })
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
