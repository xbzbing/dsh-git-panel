/**
 * File-browser edit: the allow-list, the encoding rules, the `file-content`
 * edit fields, and the compare-and-swap write endpoint, driven against real
 * temp directories through the production fs wiring (`createFsDeps`).
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn as nodeSpawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { runQuery, createGitRunner, DEFAULT_CONFIG, normalizeConfig, snapshotForSession, writeWorkspaceFile, editInfo, encodeEdit, eolStyle } from '../../lib/host/index.js'
import { createFsDeps } from '../../lib/host/fs-deps.js'
import { EDIT_MAX_BYTES, EDITABLE_EXTENSIONS, EDITABLE_FILENAMES, isEditablePath } from '../../lib/host/types.js'

const SID = 'edit-session'
const dirs = []
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

/** child_process-backed subprocess stand-in (same face as host-integration). */
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
    return { done, collected: { stdout: { readFrom: () => ({ text: out, lossy: false }) }, stderr: { readFrom: () => ({ text: err, lossy: false }) } } }
  },
}

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'gp-edit-'))
  dirs.push(dir)
  return dir
}

function depsAt(dir, fs = createFsDeps()) {
  return {
    run: createGitRunner(subprocess, DEFAULT_CONFIG.timeoutMs, DEFAULT_CONFIG.maxBytes),
    fs,
    sessions: { liveCwd: () => dir, persistedMeta: async () => undefined },
  }
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

async function read(dir, path, config = DEFAULT_CONFIG) {
  const res = await runQuery(depsAt(dir), config, { sessionId: SID, query: { kind: 'file-content', path } })
  assert.equal(res.ok, true, JSON.stringify(res))
  return res.value
}

function save(dir, path, content, baseSha256, config = DEFAULT_CONFIG, fs) {
  return writeWorkspaceFile(depsAt(dir, fs), config, dir, { path, content, baseSha256 })
}

test('allow-list: every extension and whole name, case-insensitive; .env.* variants refused', () => {
  for (const ext of EDITABLE_EXTENSIONS) {
    assert.equal(isEditablePath(`conf/app.${ext}`), true, ext)
    assert.equal(isEditablePath(`APP.${ext.toUpperCase()}`), true, ext)
  }
  for (const name of EDITABLE_FILENAMES) {
    assert.equal(isEditablePath(name), true, name)
    assert.equal(isEditablePath(`sub/dir/${name}`), true, name)
  }
  assert.equal(isEditablePath('.ENV'), true)
  // The extension of these names is on the list, so only the `.env.` prefix
  // rule keeps them out.
  for (const name of ['.env.local', '.env.example', '.env.production', '.env.json', '.env.yaml', 'sub/.env.toml']) {
    assert.equal(isEditablePath(name), false, name)
  }
  for (const name of ['run.sh', 'index.js', 'page.html', 'logo.svg', 'Makefile', '.json', 'notes.md.bak', 'a/.gitignore/x']) {
    assert.equal(isEditablePath(name), false, name)
  }
})

test('encoding rules: eol style, UTF-8 round trip, BOM, size cap', () => {
  assert.equal(eolStyle('a\nb\n'), 'lf')
  assert.equal(eolStyle('no break'), 'lf')
  assert.equal(eolStyle('a\r\nb\r\n'), 'crlf')
  assert.equal(eolStyle('a\r\nb\n'), 'mixed')
  assert.equal(eolStyle('a\rb'), 'mixed')
  assert.deepEqual(editInfo(Buffer.from('k=v\n')), { ok: true, eol: 'lf', bom: false })
  assert.deepEqual(editInfo(Buffer.from('\uFEFFk=v\r\n')), { ok: true, eol: 'crlf', bom: true })
  // GBK "中文": not valid UTF-8, a save would replace it with U+FFFD.
  assert.deepEqual(editInfo(Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a])), { ok: false, reason: 'encoding' })
  assert.deepEqual(editInfo(Buffer.from('a\r\nb\n')), { ok: false, reason: 'mixed-eol' })
  // A NUL past the preview's 8 KB binary probe still makes the bytes non-text.
  assert.deepEqual(editInfo(Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0])])), { ok: false, reason: 'encoding' })
  assert.equal(editInfo(Buffer.alloc(EDIT_MAX_BYTES, 0x61)).ok, true)
  assert.deepEqual(editInfo(Buffer.alloc(EDIT_MAX_BYTES + 1, 0x61)), { ok: false, reason: 'too-large' })
  assert.equal(encodeEdit('a\nb', 'crlf', false).toString(), 'a\r\nb')
  assert.equal(encodeEdit('a\r\nb\rc', 'lf', false).toString(), 'a\nb\nc')
  assert.deepEqual([...encodeEdit('\uFEFFx', 'lf', true)], [0xef, 0xbb, 0xbf, 0x78], 'a BOM never doubles')
})

