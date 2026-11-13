/**
 * `.code-workspace` discovery and resolution (issue #121, ADR-0030).
 *
 * The parser is pure and asserted directly; discovery and folder resolution run
 * against real temp directories and real `git init` fixtures, with the git
 * runner the host builds. The selector door (`repoDirExternal`) and the
 * endpoints that consume it are covered in repos.test.mjs, next to the other
 * two doors.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import './_tmp-ceiling.mjs'
import { linkOrSkip } from './_fs-helpers.mjs'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import {
  CODE_WORKSPACE_CACHE_TTL_MS,
  CODE_WORKSPACE_MAX_ATTEMPTS,
  CODE_WORKSPACE_MAX_BYTES,
  CODE_WORKSPACE_MAX_ROOTS,
  explicitCodeWorkspaceName,
  isCodeWorkspaceName,
  parseWorkspaceFolders,
  scanCodeWorkspace,
  stripJsoncComments,
  stripTrailingCommas,
} from '../../lib/host/code-workspace.js'
import { gitRunner, runGit } from './_git-fixture.mjs'

const runner = gitRunner()

/** `git rev-parse --show-toplevel` in `dir`, realpath'd; null when git fails. */
async function toplevel(dir) {
  const res = await runner.run(['git', 'rev-parse', '--show-toplevel'], { cwd: dir })
  if (res.exitCode !== 0) return null
  return realpathSync.native(res.stdout.trim())
}

const fs = createFsDeps()
let tmp
let hub

before(async () => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'gp-codews-')))
  hub = join(tmp, 'hub')
  mkdirSync(hub, { recursive: true })
  for (const name of ['service-a', 'service-b', 'shared-libs', 'not-a-repo']) {
    mkdirSync(join(tmp, name), { recursive: true })
  }
  for (const name of ['service-a', 'service-b', 'shared-libs']) {
    await runGit(join(tmp, name), ['init', '-q'])
    await runGit(join(tmp, name), ['config', 'user.email', 't@t.co'])
    await runGit(join(tmp, name), ['config', 'user.name', 'Tester'])
    await runGit(join(tmp, name), ['commit', '--allow-empty', '-qm', 'init'])
  }
  mkdirSync(join(tmp, 'service-a', 'sub'), { recursive: true })
  // A repository inside the hub: the scan already owns it, so the workspace
  // file must not duplicate the row.
  mkdirSync(join(hub, 'inner'), { recursive: true })
  await runGit(join(hub, 'inner'), ['init', '-q'])
})

