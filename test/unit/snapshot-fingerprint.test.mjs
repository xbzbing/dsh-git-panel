import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DEFAULT_CONFIG, snapshotForSession } from '../../lib/host/core.js'
import { snapshotFingerprint } from '../../lib/host/snapshot-fingerprint.js'

const status = ' M a.txt\0M  b.txt\0'
const date = '2020-01-01T00:00:00Z'

async function fixture({ root = '/fixture', statusExitCode = 0, statusLossy = false, config = {} } = {}) {
  const commands = []
  const deps = {
    run: { run: async (argv) => {
      commands.push([...argv])
      let stdout = '', exitCode = 0, stdoutLossy = false
      if (argv[1] === 'rev-parse') stdout = argv.includes('--show-toplevel') ? root : 'abc123'
      else if (argv[1] === 'symbolic-ref') stdout = 'main'
      else if (argv[1] === 'status') { stdout = status; exitCode = statusExitCode; stdoutLossy = statusLossy }
      else if (argv[1] === 'rev-list') stdout = '1\t2'
      else if (argv[1] === 'log') stdout = `abcdef123456\x1fabc123\x1ffeat: sample\x1fTester\x1f${date}`
      else if (argv[1] === 'diff') stdout = argv.includes('--cached') ? '2\t1\tb.txt\n' : '3\t2\ta.txt\n'
      else if (argv[1] === 'remote') stdout = 'origin\thttps://github.com/owner/repo.git\t(fetch)\n'
      else assert.fail(`unexpected command: ${argv.join(' ')}`)
      return { stdout, exitCode, stdoutLossy, stderr: '', timedOut: false, cancelled: false }
    } },
    fs: { realpath: async (path) => path, stat: async () => ({ mtimeMs: 1234, size: 10, isDirectory: () => false }) },
    sessions: { liveCwd: () => root, persistedMeta: async () => undefined },
  }
  const result = await snapshotForSession(deps, { ...DEFAULT_CONFIG, ...config }, 's')
  assert.equal(result.ok, true)
  return { snapshot: result.value, commands }
}

function different(value) {
  if (value === null) return 'changed'
  if (typeof value === 'boolean') return !value
  if (typeof value === 'number') return value + 1
  if (typeof value === 'string') return value + '-changed'
  return null
}

function leaves(value, path = []) {
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => leaves(child, [...path, key]))
  return [{ path, value }]
}

function reversedKeys(value) {
  if (Array.isArray(value)) return value.map(reversedKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversedKeys(child)]))
}

test('the final snapshot exposes its deterministic SHA-256 business fingerprint without extra commands', async () => {
  const first = await fixture(), second = await fixture()
  assert.match(first.snapshot.stateFingerprint, /^[0-9a-f]{64}$/)
  assert.equal(first.snapshot.stateFingerprint, snapshotFingerprint(first.snapshot))
  assert.equal(first.snapshot.stateFingerprint, second.snapshot.stateFingerprint)
  assert.deepEqual(first.commands, second.commands)
  assert.equal(first.commands.length, 9, 'workspace resolution plus the existing eight snapshot commands')
})

test('fingerprint uses SHA-256 over recursively ordered business JSON', async () => {
  const { snapshot } = await fixture()
  const { checkedAt, stateFingerprint, ...business } = snapshot
  function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
  }
  const expected = createHash('sha256').update(JSON.stringify(sorted(business))).digest('hex')
  assert.equal(snapshotFingerprint(snapshot), expected)
})

test('every emitted top-level business field changes the digest when changed', async () => {
  const { snapshot } = await fixture()
  const expected = snapshotFingerprint(snapshot)
  for (const [key, value] of Object.entries(snapshot)) {
    if (key === 'checkedAt' || key === 'stateFingerprint') continue
    assert.notEqual(snapshotFingerprint({ ...snapshot, [key]: different(value) }), expected, key)
  }
  assert.notEqual(snapshotFingerprint({ ...snapshot, futureWireField: 'included' }), expected, 'future additive fields are included naturally')
})

test('every emitted nested business leaf participates in the digest', async () => {
  const { snapshot } = await fixture()
  const expected = snapshotFingerprint(snapshot)
  for (const { path, value } of leaves(snapshot)) {
    if (path.length === 1 && (path[0] === 'checkedAt' || path[0] === 'stateFingerprint')) continue
    if (path.length === 1) continue
    const changed = structuredClone(snapshot)
    let parent = changed
    for (const key of path.slice(0, -1)) parent = parent[key]
    parent[path.at(-1)] = different(value)
    assert.notEqual(snapshotFingerprint(changed), expected, path.join('.'))
  }
})

