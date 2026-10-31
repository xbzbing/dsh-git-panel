/**
 * Host topology tests: the bounded raw-ancestry walk behind a filtered history
 * page. Pure parsing, fake-runner failure paths (the walk must never cost the
 * history page), and real git through runQuery — a filter that hides an
 * interval and one that hides a merge.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import './_tmp-ceiling.mjs'
import { spawn as nodeSpawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath, readFile, readdir, rm, stat, lstat, readlink } from 'node:fs/promises'
import { parseGraphNodes, walkHistoryTopology, HISTORY_TOPOLOGY_LIMIT, HISTORY_TOPOLOGY_MAX_BYTES } from '../../lib/host/history-topology.js'
import { runQuery, createGitRunner, DEFAULT_CONFIG } from '../../lib/host/index.js'

const H1 = 'a'.repeat(40)
const H2 = 'b'.repeat(40)
const H3 = 'c'.repeat(40)
const H4 = 'd'.repeat(40)

// ── parsing ───────────────────────────────────────────────────────────────

test('parseGraphNodes reads hash + parents per line, de-duplicating by hash', () => {
  assert.deepEqual(parseGraphNodes(`${H1} ${H2} ${H3}\n${H2} ${H4}\n${H4}\n`), [
    { hash: H1, parents: [H2, H3] },
    { hash: H2, parents: [H4] },
    { hash: H4, parents: [] },
  ])
})

test('parseGraphNodes accepts sha256-length ids', () => {
  const a = 'a'.repeat(64)
  const b = 'b'.repeat(64)
  assert.deepEqual(parseGraphNodes(`${a} ${b}\n`), [{ hash: a, parents: [b] }])
})

test('parseGraphNodes returns [] for an empty walk', () => {
  assert.deepEqual(parseGraphNodes(''), [])
  assert.deepEqual(parseGraphNodes('\n\n'), [])
})

test('parseGraphNodes rejects a malformed line rather than inventing a root', () => {
  // A truncated hash, a junk parent, and a short-hex line must all fail loudly:
  // a partial walk is not a complete ancestry, and a truncated line must never
  // read as a parentless root.
  assert.equal(parseGraphNodes('deadbeef\n'), null)
  assert.equal(parseGraphNodes(`${H1} zzzz\n`), null)
  assert.equal(parseGraphNodes(`${H1} ${H2}\nnothex\n`), null)
  assert.equal(parseGraphNodes(`${H1} ${H2.slice(0, 39)}\n`), null)
})

test('parseGraphNodes rejects a capture with no trailing newline', () => {
  // git terminates every line, so a missing final \n means the read was cut —
  // and a cut that lands exactly on a 40-char hash would otherwise read as a
  // valid parentless root.
  assert.equal(parseGraphNodes(H1), null, 'a lone 40-char hash is a cut, not a root')
  assert.equal(parseGraphNodes(`${H1} ${H2}`), null, 'a cut right after a parent hash')
  assert.equal(parseGraphNodes(`${H1} ${H2.slice(0, 20)}`), null, 'a cut mid-parent')
  // The same content, properly terminated, is accepted.
  assert.deepEqual(parseGraphNodes(`${H1}\n`), [{ hash: H1, parents: [] }])
})

test('parseGraphNodes enforces the node and byte budgets at the entry', () => {
  const node = (i) => `${i.toString(16).padStart(40, '0')}\n`
  const many = (n) => Array.from({ length: n }, (_, i) => node(i)).join('')
  assert.equal(parseGraphNodes(many(HISTORY_TOPOLOGY_LIMIT)).length, HISTORY_TOPOLOGY_LIMIT, 'exactly at the node cap is fine')
  assert.equal(parseGraphNodes(many(HISTORY_TOPOLOGY_LIMIT + 1)), null, 'one line over the cap is rejected')
  // A byte-over-budget capture is rejected even when its line count is small:
  // one octopus commit can carry an enormous parent list.
  const octopus = `${H1} ${Array.from({ length: 60000 }, () => H2).join(' ')}\n`
  assert.ok(Buffer.byteLength(octopus, 'utf8') > HISTORY_TOPOLOGY_MAX_BYTES, 'fixture is over the byte cap')
  assert.equal(parseGraphNodes(octopus), null)
})

// ── the walk itself (fake runner) ─────────────────────────────────────────

const okRun = (stdout) => ({ exitCode: 0, stdout, stderr: '', timedOut: false, cancelled: false, stdoutLossy: false })

function fakeRunner(result) {
  const calls = []
  return {
    calls,
    runner: { run: async (argv, opts) => { calls.push({ argv: [...argv], opts }); return result } },
  }
}

test('walkHistoryTopology asks for one bounded, unfiltered parent walk', async () => {
  const fake = fakeRunner(okRun(`${H1} ${H2}\n${H2}\n`))
  const nodes = await walkHistoryTopology(fake.runner, '/repo', [H1])
  assert.deepEqual(nodes, [{ hash: H1, parents: [H2] }, { hash: H2, parents: [] }])
  assert.deepEqual(fake.calls[0].argv, [
    'git', 'rev-list', '--parents', `--max-count=${HISTORY_TOPOLOGY_LIMIT}`, '--end-of-options', H1,
  ])
  assert.equal(fake.calls[0].opts.cwd, '/repo')
  // No filter may ride along: the whole point is the ancestry the page hid.
  for (const flag of ['--grep=', '--author=', '--since=', '--branches', '--remotes', '--tags', 'HEAD', '--topo-order']) {
    assert.equal(fake.calls[0].argv.some((a) => a === flag || a.startsWith(flag)), false, `no ${flag}`)
  }
})

test('walkHistoryTopology degrades to [] on every failure path', async () => {
  const cases = {
    'non-zero exit': okRun(''),
    'timeout': { ...okRun(`${H1}\n`), timedOut: true },
    'cancel': { ...okRun(`${H1}\n`), cancelled: true },
    'lossy output': { ...okRun(`${H1}\n`), stdoutLossy: true },
    'malformed output': okRun('not-a-hash\n'),
  }
  for (const [label, result] of Object.entries(cases)) {
    const fake = fakeRunner({ ...result, ...(label === 'non-zero exit' ? { exitCode: 1 } : {}) })
    assert.deepEqual(await walkHistoryTopology(fake.runner, '/repo', [H1]), [], label)
  }
  const throwing = { run: async () => { throw new Error('spawn git ENOENT') } }
  assert.deepEqual(await walkHistoryTopology(throwing, '/repo', [H1]), [], 'spawn throw')
})

test('walkHistoryTopology never passes an invalid seed as argv', async () => {
  const fake = fakeRunner(okRun(`${H1}\n`))
  assert.deepEqual(await walkHistoryTopology(fake.runner, '/repo', ['deadbeef', 'HEAD', '']), [])
  assert.equal(fake.calls.length, 0, 'no command for unusable seeds')
  // A mixed list keeps only the full hashes.
  assert.deepEqual(await walkHistoryTopology(fake.runner, '/repo', ['nope', H2]), [{ hash: H1, parents: [] }])
  assert.deepEqual(fake.calls[0].argv.slice(-1), [H2])
})

// ── real git through runQuery ─────────────────────────────────────────────

let repo
const SID = 'topology-session'

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
      symlinkTarget: async (p) => {
        try { return (await lstat(p)).isSymbolicLink() ? await readlink(p) : null } catch { return null }
      },
      readdir: async (p) => (await readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
      remove: (p) => rm(p, { force: true }),
    },
    sessions: { liveCwd: () => dir, persistedMeta: async () => undefined },
  }
}

/** deps whose runner records every argv, so "no extra command" is provable. */
function spyDeps(dir) {
  const base = depsAt(dir)
  const calls = []
  return {
    calls,
    deps: { ...base, run: { run: (argv, opts) => { calls.push([...argv]); return base.run.run(argv, opts) } } },
  }
}

