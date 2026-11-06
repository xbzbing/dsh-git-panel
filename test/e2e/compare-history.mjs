/**
 * The comparison flows: the ref picker, the revision picker and the revision
 * diff overlay, driven through the real file-row menu in the isolated harness.
 *
 * What this pins:
 *  - the candidates are the repository's own refs (a short name is never
 *    prefixed back, and a remote-tracking HEAD is not offered);
 *  - a single-group list carries no heading;
 *  - one Escape closes the overlay and leaves the picker open (both listen on
 *    `document`, so without the layer check a keystroke closes both);
 *  - the file-history chip and every other filter are exclusive, because the
 *    host rejects a request that carries both;
 *  - both entries disappear on a host that did not declare the capability.
 *
 * Run `node test/e2e/setup.mjs` first (it copies client.js beside this file).
 */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

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

const TREE = { '': [['docs', true], ['README.md', false]], docs: [['notes.md', false]] }
const COMMITS = [
  { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'first commit', author: 'A', email: 'a@x', dateIso: '2026-01-01T00:00:00Z', parents: [], refs: [] },
  { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', subject: 'second commit', author: 'A', email: 'a@x', dateIso: '2026-01-02T00:00:00Z', parents: ['a'.repeat(40)], refs: [] },
]

/** Boot one panel; `capabilities` decides whether the Git entries exist, and
 * `snap` overrides the snapshot (a dirty one lands on the changes tab, so the
 * overview only mounts later). */
async function boot(page, capabilities, history, snap = SNAP) {
  await page.evaluate(async ({ snap, tree, commits, capabilities, history }) => {
    document.getElementById('panel').innerHTML = ''
    window.__menuStub.contributions.splice(0)
    window.__queries = []
    window.__runs = []
    const entry = window.__getLoaded()
    const connection = {
      rpc: {
        call: async (_c, endpoint, payload) => {
          const request = payload && payload.args && payload.args.request
          if (endpoint === 'dbGitPanel/snapshot') {
            return { ok: true, value: { ok: true, value: { ...snap, ...(capabilities === null ? {} : { capabilities }) } } }
          }
          if (endpoint === 'dbGitPanel/query') {
            const q = request.query
            window.__queries.push(q)
            if (q.kind === 'repo-list') {
              return { ok: true, value: { ok: true, value: { kind: 'repo-list', cwd: window.__fixtureRoot, repos: [
                { path: '', name: 'fixture', root: window.__fixtureRoot, kind: 'workspace', role: 'main', branch: 'main' },
              ] } } }
            }
            if (q.kind === 'dir-list') {
              const entries = (tree[q.path] || []).map(([name, dir]) => (dir ? { name, dir } : { name, dir, size: 12 }))
              return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries } } }
            }
            if (q.kind === 'file-content') {
              return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '# hi\n', lines: 1 } } }
            }
            if (q.kind === 'branches') {
              // A branch and a tag that share a name, and a remote-tracking HEAD:
              // the three shapes a client must not rebuild from the short name.
              return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: 'main', local: [
                { name: 'main', shortHash: '44638f7', ref: 'refs/heads/main' },
                { name: 'heads/same-name', shortHash: '1234567', ref: 'refs/heads/same-name' },
              ], remote: [
                { name: 'origin/main', shortHash: '44638f7', ref: 'refs/remotes/origin/main' },
              ] } } }
            }
            if (q.kind === 'tags') {
              return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [
                { name: 'tags/same-name', shortHash: '1234567', ref: 'refs/tags/same-name' },
                { name: 'v1', shortHash: '1234567', ref: 'refs/tags/v1' },
              ] } } }
            }
            if (q.kind === 'authors') {
              return { ok: true, value: { ok: true, value: { kind: 'authors', authors: ['A', 'B'] } } }
            }
            if (q.kind === 'history') {
              return { ok: true, value: { ok: true, value: { kind: 'history', total: history === 0 ? 0 : commits.length, commits: history === 0 ? [] : commits, pathSearchSupported: true } } }
            }
            if (q.kind === 'diff') {
              return { ok: true, value: { ok: true, value: {
                kind: 'diff', path: q.path,
                text: `diff --git a/${q.path} b/${q.path}\n--- a/${q.path}\n+++ b/${q.path}\n@@ -1 +1 @@\n-old\n+new\n`,
                newLines: 1,
              } } }
            }
            if (q.kind === 'last-commit-message') {
              return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
            }
          }
          if (endpoint === 'dbGitPanel/run') {
            window.__runs.push(request.action)
            return { ok: true, value: { ok: true, snapshot: snap } }
          }
          if (endpoint === 'dbGitPanel/version') {
            return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: false } }
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
    window.__registered = registered
    await new Promise((r) => setTimeout(r, 300))
    window.ReactDOM.createRoot(document.getElementById('panel')).render(
      registered['conversation.view'].component({ sessionId: 'sess-compare', useContextMenu: window.__useContextMenuStub }),
    )
    await new Promise((r) => setTimeout(r, 600))
    const tab = [...document.querySelectorAll('.gp-tabbar [role="tab"]')]
      .find((t) => (t.textContent || '').includes('文件'))
    tab?.click()
    await new Promise((r) => setTimeout(r, 500))
  }, { snap, tree: TREE, commits: COMMITS, capabilities, history })
}

