/**
 * Parser tests: porcelain status, graph log, branches, name-status, numstat.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStatus, parseGraphLog, parseBranches, parseNameStatus, parseTags, sumNumstat, parseRefs } from '../../lib/testkit.mjs'

test('parseStatus splits a mixed XY into staged + unstaged sides', () => {
  const z = 'MM a.txt\0 M b.txt\0M  c.txt\0?? d.txt\0'
  const out = parseStatus(z)
  // a.txt MM → two entries (staged M + unstaged M)
  const a = out.filter((c) => c.path === 'a.txt')
  assert.equal(a.length, 2)
  assert.ok(a.some((c) => c.staged && c.status === 'modified'))
  assert.ok(a.some((c) => !c.staged && c.status === 'modified'))
  // b.txt " M" → one unstaged
  const b = out.filter((c) => c.path === 'b.txt')
  assert.deepEqual(b, [{ path: 'b.txt', status: 'modified', staged: false, isDirectory: false }])
  // c.txt "M " → one staged
  const c = out.filter((c) => c.path === 'c.txt')
  assert.deepEqual(c, [{ path: 'c.txt', status: 'modified', staged: true, isDirectory: false }])
  // d.txt "??" → untracked
  const d = out.filter((c) => c.path === 'd.txt')
  assert.deepEqual(d, [{ path: 'd.txt', status: 'untracked', staged: false, isDirectory: false }])
})

test('parseStatus marks untracked directories', () => {
  const out = parseStatus('?? dir/\0')
  assert.equal(out.length, 1)
  assert.equal(out[0].path, 'dir')
  assert.equal(out[0].isDirectory, true)
})

test('parseStatus keeps a real conflict as one entry', () => {
  const out = parseStatus('UU merge.txt\0')
  assert.deepEqual(out, [{ path: 'merge.txt', status: 'conflicted', staged: false, isDirectory: false }])
})

test('parseGraphLog reads records with unit/record separators', () => {
  const fmt = [
    'HASH1', 'h1', 'PARENT0', 'Alice', '2026-01-01T00:00:00+08:00', 'HEAD -> main, origin/main', 'first',
  ].join('\x1f') + '\x1e'
  const commits = parseGraphLog(fmt)
  assert.equal(commits.length, 1)
  const c = commits[0]
  assert.equal(c.hash, 'HASH1')
  assert.equal(c.shortHash, 'h1')
  assert.equal(c.subject, 'first')
  assert.equal(c.author, 'Alice')
  assert.deepEqual(c.parents, ['PARENT0'])
  assert.ok(c.refs.some((r) => r.kind === 'branch' && r.name === 'main' && r.head))
  assert.ok(c.refs.some((r) => r.kind === 'remote' && r.name === 'origin/main'))
})

test('parseGraphLog handles a root commit (no parents)', () => {
  const fmt = ['H', 'h', '', 'A', 'D', '', 'root'].join('\x1f') + '\x1e'
  const commits = parseGraphLog(fmt)
  assert.deepEqual(commits[0].parents, [])
})

test('parseRefs classifies branch / remote / tag and HEAD', () => {
  const refs = parseRefs('HEAD -> main, origin/feature, tag: v1.0')
  assert.ok(refs.some((r) => r.kind === 'branch' && r.name === 'main' && r.head))
  assert.ok(refs.some((r) => r.kind === 'remote' && r.name === 'origin/feature'))
  assert.ok(refs.some((r) => r.kind === 'tag' && r.name === 'v1.0'))
})

test('parseBranches reads name/hash/track with ahead·behind', () => {
  const out = parseBranches('main\x00abc1234\x00[ahead 2, behind 1]\nfeature\x00def5678\x00')
  const main = out.find((b) => b.name === 'main')
  assert.equal(main.shortHash, 'abc1234')
  assert.equal(main.ahead, 2)
  assert.equal(main.behind, 1)
  const feat = out.find((b) => b.name === 'feature')
  assert.equal(feat.shortHash, 'def5678')
  assert.equal(feat.ahead, undefined)
})

test('parseNameStatus reads statuses and rename new-path', () => {
  // A file, M file, R old→new
  const z = 'A\0added.txt\0M\0mod.txt\0R100\0old.txt\0new.txt\0'
  const out = parseNameStatus(z)
  assert.deepEqual(out.find((s) => s.path === 'added.txt'), { path: 'added.txt', status: 'added' })
  assert.deepEqual(out.find((s) => s.path === 'mod.txt'), { path: 'mod.txt', status: 'modified' })
  assert.deepEqual(out.find((s) => s.path === 'new.txt'), { path: 'new.txt', status: 'renamed' })
})

test('parseNameStatus keeps paths with spaces and unicode intact (-z NUL split)', () => {
  const z = 'A\0dir with spaces/файл.txt\0M\0mod.txt\0'
  const out = parseNameStatus(z)
  assert.deepEqual(out, [
    { path: 'dir with spaces/файл.txt', status: 'added' },
    { path: 'mod.txt', status: 'modified' },
  ])
})

test('parseNameStatus stops on a malformed token instead of shifting later fields', () => {
  // A valid A entry, then a garbage token: the scan stops rather than
  // mis-pairing the rest.
  const out = parseNameStatus('A\0good.txt\0garbage\0M\0mod.txt\0')
  assert.deepEqual(out, [{ path: 'good.txt', status: 'added' }])
})

test('parseGraphLog keeps a 0x1f inside the subject in the subject field', () => {
  const fmt = ['H', 'h', 'P', 'Alice', 'D', '', 'sub\x1fject'].join('\x1f') + '\x1e'
  const commits = parseGraphLog(fmt)
  assert.equal(commits[0].subject, 'sub\x1fject')
  assert.equal(commits[0].author, 'Alice')
})

test('parseStatus keeps a space/unicode filename end to end', () => {
  const out = parseStatus(' M path with space/файл.txt\0')
  assert.deepEqual(out, [{ path: 'path with space/файл.txt', status: 'modified', staged: false, isDirectory: false }])
})

test('sumNumstat totals additions/deletions and skips binary rows', () => {
  const out = sumNumstat('3\t1\ta.txt\n10\t0\tb.txt\n-\t-\timage.png\n')
  assert.deepEqual(out, { insertions: 13, deletions: 1 })
})

test('parseTags reads name\\0shortHash lines and nulls a missing hash', () => {
  const out = parseTags('v1.0\x00abc1234\nv0.9\x00\n\n')
  assert.deepEqual(out, [
    { name: 'v1.0', shortHash: 'abc1234' },
    { name: 'v0.9', shortHash: null },
  ])
})
