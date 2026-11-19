/**
 * The version-read pipeline behind the commit dialog's file view / copy: one
 * target at a time, in-flight joins, last-answer cache, and a generation that
 * drops replies the view has moved past. Pure module, no renderer.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createVersionReads, fileVersionKey, fileVersionQuery, fileVersionStateOf,
} from '../../lib/hookkit.mjs'

const READY = { kind: 'ready', content: 'body\n', size: 5 }

/** A load the test settles by hand. */
function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

test('a target read joins the in-flight request instead of asking twice', async () => {
  const reads = createVersionReads()
  const gate = deferred()
  let loads = 0
  const published = []
  const load = () => { loads++; return gate.promise }
  const a = reads.read('k', load, (s) => published.push(s))
  const b = reads.read('k', load, (s) => published.push(s))
  gate.resolve(READY)
  assert.deepEqual(await a, READY)
  assert.deepEqual(await b, READY)
  assert.equal(loads, 1, 'the second read reuses the first request')
  assert.deepEqual(published, [READY], 'one answer, one publish')
})

test('a settled answer is cached and re-published to the next caller', () => {
  const reads = createVersionReads()
  const noop = () => {}
  return reads.read('k', async () => READY, noop).then(() => {
    assert.deepEqual(reads.peek('k'), READY, 'the body is cached for the open target')
    let loads = 0
    const published = []
    return reads.read('k', () => { loads++; return Promise.resolve(READY) }, (s) => published.push(s)).then((state) => {
      assert.deepEqual(state, READY)
      assert.equal(loads, 0, 'a cache hit never reaches the host')
      assert.deepEqual(published, [], 'the cached value is already on screen')
    })
  })
})

test('invalidate drops a reply that belongs to the previous target', async () => {
  const reads = createVersionReads()
  const gate = deferred()
  const published = []
  const read = reads.read('old', () => gate.promise, (s) => published.push(s))
  reads.invalidate()
  gate.resolve(READY)
  assert.deepEqual(await read, READY, 'the promise still settles for its caller')
  assert.deepEqual(published, [], 'a reply for the previous target neither paints nor is cached')
  assert.equal(reads.peek('old'), null)
})

test('an error is not cached, so the next read retries', async () => {
  const reads = createVersionReads()
  let loads = 0
  const status = () => {
    loads++
    return Promise.resolve(loads === 1 ? { kind: 'error' } : READY)
  }
  assert.deepEqual(await reads.read('k', status, () => {}), { kind: 'error' })
  assert.equal(reads.peek('k'), null, 'a failed read leaves nothing to show')
  assert.deepEqual(await reads.read('k', status, () => {}), READY, 'the retry reads again')
  assert.equal(loads, 2)
})

test('the cache holds one target: moving to another key starts a fresh read', async () => {
  const reads = createVersionReads()
  await reads.read('a', async () => READY, () => {})
  await reads.read('b', async () => ({ kind: 'absent' }), () => {})
  assert.equal(reads.peek('a'), null, 'only the current target is kept')
  assert.deepEqual(reads.peek('b'), { kind: 'absent' })
})

test('the key and request name every input of the read', () => {
  const commit = { path: 'src/a.ts', base: 'commit', commit: 'abc123' }
  assert.equal(fileVersionKey(commit), 'commit\u0000abc123\u0000src/a.ts')
  assert.equal(fileVersionKey({ path: 'a.ts', base: 'worktree' }), 'worktree\u0000\u0000a.ts')
  assert.equal(fileVersionKey(null), null)
  assert.deepEqual(fileVersionQuery(commit), { kind: 'file-version', path: 'src/a.ts', base: 'commit', commit: 'abc123' })
  assert.deepEqual(fileVersionQuery({ path: 'a.ts', base: 'staged' }), { kind: 'file-version', path: 'a.ts', base: 'staged' })
})

test('a text reply without a body is an error, not an empty file', () => {
  assert.deepEqual(fileVersionStateOf({ kind: 'file-version', path: 'a.ts', variant: 'text', size: 9 }), { kind: 'error' })
  assert.deepEqual(
    fileVersionStateOf({ kind: 'file-version', path: 'a.ts', variant: 'text', content: 'x\n', size: 2 }),
    { kind: 'ready', content: 'x\n', size: 2 },
  )
  assert.deepEqual(
    fileVersionStateOf({ kind: 'file-version', path: 'big.bin', variant: 'tooLarge', size: 11 * 1024 * 1024 }),
    { kind: 'tooLarge', size: 11 * 1024 * 1024 },
  )
  assert.deepEqual(fileVersionStateOf({ kind: 'file-version', path: 'gone', variant: 'absent' }), { kind: 'absent' })
})
