/** History path substring filtering through the production query and GitRunner. */
import './_tmp-ceiling.mjs'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DEFAULT_CONFIG, runQuery } from '../../lib/host/index.js'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import { HISTORY_PATH_SEARCH_MAX_LENGTH, isHistoryFiltered } from '../../lib/host/types.js'
import { historyPathspec, validateHistoryPathSearch } from '../../lib/host/validate.js'
import { gitRunner } from './_git-fixture.mjs'

const dirs = []
after(() => {
  for (const dir of dirs) {
    assert.ok(dir.startsWith(realpathSync.native(tmpdir()) + '/') || dirname(dir) === realpathSync.native(tmpdir()))
    rmSync(dir, { recursive: true, force: true })
  }
})

function git(dir, args, extraEnv = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...extraEnv } }).trim()
}

function repo() {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'gp-path-search-')))
  dirs.push(dir)
  git(dir, ['init', '-q', '-b', 'main'])
  git(dir, ['config', 'user.email', 'tester@example.invalid'])
  git(dir, ['config', 'user.name', 'Tester'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  return dir
}

function file(dir, path, content = path) {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), content)
}

function commit(dir, subject, extraEnv) {
  git(dir, ['add', '-A'])
  git(dir, ['commit', '--allow-empty', '-qm', subject], extraEnv)
  return git(dir, ['rev-parse', 'HEAD'])
}

function depsAt(dir) {
  return { run: gitRunner(), fs: createFsDeps(), sessions: { liveCwd: () => dir, persistedMeta: async () => undefined } }
}

function query(deps, extra = {}) {
  return runQuery(deps, DEFAULT_CONFIG, { sessionId: 'path-search-session', query: { kind: 'history', limit: 100, skip: 0, ...extra } })
}

async function history(dir, extra = {}, deps = depsAt(dir)) {
  const res = await query(deps, extra)
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(res.value.pathSearchSupported, true)
  return res.value
}

const subjects = (value) => value.commits.map((c) => c.subject)
const hashes = (value) => value.commits.map((c) => c.hash)

function spy(dir, change = (_argv, result) => result) {
  const base = depsAt(dir)
  const calls = []
  return {
    calls,
    deps: { ...base, run: { run: async (argv, opts) => {
      calls.push([...argv])
      return change(argv, await base.run.run(argv, opts))
    } } },
  }
}

test('path text validation caps raw code units, rejects controls/types, and trims spaces', () => {
  assert.equal(HISTORY_PATH_SEARCH_MAX_LENGTH, 1024)
  assert.deepEqual(validateHistoryPathSearch(undefined), { ok: true, value: '' })
  assert.deepEqual(validateHistoryPathSearch('  中 文  '), { ok: true, value: '中 文' })
  assert.equal(validateHistoryPathSearch('x'.repeat(1024)).ok, true)
  for (const input of [null, 42, false, [], {}, 'x'.repeat(1025), ' '.repeat(1025), '\0', '\nword', 'word\t', 'a\x7fb', 'a\x85b']) {
    assert.equal(validateHistoryPathSearch(input).ok, false, JSON.stringify(input))
  }
  assert.equal(isHistoryFiltered({}), false)
  assert.equal(isHistoryFiltered({ search: 'abcdef1', author: 'nobody' }), false)
  assert.equal(isHistoryFiltered({ pathSearch: 'abcdef1' }), true)
  assert.equal(isHistoryFiltered({ pathSearch: '   ' }), false)
  assert.equal(isHistoryFiltered({ pathSearch: ' ', author: ' ' }), true)
  assert.equal(historyPathspec('a*b?[id]\\'), ':(top,icase)*a\\*b\\?\\[id\\]\\\\*')
  assert.equal(historyPathspec(':(exclude)--output=x'), ':(top,icase)*:(exclude)--output=x*')
})

test('root/deep filenames, intermediate directories, slash fragments, case and spaces match', async () => {
  const dir = repo()
  const expected = []
  for (const path of ['OrderService.php', 'app/services/order/Create.php', 'src/host/queries.ts', 'deep/OrderService.php', '文档/中 文.txt']) {
    file(dir, path)
    expected.push(commit(dir, path))
  }
  assert.deepEqual(hashes(await history(dir, { pathSearch: 'orderservice' })), [expected[3], expected[0]])
  assert.deepEqual(subjects(await history(dir, { pathSearch: ' services/order/ ' })), ['app/services/order/Create.php'])
  assert.deepEqual(subjects(await history(dir, { pathSearch: 'host' })), ['src/host/queries.ts'])
  assert.deepEqual(subjects(await history(dir, { pathSearch: '中 文' })), ['文档/中 文.txt'])
  assert.deepEqual(subjects(await history(dir, { pathSearch: '.PHP' })), ['deep/OrderService.php', 'app/services/order/Create.php', 'OrderService.php'])
})