/** Right-click a tree row and run one of its entries. */
async function runRowEntry(page, name, id) {
  // The history chip switches the panel to the overview; the tree lives on the
  // files tab, so bring it back before right-clicking a row.
  if (await page.locator('.gp-files__tree .gp-files__entry').count() === 0) {
    await page.locator('.gp-tabbar [role="tab"]', { hasText: '文件' }).click()
    await page.waitForTimeout(300)
  }
  await page.evaluate(() => { window.__menuStub.clear() })
  const row = page.locator('.gp-files__tree .gp-files__entry', { hasText: name })
  await row.click({ button: 'right' })
  await page.evaluate(() => window.__menuStub.resolvePending())
  await page.waitForTimeout(120)
  const offered = await page.evaluate(() => window.__menuStub.state.offered.map((a) => a.id))
  assert.ok(offered.includes(id), `the row offers ${id} (offered: ${offered.join(', ')})`)
  await page.evaluate((actionId) => window.__menuStub.invoke(actionId), id)
  await page.waitForTimeout(300)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('pageerror', (error) => errors.push('PAGEERROR ' + error.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })
await page.evaluate((root) => { window.__fixtureRoot = root }, ROOT)

const CAPS = { revDiff: true, pathHistory: true, commitCheckout: true }

// ── the ref picker ────────────────────────────────────────────────────────
await boot(page, CAPS, COMMITS.length)
await runRowEntry(page, 'README.md', 'compare-ref')
await page.waitForSelector('.gp-compare__row', { timeout: 5000 })

const picker = await page.evaluate(() => {
  const list = document.querySelector('.gp-compare__list')
  return {
    title: document.querySelector('.gp-modal--picker .gp-modal__path')?.textContent ?? '',
    file: document.querySelector('.gp-compare__file')?.textContent ?? '',
    // Headings and rows in document order, so the grouping is checked as drawn.
    order: [...list.children].filter((el) => el.matches('.gp-compare__heading, .gp-compare__row')).map((el) => (el.matches('.gp-compare__heading')
      ? `#${el.querySelector('.gp-compare__heading-title')?.textContent}:${el.querySelector('.gp-compare__count')?.textContent}`
      : el.querySelector('.gp-compare__label')?.textContent)),
    current: [...document.querySelectorAll('.gp-compare__row')].filter((row) => row.querySelector('.gp-compare__badge') !== null).map((row) => row.querySelector('.gp-compare__label')?.textContent),
    active: [...document.querySelectorAll('.gp-compare__row--active')].map((row) => row.querySelector('.gp-compare__label')?.textContent),
    listHeight: list.getBoundingClientRect().height,
    focusInFilter: document.activeElement?.classList.contains('gp-compare__filter') === true,
  }
})
assert.equal(picker.title, '与分支或标签比较', 'the title carries no trailing ellipsis')
assert.equal(picker.file, 'README.md', 'the file the comparison is about is named under the bar')
assert.deepEqual(picker.order, ['#本地:2', 'main', 'heads/same-name', '#远程:1', 'origin/main', '#标签:2', 'tags/same-name', 'v1'],
  'one counted heading above each group (zh), the labels are the short names')
assert.ok(!picker.order.includes('origin'), 'a remote-tracking HEAD is not a candidate')
assert.deepEqual(picker.current, ['main'], 'the checked-out branch carries the HEAD badge')
assert.deepEqual(picker.active, ['main'], 'the cursor starts on the first candidate')
assert.ok(picker.listHeight > 100, 'the list has a bounded height of its own')
assert.equal(picker.focusInFilter, true, 'the filter box has the keyboard')

// The keyboard drives the cursor; the filter narrows and resets it.
await page.keyboard.press('ArrowDown')
await page.keyboard.press('ArrowDown')
assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.gp-compare__row--active')].map((row) => row.querySelector('.gp-compare__label')?.textContent)),
  ['origin/main'], 'two steps down skip the heading')
