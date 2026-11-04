/**
 * op-runner: the busy/error envelope shared by the low-frequency write ops.
 * One guard (a second press while in flight is a no-op), one error line, one
 * busy release — for both the `remote.run` path (wire codes) and the
 * `onAction` path (already-localized messages), including the catch branch
 * that keeps a thrown write from becoming an unhandled rejection. A write with
 * no dialog to absorb the press also passes an in-flight ref: `busy` only
 * repaints one paint later, so two synchronous presses would both read false.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runRemoteAction, runSnapshotAction } from '../../lib/testkit.mjs'

function fixture() {
  const state = { busy: false, error: null }
  const env = {
    get busy() { return state.busy },
    setBusy: (b) => { state.busy = b },
    setError: (m) => { state.error = m },
  }
  return { state, env }
}

const ACTION = { kind: 'tag-delete', name: 'v1.0' }

test('runRemoteAction: success runs onOk and leaves the envelope idle', async () => {
  const { state, env } = fixture()
  let ok = 0
  const remote = { run: async () => ({ ok: true }) }
  await runRemoteAction(env, remote, 's', ACTION, () => { ok += 1 }, (code) => code, 'fallback')
  assert.equal(ok, 1)
  assert.equal(state.busy, false)
  assert.equal(state.error, null)
})

test('runRemoteAction: a wire failure becomes the described error line', async () => {
  const { state, env } = fixture()
  const remote = { run: async () => ({ ok: false, error: { code: 'conflict', message: 'm' } }) }
  await runRemoteAction(env, remote, 's', ACTION, () => assert.fail('no success path'), (code, msg) => `${code}:${msg}`, 'fallback')
  assert.equal(state.error, 'conflict:m')
  assert.equal(state.busy, false, 'the busy flag releases even on failure')
})

test('runRemoteAction: a thrown write is caught, never an unhandled rejection', async () => {
  const { state, env } = fixture()
  const remote = { run: async () => { throw new Error('rpc exploded') } }
  await runRemoteAction(env, remote, 's', ACTION, () => assert.fail('no success path'), () => 'described', 'fallback')
  assert.equal(state.error, 'rpc exploded')
  assert.equal(state.busy, false)
})

test('runRemoteAction: a busy envelope short-circuits the second press', async () => {
  const { state, env } = fixture()
  state.busy = true
  let calls = 0
  const remote = { run: async () => { calls += 1; return { ok: true } } }
  await runRemoteAction(env, remote, 's', ACTION, () => assert.fail('must not run'), () => 'd', 'fallback')
  assert.equal(calls, 0)
  assert.equal(state.busy, true, 'the in-flight guard is untouched')
})

test('runSnapshotAction: success, localized failure and catch all settle alike', async () => {
  const okCase = fixture()
  let ok = 0
  await runSnapshotAction(okCase.env, async () => ({ ok: true }), ACTION, () => { ok += 1 }, 'fallback')
  assert.equal(ok, 1)
  assert.equal(okCase.state.busy, false)

  const failCase = fixture()
  await runSnapshotAction(failCase.env, async () => ({ ok: false, error: '冲突' }), ACTION, () => assert.fail('no'), 'fallback')
  assert.equal(failCase.state.error, '冲突', 'onAction failures arrive already localized')
  assert.equal(failCase.state.busy, false)

  const throwCase = fixture()
  await runSnapshotAction(throwCase.env, async () => { throw new Error('boom') }, ACTION, () => assert.fail('no'), 'fallback')
  assert.equal(throwCase.state.error, 'boom')
  assert.equal(throwCase.state.busy, false)
})

/** The render-time env for a direct write: `busy` mirrors what the last paint
 * saw, and the ref is what closes the window before the next one. */
function refFixture({ busy = false } = {}) {
  const state = { busy, error: null, errorCalls: 0 }
  const inFlight = { current: false }
  const env = {
    get busy() { return state.busy },
    setBusy: (b) => { state.busy = b },
    setError: (m) => { state.error = m; state.errorCalls += 1 },
    inFlight,
  }
  return { state, env, inFlight }
}

test('a synchronous second press is dropped by the ref, before busy repaints', async () => {
  let calls = 0
  const run = async () => { calls += 1; return { ok: true } }
  const { env, inFlight } = refFixture()
  await Promise.all([
    runSnapshotAction(env, run, ACTION, () => {}, 'fallback'),
    runSnapshotAction(env, run, ACTION, () => {}, 'fallback'),
  ])
  assert.equal(calls, 1, 'the ref, not the stale busy flag, drops the second press')
  assert.equal(inFlight.current, false, 'the ref is released after the write')
})

test('the dropped press leaves the error slot to the running write', async () => {
  const { state, env } = refFixture()
  await Promise.all([
    runSnapshotAction(env, async () => ({ ok: true }), ACTION, () => {}, 'fallback'),
    runSnapshotAction(env, async () => ({ ok: true }), ACTION, () => {}, 'fallback'),
  ])
  assert.equal(state.errorCalls, 1, 'only the claimed op clears its own slot')
})

test('the ref releases on failure so the next press retries', async () => {
  const { env, inFlight } = refFixture()
  let attempts = 0
  const run = async () => { attempts += 1; return { ok: attempts > 1, error: 'refused' } }
  await runSnapshotAction(env, run, ACTION, () => {}, 'fallback')
  await runSnapshotAction(env, run, ACTION, () => {}, 'fallback')
  assert.equal(attempts, 2, 'a released ref never strands the retry')
  assert.equal(inFlight.current, false)
})

test('a painted busy still blocks a ref holder without claiming it', async () => {
  const { state, env, inFlight } = refFixture({ busy: true })
  await runSnapshotAction(env, async () => assert.fail('must not run'), ACTION, () => {}, 'fallback')
  assert.equal(state.busy, true, 'the in-flight guard is untouched')
  assert.equal(inFlight.current, false)
  assert.equal(state.errorCalls, 0)
})

test('runRemoteAction claims the same ref', async () => {
  const { env, inFlight } = refFixture()
  let runs = 0
  const remote = { run: async () => { runs += 1; return { ok: true } } }
  await Promise.all([
    runRemoteAction(env, remote, 's', ACTION, () => {}, () => 'd', 'fallback'),
    runRemoteAction(env, remote, 's', ACTION, () => {}, () => 'd', 'fallback'),
  ])
  assert.equal(runs, 1, 'the tag path shares the guard, not its own copy')
  assert.equal(inFlight.current, false)
})
