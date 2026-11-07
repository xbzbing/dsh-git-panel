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
  defaultDiffView: 'unified', capabilities: { branchDelete: true, remoteBranchDelete: true }, checkedAt: Date.now(),
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
        if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
        if (endpoint === 'dbGitPanel/query') {
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
          ], remote: [
            { name: 'origin/feature/x', shortHash: 'ddddddd', ref: 'refs/remotes/origin/feature/x' },
          ] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [{ name: 'v1.0', shortHash: 'ccccccc' }] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 2, commits: [
            { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'first commit', author: 'A', email: 'a@x', date: '2026-01-01T00:00:00Z', parents: [], refs: [] },
            { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', subject: 'second commit', author: 'A', email: 'a@x', date: '2026-01-02T00:00:00Z', parents: ['a'.repeat(40)], refs: [] },
          ] } } }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
        }
        if (endpoint === 'dbGitPanel/run') {
          window.__runs.push({ repo: request.repo, action: request.action })
          // Issue #112: the safe branch delete is refused as "not fully merged"
          // so the dialog's forced step runs; only the acknowledged `-D` succeeds.
          if (request.action.kind === 'branch-delete' && request.action.force !== true) {
            return { ok: true, value: { ok: false, error: { code: 'branch-unmerged', message: 'not fully merged' } } }
          }
          return { ok: true, value: { ok: true, snapshot: snap } }
        }
        if (endpoint === 'dbGitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: false } }
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

// A right-click is a gesture on a target, not a selection: pointing at another
// row must leave the active row (and the preview) where the click put them.
const activeOf = () => page.evaluate(() => document.querySelector('.gp-files__entry.gp-tree-row--active')?.textContent ?? '')
const beforeRightClick = await activeOf()
await page.locator('.gp-files__tree .gp-files__entry', { hasText: 'docs' }).click({ button: 'right' })
await page.waitForTimeout(150)
assert.equal(await page.evaluate(() => document.querySelectorAll('.gp-files__entry.gp-tree-row--active').length), 1, 'exactly one active row')
assert.equal(await activeOf(), beforeRightClick, 'right-clicking a directory row does not move the active row')
assert.ok((await activeOf()).includes('README.md'), 'the active row is still the file clicked above')
assert.equal(await page.locator('.gp-files__preview').count(), 1, 'and the preview still shows it')

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
  'quote-path',
], 'platform group first (the sidebar entry is whitelisted out), then the composer entry')
assert.ok(!offered.some((a) => a.id === 'open-in-app.file/sidebar'), 'no "open in sidebar" entry')

// The platform group is asked for the absolute path, so a nested root resolves.
const platformAsk = await page.evaluate(() => window.__platformAsk)
assert.equal(platformAsk.kind, 'file')
assert.equal(platformAsk.value.path, ROOT + '/README.md', 'the platform receives the absolute path')

// Right-click alone does not change the selection or the preview.
assert.equal(await page.locator('.gp-files__preview').count(), 1, 'the preview stays on the selected file')

// The platform's own copy entry is the only copy in the menu: the browser used
// to add a second, workspace-relative one, which duplicated it with a
// differently shaped answer. What is left is forwarded, not reimplemented.
await page.evaluate(() => { window.__menuStub.state.selected.length = 0 })
assert.equal(await page.evaluate(() => window.__menuStub.invoke('open-in-app.file/copyPath')), 'ok')
assert.deepEqual(
  await page.evaluate(() => window.__menuStub.state.selected.map((s) => s.id)),
  ['open-in-app.file/copyPath'],
  'the platform copies the path, and only it',
)

// A platform entry forwards its id back to the platform's own resolution.
await page.evaluate(() => { window.__menuStub.state.selected.length = 0 })
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
  'quote-path',
], 'the directory row adds only the composer entry after the platform group')

