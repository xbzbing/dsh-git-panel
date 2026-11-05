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
await page.evaluate((root) => { window.__fixtureRoot = root }, ROOT)

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
          if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [
            { name: 'main', shortHash: '44638f7' },
            { name: 'feature/x', shortHash: 'aaaaaaa' },
          ], remote: [] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 2, commits: [
            { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'first commit', author: 'A', email: 'a@x', date: '2026-01-01T00:00:00Z', parents: [], refs: [] },
            { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', subject: 'second commit', author: 'A', email: 'a@x', date: '2026-01-02T00:00:00Z', parents: ['a'.repeat(40)], refs: [] },
          ] } } }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
        }
        if (endpoint === 'gitPanel/run') {
          window.__runs.push({ repo: request.repo, action: request.action })
          return { ok: true, value: { ok: true, snapshot: snap } }
        }
        if (endpoint === 'gitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: false } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }
  window.__runs = []
  const registered = {}
  const dictionaries = {}
  const ctx = {
    get: (key) => ({ connection, contextMenus: window.__contextMenusStub, sessions: window.__sessionsStub })[key],
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

// A thunk target is what keeps the captured identity current: the platform
// evaluates it at gesture time, and this stub mirrors that (harness.html).
assert.equal(await page.evaluate(() => window.__menuStub.sawThunk), true, 'the row binds a thunk, not a render-time value')
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
  'quote-path',
], 'platform group first (the sidebar entry is whitelisted out), then the browser entries')
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
  'quote-path',
], 'the directory row adds its relative path and the composer entry after the platform group')

// ── P9: reference into the composer ───────────────────────────────────────
// A file row carries the quote entry (the harness exposes a composer face);
// invoking it writes the relative path and hands the keyboard back.
await page.evaluate(() => { window.__menuStub.clear(); window.__quotes = []; window.__quoteFocus = 0 })
await row.click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(100)
const quoteOffered = await page.evaluate(() => window.__menuStub.state.offered.map((a) => a.id))
assert.ok(quoteOffered.includes('quote-path'), 'the file row offers the composer entry')
assert.deepEqual(quoteOffered.slice(-2), ['copy-relative-path', 'quote-path'], 'the quote follows the path copy')
assert.equal(await page.evaluate(() => window.__menuStub.invoke('quote-path')), 'ok')
assert.deepEqual(await page.evaluate(() => window.__quotes), ['README.md'], 'the file path lands in the composer')
assert.equal(await page.evaluate(() => window.__quoteFocus), 1, 'the composer takes the keyboard back')

// ── The overview's branch and commit rows (issue #107) ───────────────────
// These rows reach the same panel face as the browser's, through a prop the
// tab receives from the panel. A panel that forgets to pass it leaves every
// branch and commit without a right-click — invisible to typecheck (the prop
// is optional) and to the pure builder tests, so this section is the guard.
await page.evaluate(() => { window.__menuStub.clear() })
await page.locator('.gp-tabbar [role="tab"]', { hasText: '总览' }).click()
await page.waitForSelector('.gp-branch-row', { timeout: 5000 })

// A slash-named branch renders as a nested folder row; the leaf carries the
// full name in `title`.
const featureRow = page.locator('.gp-branch-row[title="feature/x"]')
await featureRow.click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(120)
const branchTarget = await page.evaluate(() => window.__menuStub.state.last)
assert.ok(branchTarget, 'the branch row binds a context menu')
assert.equal(branchTarget.kind, 'gitPanel.branch')
assert.equal(branchTarget.value.name, 'feature/x')
assert.equal(branchTarget.value.isCurrent, false)
assert.equal(branchTarget.value.sessionId, 'sess-menu')
assert.ok(typeof branchTarget.value.owner === 'string' && branchTarget.value.owner.length > 0, 'the branch row names its panel instance')
assert.deepEqual(
  await page.evaluate(() => window.__menuStub.state.offered.map((a) => a.id)),
  ['switch-branch', 'show-history', 'copy-branch'],
  'switching away from the current branch, then this branch\'s history, then its name',
)

