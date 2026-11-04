/**
 * Context menus on the file browser's entries, in the isolated file:// harness.
 *
 * The harness supplies the platform's two menu faces (harness.html's
 * `__contextMenusStub` / `__useContextMenuStub`): the injected trigger factory
 * records the captured target, and the service answers embedded resolutions with
 * the platform's own action ids — including the "open in sidebar" entry that
 * must not survive the whitelist. The runner therefore exercises the real row
 * bindings, the real contribution resolution and the real projection.
 *
 * Run `node test/e2e/setup.mjs` first (it copies client.js beside this file).
 */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { DIRECTORY_VIEWS, FILE_VIEWS, IMAGE_VIEWS } from '../../lib/testkit.mjs'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')
const ROOT = resolve(DIR, 'fixture-repo')

const SNAP = {
  root: ROOT, branch: 'main', head: '44638f7', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const TREE = { '': [['docs', true], ['README.md', false], ['logo.png', false]], docs: [['notes.md', false]] }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('pageerror', (error) => errors.push('PAGEERROR ' + error.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

await page.evaluate(async ({ snap, tree }) => {
  // The browser writes through the platform clipboard helper; record instead.
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async (text) => { window.__clipboard = text } },
    configurable: true,
  })
  const entry = window.__getLoaded()
  const connection = {
    rpc: {
      call: async (_c, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
        if (endpoint === 'gitPanel/query') {
          const q = request.query
          if (q.kind === 'dir-list') {
            const entries = (tree[q.path] || []).map(([name, dir]) => (dir ? { name, dir } : { name, dir, size: 12 }))
            return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries } } }
          }
          if (q.kind === 'file-content') {
            if (/\.png$/i.test(q.path)) {
              return { ok: true, value: { ok: true, value: {
                kind: 'file-content', path: q.path, variant: 'image',
                dataUrl: 'data:image/png;base64,iVBORw0KGgo=', size: 8,
              } } }
            }
            return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '# hi\n', lines: 1 } } }
          }
          if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: '44638f7' }], remote: [] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 0, commits: [] } } }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
        }
        if (endpoint === 'gitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
        if (endpoint === 'gitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: false } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }
  const registered = {}
  const dictionaries = {}
  const ctx = {
    get: (key) => ({ connection, contextMenus: window.__contextMenusStub })[key],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: { inject: (_n, p) => p(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
    locale: {
      register: (ns, dict) => { dictionaries[ns] = dict },
      bind: (ns) => (key, params) => {
        const text = dictionaries[ns]?.zh?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  entry.apply(ctx)
  await new Promise((r) => setTimeout(r, 400))
  window.ReactDOM.createRoot(document.getElementById('panel')).render(
    registered['conversation.view'].component({ sessionId: 'sess-menu', useContextMenu: window.__useContextMenuStub }),
  )
  await new Promise((r) => setTimeout(r, 600))
  const tab = [...document.querySelectorAll('.gp-tabbar [role="tab"]')]
    .find((t) => (t.textContent || '').includes('文件'))
  tab?.click()
  await new Promise((r) => setTimeout(r, 600))
}, { snap: SNAP, tree: TREE })

// Selecting a file still works: the menu binding must not swallow the click.
const row = page.locator('.gp-files__tree .gp-files__entry', { hasText: 'README.md' })
await row.click()
await page.waitForTimeout(300)
assert.ok(await page.locator('.gp-files__preview').count() > 0, 'clicking the row still selects the file')

// Right-click captures the row's identity and composes the menu.
await page.evaluate(() => { window.__menuStub.clear() })
await row.click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(100)

const target = await page.evaluate(() => window.__menuStub.state.last)
assert.ok(target, 'the row captured a context-menu target')
assert.equal(target.kind, 'gitPanel.file')
assert.equal(target.value.path, 'README.md')
assert.equal(target.value.sessionId, 'sess-menu')
assert.equal(target.value.root, ROOT, 'the captured root is the panel browse root')
assert.ok(typeof target.value.owner === 'string' && target.value.owner.length > 0, 'the target names its panel instance')

const offered = await page.evaluate(() => window.__menuStub.state.offered)
assert.deepEqual(offered.map((a) => a.id), [
  'open-in-app.file/float',
  'open-in-app.file/reveal',
  'open-in-app.file/open',
  'open-in-app.file/copyPath',
  'file-actions.file/copyImage',
  'file-actions.file/download',
  'file-actions.file/saveAs',
  'copy-relative-path',
], 'platform group first (the sidebar entry is whitelisted out), then the browser entry')
assert.ok(!offered.some((a) => a.id === 'open-in-app.file/sidebar'), 'no "open in sidebar" entry')

// The platform group is asked for the absolute path, so a nested root resolves.
const platformAsk = await page.evaluate(() => window.__platformAsk)
assert.equal(platformAsk.kind, 'file')
assert.equal(platformAsk.value.path, ROOT + '/README.md', 'the platform receives the absolute path')

// Right-click alone does not change the selection or the preview.
assert.equal(await page.locator('.gp-files__preview').count(), 1, 'the preview stays on the selected file')

// The browser's own entry writes the relative path and confirms through the toast.
await page.evaluate(() => window.__menuStub.clearNotices())
assert.equal(await page.evaluate(() => window.__menuStub.invoke('copy-relative-path')), 'ok')
assert.equal(await page.evaluate(() => window.__clipboard), 'README.md')
const notice = await page.evaluate(() => window.__menuStub.state.lastNotice)
assert.equal(notice && notice.text, '已复制') // locales.ts › zh › menu.copied
assert.equal(notice && notice.success, true)

// A platform entry forwards its id back to the platform's own resolution.
await page.evaluate(() => window.__menuStub.invoke('file-actions.file/download'))
const selected = await page.evaluate(() => window.__menuStub.state.selected)
assert.deepEqual(selected.map((s) => s.id), ['file-actions.file/download'])
assert.equal(selected[0].target.value.path, ROOT + '/README.md')

// A picture in the preview carries the *file* menu (it is a workspace file, so
// the platform group can reveal it) — not the diff panes' image family.
await page.evaluate(() => { window.__menuStub.clear() })
await page.locator('.gp-files__tree .gp-files__entry', { hasText: 'logo.png' }).click()
await page.waitForSelector('.gp-files__image img', { timeout: 5000 })
await page.locator('.gp-files__image img').click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
const imageTarget = await page.evaluate(() => window.__menuStub.state.last)
assert.equal(imageTarget.kind, 'gitPanel.file', 'the preview picture is a file, not an image-diff side')
assert.equal(imageTarget.value.path, 'logo.png')
const imageAsk = await page.evaluate(() => window.__platformAsk)
assert.equal(imageAsk.kind, 'file')
assert.equal(imageAsk.value.path, ROOT + '/logo.png')

// The stub's platform answers must stay in lockstep with the plugin's whitelist:
// the fixture fails loudly when either side drifts. The whitelist is the built
// constant, so a rename in the plugin (or a stub edit that "fixes" a failing id
// by copying the new name) cannot make both lists agree by accident — the
// sidebar entry is here to prove the filter drops something.
const lockstep = await page.evaluate(() => ({
  file: window.__contextMenusStub.__viewsFor('file').map((v) => v.id),
  directory: window.__contextMenusStub.__viewsFor('directory').map((v) => v.id),
  image: window.__contextMenusStub.__viewsFor('image').map((v) => v.id),
}))
for (const [kind, views] of Object.entries({ file: FILE_VIEWS, directory: DIRECTORY_VIEWS, image: IMAGE_VIEWS })) {
  const offered = lockstep[kind]
  for (const id of views) assert.ok(offered.includes(id), `the platform stub offers ${id}`)
}
assert.ok(!FILE_VIEWS.includes('open-in-app.file/sidebar'), 'the sidebar entry stays out of the whitelist')

// A directory row is its own family: Finder + copy path, no file entries.
const dirRow = page.locator('.gp-files__tree .gp-files__entry--dir', { hasText: 'docs' })
await page.evaluate(() => { window.__menuStub.clear() })
await dirRow.click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(100)
const dirTarget = await page.evaluate(() => window.__menuStub.state.last)
assert.equal(dirTarget.kind, 'gitPanel.directory')
assert.equal(dirTarget.value.path, 'docs')
const dirOffered = await page.evaluate(() => window.__menuStub.state.offered)
assert.deepEqual(dirOffered.map((a) => a.id), [
  'open-in-app.directory/reveal',
  'open-in-app.directory/copyPath',
  'copy-relative-path',
], 'the directory row adds its relative path after the platform group')

assert.deepEqual(errors, [], 'no page errors')
await browser.close()
console.log('context-menu e2e: ok')
