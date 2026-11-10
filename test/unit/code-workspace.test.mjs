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
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import {
  CODE_WORKSPACE_MAX_ROOTS,
  codeWorkspaceFile,
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
  assert.equal(await codeWorkspaceFile(fs, dir, 'auto'), realpathSync.native(join(dir, 'team.code-workspace')))
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
  assert.equal(await codeWorkspaceFile(fs, dir, 'auto'), null)
  // Auto with no candidate is "not configured", not a failure: no state.
  assert.deepEqual(await scanCodeWorkspace(fs, toplevel, dir, 'auto'), { file: null, roots: [] })
})

test('several candidates resolve to ambiguous rather than a guess', async () => {
  const dir = scratch('ambiguous')
  // The basename file is present too: preference must not override ambiguity.
  writeFileSync(join(dir, 'ambiguous.code-workspace'), '{"folders": []}')
  writeFileSync(join(dir, 'legacy.code-workspace'), '{"folders": []}')
  assert.equal(await codeWorkspaceFile(fs, dir, 'auto'), null)
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
  assert.equal(await codeWorkspaceFile(fs, dir, 'escapes.code-workspace'), null)
  assert.equal((await scanCodeWorkspace(fs, toplevel, dir, 'escapes.code-workspace')).state, 'invalid')
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
})

test('the scan cache misses after the file changes', async () => {
  writeWorkspace('cache.code-workspace', JSON.stringify({ folders: [{ path: '../service-a' }] }))
  const cache = new Map()
  const first = await scanCodeWorkspace(fs, toplevel, hub, 'cache.code-workspace', cache)
  assert.deepEqual(first.roots.map((r) => r.path), ['../service-a'])
  // A different body (different size, so the stamp changes even on a coarse
  // filesystem clock) must be read again: a removed entry cannot stay alive.
  writeWorkspace('cache.code-workspace', JSON.stringify({ folders: [{ path: '../service-b' }] }))
  const second = await scanCodeWorkspace(fs, toplevel, hub, 'cache.code-workspace', cache)
  assert.deepEqual(second.roots.map((r) => r.path), ['../service-b'])
})

test('off never reads a file', async () => {
  const scan = await scanCodeWorkspace(fs, toplevel, hub, 'off')
  assert.deepEqual(scan, { file: null, roots: [] })
})

test('a workspace file past the size cap is invalid, not applied', async () => {
  writeWorkspace('huge.code-workspace', ' '.repeat(1024 * 1024 + 1))
  const scan = await scanCodeWorkspace(fs, toplevel, hub, 'huge.code-workspace')
  assert.deepEqual(scan.roots, [])
  assert.equal(scan.state, 'invalid')
})

test('the fixture file is not modified by a scan', async () => {
  const before = readFileSync(join(hub, 'hub.code-workspace'), 'utf8')
  await scanCodeWorkspace(fs, toplevel, hub, 'auto')
  assert.equal(readFileSync(join(hub, 'hub.code-workspace'), 'utf8'), before)
})