test('special path input remains literal and cannot inject pathspec magic or output options', async (t) => {
  const dir = repo()
  const cases = [
    ['[id]', 'app/[id]/page.tsx', 'app/i/page.tsx'],
    ['a*b', 'docs/a*b.txt', 'docs/axxb.txt'],
    ['a?b', 'docs/a?b.txt', 'docs/acb.txt'],
    ['back\\slash', 'docs/back\\slash.txt', 'docs/backslash.txt'],
    [':(exclude)', 'docs/:(exclude).txt', 'docs/exclude.txt'],
    ['--output=marker', 'docs/--output=marker.txt', 'docs/ordinary.txt'],
    ['[!a]', 'docs/[!a].txt', 'docs/z.txt'],
    ['end]', 'docs/end].txt', 'docs/end.txt'],
    ['[open', 'docs/[open.txt', 'docs/open.txt'],
  ]
  for (const [keyword, target, decoy] of cases) {
    await t.test(keyword, async (st) => {
      // Windows forbids these actual names; all inputs still exercise the query.
      const supported = process.platform !== 'win32' || !/[\\:*?]/.test(target)
      if (!supported) {
        const value = await history(dir, { pathSearch: keyword })
        assert.deepEqual(value.commits, [])
        st.diagnostic('filesystem cannot create this name; query safety still verified')
        return
      }
      file(dir, target)
      commit(dir, target)
      file(dir, decoy)
      commit(dir, decoy)
      assert.deepEqual(subjects(await history(dir, { pathSearch: keyword })), [target])
    })
  }
  const value = await history(dir, { pathSearch: '--output=../marker' })
  assert.equal(value.total, 0)
  assert.equal(existsSync(join(dir, 'marker')), false)
})

test('production GitRunner keeps write paths literal while history can use controlled patterns', async () => {
  const dir = repo()
  file(dir, 'app/[id].txt', 'literal')
  file(dir, 'app/i.txt', 'decoy')
  const result = await gitRunner().run(['git', 'add', '--', 'app/[id].txt'], { cwd: dir })
  assert.equal(result.exitCode, 0, result.stderr)
  assert.equal(git(dir, ['diff', '--cached', '--name-only']), 'app/[id].txt')
  git(dir, ['commit', '-qm', 'literal path'])
  assert.deepEqual(subjects(await history(dir, { pathSearch: '[id]' })), ['literal path'])
})

test('empty, whitespace, empty repository, missing ref and no-match responses declare capability', async () => {
  const dir = repo()
  for (const filter of [{}, { pathSearch: 'file' }]) {
    const value = await history(dir, filter)
    assert.deepEqual(value.commits, [])
    assert.equal(value.total, 0)
  }
  file(dir, 'file.txt')
  commit(dir, 'a commit')
  // A missing ref inside a populated repository: the empty page must come from
  // the unknown revision, not from every walk finding nothing anyway.
  const missing = await history(dir, { ref: 'absent', pathSearch: 'file' })
  assert.deepEqual(missing.commits, [])
  assert.equal(missing.total, 0)
  for (const pathSearch of ['', '   ']) {
    const value = await history(dir, { pathSearch })
    assert.deepEqual(subjects(value), ['a commit'])
    assert.equal('topology' in value, false)
  }
  const empty = await history(dir, { pathSearch: 'absent' })
  assert.equal(empty.total, 0)
  assert.deepEqual(empty.topology, [])
})

test('invalid input and mutually exclusive searches fail before hash jump', async () => {
  const dir = repo()
  commit(dir, 'root')
  const { deps, calls } = spy(dir)
  for (const pathSearch of [null, 42, {}, '\0', '\n', '\x7f', 'x'.repeat(1025)]) {
    const res = await query(deps, { search: 'abcdef1', pathSearch })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'invalid-name')
  }
  for (const search of [null, 42, {}, 'abcdef1', 'message']) {
    const res = await query(deps, { search, pathSearch: 'file' })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, 'invalid-name')
  }
  assert.equal(calls.some((argv) => argv.includes('log') || argv.includes('--count')), false)
})

