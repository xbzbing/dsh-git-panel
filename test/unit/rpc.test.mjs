/**
 * Client RPC facade tests (T2): the two-envelope contract in gitPanelRemoteOf.
 * A missing connection, a thrown rpc.call, a malformed result, an outer
 * transport failure, and an inner business failure must each degrade to a
 * typed `{ ok:false, error }` — never a throw or an undefined leak.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gitPanelRemoteOf } from '../../lib/testkit.mjs'

function ctxWith(call) {
  return {
    get: (k) => (k === 'connection' ? { rpc: call === null ? undefined : { call } } : undefined),
    effect() {}, on() {}, inject() {},
    slots: { inject() {}, register() {} },
    locale: { register() {}, bind: () => (s) => s },
  }
}

test('missing connection → typed git-unavailable failure', async () => {
  const remote = gitPanelRemoteOf(ctxWith(null))
  const res = await remote.snapshot({ sessionId: 's' })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'git-unavailable')
})

test('rpc.call throwing → typed failure, not a throw', async () => {
  const remote = gitPanelRemoteOf(ctxWith(async () => { throw new Error('boom') }))
  const res = await remote.snapshot({ sessionId: 's' })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'git-unavailable')
  assert.match(res.error.message ?? '', /boom/)
})

test('malformed transport result → typed failure', async () => {
  const remote = gitPanelRemoteOf(ctxWith(async () => 42))
  const res = await remote.snapshot({ sessionId: 's' })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'git-unavailable')
})

test('outer transport failure envelope surfaces its code', async () => {
  const remote = gitPanelRemoteOf(ctxWith(async () => ({ ok: false, error: { code: 'timeout' } })))
  const res = await remote.snapshot({ sessionId: 's' })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'timeout')
})

test('transport-ok with no inner value → typed failure (no undefined leak)', async () => {
  const remote = gitPanelRemoteOf(ctxWith(async () => ({ ok: true })))
  const res = await remote.snapshot({ sessionId: 's' })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'git-unavailable')
})

test('two-envelope success unwraps the inner business value', async () => {
  const snap = { root: '/r', dirty: false, kind: 'snap' }
  const remote = gitPanelRemoteOf(ctxWith(async (_ch, ep) => {
    assert.equal(ep, 'gitPanel/snapshot')
    return { ok: true, value: { ok: true, value: snap } }
  }))
  const res = await remote.snapshot({ sessionId: 's' })
  // The inner business result (itself an { ok, value } snapshot result) is
  // returned verbatim; the transport layer is peeled once.
  assert.equal(res.ok, true)
  assert.deepEqual(res.value, snap)
})

test('inner business failure is returned as-is', async () => {
  const remote = gitPanelRemoteOf(ctxWith(async () => ({ ok: true, value: { ok: false, error: { code: 'invalid-name' } } })))
  const res = await remote.query({ sessionId: 's', query: { kind: 'history', limit: 10, skip: 0 } })
  assert.equal(res.ok, false)
  assert.equal(res.error.code, 'invalid-name')
})