// The copy goes through the panel's clipboard supplier.
await page.evaluate(() => { window.__clipboard = null })
assert.equal(await page.evaluate(() => window.__menuStub.invoke('copy-branch')), 'ok')
assert.equal(await page.evaluate(() => window.__clipboard), 'feature/x')

// The runs are published by the *tab*, whose render happens after the panel's.
// Reading them at resolve time is what makes the session's first menu work; a
// copied snapshot of them would still hold the empty stand-ins, and this
// switch would quietly do nothing.
assert.equal(await page.evaluate(() => window.__menuStub.invoke('switch-branch')), 'ok')
await page.waitForTimeout(200)
const switched = await page.evaluate(() => window.__runs.filter((r) => r.action && r.action.kind === 'branch-checkout'))
assert.equal(switched.length, 1, 'the menu switch reaches the host')
assert.equal(switched[0].action.name, 'feature/x')

// A commit row carries the copy entries, the composer entry and the three
// write dialogs.
await page.evaluate(() => { window.__menuStub.clear() })
await page.locator('.gp-commit-row').first().click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(120)
const commitTarget = await page.evaluate(() => window.__menuStub.state.last)
assert.ok(commitTarget, 'the commit row binds a context menu')
assert.equal(commitTarget.kind, 'gitPanel.commit')
assert.equal(commitTarget.value.hash, 'a'.repeat(40))
assert.equal(commitTarget.value.shortHash, 'aaaaaaa')
assert.equal(commitTarget.value.subject, 'first commit')
assert.deepEqual(
  await page.evaluate(() => window.__menuStub.state.offered.map((a) => a.id)),
  ['copy-hash', 'copy-short-hash', 'copy-subject', 'quote-commit', 'create-tag', 'revert', 'reset'],
  'copies and the composer first, then the dialogs',
)

// A destructive entry opens the existing confirmation instead of acting: no
// run reaches the host until the dialog is answered.
const runsBefore = await page.evaluate(() => window.__runs.length)
await page.evaluate(() => window.__menuStub.invoke('reset'))
await page.waitForSelector('[data-gp-overlay]', { timeout: 3000 })
assert.equal(await page.evaluate(() => window.__runs.length), runsBefore, 'the reset entry only opens the dialog')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

// ── P8: the repository selector's rows ────────────────────────────────────
// The repo list needs two choices and a ready snapshot (ReposSection hides
// itself below two rows). The overview tab hosts it.
const REPOS = {
  root: ROOT, branch: 'main', head: '44638f7', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null, changes: [],
  stats: SNAP.stats, truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}
