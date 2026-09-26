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

// Synthetic values for the mock snapshot; only basenames are displayed.
const FIXTURE_ROOT = 'fixture-repo'
const NON_GIT_DIR = 'some-dir/scratch'

function cleanSnap() {
  return {
    root: FIXTURE_ROOT, branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
    staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, lastCommit: null,
    changes: [],
    stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
    truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
  }
}

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

const out = await page.evaluate(async ({ snap, nonGitDir }) => {
  const result = {}
  const entry = window.__getLoaded()

  // Case 1: clean repo → synced (green) pill + jump click.
  let cleanFileListings = 0
  const cleanConn = { rpc: { call: async (_c, ep, payload) => {
    if (ep === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
    if (payload?.args?.request?.query?.kind === 'dir-list') cleanFileListings++
    return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [], remote: [] } } }
  } } }
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
  result.hasSynced = document.querySelector('.gp-pill--synced') !== null
  result.hasDirty = document.querySelector('.gp-pill--dirty') !== null
  const cleanPanel = document.createElement('div')
  document.body.appendChild(cleanPanel)
  const cleanPanelRoot = ReactDOM.createRoot(cleanPanel)
  cleanPanelRoot.render(registered['conversation.view'].component({ sessionId: 'clean-default' }))
  await new Promise((r) => setTimeout(r, 300))
  result.cleanDefault = cleanPanel.querySelector('.gp-tab--active')?.textContent?.includes('tab.overview') ?? false
  result.cleanAvoidsFileListing = cleanFileListings === 0
  cleanPanelRoot.render(registered['conversation.view'].component({ sessionId: 'clean-second' }))
  await new Promise((r) => setTimeout(r, 300))
  result.cleanAfterSessionSwitch = cleanPanel.querySelector('.gp-tab--active')?.textContent?.includes('tab.overview') ?? false

  // Fake tab bar → the pill click should click a role=tab button labeled panel.tab.
  // The real shell wraps view tabs in [data-conversation-tabs]; mirror that here.
  document.getElementById('tabbar').setAttribute('data-conversation-tabs', '')
  const fakeTab = document.createElement('button')
  fakeTab.setAttribute('role', 'tab'); fakeTab.textContent = 'panel.tab'; fakeTab.setAttribute('aria-selected', 'false')
  let clicked = false
  fakeTab.addEventListener('click', () => { clicked = true; fakeTab.setAttribute('aria-selected', 'true') })
  document.getElementById('tabbar').appendChild(fakeTab)
  document.querySelector('.gp-pill').click()
  await new Promise((r) => setTimeout(r, 100))
  result.jumpClicked = clicked

  // Case 2: a non-git directory has no input marker but opens the Files view.
  const notGitConn = { rpc: { call: async (_c, ep) => ep === 'gitPanel/snapshot'
    ? { ok: true, value: { ok: false, error: { code: 'not-a-git-repo', cwd: nonGitDir } } }
    : { ok: true, value: { ok: true, value: { kind: 'dir-list', path: '', truncated: false, entries: [{ name: 'note.md', dir: false }] } } } } }
  entry.apply(mkCtx(notGitConn))
  const pill2 = registered['conversation.input.left']
  const host2 = document.getElementById('pill')
  ReactDOM.createRoot(host2).render(pill2.component({ sessionId: 's2' }))
  await new Promise((r) => setTimeout(r, 300))
  result.notGitPillHidden = document.querySelector('#pill .gp-pill') === null
  const view2 = registered['conversation.view']
  ReactDOM.createRoot(document.getElementById('panel')).render(view2.component({ sessionId: 's2' }))
  await new Promise((r) => setTimeout(r, 300))
  result.notGitFilesOnly = document.querySelectorAll('#panel .gp-tab').length === 1
    && document.querySelector('#panel .gp-tab--active')?.textContent?.includes('tab.files')
  result.notGitFileListed = document.querySelector('#panel .gp-files__tree')?.textContent?.includes('note.md')

  // Case 3: showInputPill=false → the input-bar marker is hidden and the Git
  // tab shows a status dot instead (pill ↔ tab-dot mutual exclusion, T5).
  const dirtySnap = { ...snap, dirty: true, modified: 1, showInputPill: false, changes: [{ path: 'x.txt', status: 'modified', staged: false, isDirectory: false }] }
  const dotConn = { rpc: { call: async (_c, ep) => ep === 'gitPanel/snapshot'
    ? { ok: true, value: { ok: true, value: dirtySnap } }
    : { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [], remote: [] } } } } }
  entry.apply(mkCtx(dotConn))
  const pill3 = registered['conversation.input.left']
  ReactDOM.createRoot(document.getElementById('pill')).render(pill3.component({ sessionId: 's3' }))
  await new Promise((r) => setTimeout(r, 300))
  result.dotPillHidden = document.querySelector('#pill .gp-pill') === null
  result.dotOnTab = document.querySelector('[data-gp-tab-dot]') !== null
  result.dotDirty = document.querySelector('.gp-tab-dot--dirty') !== null

  // Case 4: the input-bar marker collapses to a status dot by workspace WIDTH
  // (not sidebar open/close state), so it expands back as the workspace widens.
  const region = document.createElement('div')
  region.setAttribute('data-conversation-region', '')
  region.style.width = '400px'
  document.body.appendChild(region)
  const host = document.createElement('div')
  region.appendChild(host)
  ReactDOM.createRoot(host).render(registered['conversation.input.left'].component({ sessionId: 's' }))
  await new Promise((r) => setTimeout(r, 300))
  const narrowPill = host.querySelector('.gp-pill')
  result.compactWhenNarrow = narrowPill?.classList.contains('gp-pill--compact') === true
  result.compactKeepsStatus = narrowPill?.classList.contains('gp-pill--synced') === true
  result.compactDotShown = narrowPill ? getComputedStyle(narrowPill.querySelector('.gp-pill__dot')).display !== 'none' : false
  region.style.width = '1000px'
  await new Promise((r) => setTimeout(r, 300))
  result.expandsWhenWide = host.querySelector('.gp-pill')?.classList.contains('gp-pill--compact') === false

  return result
}, { snap: cleanSnap(), nonGitDir: NON_GIT_DIR })

