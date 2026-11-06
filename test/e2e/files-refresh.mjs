/**
 * Files-tab refresh, in the top status bar.
 *
 * Locks the parts of the control that the happy-path runner cannot see:
 *  - it sits in the status bar above the tree (beside the absolute browse
 *    root), outside the scrolling column: it never covers a file row and does
 *    not move when the entries scroll;
 *  - one refresh re-lists every open directory and re-reads the selected file
 *    exactly once, keeps the old rows/content on screen while it is in flight,
 *    and shows the busy state on the button;
 *  - a listing that was already in flight when the user refreshed cannot
 *    overwrite the refreshed one when it lands later.
 *
 * The mock snapshots each directory listing when the request arrives, so a
 * parked response is a genuine old snapshot rather than a re-read of the
 * current tree.
 */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const E2E = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(E2E, 'harness.html')
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f7f8fa;
--dsw-alias-bg-layer-3:#fff;--dsw-alias-bg-module-platform:#e9eaec;
--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
#panel{border:0!important}`

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: '44638f7', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()

async function boot(page, opts = {}) {
  await page.goto(harness)
  await page.addStyleTag({ content: THEME })
  await page.addScriptTag({ path: resolve(E2E, 'client.js') })
  await page.evaluate(async ({ snap, parkRoot }) => {
    const ctl = {
      // Enough root entries that the tree overflows and can scroll.
      tree: {
        '': [['docs', true], ['a.txt', false], ['README.md', false],
          ...Array.from({ length: 30 }, (_, i) => [`file-${String(i).padStart(2, '0')}.txt`, false])],
        docs: [['guide.md', false]],
      },
      files: { 'a.txt': 'const x = 1\n', 'README.md': '# readme\n', 'docs/guide.md': 'guide\n' },
      dirCalls: [], fileCalls: [],
      holdAll: false, holders: [],
      parkRoot, releaseRoot: null,
    }
    window.__ctl = ctl
    const listing = (path) => (ctl.tree[path] ?? []).map(([name, dir]) => dir ? { name, dir } : { name, dir, size: 12 })
    const connection = { rpc: { call: async (_channel, endpoint, payload) => {
      const request = payload && payload.args && payload.args.request
      if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
      if (endpoint === 'dbGitPanel/query') {
        const q = request.query
        if (q.kind === 'dir-list') {
          ctl.dirCalls.push(q.path)
          // Snapshot before parking: a delayed answer must carry the listing as
          // it was when the request arrived, not a fresh re-read.
          const entries = listing(q.path)
          if (ctl.holdAll) await new Promise((r) => ctl.holders.push(r))
          if (ctl.parkRoot && q.path === '') {
            ctl.parkRoot = false
            await new Promise((r) => { ctl.releaseRoot = r })
          }
          return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries } } }
        }
        if (q.kind === 'file-content') {
          const content = ctl.files[q.path] ?? ''
          ctl.fileCalls.push(q.path)
          if (ctl.holdAll) await new Promise((r) => ctl.holders.push(r))
          return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content, lines: content.split('\n').length - 1, size: content.length } } }
        }
        if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: '44638f7' }], remote: [] } } }
        if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
        if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
        if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 0, commits: [] } } }
        if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
      }
      if (endpoint === 'dbGitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
      if (endpoint === 'dbGitPanel/version') return { ok: true, value: { current: '1.8.1', repositoryUrl: '', updateAvailable: false, checkedRemote: false } }
      return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
    } } }
    const registered = {}
    const dictionaries = {}
    const ctx = {
      get: (key) => ({ connection })[key],
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: () => () => {},
      inject: (_deps, cb) => cb(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict },
        bind: (ns) => (key, params) => {
          const text = dictionaries[ns]?.zh?.[key] ?? key
          return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
        },
      },
    }
    window.__getLoaded().apply(ctx)
    await new Promise((r) => setTimeout(r, 300))
    const host = document.getElementById('panel')
    host.style.width = '960px'
    host.style.height = '640px'
    window.ReactDOM.createRoot(host).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 500))
  }, { snap: SNAP, parkRoot: opts.parkRoot === true })
}

const openFiles = async (page) => {
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.gp-tabbar [role="tab"]')].find((t) => (t.textContent || '').includes('文件'))?.click()
  })
  await page.waitForTimeout(400)
}

const expandDocsAndSelect = async (page) => {
  await page.evaluate(async () => {
    const dir = [...document.querySelectorAll('.gp-files__tree .gp-files__entry--dir')]
      .find((r) => (r.getAttribute('aria-label') || '').trim() === 'docs')
    dir?.click()
    await new Promise((r) => setTimeout(r, 250))
    const file = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')]
      .find((r) => (r.textContent || '').trim() === 'a.txt')
    file?.click()
    await new Promise((r) => setTimeout(r, 250))
  })
}

