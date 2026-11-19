/**
 * runSyncChain: the two-step diverged sync (ADR-0036). The merge half must
 * land before the push, and a missing/second-guessed snapshot must never send
 * a push onto a checkout the user did not confirm.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSyncChain } from '../../lib/testkit.mjs'

const OK = (snapshot) => ({ ok: true, ...(snapshot === undefined ? {} : { snapshot }) })
const AHEAD = { hasUpstream: true, branch: 'main', ahead: 1, behind: 0, capabilities: { syncMerge: true } }

test('sync merges first, then pushes the strictly-ahead result', async () => {
  const calls = []
  const reply = await runSyncChain(async (action) => {
    calls.push(action)
    if (action.kind === 'pull-merge') return OK({ ...AHEAD, ahead: 3 })
    return OK({ ...AHEAD, ahead: 0 })
  }, 'fallback')
  assert.deepEqual(calls.map((a) => a.kind), ['pull-merge', 'push'])
  assert.equal(reply.ok, true)
  assert.equal(reply.snapshot.ahead, 0, 'the push reply wins: it carries the published counts')
})

test('a merge failure never reaches push', async () => {
  const calls = []
  const reply = await runSyncChain(async (action) => {
    calls.push(action)
    return { ok: false, error: 'merge failed' }
  }, 'fallback')
  assert.deepEqual(calls.map((a) => a.kind), ['pull-merge'])
  assert.equal(reply.ok, false)
  assert.equal(reply.error, 'merge failed')
  assert.equal(reply.phase, 'merge', 'a merge failure belongs to the dialog')
})

test('a repo switch (no snapshot) stops after the merge', async () => {
  const calls = []
  const reply = await runSyncChain(async (action) => {
    calls.push(action)
    return OK()
  }, 'fallback')
  assert.deepEqual(calls.map((a) => a.kind), ['pull-merge'])
  assert.equal(reply.ok, true, 'the merge itself succeeded; there is just no checkout to push to')
})

test('a post-merge branch that is not strictly ahead is not pushed', async () => {
  const calls = []
  await runSyncChain(async (action) => {
    calls.push(action)
    return OK({ ...AHEAD, ahead: 0, behind: 0 })
  }, 'fallback')
  assert.deepEqual(calls.map((a) => a.kind), ['pull-merge'])
})

test('a push failure keeps the post-merge snapshot for the caller', async () => {
  const postMerge = { ...AHEAD, ahead: 3 }
  const reply = await runSyncChain(async (action) => {
    if (action.kind === 'pull-merge') return OK(postMerge)
    return { ok: false, error: 'rejected' }
  }, 'fallback')
  assert.equal(reply.ok, false)
  assert.equal(reply.error, 'rejected')
  assert.equal(reply.phase, 'push', 'a push failure cannot be retried from the dialog')
  assert.deepEqual(reply.snapshot, postMerge, 'the bar must show the merged counts, not the pre-merge ones')
})