after(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function writeWorkspace(name, body) {
  writeFileSync(join(hub, name), body)
}

// ── parser ────────────────────────────────────────────────────────────────

test('comments are stripped outside strings only', () => {
  const text = '{"a":"// not a comment","b":1 /* gone */}// tail\n'
  const stripped = stripJsoncComments(text)
  assert.ok(stripped.includes('"// not a comment"'), 'a comment marker inside a string is data')
  assert.ok(stripped.includes('"b":1'), 'the block comment is removed')
  assert.equal(stripped.includes('gone'), false)
  assert.equal(stripped.includes('tail'), false)
})

test('a trailing comma before } or ] is dropped, one inside a string is not', () => {
  assert.deepEqual(JSON.parse(stripTrailingCommas('{"a":1,}')), { a: 1 })
  assert.deepEqual(JSON.parse(stripTrailingCommas('[1,2, ]')), [1, 2])
  // The comma lives in the string, so it survives and the object still parses.
  assert.deepEqual(JSON.parse(stripTrailingCommas('{"a":",}"}')), { a: ',}' })
})

test('parseWorkspaceFolders accepts JSONC: comments, trailing comma, BOM, CRLF', () => {
  const body = [
    '\uFEFF{',
    '  // the hub layout',
    '  "folders": [',
    '    { "path": "../service-a", "name": "API" }, /* display override */',
    '    { "path": "../service-b" },',
    '  ],',
    '  "settings": { "editor.formatOnSave": true }',
    '}',
  ].join('\r\n')
  const folders = parseWorkspaceFolders(body)
  assert.deepEqual(folders, [
    { path: '../service-a', label: 'API' },
    { path: '../service-b' },
  ])
})

test('parseWorkspaceFolders reads folders only and keeps a folder without a path out', () => {
  assert.deepEqual(parseWorkspaceFolders('{"folders": []}'), [])
  assert.equal(parseWorkspaceFolders('{"settings": {}}'), null, 'no folders array')
  assert.equal(parseWorkspaceFolders('{"folders": [{"name": "x"}]}'), null, 'no path')
  assert.equal(parseWorkspaceFolders('{"folders": [{"path": 7}]}'), null, 'path is not a string')
  assert.equal(parseWorkspaceFolders('{"folders": "x"}'), null)
  assert.equal(parseWorkspaceFolders('{"folders": [{"path": "/"}]}').length, 1, '`/` is parsed; resolution rejects it')
  assert.equal(parseWorkspaceFolders('{ not json'), null)
})

test('an escaped quote inside a string does not end the string early', () => {
  const body = '{"folders": [{"path": "../a\\"b", "name": "q\\"q"}]}'
  assert.deepEqual(parseWorkspaceFolders(body), [{ path: '../a"b', label: 'q"q' }])
})

// ── discovery ─────────────────────────────────────────────────────────────

/** A throwaway directory for one discovery case, so cases never collide. */
function scratch(name) {
  const dir = join(tmp, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

test('auto accepts exactly the single workspace file in the cwd', async () => {
  const dir = scratch('single')
  writeFileSync(join(dir, 'team.code-workspace'), '{"folders": []}')
  assert.equal((await scanCodeWorkspace(fs, toplevel, dir, 'auto')).file, realpathSync.native(join(dir, 'team.code-workspace')))
})

test('the name rule is VS Code\'s exact extname comparison', () => {
  assert.equal(isCodeWorkspaceName('hub.code-workspace'), true)
  assert.equal(isCodeWorkspaceName('a.b.code-workspace'), true)
  // extname('X.CODE-WORKSPACE') is not the suffix: no case folding.
  assert.equal(isCodeWorkspaceName('X.CODE-WORKSPACE'), false)
  // A dotfile has no extension at all, so VS Code opens it as plain text.
  assert.equal(isCodeWorkspaceName('.code-workspace'), false)
  assert.equal(isCodeWorkspaceName('hub.code-workspace.json'), false)
})

test('a file literally named .code-workspace is not picked up', async () => {
  const dir = scratch('dotfile')
  writeFileSync(join(dir, '.code-workspace'), '{"folders": []}')
  assert.equal((await scanCodeWorkspace(fs, toplevel, dir, 'auto')).file, null)
  // Auto with no candidate is "not configured", not a failure: no state.
  assert.deepEqual(await scanCodeWorkspace(fs, toplevel, dir, 'auto'), { file: null, roots: [] })
})

test('several candidates resolve to ambiguous rather than a guess', async () => {
  const dir = scratch('ambiguous')
  // The basename file is present too: preference must not override ambiguity.
  writeFileSync(join(dir, 'ambiguous.code-workspace'), '{"folders": []}')
  writeFileSync(join(dir, 'legacy.code-workspace'), '{"folders": []}')
  const scan = await scanCodeWorkspace(fs, toplevel, dir, 'auto')
  assert.deepEqual(scan.roots, [])
  assert.equal(scan.state, 'ambiguous')
  assert.equal(scan.file, null, 'no single file can be named')
})

test('an explicit name must be one segment and a workspace file', () => {
  assert.equal(explicitCodeWorkspaceName('team.code-workspace'), 'team.code-workspace')
  for (const bad of ['', 'off', 'auto', '../x.code-workspace', 'a/b.code-workspace', '..', '.', 'x.json', 'x\0.code-workspace', '.code-workspace', 'X.CODE-WORKSPACE']) {
    assert.equal(explicitCodeWorkspaceName(bad), null, 'must refuse ' + JSON.stringify(bad))
  }
})

test('an explicit file that is a symlink out of the cwd is refused', async (t) => {
  const dir = scratch('escapes')
  const outside = join(tmp, 'outside.code-workspace')
  writeFileSync(outside, '{"folders": []}')
  const ok = linkOrSkip(t, outside, join(dir, 'escapes.code-workspace'))
  if (!ok) return
  const scan = await scanCodeWorkspace(fs, toplevel, dir, 'escapes.code-workspace')
  assert.equal(scan.state, 'invalid')
  assert.equal(scan.reason, 'link')
  // The candidate inside the cwd is named, not the target it points at: the
  // message has to point at the path the user can repair.
  assert.equal(scan.file, join(realpathSync.native(dir), 'escapes.code-workspace'))
})

test('a directory where the file should be is reported as such', async () => {
  // `explicit` is the only way in: `auto` discovery filters directories out.
  const dir = scratch('dir-as-file')
  mkdirSync(join(dir, 'blocked.code-workspace'), { recursive: true })
  const scan = await scanCodeWorkspace(fs, toplevel, dir, 'blocked.code-workspace')
  assert.deepEqual(scan.roots, [])
  assert.equal(scan.state, 'invalid')
  assert.equal(scan.reason, 'not-file')
  assert.equal(scan.file, join(realpathSync.native(dir), 'blocked.code-workspace'))
})

test('a missing explicit file is reported as missing, not swallowed', async () => {
  const scan = await scanCodeWorkspace(fs, toplevel, hub, 'missing.code-workspace')
  assert.deepEqual(scan.roots, [])
  assert.equal(scan.state, 'missing')
  assert.equal(scan.file, join(realpathSync.native(hub), 'missing.code-workspace'))
})

test('a malformed setting value is reported as invalid', async () => {
  // No filesystem access happens for a shape that can never name a file.
  const scan = await scanCodeWorkspace(fs, toplevel, hub, '../escape.code-workspace')
  assert.deepEqual(scan.roots, [])
  assert.equal(scan.state, 'invalid')
  assert.equal(scan.reason, 'name')
  assert.equal(scan.file, null)
})

test('off and auto-with-no-candidate stay silent', async () => {
  const empty = scratch('empty')
  assert.deepEqual(await scanCodeWorkspace(fs, toplevel, empty, 'off'), { file: null, roots: [] })
  assert.deepEqual(await scanCodeWorkspace(fs, toplevel, empty, 'auto'), { file: null, roots: [] })
})

// ── resolution ────────────────────────────────────────────────────────────

test('folders resolve to work-tree tops outside the cwd, deduped and sorted', async () => {
  writeWorkspace('hub.code-workspace', JSON.stringify({
    folders: [
      { path: '../service-b' },
      { path: '../service-a', name: 'API' },
      { path: '../service-a' }, // duplicate by realpath
      { path: 'inner' }, // inside the cwd: the scan owns it
      { path: '../not-a-repo' }, // no .git
      { path: '../service-a/sub' }, // a subdirectory of a repository
      { path: '/' },
      { path: '../missing' },
    ],
  }))
  const scan = await scanCodeWorkspace(fs, toplevel, hub, 'auto')
  assert.equal(scan.file, realpathSync.native(join(hub, 'hub.code-workspace')))
  assert.deepEqual(scan.roots.map((r) => r.path), ['../service-a', '../service-b'])
  assert.deepEqual(scan.roots.map((r) => r.name), ['service-a', 'service-b'])
  assert.equal(scan.roots[0].label, 'API', 'folders[].name becomes the display label')
  assert.equal(scan.roots[1].label, undefined)
})

test('the root ceiling bounds one file', async () => {
  const many = []
  for (let i = 0; i < CODE_WORKSPACE_MAX_ROOTS + 3; i += 1) {
    const name = `cap-${i}`
    mkdirSync(join(tmp, name), { recursive: true })
    await runGit(join(tmp, name), ['init', '-q'])
    many.push({ path: `../${name}` })
  }
  writeWorkspace('cap.code-workspace', JSON.stringify({ folders: many }))
  const scan = await scanCodeWorkspace(fs, toplevel, hub, 'cap.code-workspace')
  assert.equal(scan.roots.length, CODE_WORKSPACE_MAX_ROOTS)
})

test('an unparsable file yields no roots and reports invalid', async () => {
  writeWorkspace('broken.code-workspace', '{ "folders": [ }')
  const scan = await scanCodeWorkspace(fs, toplevel, hub, 'broken.code-workspace')
  assert.deepEqual(scan.roots, [])
  assert.equal(scan.state, 'invalid')
  assert.equal(scan.reason, 'parse')
  assert.equal(scan.file, join(realpathSync.native(hub), 'broken.code-workspace'))
})

test('a file that cannot be read is reported apart from one that cannot be parsed', async () => {
  writeWorkspace('unreadable.code-workspace', '{"folders": []}')
  const guarded = {
    ...createFsDeps(),
    readFile: async () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    },
  }
  const scan = await scanCodeWorkspace(guarded, toplevel, hub, 'unreadable.code-workspace')
  assert.deepEqual(scan.roots, [])
  assert.equal(scan.state, 'invalid')
  assert.equal(scan.reason, 'read')
})

test('the scan cache misses after the file changes', async () => {
  // The bodies differ in length as well as content, so both halves of the
  // stamp (size, mtime) take part — the case a coarse clock would hide.
  writeWorkspace('cache.code-workspace', JSON.stringify({ folders: [{ path: '../service-a' }] }))
  const cache = new Map()
  const first = await scanCodeWorkspace(fs, toplevel, hub, 'cache.code-workspace', cache)
  assert.deepEqual(first.roots.map((r) => r.path), ['../service-a'])
  writeWorkspace('cache.code-workspace', JSON.stringify({ folders: [{ path: '../service-b', name: 'b' }] }))
  const second = await scanCodeWorkspace(fs, toplevel, hub, 'cache.code-workspace', cache)
  assert.deepEqual(second.roots.map((r) => r.path), ['../service-b'])
})

test('the cache follows size and mtime, so a same-length rewrite in the same tick can go stale', async () => {
  // Pinned on purpose: the stamp is (mtimeMs, size), not a content hash. A
  // rewrite that keeps both (same length, same timestamp) is served from the
  // cache until the entry's TTL expires — a bound in time, not in file edits.
  // The test fails loudly if the key ever changes shape without the ADR
  // following.
  const body = (target) => JSON.stringify({ folders: [{ path: target }] })
  assert.equal(body('../service-a').length, body('../service-b').length, 'the bodies must be the same length')
  const file = join(hub, 'stale.code-workspace')
  // Pin both writes to the same whole-millisecond timestamp, or the second
  // write lands a fraction later and the stamp differs after all.
  const stamp = new Date(1_700_000_000_000)
  writeWorkspace('stale.code-workspace', body('../service-a'))
  utimesSync(file, stamp, stamp)
  const cache = new Map()
  await scanCodeWorkspace(fs, toplevel, hub, 'stale.code-workspace', cache)
  writeWorkspace('stale.code-workspace', body('../service-b'))
  utimesSync(file, stamp, stamp)
  assert.equal(statSync(file).mtimeMs, stamp.getTime(), 'the two writes share one stamp')
  const again = await scanCodeWorkspace(fs, toplevel, hub, 'stale.code-workspace', cache)
  assert.deepEqual(again.roots.map((r) => r.path), ['../service-a'], 'same stamp, cached answer')
})

test('the cache key includes the cwd, so two sessions sharing a file do not bleed', async (t) => {
  // The file is one realpath reached from two cwds (a symlink inside the parent
  // session). The roots depend on the cwd: the same entry is one level further
  // from the nested session, and an entry inside the cwd is dropped per cwd.
  const parent = scratch('shared')
  const child = join(parent, 'sub')
  mkdirSync(child, { recursive: true })
  const sharedFile = join(child, 'real.code-workspace')
  writeFileSync(sharedFile, JSON.stringify({ folders: [{ path: '../../service-a' }] }))
  const ok = linkOrSkip(t, sharedFile, join(parent, 'linked.code-workspace'))
  if (!ok) return
  const cache = new Map()
  const fromParent = await scanCodeWorkspace(fs, toplevel, parent, 'linked.code-workspace', cache)
  const fromChild = await scanCodeWorkspace(fs, toplevel, child, 'real.code-workspace', cache)
  assert.equal(fromParent.file, fromChild.file, 'both resolve to the same realpath')
  assert.deepEqual(fromParent.roots.map((r) => r.path), ['../service-a'])
  assert.deepEqual(fromChild.roots.map((r) => r.path), ['../../service-a'], 'the child computes its own relative path')
})

test('a cached root whose directory disappeared is dropped on the next scan', async () => {
  const dir = scratch('vanishing')
  const repo = join(tmp, 'vanishing-repo')
  mkdirSync(repo, { recursive: true })
  await runGit(repo, ['init', '-q'])
  writeFileSync(join(dir, 'vanishing.code-workspace'), JSON.stringify({ folders: [{ path: '../vanishing-repo' }] }))
  const cache = new Map()
  const first = await scanCodeWorkspace(fs, toplevel, dir, 'vanishing.code-workspace', cache)
  assert.deepEqual(first.roots.map((r) => r.root), [realpathSync.native(repo)])
  const second = await scanCodeWorkspace(fs, toplevel, dir, 'vanishing.code-workspace', cache)
  assert.deepEqual(second.roots.map((r) => r.path), ['../vanishing-repo'], 'the untouched file keeps the cached row')
  rmSync(repo, { recursive: true, force: true })
  const third = await scanCodeWorkspace(fs, toplevel, dir, 'vanishing.code-workspace', cache)
  assert.deepEqual(third.roots, [], 'a deleted checkout cannot stay a phantom row')
})

test('a folder that did not resolve yet appears once the cache entry expires', async () => {
  // The workspace file can name a repository before it is cloned. The first
  // scan caches that answer under an unchanged stamp; without an expiry the
  // row would never appear — the feature's main workflow, failing silently.
  const dir = scratch('late')
  const late = join(tmp, 'late-repo')
  writeFileSync(join(dir, 'late.code-workspace'), JSON.stringify({ folders: [{ path: '../late-repo' }] }))
  const cache = new Map()
  const first = await scanCodeWorkspace(fs, toplevel, dir, 'late.code-workspace', cache)
  assert.deepEqual(first.roots, [], 'nothing to list before the clone')
  assert.equal(first.state, 'applied', 'the file itself was recognised')
  mkdirSync(late, { recursive: true })
  await runGit(late, ['init', '-q'])
  const withinTtl = await scanCodeWorkspace(fs, toplevel, dir, 'late.code-workspace', cache)
  assert.deepEqual(withinTtl.roots, [], 'inside the TTL the 30-second snapshots stay free')
  const realNow = Date.now
  try {
    Date.now = () => realNow() + CODE_WORKSPACE_CACHE_TTL_MS + 1
    const expired = await scanCodeWorkspace(fs, toplevel, dir, 'late.code-workspace', cache)
    assert.deepEqual(expired.roots.map((r) => r.path), ['../late-repo'], 'an expired entry is re-probed')
  } finally {
    Date.now = realNow
  }
})

test('a path that stops being a work-tree top survives until the entry expires, then drops', async () => {
  // The hit-path revalidation only compares realpaths: a plain directory put
  // back at the same path still resolves, so the accepted window is the TTL.
  // Expiry must then run a full rescan — reading the file is what proves the
  // healed entry was not trusted again.
  const dir = scratch('ghost')
  const repo = join(tmp, 'ghost-repo')
  mkdirSync(repo, { recursive: true })
  await runGit(repo, ['init', '-q'])
  writeFileSync(join(dir, 'ghost.code-workspace'), JSON.stringify({ folders: [{ path: '../ghost-repo' }] }))
  let reads = 0
  const base = createFsDeps()
  const guarded = {
    ...base,
    readFile: async (path) => {
      reads += 1
      return base.readFile(path)
    },
  }
  const cache = new Map()
  const first = await scanCodeWorkspace(guarded, toplevel, dir, 'ghost.code-workspace', cache)
  assert.deepEqual(first.roots.map((r) => r.path), ['../ghost-repo'])
  assert.equal(reads, 1)
  rmSync(repo, { recursive: true, force: true })
  mkdirSync(repo, { recursive: true })
  writeFileSync(join(repo, 'plain.txt'), 'not a repository\n')
  const withinTtl = await scanCodeWorkspace(guarded, toplevel, dir, 'ghost.code-workspace', cache)
  assert.deepEqual(withinTtl.roots.map((r) => r.path), ['../ghost-repo'], 'inside the TTL the row survives')
  assert.equal(reads, 1, 'the hit path never reads the file')
  const realNow = Date.now
  try {
    Date.now = () => realNow() + CODE_WORKSPACE_CACHE_TTL_MS + 1
    const expired = await scanCodeWorkspace(guarded, toplevel, dir, 'ghost.code-workspace', cache)
    assert.deepEqual(expired.roots, [], 'a plain directory at the same path is not a work-tree top')
    assert.equal(reads, 2, 'expiry ran a full rescan instead of trusting the healed entry')
  } finally {
    Date.now = realNow
  }
})

test('the attempt ceiling bounds the probes one file can demand', async () => {
  // The root ceiling counts successes only, so a file full of entries would
  // otherwise cost a realpath and a `.git` stat per entry (plus a `rev-parse`
  // for any that carries a `.git` entry).
  const many = []
  for (let i = 0; i < CODE_WORKSPACE_MAX_ATTEMPTS + 50; i += 1) many.push({ path: `../absent-${i}` })
  writeWorkspace('attempts.code-workspace', JSON.stringify({ folders: many }))
  let realpaths = 0
  const base = createFsDeps()
  const guarded = {
    ...base,
    realpath: async (path) => {
      realpaths += 1
      return base.realpath(path)
    },
  }
  const scan = await scanCodeWorkspace(guarded, toplevel, hub, 'attempts.code-workspace')
  assert.deepEqual(scan.roots, [], 'none of the entries names a directory')
  assert.equal(scan.state, 'applied')
  assert.ok(realpaths >= CODE_WORKSPACE_MAX_ATTEMPTS, 'the scan stopped at the attempt ceiling')
  // The 3 is locate's realpath(cwd) + realpath(file) plus the scan's own
  // realpath(cwd); every further probe belongs to one folder attempt.
  assert.ok(realpaths <= 3 + CODE_WORKSPACE_MAX_ATTEMPTS, `probed ${realpaths} paths, past the ceiling`)
})

test('off never reads a file', async () => {
  const scan = await scanCodeWorkspace(fs, toplevel, hub, 'off')
  assert.deepEqual(scan, { file: null, roots: [] })
})

test('a workspace file past the size cap is invalid, and never read', async () => {
  writeWorkspace('huge.code-workspace', ' '.repeat(CODE_WORKSPACE_MAX_BYTES + 1))
  let reads = 0
  const guarded = {
    ...createFsDeps(),
    readFile: async (path) => {
      reads += 1
      return createFsDeps().readFile(path)
    },
  }
  const scan = await scanCodeWorkspace(guarded, toplevel, hub, 'huge.code-workspace')
  assert.deepEqual(scan.roots, [])
  assert.equal(scan.state, 'invalid')
  assert.equal(scan.reason, 'size')
  assert.equal(reads, 0, 'the size is known from stat, so a hostile file never enters memory')
})

test('the fixture file is not modified by a scan', async () => {
  const original = readFileSync(join(hub, 'hub.code-workspace'), 'utf8')
  await scanCodeWorkspace(fs, toplevel, hub, 'auto')
  assert.equal(readFileSync(join(hub, 'hub.code-workspace'), 'utf8'), original)
})
