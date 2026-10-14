/**
 * E2E: portaled modals on a phone-sized viewport (they live outside .gp-panel,
 * so they adapt via viewport media queries, not the panel layout attribute).
 * Asserts: small confirm dialogs stay content-height (the tall near-fullscreen
 * sizing must not leak onto .gp-modal--sm — it used to stretch them to 90vh
 * with a huge dead area below the text), and the commit file-diff modal keeps
 * a tappable backdrop strip above/below itself.
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

const FIXTURE_ROOT = 'fixture-repo'

const SNAP = {
  root: FIXTURE_ROOT, branch: 'main', head: 'de54fc0', unborn: false, dirty: true,
  staged: 0, modified: 2, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null,
  changes: [
    { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
  ],
  stats: { fileCount: 2, staged: 0, modified: 2, untracked: 0, insertions: 3, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

const DIFF = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,3 @@\n line1\n+line1.5\n line2\n line3\n'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

const out = await page.evaluate(async ({ snap, diff }) => {
  const result = {}
  const connection = {
    rpc: {
      call: async (_ch, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
        if (endpoint === 'gitPanel/query') {
          const q = request.query
          if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'feature', shortHash: 'd196623' }, { name: 'main', shortHash: 'de54fc0' }], remote: [] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: ['Tester'] } } }
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 1, commits: [{ hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'init: first commit', author: 'Tester', dateIso: new Date().toISOString(), parents: [], refs: [] }] } } }
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'init: first commit', author: 'Tester', dateIso: new Date().toISOString() }, body: '', stats: [{ path: 'a.txt', status: 'modified' }], insertions: 1, deletions: 0 } } }
          if (q.kind === 'diff') return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: diff, newLines: 4 } } }
          if (q.kind === 'worktree-stats') return { ok: true, value: { ok: true, value: { kind: 'worktree-stats', stats: { fileCount: 2, staged: 0, modified: 2, untracked: 0, insertions: 3, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: null } } } }
        }
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
    inject: (_d, cb) => cb(ctx),
    slots: { inject: (_n, p) => p(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
    locale: { register: () => () => {}, bind: () => (k) => k },
  }
  window.__getLoaded().apply(ctx)
  const ReactDOM = window.ReactDOM
  const panelHost = document.getElementById('panel')
  ReactDOM.createRoot(panelHost).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 500))

  const tabByText = (t) => [...document.querySelectorAll('.gp-tab')].find((x) => (x.textContent || '').includes(t))

  // A small confirm dialog (branch switch) opened from the overview branch row.
  tabByText('overview')?.click()
  await new Promise((r) => setTimeout(r, 300))
  const switchBtn = [...document.querySelectorAll('.gp-branch-row__switch')][0]
  if (switchBtn) { switchBtn.style.visibility = 'visible'; switchBtn.click() }
  await new Promise((r) => setTimeout(r, 200))
  const sm = document.querySelector('.gp-modal--sm')
  result.smShown = sm !== null
  if (sm) {
    const rect = sm.getBoundingClientRect()
    result.smHeight = Math.round(rect.height)
    // Content-sized: comfortably under half the viewport (it used to be 90vh).
    result.smContentSized = rect.height < window.innerHeight * 0.6
    result.smVerticallyCentered = Math.abs(rect.top - (window.innerHeight - rect.height) / 2) < 2
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 200))
  result.smClosed = document.querySelector('.gp-modal--sm') === null

  // The commit file-diff modal must keep a tappable backdrop strip AND its
  // compact two-row bar — the latter keys off the panel-width breakpoint, so
  // the panel host shrinks to a phone width here.
  panelHost.style.width = '390px'
  await new Promise((r) => setTimeout(r, 200))
  document.querySelector('.gp-commit-row')?.click()
  await new Promise((r) => setTimeout(r, 400))
  const treeRow = [...document.querySelectorAll('.gp-tree-row')].find((n) => (n.textContent || '').includes('a.txt'))
  result.detailTreeRow = treeRow !== undefined
  treeRow?.click()
  await new Promise((r) => setTimeout(r, 400))
  const modal = document.querySelector('.gp-modal:not(.gp-modal--sm)')
  result.diffModalShown = modal !== null
  if (modal) {
    const rect = modal.getBoundingClientRect()
    result.diffTopGap = Math.round(rect.top)
    result.diffBottomGap = Math.round(window.innerHeight - rect.bottom)
    result.diffFits = rect.top >= -0.5 && rect.bottom <= window.innerHeight + 0.5
    // The modal bar splits into two rows on compact: header row (icon, path,
    // hash, stats, expand) and a controls row (mode seg + bordered close at
    // its far right).
    const rows = [...modal.querySelectorAll('.gp-modal__bar-row')]
    result.barRows = rows.length
    const ctrlRow = modal.querySelector('.gp-modal__bar-row--controls')
    result.barCtrlRowHasSeg = ctrlRow?.querySelector('.gp-seg') !== null
    result.barCtrlRowHasClose = ctrlRow?.querySelector('.gp-modal__close') !== null
    // The border uses the platform theme variable (undefined in the isolated
    // harness), which would invalidate the shorthand — define it first.
    document.documentElement.style.setProperty('--dsw-alias-border-l2', '#888')
    result.barCloseBordered = ctrlRow !== null
      ? getComputedStyle(ctrlRow.querySelector('.gp-modal__close')).borderTopWidth === '1px'
      : false
    if (ctrlRow) {
      const closeRect = ctrlRow.querySelector('.gp-modal__close').getBoundingClientRect()
      const rowRect = ctrlRow.getBoundingClientRect()
      result.barCloseAtRowEnd = Math.abs(rowRect.right - closeRect.right) <= 2
      const segBtns = [...ctrlRow.querySelectorAll('.gp-seg .gp-seg__btn')]
      const tops = segBtns.map((b) => Math.round(b.getBoundingClientRect().top))
      result.barSegOneLine = segBtns.length >= 2 && new Set(tops).size === 1
      const widths = segBtns.map((b) => Math.round(b.getBoundingClientRect().width))
      result.barSegEvenWidth = widths.length >= 2 && Math.max(...widths) - Math.min(...widths) <= 2
    }
  }
  return result
}, { snap: SNAP, diff: DIFF })

try {
  assert.equal(errors.length, 0, 'no console errors: ' + JSON.stringify(errors))
  assert.equal(out.smShown, true, 'the branch-switch confirm dialog opens')
  assert.equal(out.smContentSized, true, 'the small dialog is content-sized, not near-fullscreen')
  assert.equal(out.smVerticallyCentered, true, 'the small dialog is vertically centered')
  assert.equal(out.smClosed, true, 'Escape dismisses the dialog')
  assert.equal(out.detailTreeRow, true, 'the commit detail file tree renders')
  assert.equal(out.diffModalShown, true, 'the commit file-diff modal opens')
  assert.equal(out.diffFits, true, 'the diff modal fits inside the viewport')
  assert.ok(out.diffTopGap >= 20, 'a tappable backdrop strip remains above the diff modal: ' + out.diffTopGap)
  assert.ok(out.diffBottomGap >= 20, 'a tappable backdrop strip remains below the diff modal: ' + out.diffBottomGap)
  assert.equal(out.barRows, 2, 'the compact modal bar splits into two rows')
  assert.equal(out.barCtrlRowHasSeg, true, 'the second row holds the mode seg')
  assert.equal(out.barCtrlRowHasClose, true, 'the second row holds the close button')
  assert.equal(out.barCloseBordered, true, 'the close button carries a border')
  assert.equal(out.barCloseAtRowEnd, true, 'the close button sits at the far right of the second row')
  assert.equal(out.barSegOneLine, true, 'the seg buttons sit side by side on one line')
  assert.equal(out.barSegEvenWidth, true, 'the seg buttons are evenly sized')
  console.log('e2e run4.mjs: PASS', JSON.stringify(out))
} catch (e) {
  console.error('e2e run4.mjs: FAIL', e.message)
  console.error(JSON.stringify(out, null, 2))
  process.exit(1)
} finally {
  await browser.close()
}
