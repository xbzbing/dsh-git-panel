/**
 * The stacked overview's bottom detail: the "N files +A −B" summary sticks to
 * the top of the scrolling file list AND its box sits flush there — at rest
 * and while stuck. Sticky pins the MARGIN box, so the bar must carry no
 * negative top margin: the old padding-compensation margin (-6px against the
 * container's 6px top padding) shifted the border box 6px below the scrollport,
 * opening a strip of rows that leaked above the bar during scroll and leaving
 * the bar 6px below the split edge at rest.
 *
 * The commit detail is mocked with 12 files so the list actually overflows the
 * pane — without overflow the sticky state can never engage.
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
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
  --dsw-alias-label-caption:#81858c;
  --dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
  --dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
  #panel{border:0!important;box-sizing:border-box}`

// Clean worktree: the panel lands on the overview tab by itself.
const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'ba78eb4', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, suggestEnabled: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 560, height: 980 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

await page.goto(harness)
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await page.addScriptTag({ path: resolve(E2E, 'client.js') })

await page.evaluate(async (snap) => {
  const { connection } = window.createGitPanelMock(snap)
  // 12-file commit detail: enough rows to overflow the pane, so scrolling has
  // somewhere to go and the sticky state is actually exercised.
  const inner = connection.rpc.call.bind(connection.rpc)
  connection.rpc.call = async (channel, endpoint, payload) => {
    const request = payload && payload.args && payload.args.request
    if (endpoint === 'gitPanel/query' && request != null && request.query != null && request.query.kind === 'show') {
      const q = request.query
      return { ok: true, value: { ok: true, value: {
        kind: 'show',
        ref: q.ref,
        commit: { hash: q.ref, shortHash: q.ref.slice(0, 7), subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString() },
        body: '',
        stats: Array.from({ length: 12 }, (_, i) => ({ path: `file${i + 1}.ts`, status: 'modified' })),
        insertions: 120,
        deletions: 30,
      } } }
    }
    return inner(channel, endpoint, payload)
  }

  const ctl = { registered: {}, sidebarTypes: [], openedTabs: [] }
  window.__ctl = ctl
  const settings = {
    view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {}, placement: {} } }, value: { showInputPill: true, placement: 'sidebar' } }] },
    status: 'ready',
  }
  const configForms = {
    describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
    get: () => ({
      getSnapshot: () => ({ status: 'ready', value: { showInputPill: true, placement: 'sidebar' }, revision: 0, writable: true }),
      subscribe: () => () => {},
      set: async () => true,
    }),
  }
  const sidebarTabs = {
    register: (definition) => {
      ctl.sidebarTypes.push(definition)
      return () => { const at = ctl.sidebarTypes.indexOf(definition); if (at !== -1) ctl.sidebarTypes.splice(at, 1) }
    },
  }
  const sidebarRight = { openTab: (kind) => { ctl.openedTabs.push(kind) } }

  const services = { connection, configForms, sidebarRightTabs: sidebarTabs, sidebarRight }
  const dictionaries = {}
  const ctx = {
    get: (key) => services[key],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (_name, provider) => provider(),
      register: (reg, component) => {
        const key = reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`
        ctl.registered[key] = { reg, component }
        return () => { delete ctl.registered[key] }
      },
    },
    locale: {
      register: (ns, dict) => { dictionaries[ns] = dict; return () => { delete dictionaries[ns] } },
      bind: (ns) => (key, params) => {
        const text = dictionaries[ns]?.zh?.[key] ?? dictionaries[ns]?.en?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  window.__getLoaded().apply(ctx)
  await new Promise((r) => setTimeout(r, 400))

  const entry = ctl.registered['sidebar.right.pane.tab::@xbzbing/dsh-git-panel']
  if (entry === undefined) throw new Error('sidebar body seat did not register')
  const host = document.getElementById('panel')
  host.style.width = '420px'
  host.style.height = '900px'
  window.ReactDOM.createRoot(host).render(entry.component({
    sessionId: 'sess-1',
    useTabInfo: () => ({ tab: { visible: true } }),
    t: (key) => key,
  }))
  await new Promise((r) => setTimeout(r, 800))

  window.__tab = async (index) => {
    const tabs = [...document.querySelectorAll('.gp-tabbar [role="tab"]')]
    tabs[index].click()
    await new Promise((r) => setTimeout(r, 700))
  }
}, SNAP)

const out = { errors }

// Overview, select a commit so the detail's file list fills the bottom pane.
await page.evaluate(async () => {
  await window.__tab(0)
  document.querySelector('.gp-commit-row')?.click()
  await new Promise((r) => setTimeout(r, 700))
})

// Geometry probe: the summary box's top against the scrollport's top edge.
const probe = () => page.evaluate(() => {
  const sum = document.querySelector('.gp-detail__summary')
  const files = document.querySelector('.gp-detail__files')
  if (sum === null || files === null) return null
  const s = sum.getBoundingClientRect()
  const f = files.getBoundingClientRect()
  const rows = [...files.querySelectorAll('.gp-tree-row')]
  return {
    position: getComputedStyle(sum).position,
    rowCount: rows.length,
    scrollable: files.scrollHeight > files.clientHeight,
    scrollTop: Math.round(files.scrollTop),
    // Border box top vs scrollport top: 0 = flush with the split edge.
    gap: Math.round((s.top - f.top) * 100) / 100,
    // Rows intersecting the strip between the scrollport's top edge and the
    // summary's top edge (the leak). A zero-height strip — flush — intersects
    // nothing, rows straddling the edge included: they pass behind the bar.
    stripRows: rows.filter((r) => {
      const b = r.getBoundingClientRect()
      return Math.max(b.top, f.top) < Math.min(b.bottom, s.top)
    }).length,
  }
})

out.rest = await probe()
assert.ok(out.rest !== null, 'the summary and its scrollport render')
assert.equal(out.rest.position, 'sticky', 'the summary is sticky')
assert.ok(out.rest.rowCount >= 12, `the 12-file detail rendered (${out.rest.rowCount} rows)`)
assert.ok(out.rest.scrollable, 'the file list overflows its pane — sticky has somewhere to engage')
assert.equal(out.rest.gap, 0, `at rest the summary's top is flush with the pane (gap ${out.rest.gap}px)`)

// Scroll: the bar must stay pinned flush, with no strip of rows above it.
// Half of the pane's real scroll extent, not a fixed pixel — row metrics
// differ per platform font, and a fixed target clamps below it on CI.
await page.evaluate(() => {
  const files = document.querySelector('.gp-detail__files')
  if (files !== null) files.scrollTop = Math.round((files.scrollHeight - files.clientHeight) / 2)
})
await page.waitForTimeout(150)
out.scrolled = await probe()
assert.ok(out.scrolled.scrollTop > 10, `the list really scrolled (${out.scrolled.scrollTop}px)`)
assert.equal(out.scrolled.gap, 0, `while stuck the summary stays flush (gap ${out.scrolled.gap}px)`)
assert.equal(out.scrolled.stripRows, 0, `no rows leak above the summary (saw ${out.scrolled.stripRows})`)

// Back to rest: the flush top is not a scroll-time coincidence.
await page.evaluate(() => {
  const files = document.querySelector('.gp-detail__files')
  if (files !== null) files.scrollTop = 0
})
await page.waitForTimeout(150)
out.back = await probe()
assert.equal(out.back.gap, 0, `after scrolling back the summary is still flush (gap ${out.back.gap}px)`)

assert.deepEqual(errors, [], 'no console errors')
console.log('e2e/stacked-detail-sticky: all assertions passed', JSON.stringify(out))
await browser.close()