await page.keyboard.type('same')
await page.waitForTimeout(80)
const narrowed = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('.gp-compare__row .gp-compare__label')].map((el) => el.textContent),
  active: [...document.querySelectorAll('.gp-compare__row--active .gp-compare__label')].map((el) => el.textContent),
  total: document.querySelector('.gp-compare__total')?.textContent ?? '',
}))
assert.deepEqual(narrowed.labels, ['heads/same-name', 'tags/same-name'])
assert.deepEqual(narrowed.active, ['heads/same-name'], 'a new needle puts the cursor back on the first match')
assert.equal(narrowed.total, '2 / 5', 'the box shows how many candidates are left')
await page.keyboard.press('ArrowDown')
await page.keyboard.press('Enter')
await page.waitForFunction(() => document.querySelectorAll('[data-gp-overlay]').length === 2, null, { timeout: 5000 })
const enterQuery = await page.evaluate(() => window.__queries.filter((q) => q.kind === 'diff' && q.base === 'rev').pop())
assert.equal(enterQuery?.rev, 'refs/tags/same-name', 'Enter compares against the row under the cursor')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
await page.locator('.gp-compare__filter').fill('')
await page.waitForTimeout(80)

// Picking one opens a revision comparison of that ref, with the working file as
// the new side.
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.gp-compare__row')].find((r) => (r.textContent || '').includes('v1'))
  row.click()
})
await page.waitForSelector('.gp-modal-backdrop[data-gp-overlay]', { timeout: 5000 })
assert.equal(await page.evaluate(() => document.querySelectorAll('[data-gp-overlay]').length), 2, 'the overlay sits above the picker')
const revQuery = await page.evaluate(() => window.__queries.filter((q) => q.kind === 'diff' && q.base === 'rev').pop())
assert.ok(revQuery, 'a rev diff is requested')
assert.equal(revQuery.path, 'README.md')
assert.equal(revQuery.rev, 'refs/tags/v1', 'the full ref travels, not the short name')

// ── one Escape closes the overlay, not the picker under it ────────────────
assert.equal(await page.locator('.gp-compare__row').count() > 0, true, 'the picker stays mounted under the overlay')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
assert.equal(await page.evaluate(() => document.querySelectorAll('[data-gp-overlay]').length), 1, 'Escape closes only the overlay')
assert.ok(await page.locator('.gp-compare__row').count() > 0, 'and leaves the picker open')
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
assert.equal(await page.locator('.gp-compare__row').count(), 0, 'a second Escape closes the picker')
assert.equal(await page.evaluate(() => document.querySelectorAll('[data-gp-overlay]').length), 0, 'nothing is left behind')

// ── the revision picker: commits, and no heading for a single group ───────
await runRowEntry(page, 'README.md', 'compare-revision')
await page.waitForSelector('.gp-compare__row', { timeout: 5000 })
const revisions = await page.evaluate(() => ({
  title: document.querySelector('.gp-modal--picker .gp-modal__path')?.textContent ?? '',
  headings: document.querySelectorAll('.gp-compare__heading').length,
  placeholder: document.querySelector('.gp-compare__filter')?.getAttribute('placeholder') ?? '',
  rows: [...document.querySelectorAll('.gp-compare__row--commit')].map((row) => ({
    subject: row.querySelector('.gp-compare__label')?.textContent ?? '',
    hash: row.querySelector('.gp-compare__meta .gp-compare__hash')?.textContent ?? '',
    author: row.querySelector('.gp-compare__author')?.textContent ?? '',
    when: (row.querySelector('.gp-compare__when')?.textContent ?? '') !== '',
  })),
}))
assert.equal(revisions.title, '与修订版本比较', 'the title carries no trailing ellipsis')
assert.equal(revisions.headings, 0, 'a single-group list carries no heading')
assert.match(revisions.placeholder, /提交/, 'the filter talks about commits, not branches')
assert.deepEqual(revisions.rows, [
  { subject: 'first commit', hash: 'aaaaaaa', author: 'A', when: true },
  { subject: 'second commit', hash: 'bbbbbbb', author: 'A', when: true },
], 'a commit row: subject on top, then short hash, author and relative time')
// A short hash narrows the commits too.
await page.keyboard.type('bbbb')
await page.waitForTimeout(80)
assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.gp-compare__row--commit .gp-compare__label')].map((el) => el.textContent)), ['second commit'])
// The list is HEAD-only: a revision comparison is about this line of work.
const revisionQuery = await page.evaluate(() => window.__queries.filter((q) => q.kind === 'history').pop())
assert.equal(revisionQuery.ref, 'HEAD')
assert.equal(revisionQuery.exactPath, 'README.md')
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// ── the file-history chip vs the other filters ────────────────────────────
// The chip and the author / text / since filters are exclusive on the wire: the
// host refuses a request that carries both, so picking an author while the chip
// is up must drop the chip instead of turning the page into an error.
await runRowEntry(page, 'README.md', 'show-history')
await page.waitForTimeout(400)
const chipShown = await page.evaluate(() => document.querySelectorAll('.gp-chip--filter').length)
assert.ok(chipShown > 0, 'the history chip is shown')
const chipQuery = await page.evaluate(() => window.__queries.filter((q) => q.kind === 'history').pop())
assert.equal(chipQuery.exactPath, 'README.md', 'the page is filtered to the file')