// ── P9: reference into the composer ───────────────────────────────────────
// A file row carries the quote entry (the harness exposes a composer face);
// invoking it writes the relative path and hands the keyboard back.
await page.evaluate(() => { window.__menuStub.clear(); window.__quotes = []; window.__quoteFocus = 0 })
await row.click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(100)
const quoteOffered = await page.evaluate(() => window.__menuStub.state.offered.map((a) => a.id))
assert.ok(quoteOffered.includes('quote-path'), 'the file row offers the composer entry')
assert.equal(quoteOffered[quoteOffered.length - 1], 'quote-path', 'the quote is the browser\'s last entry')
assert.equal(await page.evaluate(() => window.__menuStub.invoke('quote-path')), 'ok')
assert.deepEqual(await page.evaluate(() => window.__quotes), ['README.md'], 'the file path lands in the composer')
assert.equal(await page.evaluate(() => window.__quoteFocus), 1, 'the composer takes the keyboard back')

// ── a platform that answers late does not take the plugin's entries ───────
// The borrowed group is a contribution of its own, so the browser's entries are
// resolved and offered without waiting for it; a single combined contribution
// would lose both when the platform misses the budget.
await page.evaluate(() => { window.__platformReadyDelay = 5000 })
await page.evaluate(() => { window.__menuStub.clear() })
await row.click({ button: 'right' })
const pendingOwn = await page.evaluate(async () => {
  // Read what the plugin's own contribution offers before the platform answers.
  const contributions = window.__menuStub.contributions.filter((c) => c.target === 'gitPanel.file')
  const value = window.__menuStub.state.last.value
  const own = contributions.find((c) => !c.id.includes('borrow'))
  const borrowed = contributions.find((c) => c.id.includes('borrow'))
  return {
    own: (await own.resolve(value, new AbortController().signal)).map((a) => a.id),
    borrowing: borrowed !== undefined,
  }
})
assert.equal(pendingOwn.borrowing, true, 'the borrowed group is its own contribution')
assert.ok(pendingOwn.own.includes('quote-path'), 'the plugin entries resolve without the platform')
assert.ok(!pendingOwn.own.some((id) => id.startsWith('open-in-app.')), 'and they do not carry the platform entries')
await page.evaluate(() => { window.__platformReadyDelay = 0 })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.evaluate(() => { window.__menuStub.clear() })

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
  ['switch-branch', 'show-history', 'copy-branch', 'delete-branch'],
  'switching away from the current branch, then its history, its name, then the delete (issue #112)',
)
const deleteEntry = await page.evaluate(() => window.__menuStub.state.actions.find((a) => a.id === 'delete-branch'))
assert.equal(deleteEntry.danger, true, 'the delete is a destructive entry')
assert.equal(deleteEntry.separatorBefore, true, 'and sits below its own separator')

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

// Issue #112: the delete entry only opens a confirmation. The first confirm
// runs the safe `-d`; this fixture refuses it as "not fully merged", so the
// dialog reveals its second stage and only the acknowledged `-D` reaches the
// host as force:true.
const deletes = () => page.evaluate(() => window.__runs.filter((r) => r.action && r.action.kind === 'branch-delete').map((r) => [r.action.name, r.action.force === true]))
await page.evaluate(() => { window.__menuStub.clear() })
await featureRow.click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(120)
assert.equal(await page.evaluate(() => window.__menuStub.invoke('delete-branch')), 'ok')
await page.waitForSelector('.gp-modal-backdrop', { timeout: 3000 })
assert.deepEqual(await deletes(), [], 'the menu entry acts on nothing until the dialog is answered')
const confirm = page.locator('.gp-modal__footer .gp-btn--danger')
assert.ok((await confirm.textContent()).includes('删除分支'), 'the first stage offers the safe delete')
await confirm.click()
await page.waitForTimeout(300)
assert.deepEqual(await deletes(), [['feature/x', false]], 'the first attempt is the safe -d (no force flag)')
assert.equal(await page.locator('.gp-modal__check input[type="checkbox"]').count(), 1, 'the unmerged refusal reveals the force acknowledgement')
assert.equal(await confirm.isDisabled(), true, 'the forced confirm stays locked until it is acknowledged')
assert.ok((await confirm.textContent()).includes('强制删除'), 'and names the forced step')
await page.locator('.gp-modal__check input[type="checkbox"]').check()
assert.equal(await confirm.isDisabled(), false, 'acknowledging unlocks the forced delete')
await confirm.click()
await page.waitForTimeout(300)
assert.deepEqual(await deletes(), [['feature/x', false], ['feature/x', true]], 'only the acknowledged second press forces -D')
assert.equal(await page.locator('.gp-modal-backdrop').count(), 0, 'a successful delete closes the dialog')

