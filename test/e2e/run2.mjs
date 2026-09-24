import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

function mkSnap(dirty) {
  return {
    root: '/tmp/gp-test', branch: 'main', head: 'de54fc0', unborn: false, dirty,
    staged: 0, modified: dirty ? 1 : 0, untracked: 0, ahead: 0, behind: 0, lastCommit: null,
    changes: dirty ? [{ path: 'a.txt', status: 'modified', staged: false, isDirectory: false }] : [],
    truncated: false, refreshIntervalMs: 0, checkedAt: Date.now(),
  }
}

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

const result = await page.evaluate(async (cleanSnap) => {
  const out = {}
  const entry = window.__getLoaded()
  const connection = { rpc: { call: async (_c, ep) => ep === 'gitPanel/snapshot' ? { ok: true, value: { ok: true, value: cleanSnap } } : { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [], remote: [] } } } } }
  const services = { connection }
  const registered = {}
  const ctx = {
    get: (k) => services[k], effect: (cb) => { try { cb() } catch (e) {} }, on: () => () => {},
    inject: (d, cb) => cb(ctx),
    slots: { inject: (n, p) => p(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
    locale: { register: () => () => {}, bind: () => (k) => k },
  }
  entry.apply(ctx)
  const ReactDOM = window.ReactDOM
  // clean pill
  const pill = registered['conversation.input.left']
  ReactDOM.createRoot(document.getElementById('pill')).render(pill.component({ sessionId: 's' }))
  await new Promise((r) => setTimeout(r, 300))
  out.cleanPill = document.getElementById('pill').innerHTML
  out.hasSyncedClass = document.querySelector('.gp-pill__branch--synced') !== null
  out.hasDirtyClass = document.querySelector('.gp-pill__branch--dirty') !== null

  // Simulate a fake tab bar to test jump: create a role=tab button labeled panel.tab
  const fakeTab = document.createElement('button'); fakeTab.setAttribute('role', 'tab'); fakeTab.textContent = 'panel.tab'; fakeTab.setAttribute('aria-selected', 'false')
  let clicked = false; fakeTab.addEventListener('click', () => { clicked = true; fakeTab.setAttribute('aria-selected', 'true') })
  document.getElementById('tabbar').appendChild(fakeTab)
  document.querySelector('.gp-pill').click()
  await new Promise((r) => setTimeout(r, 100))
  out.jumpClickedTab = clicked
  return out
}, mkSnap(false))
console.log(JSON.stringify(result, null, 2))
console.log('ERRORS:', errors.length ? errors : 'none')
await browser.close()
