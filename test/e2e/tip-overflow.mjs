/**
 * Files status bar's hover tip must stay inside its own bubble.
 *
 * The bubble is `width:max-content` clamped by `max-width`: the line is laid out
 * at its max-content width and the clamp then shrinks the box around it, so a
 * browse root wider than the tip's cap painted its tail (`…/antis-`) outside the
 * rounded edge while the box itself measured fine. The regression only shows up
 * past the cap — a short fixture root never reproduces it — so the fixture is a
 * real-looking absolute path, and the assertion is on the laid-out line boxes,
 * not just on `clientWidth` (a clipped line keeps the box size).
 *
 * Run setup.mjs first.
 */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')
const LONG_ROOT = '/Users/ankh/workspace/baidu/passport/antis-online/src/main/resources/static'
// The harness carries no platform stylesheet, so the fixture states the font the
// real panel inherits: the wrap only overflows at the UI font's metrics, and the
// default serif is narrow enough to hide it.
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;
--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
#panel{border:0!important}`

const SNAP = {
  root: LONG_ROOT, branch: 'main', head: 'de54fc0', unborn: false, dirty: true,
  staged: 0, modified: 1, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' },
  lastCommit: null,
  changes: [{ path: 'a.txt', status: 'modified', staged: false, isDirectory: false }],
  stats: { fileCount: 1, staged: 0, modified: 1, untracked: 0, insertions: 1, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(DIR, 'client.js') })
await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })

const mounted = await page.evaluate(async ({ snap, width }) => {
  const settle = async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await new Promise((r) => setTimeout(r, 60))
  }
  const { connection } = window.createGitPanelMock(snap)
  const entry = window.__getLoaded()
  const registered = {}
  const configState = { fontDelta: 0, showInputPill: true }
  const services = {
    connection,
    configForms: {
      describe: () => ({
        getSnapshot: () => ({ status: 'ready', view: { namespaces: [{ ns: 'dbGitPanel', schema: { dict: { showInputPill: {} } } }] }, revision: 0, writable: true }),
        subscribe: () => () => {},
        ensure: async () => {},
      }),
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: { ...configState }, revision: 0, writable: true }),
        subscribe: () => () => {},
        set: async (field, value) => { configState[field] = value; return true },
      }),
    },
  }
  const ctx = {
    get: (k) => services[k],
    effect: (cb) => { try { cb() } catch { /* the harness has no fiber */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: { inject: (name, provider) => provider(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
    locale: { register: () => () => {}, bind: () => (key) => key },
  }
  entry.apply(ctx)

  const host = document.getElementById('panel')
  host.style.width = width + 'px'
  const ReactDOM = window.ReactDOM
  const viewEntry = registered['conversation.view']
  const panelElement = viewEntry.component({ sessionId: 'sess-1' })
  ReactDOM.createRoot(host).render(window.React.createElement(panelElement.type, panelElement.props))
  await settle()

  const filesTab = [...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => (t.textContent || '').includes('tab.files'))
  if (filesTab === undefined) return { error: 'no files tab' }
  filesTab.click()
  await settle()
  await settle()
  // The tip node rides the preview card, so the tree has to show a file first.
  const row = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('a.txt'))
  if (row === undefined) return { error: 'no file row' }
  row.click()
  await settle()
  await settle()
  return { ok: document.querySelector('.gp-files__status-path') !== null }
}, { snap: SNAP, width: 620 })

assert.equal(mounted.error, undefined, `the fixture did not reach its hover target: ${mounted.error}`)
assert.equal(mounted.ok, true, 'the files status path is rendered')

await page.locator('.gp-files__status-path').hover()
await page.waitForTimeout(320)

const tip = await page.evaluate(() => {
  const el = document.querySelector('div.gp-tip.gp-tip--sb')
  if (el === null) return null
  const box = el.getBoundingClientRect()
  const range = document.createRange()
  range.selectNodeContents(el)
  const style = getComputedStyle(el)
  const paddingLeft = Number.parseFloat(style.paddingLeft)
  const paddingRight = Number.parseFloat(style.paddingRight)
  return {
    width: box.width,
    left: box.left,
    right: box.right,
    text: el.textContent,
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    paddingLeft,
    paddingRight,
    lines: [...range.getClientRects()].map((r) => ({ left: r.left, right: r.right })),
    panel: (() => { const p = document.querySelector('.gp-panel')?.getBoundingClientRect(); return p === null || p === undefined ? null : { left: p.left, right: p.right } })(),
  }
})

assert.notEqual(tip, null, 'hovering the status path raises its tip')
assert.equal(tip.text, LONG_ROOT, 'the tip carries the whole browse root')
assert.ok(tip.width <= 260.5, `the tip keeps its default cap (measured ${tip.width})`)
// The bubble's border box is the painted panel; a line may not leave it, and
// the horizontal scroll range is the cheap proxy for the same fact.
assert.ok(
  tip.scrollWidth <= tip.clientWidth + 1,
  `the text wraps inside the bubble instead of overflowing it (scroll ${tip.scrollWidth} > client ${tip.clientWidth})`,
)
for (const line of tip.lines) {
  assert.ok(
    line.right <= tip.right - tip.paddingRight + 1,
    `every line ends inside the right padding (line ${Math.round(line.right)} vs edge ${Math.round(tip.right - tip.paddingRight + 1)})`,
  )
  assert.ok(
    line.left >= tip.left + tip.paddingLeft - 1,
    `every line starts inside the left padding (line ${Math.round(line.left)} vs edge ${Math.round(tip.left + tip.paddingLeft - 1)})`,
  )
}
assert.ok(tip.lines.length >= 2, 'the long path still wraps instead of shrinking the font')
if (tip.panel !== null) {
  assert.ok(tip.left >= tip.panel.left + 7, 'the tip stays inside the panel on the left')
  assert.ok(tip.right <= tip.panel.right - 7, 'the tip stays inside the panel on the right')
}
assert.deepEqual(errors, [], 'no console errors while raising the tip')

await browser.close()
console.log('tip-overflow: OK')
