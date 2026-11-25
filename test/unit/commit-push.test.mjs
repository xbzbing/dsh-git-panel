/**
 * `runCommitPush` / `pushSkipReason`: the split commit button's chain (issue
 * #152). The evidence here is about what must NOT happen:
 *
 *   - a failed commit must never be followed by a push (the naive `git commit &&
 *     git push` chain pushes whatever was already ahead);
 *   - a push must never leave the snapshot the commit returned (a repository
 *     switch drops it on purpose);
 *   - an amend of an already-pushed tip must skip with its own reason, while an
 *     amend of an unpushed tip must push normally — the post-amend snapshot
 *     alone reads as "diverged" and cannot tell them apart;
 *   - every other reason and its behind count must come from the snapshot the
 *     commit returned: the commit itself clears `unborn`, so the pre-commit
 *     state can describe a branch that no longer exists.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCommitPush, pushSkipReason } from '../../lib/testkit.mjs'

const COMMIT = { kind: 'commit', message: 'feat: x' }
const REMOTE = { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' }

/** A snapshot with every push precondition satisfied; each test varies one field. */
function snap(overrides = {}) {
  return {
    root: '/repo', branch: 'main', head: 'abc1234', unborn: false,
    hasUpstream: true, ahead: 0, behind: 0, remote: REMOTE,
    ...overrides,
  }
}

const OK = (snapshot) => ({ ok: true, ...(snapshot === undefined ? {} : { snapshot }) })
const record = () => {
  const calls = []
  return { calls, onAction: async (action) => { calls.push(action.kind); return OK(snap({ ahead: 1 })) } }
}

test('pushSkipReason allows a branch that is level with its upstream', () => {
  assert.equal(pushSkipReason(snap(), false), null, 'the commit itself makes it ahead; being level now is fine')
  assert.equal(pushSkipReason(snap({ ahead: 3 }), false), null)
})

test('pushSkipReason refuses every state the ordinary push cannot fast-forward', () => {
  assert.equal(pushSkipReason(snap({ branch: null }), false), 'detached')
  assert.equal(pushSkipReason(snap({ unborn: true }), false), 'unborn')
  assert.equal(pushSkipReason(snap({ hasUpstream: false }), false), 'no-upstream')
  assert.equal(pushSkipReason(snap({ remote: null }), false), 'no-upstream')
  assert.equal(pushSkipReason(snap({ behind: 2 }), false), 'behind')
})

test('pushSkipReason separates an amend of a pushed tip from an unpushed one', () => {
  assert.equal(pushSkipReason(snap({ ahead: 0 }), true), 'amend', 'rewriting published history needs a force push')
  assert.equal(pushSkipReason(snap({ ahead: 1 }), true), null, 'the amended tip was never pushed')
})

test('a pushable commit runs both halves, in order', async () => {
  const { calls, onAction } = record()
  const phases = []
  const result = await runCommitPush(onAction, COMMIT, snap(), { amend: false, onPhase: (p) => phases.push(p) }, 'fallback')
  assert.deepEqual(calls, ['commit', 'push'])
  assert.deepEqual(phases, ['commit', 'push'], 'the button names the half that is running')
  assert.equal(result.committed, true)
  assert.equal(result.pushed, true)
  assert.deepEqual(result.snapshot, snap({ ahead: 1 }), 'the push reply wins')
})

test('a failed commit never reaches push', async () => {
  const calls = []
  const result = await runCommitPush(async (action) => {
    calls.push(action.kind)
    return { ok: false, error: 'nothing to commit' }
  }, COMMIT, snap(), { amend: false }, 'fallback')
  assert.deepEqual(calls, ['commit'])
  assert.equal(result.committed, false)
  assert.equal(result.pushed, false)
  assert.equal(result.error, 'nothing to commit')
  assert.equal(result.phase, 'commit')
})

test('a repository switch (no snapshot) stops after the commit', async () => {
  const calls = []
  const result = await runCommitPush(async (action) => { calls.push(action.kind); return OK() }, COMMIT, snap(), { amend: false }, 'fallback')
  assert.deepEqual(calls, ['commit'])
  assert.equal(result.committed, true)
  assert.equal(result.pushed, false)
  assert.equal(result.skip, 'switched')
})

test('the post-commit snapshot names the reason, so a reason the commit cleared is not kept', async () => {
  // `after` is what the chain reads; `before` only answers the amend question.
  // The last row is the one that used to lie: an empty repository is `unborn`
  // before the click and `no-upstream` after the commit it just made, so
  // "the branch has no commits yet" would contradict the commit on screen.
  const cases = [
    ['behind', snap({ behind: 2 }), snap({ behind: 3 }), 'behind', 3],
    ['no upstream', snap({ hasUpstream: false }), snap({ hasUpstream: false }), 'no-upstream', 0],
    ['detached', snap({ branch: null }), snap({ branch: null }), 'detached', 0],
    ['unborn → born', snap({ unborn: true }), snap({ unborn: false, hasUpstream: false }), 'no-upstream', 0],
  ]
  for (const [label, before, after, expected, behind] of cases) {
    const calls = []
    const result = await runCommitPush(async (action) => {
      calls.push(action.kind)
      return OK(after)
    }, COMMIT, before, { amend: false }, 'fallback')
    assert.deepEqual(calls, ['commit'], `${label}: no push`)
    assert.equal(result.committed, true, `${label}: the commit still lands`)
    assert.equal(result.skip, expected, label)
    assert.equal(result.behind, behind, `${label}: the count matches the snapshot that named the reason`)
  }
})

test('amend of a published tip skips with the amend reason, not a generic one', async () => {
  const calls = []
  const result = await runCommitPush(async (action) => {
    calls.push(action.kind)
    // After the amend the branch reads as diverged; that is not the reason.
    return OK(snap({ ahead: 1, behind: 1 }))
  }, { ...COMMIT, amend: true }, snap({ ahead: 0 }), { amend: true }, 'fallback')
  assert.deepEqual(calls, ['commit'])
  assert.equal(result.skip, 'amend')
})

test('amend of an unpushed tip pushes normally', async () => {
  const calls = []
  const result = await runCommitPush(async (action) => {
    calls.push(action.kind)
    return OK(snap({ ahead: 1 }))
  }, { ...COMMIT, amend: true }, snap({ ahead: 2 }), { amend: true }, 'fallback')
  assert.deepEqual(calls, ['commit', 'push'])
  assert.equal(result.pushed, true)
})

test('a push rejected after the commit keeps the commit and reports the push phase', async () => {
  const postCommit = snap({ ahead: 1 })
  const result = await runCommitPush(async (action) => {
    if (action.kind === 'commit') return OK(postCommit)
    return { ok: false, error: '推送被拒绝' }
  }, COMMIT, snap(), { amend: false }, 'fallback')
  assert.equal(result.committed, true)
  assert.equal(result.pushed, false)
  assert.equal(result.error, '推送被拒绝')
  assert.equal(result.phase, 'push')
  assert.deepEqual(result.snapshot, postCommit, 'the caller shows the post-commit counts')
})

test('a blocker that only appears after the commit is caught by the fresh snapshot', async () => {
  const calls = []
  const result = await runCommitPush(async (action) => {
    calls.push(action.kind)
    return OK(snap({ ahead: 1, behind: 1 }))
  }, COMMIT, snap(), { amend: false }, 'fallback')
  assert.deepEqual(calls, ['commit'], 'the pre-commit state was clean; the reply is not')
  assert.equal(result.skip, 'behind')
  assert.equal(result.behind, 1, 'the number comes from the fresh snapshot')
})
