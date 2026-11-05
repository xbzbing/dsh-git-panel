/**
 * The panel's dispatch: which platform target family a captured value becomes,
 * and what it carries. The browser's relative path must reach the platform as an
 * absolute one; an image pane must reach it as a data URL with no path at all.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panelMenuOwner, MENU_KIND } from '../../lib/testkit.mjs'

const t = (key) => key

/** A `contextMenus` service that records the target it was asked to resolve. */
function recorder() {
  const asked = []
  const service = {
    register: () => () => {},
    notify: () => {},
    close: () => {},
    resolve: (target) => {
      asked.push(target)
      return {
        source: { getSnapshot: () => [{ id: 'file-actions.image/copy', label: 'Copy image' }] },
        ready: Promise.resolve(),
        select: () => {},
        dispose: () => {},
      }
    },
  }
  return { service, asked }
}

const FACTS = { isGit: false, revDiff: false, pathHistory: false }
const CALLBACKS = { compareRevision: () => {}, compareRef: () => {}, showHistory: () => {} }

function owner(service, browseRoot = '/work/repo', facts = FACTS) {
  return panelMenuOwner({
    env: () => ({ t, menus: service, facts }),
    browseRoot: () => browseRoot,
    identity: () => ({ sessionId: 's', repo: '' }),
    callbacks: () => CALLBACKS,
    observe: () => [],
  })
}

const identity = { sessionId: 's', owner: 'p', repo: '' }

test('a file row asks the platform for the absolute path', async () => {
  const { service, asked } = recorder()
  await owner(service).actionsFor(MENU_KIND.file, { ...identity, path: 'src/a.ts', root: null, ignored: false }, new AbortController().signal)
  assert.deepEqual(asked[0], { kind: 'file', value: { sessionId: 's', path: '/work/repo/src/a.ts' } })
})

test('a directory row asks the directory family', async () => {
  const { service, asked } = recorder()
  await owner(service).actionsFor(MENU_KIND.directory, { ...identity, path: 'src', root: null, ignored: false }, new AbortController().signal)
  assert.equal(asked[0].kind, 'directory')
  assert.equal(asked[0].value.path, '/work/repo/src')
})

test('an image pane asks the image family with the data URL and no path', async () => {
  const { service, asked } = recorder()
  const actions = await owner(service).actionsFor(MENU_KIND.image, {
    ...identity, url: 'data:image/png;base64,AA', name: 'logo@a1b2c3d.png', mediaType: 'image/png',
  }, new AbortController().signal)
  assert.deepEqual(asked[0], {
    kind: 'image',
    value: { url: 'data:image/png;base64,AA', name: 'logo@a1b2c3d.png', mediaType: 'image/png' },
  })
  assert.equal('path' in asked[0].value, false, 'no path: the picture is not a workspace file')
  assert.deepEqual(actions.map((a) => a.id), ['file-actions.image/copy'])
})

test('without the menu service a tree row still yields the in-panel entries', async () => {
  const actions = await owner(undefined).actionsFor(
    MENU_KIND.file, { ...identity, path: 'a.ts', root: null, ignored: false }, new AbortController().signal,
  )
  assert.deepEqual(actions.map((a) => a.id), ['copy-relative-path'])
})

test('an image shows nothing without the menu service (its only group is the platform one)', async () => {
  const actions = await owner(undefined).actionsFor(
    MENU_KIND.image, { ...identity, url: 'data:image/png;base64,AA' }, new AbortController().signal,
  )
  assert.deepEqual(actions, [])
})

test('a value of the wrong family resolves to no actions instead of a wrong menu', async () => {
  const { service } = recorder()
  // An image value captured under the file kind: no root to resolve against.
  const actions = await owner(service).actionsFor(MENU_KIND.file, { ...identity, url: 'data:,' }, new AbortController().signal)
  assert.deepEqual(actions, [])
})

test('a repository switch under an open menu resolves to nothing', async () => {
  const { service, asked } = recorder()
  const switched = panelMenuOwner({
    env: () => ({ t, menus: service, facts: FACTS }),
    browseRoot: () => '/work/repo',
    identity: () => ({ sessionId: 's', repo: 'other-repo' }),
    callbacks: () => CALLBACKS,
    observe: () => [],
  })
  const actions = await switched.actionsFor(
    MENU_KIND.file, { ...identity, repo: '', path: 'a.ts', root: null, ignored: false }, new AbortController().signal,
  )
  assert.deepEqual(actions, [])
  assert.deepEqual(asked, [], 'the platform is never even asked')
})

test('a browse-root switch under an open menu resolves to nothing', async () => {
  const { service, asked } = recorder()
  const moved = panelMenuOwner({
    env: () => ({ t, menus: service, facts: FACTS }),
    browseRoot: () => '/work/other',
    identity: () => ({ sessionId: 's', repo: '' }),
    callbacks: () => CALLBACKS,
    observe: () => [],
  })
  const actions = await moved.actionsFor(
    MENU_KIND.file, { ...identity, path: 'a.ts', root: '/work/repo', ignored: false }, new AbortController().signal,
  )
  assert.deepEqual(actions, [])
  assert.deepEqual(asked, [])
})

test('an unresolved root (null) still resolves: the tree may not know its root yet', async () => {
  const { service, asked } = recorder()
  const actions = await owner(service).actionsFor(
    MENU_KIND.file, { ...identity, path: 'a.ts', root: null, ignored: false }, new AbortController().signal,
  )
  assert.ok(actions.length > 0)
  assert.equal(asked.length, 1)
})

test('a session switch under an open menu resolves to nothing', async () => {
  const { service } = recorder()
  const other = panelMenuOwner({
    env: () => ({ t, menus: service, facts: FACTS }),
    browseRoot: () => '/work/repo',
    identity: () => ({ sessionId: 'other-session', repo: '' }),
    callbacks: () => CALLBACKS,
    observe: () => [],
  })
  const actions = await other.actionsFor(
    MENU_KIND.file, { ...identity, path: 'a.ts', root: null, ignored: false }, new AbortController().signal,
  )
  assert.deepEqual(actions, [])
})