await page.evaluate(() => { window.__menuStub.clear() })
await page.evaluate(async ({ snap }) => {
  // Rebuild a second panel whose controller answers with a two-choice list.
  document.getElementById('panel').innerHTML = ''
  const entry = window.__getLoaded()
  const snap2 = { ...snap, root: window.__fixtureRoot + '/nested' }
  const connection = {
    rpc: {
      call: async (_c, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'gitPanel/snapshot') {
          const repo = request.repo || ''
          return { ok: true, value: { ok: true, value: repo === '' ? snap : snap2 } }
        }
        if (endpoint === 'gitPanel/query') {
          const q = request.query
          if (q.kind === 'repo-list') {
            return { ok: true, value: { ok: true, value: { kind: 'repo-list', cwd: window.__fixtureRoot, repos: [
              { path: '', name: 'fixture', root: window.__fixtureRoot, kind: 'workspace', role: 'main', branch: 'main' },
              { path: 'nested', name: 'nested', root: window.__fixtureRoot + '/nested', kind: 'repo', role: 'repo' },
            ] } } }
          }
          return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [], remote: [] } } }
        }
        if (endpoint === 'gitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }
  const registered = {}
  const dictionaries = {}
  const ctx = {
    get: (key) => ({ connection, contextMenus: window.__contextMenusStub, sessions: window.__sessionsStub })[key],
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
  window.__menuStub.contributions.splice(0)
  entry.apply(ctx)
  window.__registered = registered
  await new Promise((r) => setTimeout(r, 400))
  window.ReactDOM.createRoot(document.getElementById('panel')).render(
    registered['conversation.view'].component({ sessionId: 'sess-repos', useContextMenu: window.__useContextMenuStub }),
  )
  await new Promise((r) => setTimeout(r, 600))
}, { snap: REPOS })

// The overview tab shows the repository list; right-click its second row. The
// list boots collapsed (the fold keeps rows mounted but hidden), so the menu
// binding is read through the capture, not a click: evaluate the row's own
// handlers the way the platform would.
await page.waitForFunction(() => document.querySelectorAll('.gp-repolist__row').length === 2, { timeout: 5000 })
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.gp-repolist__row')].find((el) => (el.textContent || '').includes('nested'))
  const button = row.querySelector('button')
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
  button.dispatchEvent(event)
})
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(100)
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(100)
const repoTarget = await page.evaluate(() => window.__menuStub.state.last)
assert.equal(repoTarget.kind, 'gitPanel.repos')
assert.equal(repoTarget.value.root, ROOT + '/nested', 'the captured root is the row\'s checkout')
assert.equal(repoTarget.value.repo, 'nested', 'the captured tag is the row\'s own checkout, not the panel\'s')
const repoOffered = await page.evaluate(() => window.__menuStub.state.offered)
assert.deepEqual(repoOffered.map((a) => a.id), [
  'open-in-app.directory/reveal',
  'open-in-app.directory/copyPath',
  'fetch-remote',
], 'the row borrows the platform directory group and adds the remote check')
const repoAsk = await page.evaluate(() => window.__platformAsk)
assert.equal(repoAsk.kind, 'directory')
assert.equal(repoAsk.value.path, ROOT + '/nested', 'the platform is asked with the row\'s absolute root')

// The sampled row's menu follows the same facts from the other side: its
// snapshot carried `remote: null`, so the checkout has no remote to ask and the
// entry is hidden rather than offered and failing.
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.gp-repolist__row')].find((el) => (el.textContent || '').includes('fixture'))
  row.querySelector('button').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
})
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(100)
const ownOffered = await page.evaluate(() => window.__menuStub.state.offered)
assert.deepEqual(ownOffered.map((a) => a.id), [
  'open-in-app.directory/reveal', 'open-in-app.directory/copyPath',
], 'a checkout whose sample reports no remote hides the remote check')

// ── P8: the input-bar pill ────────────────────────────────────────────────
// The pill registers its own owner (it outlives the panel), so its menu is
// asserted the same way: render it beside the panel and right-click it.
await page.evaluate(() => {
  const host = document.createElement('div')
  host.id = 'pill'
  document.body.appendChild(host)
  window.__menuStub.clear()
})
await page.evaluate(() => {
  const entry = window.__registered['conversation.input.left']
  window.ReactDOM.createRoot(document.getElementById('pill')).render(
    entry.component({ sessionId: 'sess-repos', useContextMenu: window.__useContextMenuStub }),
  )
})
await page.waitForSelector('.gp-pill', { timeout: 5000 })
await page.evaluate(() => {
  document.querySelector('.gp-pill').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
})
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(100)
const pillTarget = await page.evaluate(() => window.__menuStub.state.last)
assert.equal(pillTarget.kind, 'gitPanel.pill')
assert.equal(pillTarget.value.root, ROOT, 'the captured root is the checkout the pill samples')
assert.equal(pillTarget.value.branch, 'main')
const pillOffered = await page.evaluate(() => window.__menuStub.state.offered)
assert.deepEqual(pillOffered.map((a) => a.id), [
  'open-overview', 'open-changes', 'open-files', 'copy-branch', 'copy-root',
], 'navigation, the copy answers; no remote check (the sample has no remote)')

assert.deepEqual(errors, [], 'no page errors')
await browser.close()
console.log('context-menu e2e: ok')