// Tag rows render through the same branch-row component, so they reach the
// same menu builder: the delete must not follow them there (a tag is not a
// refs/heads entry). The row carries its section for exactly this gate.
await page.evaluate(() => { window.__menuStub.clear() })
await page.locator('.gp-branch-group__head', { hasText: '标签' }).click()
await page.waitForTimeout(150)
await page.locator('.gp-branch-row[title="v1.0"]').click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(120)
assert.equal(await page.evaluate(() => window.__menuStub.state.last.value.isTag), true, 'a tag row names its section')
assert.ok(
  !(await page.evaluate(() => window.__menuStub.state.offered.map((a) => a.id))).includes('delete-branch'),
  'the branch delete is not offered for a tag',
)
await page.evaluate(() => { window.__menuStub.clear() })

// A remote row deletes on the server: one stage, and the acknowledgement is
// mandatory before the confirm unlocks (there is no safe `-d` on a remote).
await page.evaluate(() => { window.__menuStub.clear() })
await page.locator('.gp-branch-group__head', { hasText: '远程' }).click()
await page.waitForTimeout(150)
await page.locator('.gp-branch-row[title="origin/feature/x"]').click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(120)
const remoteTarget = await page.evaluate(() => window.__menuStub.state.last)
assert.equal(remoteTarget.value.isRemote, true)
assert.equal(remoteTarget.value.ref, 'refs/remotes/origin/feature/x', 'the row carries the full tracking ref')
assert.deepEqual(
  await page.evaluate(() => window.__menuStub.state.offered.map((a) => a.id)),
  ['switch-branch', 'show-history', 'copy-branch', 'delete-remote-branch'],
  'the remote delete sits below the copy with its own separator',
)
const remoteDeletes = () => page.evaluate(() => window.__runs.filter((r) => r.action && r.action.kind === 'branch-delete-remote').map((r) => r.action.ref))
assert.equal(await page.evaluate(() => window.__menuStub.invoke('delete-remote-branch')), 'ok')
await page.waitForSelector('.gp-modal-backdrop', { timeout: 3000 })
assert.deepEqual(await remoteDeletes(), [], 'opening the dialog reaches no host')
const remoteConfirm = page.locator('.gp-modal__footer .gp-btn--danger')
assert.equal(await remoteConfirm.isDisabled(), true, 'the remote delete starts locked')
await page.locator('.gp-modal__check input[type="checkbox"]').check()
assert.equal(await remoteConfirm.isDisabled(), false, 'acknowledging unlocks it')
await remoteConfirm.click()
await page.waitForTimeout(300)
assert.deepEqual(await remoteDeletes(), ['refs/remotes/origin/feature/x'], 'the full ref reaches the host')
assert.equal(await page.locator('.gp-modal-backdrop').count(), 0, 'a successful remote delete closes the dialog')
await page.evaluate(() => { window.__menuStub.clear() })

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
  'copies and the composer first, then the write dialogs (this fixture declares only the branch-delete capabilities, so the checkout entry is gated out)',
)

// A destructive entry opens the existing confirmation instead of acting: no
// run reaches the host until the dialog is answered.
const runsBefore = await page.evaluate(() => window.__runs.length)
await page.evaluate(() => window.__menuStub.invoke('reset'))
await page.waitForSelector('[data-gp-overlay]', { timeout: 3000 })
assert.equal(await page.evaluate(() => window.__runs.length), runsBefore, 'the reset entry only opens the dialog')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)

// ── the hover card steps aside for an open menu ───────────────────────────
// The card is a portal anchored at the pointer and the popup is drawn above
// it, so the history raises no card while a menu is up: the right-click drops
// the one already shown, and moving across rows stays quiet until it closes.
await page.evaluate(() => window.__menuStub.clear())
const commitRows = page.locator('.gp-commit-row')
await commitRows.first().hover()
await page.waitForSelector('.gp-hovercard', { timeout: 3000 })
assert.equal(await page.locator('.gp-hovercard').count(), 1, 'hovering a commit row raises the card')

