/**
 * Repository selection: the per-session map and the request-tagging face.
 *
 * The switcher's correctness rests on two properties that are cheap to pin and
 * expensive to lose: a session's pick never leaks into another session, and the
 * wrapper only ever adds `repo` to the requests that the host resolves per
 * repository. A version lookup must stay host-scoped — tagging it would make an
 * older host reject the call for an unknown field.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { subscribeRepoSelection, selectedRepo, selectRepo, hasRepoPick, clearRepoPick, filesRootSelector, filesRootPick, pickFilesRoot, resumeFilesRootFollow, resetFilesRootPicks, syncFilesFollowConfig, knownFilesFollowConfig, pinnedFilesRoot, clearFilesRootPin, withRepo } from '../../lib/testkit.mjs'

/** A remote that records what reached it, keyed by method. */
function recordingRemote() {
  const calls = []
  const answer = (kind) => async (request, signal) => {
    calls.push({ kind, request, signal })
    return { ok: true, value: { ok: true, value: {} } }
  }
  return {
    calls,
    remote: {
      snapshot: answer('snapshot'),
      run: answer('run'),
      query: answer('query'),
      suggest: answer('suggest'),
      version: answer('version'),
      openFile: answer('openFile'),
    },
  }
}

test('a session starts on the cwd repository and can be pointed elsewhere', () => {
  assert.equal(selectedRepo('s1'), '', 'no selection means the cwd repository')
  selectRepo('s1', 'site')
  assert.equal(selectedRepo('s1'), 'site')
  selectRepo('s1', '')
  assert.equal(selectedRepo('s1'), '', "'' resets to the cwd repository")
  selectRepo('s1', 'nested/deep')
  selectRepo('s1', '')
  assert.equal(selectedRepo('s1'), '', "'' forgets the pick")
})

test('one session\'s pick never leaks into another', () => {
  selectRepo('a', 'one')
  selectRepo('b', 'two')
  assert.equal(selectedRepo('a'), 'one')
  assert.equal(selectedRepo('b'), 'two')
  assert.equal(selectedRepo('untouched'), '')
  selectRepo('a', '')
  selectRepo('b', '')
})

// Intent, not just the value: '' both clears the selection and means "the cwd
// repository", so without a separate marker a deliberate return to the root
// would look like "never picked" — and the panel's first-sub-repository
// default would fight the user who chose it.
test('a deliberate root pick counts as a choice, a repair does not', () => {
  assert.equal(hasRepoPick('intent-1'), false, 'a fresh session never picked anything')
  selectRepo('intent-1', 'site')
  assert.equal(hasRepoPick('intent-1'), true, 'a checkout pick records intent')
  selectRepo('intent-1', '')
  assert.equal(selectedRepo('intent-1'), '', "'' resets the selection")
  assert.equal(hasRepoPick('intent-1'), true, 'but the deliberate return to the root stays a choice')
  selectRepo('intent-1', 'other')
  assert.equal(hasRepoPick('intent-1'), true, 'picking again keeps the session in the picked state')
  clearRepoPick('intent-1')
  assert.equal(selectedRepo('intent-1'), '', 'a repair forgets the pick')
  assert.equal(hasRepoPick('intent-1'), false, 'and never records it as a root choice')
  assert.equal(hasRepoPick('intent-2'), false, 'intent never leaks across sessions')
})

test('an empty selection returns the original remote instead of a wrapper', () => {
  const { remote } = recordingRemote()
  assert.equal(withRepo(remote, ''), remote)
})

