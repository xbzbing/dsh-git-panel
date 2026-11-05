/**
 * The repository row's and the pill's menus: pure builders, asserted without
 * React. Composition, order, gating (remote / no remote, detached HEAD) and the
 * fetch entry's run wiring are what these pin down; the reveal/copy group is
 * the platform's (menu-panel.test.mjs covers the target it is asked with).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MENU_KIND, repoRowMenuActions, pillMenuActions } from '../../lib/testkit.mjs'

const t = (key, params) => {
  if (params === undefined) return key
  return key + '?' + Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
}

function env() {
  const notices = []
  return {
    notices,
    face: {
      t,
      menus: { notify: (text, success) => notices.push({ text, success }) },
      facts: { isGit: true, revDiff: false, pathHistory: false },
    },
  }
}

const identity = { sessionId: 's', owner: 'p' }
const PLATFORM = [
  { id: 'open-in-app.directory/reveal', label: 'reveal' },
  { id: 'open-in-app.directory/copyPath', label: 'copyPath' },
]

test('a repository row keeps the platform group and adds the remote check', () => {
  const { face, notices } = env()
  const fetches = []
  const actions = repoRowMenuActions(
    { ...identity, repo: 'apps/cli', root: '/work/apps/cli' },
    face, PLATFORM, { fetch: (tag) => fetches.push(tag) }, { canFetch: true },
  )
  assert.deepEqual(actions.map((a) => a.id), [
    'open-in-app.directory/reveal', 'open-in-app.directory/copyPath', 'fetch-remote',
  ])
  void actions[2].run()
  assert.deepEqual(fetches, ['apps/cli'])
  assert.deepEqual(notices, [])
})

test('the remote check disappears when the checkout cannot be asked', () => {
  const { face } = env()
  const actions = repoRowMenuActions(
    { ...identity, repo: '', root: '/work/repo' },
    face, PLATFORM, { fetch: () => {} }, { canFetch: false },
  )
  assert.deepEqual(actions.map((a) => a.id), ['open-in-app.directory/reveal', 'open-in-app.directory/copyPath'])
})

test('a repository row without a platform group still gets the fetch entry', () => {
  const { face } = env()
  const actions = repoRowMenuActions(
    { ...identity, repo: 'x', root: '/work/x' },
    face, [], { fetch: () => {} }, { canFetch: true },
  )
  assert.deepEqual(actions.map((a) => a.id), ['fetch-remote'])
})

test('the pill offers navigation, the copy answers, then the remote check', () => {
  const { face } = env()
  const tabs = []
  const actions = pillMenuActions(
    { ...identity, repo: '', root: '/work/repo', branch: 'main' },
    face,
    { openTab: (tab) => tabs.push(tab), fetch: () => {} },
    { canFetch: true },
  )
  assert.deepEqual(actions.map((a) => a.id), [
    'open-overview', 'open-changes', 'open-files', 'copy-branch', 'copy-root', 'fetch-remote',
  ])
  void actions[0].run()
  assert.deepEqual(tabs, ['overview'])
})

test('a detached pill has no branch entry; the checkout answers stay', () => {
  const { face } = env()
  const actions = pillMenuActions(
    { ...identity, repo: '', root: '/work/repo', branch: null },
    face, { openTab: () => {}, fetch: () => {} }, { canFetch: true },
  )
  assert.deepEqual(actions.map((a) => a.id), [
    'open-overview', 'open-changes', 'open-files', 'copy-root', 'fetch-remote',
  ], 'a detached HEAD can still be fetched; only the branch name is missing')
})

test('a checkout without a remote hides the fetch entry', () => {
  const { face } = env()
  const actions = pillMenuActions(
    { ...identity, repo: '', root: '/work/repo', branch: 'main' },
    face, { openTab: () => {}, fetch: () => {} }, { canFetch: false },
  )
  assert.deepEqual(actions.map((a) => a.id), ['open-overview', 'open-changes', 'open-files', 'copy-branch', 'copy-root'])
})

test('the fetch entry delegates to the run; the report is the caller’s job', async () => {
  const { face, notices } = env()
  const fetches = []
  const actions = pillMenuActions(
    { ...identity, repo: '', root: '/work/repo', branch: 'main' },
    face, { openTab: () => {}, fetch: (tag) => fetches.push(tag) }, { canFetch: true },
  )
  assert.equal(actions[5].failureLabel, 'common.operationFailed')
  await actions[5].run()
  assert.deepEqual(fetches, [''])
  assert.deepEqual(notices, [], 'the menu reports only what it runs itself (copies)')
})