await commitRows.first().click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
assert.notEqual(
  await page.evaluate(() => window.__contextMenusStub.active.getSnapshot()), null,
  'the right-click opened the popup (the stub mirrors the platform presence)',
)
await page.waitForTimeout(80)
assert.equal(await page.locator('.gp-hovercard').count(), 0, 'the right-click drops the card')

// A pointer moving onto the next row, with the menu still up, raises nothing:
// the popup would cover it.
await commitRows.nth(1).hover()
await page.waitForTimeout(400)
assert.equal(await page.locator('.gp-hovercard').count(), 0, 'no card is raised while the menu is open')

// Dismissing the popup restores the hover.
await page.evaluate(() => window.__contextMenusStub.close())
await page.mouse.move(4, 4)
await page.waitForTimeout(120)
await commitRows.first().hover()
await page.waitForSelector('.gp-hovercard', { timeout: 3000 })
assert.equal(await page.locator('.gp-hovercard').count(), 1, 'the card returns once the menu is gone')

// The binding answers the keyboard gesture too (Shift+F10 / the ContextMenu
// key): a row that only opens a menu on right-click is unreachable without a
// mouse, and the platform's own binding is the only thing that makes it work.
await page.locator('.gp-tabbar [role="tab"]', { hasText: '文件' }).click()
await page.waitForTimeout(300)
await page.evaluate(() => { window.__menuStub.clear() })
await row.focus()
await page.keyboard.press('Shift+F10')
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(120)
const keyboardTarget = await page.evaluate(() => window.__menuStub.state.last)
assert.ok(keyboardTarget, 'Shift+F10 opens the same menu')
assert.equal(keyboardTarget.kind, 'gitPanel.file')
assert.equal(keyboardTarget.value.path, 'README.md')
await page.evaluate(() => { window.__menuStub.clear() })

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
        if (endpoint === 'dbGitPanel/snapshot') {
          const repo = request.repo || ''
          return { ok: true, value: { ok: true, value: repo === '' ? snap : snap2 } }
        }
        if (endpoint === 'dbGitPanel/query') {
          const q = request.query
          if (q.kind === 'repo-list') {
            return { ok: true, value: { ok: true, value: { kind: 'repo-list', cwd: window.__fixtureRoot, repos: [
              { path: '', name: 'fixture', root: window.__fixtureRoot, kind: 'workspace', role: 'main', branch: 'main' },
              { path: 'nested', name: 'nested', root: window.__fixtureRoot + '/nested', kind: 'repo', role: 'repo' },
            ] } } }
          }
          return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [], remote: [] } } }
        }
        if (endpoint === 'dbGitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
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

// ── The changes list's rows ───────────────────────────────────────────────
// Rebuild the panel with a working-tree change and a stash stack that answers
// late: the tab publishes its runs during its own render, so a menu opened
// while that answer is still in flight must read them at resolve time. A
// copied snapshot would hold the empty stand-ins and the apply would do
// nothing at all.
await page.evaluate(() => { window.__menuStub.clear() })
await page.evaluate(async ({ snap }) => {
  document.getElementById('panel').innerHTML = ''
  window.__runs = []
  // The previous panel's contributions are still registered (its context was
  // never torn down), and a target kind is answered by every contribution that
  // names it — drop them so the assertions see one group per section.
  window.__menuStub.contributions.splice(0)
  const entry = window.__getLoaded()
  const changed = {
    ...snap, dirty: true, staged: 0, modified: 1, untracked: 0,
    changes: [{ path: 'a.txt', status: 'M', staged: false, isDirectory: false }],
  }
  const connection = {
    rpc: {
      call: async (_c, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: changed } }
        if (endpoint === 'dbGitPanel/query') {
          const q = request.query
          if (q.kind === 'repo-list') {
            return { ok: true, value: { ok: true, value: { kind: 'repo-list', cwd: window.__fixtureRoot, repos: [
              { path: '', name: 'fixture', root: window.__fixtureRoot, kind: 'workspace', role: 'main', branch: 'main' },
            ] } } }
          }
          if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: '44638f7' }], remote: [] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [{ name: 'v1.0', shortHash: 'ccccccc' }] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 0, commits: [] } } }
          if (q.kind === 'stash-list') {
            // Late on purpose: the panel has already rendered by the time this
            // lands, so the tab's published runs change afterwards.
            await new Promise((r) => setTimeout(r, 400))
            return { ok: true, value: { ok: true, value: { kind: 'stash-list', entries: [
              { index: 0, sha: 'stash0sha', message: 'WIP on main: abc', branch: 'main', relTime: '2 hours ago' },
            ] } } }
          }
          if (q.kind === 'diff') return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: '', truncated: false } } }
        }
        if (endpoint === 'dbGitPanel/run') {
          window.__runs.push({ action: request.action })
          return { ok: true, value: { ok: true, snapshot: changed } }
        }
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
  entry.apply(ctx)
  await new Promise((r) => setTimeout(r, 300))
  window.ReactDOM.createRoot(document.getElementById('panel')).render(
    registered['conversation.view'].component({ sessionId: 'sess-changes', useContextMenu: window.__useContextMenuStub }),
  )
  await new Promise((r) => setTimeout(r, 500))
  const tab = [...document.querySelectorAll('.gp-tabbar [role="tab"]')]
    .find((t) => (t.textContent || '').includes('变更'))
  tab?.click()
  await new Promise((r) => setTimeout(r, 400))
}, { snap: SNAP })

