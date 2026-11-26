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

/** Install `store` as the global. A data property defined outright, not an
 * assignment: a Node that ships Web Storage defines the global as a getter. */
function useStorage(store) {
  Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true, writable: true })
}

beforeEach(() => {
  useStorage(new MemoryStorage())
})

/** The raw stored records, for assertions on what the tab keeps. */
function stored() {
  const raw = globalThis.sessionStorage.getItem('dbGitPanel.picks')
  return raw === null ? {} : JSON.parse(raw).sessions
}

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
  next.pinnedFilesRoot('stay') // the first lookup reads the record in
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
  useStorage({
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('quota') },
    removeItem() { throw new Error('blocked') },
  })
  const kit = await fresh()
  kit.selectRepo('blocked', 'site')
  assert.equal(kit.selectedRepo('blocked'), 'site')
  kit.clearRepoPick('blocked', { forget: true })
  assert.equal(kit.selectedRepo('blocked'), '')
})

test('a global whose very read throws degrades to memory', async () => {
  // Where storage is blocked outright, touching `sessionStorage` throws.
  Object.defineProperty(globalThis, 'sessionStorage', {
    get() { throw new Error('SecurityError') },
    configurable: true,
  })
  const kit = await fresh()
  kit.selectRepo('denied', 'site')
  kit.pickFilesRoot('denied', 'api')
  assert.equal(kit.selectedRepo('denied'), 'site')
  assert.equal(kit.pinnedFilesRoot('denied'), 'api')
})

test('a selector longer than any path is not read back', async () => {
  const { parsePicks, PICKS_VERSION } = await fresh()
  const longest = 'p'.repeat(4096)
  const picks = parsePicks(JSON.stringify({
    v: PICKS_VERSION,
    sessions: {
      fits: { repo: longest, at: 1 },
      over: { repo: longest + 'p', at: 1 },
      pinOver: { files: { mode: 'pin', path: longest + 'p' }, at: 1 },
    },
  }))
  assert.equal(picks.get('fits')?.repo, longest)
  assert.equal(picks.has('over'), false)
  assert.equal(picks.has('pinOver'), false)
})

test('only a changed record takes a new eviction time, and a repair keeps the old one', async () => {
  const { PICKS_VERSION } = await fresh()
  globalThis.sessionStorage.setItem('dbGitPanel.picks', JSON.stringify({
    v: PICKS_VERSION,
    sessions: {
      a: { repo: 'x', files: { mode: 'pin', path: 'p' }, follow: false, at: 10 },
      b: { repo: 'y', at: 20 },
    },
  }))
  const kit = await fresh()
  kit.syncFilesFollowConfig(false, 1)
  kit.selectRepo('b', 'y')
  assert.equal(stored().b.at, 20, 'the same pick again is no write')
  assert.equal(kit.syncFilesFollowConfig(true, 2), true, 'a config flip')
  assert.deepEqual(stored().a, { repo: 'x', at: 10 }, 'the files part goes, the time stays')
  assert.equal(stored().b.at, 20)
  kit.selectRepo('b', 'z')
  assert.notEqual(stored().b.at, 20, 'a new pick is the newest')
})

test('a file root picked before any sample is bound to the first setting seen', async () => {
  // A files-only session never gets a ready sample, so its pick is made with
  // the follow config unknown. The first sample stamps it, so a flip seen by a
  // later load still retires it.
  const before = await fresh()
  before.pickFilesRoot('unstamped', 'api')
  assert.equal(stored().unstamped.follow, undefined, 'nothing to record yet')
  before.syncFilesFollowConfig(true, 100)
  assert.equal(stored().unstamped.follow, true, 'the first sample binds it')
  const after = await fresh()
  assert.equal(after.pinnedFilesRoot('unstamped'), 'api')
  assert.equal(after.syncFilesFollowConfig(false, 200), true, 'the setting flipped while nothing watched')
  assert.equal(after.pinnedFilesRoot('unstamped'), undefined)

  // A record without the value, read where the setting is already known, is
  // bound on the spot.
  const { PICKS_VERSION } = after
  globalThis.sessionStorage.setItem('dbGitPanel.picks', JSON.stringify({
    v: PICKS_VERSION,
    sessions: { legacy: { files: { mode: 'pin', path: 'p' }, at: 5 } },
  }))
  const known = await fresh()
  known.syncFilesFollowConfig(true, 300)
  assert.equal(known.pinnedFilesRoot('legacy'), 'p')
  assert.equal(stored().legacy.follow, true)
})

test('every file-root change the store makes is broadcast', async () => {
  // Two mounted panels share the store; a repair one of them applies has to
  // reach the other one's render, not only the caller's.
  const kit = await fresh()
  let heard = 0
  const stop = kit.subscribeRepoSelection(() => { heard += 1 })
  const at = () => kit.filesRootVersion()
  let version = at()
  for (const [label, act] of [
    ['a pick', () => kit.pickFilesRoot('b', 'api')],
    ['a repair', () => kit.clearFilesRootPin('b')],
    ['the follow row', () => kit.resumeFilesRootFollow('b')],
    ['a config flip', () => { kit.syncFilesFollowConfig(false, 1); kit.syncFilesFollowConfig(true, 2) }],
  ]) {
    const was = heard
    act()
    assert.ok(heard > was, label + ' notifies')
    assert.ok(at() > version, label + ' moves the version')
    version = at()
  }
  stop()

  // A restored pick the first sample retires is a change the second panel has
  // to see as well: its own sync call comes back false (same sample).
  const restored = await fresh()
  restored.syncFilesFollowConfig(false, 1)
  restored.pickFilesRoot('r', 'api')
  const reloaded = await fresh()
  reloaded.pinnedFilesRoot('r')
  let told = 0
  const off = reloaded.subscribeRepoSelection(() => { told += 1 })
  assert.equal(reloaded.syncFilesFollowConfig(true, 5), true)
  assert.equal(told > 0, true, 'the drop is broadcast')
  assert.equal(reloaded.syncFilesFollowConfig(true, 5), false, 'the other panel reads the same sample')
  off()
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

test('a pick made with persist: false holds in memory only', async () => {
  // The store half of the files-only auto-pick (the panel side is pinned by the
  // repo-pick-persist e2e): a convenience pick must not become intent, so the
  // record stays empty and the next load derives the pick again.
  const before = await fresh()
  before.selectRepo('auto', 'site', { persist: false })
  assert.equal(before.selectedRepo('auto'), 'site', 'the pick holds in memory')
  assert.equal(before.hasRepoPick('auto'), true, 'this module load knows about it')
  const after = await fresh()
  assert.equal(after.selectedRepo('auto'), '', 'nothing was written for the next load')
  assert.equal(after.hasRepoPick('auto'), false)
})

test('a followed selection never rewrites the stored manual pick', async () => {
  const first = await fresh()
  first.selectRepo('follow', 'site')
  first.followRepo('follow', 'web')
  assert.equal(first.selectedRepo('follow'), 'web')
  assert.equal(first.hasRepoPick('follow'), false, 'the automatic selection is not intent')
  first.clearRepoPick('follow', { forget: true })
  const second = await fresh()
  assert.equal(second.selectedRepo('follow'), 'site', 'the earlier manual pick survives the automatic repair')
  assert.equal(second.hasRepoPick('follow'), true)
})