const errors = []
const watch = (page) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
}

// ── Status-bar layout, scroll behaviour, in-flight state ──────────────────
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } })
watch(page)
await boot(page)
await openFiles(page)
await expandDocsAndSelect(page)

const layout = await page.evaluate(() => {
  const btn = document.querySelector('.gp-files__refresh')
  const bar = document.querySelector('.gp-files__statusbar')
  const wrap = document.querySelector('.gp-files__tree-wrap')
  const tree = document.querySelector('.gp-files__tree')
  const first = tree?.querySelector('.gp-tree-row')
  const b = btn?.getBoundingClientRect()
  const f = first?.getBoundingClientRect()
  return {
    position: btn ? getComputedStyle(btn).position : null,
    inBar: !!(bar && btn && bar.contains(btn)),
    // The bar is the tree column's own header — inside the column, not a
    // full-width row on top of the page.
    barInTree: !!(bar && wrap && wrap.contains(bar)),
    // DOCUMENT_POSITION_FOLLOWING (4): the bar stands above the scrolling rows.
    precedesRows: !!(bar && tree && (bar.compareDocumentPosition(tree) & 4) !== 0),
    pathShown: (bar?.querySelector('.gp-files__status-code')?.textContent ?? '') !== '',
    paddingRight: bar === null ? null : getComputedStyle(bar).paddingRight,
    // direction:rtl is what makes the path elide from the left (tail kept).
    pathDirection: bar === null || bar.querySelector('.gp-files__status-body') === null
      ? null
      : getComputedStyle(bar.querySelector('.gp-files__status-body')).direction,
    overlapsFirstRow: !!(b && f && b.left < f.right && b.right > f.left && b.top < f.bottom && b.bottom > f.top),
    scrollable: tree ? tree.scrollHeight > tree.clientHeight : false,
  }
})
assert.equal(layout.position, 'static', 'the refresh control sits in the status bar instead of floating over the entries')
assert.equal(layout.inBar, true, 'it lives in the status bar')
assert.equal(layout.paddingRight, '5px', 'the bar gives the refresh control 5px of right padding')
assert.equal(layout.pathDirection, 'rtl', 'the path elides from the left so its tail stays on screen')
assert.equal(layout.barInTree, true, 'the status bar is the tree column header, not a full-width row on top of the page')
assert.equal(layout.precedesRows, true, 'the status bar stands above the scrolling entries')
assert.equal(layout.pathShown, true, 'the bar also names the absolute browse root')
assert.equal(layout.overlapsFirstRow, false, 'the first file row is no longer covered by the control')
assert.equal(layout.scrollable, true, 'fixture tree is tall enough to scroll')

const scroll = await page.evaluate(() => {
  const tree = document.querySelector('.gp-files__tree')
  const btn = document.querySelector('.gp-files__refresh')
  const before = btn.getBoundingClientRect().top
  tree.scrollTop = 160
  return { moved: tree.scrollTop, before, after: btn.getBoundingClientRect().top }
})
assert.ok(scroll.moved > 0, 'fixture tree actually scrolls')
assert.equal(Math.round(scroll.after), Math.round(scroll.before), 'the control stays put while the entries scroll under it')

const pre = await page.evaluate(() => ({
  dirs: window.__ctl.dirCalls.length, files: window.__ctl.fileCalls.length,
  rows: document.querySelectorAll('.gp-files__tree .gp-tree-row').length,
  code: document.querySelector('.gp-files__code')?.textContent ?? '',
}))
await page.evaluate(() => {
  const ctl = window.__ctl
  ctl.holdAll = true
  ctl.tree[''].push(['fresh.txt', false])
  ctl.files['a.txt'] = 'const x = 42\n'
  document.querySelector('.gp-files__tree').scrollTop = 0
  const btn = document.querySelector('.gp-files__refresh')
  btn.click(); btn.click(); btn.click()
})
await page.waitForFunction(() => window.__ctl.holders.length >= 3)
const during = await page.evaluate((pre) => {
  const btn = document.querySelector('.gp-files__refresh')
  return {
    disabled: btn.disabled,
    ariaBusy: btn.getAttribute('aria-busy'),
    busyClass: btn.classList.contains('gp-files__refresh--busy'),
    spin: getComputedStyle(btn.querySelector('svg')).animationName,
    rows: document.querySelectorAll('.gp-files__tree .gp-tree-row').length,
    fresh: (document.querySelector('.gp-files__tree')?.textContent || '').includes('fresh.txt'),
    code: document.querySelector('.gp-files__code')?.textContent ?? '',
    dirs: window.__ctl.dirCalls.length - pre.dirs,
    files: window.__ctl.fileCalls.length - pre.files,
  }
}, pre)
assert.equal(during.disabled, true, 'the control is disabled while the refresh runs')
assert.equal(during.ariaBusy, 'true', 'the control reports aria-busy while the refresh runs')
assert.equal(during.busyClass, true, 'the control carries its busy class while the refresh runs')
assert.equal(during.spin, 'gp-spin', 'the glyph spins while the refresh runs')
assert.equal(during.rows, pre.rows, 'the old listing stays on screen while the refresh runs (no blanking)')
assert.equal(during.fresh, false, 'the new entry only appears when the listing lands')
assert.ok(during.code.includes('const x = 1'), 'the old file content stays on screen while the re-read runs')
// Three rapid clicks must still issue exactly one refresh batch: root + docs.
assert.equal(during.dirs, 2, 'one refresh re-lists the root and the expanded directory once each')
assert.equal(during.files, 1, 'one refresh re-reads the selected file once')