test('hex-shaped paths are filters while message hash jump and regex retain their behavior', async () => {
  const dir = repo()
  file(dir, 'src/abcdef1.ts')
  const first = commit(dir, 'initial work')
  file(dir, 'other.txt')
  commit(dir, 'other work')
  const path = await history(dir, { pathSearch: 'abcdef1', author: 'Nobody' })
  assert.equal(path.total, 0)
  assert.deepEqual(hashes(await history(dir, { pathSearch: 'abcdef1', search: '  ' })), [first])
  const jump = await history(dir, { search: first.slice(0, 7), pathSearch: ' ', author: 'Nobody', since: '2999-01-01', ref: 'missing' })
  assert.deepEqual(hashes(jump), [first])
  assert.equal(jump.total, -1)
  assert.equal('topology' in jump, false)
  const probe = spy(dir)
  const counted = await history(dir, { search: first.slice(0, 7) }, probe.deps)
  assert.deepEqual(hashes(counted), [first])
  assert.equal(counted.total, -1)
  assert.equal(probe.calls.filter((argv) => argv.includes('--count')).length, 0, 'a hash jump skips the total walk')
  assert.deepEqual(subjects(await history(dir, { search: 'INITIAL.*WORK' })), ['initial work'])
})

test('path search combines ref, author and since while visible refs include other branches', async () => {
  const dir = repo()
  const dated = (name, date) => ({ GIT_AUTHOR_NAME: name, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
  file(dir, 'src/find-me.ts', 'old')
  commit(dir, 'old Alice', dated('Alice', '2020-01-01T12:00:00Z'))
  file(dir, 'src/find-me.ts', 'Bob')
  commit(dir, 'new Bob', dated('Bob', '2021-01-01T12:00:00Z'))
  git(dir, ['checkout', '-qb', 'feature'])
  file(dir, 'src/find-me.ts', 'Alice')
  const feature = commit(dir, 'new Alice', dated('Alice', '2022-01-01T12:00:00Z'))
  git(dir, ['checkout', '-q', 'main'])
  assert.deepEqual(hashes(await history(dir, { pathSearch: 'find-me', author: 'Alice', since: '2020-06-01', ref: 'feature' })), [feature])
  assert.equal((await history(dir, { pathSearch: 'find-me', author: 'Alice', since: '2020-06-01', ref: 'main' })).total, 0)
  assert.equal((await history(dir, { pathSearch: 'find-me', author: 'Nobody' })).total, 0)
  assert.equal((await history(dir, { pathSearch: 'find-me' })).total, 3)
})

test('deleted paths remain searchable and renamed names do not follow older names', async () => {
  const dir = repo()
  file(dir, 'old-name.txt', 'stable content')
  const added = commit(dir, 'add old')
  git(dir, ['mv', 'old-name.txt', 'new-name.txt'])
  const renamed = commit(dir, 'rename')
  git(dir, ['rm', '-q', 'new-name.txt'])
  const deleted = commit(dir, 'delete new')
  assert.deepEqual(hashes(await history(dir, { pathSearch: 'new-name' })), [deleted, renamed])
  assert.deepEqual(hashes(await history(dir, { pathSearch: 'old-name' })), [renamed, added])
})

test('more than one hundred path matches paginate without gaps and use identical count filters', async () => {
  const dir = repo()
  const expected = []
  for (let i = 0; i < 105; i++) {
    file(dir, 'src/needle.txt', String(i))
    expected.unshift(commit(dir, `match ${i}`))
  }
  const { deps, calls } = spy(dir)
  const a = await history(dir, { pathSearch: 'needle', limit: 100 }, deps)
  const b = await history(dir, { pathSearch: 'needle', limit: 100, skip: 100 }, deps)
  assert.equal(a.total, 105)
  assert.equal(b.total, 105)
  assert.deepEqual([...hashes(a), ...hashes(b)], expected)
  assert.equal(new Set([...hashes(a), ...hashes(b)]).size, 105)
  const logs = calls.filter((a) => a[1] === 'log')
  const counts = calls.filter((a) => a.includes('--count'))
  assert.equal(logs.length, 2)
  assert.equal(counts.length, 2)
  for (let i = 0; i < logs.length; i++) {
    assert.deepEqual(logs[i].slice(7), counts[i].slice(3))
    assert.deepEqual(logs[i].slice(-2), ['--', ':(top,icase)*needle*'])
  }
  const walks = calls.filter((a) => a.includes('--parents'))
  assert.equal(walks.length, 2)
  assert.ok(walks.every((a) => !a.includes(':(top,icase)*needle*')))
})

test('default merge simplification preserves raw parents and bounded topology without restoring hidden rows', async () => {
  const dir = repo()
  file(dir, 'target.txt', 'base\n')
  const root = commit(dir, 'root')
  git(dir, ['checkout', '-qb', 'feature'])
  file(dir, 'target.txt', 'feature\n')
  const feature = commit(dir, 'feature target')
  git(dir, ['checkout', '-q', 'main'])
  file(dir, 'unrelated.txt')
  const hidden = commit(dir, 'hidden interval')
  git(dir, ['merge', '--no-ff', '-qm', 'clean merge', 'feature'])
  const cleanMerge = git(dir, ['rev-parse', 'HEAD'])
  const clean = await history(dir, { pathSearch: 'target', ref: 'main' })
  assert.deepEqual(hashes(clean), [feature, root])
  assert.equal(hashes(clean).includes(cleanMerge), false)
  assert.equal(clean.total, hashes(clean).length, 'the count walk simplifies history the same way the page does')

  git(dir, ['checkout', '-qb', 'conflict'])
  file(dir, 'target.txt', 'side\n')
  const side = commit(dir, 'side target')
  git(dir, ['checkout', '-q', 'main'])
  file(dir, 'target.txt', 'main\n')
  const main = commit(dir, 'main target')
  assert.throws(() => git(dir, ['merge', '--no-ff', '-qm', 'conflict merge', 'conflict']), /Command failed/)
  file(dir, 'target.txt', 'resolution\n')
  const resolved = commit(dir, 'resolved merge')
  const result = await history(dir, { pathSearch: 'target', ref: 'main' })
  assert.deepEqual(hashes(result), [resolved, side, main, feature, root])
  assert.equal(result.total, hashes(result).length)
  assert.equal(result.total, 5)
  const rows = new Map(result.commits.map((c) => [c.hash, c.parents]))
  assert.deepEqual(rows.get(resolved), [main, side])
  assert.deepEqual(rows.get(main), [cleanMerge])
  const topology = new Map(result.topology.map((n) => [n.hash, n.parents]))
  assert.deepEqual(topology.get(cleanMerge), [hidden, feature])
  assert.deepEqual(topology.get(hidden), [root])
  for (const c of result.commits) {
    const raw = git(dir, ['show', '-s', '--format=%P', c.hash]).split(' ').filter(Boolean)
    assert.deepEqual(c.parents, raw)
    assert.deepEqual(topology.get(c.hash), raw)
  }
  const indices = new Map(hashes(result).map((h, i) => [h, i]))
  for (const c of result.commits) {
    for (const p of c.parents) if (indices.has(p)) assert.ok(indices.get(c.hash) < indices.get(p))
  }
})

test('inherited GIT_*PATHSPECS cannot turn the generated pattern into a silent empty page', async () => {
  const dir = repo()
  file(dir, 'src/needle.ts')
  const sha = commit(dir, 'add needle')
  const names = ['GIT_LITERAL_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_GLOB_PATHSPECS']
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    for (const name of names) process.env[name] = '1'
    for (const pathSearch of ['needle', 'src/needle']) {
      assert.deepEqual(hashes(await history(dir, { pathSearch })), [sha], pathSearch)
    }
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name]
      else process.env[name] = saved[name]
    }
  }
})

test('list timeout/cancel/lossy failures remain failures and topology failures only degrade ancestry', async () => {
  const dir = repo()
  file(dir, 'target.txt')
  commit(dir, 'target')
  for (const flags of [{ timedOut: true }, { cancelled: true }, { stdoutLossy: true }]) {
    const probe = spy(dir, (argv, value) => argv[1] === 'log' ? { ...value, ...flags } : value)
    const res = await query(probe.deps, { pathSearch: 'target' })
    assert.equal(res.ok, false)
    assert.equal(res.error.code, flags.timedOut ? 'timeout' : flags.cancelled ? 'cancelled' : 'git-error')
  }
  const probe = spy(dir, (argv, value) => argv.includes('--parents') ? { ...value, timedOut: true } : value)
  const value = await history(dir, { pathSearch: 'target' }, probe.deps)
  assert.deepEqual(subjects(value), ['target'])
  assert.deepEqual(value.topology, [])
})