const historyQuery = (extra) => ({ sessionId: SID, query: { kind: 'history', limit: 50, skip: 0, ...extra } })
const topologyCalls = (calls) => calls.filter((argv) => argv.includes('rev-list') && argv.includes('--parents'))

before(async () => {
  repo = mkdtempSync(join(tmpdir(), 'gp-topology-'))
  await runGit(repo, ['init', '-q'])
  await runGit(repo, ['config', 'user.email', 't@t.co'])
  await runGit(repo, ['config', 'user.name', 'Tester'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'root'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'hidden interval'])
  await runGit(repo, ['checkout', '-q', '-b', 'feat'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'feat work'])
  await runGit(repo, ['checkout', '-q', '-'])
  await runGit(repo, ['commit', '--allow-empty', '-qm', 'main work'])
  await runGit(repo, ['merge', '--no-ff', '-q', '-m', 'merge feat', 'feat'])
})

after(() => { rmSync(repo, { recursive: true, force: true }) })

test('a filter hiding an interval still yields its real ancestry', async () => {
  const { deps, calls } = spyDeps(repo)
  const res = await runQuery(deps, DEFAULT_CONFIG, historyQuery({ search: 'main work' }))
  assert.equal(res.ok, true)
  const value = res.value
  assert.equal(value.commits.length, 1)
  assert.equal(value.commits[0].subject, 'main work')
  assert.ok(Array.isArray(value.topology), 'filtered page carries topology')
  const byHash = new Map(value.topology.map((n) => [n.hash, n.parents]))
  // The page hid 'hidden interval' and 'root'; the walk must still recover them.
  assert.equal(byHash.size, 3, 'page commit + two hidden ancestors')
  for (const node of value.topology) {
    assert.equal(node.hash.length, 40)
    for (const parent of node.parents) assert.equal(byHash.has(parent), true, 'every parent is present')
  }
  assert.equal(value.topology.filter((n) => n.parents.length === 0).length, 1, 'exactly one true root')
  assert.equal(topologyCalls(calls).length, 1, 'exactly one auxiliary walk')
})

