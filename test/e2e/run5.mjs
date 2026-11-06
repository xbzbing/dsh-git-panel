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
          if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
          if (endpoint === 'dbGitPanel/query') {
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
          if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
          if (endpoint === 'dbGitPanel/query') {
            const q = request.query
            if (q.kind === 'diff') return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: diff, newLines, truncated: true } } }
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
    const tab = [...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => (t.textContent || '').includes('tab.changes'))
    if (tab) { tab.click(); await new Promise((r) => setTimeout(r, 400)) }
    const row = [...document.querySelectorAll('.gp-file-row')].find((r) => (r.textContent || '').includes('f.txt'))
    result.rowShown = row !== undefined
    if (row) { row.click(); await new Promise((r) => setTimeout(r, 400)) }
    result.gapButtons = [...document.querySelectorAll('.gp-gap__btn')].map((b) => b.textContent || '')
    document.querySelector('.gp-gap__btn')?.click()
    await new Promise((r) => setTimeout(r, 400))
    result.fileLinesQueries = fileLinesQueries
    result.gapButtonsAfter = [...document.querySelectorAll('.gp-gap__btn')].map((b) => b.textContent || '')
    // A host-flagged truncated diff must say so in the pane (the harness `t`
    // returns the key, so this asserts the branch, not the copy).
    result.truncatedNotice = document.querySelector('.gp-notice')?.textContent ?? null
    return result
  }, { snap, diff: DIFF, newLines })
  await page.close()
  return { out, errors }
}

/**
 * D: an "expand all" on a large file must mount only a window of rows, not the
 * whole file. 600 lines of a single-hunk diff: the modal may mount a few dozen
 * code cells, the spacer must still reserve the full scroll height, and
 * scrolling to the end must move the window to the tail of the file.
 */