test('sampling time and an existing fingerprint do not affect the digest or mutate the snapshot', async () => {
  const { snapshot } = await fixture()
  const before = structuredClone(snapshot)
  const expected = snapshotFingerprint(snapshot)
  assert.equal(snapshotFingerprint({ ...snapshot, checkedAt: snapshot.checkedAt + 100, stateFingerprint: 'old-digest' }), expected)
  const { stateFingerprint, ...legacy } = snapshot
  assert.equal(snapshotFingerprint(legacy), expected)
  assert.deepEqual(snapshot, before)
  assert.notEqual(snapshotFingerprint({ ...snapshot, extension: { checkedAt: 1 } }), snapshotFingerprint({ ...snapshot, extension: { checkedAt: 2 } }), 'only top-level sampling fields are excluded')
})

test('object insertion order is ignored recursively while array order is preserved', async () => {
  const { snapshot } = await fixture()
  assert.equal(snapshotFingerprint(reversedKeys(snapshot)), snapshotFingerprint(snapshot))
  assert.notEqual(snapshotFingerprint({ ...snapshot, changes: [...snapshot.changes].reverse() }), snapshotFingerprint(snapshot))
})

test('undefined object fields and non-finite array values follow JSON wire semantics', async () => {
  const { snapshot } = await fixture()
  assert.equal(snapshotFingerprint({ ...snapshot, extension: undefined }), snapshotFingerprint(snapshot))
  assert.equal(snapshotFingerprint({ ...snapshot, extension: { value: undefined } }), snapshotFingerprint({ ...snapshot, extension: {} }))
  assert.equal(snapshotFingerprint({ ...snapshot, extension: [undefined, NaN, Infinity, -Infinity] }), snapshotFingerprint({ ...snapshot, extension: [null, null, null, null] }))
  assert.notEqual(snapshotFingerprint({ ...snapshot, extension: null }), snapshotFingerprint(snapshot))
})

test('equal status stdout with lossy or failed delivery fingerprints the changed final state', async () => {
  const regular = await fixture()
  const lossy = await fixture({ statusLossy: true })
  const failed = await fixture({ statusExitCode: 1 })
  assert.deepEqual(lossy.snapshot.changes, regular.snapshot.changes)
  assert.equal(regular.snapshot.truncated, false)
  assert.equal(regular.snapshot.truncatedReason, undefined)
  assert.equal(lossy.snapshot.truncated, true)
  assert.equal(lossy.snapshot.truncatedReason, 'lossy')
  assert.equal(failed.snapshot.dirty, false)
  assert.deepEqual(failed.snapshot.changes, [])
  assert.notEqual(lossy.snapshot.stateFingerprint, regular.snapshot.stateFingerprint)
  assert.notEqual(failed.snapshot.stateFingerprint, regular.snapshot.stateFingerprint)
  // A clipped expanded stream triggers the collapsed fallback; here that read is
  // clipped too, so the final state keeps the lossy list and says why.
  assert.deepEqual(lossy.commands, [...regular.commands, ['git', 'status', '--porcelain=v1', '-z', '--untracked-files=normal']])
  assert.deepEqual(failed.commands, regular.commands)
})

test('maxChanges truncation affects the digest while full counts remain accurate', async () => {
  const full = await fixture()
  const capped = await fixture({ config: { maxChanges: 1 } })
  assert.equal(capped.snapshot.changes.length, 1)
  assert.equal(capped.snapshot.truncated, true)
  assert.equal(capped.snapshot.staged, full.snapshot.staged)
  assert.equal(capped.snapshot.modified, full.snapshot.modified)
  assert.equal(capped.snapshot.stats.fileCount, full.snapshot.stats.fileCount)
  assert.notEqual(capped.snapshot.stateFingerprint, full.snapshot.stateFingerprint)
  assert.deepEqual(capped.commands, full.commands)
})

test('root and each wire configuration preference affect the final snapshot digest', async () => {
  const { snapshot } = await fixture()
  assert.notEqual((await fixture({ root: '/another-root' })).snapshot.stateFingerprint, snapshot.stateFingerprint)
  const preferences = { refreshIntervalMs: 1000, showInputPill: false, defaultDiffView: 'split', graphStyle: 'compact', suggestEnabled: false, detectCheckouts: false, filesFollowRepo: true, collapseReposOnPick: true }
  for (const [key, value] of Object.entries(preferences)) {
    const changed = await fixture({ config: { [key]: value } })
    assert.equal(changed.snapshot[key], value)
    assert.notEqual(changed.snapshot.stateFingerprint, snapshot.stateFingerprint, key)
  }
})
