/**
 * op-runner: the busy/error envelope shared by the low-frequency write ops.
 * One guard (a second press while in flight is a no-op), one error line, one
 * busy release — for both the `remote.run` path (wire codes) and the
 * `onAction` path (already-localized messages), including the catch branch
 * that keeps a thrown write from becoming an unhandled rejection.
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
