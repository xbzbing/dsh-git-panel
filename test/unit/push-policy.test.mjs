/**
 * pushIntent / canPublish / canSetUpstream: which remote write the sync
 * controls may offer.
 *
 * The panel has exactly one upload control per surface, so these predicates are
 * the single gate for both the overview status bar and the changes toolbar. A
 * branch that only exists locally must offer a publish (creating a same-named
 * remote branch cannot overwrite anything — issue #63). When the primary remote
 * already carries a same-named branch at HEAD, publishing would push nothing,
 * so the control attaches the tracking config instead. A detached HEAD, an
 * unborn repository and a repo with no remote must all stay unavailable.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canPush, canSetUpstream, canPublish, pushIntent, upstreamCandidates } from '../../lib/testkit.mjs'

const REMOTE = { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' }

/** A snapshot with every precondition satisfied; each test varies one field. */
function snap(overrides = {}) {
  return {
    branch: 'feature/x', head: 'abc1234', unborn: false,
    hasUpstream: false, remoteBranchAtHead: false,
    ahead: 0, behind: 0, remote: REMOTE,
    ...overrides,
  }
}

test('a local-only branch with commits and a remote can be published', () => {
  assert.equal(canPublish(snap()), true)
  assert.equal(canSetUpstream(snap()), false)
  assert.equal(pushIntent(snap()), 'publish')
})

test('a same-named remote branch at HEAD attaches the upstream instead of publishing', () => {
  const atHead = snap({ remoteBranchAtHead: true })
  assert.equal(canSetUpstream(atHead), true)
  assert.equal(canPublish(atHead), false, 'publishing would push nothing')
  assert.equal(pushIntent(atHead), 'set-upstream')
})

test('every candidate remote is exposed, even when the primary remote is not one', () => {
  const icode = { ...REMOTE, name: 'icode', host: 'icode.baidu.com', hostKind: 'other' }
  // The new host list is authoritative: origin is absent, icode is the only
  // same-named branch at HEAD, and the legacy boolean (primary = origin) stays
  // false. The chooser still offers icode.
  const onlyIcode = snap({ remoteBranchAtHead: false, remoteCandidates: [icode] })
  assert.deepEqual(upstreamCandidates(onlyIcode).map((r) => r.name), ['icode'])
  assert.equal(canSetUpstream(onlyIcode), true)
  assert.equal(canPublish(onlyIcode), false)
  assert.equal(pushIntent(onlyIcode), 'set-upstream')

  const both = snap({ remoteCandidates: [icode, REMOTE] })
  assert.deepEqual(upstreamCandidates(both).map((r) => r.name), ['icode', 'origin'])
  assert.equal(pushIntent(both), 'set-upstream')
})

test('an older host without the candidate list falls back to the primary remote', () => {
  const legacy = snap({ remoteBranchAtHead: true })
  assert.deepEqual(upstreamCandidates(legacy).map((r) => r.name), ['origin'])
  // An explicit empty list is authoritative and disables the action.
  assert.deepEqual(upstreamCandidates(snap({ remoteBranchAtHead: true, remoteCandidates: [] })), [])
  assert.equal(canSetUpstream(snap({ remoteBranchAtHead: true, remoteCandidates: [] })), false)
})

test('set-upstream still needs a branch, a commit and a remote', () => {
  const cases = [
    ['detached HEAD', { branch: null }],
    ['unborn', { unborn: true, head: null }],
    ['no usable HEAD', { head: '' }],
    ['no remote', { remote: null }],
  ]
  for (const [state, patch] of cases) {
    const snapshot = snap({ remoteBranchAtHead: true, ...patch })
    assert.equal(canSetUpstream(snapshot), false, `${state}: no set-upstream`)
    assert.equal(pushIntent(snapshot), null, `${state}: no intent`)
  }
})

test('publish is offered even when the local-only branch has no commits ahead of anything', () => {
  // ahead/behind are meaningless without an upstream; only the remote write
  // matters, so any count still publishes.
  for (const counts of [{ ahead: 0, behind: 0 }, { ahead: 5, behind: 0 }, { ahead: 0, behind: 3 }]) {
    assert.equal(pushIntent(snap(counts)), 'publish', `ahead/behind ${JSON.stringify(counts)} still publishes`)
  }
})

test('a detached HEAD has no branch to publish', () => {
  assert.equal(canPublish(snap({ branch: null })), false)
  assert.equal(pushIntent(snap({ branch: null })), null)
})

test('an unborn repository has nothing to publish', () => {
  // git cannot push a branch whose commit does not exist yet: `push -u origin
  // HEAD` fails with "src refspec HEAD does not match any".
  assert.equal(canPublish(snap({ unborn: true, head: null })), false)
  assert.equal(pushIntent(snap({ unborn: true, head: null })), null)
  // A snapshot without a usable HEAD is treated the same way.
  assert.equal(canPublish(snap({ head: '' })), false)
  assert.equal(canPublish(snap({ head: null })), false)
})

test('a repository with no remote has nowhere to publish to', () => {
  assert.equal(canPublish(snap({ remote: null })), false)
  assert.equal(pushIntent(snap({ remote: null })), null)
})

test('an existing upstream is never attached or published, only pushed when strictly ahead', () => {
  const upstream = { hasUpstream: true }
  assert.equal(pushIntent(snap({ ...upstream, remoteBranchAtHead: true, ahead: 3, behind: 0 })), 'push', 'the flag is ignored once an upstream exists')
  assert.equal(canSetUpstream(snap({ ...upstream, remoteBranchAtHead: true })), false)
  assert.equal(canPublish(snap({ ...upstream, ahead: 3, behind: 0 })), false, 'a branch with an upstream is never published')
  // Nothing to send: neither intent applies.
  assert.equal(pushIntent(snap({ ...upstream, ahead: 0, behind: 0 })), null)
  // Diverged: deliberately offered neither (the user must reconcile first).
  assert.equal(pushIntent(snap({ ...upstream, ahead: 2, behind: 3 })), null)
  // Strictly behind: pull territory, never an upload.
  assert.equal(pushIntent(snap({ ...upstream, ahead: 0, behind: 4 })), null)
})

test('push, set-upstream and publish can never overlap', () => {
  const cases = [
    snap(), snap({ remoteBranchAtHead: true }), snap({ branch: null }), snap({ unborn: true }),
    snap({ remote: null }), snap({ hasUpstream: true, ahead: 5, behind: 0 }),
    snap({ hasUpstream: true, ahead: 0, behind: 0 }),
  ]
  for (const snapshot of cases) {
    const flags = [canPush(snapshot), canSetUpstream(snapshot), canPublish(snapshot)]
    assert.ok(flags.filter(Boolean).length <= 1, `more than one intent on ${JSON.stringify(snapshot)}`)
  }
})
