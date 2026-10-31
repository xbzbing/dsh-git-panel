/**
 * Tight stacked sidebar (≤ STACKED_TIGHT_BP): the top band's left column is a
 * drawer over the history.
 *
 * At 420 (stacked, not tight) the column stays inline — no drawer, no toolbar
 * toggle. At 320 (tight) it collapses by default: inert, retracted a full
 * width to the left so the history takes the whole band, and the toolbar's
 * branch toggle reports aria-expanded=false with an aria-controls that resolves
 * to it. Opening it slides the column in above the backdrop with focus on the
 * close button; Escape, a click on the blank band and the close button each
 * dismiss it — while a confirm dialog is up, one Escape closes only the
 * dialog. Widening back re-attaches the column inline.
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const E2E = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(E2E, 'harness.html')
const REVIEW_DIR = resolve(E2E, '../../docs/local/review')
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
const page = await browser.newPage({ viewport: { width: 480, height: 980 }, screen: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

await page.goto(harness)
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await page.addScriptTag({ path: resolve(E2E, 'client.js') })

// The seat boots at whatever width the caller asks: a panel can mount straight
// into the tight tier (no wider frame first), which is the only way to observe
// the drawer's default — a pass through a non-tight width resets the overlay
// state anyway (OverviewTab closes it when tight turns false).
const boot = (width) => page.evaluate(async ({ snap, w }) => {
  const { connection } = window.createGitPanelMock(snap)
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
  host.style.width = `${w}px`
  host.style.height = '900px'
  window.ReactDOM.createRoot(host).render(entry.component({
    sessionId: 'sess-1',
    useTabInfo: () => ({ tab: { visible: true } }),
    t: (key) => key,
  }))
  await new Promise((r) => setTimeout(r, 800))
}, { snap: SNAP, w: width })
await boot(420)

const out = {}
const probe = () => page.evaluate(() => {
  const drawer = document.querySelector('.gp-drawer')
  const toggle = document.querySelector('.gp-toolbar__branches')
  const backdrop = document.querySelector('.gp-drawer-backdrop')
  const top = document.querySelector('.gp-overview__top')
  const history = document.querySelector('.gp-history')
  const inline = document.querySelector('.gp-col--left:not(.gp-drawer)')
  const search = document.querySelector('.gp-search')
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  return {
    drawer: drawer === null ? null : {
      open: drawer.getAttribute('data-open'),
      inert: drawer.hasAttribute('inert'),
      transform: getComputedStyle(drawer).transform,
      // The retraction must equal the column's own width: any negative offset
      // (a 10px sliver included) still reads as "slides left" in the matrix.
      tx: (() => {
        const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(drawer).transform)
        return m === null ? 0 : Number(m[1].split(',')[4])
      })(),
      boxShadow: getComputedStyle(drawer).boxShadow,
      box: box(drawer),
      rows: drawer.querySelectorAll('.gp-branch-row').length,
      statusbar: drawer.querySelector('.gp-statusbar') !== null,
      repo: drawer.querySelector('a.gp-statusbar__repo') !== null,
      // Dialog contract: role / modal flag / labelled title / close label.
      role: drawer.getAttribute('role'),
      ariaModal: drawer.getAttribute('aria-modal'),
      label: (() => {
        const id = drawer.getAttribute('aria-labelledby')
        return id === null ? null : (document.getElementById(id)?.textContent ?? null)
      })(),
      closeLabel: drawer.querySelector('.gp-drawer__close')?.getAttribute('aria-label') ?? null,
    },
    toggle: toggle === null ? null : {
      expanded: toggle.getAttribute('aria-expanded'),
      focus: document.activeElement === toggle,
      box: box(toggle),
    },
    // The toggle and the search share one row: measured as overlapping vertical
    // bands, since a touch device grows the button taller than the input.
    toggleSharesRowWithSearch: toggle === null || search === null ? null : (() => {
      const t = toggle.getBoundingClientRect()
      const s = search.getBoundingClientRect()
      return t.top < s.bottom && s.top < t.bottom
    })(),
    controlsResolve: toggle === null ? false : document.getElementById(toggle.getAttribute('aria-controls')) === drawer,
    closeFocus: document.activeElement !== null && document.activeElement.classList.contains('gp-drawer__close'),
    backdrop: backdrop === null ? null : box(backdrop),
    inline: inline === null ? null : { position: getComputedStyle(inline).position, rows: inline.querySelectorAll('.gp-branch-row').length },
    top: top === null ? null : box(top),
    history: history === null ? null : box(history),
    searchBox: search === null ? null : box(search),
    repoHref: (document.querySelector('.gp-col--left a.gp-statusbar__repo, .gp-drawer a.gp-statusbar__repo')?.getAttribute('href')) ?? null,
  }
})
const setWidth = async (w) => {
  await page.evaluate((width) => { document.getElementById('panel').style.width = `${width}px` }, w)
  await page.waitForTimeout(350)
}
// Waits for the slide to finish instead of racing its 180ms transition: the
// transform is the thing under test, so sampling it mid-flight is a flake.
const settleDrawer = (open) => page.waitForFunction((want) => {
  const drawer = document.querySelector('.gp-drawer')
  if (drawer === null) return false
  const transform = getComputedStyle(drawer).transform
  return want ? transform === 'none' : transform !== 'none' && !transform.endsWith(', 0, 0)')
}, open, { timeout: 3000 })

// ── 420 (stacked, not tight): the column is inline — no drawer anywhere. ──
out.inline420 = await probe()
assert.equal(out.inline420.drawer, null, 'at 420 the left column is not a drawer')
assert.equal(out.inline420.toggle, null, 'at 420 there is no branch-drawer toggle')
assert.equal(out.inline420.backdrop, null, 'at 420 there is no drawer backdrop')
assert.ok(out.inline420.inline !== null, 'at 420 the left column renders inline')
assert.equal(out.inline420.inline.position, 'static', 'the inline column sits in the flex flow')
assert.ok(out.inline420.inline.rows > 0, `the branch list renders inline (${out.inline420.inline.rows} rows)`)
assert.equal(out.inline420.repoHref, 'https://github.com/example/repo', 'the inline status bar keeps the GitHub repo link')

// ── 320 (tight): collapsed by default, history takes the whole band. ──
await setWidth(320)
out.tight = await probe()
assert.ok(out.tight.drawer !== null, 'at 320 the left column becomes a drawer')
assert.equal(out.tight.drawer.open, 'false', 'the drawer is collapsed by default')
assert.equal(out.tight.drawer.inert, true, 'the collapsed drawer is inert')
assert.ok(out.tight.drawer.transform.startsWith('matrix(1, 0, 0, 1, -'), `the collapsed drawer is retracted to the left (${out.tight.drawer.transform})`)
// Exactly one column width: the drawer must not peek over the history, and a
// token retraction (the shape the loose prefix check would accept) would.
assert.ok(Math.abs(-out.tight.drawer.tx - out.tight.drawer.box.w) <= 1, `the retraction equals the drawer width (${out.tight.drawer.tx} vs ${out.tight.drawer.box.w}px)`)
assert.equal(out.tight.drawer.role, null, 'a collapsed drawer claims no dialog role')
assert.equal(out.tight.inline, null, 'no inline column remains beside the history')
assert.equal(out.tight.backdrop, null, 'a collapsed drawer leaves no backdrop')
assert.ok(out.tight.drawer.rows > 0, `the branch list lives inside the drawer (${out.tight.drawer.rows} rows)`)
assert.equal(out.tight.drawer.statusbar, true, 'the status bar moved into the drawer')
assert.ok(out.tight.drawer.box.w >= 180 && out.tight.drawer.box.w <= 260, `the drawer is clamp(180px,72%,260px) wide (${out.tight.drawer.box.w}px)`)
// A retracted drawer sits flush against x=0, so any side shadow would leak a
// visible band over the history even while closed.
assert.equal(out.tight.drawer.boxShadow, 'none', 'the collapsed drawer paints no shadow either')
assert.equal(out.tight.toggle.expanded, 'false', 'the toggle reports the collapsed state')
assert.equal(out.tight.controlsResolve, true, "the toggle's aria-controls resolves to the drawer")
assert.ok(Math.abs(out.tight.history.w - out.tight.top.w) <= 2, `the collapsed drawer leaves the history the whole band (${out.tight.history.w} vs ${out.tight.top.w}px)`)
// The toggle shares the toolbar's first row with the search box. Tested as
// overlapping vertical bands, not a centre-distance threshold: a wrapped row
// still sits within a few px of centre once the touch media query makes the
// button taller than the input, which is exactly how the two-row bug slipped
// past the old assertion.
assert.equal(out.tight.toggleSharesRowWithSearch, true, 'the toggle and the search share the toolbar row')
mkdirSync(REVIEW_DIR, { recursive: true })
await page.locator('.gp-panel').screenshot({ path: resolve(REVIEW_DIR, 'branch-drawer-320-collapsed.png') })

// ── Open: slides in above the backdrop, focus lands on the close button. ──
await page.click('.gp-toolbar__branches')
await settleDrawer(true)
out.open = await probe()
assert.equal(out.open.drawer.open, 'true', 'the toggle opens the drawer')
assert.equal(out.open.drawer.inert, false, 'the open drawer is interactive')
assert.equal(out.open.drawer.transform, 'none', "the open drawer sits flush at the band's left edge")
assert.equal(out.open.drawer.boxShadow, 'none', 'the drawer paints no side shadow over the history')
assert.equal(out.open.drawer.role, 'dialog', 'the open drawer is a dialog to assistive tech')
assert.equal(out.open.drawer.ariaModal, 'true', 'and declares itself modal over the band')
assert.equal(out.open.drawer.label, '按分支筛选', 'its accessible name is the visible title (zh)')
assert.equal(out.open.drawer.closeLabel, '关闭', 'the icon-only close button carries an aria-label')
assert.ok(out.open.backdrop !== null, 'opening lays a backdrop over the band')
assert.ok(Math.abs(out.open.backdrop.w - out.open.top.w) <= 2 && Math.abs(out.open.backdrop.h - out.open.top.h) <= 2, 'the backdrop covers exactly the top band')
assert.equal(out.open.toggle.expanded, 'true', 'the toggle reports the open state')
assert.equal(out.open.closeFocus, true, "focus lands on the drawer's close button")
assert.ok(Math.abs(out.open.drawer.box.x - out.open.top.x) <= 2, "the open drawer aligns with the band's left edge")
assert.ok(Math.abs(out.open.history.w - out.open.top.w) <= 2, `the open drawer overlays the history instead of pushing it (${out.open.history.w} vs ${out.open.top.w}px)`)
assert.equal(out.open.drawer.statusbar, true, 'the drawer carries the status bar')
assert.equal(out.open.drawer.repo, false, 'the tight status bar drops the GitHub repo link (narrow-panel rule)')
// Tab is contained: the drawer is the only tabbable surface while it is open,
// so a keyboard round never lands on the body or on the controls the backdrop
// covers (10 stops used to reach 5 of them).
const tabTrail = []
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('Tab')
  tabTrail.push(await page.evaluate(() => {
    const el = document.activeElement
    if (el === null || el === document.body) return 'body'
    const where = el.closest('.gp-drawer') === null ? 'outside' : 'drawer'
    return `${where}:${(el.className || el.tagName).toString().split(/\s+/)[0]}`
  }))
}
out.tabTrail = tabTrail
assert.equal(tabTrail.every((stop) => stop.startsWith('drawer:')), true, `Tab never leaves the open drawer (${tabTrail.join(' → ')})`)
await page.locator('.gp-panel').screenshot({ path: resolve(REVIEW_DIR, 'branch-drawer-320-open.png') })

// ── Escape dismisses it and returns focus to the toggle. ──
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
out.escaped = await probe()
assert.equal(out.escaped.drawer.open, 'false', 'Escape closes the drawer')
assert.equal(out.escaped.drawer.boxShadow, 'none', 'the shadow does not come back when the drawer retracts')
assert.equal(out.escaped.backdrop, null, 'Escape removes the backdrop')
assert.equal(out.escaped.toggle.focus, true, 'focus returns to the toggle')

// ── Reopen; a click on the blank band dismisses it. ──
await page.click('.gp-toolbar__branches')
await page.waitForTimeout(250)
const band = await page.locator('.gp-drawer-backdrop').boundingBox()
assert.ok(band !== null, 'the backdrop is measurable for the click')
await page.locator('.gp-drawer-backdrop').click({ position: { x: band.width - 16, y: 80 } })
await page.waitForTimeout(150)
out.scrimClick = await probe()
assert.equal(out.scrimClick.drawer.open, 'false', 'a click on the blank band closes the drawer')
assert.equal(out.scrimClick.backdrop, null, 'the backdrop goes with it')

// ── Reopen; the drawer's own close button dismisses it. ──
await page.click('.gp-toolbar__branches')
await page.waitForTimeout(250)
await page.click('.gp-drawer__close')
await page.waitForTimeout(150)
out.closedByButton = await probe()
assert.equal(out.closedByButton.drawer.open, 'false', 'the close button closes the drawer')
assert.equal(out.closedByButton.toggle.focus, true, 'focus returns to the toggle again')

// ── A confirm dialog above the drawer owns the first Escape. ──
await page.click('.gp-toolbar__branches')
await page.waitForTimeout(250)
await page.hover('.gp-drawer .gp-branch-row[title="feature"]')
await page.click('.gp-branch-row[title="feature"] .gp-branch-row__switch')
await page.waitForSelector('.gp-modal-backdrop', { timeout: 5000 })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
out.guard = await probe()
assert.equal(await page.$('.gp-modal-backdrop'), null, 'the first Escape closes the confirm dialog')
assert.equal(out.guard.drawer.open, 'true', "one keypress never dismisses the drawer together with the dialog")
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
out.guardNext = await probe()
assert.equal(out.guardNext.drawer.open, 'false', 'the next Escape, with no dialog up, closes the drawer')

// ── Widening past the breakpoint re-attaches the column inline. ──
await setWidth(420)
out.recovered = await probe()
assert.equal(out.recovered.drawer, null, 'widening drops the drawer markup')
assert.equal(out.recovered.toggle, null, 'the toolbar toggle goes with it')
assert.equal(out.recovered.backdrop, null, 'no backdrop survives the widening')
assert.ok(out.recovered.inline !== null, 'the column renders inline again')
assert.equal(out.recovered.inline.position, 'static', 'and back in the flex flow')
assert.equal(out.recovered.repoHref, 'https://github.com/example/repo', 'the widened status bar keeps the GitHub repo link')

// ── Booting straight into the tight tier: collapsed on the FIRST mount — the
//    default itself, not a reset inherited from a wider frame. ──
await page.reload()
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await page.addScriptTag({ path: resolve(E2E, 'client.js') })
await boot(320)
out.bootTight = await probe()
assert.ok(out.bootTight.drawer !== null, 'a panel that boots at a tight width renders the drawer')
assert.equal(out.bootTight.drawer.open, 'false', 'a drawer mounting at a tight width is collapsed by default')
assert.equal(out.bootTight.drawer.boxShadow, 'none', 'the first mount carries no shadow either')
assert.equal(out.bootTight.drawer.inert, true, 'and inert on its very first mount')
assert.ok(out.bootTight.toggle !== null, 'the toolbar toggle mounts with it')
assert.equal(out.bootTight.toggle.expanded, 'false', 'the toggle reports the collapsed state on the first mount too')

assert.deepEqual(errors, [], 'no console errors')
console.log('e2e/stacked-branch-drawer: all assertions passed', JSON.stringify(out))
await browser.close()

// ── Touch input on a desktop screen (touchscreen laptop): `(hover:none)` grows icon buttons
//    to 34px, so the toolbar row must still hold the toggle and the search. A
//    reserved-px budget sized to the desktop 28px button would wrap here. ──
const touchBrowser = await chromium.launch()
const touchPage = await touchBrowser.newPage({
  viewport: { width: 360, height: 900 }, hasTouch: true,
  // Desktop screen + touch input (a touchscreen laptop): stacked still applies,
  // and the hover:none rule grows the buttons — both facts are under test here.
  screen: { width: 1440, height: 900 },
})
await touchPage.goto(harness)
await touchPage.addStyleTag({ content: THEME })
await touchPage.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await touchPage.addScriptTag({ path: resolve(E2E, 'client.js') })
await touchPage.evaluate(async ({ snap, w }) => {
  const { connection } = window.createGitPanelMock(snap)
  const ctl = { registered: {} }
  const settings = {
    view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {}, placement: {} } }, value: { showInputPill: true, placement: 'sidebar' } }] },
    status: 'ready',
  }
  const configForms = {
    describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
    get: () => ({
      getSnapshot: () => ({ status: 'ready', value: { showInputPill: true, placement: 'sidebar' }, revision: 0, writable: true }),
      subscribe: () => () => {}, set: async () => true,
    }),
  }
  const dictStore = {}
  const ctx = {
    get: (key) => ({ connection, configForms, sidebarRightTabs: { register: () => () => {} }, sidebarRight: { openTab: () => {} } })[key],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_d, cb) => cb(ctx),
    slots: {
      inject: (_n, p) => p(),
      register: (reg, component) => { ctl.registered[reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`] = { reg, component }; return () => {} },
    },
    locale: {
      register: (ns, dict) => { dictStore[ns] = dict },
      bind: (ns) => (key, params) => {
        const text = dictStore[ns]?.zh?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  window.__getLoaded().apply(ctx)
  await new Promise((r) => setTimeout(r, 400))
  const entry = ctl.registered['sidebar.right.pane.tab::@xbzbing/dsh-git-panel']
  const host = document.getElementById('panel')
  host.style.width = `${w}px`
  host.style.height = '900px'
  window.ReactDOM.createRoot(host).render(entry.component({
    sessionId: 'sess-1', useTabInfo: () => ({ tab: { visible: true } }),
  }))
  await new Promise((r) => setTimeout(r, 800))
}, { snap: SNAP, w: 360 })
const touch = await touchPage.evaluate(() => {
  const toggle = document.querySelector('.gp-toolbar__branches')
  const search = document.querySelector('.gp-search')
  if (toggle === null || search === null) return null
  const t = toggle.getBoundingClientRect()
  const s = search.getBoundingClientRect()
  return {
    buttonW: Math.round(t.width),
    sameRow: t.top < s.bottom && s.top < t.bottom,
    toolbarRows: new Set([...toggle.closest('.gp-toolbar').children]
      .map((n) => Math.round(n.getBoundingClientRect().top))).size,
  }
})
assert.ok(touch !== null, 'the tight toolbar renders on a touch device')
assert.equal(touch?.buttonW, 34, 'the touch media query grows the toggle to 34px (the size the old budget ignored)')
assert.equal(touch?.sameRow, true, 'on a touch device the toggle still shares the search row')
await touchPage.locator('.gp-toolbar').screenshot({ path: resolve(REVIEW_DIR, 'branch-drawer-touch-toolbar.png') })
await touchBrowser.close()

// ── Phone screen: the sidebar drills in like the conversation panel. Stacked is
//    a desktop arrangement (two bands + resizers), so a phone-sized SCREEN must
//    never get it — no stacked bands, no tight-toolbar toggle, one pane at a
//    time. The branch filter is the SAME left drawer the tight sidebar uses
//    (replacing the bottom sheet), opened from the compact filter pill. ──
const phoneBrowser = await chromium.launch()
const phonePage = await phoneBrowser.newPage({
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
await phonePage.goto(harness)
await phonePage.addStyleTag({ content: THEME })
await phonePage.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await phonePage.addScriptTag({ path: resolve(E2E, 'client.js') })
await phonePage.evaluate(async ({ snap, w, repos }) => {
  const { fixture, connection } = window.createGitPanelMock(snap)
  // Two checkouts: the drawer leads with the repository list, like the tight
  // stacked one — compact grows no tab of its own for it.
  fixture.repos = repos
  const ctl = { registered: {} }
  const settings = {
    view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {}, placement: {} } }, value: { showInputPill: true, placement: 'sidebar' } }] },
    status: 'ready',
  }
  const configForms = {
    describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
    get: () => ({ getSnapshot: () => ({ status: 'ready', value: { showInputPill: true, placement: 'sidebar' }, revision: 0, writable: true }), subscribe: () => () => {}, set: async () => true }),
  }
  const dictStore = {}
  const ctx = {
    get: (key) => ({ connection, configForms, sidebarRightTabs: { register: () => () => {} }, sidebarRight: { openTab: () => {} } })[key],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_d, cb) => cb(ctx),
    slots: {
      inject: (_n, p) => p(),
      register: (reg, component) => { ctl.registered[reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`] = { reg, component }; return () => {} },
    },
    locale: {
      register: (ns, dict) => { dictStore[ns] = dict },
      bind: (ns) => (key, params) => {
        const text = dictStore[ns]?.zh?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  window.__getLoaded().apply(ctx)
  await new Promise((r) => setTimeout(r, 400))
  const entry = ctl.registered['sidebar.right.pane.tab::@xbzbing/dsh-git-panel']
  const host = document.getElementById('panel')
  host.style.width = `${w}px`
  host.style.height = '800px'
  window.ReactDOM.createRoot(host).render(entry.component({ sessionId: 'sess-1', useTabInfo: () => ({ tab: { visible: true } }) }))
  await new Promise((r) => setTimeout(r, 800))
}, {
  snap: SNAP, w: 390,
  repos: [
    { path: '', root: 'fixture-repo', name: 'fixture-repo', kind: 'workspace' },
    { path: 'site', root: 'fixture-repo/site', name: 'site', kind: 'nested' },
  ],
})
const phone = await phonePage.evaluate(() => {
  // The pill is the toolbar button whose aria-controls names the drawer: a
  // title/text match would depend on the locale the harness bind resolves.
  const drawer = document.querySelector('.gp-drawer')
  const pill = [...document.querySelectorAll('.gp-toolbar .gp-btn')].find((b) => b.getAttribute('aria-controls') === drawer?.id)
  return {
    layout: document.querySelector('.gp-panel')?.getAttribute('data-layout'),
    drawer: drawer?.getAttribute('data-open') ?? null,
    drawerInert: drawer?.hasAttribute('inert') ?? false,
    toggle: document.querySelector('.gp-toolbar__branches') !== null,
    stackedBands: document.querySelectorAll('.gp-overview__top, .gp-resizer--row').length,
    compactRoot: document.querySelector('.gp-overview--compact') !== null,
    sheet: document.querySelector('.gp-sheet') !== null,
    tabCount: document.querySelector('.gp-tabbar')?.getAttribute('data-tab-count') ?? null,
    pill: pill === undefined ? null : {
      expanded: pill.getAttribute('aria-expanded'),
      controlsResolve: pill.getAttribute('aria-controls') === drawer?.id,
    },
  }
})
assert.equal(phone.layout, 'compact', 'a phone screen gets the drill-in layout on the sidebar too')
assert.equal(phone.drawer, 'false', 'the phone mounts the branch drawer collapsed by default')
assert.equal(phone.drawerInert, true, 'and inert until opened')
assert.equal(phone.toggle, false, 'no stacked-tight toolbar toggle on a phone (the pill is the entry)')
assert.equal(phone.stackedBands, 0, 'no stacked bands or row resizer on a phone')
assert.equal(phone.compactRoot, true, 'the overview renders its compact single-column form')
assert.equal(phone.sheet, false, 'the bottom sheet is gone on a phone')
assert.equal(phone.tabCount, '3', 'two checkouts add no repositories tab to the phone bar')
assert.equal(phone.pill?.expanded, 'false', 'the filter pill reports the collapsed drawer state')
assert.equal(phone.pill?.controlsResolve, true, "the pill's aria-controls resolves to the drawer")

// ── Opening: the pill slides the drawer over the compact root; focus lands on
//    the close button; no bottom sheet appears anywhere. ──
// The pill is the toolbar button whose aria-controls names the drawer — a
// title/text match would depend on which locale the harness bind resolves.
await phonePage.evaluate(() => {
  const drawer = document.querySelector('.gp-drawer')
  const pill = [...document.querySelectorAll('.gp-toolbar .gp-btn')].find((b) => b.getAttribute('aria-controls') === drawer?.id)
  pill?.click()
})
await phonePage.waitForTimeout(250)
const phoneOpen = await phonePage.evaluate(() => {
  const drawer = document.querySelector('.gp-drawer')
  const root = document.querySelector('.gp-overview--compact')
  const d = drawer?.getBoundingClientRect()
  const r = root?.getBoundingClientRect()
  return {
    open: drawer?.getAttribute('data-open') ?? null,
    inert: drawer?.hasAttribute('inert') ?? false,
    focusClose: document.activeElement?.classList.contains('gp-drawer__close') ?? false,
    backdrop: document.querySelector('.gp-drawer-backdrop') !== null,
    sheet: document.querySelector('.gp-sheet') !== null,
    coversRoot: d !== undefined && r !== undefined
      && Math.abs(d.top - r.top) <= 2 && Math.abs(d.bottom - r.bottom) <= 2 && Math.abs(d.left - r.left) <= 2,
    width: d !== undefined ? Math.round(d.width) : 0,
    branchRows: drawer?.querySelectorAll('.gp-branch-row').length ?? 0,
    // The repository block sits right under the drawer's title bar, ahead of
    // the branch list.
    reposLead: (() => {
      const list = drawer?.querySelector('.gp-repolist')
      const bar = drawer?.querySelector('.gp-drawer__bar')
      return list != null && bar != null && bar.nextElementSibling === list
    })(),
    reposCollapsed: drawer?.querySelector('.gp-repolist__head')?.getAttribute('aria-expanded') === 'false',
  }
})
assert.equal(phoneOpen.open, 'true', 'the filter pill opens the phone drawer')
assert.equal(phoneOpen.inert, false, 'the open drawer is interactive')
assert.equal(phoneOpen.focusClose, true, "focus lands on the drawer's close button")
assert.ok(phoneOpen.backdrop, 'opening lays a backdrop over the compact root')
assert.equal(phoneOpen.sheet, false, 'the drawer replaces the bottom sheet, not supplements it')
assert.equal(phoneOpen.coversRoot, true, "the drawer overlays the compact root's full height")
assert.ok(phoneOpen.width >= 180 && phoneOpen.width <= 260, `the drawer keeps its clamp width (${phoneOpen.width}px)`)
assert.ok(phoneOpen.branchRows > 0, 'the drawer carries the branch list')
assert.equal(phoneOpen.reposLead, true, 'the repository list leads the phone drawer')
assert.equal(phoneOpen.reposCollapsed, true, 'collapsed to its head line by default')
await phonePage.locator('.gp-panel').screenshot({ path: resolve(REVIEW_DIR, 'sidebar-phone-branch-drawer.png') })

// ── Escape dismisses it and returns focus to the pill. ──
await phonePage.keyboard.press('Escape')
await phonePage.waitForTimeout(150)
const phoneEsc = await phonePage.evaluate(() => {
  const drawer = document.querySelector('.gp-drawer')
  const pill = [...document.querySelectorAll('.gp-toolbar .gp-btn')].find((b) => b.getAttribute('aria-controls') === drawer?.id)
  return {
    open: drawer?.getAttribute('data-open') ?? null,
    backdrop: document.querySelector('.gp-drawer-backdrop') !== null,
    focusPill: document.activeElement === pill,
  }
})
assert.equal(phoneEsc.open, 'false', 'Escape closes the phone drawer')
assert.equal(phoneEsc.backdrop, false, 'the backdrop goes with it')
assert.equal(phoneEsc.focusPill, true, 'focus returns to the filter pill')

// ── Picking a branch applies the filter and closes the drawer — the flow the
//    bottom sheet used to provide on a phone. ──
await phonePage.evaluate(() => {
  const drawer = document.querySelector('.gp-drawer')
  const pill = [...document.querySelectorAll('.gp-toolbar .gp-btn')].find((b) => b.getAttribute('aria-controls') === drawer?.id)
  pill?.click()
})
await phonePage.waitForTimeout(250)
await phonePage.click('.gp-drawer .gp-branch-row[title="feature"]')
await phonePage.waitForTimeout(300)
const phonePick = await phonePage.evaluate(() => ({
  open: document.querySelector('.gp-drawer')?.getAttribute('data-open') ?? null,
  backdrop: document.querySelector('.gp-drawer-backdrop') !== null,
  pillLabel: [...document.querySelectorAll('.gp-toolbar .gp-btn')].map((b) => b.textContent || '').join('|'),
}))
assert.equal(phonePick.open, 'false', 'picking a branch closes the drawer')
assert.equal(phonePick.backdrop, false, 'and removes the backdrop')
assert.ok(phonePick.pillLabel.includes('feature'), 'the pill shows the picked ref')
await phonePage.locator('.gp-panel').screenshot({ path: resolve(REVIEW_DIR, 'sidebar-phone-compact.png') })
await phoneBrowser.close()
