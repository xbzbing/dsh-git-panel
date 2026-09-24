/**
 * E2E: clean-repo pill color + non-git directory marker + jump click.
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

function cleanSnap() {
  return {
    root: '/tmp/gp-test', branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
    staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, lastCommit: null,
    changes: [], truncated: false, refreshIntervalMs: 0, checkedAt: Date.now(),
  }
}

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

const out = await page.evaluate(async (snap) => {
  const result = {}
  const entry = window.__getLoaded()

  // Case 1: clean repo → synced (green) pill + jump click.
  const cleanConn = { rpc: { call: async (_c, ep) => ep === 'gitPanel/snapshot'
    ? { ok: true, value: { ok: true, value: snap } }
    : { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [], remote: [] } } } } }
  const registered = {}
  const mkCtx = (conn) => {
    const ctx = {
      get: (k) => (k === 'connection' ? conn : undefined),
      effect: (cb) => { try { cb() } catch (e) { /* ignore */ } },
      on: () => () => {},
      inject: (_d, cb) => cb(ctx),
      slots: { inject: (n, p) => p(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
      locale: { register: () => () => {}, bind: () => (k) => k },
    }
    return ctx
  }
  entry.apply(mkCtx(cleanConn))
  const ReactDOM = window.ReactDOM
  const pill = registered['conversation.input.left']
  ReactDOM.createRoot(document.getElementById('pill')).render(pill.component({ sessionId: 's' }))
  await new Promise((r) => setTimeout(r, 300))
  result.hasSynced = document.querySelector('.gp-pill__git--synced') !== null
  result.hasDirty = document.querySelector('.gp-pill__git--dirty') !== null

  // Fake tab bar → the pill click should click a role=tab button labeled panel.tab.
  const fakeTab = document.createElement('button')
  fakeTab.setAttribute('role', 'tab'); fakeTab.textContent = 'panel.tab'; fakeTab.setAttribute('aria-selected', 'false')
  let clicked = false
  fakeTab.addEventListener('click', () => { clicked = true; fakeTab.setAttribute('aria-selected', 'true') })
  document.getElementById('tabbar').appendChild(fakeTab)
  document.querySelector('.gp-pill').click()
  await new Promise((r) => setTimeout(r, 100))
  result.jumpClicked = clicked

  // Case 2: not-a-git-repo → marker shows only the dir name, no error text.
  const notGitConn = { rpc: { call: async (_c, ep) => ep === 'gitPanel/snapshot'
    ? { ok: true, value: { ok: false, error: { code: 'not-a-git-repo', cwd: '/home/me/scratch' } } }
    : { ok: true, value: { ok: true, value: { kind: 'branches', current: null, defaultBranch: null, local: [], remote: [] } } } } }
  entry.apply(mkCtx(notGitConn))
  const pill2 = registered['conversation.input.left']
  const host2 = document.getElementById('pill')
  ReactDOM.createRoot(host2).render(pill2.component({ sessionId: 's2' }))
  await new Promise((r) => setTimeout(r, 300))
  const plain = document.querySelector('.gp-pill--plain')
  result.notGitPlain = plain !== null
  result.notGitText = plain ? plain.textContent : null
  return result
}, cleanSnap())

await browser.close()

try {
  assert.equal(out.hasSynced, true, 'clean repo pill uses the green synced class')
  assert.equal(out.hasDirty, false, 'clean repo pill is not orange')
  assert.equal(out.jumpClicked, true, 'pill click activates the Git tab button')
  assert.equal(out.notGitPlain, true, 'non-git directory renders a plain marker')
  assert.equal(out.notGitText, 'scratch', 'non-git marker shows only the directory name')
  assert.equal(errors.length, 0, 'no page errors: ' + JSON.stringify(errors))
  console.log('e2e run2.mjs: PASS', JSON.stringify(out))
} catch (e) {
  console.error('e2e run2.mjs: FAIL', e.message)
  console.error(JSON.stringify(out, null, 2))
  process.exit(1)
}