await page.waitForSelector('.gp-changes__vrow', { timeout: 5000 })
await page.evaluate(() => { window.__menuStub.clear() })
const changeRow = page.locator('.gp-changes__vrow', { hasText: 'a.txt' }).first()
await changeRow.click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(150)
const changeTarget = await page.evaluate(() => window.__menuStub.state.last)
assert.ok(changeTarget, 'the change row binds a context menu')
assert.equal(changeTarget.kind, 'gitPanel.change')
assert.equal(changeTarget.value.path, 'a.txt')
assert.equal(changeTarget.value.staged, false)
assert.deepEqual(
  await page.evaluate(() => window.__menuStub.state.offered.map((a) => a.id)),
  ['open-diff', 'stage', 'discard'],
  'the diff, the stage direction and the discard confirm',
)
assert.equal(await page.evaluate(() => window.__menuStub.invoke('stage')), 'ok')
await page.waitForTimeout(200)
const staged = await page.evaluate(() => window.__runs.filter((r) => r.action && r.action.kind === 'stage'))
assert.equal(staged.length, 1, 'the menu stage reaches the host')
assert.deepEqual(staged[0].action.paths, ['a.txt'])

// The stash stack arrives 400 ms after the panel rendered; the row's entries
// exist only once it has, and the apply must still reach the host.
// The stash list boots folded; its rows only exist once it is opened.
await page.waitForSelector('.gp-stash', { timeout: 5000 })
await page.locator('.gp-stash .gp-group-head').click()
await page.waitForSelector('.gp-stash-row', { timeout: 5000 })
await page.evaluate(() => { window.__menuStub.clear() })
await page.locator('.gp-stash-row').first().click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(150)
const stashTarget = await page.evaluate(() => window.__menuStub.state.last)
assert.ok(stashTarget, 'the stash row binds a context menu')
assert.equal(stashTarget.kind, 'gitPanel.stash')
assert.equal(stashTarget.value.sha, 'stash0sha')
assert.deepEqual(
  await page.evaluate(() => window.__menuStub.state.offered.map((a) => a.id)),
  ['stash-apply', 'stash-pop', 'copy-message', 'stash-drop'],
)
assert.equal(await page.evaluate(() => window.__menuStub.invoke('stash-apply')), 'ok')
await page.waitForTimeout(200)
const applied = await page.evaluate(() => window.__runs.filter((r) => r.action && r.action.kind === 'stash-apply'))
assert.equal(applied.length, 1, 'a stash that arrived after the panel rendered still applies')

assert.deepEqual(errors, [], 'no page errors')
await browser.close()
console.log('context-menu e2e: ok')
