/**
 * Review capture: compact Git-overview history toolbar at phone widths. The
 * branch pill, search box and the more-toggle must share one height and one row;
 * the author / since / refresh group is collapsed behind the chevron by default
 * and takes the second row once expanded. Run setup.mjs first.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(DIR, '../../docs/local/review')
const harness = 'file://' + resolve(DIR, 'harness.html')
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;
--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
--dsw-alias-label-caption:#81858c;--dsw-alias-bg-module-platform:#f2f3f5;
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

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

await page.evaluate(async (snap) => {
  const entry = window.__getLoaded()
  const connection = {
    rpc: {
      call: async (_c, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
        if (endpoint === 'gitPanel/query') {
          const q = request.query
          if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: 'main', local: [{ name: 'main', shortHash: '44638f7' }, { name: 'feature/x', shortHash: 'de54fc0' }], remote: [] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: ['「疯狂的 dabbing」', 'xbzbing'] } } }
          if (q.kind === 'history') {
            const now = new Date().toISOString()
            return { ok: true, value: { ok: true, value: { kind: 'history', total: 2, commits: [
              { hash: '44638f7abc', shortHash: '44638f7', subject: '疯狂的 dabbing', author: 'xbzbing', dateIso: now, parents: ['de54fc0abc'], refs: [{ kind: 'branch', name: 'main', head: true }] },
              { hash: 'de54fc0abc', shortHash: 'de54fc0', subject: 'feat: something', author: 'xbzbing', dateIso: now, parents: [], refs: [] },
            ] } } }
          }
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: q.ref, shortHash: q.ref.slice(0, 7), subject: 'x', author: 'xbzbing', dateIso: new Date().toISOString() }, body: '', stats: [{ path: 'src/client/OverviewTab.tsx', status: 'modified' }, { path: 'src/client/styles.ts', status: 'modified' }], insertions: 27, deletions: 2 } } }
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
  await new Promise((r) => setTimeout(r, 600))
  const panelHost = document.getElementById('panel')
  panelHost.style.width = '390px'
  window.ReactDOM.createRoot(panelHost).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 700))
  window.__panelHost = panelHost
  // Clean repo lands on the overview; make sure the history tab is active.
  const tab = [...document.querySelectorAll('.gp-tabbar [role="tab"]')].find((t) => (t.textContent || '').includes('总览'))
  if (tab && !document.querySelector('.gp-overview')) { tab.click(); await new Promise((r) => setTimeout(r, 600)) }
  window.__readToolbar = () => {
    const tb = document.querySelector('.gp-history .gp-toolbar')
    const read = (n) => n === null ? null : (() => { const b = n.getBoundingClientRect(); return { h: Math.round(b.height), top: Math.round(b.top) } })()
    return {
      filter: read(tb?.querySelector('.gp-btn')),
      search: read(tb?.querySelector('.gp-search')),
      toggle: read(tb?.querySelector('.gp-toolbar__more-toggle')),
      more: read(tb?.querySelector('.gp-toolbar__more')),
      triggers: [...(tb?.querySelectorAll('.gp-select-trigger:not(.gp-search-scope__trigger)') ?? [])].map((n) => read(n)),
      overflowX: tb ? tb.scrollWidth > tb.clientWidth + 1 : null,
      barH: tb ? Math.round(tb.getBoundingClientRect().height) : null,
    }
  }
}, SNAP)

const report = {}
for (const width of [390, 304]) {
  await page.evaluate((w) => { window.__panelHost.style.width = w + 'px' }, width)
  await page.waitForTimeout(300)
  report[width] = { collapsed: await page.evaluate(() => window.__readToolbar()) }
  await page.locator('.gp-history .gp-toolbar').screenshot({ path: resolve(OUT, `ov-toolbar-${width}-collapsed.png`) })
  await page.evaluate(() => document.querySelector('.gp-toolbar__more-toggle')?.click())
  await page.waitForTimeout(250)
  report[width].expanded = await page.evaluate(() => window.__readToolbar())
  await page.locator('.gp-history .gp-toolbar').screenshot({ path: resolve(OUT, `ov-toolbar-${width}-expanded.png`) })
  await page.evaluate(() => document.querySelector('.gp-toolbar__more-toggle')?.click())
  await page.waitForTimeout(250)
}

// Compact commit-detail ops: low-frequency actions sit at the compact control
// height instead of the touch 36px pill height.
await page.evaluate(() => { window.__panelHost.style.width = '304px' })
await page.waitForTimeout(250)
report.detailOps = await page.evaluate(async () => {
  document.querySelector('.gp-commit-row')?.click()
  await new Promise((r) => setTimeout(r, 450))
  const btns = [...document.querySelectorAll('.gp-detail__actions .gp-btn')]
  return { count: btns.length, heights: btns.map((b) => Math.round(b.getBoundingClientRect().height)) }
})
await page.locator('.gp-detail__ops').screenshot({ path: resolve(OUT, 'ov-detail-ops-304.png') })
// The drill-in back button shares the 30px compact control height.
report.detailBack = await page.evaluate(() => {
  const b = document.querySelector('.gp-overview--compact .gp-subhead__back')
  return b === null ? null : { h: Math.round(b.getBoundingClientRect().height), label: (b.textContent || '').trim() }
})
await page.locator('.gp-overview--compact .gp-subhead').screenshot({ path: resolve(OUT, 'ov-detail-head-304.png') })

// Same header at the common phone width (390px): back button + change summary
// share one row, the repeated short hash is gone, and the row still fits.
await page.evaluate(() => { window.__panelHost.style.width = '390px' })
await page.waitForTimeout(300)
report.detailHead390 = await page.evaluate(() => {
  const head = document.querySelector('.gp-overview--compact .gp-subhead')
  const box = (n) => n === null ? null : (() => { const b = n.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), right: Math.round(b.right) } })()
  const sum = head === null ? null : head.querySelector('.gp-detail__summary--inline')
  return {
    hashInHead: head === null ? null : head.querySelector('.gp-commit-hash') !== null,
    back: box(head === null ? null : head.querySelector('.gp-subhead__back')),
    head: box(head),
    summary: box(sum),
    summaryText: (sum?.textContent || '').trim(),
    overflow: head === null ? null : head.scrollWidth > head.clientWidth + 1,
  }
})
await page.locator('.gp-overview--compact .gp-subhead').screenshot({ path: resolve(OUT, 'ov-detail-head-390.png') })
await page.locator('.gp-overview--compact .gp-detail').screenshot({ path: resolve(OUT, 'ov-detail-pane-390.png') })

console.log(JSON.stringify(report, null, 2))
if (errors.length) console.log('CONSOLE ERRORS:', errors)
await browser.close()