test('the wrapper tags every repository-scoped request and leaves the caller\'s object alone', async () => {
  const { calls, remote } = recordingRemote()
  const tagged = withRepo(remote, 'site')
  const request = { sessionId: 's' }
  const signal = new AbortController().signal

  await tagged.snapshot(request, signal)
  await tagged.run(request, signal)
  await tagged.query(request, signal)
  await tagged.suggest(request, signal)
  await tagged.openFile(request, signal)

  assert.deepEqual(calls.map((c) => c.kind), ['snapshot', 'run', 'query', 'suggest', 'openFile'])
  for (const call of calls) {
    assert.equal(call.request.repo, 'site', `${call.kind} carries the repository`)
    assert.equal(call.request.sessionId, 's', `${call.kind} keeps the session`)
  }
  assert.equal(request.repo, undefined, 'the caller\'s request object is not mutated')
  assert.equal(request.sessionId, 's')
})

test('a version lookup is host-scoped and is never tagged', async () => {
  const { calls, remote } = recordingRemote()
  const tagged = withRepo(remote, 'site')
  const signal = new AbortController().signal
  await tagged.version({ sessionId: 's' }, signal)
  // The signal rides through the wrapper for every method, including this one.
  assert.deepEqual(calls.map((c) => c.kind), ['version'])
  assert.equal(calls[0].request.repo, undefined, 'version must not carry a repository field')
  assert.equal(calls[0].signal, signal)
})

test('the config is only the default: an explicit pick applies in both modes', () => {
  selectRepo('fr-1', 'site')
  pickFilesRoot('fr-1', 'nested')
  assert.equal(filesRootSelector('fr-1', false), 'nested', 'follow off still honours the manual pick')
  assert.equal(filesRootPick('fr-1', false), 'nested', 'and the dropdown marks it')
  assert.equal(filesRootSelector('fr-1', true), 'nested', 'follow on returns to the manual pick')
  resumeFilesRootFollow('fr-1')
  clearRepoPick('fr-1')
  assert.equal(filesRootPick('fr-1', true), null, 'resuming drops the pick')
  assert.equal(filesRootSelector('fr-1', true), '', 'and the browser follows the panel again')
})

test('with no override the config default decides', () => {
  selectRepo('fr-6', 'alpha')
  assert.equal(filesRootSelector('fr-6', false), '', 'follow off parks at the project root')
  assert.equal(filesRootPick('fr-6', false), '', 'the dropdown marks the project row for it')
  assert.equal(filesRootSelector('fr-6', true), 'alpha', 'follow on tracks the repository')
  assert.equal(filesRootPick('fr-6', true), null, 'the follow row is the source')
})

test('the follow row opts a session in even while the config is off', () => {
  selectRepo('fr-2', 'alpha')
  assert.equal(filesRootSelector('fr-2', false), '', 'follow off parks at the project root')
  resumeFilesRootFollow('fr-2')
  assert.equal(filesRootSelector('fr-2', false), 'alpha', 'the opt-in tracks the repository anyway')
  assert.equal(filesRootPick('fr-2', false), null, 'the follow row marks the source')
  selectRepo('fr-2', 'beta')
  assert.equal(filesRootSelector('fr-2', false), 'beta', 'and follows repository switches')
  pickFilesRoot('fr-2', 'site')
  assert.equal(filesRootSelector('fr-2', false), 'site', 'picking a root ends the opt-in')
  assert.equal(filesRootPick('fr-2', false), 'site')
})

test("'' is a deliberate project-root pick, not the absence of one", () => {
  selectRepo('fr-3', 'alpha')
  pickFilesRoot('fr-3', '')
  assert.equal(filesRootPick('fr-3', true), '', "'' marks the pick itself")
  selectRepo('fr-3', 'gamma')
  assert.equal(filesRootSelector('fr-3', true), '', 'the project-root pick also sticks')
  resumeFilesRootFollow('fr-3')
  assert.equal(filesRootSelector('fr-3', true), 'gamma', 'back to following')
})

