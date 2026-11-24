/**
 * The tab's pick record: a module reload (the platform's hot reload re-runs the
 * bundle) or a refresh must come back to the checkout and file root the user
 * chose, and only a definitive host answer may delete that record.
 *
 * Each `fresh()` imports the testkit under a new URL, which is a new module
 * instance with empty in-memory maps: exactly what a hot reload leaves behind.
 * The fake `sessionStorage` is the one thing both instances share.
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

class MemoryStorage {
  constructor() { this.map = new Map() }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null }
  setItem(key, value) { this.map.set(key, String(value)) }
  removeItem(key) { this.map.delete(key) }
  clear() { this.map.clear() }
}

let generation = 0
const fresh = () => import(`../../lib/testkit.mjs?load=${generation++}`)

beforeEach(() => {
  globalThis.sessionStorage = new MemoryStorage()
})

test('parsing treats anything malformed or of another version as nothing remembered', async () => {
  const { parsePicks, PICKS_VERSION } = await fresh()
  assert.equal(parsePicks(null).size, 0)
  assert.equal(parsePicks('{not json').size, 0)
  assert.equal(parsePicks('[]').size, 0)
  assert.equal(parsePicks(JSON.stringify({ v: PICKS_VERSION + 1, sessions: { s: { repo: 'a', at: 1 } } })).size, 0)
  const picks = parsePicks(JSON.stringify({
    v: PICKS_VERSION,
    sessions: {
      good: { repo: 'site', at: 5 },
      root: { rootPick: true, at: 5 },
      pin: { files: { mode: 'pin', path: 'api' }, follow: false, at: 5 },
      noAt: { repo: 'site' },
      emptyRepo: { repo: '', at: 5 },
      nul: { repo: 'a\0b', at: 5 },
      badFiles: { files: { mode: 'pin' }, at: 5 },
      [`${'k'.repeat(300)}`]: { repo: 'site', at: 5 },
    },
  }))
  assert.deepEqual([...picks.keys()].sort(), ['good', 'pin', 'root'])
  assert.deepEqual(picks.get('pin'), { files: { mode: 'pin', path: 'api' }, follow: false, at: 5 })
})

test('serializing keeps the most recently written sessions up to the cap', async () => {
  const { parsePicks, serializePicks, PICKS_MAX } = await fresh()
  const picks = new Map()
  for (let i = 0; i < PICKS_MAX + 10; i++) picks.set(`s${i}`, { repo: 'r', at: i })
  const kept = parsePicks(serializePicks(picks))
  assert.equal(kept.size, PICKS_MAX)
  assert.equal(kept.has('s0'), false, 'the oldest go first')
  assert.equal(kept.has(`s${PICKS_MAX + 9}`), true)
})

test('a pick survives a module reload', async () => {
  const before = await fresh()
  before.selectRepo('hmr', 'nested/site')
  const after = await fresh()
  assert.equal(after.selectedRepo('hmr'), 'nested/site')
  assert.equal(after.hasRepoPick('hmr'), true)
  assert.equal(after.selectedRepo('other'), '', 'another session has no record')
})

test('a deliberate root pick survives as intent', async () => {
  const before = await fresh()
  before.selectRepo('root', 'site')
  before.selectRepo('root', '')
  const after = await fresh()
  assert.equal(after.selectedRepo('root'), '')
  assert.equal(after.hasRepoPick('root'), true, 'the files-only auto-pick must not override it')
})

test('a repair holds for this load only unless the host was definitive', async () => {
  const first = await fresh()
  first.selectRepo('repair', 'site')
  first.clearRepoPick('repair')
  assert.equal(first.selectedRepo('repair'), '', 'the fallback is immediate')
  assert.equal(first.selectedRepo('repair'), '', 'and the record is not read back in the same load')
  const second = await fresh()
  assert.equal(second.selectedRepo('repair'), 'site', 'the next load tries the pick again')
  second.clearRepoPick('repair', { forget: true })
  const third = await fresh()
  assert.equal(third.selectedRepo('repair'), '', 'a definitive refusal deletes the record')
  assert.equal(third.hasRepoPick('repair'), false)
})

test('the file-root pick is restored with the repository pick, in one record', async () => {
  const before = await fresh()
  before.selectRepo('files', 'site')
  before.pickFilesRoot('files', 'api')
  before.selectRepo('files', 'web')
  const after = await fresh()
  assert.equal(after.selectedRepo('files'), 'web', 'a repository write keeps the files part')
  assert.equal(after.pinnedFilesRoot('files'), 'api', 'and a files write keeps the repository part')
  after.resumeFilesRootFollow('files')
  const again = await fresh()
  assert.equal(again.filesRootPick('files', false), null, 'the follow opt-in is remembered too')
  again.pickFilesRoot('files', '')
  const last = await fresh()
  assert.equal(last.filesRootPick('files', true), '', 'and so is the project root')
})

test('a forgotten pin leaves the repository pick in place', async () => {
  const before = await fresh()
  before.selectRepo('pin', 'site')
  before.pickFilesRoot('pin', 'api')
  before.clearFilesRootPin('pin')
  assert.equal((await fresh()).pinnedFilesRoot('pin'), 'api', 'a list repair holds for this load only')
  before.clearFilesRootPin('pin', { forget: true })
  const after = await fresh()
  assert.equal(after.pinnedFilesRoot('pin'), undefined)
  assert.equal(after.selectedRepo('pin'), 'site')
})

test('a restored file root made under another follow setting is dropped', async () => {
  const before = await fresh()
  before.syncFilesFollowConfig(false, 100)
  before.pickFilesRoot('flip', 'api')
  before.pickFilesRoot('same', 'api')
  const after = await fresh()
  assert.equal(after.pinnedFilesRoot('flip'), 'api', 'unknown until a sample says otherwise')
  assert.equal(after.syncFilesFollowConfig(true, 200), true, 'the setting flipped while nothing watched')
  assert.equal(after.pinnedFilesRoot('flip'), undefined)
  assert.equal(after.pinnedFilesRoot('same'), undefined, 'every restored pick of the old setting goes')
  assert.equal((await fresh()).pinnedFilesRoot('flip'), undefined, 'and the record forgets it')

  const kept = await fresh()
  kept.syncFilesFollowConfig(true, 300)
  kept.pickFilesRoot('stay', 'api')
  const next = await fresh()
  next.pinnedFilesRoot('stay')
  assert.equal(next.syncFilesFollowConfig(true, 400), false, 'the same setting confirms the pick')
  assert.equal(next.pinnedFilesRoot('stay'), 'api')
})

test('a config flip clears every stored file root but no repository pick', async () => {
  const before = await fresh()
  before.syncFilesFollowConfig(false, 100)
  before.selectRepo('cfg', 'site')
  before.pickFilesRoot('cfg', 'api')
  assert.equal(before.syncFilesFollowConfig(true, 200), true)
  const after = await fresh()
  assert.equal(after.pinnedFilesRoot('cfg'), undefined)
  assert.equal(after.selectedRepo('cfg'), 'site')
})

test('a store that throws degrades to memory', async () => {
  globalThis.sessionStorage = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('quota') },
    removeItem() { throw new Error('blocked') },
  }
  const kit = await fresh()
  kit.selectRepo('blocked', 'site')
  assert.equal(kit.selectedRepo('blocked'), 'site')
  kit.clearRepoPick('blocked', { forget: true })
  assert.equal(kit.selectedRepo('blocked'), '')
})

test('the list keeps, drops or forgets a remembered selector', async () => {
  const { listVerdict } = await fresh()
  const repos = [
    { path: '', root: '/w', name: 'w', kind: 'workspace' },
    { path: 'ok', root: '/w/ok', name: 'ok', kind: 'nested' },
    { path: 'gone', root: '/w/gone', name: 'gone', kind: 'nested', disabled: 'stale' },
    { path: 'copy', root: '/w/copy', name: 'copy', kind: 'nested', disabled: 'uncertified' },
  ]
  assert.equal(listVerdict(repos, 'ok'), 'keep')
  assert.equal(listVerdict(repos, 'gone'), 'forget', 'git says the directory is gone')
  assert.equal(listVerdict(repos, 'copy'), 'drop')
  assert.equal(listVerdict(repos, 'missing'), 'drop', 'a missing row may be one the ceiling cut')
})

test('a failed sample forgets the pick only on a refusal git answered', async () => {
  const { sampleVerdict } = await fresh()
  assert.equal(sampleVerdict({ code: 'invalid-repo' }), 'forget')
  assert.equal(sampleVerdict({ code: 'invalid-repo', unverified: true }), 'drop')
  assert.equal(sampleVerdict({ code: 'git-unavailable', detail: 'x' }), 'drop')
  assert.equal(sampleVerdict({ code: 'timeout' }), 'keep')
  assert.equal(sampleVerdict({ code: 'transport' }), 'keep')
})