await page.evaluate(() => {
  const holders = window.__ctl.holders
  window.__ctl.holders = []
  for (const release of holders) release()
})
await page.waitForFunction(() => {
  const btn = document.querySelector('.gp-files__refresh')
  return btn !== null && !btn.disabled && (document.querySelector('.gp-files__tree')?.textContent || '').includes('fresh.txt')
}, null, { timeout: 3000 })
const after = await page.evaluate(() => ({
  disabled: document.querySelector('.gp-files__refresh').disabled,
  ariaBusy: document.querySelector('.gp-files__refresh').getAttribute('aria-busy'),
  fresh: (document.querySelector('.gp-files__tree')?.textContent || '').includes('fresh.txt'),
  rows: document.querySelectorAll('.gp-files__tree .gp-tree-row').length,
  code: document.querySelector('.gp-files__code')?.textContent ?? '',
}))
assert.equal(after.fresh, true, 'the refreshed listing replaces the old one')
assert.equal(after.rows, pre.rows + 1, 'the new root entry is rendered')
assert.ok(after.code.includes('const x = 42'), 'the refreshed file content is rendered')
assert.equal(after.disabled, false, 'the control re-enables once the refresh settles')
assert.equal(after.ariaBusy, 'false', 'aria-busy clears once the refresh settles')
await page.close()

// ── A listing already in flight cannot overwrite the refreshed one ─────────
// Open the tab while the first root listing is parked, refresh (the second
// listing carries fresh.txt and lands first), then release the old listing.
// It must be dropped, not painted over the refreshed tree.
const race = await browser.newPage({ viewport: { width: 1000, height: 720 } })
watch(race)
await boot(race, { parkRoot: true })
await openFiles(race)
await race.waitForFunction(() => window.__ctl.releaseRoot !== null)
await race.evaluate(() => { window.__ctl.tree[''].push(['fresh.txt', false]) })
await race.evaluate(() => document.querySelector('.gp-files__refresh').click())
await race.waitForFunction(() => (document.querySelector('.gp-files__tree')?.textContent || '').includes('fresh.txt'), null, { timeout: 3000 })
const raceDuring = await race.evaluate(() => ({
  dirs: window.__ctl.dirCalls.filter((p) => p === '').length,
  disabled: document.querySelector('.gp-files__refresh').disabled,
  rows: document.querySelectorAll('.gp-files__tree .gp-tree-row').length,
}))
assert.equal(raceDuring.dirs, 2, 'the refresh listed the root again while the first listing was still in flight')
assert.equal(raceDuring.disabled, false, 'the refresh settled before the old listing is released')
await race.evaluate(() => {
  const release = window.__ctl.releaseRoot
  window.__ctl.releaseRoot = null
  release?.()
})
await race.waitForTimeout(200)
const raceAfter = await race.evaluate(() => ({
  fresh: (document.querySelector('.gp-files__tree')?.textContent || '').includes('fresh.txt'),
  rows: document.querySelectorAll('.gp-files__tree .gp-tree-row').length,
}))
assert.equal(raceAfter.fresh, true, 'a stale listing that lands last does not overwrite the refreshed tree')
assert.equal(raceAfter.rows, raceDuring.rows, 'the refreshed listing keeps its rows')
await race.close()

assert.deepEqual(errors, [], 'no console or page errors')
await browser.close()
console.log(JSON.stringify({ layout, scroll, during, after, raceDuring, errors }, null, 2))
console.log('e2e files-refresh.mjs: PASS')
