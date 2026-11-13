/**
 * Files tree package mode: the host projects `src/main/java` into one source
 * root and folds a package run into a dotted row. This drives the real panel
 * against a mock dir-list that only answers the projection when the client
 * sends the `packages` flag, so the request flag and the row geometry are both
 * pinned: the chain row must expand the *deepest* directory and the files
 * under it must indent one level below that row.
 */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;
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
  remote: null, lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 50, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(), compactPackages: true,
}

const CHAIN_PATH = 'src/main/java/com/example/demo'
const CHAIN_LABEL = 'com.example.demo'

// The same fixture in both shapes: the physical tree (what an old/misconfigured
// client would get) and the projected one. A missing `packages` flag must fall
// back to the physical rows, otherwise this runner would pass without proving
// the request carries the flag.
const PHYSICAL = { '': [['src', true]] }
const PACKED = {
  '': [
    ['src/main/java', true],
    ['pom.xml', false],
  ],
  'src/main/java': [
    ['com', true, { chain: { path: CHAIN_PATH, label: CHAIN_LABEL } }],
    ['META-INF', true],
  ],
  [CHAIN_PATH]: [['App.java', false]],
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

await page.evaluate(async ({ snap, physical, packed }) => {
  const requests = []
  const entry = window.__getLoaded()
  const connection = {
    rpc: {
      call: async (_c, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
        if (endpoint === 'dbGitPanel/query') {
          const q = request.query
          if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: '44638f7' }], remote: [] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 0, commits: [] } } }
          if (q.kind === 'dir-list') {
            requests.push({ path: q.path, packages: q.packages === true })
            const table = q.packages === true ? packed : physical
            const entries = (table[q.path] || []).map(([name, dir, extra]) => dir ? { name, dir, ...(extra ?? {}) } : { name, dir, size: 42 })
            return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries } } }
          }
          if (q.kind === 'file-content') return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: 'class App {}\n', lines: 1 } } }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
        }
        if (endpoint === 'dbGitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
        if (endpoint === 'dbGitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: false } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }
  const registered = {}
  const dictionaries = {}
  const ctx = {
    get: (k) => ({ connection })[k],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_d, cb) => cb(ctx),
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
  await new Promise((r) => setTimeout(r, 500))
  const panelHost = document.getElementById('panel')
  panelHost.style.width = '390px'
  window.ReactDOM.createRoot(panelHost).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 700))
  const tab = [...document.querySelectorAll('.gp-tabbar [role="tab"]')].find((t) => (t.textContent || '').includes('文件') || (t.textContent || '').includes('tab.files'))
  tab?.click()
  await new Promise((r) => setTimeout(r, 600))
  window.__requests = requests
  window.__snap = snap
  window.__setPackages = (value) => { snap.compactPackages = value }
  window.__row = (label) => [...document.querySelectorAll('.gp-files__tree .gp-files__entry')]
    .find((r) => (r.getAttribute('aria-label') || '').trim() === label || (r.textContent || '').trim() === label)
  window.__clickRow = async (label) => {
    window.__row(label)?.click()
    await new Promise((r) => setTimeout(r, 400))
  }
  window.__rowInfo = (label) => {
    const row = window.__row(label)
    if (row === undefined) return null
    return {
      label: (row.textContent || '').trim(),
      aria: (row.getAttribute('aria-label') || '').trim(),
      title: row.getAttribute('title'),
      pad: parseFloat(getComputedStyle(row).paddingLeft),
    }
  }
}, { snap: SNAP, physical: PHYSICAL, packed: PACKED })

const report = {}
report.sourceRow = await page.evaluate(() => window.__rowInfo('src/main/java'))
assert.notEqual(report.sourceRow, null, 'the projected source root is a row of its own')
assert.equal(report.sourceRow.label, 'src/main/java', 'the source root keeps its full path as the label')
assert.equal(report.sourceRow.pad, 8, 'the source root is a root-level row (8 + 0)')


await page.evaluate(() => window.__clickRow('src/main/java'))
report.chain = await page.evaluate(() => window.__rowInfo('com.example.demo'))
assert.notEqual(report.chain, null, 'the package run renders as one dotted row')
assert.equal(report.chain.label, CHAIN_LABEL, 'the row shows the dotted package name')
assert.equal(report.chain.title, CHAIN_PATH, 'the tooltip names the real directory the row expands')
assert.equal(report.chain.pad, 24, 'the folded row sits under the source root (8 + 16)')
assert.equal(await page.evaluate(() => window.__rowInfo('com')), null, 'no intermediate segment row is rendered')
assert.equal(await page.evaluate(() => window.__rowInfo('example')), null, 'no intermediate segment row is rendered')

await page.evaluate(() => window.__clickRow('com.example.demo'))
report.file = await page.evaluate(() => ({
  info: window.__rowInfo('App.java'),
  deepRequest: window.__requests.filter((r) => r.path === 'src/main/java/com/example/demo'),
}))
assert.notEqual(report.file.info, null, 'the folded row expands to the real directory')
assert.equal(report.file.info.label, 'App.java')
assert.equal(report.file.info.pad, 40, 'the file sits one level below the chain row (8 + 2*16)')
assert.ok(
  report.file.deepRequest.length === 1 && report.file.deepRequest[0].packages === true,
  `expanding the chain lists the deepest path with the packages flag (got ${JSON.stringify(report.file.deepRequest)})`,
)
assert.equal(await page.evaluate(() => window.__rowInfo('src')), null, 'the physical src row is not rendered in package mode')

report.roots = await page.evaluate(() => window.__requests.filter((r) => r.path === ''))
assert.equal(report.roots.length, 1, 'the root listing is requested once')
assert.equal(report.roots[0].packages, true, 'the root request carries the packages flag')

// ── the settings flip ────────────────────────────────────────────────────
// Turning the setting off must start the tree over from its root, ask for it
// without the packages flag, and show the physical `src` row — the three
// effects a regression would silently drop (the flip has no other trigger).
await page.evaluate(() => {
  window.__waitFor = async (probe, timeout = 4000) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      const value = probe()
      if (value) return value
      await new Promise((r) => setTimeout(r, 50))
    }
    return null
  }
})
await page.evaluate(() => window.__setPackages(false))
report.flipOff = await page.evaluate(async () => {
  const row = await window.__waitFor(() => window.__rowInfo('src'))
  return {
    row,
    roots: window.__requests.filter((r) => r.path === ''),
  }
})
assert.notEqual(report.flipOff.row, null, 'disabling the setting brings the physical src row back')
assert.equal(report.flipOff.roots.length, 2, 'the flip re-lists the root exactly once')
assert.notEqual(report.flipOff.roots[1].packages, true, 'the re-listed root drops the packages flag')

// And back on: the projection returns, again with one request.
await page.evaluate(() => window.__setPackages(true))
report.flipOn = await page.evaluate(async () => {
  const row = await window.__waitFor(() => window.__rowInfo('src/main/java'))
  return {
    row,
    src: window.__rowInfo('src'),
    roots: window.__requests.filter((r) => r.path === ''),
  }
})
assert.notEqual(report.flipOn.row, null, 'enabling the setting projects the source root again')
assert.equal(report.flipOn.src, null, 'the physical src row is gone again')
assert.equal(report.flipOn.roots.length, 3, 'the flip back re-lists the root exactly once')
assert.equal(report.flipOn.roots[2].packages, true, 'the re-listed root carries the packages flag again')

console.log('e2e files-package-tree.mjs: PASS', JSON.stringify(report))
if (errors.length) {
  console.log('CONSOLE ERRORS:', errors)
  process.exitCode = 1
}
await browser.close()