test('a filter hiding a merge recovers both of its parents', async () => {
  const res = await runQuery(depsAt(repo), DEFAULT_CONFIG, historyQuery({ search: 'merge feat' }))
  assert.equal(res.ok, true)
  const merge = res.value.commits.find((c) => c.subject === 'merge feat')
  assert.ok(merge !== undefined, 'the merge is on the filtered page')
  assert.equal(merge.parents.length, 2, 'the merge really has two parents')
  const byHash = new Map(res.value.topology.map((n) => [n.hash, n.parents]))
  assert.deepEqual(byHash.get(merge.hash), merge.parents, 'the merge keeps both parents')
  for (const parent of merge.parents) assert.equal(byHash.has(parent), true, 'both merge parents recovered')
})

test('an unfiltered history issues no auxiliary walk and omits the field', async () => {
  const { deps, calls } = spyDeps(repo)
  const res = await runQuery(deps, DEFAULT_CONFIG, historyQuery({}))
  assert.equal(res.ok, true)
  assert.equal('topology' in res.value, false, 'unfiltered page has no topology field')
  assert.equal(topologyCalls(calls).length, 0, 'no extra command when nothing is filtered')
})

test('a ref-only filter is not an effective filter', async () => {
  const { deps, calls } = spyDeps(repo)
  const res = await runQuery(deps, DEFAULT_CONFIG, historyQuery({ ref: 'HEAD' }))
  assert.equal(res.ok, true)
  assert.equal('topology' in res.value, false)
  assert.equal(topologyCalls(calls).length, 0)
})

