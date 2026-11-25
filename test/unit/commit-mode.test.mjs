/**
 * `commitModeFor` / `rememberCommitMode`: the split commit button's tab scope
 * (issue #152). The mode is a workflow preference that must survive tab
 * switches inside one DSH session, a page refresh and a module reload, stay
 * independent between sessions, and never outlive the tab (it is not written to
 * the plugin config).
 *
 * Each `fresh()` imports the testkit under a new URL, which is a new bundle
 * instance with an empty in-memory map: exactly what a hot reload leaves
 * behind. The fake `sessionStorage` is the one thing both instances share.
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

/** The raw stored choices, for assertions on what the tab keeps. */
function stored() {
  const raw = globalThis.sessionStorage.getItem('dbGitPanel.commit-mode')
  return raw === null ? null : JSON.parse(raw).sessions
}

test('parsing treats anything malformed, of another version or unknown as nothing remembered', async () => {
  const { parseCommitModes, COMMIT_MODE_VERSION } = await fresh()
  assert.equal(parseCommitModes(null).size, 0)
  assert.equal(parseCommitModes('{not json').size, 0)
  assert.equal(parseCommitModes('[]').size, 0)
  assert.equal(parseCommitModes(JSON.stringify({ v: COMMIT_MODE_VERSION + 1, sessions: { s: 'commit-push' } })).size, 0)
  const modes = parseCommitModes(JSON.stringify({
    v: COMMIT_MODE_VERSION,
    sessions: {
      good: 'commit-push',
      plain: 'commit',
      other: 'push',
      nul: 'commit-push\0',
      ['k'.repeat(300)]: 'commit-push',
    },
  }))
  assert.deepEqual([...modes.keys()], ['good'], 'only the one non-default action survives')
  assert.equal(modes.get('good'), 'commit-push')
})

test('serializing keeps the most recently written sessions up to the cap', async () => {
  const { parseCommitModes, serializeCommitModes, COMMIT_MODE_MAX } = await fresh()
  const modes = new Map()
  for (let i = 0; i < COMMIT_MODE_MAX + 10; i++) modes.set(`s${i}`, 'commit-push')
  const kept = parseCommitModes(serializeCommitModes(modes))
  assert.equal(kept.size, COMMIT_MODE_MAX)
  assert.equal(kept.has('s0'), false, 'the oldest go first')
  assert.equal(kept.has(`s${COMMIT_MODE_MAX + 9}`), true)
})

test('a session starts on plain commit and writes nothing', async () => {
  const kit = await fresh()
  assert.equal(kit.commitModeFor('session-default'), 'commit')
  assert.equal(stored(), null, 'the default is the absence of an entry')
})

test('a chosen mode survives a module reload for that session only', async () => {
  const before = await fresh()
  before.rememberCommitMode('session-a', 'commit-push')
  assert.equal(stored()['session-a'], 'commit-push')
  const after = await fresh()
  assert.equal(after.commitModeFor('session-a'), 'commit-push', 'the tab remembers across a reload')
  assert.equal(after.commitModeFor('session-b'), 'commit', 'another conversation keeps its own choice')
})

test('choosing plain commit again drops the stored choice', async () => {
  const kit = await fresh()
  kit.rememberCommitMode('session-c', 'commit-push')
  kit.rememberCommitMode('session-c', 'commit')
  assert.equal(stored(), null, 'nothing is left in the tab')
  assert.equal((await fresh()).commitModeFor('session-c'), 'commit')
})

test('the choice is idempotent', async () => {
  const kit = await fresh()
  kit.rememberCommitMode('session-d', 'commit-push')
  kit.rememberCommitMode('session-d', 'commit-push')
  assert.deepEqual(stored(), { 'session-d': 'commit-push' })
  assert.equal((await fresh()).commitModeFor('session-d'), 'commit-push')
})

test('a rewrite moves the session to the newest slot, so a stale one is evicted first', async () => {
  const { COMMIT_MODE_MAX } = await fresh()
  const kit = await fresh()
  for (let i = 0; i < COMMIT_MODE_MAX; i++) kit.rememberCommitMode(`s${i}`, 'commit-push')
  kit.rememberCommitMode('s0', 'commit-push')
  kit.rememberCommitMode('extra', 'commit-push')
  assert.equal(stored().s0, 'commit-push', 'the rewritten session is the newest, not the oldest')
  assert.equal(stored().s1, undefined, 'the untouched oldest goes instead')
  assert.equal(Object.keys(stored()).length, COMMIT_MODE_MAX)
})

test('a store that throws degrades to memory', async () => {
  useStorage({
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('quota') },
    removeItem() { throw new Error('blocked') },
  })
  const kit = await fresh()
  kit.rememberCommitMode('blocked', 'commit-push')
  assert.equal(kit.commitModeFor('blocked'), 'commit-push', 'the click still holds for this module load')
  kit.rememberCommitMode('blocked', 'commit')
  assert.equal(kit.commitModeFor('blocked'), 'commit')
  assert.equal((await fresh()).commitModeFor('blocked'), 'commit', 'nothing was written for the next load')
})

test('a global whose very read throws degrades to memory', async () => {
  // Where storage is blocked outright, touching `sessionStorage` throws.
  Object.defineProperty(globalThis, 'sessionStorage', {
    get() { throw new Error('SecurityError') },
    configurable: true,
  })
  const kit = await fresh()
  kit.rememberCommitMode('denied', 'commit-push')
  assert.equal(kit.commitModeFor('denied'), 'commit-push')
})