// Typing in the search box is the same write path as picking an author: the
// debounce publishes text and must drop the chip, or the next page asks the host
// for a combination it rejects.
await page.locator('.gp-search').fill('fix')
await page.waitForTimeout(600)
const afterSearch = await page.evaluate(() => window.__queries.filter((q) => q.kind === 'history').pop())
assert.equal(afterSearch.exactPath, undefined, 'the chip is dropped when another filter takes over')
assert.equal(afterSearch.search, 'fix', 'the text filter is sent')
assert.equal(await page.locator('.gp-chip--filter').count(), 0, 'the chip is gone')
assert.equal(await page.locator('.gp-empty').filter({ hasText: '失败' }).count(), 0, 'the history page is not an error')

// The same file can be asked about again afterwards: the request is an edge
// (a sequence), not a sticky path, so re-opening it filters again. A fresh panel
// keeps this free of tab-navigation state.
await boot(page, CAPS, COMMITS.length)
await runRowEntry(page, 'README.md', 'show-history')
await page.waitForTimeout(400)
const chipAgain = await page.evaluate(() => window.__queries.filter((q) => q.kind === 'history').pop())
assert.equal(chipAgain.exactPath, 'README.md', 'the chip comes back for a second request of the same file')
assert.equal(await page.locator('.gp-chip--filter').count(), 1)

// ── the commit row's checkout entry ───────────────────────────────────────
// Offered only on a host that declares `capabilities.commitCheckout`; like the
// other writes it opens the existing confirmation, and the detach runs only
// once that is answered.
await boot(page, CAPS, COMMITS.length)
await page.locator('.gp-tabbar [role="tab"]', { hasText: '总览' }).click()
await page.waitForTimeout(500)
await page.evaluate(() => { window.__menuStub.clear() })
await page.locator('.gp-commit-row').first().click({ button: 'right' })
await page.evaluate(() => window.__menuStub.resolvePending())
await page.waitForTimeout(150)
const commitOffered = await page.evaluate(() => window.__menuStub.state.offered.map((a) => a.id))
assert.ok(commitOffered.includes('checkout'), `a capable host offers the checkout entry (offered: ${commitOffered.join(', ')})`)
await page.evaluate(() => window.__menuStub.invoke('checkout'))
await page.waitForSelector('.gp-modal__confirmtext', { timeout: 3000 })
assert.equal(await page.evaluate(() => window.__runs.length), 0, 'the entry only opens the confirmation')
await page.locator('.gp-modal__footer button').last().click()
await page.waitForTimeout(300)
const checkoutRun = await page.evaluate(() => window.__runs.filter((a) => a.kind === 'commit-checkout'))
assert.equal(checkoutRun.length, 1, 'answering the confirmation runs the detach')
assert.equal(checkoutRun[0].commit, 'a'.repeat(40), 'the run names the row it was opened from')

// ── capability gating ─────────────────────────────────────────────────────
// An old host declares nothing; the entries must be absent rather than offered
// and failing (an old host reads an unknown `base` as a work-tree diff). A fresh
// page keeps this independent of the panel booted above.
const oldPage = await browser.newPage({ viewport: { width: 900, height: 700 } })
oldPage.on('pageerror', (error) => errors.push('PAGEERROR ' + error.message))
await oldPage.goto(harness)
await oldPage.addScriptTag({ path: resolve(DIR, 'client.js') })
await oldPage.evaluate((root) => { window.__fixtureRoot = root }, ROOT)
await boot(oldPage, null, COMMITS.length)
await oldPage.evaluate(() => { window.__menuStub.clear() })
await oldPage.locator('.gp-files__tree .gp-files__entry', { hasText: 'README.md' }).click({ button: 'right' })
await oldPage.evaluate(() => window.__menuStub.resolvePending())
await oldPage.waitForTimeout(150)
const oldHostOffered = await oldPage.evaluate(() => window.__menuStub.state.offered.map((a) => a.id))
assert.ok(!oldHostOffered.includes('compare-ref'), 'no ref comparison on a host without the capability')
assert.ok(!oldHostOffered.includes('compare-revision'), 'no revision comparison either')
assert.ok(!oldHostOffered.includes('show-history'), 'no file history either')

assert.ok(oldHostOffered.includes('quote-path'), 'the browser entries stay')
await oldPage.close()

assert.deepEqual(errors, [], 'no page errors')
await browser.close()
console.log('compare-history e2e: ok')
