/**
 * Change-list selection keys: the single codec for `path:s` (index side) /
 * `path:w` (working tree), plus the batch-discard split and batch-stage targets
 * defined on it.
 *
 * The evidence has two independent halves, because an embedded copy of the old
 * spelling can only ever lock the corpus it is handed:
 *
 *   1. Legacy agreement — the codec is checked against the two inline spellings
 *      it replaced, over a large deterministic corpus (not a hand-picked list),
 *      so a mutation that keeps the old spelling but changes behaviour on some
 *      key shape is caught.
 *   2. Structural invariants — properties the codec must satisfy regardless of
 *      how it is implemented. `sideOf(key) === null ⟺ pathOfKey(key) === key`
 *      is the drift detector for the side alphabet itself: adding a side to one
 *      function without the other fails here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeKey, sideOf, pathOfKey, commitTargets, pickDiscardTargets, pickStageTargets, groupPickState, toggleGroupKeys } from '../../lib/testkit.mjs'

// The two spellings that used to live at the call sites, kept verbatim so the
// refactor stays pinned to the behaviour it replaced. They are a lock on the
// historical contract, not a specification: the invariants below carry the
// evidence that does not depend on them.
const LEGACY_STRIP = (k) => k.replace(/:[sw]$/, '')
const LEGACY_SIDE = (k) => (k.endsWith(':w') ? 'w' : k.endsWith(':s') ? 's' : null)

// Awkward shapes where a path itself ends in, or contains, a side-looking
// segment — the cases where "strip the last two characters" and "strip a side
// suffix" could diverge.
const BOUNDARY_KEYS = [
  'a.txt:w', 'a.txt:s', 'dup.txt:s', 'dup.txt:w', 'newdir:w',
  'x:w:w', 'x:s:w', 'a::w', 'dir/w:q:w', 'nested/x:s:w',
  'a:b.txt:w', 'a:b.txt:s', 'dir with space/f.txt:w', 'f.txt:s',
  'bare.txt', 'odd:x', 's', 'w', ':w', ':s', 'a.txt:q', 'a.txt:w:w',
  '', ':', '::s', 'a.txt:', 'a.txt:S', 'a.txt:W',
  // `.git` is barred from the file browser, so its keys must survive the codec
  // like any other path — never special-cased into a strip or a side.
  '.git/config:w', '.git/w:s', 'a/.git/HEAD:w', '.git:s', '.git:w',
]

// Longer than any hand-written case: a mutation that strips conditionally on
// length would survive a short-only corpus.
const LONG_KEYS = [
  `${'a'.repeat(25)}:w`, `${'a'.repeat(25)}:s`, `${'a'.repeat(200)}:s`,
  `${'deeply/'.repeat(30)}file.txt:w`, `${'x'.repeat(64)}:s:w`, `${'b'.repeat(39)}:q`,
]

/** Deterministic PRNG (mulberry32) so the corpus is large and identical on every run. */
function makeRandom(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALPHABET = [...'abzs wq.-/', ':', '中', '🙂', '\t', '\n', '\u0000', 'S', 'W', 'u']
const LOOKALIKE_SIDES = [':q', ':u', ':x', ':S', ':W', ':0']
const pick = (random, list) => list[Math.floor(random() * list.length) % list.length]

/** A key of an arbitrary shape: random body, then a real side, a lookalike, or nothing. */
function randomKey(random) {
  let body = ''
  const len = Math.floor(random() * 40)
  for (let i = 0; i < len; i++) body += pick(random, ALPHABET)
  const roll = random()
  if (roll < 0.5) return body + pick(random, [':s', ':w'])
  if (roll < 0.65) return body + pick(random, LOOKALIKE_SIDES)
  return body
}

const CORPUS_SEED = 20261017
const CORPUS_SIZE = 25000
const CORPUS = (() => {
  const out = [...BOUNDARY_KEYS, ...LONG_KEYS]
  const random = makeRandom(CORPUS_SEED)
  for (let i = 0; i < CORPUS_SIZE; i++) out.push(randomKey(random))
  return out
})()

// Every single-character suffix the format could plausibly grow, probed on
// several bodies: a side recognised by `sideOf` but not dropped by `pathOfKey`
// (or the reverse) fails the agreement test below.
const PROBE_BODIES = ['', 'a.txt', 'dir/b', 'x:s', 'a:b.txt', 'w'.repeat(30)]
const PROBE_SUFFIXES = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', '']

test('changeKey builds the legacy path+side spelling', () => {
  const changes = [
    { path: 'a.txt', staged: true }, { path: 'a.txt', staged: false },
    { path: 'dir/b.txt', staged: true }, { path: 'x:w', staged: false },
    { path: '', staged: true }, { path: '', staged: false },
    { path: `${'long/'.repeat(20)}f.txt`, staged: true },
  ]
  for (const c of changes) {
    assert.equal(changeKey(c), c.path + (c.staged ? ':s' : ':w'))
  }
})

test('pathOfKey is equivalent to the legacy strip across the corpus', () => {
  for (const k of CORPUS) assert.equal(pathOfKey(k), LEGACY_STRIP(k), `pathOfKey(${JSON.stringify(k)})`)
})

test('sideOf is equivalent to the legacy endsWith probe across the corpus', () => {
  for (const k of CORPUS) assert.equal(sideOf(k), LEGACY_SIDE(k), `sideOf(${JSON.stringify(k)})`)
})

test('sideOf and pathOfKey agree about which keys carry a side', () => {
  const keys = [...CORPUS]
  for (const body of PROBE_BODIES) {
    for (const suffix of PROBE_SUFFIXES) keys.push(suffix === '' ? body : `${body}:${suffix}`)
  }
  for (const key of keys) {
    if (sideOf(key) === null) {
      assert.equal(pathOfKey(key), key, `no side detected, so ${JSON.stringify(key)} must be left alone`)
    } else {
      assert.equal(pathOfKey(key), key.slice(0, -2), `a side was detected, so two characters must be dropped from ${JSON.stringify(key)}`)
    }
  }
})

test('a key that carries a side loses exactly the two suffix characters', () => {
  for (const key of CORPUS) {
    if (sideOf(key) === null) continue
    assert.equal(pathOfKey(key).length, key.length - 2, `length of ${JSON.stringify(key)}`)
  }
})

test('pathOfKey strips the side suffix on long keys too', () => {
  for (const n of [1, 22, 23, 24, 25, 40, 200, 4096]) {
    const long = 'a'.repeat(n)
    assert.equal(pathOfKey(`${long}:w`), long)
    assert.equal(pathOfKey(`${long}:s`), long)
    assert.equal(sideOf(`${long}:w`), 'w')
    assert.equal(sideOf(`${long}:s`), 's')
  }
})

test('changeKey round-trips through pathOfKey and sideOf on generated paths', () => {
  const random = makeRandom(0x5eed)
  const paths = ['a.txt', 'dir/w:q', 'nested/x:s', 'a:b.txt', 'x:w', '', '中/文🙂.txt', 'tab\tname', 'line\nname', 'slash/']
  for (let i = 0; i < 2000; i++) paths.push(randomKey(random).replace(/:[sw]$/, ''))
  for (const path of paths) {
    for (const staged of [true, false]) {
      const key = changeKey({ path, staged })
      assert.equal(pathOfKey(key), path, `round-trip of ${JSON.stringify(path)} (staged=${staged})`)
      assert.equal(sideOf(key), staged ? 's' : 'w', `side of ${JSON.stringify(path)} (staged=${staged})`)
    }
  }
})

test('every key changeKey produces carries a readable side', () => {
  const random = makeRandom(0xc0dec)
  for (let i = 0; i < 2000; i++) {
    const path = randomKey(random).replace(/:[sw]$/, '')
    const side = sideOf(changeKey({ path, staged: i % 2 === 0 }))
    assert.ok(side === 's' || side === 'w', `changeKey(${JSON.stringify(path)}) must be readable back`)
  }
})

test('pathOfKey only strips the trailing side suffix', () => {
  assert.equal(pathOfKey('x:w:w'), 'x:w')
  assert.equal(pathOfKey('a::w'), 'a:')
  assert.equal(pathOfKey('dir/w:q:w'), 'dir/w:q')
  assert.equal(pathOfKey('nested/x:s:w'), 'nested/x:s')
  assert.equal(pathOfKey('a.txt'), 'a.txt')
  assert.equal(pathOfKey(''), '')
})

test('pickDiscardTargets matches the legacy split on generated selections', () => {
  const random = makeRandom(0xbadc0de)
  for (let round = 0; round < 40; round++) {
    const keys = []
    const n = Math.floor(random() * 80)
    for (let i = 0; i < n; i++) keys.push(randomKey(random))
    const worktree = new Set()
    const staged = new Set()
    for (const key of keys) {
      const side = LEGACY_SIDE(key)
      if (side === null) continue
      if (side === 'w') worktree.add(LEGACY_STRIP(key)); else staged.add(LEGACY_STRIP(key))
    }
    const actual = pickDiscardTargets(keys)
    assert.deepEqual(actual, {
      paths: [...worktree].sort(),
      stagedOnly: [...staged].filter((p) => !worktree.has(p)).sort(),
    })
    assert.deepEqual(actual.paths, [...actual.paths].sort(), 'paths must stay sorted')
    assert.deepEqual(actual.stagedOnly, [...actual.stagedOnly].sort(), 'stagedOnly must stay sorted')
    for (const path of actual.paths) assert.ok(!actual.stagedOnly.includes(path), `${JSON.stringify(path)} cannot be on both sides`)
  }
})

test('pickDiscardTargets keeps working-tree paths, sorted', () => {
  assert.deepEqual(pickDiscardTargets(['b.txt:w', 'a.txt:w']), { paths: ['a.txt', 'b.txt'], stagedOnly: [] })
})

test('pickDiscardTargets dedupes a path picked on both sides', () => {
  assert.deepEqual(pickDiscardTargets(['a.txt:w', 'a.txt:s']), { paths: ['a.txt'], stagedOnly: [] })
})

test('pickDiscardTargets reports staged-only picks apart from the discard set', () => {
  assert.deepEqual(
    pickDiscardTargets(['c.txt:s', 'b.txt:w', 'a.txt:s']),
    { paths: ['b.txt'], stagedOnly: ['a.txt', 'c.txt'] },
  )
})

test('pickDiscardTargets is empty for an empty selection', () => {
  assert.deepEqual(pickDiscardTargets([]), { paths: [], stagedOnly: [] })
})

test('pickDiscardTargets ignores keys with no known side', () => {
  assert.deepEqual(pickDiscardTargets(['bare.txt', 'odd:x']), { paths: [], stagedOnly: [] })
})

test('pickDiscardTargets only strips the trailing side suffix', () => {
  assert.deepEqual(pickDiscardTargets(['a:b.txt:w']), { paths: ['a:b.txt'], stagedOnly: [] })
})

// Batch stage (issue #82): the checked rows' working-tree paths, deduped and
// sorted. An index-side pick is already staged, so it never adds a path.
test('pickStageTargets keeps working-tree paths, sorted', () => {
  assert.deepEqual(pickStageTargets(['b.txt:w', 'a.txt:w']), ['a.txt', 'b.txt'])
})

test('pickStageTargets ignores index-side picks, but keeps a worktree pick of the same path', () => {
  assert.deepEqual(pickStageTargets(['a.txt:s', 'b.txt:s']), [])
  assert.deepEqual(pickStageTargets(['a.txt:w', 'a.txt:s']), ['a.txt'])
})

test('pickStageTargets is empty for an empty selection and ignores keys with no known side', () => {
  assert.deepEqual(pickStageTargets([]), [])
  assert.deepEqual(pickStageTargets(['bare.txt', 'odd:x']), [])
})

test('pickStageTargets only strips the trailing side suffix', () => {
  assert.deepEqual(pickStageTargets(['a:b.txt:w', ':w']), ['', 'a:b.txt'])
})

// Group select-all (issue #60): the head checkbox's tri-state and its toggle.
// A group is a list of rows (path+staged pairs); the same path on both sides
// is two independent rows, exactly like the change list renders it.
const G_MIXED = [
  { path: 'a.txt', staged: true }, { path: 'a.txt', staged: false },
  { path: 'b.txt', staged: false }, { path: 'c.txt', staged: false },
]
const keysOf = (changes) => changes.map(changeKey)

test('groupPickState is none for an empty group or an empty selection', () => {
  assert.equal(groupPickState(new Set(), []), 'none')
  assert.equal(groupPickState(new Set(['a.txt:w']), []), 'none')
  assert.equal(groupPickState(new Set(), G_MIXED), 'none')
})

test('groupPickState is all only when every row of the group is picked', () => {
  const all = new Set(keysOf(G_MIXED))
  assert.equal(groupPickState(all, G_MIXED), 'all')
  // A pick of the same path on the other side is not this group's row.
  assert.equal(groupPickState(new Set(['a.txt:w', 'b.txt:w', 'c.txt:w']), [{ path: 'a.txt', staged: true }, { path: 'b.txt', staged: true }]), 'none')
})

test('groupPickState is partial when some but not all rows are picked', () => {
  assert.equal(groupPickState(new Set(['a.txt:s']), G_MIXED), 'partial')
  assert.equal(groupPickState(new Set(['a.txt:s', 'a.txt:w', 'b.txt:w']), G_MIXED), 'partial')
})

test('toggleGroupKeys picks every row of the group when not all are picked', () => {
  const next = toggleGroupKeys(new Set(['z.txt:w']), G_MIXED)
  assert.deepEqual([...next].sort(), ['a.txt:s', 'a.txt:w', 'b.txt:w', 'c.txt:w', 'z.txt:w'].sort())
})

test('toggleGroupKeys clears just the group when every row is already picked', () => {
  const picked = new Set([...keysOf(G_MIXED), 'z.txt:w'])
  const next = toggleGroupKeys(picked, G_MIXED)
  assert.deepEqual([...next], ['z.txt:w'], 'picks outside the group survive the toggle')
})

test('toggleGroupKeys round-trips all→none on the group alone', () => {
  const once = toggleGroupKeys(new Set(), G_MIXED)
  assert.equal(groupPickState(once, G_MIXED), 'all')
  const twice = toggleGroupKeys(once, G_MIXED)
  assert.equal(twice.size, 0)
})

test('toggleGroupKeys is empty-safe', () => {
  const next = toggleGroupKeys(new Set(['z.txt:w']), [])
  assert.deepEqual([...next], ['z.txt:w'], 'an empty group changes nothing')
})

test('commitTargets keeps a working-tree pick and hands it to the host', () => {
  const targets = commitTargets(['a.txt:w', 'b.txt:w'])
  assert.deepEqual(targets.paths, ['a.txt', 'b.txt'])
  assert.deepEqual(targets.indexOnly, [], 'staging the file again is what a working-tree pick asks for')
})

test('commitTargets commits an index-only pick without re-staging it', () => {
  const targets = commitTargets(['a.txt:s'])
  assert.deepEqual(targets.paths, ['a.txt'])
  assert.deepEqual(targets.indexOnly, ['a.txt'], 'a partial git add -p must survive the commit')
})

test('commitTargets treats a path picked on both sides as a working-tree pick', () => {
  const targets = commitTargets(['a.txt:s', 'a.txt:w'])
  assert.deepEqual(targets.paths, ['a.txt'], 'one path, not two')
  assert.deepEqual(targets.indexOnly, [], 'both sides means the whole file')
})

test('commitTargets is undefined for an empty selection (commit everything staged)', () => {
  assert.equal(commitTargets([]).paths, undefined)
  assert.deepEqual(commitTargets([]).indexOnly, [])
  assert.deepEqual(commitTargets(['junk', 'a.txt:w']).paths, ['a.txt'], 'keys without a known side are ignored')
})