await browser.close()

try {
  assert.equal(out.hasSynced, true, 'clean repo pill uses the green synced class')
  assert.equal(out.hasDirty, false, 'clean repo pill is not orange')
  assert.equal(out.cleanDefault, true, 'clean Git workspace defaults to Overview')
  assert.equal(out.cleanAfterSessionSwitch, true, 'switching between clean sessions still selects Overview')
  assert.equal(out.cleanAvoidsFileListing, true, 'clean default does not fetch hidden file-browser data')
  assert.equal(out.jumpClicked, true, 'pill click activates the Git tab button')
  assert.equal(out.notGitPillHidden, true, 'non-git directory hides the input marker')
  assert.equal(out.notGitFilesOnly, true, 'non-git panel defaults to Files only')
  assert.equal(out.notGitFileListed, true, 'non-git panel lists cwd files')
  assert.equal(out.dotPillHidden, true, 'showInputPill=false hides the input-bar marker')
  assert.equal(out.dotOnTab, true, 'showInputPill=false injects the Git tab status dot')
  assert.equal(out.dotDirty, true, 'the tab dot is the dirty (orange) variant')
  assert.equal(out.compactWhenNarrow, true, 'a narrow workspace collapses the marker to a dot')
  assert.equal(out.compactKeepsStatus, true, 'the collapsed marker keeps its git status class')
  assert.equal(out.compactDotShown, true, 'the status dot is visible when collapsed')
  assert.equal(out.expandsWhenWide, true, 'widening the workspace expands the marker again')
  assert.equal(errors.length, 0, 'no page errors: ' + JSON.stringify(errors))
  console.log('e2e run2.mjs: PASS', JSON.stringify(out))
} catch (e) {
  console.error('e2e run2.mjs: FAIL', e.message)
  console.error(JSON.stringify(out, null, 2))
  process.exit(1)
}