async function virtScenario() {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })

  const LINES = 600
  const body = []
  for (let i = 1; i < LINES - 1; i++) body.push(` line ${i}`)
  body.push('-OLD', '+NEW')
  const big = [
    'diff --git a/big.txt b/big.txt', '--- a/big.txt', '+++ b/big.txt',
    `@@ -1,${LINES} +1,${LINES} @@`, ...body, '',
  ].join('\n')

  // Clean tree: the panel opens on Git 总览, where the commit row lives.
  const snap = { ...SNAP }

  const out = await page.evaluate(async ({ snap, big, lines }) => {
    const result = {}
    const diffQueries = []
    const connection = {
      rpc: {
        call: async (_ch, endpoint, payload) => {
          const request = payload && payload.args && payload.args.request
          if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
          if (endpoint === 'dbGitPanel/query') {
            const q = request.query
            if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: 'de54fc0' }], remote: [] } } }
            if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
            if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: ['Tester'] } } }
            if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 1, commits: [{ hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'feat: big', author: 'Tester', dateIso: new Date().toISOString(), parents: [], refs: [] }] } } }
            if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'feat: big', author: 'Tester', dateIso: new Date().toISOString() }, body: '', stats: [{ path: 'big.txt', status: 'modified' }], insertions: 1, deletions: 1 } } }
            if (q.kind === 'diff') {
              diffQueries.push(q.context ?? null)
              // The expand request reports a new side far past the window, so the
              // capped-expansion notice has to appear.
              return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: big, newLines: q.context !== undefined ? 9000 : lines } } }
            }
            if (q.kind === 'file-lines') {
              // Serve the hidden region so consuming the gap can be observed.
              const slice = Array.from({ length: q.end - q.start + 1 }, (_, i) => `hidden ${q.start + i}`)
              return { ok: true, value: { ok: true, value: { kind: 'file-lines', path: q.path, start: q.start, lines: slice, eof: q.end >= 9000 } } }
            }
          }
          return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
        },
      },
    }
    const registered = {}
    const ctx = {
      get: (k) => ({ connection })[k], effect: (cb) => { try { cb() } catch { /* */ } },
      on: () => () => {}, inject: (_d, cb) => cb(ctx),
      slots: { inject: (_n, p) => p(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
      locale: { register: () => () => {}, bind: () => (k) => k },
    }
    window.__getLoaded().apply(ctx)
    window.ReactDOM.createRoot(document.getElementById('panel')).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 500))

    document.querySelector('.gp-commit-row')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const treeRow = [...document.querySelectorAll('.gp-tree-row')].find((n) => (n.textContent || '').includes('big.txt'))
    treeRow?.click()
    await new Promise((r) => setTimeout(r, 400))

    const mounted = () => document.querySelectorAll('.gp-diff-uni__code').length
    // DiffView unmounts while the modal re-queries (openFileDiff nulls the data),
    // so the scroller element must be looked up again after any expand click.
    const scrollerNow = () => document.querySelector('.gp-diff__scroll')
    const maxNo = () => Math.max(0, ...[...document.querySelectorAll('.gp-diff-no')].map((n) => Number(n.textContent) || 0))
    const scroller = document.querySelector('.gp-diff__scroll')
    result.mounted = mounted()
    result.totalRows = lines
    result.maxNoTop = maxNo()
    result.scrollHeight = scroller ? scroller.scrollHeight : 0
    result.clientHeight = scroller ? scroller.clientHeight : 0
    result.spacerCount = document.querySelectorAll('.gp-diff__spacer').length
    // The trailing spacer must reserve the rows below the window, so the
    // scrollbar reflects the whole file.
    result.tailSpacer = (() => {
      const sp = [...document.querySelectorAll('.gp-diff__spacer')]
      const tail = sp[sp.length - 1]
      return tail ? parseInt(tail.style.height || '0', 10) : 0
    })()

    // Scroll to the end: the window must move to the tail of the file.
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => setTimeout(r, 120))
    }
    result.maxNoBottom = maxNo()
    result.mountedAtBottom = mounted()

    // The one-sided (before/after) and split modes window their own row lists;
    // switching modes must not fall back to laying the whole file out.
    const cellsIn = () => document.querySelectorAll('.gp-diff-cell').length
    // Unified has no switch of its own: pressing the active switch returns to it.
    const clickMode = async (name) => {
      const btn = name === 'unified'
        ? document.querySelector('.gp-diff__mode[aria-pressed="true"]')
        : document.querySelector(`.gp-diff__mode[data-diff-mode="${name}"]`)
      if (btn) { btn.click(); await new Promise((r) => setTimeout(r, 250)) }
      return cellsIn()
    }
    const switchState = (name) => {
      const btn = document.querySelector(`.gp-diff__mode[data-diff-mode="${name}"]`)
      if (btn === null) return null
      return {
        pressed: btn.getAttribute('aria-pressed'),
        title: btn.getAttribute('title'),
        icon: btn.querySelector('svg') !== null,
        transform: getComputedStyle(btn.querySelector('svg')).transform,
      }
    }
    result.beforeModeCells = await clickMode('before')
    result.beforeSwitch = switchState('before')
    result.pressedWhileBefore = switchState('after')
    result.afterModeCells = await clickMode('after')
    result.afterSwitch = switchState('after')
    result.splitModeCells = await clickMode('split')
    result.splitSwitch = switchState('split')
    // The capped notice is derived from the rows still hidden, so it must be
    // absent before any expansion is asked for.
    result.noticeBeforeExpand = document.querySelector('.gp-notice')?.textContent ?? null
    // 展开全部 must ask for a bounded context (never -U100000) and say so when
    // the window cannot reach the whole file.
    const expandBtn = document.querySelector('.gp-diff__expand')
    expandBtn?.click()
    await new Promise((r) => setTimeout(r, 300))
    result.expandContext = diffQueries[diffQueries.length - 1]
    result.cappedNotice = document.querySelector('.gp-notice')?.textContent ?? null

    // ...and it must disappear once the last hidden region is revealed: the
    // trailing gap row is the last row, so scroll it into the window first.
    const scAfterExpand = scrollerNow()
    if (scAfterExpand) {
      scAfterExpand.scrollTop = scAfterExpand.scrollHeight
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise((r) => setTimeout(r, 150))
    }
    result.gapButtonTexts = [...document.querySelectorAll('.gp-gap__btn')].map((b) => b.textContent)
    result.gapRowCount = document.querySelectorAll('.gp-diff-row--gap').length
    result.scrollTopAtGap = scAfterExpand ? Math.round(scAfterExpand.scrollTop) : -1
    result.scrollHeightAtGap = scAfterExpand ? scAfterExpand.scrollHeight : -1
    result.mountedAtGap = mounted()
    const gapAll = [...document.querySelectorAll('.gp-gap__btn')].find((b) => (b.textContent || '') === 'diff.expandGap')
    result.gapAllFound = gapAll !== undefined
    gapAll?.click()
    await new Promise((r) => setTimeout(r, 400))
    result.noticeAfterConsumingGap = document.querySelector('.gp-notice')?.textContent ?? null

    // Far Find jump: back to unified, at the top, then jump to a match ~550 rows
    // down. The window must SNAP to the match's neighbourhood — sampling every
    // frame so a one-commit span cannot hide between measurements.
    await clickMode('unified')
    result.unifiedSwitch = switchState('split')
    const scForFind = scrollerNow()
    if (scForFind) {
      scForFind.scrollTop = 0
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
    const findInput = document.querySelector('.gp-find__input')
    result.findOpened = findInput !== null
    if (findInput) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      const t0 = performance.now()
      setter.call(findInput, 'line 550')
      findInput.dispatchEvent(new Event('input', { bubbles: true }))
      let peak = 0
      while (performance.now() - t0 < 700) {
        await new Promise((r) => requestAnimationFrame(r))
        peak = Math.max(peak, mounted())
      }
      result.findPeak = peak
      result.findMatches = document.querySelectorAll('.gp-find-hit').length
      const active = document.querySelector('.gp-find-hit--active')
      result.findActiveInView = active !== null && scForFind !== null
        && active.getBoundingClientRect().top >= scForFind.getBoundingClientRect().top - 1
      findInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    }
    return result
  }, { snap, big, lines: LINES })

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
  assert.equal(changes.out.truncatedNotice, 'diff.truncated', `a host-flagged truncated diff says so (got ${changes.out.truncatedNotice})`)

  // D: a 600-line "expand all" mounts only a window, and the window follows the
  // scrollbar instead of laying the whole file out at once.
  const virt = await virtScenario()
  assert.equal(virt.errors.length, 0, 'no console errors: ' + JSON.stringify(virt.errors))
  assert.equal(virt.out.totalRows, 600, 'fixture sanity: a 600-line new side')
  assert.equal(virt.out.mounted > 0, true, 'the top of the file is mounted')
  assert.equal(virt.out.mounted < 100, true, `only a window is mounted, not 600 rows (got ${virt.out.mounted})`)
  assert.equal(virt.out.maxNoTop < 100, true, `the initial window sits at the top (max line ${virt.out.maxNoTop})`)
  assert.equal(virt.out.spacerCount > 0, true, 'the rows outside the window are reserved by a spacer')
  assert.equal(virt.out.tailSpacer > 0, true, `the trailing spacer reserves the rest of the file (got ${virt.out.tailSpacer})`)
  assert.equal(virt.out.scrollHeight > virt.out.clientHeight * 5, true, `the scroller still spans the whole file (${virt.out.scrollHeight} vs ${virt.out.clientHeight})`)
  assert.equal(virt.out.maxNoBottom > 500, true, `scrolling to the end moves the window to the tail (max line ${virt.out.maxNoBottom})`)
  assert.equal(virt.out.mountedAtBottom < 100, true, `still windowed at the end (got ${virt.out.mountedAtBottom})`)
  for (const [name, cells] of [['before', virt.out.beforeModeCells], ['after', virt.out.afterModeCells], ['split', virt.out.splitModeCells]]) {
    assert.equal(cells > 0, true, `${name} mode renders rows`)
    assert.equal(cells < 300, true, `${name} mode is windowed too (got ${cells} cells)`)
  }
  // The switches are icon-only and pressed-state driven: the pressed one names
  // the way back to unified, and the compare glyph turns 90° for split.
  assert.deepEqual(virt.out.beforeSwitch, { pressed: 'true', title: 'diff.backToUnified', icon: true, transform: 'none' }, 'the before switch is pressed and offers the way back')
  assert.equal(virt.out.pressedWhileBefore?.pressed, 'false', 'only the active single-side switch is pressed')
  assert.deepEqual(
    { pressed: virt.out.afterSwitch?.pressed, title: virt.out.afterSwitch?.title },
    { pressed: 'true', title: 'diff.backToUnified' },
    'clicking after moves the pressed state',
  )
  assert.deepEqual(
    { pressed: virt.out.splitSwitch?.pressed, title: virt.out.splitSwitch?.title },
    { pressed: 'true', title: 'diff.toUnified' },
    'the split switch reports its pressed state and names the next action',
  )
  assert.notEqual(virt.out.splitSwitch?.transform, 'none', 'the compare glyph rotates once split is on')
  assert.equal(virt.out.unifiedSwitch?.pressed, 'false', 'pressing the active switch returns to unified')

  assert.equal(virt.out.expandContext <= 2000, true, `expand all asks for a bounded context (got ${virt.out.expandContext})`)
  assert.equal(virt.out.expandContext > 0, true, 'expand all still asks for context')
  // The notice is driven by the rows actually left hidden, not by the requested
  // context size, so it must be absent before an expansion and present after one
  // — and go away again once the last gap is consumed.
  assert.equal(virt.out.noticeBeforeExpand, null, `no notice before expanding (got ${virt.out.noticeBeforeExpand})`)
  // The harness `t` returns the key (params are not interpolated there), so the
  // assertion is on the notice's presence and identity.
  assert.equal(virt.out.cappedNotice, 'diff.expandCapped', `a capped expansion says so: ${virt.out.cappedNotice}`)
  assert.equal(virt.out.gapAllFound, true, 'the remaining hidden region offers its expand-all control: ' + JSON.stringify({ texts: virt.out.gapButtonTexts, rows: virt.out.gapRowCount, top: virt.out.scrollTopAtGap, sh: virt.out.scrollHeightAtGap, mounted: virt.out.mountedAtGap }))
  assert.equal(virt.out.noticeAfterConsumingGap, null, `the notice clears once nothing is hidden (got ${virt.out.noticeAfterConsumingGap})`)
  // A far Find jump must snap the window onto the match, never mount the span
  // from the viewport to it (sampled every frame, so a one-commit span is caught).
  assert.equal(virt.out.findOpened, true, 'Ctrl+F opens Find in the diff')
  assert.equal(virt.out.findMatches > 0, true, 'the far token matches')
  assert.equal(virt.out.findActiveInView, true, 'the jumped-to match ends up in view')
  assert.equal(virt.out.findPeak < 100, true, `a far Find jump mounts only the match neighbourhood (peak ${virt.out.findPeak} rows)`)
  console.log('e2e run5.mjs: PASS', JSON.stringify({ atEof: atEof.out.gapButtons, midFile: midFile.out.gapButtons, changes: changes.out.gapButtons, virt: { ctx: virt.out.expandContext, notice: virt.out.cappedNotice, mounted: virt.out.mounted, maxNoTop: virt.out.maxNoTop, maxNoBottom: virt.out.maxNoBottom, findPeak: virt.out.findPeak } }))
} catch (e) {
  console.error('e2e run5.mjs: FAIL', e.message)
  process.exit(1)
} finally {
  await browser.close()
}