test('file-content carries sha256 + edit only for allow-listed files while editing is on', async () => {
  const dir = workspace()
  writeFileSync(join(dir, 'notes.md'), '# hi\n')
  writeFileSync(join(dir, 'run.sh'), 'echo hi\n')
  writeFileSync(join(dir, 'gbk.properties'), Buffer.from([0xd6, 0xd0, 0x3d, 0x31, 0x0a]))
  writeFileSync(join(dir, 'mixed.txt'), 'a\r\nb\n')
  writeFileSync(join(dir, 'big.json'), Buffer.alloc(EDIT_MAX_BYTES + 1, 0x20))
  const md = await read(dir, 'notes.md')
  assert.equal(md.sha256, sha(Buffer.from('# hi\n')))
  assert.deepEqual(md.edit, { ok: true, eol: 'lf', bom: false })
  const sh = await read(dir, 'run.sh')
  assert.equal(sh.edit, undefined)
  assert.equal(sh.sha256, undefined)
  assert.deepEqual((await read(dir, 'gbk.properties')).edit, { ok: false, reason: 'encoding' })
  assert.deepEqual((await read(dir, 'mixed.txt')).edit, { ok: false, reason: 'mixed-eol' })
  const big = await read(dir, 'big.json')
  assert.deepEqual(big.edit, { ok: false, reason: 'too-large' })
  assert.equal(big.sha256, undefined, 'no fingerprint for a file that cannot be edited anyway')
  const off = await read(dir, 'notes.md', { ...DEFAULT_CONFIG, allowFileEdit: false })
  assert.equal(off.edit, undefined)
  assert.equal(off.sha256, undefined)
})

test('allowFileEdit defaults on, unwraps volatile refs, and rides the snapshot fingerprint', async () => {
  assert.equal(normalizeConfig({}).allowFileEdit, true)
  assert.equal(normalizeConfig({ allowFileEdit: false }).allowFileEdit, false)
  assert.equal(normalizeConfig({ allowFileEdit: { get: () => false } }).allowFileEdit, false)
  const dir = workspace()
  await new Promise((resolve) => nodeSpawn('git', ['init', '-q'], { cwd: dir }).on('close', resolve))
  const on = await snapshotForSession(depsAt(dir), DEFAULT_CONFIG, SID)
  const off = await snapshotForSession(depsAt(dir), { ...DEFAULT_CONFIG, allowFileEdit: false }, SID)
  assert.equal(on.value.allowFileEdit, true)
  assert.equal(off.value.allowFileEdit, false)
  assert.notEqual(on.value.stateFingerprint, off.value.stateFingerprint)
})

test('save writes the buffer, returns the new file-content view, and keeps CRLF / BOM / no trailing newline', async () => {
  const dir = workspace()
  const before = Buffer.from('\uFEFFa=1\r\nb=2')
  writeFileSync(join(dir, 'app.ini'), before)
  const res = await save(dir, 'app.ini', 'a=1\nb=3', sha(before))
  assert.equal(res.ok, true, JSON.stringify(res))
  const after = readFileSync(join(dir, 'app.ini'))
  assert.deepEqual([...after], [...Buffer.from('\uFEFFa=1\r\nb=3')])
  assert.equal(res.value.sha256, sha(after))
  assert.deepEqual(res.value.edit, { ok: true, eol: 'crlf', bom: true })
  assert.equal(res.value.size, after.length)
  assert.equal(res.value.lines, 2)
  assert.equal(res.value.variant, 'text')
  assert.equal(readdirSync(dir).filter((n) => n.includes('.gp-')).length, 0, 'no temp file left')
})

