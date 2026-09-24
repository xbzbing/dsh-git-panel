/**
 * E2E: render the built client bundle in a headless Chromium against a mock
 * connection RPC (a dirty repo snapshot), then assert the panel structure.
 *
 * Fully isolated — a local file:// harness, no dsh server, no touch of any
 * running instance. Requires the e2e fixtures (run test/e2e/setup.mjs first,
 * or `npm run test:e2e` which chains it).
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

// A synthetic repository root for the mock snapshot; only its basename is
// ever displayed. Not a real filesystem path.
const FIXTURE_ROOT = 'fixture-repo'

const SNAP = {
  root: FIXTURE_ROOT, branch: 'main', head: 'de54fc0', unborn: false, dirty: true,
  staged: 0, modified: 3, untracked: 1, ahead: 0, behind: 0, lastCommit: null,
  changes: [
    { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'd.txt', status: 'untracked', staged: false, isDirectory: false },
    { path: 'img.png', status: 'modified', staged: false, isDirectory: false },
  ],
  truncated: false, refreshIntervalMs: 0, showInputPill: true, checkedAt: Date.now(),
}

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

const out = await page.evaluate(async (snap) => {
  const result = { steps: [] }
  // Valid 1×1 PNG, served as both image-diff sides by the mock.
  const MOCK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const entry = window.__getLoaded()
  if (!entry || typeof entry.apply !== 'function') return { error: 'plugin did not load' }

  const connection = {
    rpc: {
      call: async (_channel, endpoint, payload) => {
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
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: q.ref, shortHash: q.ref.slice(0, 7), subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString() }, body: 'detailed body text', stats: [{ path: 'c.txt', status: 'added' }] } } }
          if (q.kind === 'diff') {
            // An image path diffs as the binary marker, like real git.
            if (q.path.endsWith('.png')) return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n' } } }
            return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n line1\n+line2\n' } } }
          }
          if (q.kind === 'image-diff') return { ok: true, value: { ok: true, value: { kind: 'image-diff', path: q.path, mime: 'image/png', old: `data:image/png;base64,${MOCK_PNG}`, new: `data:image/png;base64,${MOCK_PNG}` } } }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: 'init: first commit' } } }
        }
        if (endpoint === 'gitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
        if (endpoint === 'gitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: request.check === true } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }

  const registered = {}
  const services = { connection }
  const ctx = {
    get: (k) => services[k],
    effect: (cb) => { try { cb() } catch (e) { /* ignore */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (name, provider) => provider(),
      register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} },
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
  }
  entry.apply(ctx)
  result.slots = Object.keys(registered)

  const ReactDOM = window.ReactDOM
  const pillEntry = registered['conversation.input.left']
  ReactDOM.createRoot(document.getElementById('pill')).render(pillEntry.component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 300))
  result.pillHasDirty = document.querySelector('.gp-pill__git--dirty') !== null

  const viewEntry = registered['conversation.view']
  result.viewLabel = viewEntry.reg.label ? viewEntry.reg.label() : null
  result.viewOrder = viewEntry.reg.order
  ReactDOM.createRoot(document.getElementById('panel')).render(viewEntry.component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 500))
  result.tabCount = document.querySelectorAll('.gp-tab').length
  result.hasStats = document.querySelector('.gp-stats') !== null
  result.hasCommitBox = document.querySelector('.gp-commitbox') !== null
  result.changeRows = document.querySelectorAll('.gp-file-row').length
  result.hasAmend = document.querySelector('.gp-commitbox__amend') !== null

  // Image compare: opening a binary image renders old/new panes (not the
  // binary notice), and before/after modes collapse to a single labelled pane.
  const imgRow = [...document.querySelectorAll('.gp-file-row')].find((r) => (r.textContent || '').includes('img.png'))
  if (imgRow) { imgRow.click(); await new Promise((r) => setTimeout(r, 600)) }
  result.imagePanes = document.querySelectorAll('.gp-imgcmp__pane').length
  result.imageImgs = document.querySelectorAll('.gp-imgcmp img').length
  result.imageSrcOk = [...document.querySelectorAll('.gp-imgcmp img')].every((i) => (i.src || '').startsWith('data:image/png;base64,'))
  result.imageHeads = [...document.querySelectorAll('.gp-imgcmp__head')].map((e) => e.textContent)
  const afterBtn = [...document.querySelectorAll('.gp-seg__btn')].find((b) => (b.textContent || '') === 'diff.after')
  if (afterBtn) { afterBtn.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.imageSingle = document.querySelector('.gp-imgcmp--single') !== null
  result.imageSingleHead = document.querySelector('.gp-imgcmp__head')?.textContent ?? null

  const tabs = [...document.querySelectorAll('.gp-tab')]
  const overviewTab = tabs.find((t) => (t.textContent || '').includes('tab.overview'))
  if (overviewTab) { overviewTab.click(); await new Promise((r) => setTimeout(r, 500)) }
  result.hasBranchList = document.querySelector('.gp-branch-group') !== null
  result.commitRows = document.querySelectorAll('.gp-commit-row').length
  result.hasGraph = document.querySelector('.gp-graph-svg') !== null

  // Select the first commit → its changed-file tree appears on the right.
  const firstCommit = document.querySelector('.gp-commit-row')
  if (firstCommit) { firstCommit.click(); await new Promise((r) => setTimeout(r, 400)) }
  const fileRow = document.querySelector('.gp-detail__files .gp-tree-row')
  result.hasDetailFileRow = fileRow !== null
  // Click a changed file → the diff modal opens (portaled to document.body).
  if (fileRow) { fileRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.hasModal = document.querySelector('.gp-modal') !== null
  result.modalHasDiff = document.querySelector('.gp-modal .gp-diff__side') !== null
  // Esc closes it.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 200))
  result.modalClosedByEsc = document.querySelector('.gp-modal') === null
  // Reopen, then close via the close button.
  if (fileRow) { fileRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  const closeBtn = document.querySelector('.gp-modal__bar .gp-icon-btn')
  if (closeBtn) { closeBtn.click(); await new Promise((r) => setTimeout(r, 200)) }
  result.modalClosedByBtn = document.querySelector('.gp-modal') === null
  return result
}, SNAP)

await browser.close()

try {
  assert.equal(out.error, undefined, out.error)
  assert.deepEqual(out.slots.sort(), ['conversation.input.left', 'conversation.view', 'plugins.bundle.config'])
  assert.equal(out.pillHasDirty, true, 'dirty pill shows the orange git class')
  assert.equal(out.viewOrder, 30, 'panel is ordered after Chat/Trajectory')
  assert.equal(out.tabCount, 2, 'two sub-tabs')
  assert.equal(out.hasStats, true, 'stats bar rendered')
  assert.equal(out.hasCommitBox, true, 'commit box rendered')
  assert.equal(out.hasAmend, true, 'amend checkbox present')
  assert.equal(out.changeRows, 4, 'four change rows (three text + one image)')
  assert.equal(out.imagePanes, 2, 'image diff renders both panes in split mode')
  assert.equal(out.imageImgs, 2, 'both panes render an image')
  assert.equal(out.imageSrcOk, true, 'panes carry data URL images')
  assert.deepEqual(out.imageHeads, ['diff.before', 'diff.after'], 'pane labels before/after')
  assert.equal(out.imageSingle, true, 'after-mode collapses to one pane')
  assert.equal(out.imageSingleHead, 'diff.after', 'the single pane keeps its label')
  assert.equal(out.hasBranchList, true, 'branch list rendered on overview')
  assert.equal(out.commitRows, 2, 'two commit rows')
  assert.equal(out.hasGraph, true, 'commit graph svg rendered')
  assert.equal(out.hasDetailFileRow, true, 'selecting a commit lists its changed files')
  assert.equal(out.hasModal, true, 'clicking a file opens the diff modal')
  assert.equal(out.modalHasDiff, true, 'the modal renders a side-by-side diff')
  assert.equal(out.modalClosedByEsc, true, 'Esc closes the modal')
  assert.equal(out.modalClosedByBtn, true, 'the close button closes the modal')
  assert.equal(errors.length, 0, 'no console errors: ' + JSON.stringify(errors))
  console.log('e2e run.mjs: PASS', JSON.stringify(out))
} catch (e) {
  console.error('e2e run.mjs: FAIL', e.message)
  console.error(JSON.stringify(out, null, 2))
  process.exit(1)
}
