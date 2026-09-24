import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

// Fake snapshot + query responses served by the mock connection RPC.
const SNAP = {
  root: '/tmp/gp-test', branch: 'main', head: 'de54fc0', unborn: false, dirty: true,
  staged: 0, modified: 2, untracked: 1, ahead: 0, behind: 0, lastCommit: null,
  changes: [
    { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'd.txt', status: 'untracked', staged: false, isDirectory: false },
  ],
  truncated: false, refreshIntervalMs: 0, checkedAt: Date.now(),
}

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

const result = await page.evaluate(async (snap) => {
  const out = { steps: [] }
  const entry = window.__getLoaded()
  if (!entry || typeof entry.apply !== 'function') return { error: 'plugin did not load', entry: String(entry) }

  // Mock connection RPC: respond to gitPanel/<method>.
  const connection = {
    rpc: {
      call: async (channel, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
        if (endpoint === 'gitPanel/query') {
          const q = request.query
          if (q.kind === 'worktree-stats') return { ok: true, value: { ok: true, value: { kind: 'worktree-stats', stats: { fileCount: 3, staged: 0, modified: 2, untracked: 1, insertions: 3, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: new Date().toISOString() } } } }
          if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'feature', shortHash: 'd196623' }, { name: 'main', shortHash: 'de54fc0' }], remote: [] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: ['Tester'] } } }
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 2, commits: [
            { hash: 'd196623aaa', shortHash: 'd196623', subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString(), parents: ['de54fc0bbb'], refs: [{ kind: 'branch', name: 'feature', head: false }] },
            { hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'init: first commit', author: 'Tester', dateIso: new Date().toISOString(), parents: [], refs: [{ kind: 'branch', name: 'main', head: true }] },
          ] } } }
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: q.ref, shortHash: q.ref.slice(0,7), subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString() }, body: 'detailed body text', stats: [{ path: 'c.txt', status: 'added' }] } } }
          if (q.kind === 'diff') return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n line1\n+line2\n' } } }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: 'init: first commit' } } }
        }
        if (endpoint === 'gitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }

  // Slot registry capture.
  const registered = {}
  const services = { connection }
  const ctx = {
    get: (k) => services[k],
    effect: (cb) => { try { cb() } catch (e) {} },
    on: () => () => {},
    inject: (deps, cb) => cb(ctx),
    slots: {
      inject: (name, provider) => provider(),
      register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} },
    },
    locale: {
      register: () => () => {},
      bind: () => (key, params) => {
        // Return the key so we can assert on structure; include params.
        return params ? key + JSON.stringify(params) : key
      },
    },
  }

  entry.apply(ctx)
  out.steps.push('applied; registered slots: ' + Object.keys(registered).join(','))

  const React = window.React
  const ReactDOM = window.ReactDOM

  // Render the pill.
  const pillEntry = registered['conversation.input.left']
  if (!pillEntry) return { error: 'no pill slot', out }
  const pillRoot = ReactDOM.createRoot(document.getElementById('pill'))
  pillRoot.render(pillEntry.component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 300))
  out.pillHtml = document.getElementById('pill').innerHTML

  // Render the panel.
  const viewEntry = registered['conversation.view']
  if (!viewEntry) return { error: 'no view slot', out }
  out.viewLabel = viewEntry.reg.label ? viewEntry.reg.label() : null
  out.viewOrder = viewEntry.reg.order
  const panelRoot = ReactDOM.createRoot(document.getElementById('panel'))
  panelRoot.render(viewEntry.component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 500))
  out.panelHtml = document.getElementById('panel').innerHTML.slice(0, 400)
  out.hasTabbar = document.querySelector('.gp-tabbar') !== null
  out.tabCount = document.querySelectorAll('.gp-tab').length
  out.hasStats = document.querySelector('.gp-stats') !== null
  out.hasCommitBox = document.querySelector('.gp-commitbox') !== null
  out.hasChangeRows = document.querySelectorAll('.gp-file-row').length
  out.hasAmend = document.querySelector('.gp-commitbox__amend') !== null

  // Switch to overview tab.
  const tabs = [...document.querySelectorAll('.gp-tab')]
  const overviewTab = tabs.find((t) => (t.textContent || '').includes('tab.overview'))
  if (overviewTab) { overviewTab.click(); await new Promise((r) => setTimeout(r, 500)) }
  out.hasBranchList = document.querySelector('.gp-branch-group') !== null
  out.hasCommitRows = document.querySelectorAll('.gp-commit-row').length
  out.hasGraph = document.querySelector('.gp-graph-svg') !== null

  return out
}, SNAP)

console.log(JSON.stringify(result, null, 2))
console.log('\nCONSOLE ERRORS:', errors.length ? errors : 'none')
await browser.close()
