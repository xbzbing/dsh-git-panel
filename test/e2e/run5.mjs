/**
 * E2E: the trailing "expand down" control is exact, never a dead button.
 *
 * git caps trailing context at -U, so a last hunk that ends with a full U-line
 * context run looks identical whether the hunk is mid-file or the file ends
 * exactly there. The view decides from the host-reported new-side line count,
 * so the control is offered only when lines really follow the last hunk. Before
 * that, the file-end case rendered a button that revealed nothing and then
 * vanished.
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
  root: FIXTURE_ROOT, branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

// One hunk that ends the file: the change sits at line 7 of a 10-line file, so
// the trailing context run is exactly 3 = -U. Its new side is lines 1..10, i.e.
// rightNo ends at 11 — the number the view compares against newLines.
const DIFF = [
  'diff --git a/f.txt b/f.txt',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@ -1,10 +1,10 @@',
  ' l1',
  ' l2',
  ' l3',
  ' l4',
  ' l5',
  ' l6',
  '-OLD7',
  '+NEW7',
  ' l8',
  ' l9',
  ' l10',
  '',
].join('\n')

const browser = await chromium.launch()

/**
 * Render the panel with one commit + one file, open the commit's file diff, and
 * report the gap controls it shows. `newLines` is the host's new-side count:
 * 10 = the file ends at the last shown line, 30 = 20 lines follow it.
 */
async function scenario(newLines) {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  const out = await page.evaluate(async ({ snap, diff, newLines }) => {
    const result = {}
    const fileLinesQueries = []
    const connection = {
      rpc: {
        call: async (_ch, endpoint, payload) => {
          const request = payload && payload.args && payload.args.request
          if (endpoint === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
          if (endpoint === 'gitPanel/query') {
            const q = request.query
            if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: 'de54fc0' }], remote: [] } } }
            if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
            if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: ['Tester'] } } }
            if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 1, commits: [{ hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'feat: tail', author: 'Tester', dateIso: new Date().toISOString(), parents: [], refs: [] }] } } }
            if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'feat: tail', author: 'Tester', dateIso: new Date().toISOString() }, body: '', stats: [{ path: 'f.txt', status: 'modified' }], insertions: 1, deletions: 1 } } }
            if (q.kind === 'diff') return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: diff, newLines } } }
            if (q.kind === 'file-lines') {
              fileLinesQueries.push({ start: q.start, end: q.end })
              const lines = Array.from({ length: q.end - q.start + 1 }, (_, i) => `hidden${q.start + i}`)
              return { ok: true, value: { ok: true, value: { kind: 'file-lines', path: q.path, start: q.start, lines, eof: true } } }
            }
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
    ReactDOM.createRoot(document.getElementById('panel')).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 500))

    document.querySelector('.gp-commit-row')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const treeRow = [...document.querySelectorAll('.gp-tree-row')].find((n) => (n.textContent || '').includes('f.txt'))
    result.detailTreeRow = treeRow !== undefined
    treeRow?.click()
    await new Promise((r) => setTimeout(r, 400))

    result.modalShown = document.querySelector('.gp-modal') !== null
    result.gapButtons = [...document.querySelectorAll('.gp-gap__btn')].map((b) => b.textContent || '')
    result.rows = document.querySelectorAll('.gp-diff-uni__code').length
    // Expand whatever control is offered (the exact "expand all N" one).
    document.querySelector('.gp-gap__btn')?.click()
    await new Promise((r) => setTimeout(r, 400))
    result.gapButtonsAfter = [...document.querySelectorAll('.gp-gap__btn')].map((b) => b.textContent || '')
    result.rowsAfter = document.querySelectorAll('.gp-diff-uni__code').length
    result.fileLinesQueries = fileLinesQueries
    return result
  }, { snap: SNAP, diff: DIFF, newLines })
  await page.close()
  return { out, errors }
}

/**
 * The changes tab reaches the same view through a different wiring
 * (`ChangesTab`'s own diff payload), so the contract is asserted there too: the
 * count must travel with the text on that path as well.
 */
