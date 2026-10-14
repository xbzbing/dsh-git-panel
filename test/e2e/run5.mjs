/**
 * E2E: on-demand gap expansion in the commit file-diff modal. The diff's last
 * hunk ends with fewer than U trailing context lines (i.e. git hit EOF), so no
 * trailing "expand down" control may be offered — it used to render one, and
 * clicking it fetched zero lines and silently vanished (a dead button). The
 * between-hunk gap still expands on demand via the file-lines query.
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

// Mirrors the f5b9a54 lib/host/types.js shape: two hunks, the last one ending
// with a short trailing-context run (file has exactly 28 lines — EOF).
const DIFF = [
  'diff --git a/lib/host/types.js b/lib/host/types.js',
  '--- a/lib/host/types.js',
  '+++ b/lib/host/types.js',
  '@@ -1,3 +1,8 @@',
  '+const SUGGEST_LIMITS = {',
  '+  maxBytes: 1,',
  '+  maxOutputTokens: 2,',
  '+  timeoutMs: 3,',
  '+};',
  ' const IMAGE_MIME = {',
  '   png: "image/png",',
  '   jpg: "image/jpeg",',
  '@@ -18,5 +23,6 @@ function imageMimeFor(path) {',
  ' }',
  ' export {',
  '   IMAGE_MIME,',
  '+  SUGGEST_LIMITS,',
  '   imageMimeFor',
  ' };',
  '',
].join('\n')

// The between-hunk hidden region: new lines 9..22.
const FILE_LINES = Array.from({ length: 14 }, (_, i) => `hidden${i + 9}`)

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (msg) => { if (msg.type() ===('error')) errors.push(msg.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

const out = await page.evaluate(async ({ snap, diff, fileLines }) => {
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
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 1, commits: [{ hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'feat: suggest budgets', author: 'Tester', dateIso: new Date().toISOString(), parents: [], refs: [] }] } } }
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'feat: suggest budgets', author: 'Tester', dateIso: new Date().toISOString() }, body: '', stats: [{ path: 'lib/host/types.js', status: 'modified' }], insertions: 6, deletions: 0 } } }
          if (q.kind === 'diff') return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: diff } } }
          if (q.kind === 'file-lines') {
            // Mirror the host: 1-based slice of the new side, eof at file end.
            fileLinesQueries.push({ start: q.start, end: q.end })
            return { ok: true, value: { ok: true, value: { kind: 'file-lines', path: q.path, start: q.start, lines: fileLines, eof: true } } }
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
  const treeRow = [...document.querySelectorAll('.gp-tree-row')].find((n) => (n.textContent || '').includes('types.js'))
  result.detailTreeRow = treeRow !== undefined
  treeRow?.click()
  await new Promise((r) => setTimeout(r, 400))

  const gapLabels = () => [...document.querySelectorAll('.gp-gap__btn')].map((b) => b.textContent || '')
  result.modalShown = document.querySelector('.gp-modal') !== null
  result.gapButtonsBefore = gapLabels()
  result.rowsBefore = document.querySelectorAll('.gp-diff-uni__code').length

  // The between-hunk gap ("expand all 14 lines") reveals hidden context.
  const expandAll = [...document.querySelectorAll('.gp-gap__btn')].find((b) => (b.textContent || '').includes('expandGap'))
  expandAll?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.gapButtonsAfter = gapLabels()
  result.rowsAfter = document.querySelectorAll('.gp-diff-uni__code').length
  result.fileLinesQueries = fileLinesQueries
  return result
}, { snap: SNAP, diff: DIFF, fileLines: FILE_LINES })

try {
  assert.equal(errors.length, 0, 'no console errors: ' + JSON.stringify(errors))
  assert.equal(out.detailTreeRow, true, 'the commit detail file tree renders')
  assert.equal(out.modalShown, true, 'the commit file-diff modal opens')
  // One expand control (the between-hunk gap); NO trailing "expand down" —
  // the last hunk ran into EOF so nothing is hidden below it.
  assert.equal(out.gapButtonsBefore.length, 1, 'exactly the between-hunk gap control: ' + JSON.stringify(out.gapButtonsBefore))
  assert.ok(out.gapButtonsBefore[0].includes('expandGap'), 'the remaining control expands the hidden middle region')
  assert.equal(out.gapButtonsAfter.length, 0, 'the gap control is consumed after expanding')
  assert.ok(out.rowsAfter > out.rowsBefore, 'expanding reveals the hidden lines')
  assert.equal(out.fileLinesQueries.length, 1, 'exactly one file-lines query was issued')
  assert.equal(out.fileLinesQueries[0].start, 9, 'the query targets the first hidden new-side line')
  console.log('e2e run5.mjs: PASS', JSON.stringify(out))
} catch (e) {
  console.error('e2e run5.mjs: FAIL', e.message)
  console.error(JSON.stringify(out, null, 2))
  process.exit(1)
} finally {
  await browser.close()
}
