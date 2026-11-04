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

function owner(service, browseRoot = '/work/repo') {
  return panelMenuOwner({
    env: () => ({ t, menus: service }),
    browseRoot: () => browseRoot,
    observe: () => [],
  })
}

const identity = { sessionId: 's', owner: 'p', repo: '' }

test('a file row asks the platform for the absolute path', async () => {
  const { service, asked } = recorder()
  await owner(service).actionsFor(MENU_KIND.file, { ...identity, path: 'src/a.ts', root: null, ignored: false }, new AbortController().signal)
  assert.deepEqual(asked[0], { kind: 'file', value: { sessionId: 's', path: '/work/repo/src/a.ts' } })
})

test('a nested root wins over the panel browse root', async () => {
  const { service, asked } = recorder()
  await owner(service).actionsFor(
    MENU_KIND.file, { ...identity, path: 'a.ts', root: '/work/repo/packages/x', ignored: false }, new AbortController().signal,
  )
  assert.equal(asked[0].value.path, '/work/repo/packages/x/a.ts')
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