async function changesScenario(newLines) {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  const snap = {
    ...SNAP, dirty: true, modified: 1,
    changes: [{ path: 'f.txt', status: 'modified', staged: false, isDirectory: false }],
    stats: { fileCount: 1, staged: 0, modified: 1, untracked: 0, insertions: 1, deletions: 1, lastChangeAt: Date.now(), headCommittedAt: null },
  }
  const out = await page.evaluate(async ({ snap, diff, newLines }) => {
    const result = {}
    const fileLinesQueries = []
    const connection = {
      rpc: {
        call: async (_ch, endpoint, payload) => {
          const request = payload && payload.args && payload.args.request
          if (endpoint === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
          if (endpoint === 'gitPanel/query') {
            const q = request.query
            if (q.kind === 'diff') return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: diff, newLines } } }
            if (q.kind === 'file-lines') {
              fileLinesQueries.push({ start: q.start, end: q.end })
              const lines = Array.from({ length: q.end - q.start + 1 }, (_, i) => `hidden${q.start + i}`)
              return { ok: true, value: { ok: true, value: { kind: 'file-lines', path: q.path, start: q.start, lines, eof: true } } }
            }
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
    window.ReactDOM.createRoot(document.getElementById('panel')).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 500))
    const tab = [...document.querySelectorAll('.gp-tab')].find((t) => (t.textContent || '').includes('tab.changes'))
    if (tab) { tab.click(); await new Promise((r) => setTimeout(r, 400)) }
    const row = [...document.querySelectorAll('.gp-file-row')].find((r) => (r.textContent || '').includes('f.txt'))
    result.rowShown = row !== undefined
    if (row) { row.click(); await new Promise((r) => setTimeout(r, 400)) }
    result.gapButtons = [...document.querySelectorAll('.gp-gap__btn')].map((b) => b.textContent || '')
    document.querySelector('.gp-gap__btn')?.click()
    await new Promise((r) => setTimeout(r, 400))
    result.fileLinesQueries = fileLinesQueries
    result.gapButtonsAfter = [...document.querySelectorAll('.gp-gap__btn')].map((b) => b.textContent || '')
    return result
  }, { snap, diff: DIFF, newLines })
  await page.close()
  return { out, errors }
}

try {
  // A: the file ends exactly at the last shown line → nothing can hide below the
  // last hunk, so no trailing control may be rendered (the dead button).
  const atEof = await scenario(10)
  assert.equal(atEof.errors.length, 0, 'no console errors: ' + JSON.stringify(atEof.errors))
  assert.equal(atEof.out.detailTreeRow, true, 'the commit detail file tree renders')
  assert.equal(atEof.out.modalShown, true, 'the commit file-diff modal opens')
  assert.equal(atEof.out.gapButtons.length, 0, 'no control at all when the hunk reaches EOF: ' + JSON.stringify(atEof.out.gapButtons))
  assert.equal(atEof.out.fileLinesQueries.length, 0, 'and no probe query is issued')

  // B: the same hunk with 20 lines following it → the control exists and its
  // count is exact (20 = one GAP_STEP window, so it is offered whole).
  const midFile = await scenario(30)
  assert.equal(midFile.errors.length, 0, 'no console errors: ' + JSON.stringify(midFile.errors))
  assert.equal(midFile.out.modalShown, true, 'the commit file-diff modal opens')
  assert.deepEqual(midFile.out.gapButtons, ['diff.expandGap'], 'exactly the trailing control, count known')
  assert.equal(midFile.out.rowsAfter > midFile.out.rows, true, 'expanding reveals the hidden lines')
  assert.deepEqual(midFile.out.fileLinesQueries, [{ start: 11, end: 30 }], 'the whole counted region in one request')
  assert.equal(midFile.out.gapButtonsAfter.length, 0, 'consumed with no residual')

  // C: the changes tab wires the count through its own payload — the same
  // control, the same exact range, no probe.
  const changes = await changesScenario(30)
  assert.equal(changes.errors.length, 0, 'no console errors: ' + JSON.stringify(changes.errors))
  assert.equal(changes.out.rowShown, true, 'the change row renders')
  assert.deepEqual(changes.out.gapButtons, ['diff.expandGap'], 'exact trailing control on the changes tab')
  assert.deepEqual(changes.out.fileLinesQueries, [{ start: 11, end: 30 }], 'same exact range from the changes tab')
  assert.equal(changes.out.gapButtonsAfter.length, 0, 'consumed with no residual')
  console.log('e2e run5.mjs: PASS', JSON.stringify({ atEof: atEof.out.gapButtons, midFile: midFile.out.gapButtons, changes: changes.out.gapButtons }))
} catch (e) {
  console.error('e2e run5.mjs: FAIL', e.message)
  process.exit(1)
} finally {
  await browser.close()
}