test('a stale base is refused as file-changed with the current fingerprint; resending with it succeeds', async () => {
  const dir = workspace()
  writeFileSync(join(dir, 'c.yaml'), 'a: 1\n')
  const base = sha(Buffer.from('a: 1\n'))
  writeFileSync(join(dir, 'c.yaml'), 'a: 2\n')
  const stale = await save(dir, 'c.yaml', 'a: 3\n', base)
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'file-changed')
  assert.equal(stale.error.currentSha256, sha(Buffer.from('a: 2\n')))
  assert.equal(readFileSync(join(dir, 'c.yaml'), 'utf8'), 'a: 2\n', 'nothing written')
  const forced = await save(dir, 'c.yaml', 'a: 3\n', stale.error.currentSha256)
  assert.equal(forced.ok, true)
  assert.equal(readFileSync(join(dir, 'c.yaml'), 'utf8'), 'a: 3\n')
})

test('two concurrent saves from one base: exactly one wins, the other gets file-changed', async () => {
  const dir = workspace()
  writeFileSync(join(dir, 'r.txt'), 'x\n')
  const base = sha(Buffer.from('x\n'))
  const results = await Promise.all([save(dir, 'r.txt', 'one\n', base), save(dir, 'r.txt', 'two\n', base)])
  assert.equal(results.filter((r) => r.ok).length, 1)
  assert.equal(results.filter((r) => !r.ok && r.error.code === 'file-changed').length, 1)
})

test('refusals write nothing: type, path, .git, disabled, too large, encoding', async () => {
  const dir = workspace()
  mkdirSync(join(dir, '.git'))
  writeFileSync(join(dir, '.git', 'config.toml'), 'x')
  writeFileSync(join(dir, 'run.sh'), 'echo\n')
  writeFileSync(join(dir, '.env.local'), 'K=1\n')
  writeFileSync(join(dir, 'gbk.txt'), Buffer.from([0xd6, 0xd0, 0x0a]))
  writeFileSync(join(dir, 'ok.md'), 'x\n')
  const okBase = sha(Buffer.from('x\n'))
  const code = async (p) => (await p).error?.code
  assert.equal(await code(save(dir, 'run.sh', 'rm -rf /\n', sha(Buffer.from('echo\n')))), 'not-editable')
  assert.equal(await code(save(dir, '.env.local', 'K=2\n', sha(Buffer.from('K=1\n')))), 'not-editable')
  assert.equal(await code(save(dir, '../outside.md', 'x', okBase)), 'invalid-path')
  assert.equal(await code(save(dir, '/etc/hosts.txt', 'x', okBase)), 'invalid-path')
  assert.equal(await code(save(dir, '.git/config.toml', 'x', sha(Buffer.from('x')))), 'invalid-path')
  assert.equal(await code(save(dir, 'missing.md', 'x', okBase)), 'file-not-found')
  assert.equal(await code(save(dir, 'ok.md', 'y\n', okBase, { ...DEFAULT_CONFIG, allowFileEdit: false })), 'edit-disabled')
  assert.equal(await code(save(dir, 'ok.md', 'y\n', 'not-a-hash')), 'not-editable')
  const reason = async (p) => { const r = await p; return [r.error?.code, r.error?.reason] }
  assert.deepEqual(await reason(save(dir, 'ok.md', 'a'.repeat(EDIT_MAX_BYTES + 1), okBase)), ['not-editable', 'too-large'])
  assert.deepEqual(await reason(save(dir, 'ok.md', '中'.repeat(Math.floor(EDIT_MAX_BYTES / 3) + 1), okBase)), ['not-editable', 'too-large'], 'the byte size counts, not the text length')
  assert.deepEqual(await reason(save(dir, 'gbk.txt', 'x\n', sha(Buffer.from([0xd6, 0xd0, 0x0a])))), ['not-editable', 'encoding'])
  assert.equal(readFileSync(join(dir, 'run.sh'), 'utf8'), 'echo\n')
  assert.equal(readFileSync(join(dir, '.env.local'), 'utf8'), 'K=1\n')
  assert.equal(readFileSync(join(dir, 'ok.md'), 'utf8'), 'x\n')
})

