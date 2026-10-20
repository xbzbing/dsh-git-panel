/**
 * The panel's mount: the conversation tab, the right sidebar's page type, or
 * both — and what happens when the host has no right sidebar at all.
 *
 * The mock's `slots` registry is keyed by `(name, key)`, because the sidebar's
 * seats are keyed slots: the conversation's view tab and the sidebar's body
 * seat are distinguished by their key, not by their name. `slots.inject`
 * returns a real disposer, so a mount that is released really unregisters.
 *
 * The `ctx.inject` mock holds its callback until the test releases it, which
 * is how the right sidebar's service arriving late is exercised: the plugin
 * waits for the service, and only then does the sidebar-only preference take
 * effect.
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

/**
 * Boot the plugin against a mock host.
 *
 * @param page - the browser page.
 * @param opts.placement - the preference the settings mirror reports.
 * @param opts.withSidebar - whether the host offers the right sidebar's service.
 * @param opts.lateSidebar - whether the service arrives only when the test says so.
 */
async function boot(page, opts = {}) {
  await page.goto(harness)
  await page.addStyleTag({ content: THEME })
  await page.addScriptTag({ path: resolve(E2E, 'client.js') })
  await page.evaluate(async ({ snap, placement, withSidebar, lateSidebar }) => {
    const ctl = {
      registered: {},
      sidebarTypes: [],
      openedTabs: [],
      pendingInject: null,
    }
    window.__ctl = ctl

    const connection = { rpc: { call: async (_channel, endpoint) => {
      if (endpoint === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
      if (endpoint === 'gitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
      if (endpoint === 'gitPanel/version') return { ok: true, value: { current: '1.8.1', repositoryUrl: '', updateAvailable: false, checkedRemote: false } }
      return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
    } } }

    // The settings mirror: one namespace, ours, carrying the preference.
    const settings = {
      view: {
        namespaces: [{
          ns: 'gitPanel',
          schema: { dict: { showInputPill: {}, placement: {} } },
          value: { showInputPill: true, placement },
        }],
      },
      status: 'ready',
    }
    const configForms = {
      describe: () => ({
        getSnapshot: () => settings,
        subscribe: () => () => {},
        ensure: async () => {},
      }),
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: { showInputPill: true, placement }, revision: 0, writable: true }),
        subscribe: () => () => {},
        set: async () => true,
      }),
    }

    const sidebarTabs = {
      register: (definition) => {
        ctl.sidebarTypes.push(definition)
        return () => {
          const at = ctl.sidebarTypes.indexOf(definition)
          if (at !== -1) ctl.sidebarTypes.splice(at, 1)
        }
      },
    }
    const sidebarRight = {
      openTab: (kind) => { ctl.openedTabs.push(kind) },
    }

    const services = { connection, configForms }
    if (withSidebar && !lateSidebar) {
      services.sidebarRightTabs = sidebarTabs
      services.sidebarRight = sidebarRight
    }

    const ctx = {
      get: (key) => services[key],
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: () => () => {},
      // The deferred injection: the callback waits for the service to exist.
      inject: (deps, cb) => {
        if (deps.includes('sidebarRightTabs')) {
          ctl.pendingInject = () => {
            services.sidebarRightTabs = sidebarTabs
            services.sidebarRight = sidebarRight
            cb(ctx)
          }
          if (withSidebar && !lateSidebar) ctl.pendingInject()
          return
        }
        cb(ctx)
      },
      slots: {
        inject: (_name, provider) => provider(),
        register: (reg, component) => {
          const key = reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`
          ctl.registered[key] = { reg, component }
          return () => { delete ctl.registered[key] }
        },
      },
      locale: {
        register: () => () => {},
        bind: () => (key) => key,
      },
    }
    window.__getLoaded().apply(ctx)
    await new Promise((r) => setTimeout(r, 300))
  }, {
    snap: SNAP,
    placement: opts.placement ?? 'all',
    withSidebar: opts.withSidebar === true,
    lateSidebar: opts.lateSidebar === true,
  })
}

const mounts = (page) => page.evaluate(() => {
  const keys = Object.keys(window.__ctl.registered)
  return {
    tab: keys.includes('conversation.view'),
    sidebarBody: keys.includes('sidebar.right.pane.tab::@xbzbing/dsh-git-panel'),
    sidebarTitle: keys.includes('sidebar.right.pane.tab.title::@xbzbing/dsh-git-panel'),
    types: window.__ctl.sidebarTypes.map((d) => ({ id: d.id, kind: d.kind, keepMounted: d.keepMounted, priority: d.priority, guide: (d.guide ?? []).map((g) => g.id) })),
  }
})

try {
  // ── both mounts ───────────────────────────────────────────────────────
  {
    const page = await browser.newPage()
    await boot(page, { placement: 'all', withSidebar: true })
    const m = await mounts(page)
    assert.equal(m.tab, true, 'the conversation tab is registered')
    assert.equal(m.sidebarBody, true, 'the sidebar body seat is registered')
    assert.equal(m.sidebarTitle, true, 'the sidebar title seat is registered')
    assert.equal(m.types.length, 1, 'exactly one page type is registered')
    assert.equal(m.types[0].kind, 'dsh-git-panel', 'the page type is named by its kind')
    assert.equal(m.types[0].id, '@xbzbing/dsh-git-panel', 'the implementation identity is the package name')
    assert.equal(m.types[0].keepMounted, true, 'a visited body stays mounted so unsaved work survives')
    assert.equal(m.types[0].guide.length, 1, 'the type contributes one guide entry')
    await page.close()
  }

  // ── tab only ──────────────────────────────────────────────────────────
  {
    const page = await browser.newPage()
    await boot(page, { placement: 'tab', withSidebar: true })
    const m = await mounts(page)
    assert.equal(m.tab, true, 'the conversation tab is registered')
    assert.equal(m.sidebarBody, false, 'the sidebar body seat is not registered')
    assert.equal(m.types.length, 0, 'no page type is registered')
    await page.close()
  }

  // ── sidebar only ──────────────────────────────────────────────────────
  {
    const page = await browser.newPage()
    await boot(page, { placement: 'sidebar', withSidebar: true })
    const m = await mounts(page)
    assert.equal(m.tab, false, 'the conversation tab is not registered')
    assert.equal(m.sidebarBody, true, 'the sidebar body seat is registered')
    assert.equal(m.types.length, 1, 'the page type is registered')
    await page.close()
  }

  // ── the capability fallback ───────────────────────────────────────────
  // A sidebar-only preference on a host without the right sidebar would leave
  // the panel with no entry point at all, so it degrades to both mounts.
  {
    const page = await browser.newPage()
    await boot(page, { placement: 'sidebar', withSidebar: false })
    const m = await mounts(page)
    assert.equal(m.tab, true, 'the conversation tab stays, so the panel remains reachable')
    assert.equal(m.sidebarBody, false, 'there is no sidebar to register with')
    assert.equal(m.types.length, 0, 'no page type is registered')
    await page.close()
  }

  // ── the sidebar arriving late ─────────────────────────────────────────
  // The preference stands once the service shows up: the tab is released and
  // the sidebar's page type takes its place.
  {
    const page = await browser.newPage()
    await boot(page, { placement: 'sidebar', withSidebar: false, lateSidebar: true })
    let m = await mounts(page)
    assert.equal(m.tab, true, 'without the sidebar the tab is kept')
    assert.equal(m.types.length, 0, 'no page type before the service arrives')

    await page.evaluate(() => { window.__ctl.pendingInject?.() })
    await page.waitForTimeout(100)
    m = await mounts(page)
    assert.equal(m.tab, false, 'the tab is released once the sidebar is available')
    assert.equal(m.sidebarBody, true, 'the sidebar body seat is registered')
    assert.equal(m.types.length, 1, 'the page type is registered')
    await page.close()
  }

  // ── the pill's target and its tooltip ─────────────────────────────────
  {
    const page = await browser.newPage()
    await boot(page, { placement: 'sidebar', withSidebar: true })
    await page.evaluate(async () => {
      const entry = window.__ctl.registered['conversation.input.left']
      const host = document.getElementById('pill')
      window.ReactDOM.createRoot(host).render(entry.component({ sessionId: 'sess-1' }))
      await new Promise((r) => setTimeout(r, 400))
    })
    await page.hover('.gp-pill')
    await page.waitForTimeout(200)
    const notes = await page.evaluate(() => [...document.querySelectorAll('.gp-tip__note')].map((n) => n.textContent))
    assert.ok(
      notes.some((n) => n.includes('pill.opensSidebar')),
      `the tooltip explains the sidebar target (got ${JSON.stringify(notes)})`,
    )
    const opened = await page.evaluate(async () => {
      document.querySelector('.gp-pill').click()
      await new Promise((r) => setTimeout(r, 100))
      return window.__ctl.openedTabs.slice()
    })
    assert.deepEqual(opened, ['dsh-git-panel'], 'a click opens the sidebar page type')
    await page.close()
  }

  // ── the pill with the tab mount ───────────────────────────────────────
  {
    const page = await browser.newPage()
    await boot(page, { placement: 'tab', withSidebar: true })
    await page.evaluate(async () => {
      const entry = window.__ctl.registered['conversation.input.left']
      const host = document.getElementById('pill')
      window.ReactDOM.createRoot(host).render(entry.component({ sessionId: 'sess-1' }))
      await new Promise((r) => setTimeout(r, 400))
    })
    await page.hover('.gp-pill')
    await page.waitForTimeout(200)
    const notes = await page.evaluate(() => [...document.querySelectorAll('.gp-tip__note')].map((n) => n.textContent))
    assert.ok(
      !notes.some((n) => n.includes('pill.opensSidebar')),
      'the tooltip does not mention the sidebar when the tab is the target',
    )
    const opened = await page.evaluate(async () => {
      document.querySelector('.gp-pill').click()
      await new Promise((r) => setTimeout(r, 100))
      return window.__ctl.openedTabs.slice()
    })
    assert.deepEqual(opened, [], 'a click does not open the sidebar')
    await page.close()
  }

  // ── the sidebar body renders the panel ────────────────────────────────
  {
    const page = await browser.newPage()
    await boot(page, { placement: 'sidebar', withSidebar: true })
    const body = await page.evaluate(async () => {
      const entry = window.__ctl.registered['sidebar.right.pane.tab::@xbzbing/dsh-git-panel']
      if (entry === undefined) return { missing: true }
      const host = document.getElementById('panel')
      host.style.width = '420px'
      host.style.height = '640px'
      window.ReactDOM.createRoot(host).render(entry.component({
        sessionId: 'sess-1',
        useTabInfo: () => ({ tab: { visible: true } }),
        t: (key) => key,
      }))
      await new Promise((r) => setTimeout(r, 500))
      const panel = document.querySelector('.gp-panel')
      return {
        missing: false,
        rendered: panel !== null,
        host: panel?.getAttribute('data-gp-host') ?? null,
        overlay: panel?.hasAttribute('data-conversation-composer-overlay') ?? null,
        padding: panel === null ? null : getComputedStyle(panel.querySelector('.gp-body')).paddingBottom,
      }
    })
    assert.equal(body.missing, false, 'the sidebar body is registered')
    assert.equal(body.rendered, true, 'the panel renders in the sidebar')
    assert.equal(body.host, 'sidebar', 'the panel knows it is mounted in the sidebar')
    assert.equal(body.overlay, false, 'the conversation overlay mode is not opted into')
    assert.equal(body.padding, '0px', 'the composer height is not reserved')
    await page.close()
  }

  console.log('e2e/sidebar-tab: all assertions passed')
} finally {
  await browser.close()
}