test('a config flip drops every override at once', () => {
  pickFilesRoot('fr-4a', 'site')
  resumeFilesRootFollow('fr-4b')
  pickFilesRoot('fr-4c', '')
  resetFilesRootPicks()
  assert.equal(filesRootPick('fr-4a', true), null, 'the flip is global — the setting is')
  assert.equal(filesRootPick('fr-4b', true), null, 'the follow opt-in is cleared with the rest')
  assert.equal(filesRootSelector('fr-4b', false), '', 'and the session parks on the new default')
  assert.equal(filesRootPick('fr-4c', true), null)
  pickFilesRoot('fr-4a', 'site')
  assert.equal(filesRootSelector('fr-4a', true), 'site', 'picking works again after the reset')
  resumeFilesRootFollow('fr-4a')
})

test('only a newer sample carrying another value is a config flip', () => {
  // The first sighting records the value: a panel mounting cold is no flip.
  assert.equal(knownFilesFollowConfig(), undefined, 'nothing read yet')
  pickFilesRoot('fr-5', '')
  assert.equal(syncFilesFollowConfig(true, 100), false)
  assert.equal(knownFilesFollowConfig(), true, 'the value is shared for panels without a sample of their own')
  assert.equal(filesRootPick('fr-5', true), '', 'the override survives the first sighting')
  // The same value again (a second panel instance, a later poll) changes nothing.
  assert.equal(syncFilesFollowConfig(true, 120), false)
  assert.equal(filesRootPick('fr-5', true), '')
  // An older sample with another value — a cached view of a hidden session —
  // must not flip the setting back.
  assert.equal(syncFilesFollowConfig(false, 110), false)
  assert.equal(knownFilesFollowConfig(), true)
  assert.equal(filesRootPick('fr-5', true), '')
  // A newer sample carrying a new value is the flip: every override goes.
  assert.equal(syncFilesFollowConfig(false, 130), true)
  assert.equal(filesRootPick('fr-5', false), '', 'back on the default: off parks at the project root')
  pickFilesRoot('fr-5', 'site')
  assert.equal(syncFilesFollowConfig(true, 140), true)
  assert.equal(filesRootPick('fr-5', true), null, 'the pick made under the old setting is dropped')
})

test('clearing a pin returns the session to the config default and keeps a project-root pick', () => {
  pickFilesRoot('fr-6', 'site')
  assert.equal(pinnedFilesRoot('fr-6'), 'site')
  clearFilesRootPin('fr-6')
  assert.equal(pinnedFilesRoot('fr-6'), undefined)
  assert.equal(filesRootPick('fr-6', false), '', 'off: back on the project root')
  assert.equal(filesRootPick('fr-6', true), null, 'on: back to following')
  pickFilesRoot('fr-6', '')
  assert.equal(pinnedFilesRoot('fr-6'), undefined, 'the project root is no checkout pin')
  clearFilesRootPin('fr-6')
  assert.equal(filesRootPick('fr-6', true), '', 'so the repair never touches it')
})

// One session can have two panels mounted (conversation tab + sidebar copy).
// Both render the shared controller's snapshot, so a pick must reach every
// subscriber — a per-instance copy would leave one panel writing to the
// previous checkout (a discard would then land in the wrong work tree).
test('a selection change reaches every subscriber of the shared store', () => {
  const seen = []
  const stopA = subscribeRepoSelection(() => seen.push(['a', selectedRepo('two-panels')]))
  const stopB = subscribeRepoSelection(() => seen.push(['b', selectedRepo('two-panels')]))
  try {
    selectRepo('two-panels', 'nested/site')
    assert.deepEqual(seen, [['a', 'nested/site'], ['b', 'nested/site']], 'both panels observe the pick')
    seen.length = 0
    clearRepoPick('two-panels')
    assert.deepEqual(seen, [['a', ''], ['b', '']], 'a repair drops the pick for both')
    seen.length = 0
    stopB()
    selectRepo('two-panels', 'x')
    assert.deepEqual(seen, [['a', 'x']], 'an unmounted panel stops hearing about it')
    assert.equal(selectedRepo('two-panels'), 'x')
    assert.equal(selectedRepo('inside'), '', 'another session keeps its own (empty) pick')
  } finally {
    stopA()
    stopB()
    clearRepoPick('two-panels')
    clearRepoPick('inside')
  }
})