test('links: an allow-listed name may not lead to a script; an in-root link writes its target and stays a link', async (t) => {
  if (process.platform === 'win32') { t.skip('symlinks need privileges on Windows'); return }
  const dir = workspace()
  const outside = workspace()
  mkdirSync(join(dir, 'docs'))
  writeFileSync(join(dir, 'run.sh'), 'echo\n')
  writeFileSync(join(dir, 'docs', 'b.md'), 'b\n')
  writeFileSync(join(outside, 'secret.md'), 's\n')
  symlinkSync('run.sh', join(dir, 'a.md'))
  symlinkSync('docs/b.md', join(dir, 'link.md'))
  symlinkSync(join(outside, 'secret.md'), join(dir, 'out.md'))
  assert.equal((await read(dir, 'a.md')).edit, undefined, 'the read offers no edit for a link to a script')
  assert.equal((await save(dir, 'a.md', 'x', sha(Buffer.from('echo\n')))).error.code, 'not-editable')
  assert.equal((await save(dir, 'out.md', 'x', sha(Buffer.from('s\n')))).error.code, 'invalid-path')
  const res = await save(dir, 'link.md', 'B\n', sha(Buffer.from('b\n')))
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(readFileSync(join(dir, 'docs', 'b.md'), 'utf8'), 'B\n')
  assert.equal(lstatSync(join(dir, 'link.md')).isSymbolicLink(), true)
  assert.equal(readFileSync(join(outside, 'secret.md'), 'utf8'), 's\n')
  assert.equal(readFileSync(join(dir, 'run.sh'), 'utf8'), 'echo\n')
})

test('permission bits survive the atomic replace', async (t) => {
  if (process.platform === 'win32') { t.skip('POSIX modes only'); return }
  const dir = workspace()
  // Group-writable bits are what the usual 022 umask strips from `open`'s
  // mode, so only the explicit chmod can carry them over.
  for (const mode of [0o600, 0o664, 0o666]) {
    const name = `m${mode.toString(8)}.txt`
    writeFileSync(join(dir, name), 'k\n')
    chmodSync(join(dir, name), mode)
    const res = await save(dir, name, 'k2\n', sha(Buffer.from('k\n')))
    assert.equal(res.ok, true, JSON.stringify(res))
    assert.equal(statSync(join(dir, name)).mode & 0o777, mode, name)
  }
})

test('a read-only file is offered and saved as read-only, and stays untouched', async (t) => {
  if (process.platform === 'win32') { t.skip('POSIX modes only'); return }
  if (process.getuid?.() === 0) { t.skip('root may write any file'); return }
  const dir = workspace()
  writeFileSync(join(dir, 'ro.json'), '{}\n')
  chmodSync(join(dir, 'ro.json'), 0o444)
  const view = await read(dir, 'ro.json')
  assert.deepEqual(view.edit, { ok: false, reason: 'read-only' })
  const res = await save(dir, 'ro.json', '{"a":1}\n', sha(Buffer.from('{}\n')))
  assert.deepEqual([res.error?.code, res.error?.reason], ['not-editable', 'read-only'])
  assert.equal(readFileSync(join(dir, 'ro.json'), 'utf8'), '{}\n')
  assert.equal(statSync(join(dir, 'ro.json')).mode & 0o777, 0o444)
})

const errno = (code, path) => Object.assign(new Error(`${code}: injected, '${path}'`), { code })

test('a failed rename removes the temp file, leaves the target untouched, and reports the errno only', async () => {
  const dir = workspace()
  writeFileSync(join(dir, 'f.toml'), 'a = 1\n')
  for (const [code, wire] of [['EXDEV', 'write-failed'], ['EACCES', 'write-denied'], ['EROFS', 'write-denied']]) {
    const fs = { ...createFsDeps(), rename: async (from) => { throw errno(code, from) } }
    const res = await save(dir, 'f.toml', 'a = 2\n', sha(Buffer.from('a = 1\n')), DEFAULT_CONFIG, fs)
    assert.deepEqual(res, { ok: false, error: { code: wire, message: code } }, 'no path in the wire error')
    assert.deepEqual(readdirSync(dir), ['f.toml'])
    assert.equal(readFileSync(join(dir, 'f.toml'), 'utf8'), 'a = 1\n')
  }
})

test('a temp name that is already taken is left alone', async () => {
  const dir = workspace()
  writeFileSync(join(dir, 'g.txt'), 'x\n')
  let taken = null
  const fs = {
    ...createFsDeps(),
    writeExclusive: async (path) => {
      taken = path
      writeFileSync(path, 'not ours')
      throw errno('EEXIST', path)
    },
  }
  const res = await save(dir, 'g.txt', 'y\n', sha(Buffer.from('x\n')), DEFAULT_CONFIG, fs)
  assert.deepEqual(res, { ok: false, error: { code: 'write-failed', message: 'EEXIST' } })
  assert.equal(readFileSync(taken, 'utf8'), 'not ours')
  assert.equal(readFileSync(join(dir, 'g.txt'), 'utf8'), 'x\n')
})