test('a hash jump starts at the revision, ignores filters, and walks nothing extra', async () => {
  const probe = spyDeps(repo)
  const all = await runQuery(probe.deps, DEFAULT_CONFIG, historyQuery({}))
  const target = all.value.commits.find((c) => c.subject === 'merge feat')
  assert.ok(target !== undefined, 'the merge is in the fixture history')

  const { deps, calls } = spyDeps(repo)
  // A jump is not a filtered page: it must ignore author/since (both picked to
  // match nothing if they were applied) and still walk from the revision.
  const res = await runQuery(deps, DEFAULT_CONFIG, historyQuery({
    search: target.hash.slice(0, 7),
    author: 'nobody@example.invalid',
    since: '2999-01-01',
  }))
  assert.equal(res.ok, true)
  assert.equal(res.value.commits[0].hash, target.hash, 'the jump starts at the revision itself')
  assert.deepEqual(res.value.commits[0].parents, target.parents, 'the start commit keeps its parents')
  assert.ok(res.value.commits.length > 1, 'a jump continues into the ancestry (existing behaviour)')
  assert.equal(res.value.total, -1, 'a jump has no meaningful total')
  assert.equal('topology' in res.value, false, 'hash jump carries no topology')
  assert.equal(topologyCalls(calls).length, 0, 'no auxiliary walk')
})

test('a whitespace-only author is an effective filter, an empty one is not', async () => {
  // `--author=' '` matches an author line containing a space ("Tester <t@t.co>"),
  // so it is a real filter and must carry topology; only undefined/'' count as
  // absent (the host never pushes an empty --author flag, which git would treat
  // as match-everything).
  const spaced = spyDeps(repo)
  const res = await runQuery(spaced.deps, DEFAULT_CONFIG, historyQuery({ author: ' ' }))
  assert.equal(res.ok, true)
  assert.ok(res.value.commits.length > 0, 'the space pattern still matches this fixture')
  assert.ok(Array.isArray(res.value.topology), 'a whitespace author is treated as filtered')
  const walks = topologyCalls(spaced.calls)
  assert.equal(walks.length, 1, 'exactly one auxiliary walk')
  assert.equal(walks[0].some((a) => a.startsWith('--author=')), false, 'the walk itself stays unfiltered')

  const empty = spyDeps(repo)
  const res2 = await runQuery(empty.deps, DEFAULT_CONFIG, historyQuery({ author: '' }))
  assert.equal(res2.ok, true)
  assert.equal('topology' in res2.value, false, 'an empty author is not a filter')
  assert.equal(topologyCalls(empty.calls).length, 0)
})

test('an empty filtered page carries topology:[] and walks nothing', async () => {
  const { deps, calls } = spyDeps(repo)
  const res = await runQuery(deps, DEFAULT_CONFIG, historyQuery({ search: 'no-such-subject-xyz' }))
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.commits, [])
  assert.deepEqual(res.value.topology, [], 'filtered empty page still declares the field')
  assert.equal(topologyCalls(calls).length, 0, 'nothing to walk')
})

test('a failing auxiliary walk never costs the filtered history page', async () => {
  const base = depsAt(repo)
  for (const failure of [
    { exitCode: 1, stdout: '', stderr: 'boom', timedOut: false, cancelled: false, stdoutLossy: false },
    { exitCode: 0, stdout: '', stderr: '', timedOut: true, cancelled: false, stdoutLossy: false },
    { exitCode: 0, stdout: 'garbage', stderr: '', timedOut: false, cancelled: false, stdoutLossy: true },
  ]) {
    const deps = {
      ...base,
      run: {
        run: (argv, opts) => (argv.includes('rev-list') && argv.includes('--parents')
          ? Promise.resolve(failure)
          : base.run.run(argv, opts)),
      },
    }
    const res = await runQuery(deps, DEFAULT_CONFIG, historyQuery({ search: 'main work' }))
    assert.equal(res.ok, true, 'the page survives')
    assert.equal(res.value.commits.length, 1, 'commits intact')
    assert.deepEqual(res.value.topology, [], 'incomplete graph degrades to []')
  }
})
