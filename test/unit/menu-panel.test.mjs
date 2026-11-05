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
      // One canned view per family, so the projection keeps the kind's own
      // entries and the assertions see a realistic group.
      const views = target.kind === 'directory'
        ? [
            { id: 'open-in-app.directory/reveal', label: 'Reveal' },
            { id: 'open-in-app.directory/copyPath', label: 'Copy path' },
          ]
        : [{ id: 'file-actions.image/copy', label: 'Copy image' }]
      return {
        source: { getSnapshot: () => views },
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
    repos: () => ({ commands: { fetch: () => {} }, facts: () => ({ canFetch: true }) }),
    observe: () => [],
  })
}

/** A panel showing one repository, with the menu owners' optional faces. */
function panel(service, { sessionId = 's', repo = '', browseRoot = '/work/repo', canFetch = true } = {}) {
  return panelMenuOwner({
    env: () => ({ t, menus: service, facts: FACTS }),
    browseRoot: () => browseRoot,
    identity: () => ({ sessionId, repo }),
    callbacks: () => CALLBACKS,
    repos: () => ({ commands: { fetch: () => {} }, facts: () => ({ canFetch }) }),
    observe: () => [],
  })
}

const identity = { sessionId: 's', owner: 'p', repo: '' }

/**
 * The two groups as the platform merges them: the borrowed (platform) entries
 * first, then the plugin's own. Both are contributions in their own right, which
 * is what keeps a slow platform from taking the plugin's entries with it.
 */
async function merged(owner, kind, value) {
  const signal = new AbortController().signal
  return [...await owner.borrowed(kind, value, signal), ...owner.own(kind, value)]
}

test('a file row asks the platform for the absolute path', async () => {
  const { service, asked } = recorder()
  await merged(owner(service), MENU_KIND.file, { ...identity, path: 'src/a.ts', root: null, ignored: false }, new AbortController().signal)
  assert.deepEqual(asked[0], { kind: 'file', value: { sessionId: 's', path: '/work/repo/src/a.ts' } })
})

test('a directory row asks the directory family', async () => {
  const { service, asked } = recorder()
  await merged(owner(service), MENU_KIND.directory, { ...identity, path: 'src', root: null, ignored: false }, new AbortController().signal)
  assert.equal(asked[0].kind, 'directory')
  assert.equal(asked[0].value.path, '/work/repo/src')
})

test('an image pane asks the image family with the data URL and no path', async () => {
  const { service, asked } = recorder()
  const actions = await merged(owner(service), MENU_KIND.image, {
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
  const actions = await merged(owner(undefined), 
    MENU_KIND.file, { ...identity, path: 'a.ts', root: null, ignored: false }, new AbortController().signal,
  )
  assert.deepEqual(actions.map((a) => a.id), ['copy-relative-path'])
})

test('an image shows nothing without the menu service (its only group is the platform one)', async () => {
  const actions = await merged(owner(undefined), 
    MENU_KIND.image, { ...identity, url: 'data:image/png;base64,AA' }, new AbortController().signal,
  )
  assert.deepEqual(actions, [])
})

test('a value of the wrong family resolves to no actions instead of a wrong menu', async () => {
  const { service } = recorder()
  // An image value captured under the file kind: no root to resolve against.
  const actions = await merged(owner(service), MENU_KIND.file, { ...identity, url: 'data:,' }, new AbortController().signal)
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
  const actions = await merged(switched, 
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
  const actions = await merged(moved, 
    MENU_KIND.file, { ...identity, path: 'a.ts', root: '/work/repo', ignored: false }, new AbortController().signal,
  )
  assert.deepEqual(actions, [])
  assert.deepEqual(asked, [])
})

test('an unresolved root (null) still resolves: the tree may not know its root yet', async () => {
  const { service, asked } = recorder()
  const actions = await merged(owner(service), 
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
  const actions = await merged(other, 
    MENU_KIND.file, { ...identity, path: 'a.ts', root: null, ignored: false }, new AbortController().signal,
  )
  assert.deepEqual(actions, [])
})

test('a repository row asks the platform for the row\'s own absolute root', async () => {
  const { service, asked } = recorder()
  const actions = await merged(owner(service), 
    MENU_KIND.repos, { ...identity, repo: 'apps/cli', root: '/work/apps/cli' }, new AbortController().signal,
  )
  assert.deepEqual(asked[0], {
    kind: 'directory',
    value: { sessionId: 's', path: '/work/apps/cli' },
  }, 'the platform directory family, addressed by the row absolute root')
  assert.deepEqual(actions.map((a) => a.id), [
    'open-in-app.directory/reveal', 'open-in-app.directory/copyPath', 'fetch-remote',
  ])
})

test('a repository row survives a repository pick inside the panel', async () => {
  const { service, asked } = recorder()
  // The panel moved to another checkout after the row was captured: a chooser
  // row still names its own root, so its menu stays valid.
  const switched = panel(service, { repo: 'other' })
  const actions = await merged(switched, 
    MENU_KIND.repos, { ...identity, repo: 'apps/cli', root: '/work/apps/cli' }, new AbortController().signal,
  )
  assert.equal(asked.length, 1)
  assert.ok(actions.length > 0)
})

test('a repository row without a root resolves to nothing', async () => {
  const { service, asked } = recorder()
  const actions = await merged(owner(service), 
    MENU_KIND.repos, { ...identity, repo: '', root: '' }, new AbortController().signal,
  )
  assert.deepEqual(actions, [])
  assert.deepEqual(asked, [], 'an unknown root is never sent to the platform')
})

test('a session switch still empties a repository row', async () => {
  const { service } = recorder()
  const actions = await merged(panel(service, { sessionId: 'other' }), 
    MENU_KIND.repos, { ...identity, repo: 'apps/cli', root: '/work/apps/cli' }, new AbortController().signal,
  )
  assert.deepEqual(actions, [])
})
