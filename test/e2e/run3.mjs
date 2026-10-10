/**
 * E2E: compact (mobile) layout — the panel at a phone width switches to the
 * single-column drill-in UX. Asserts: the layout attribute flips, overview
 * drills list → detail → back, the branch filter opens as a bottom sheet
 * (Escape and backdrop both dismiss), Changes drills list → diff → back with
 * the split default rendering unified, Files drills tree → preview → back,
 * no subpage scrolls horizontally, and widening restores the wide layout.
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
  staged: 0, modified: 3, untracked: 1, ahead: 0, behind: 2, hasUpstream: true,
  remote: { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' },
  lastCommit: null,
  changes: [
    { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
  ],
  stats: { fileCount: 2, staged: 0, modified: 2, untracked: 0, insertions: 3, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'split', checkedAt: Date.now(),
}

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

const out = await page.evaluate(async (snap) => {
  const result = {}
  const entry = window.__getLoaded()
  if (!entry || typeof entry.apply !== 'function') return { error: 'plugin did not load' }

  const connection = {
    rpc: {
      call: async (_channel, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'gitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
        if (endpoint === 'gitPanel/query') {
          const q = request.query
          if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'feature', shortHash: 'd196623' }, { name: 'main', shortHash: 'de54fc0' }], remote: [] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: ['Tester'] } } }
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 2, commits: [
            { hash: 'd196623aaa', shortHash: 'd196623', subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString(), parents: ['de54fc0bbb'], refs: [{ kind: 'branch', name: 'feature', head: false }] },
            { hash: 'de54fc0bbb', shortHash: 'de54fc0', subject: 'init: first commit', author: 'Tester', dateIso: new Date().toISOString(), parents: [], refs: [{ kind: 'branch', name: 'main', head: true }] },
          ] } } }
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: q.ref, shortHash: q.ref.slice(0, 7), subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString() }, body: 'detailed body text', stats: [{ path: 'index.ts', status: 'modified' }] } } }
          if (q.kind === 'diff') return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n line1\n+line2\n' } } }
          if (q.kind === 'dir-list') {
            if (q.path === '') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: '', truncated: false, entries: [
              { name: 'src', dir: true }, { name: 'a.txt', dir: false, size: 12 },
            ] } } }
            return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries: [{ name: 'index.ts', dir: false, size: 40 }] } } }
          }
          if (q.kind === 'file-content') return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: 'const x = 1\n', lines: 1 } } }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: 'init: first commit' } } }
          if (q.kind === 'pull-preview') return { ok: true, value: { ok: true, value: { kind: 'pull-preview', hasUpstream: true, commits: 2, files: 3, insertions: 10, deletions: 4 } } }
        }
        if (endpoint === 'gitPanel/run') {
          // Delay the fast-forward pull so the busy overlay is observable; keep
          // the dirty fixture (ff pull doesn't touch the work tree) so later
          // Changes-tab assertions still see the change list — only the branch
          // catches up to the remote (behind → 0).
          if (request?.action?.kind === 'pull-ff') {
            return new Promise((resolve) => setTimeout(() => resolve({ ok: true, value: { ok: true, snapshot: { ...snap, ahead: 0, behind: 0 } } }), 250))
          }
          return { ok: true, value: { ok: true, snapshot: snap } }
        }
        if (endpoint === 'gitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: false } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }

  const registered = {}
  const services = { connection }
  const ctx = {
    get: (k) => services[k],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (name, provider) => provider(),
      register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} },
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
  }
  entry.apply(ctx)

  const ReactDOM = window.ReactDOM
  const viewEntry = registered['conversation.view']
  // Start at a phone width so the panel mounts in the compact layout.
  const panelHost = document.getElementById('panel')
  panelHost.style.width = '390px'
  const viewRoot = ReactDOM.createRoot(panelHost)
  viewRoot.render(viewEntry.component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 500))
  const panelRoot = document.querySelector('.gp-panel')
  result.compactLayout = panelRoot.getAttribute('data-layout')
  // Design-doc guard: a phone-width panel must never scroll horizontally.
  // Checks both the panel root (nothing may escape any pane) and the specific
  // pane/root being exercised, so an intermediate overflow:hidden can't mask it.
  const rootFits = (el) => el != null && el.scrollWidth <= el.clientWidth

  // Dirty workspace defaults to Changes; go to the Overview tab first.
  const tabByText = (txt) => [...document.querySelectorAll('.gp-tab')].find((t) => (t.textContent || '').includes(txt))
  tabByText('tab.overview')?.click()
  await new Promise((r) => setTimeout(r, 400))

  // Overview compact: single column, two-line rows, no side branch column.
  result.ovSingleColumn = document.querySelector('.gp-overview--compact') !== null
  result.ovNoLeftColumn = document.querySelector('.gp-overview--compact .gp-col--left') === null
  result.ovTwoLineRows = document.querySelector('.gp-commit-row--compact .gp-commit-lines') !== null
  result.ovGraphStillDrawn = document.querySelector('.gp-commit-row--compact .gp-graph-svg') !== null
  result.ovNoHoverCard = document.querySelector('.gp-hovercard') === null
  result.ovfOverview = rootFits(panelRoot) && rootFits(document.querySelector('.gp-overview--compact'))

  // Branch filter is a bottom sheet: open it, select 'feature', it closes and
  // the filter button reflects the active ref.
  const filterBtn = [...document.querySelectorAll('.gp-toolbar .gp-btn')].find((b) => (b.textContent || '').includes('overview.filterBranch'))
  result.ovHasFilterButton = filterBtn != null
  filterBtn?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.sheetOpened = document.querySelector('.gp-sheet') !== null
  // Escape dismisses the dialog (a11y parity with the file-diff modal).
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 150))
  result.sheetClosedByEscape = document.querySelector('.gp-sheet') === null
  filterBtn?.click()
  await new Promise((r) => setTimeout(r, 200))
  const featureRow = [...document.querySelectorAll('.gp-sheet .gp-branch-row')].find((r) => (r.textContent || '').includes('feature'))
  featureRow?.click()
  await new Promise((r) => setTimeout(r, 300))
  result.sheetClosedAfterPick = document.querySelector('.gp-sheet') === null
  result.filterButtonShowsRef = [...document.querySelectorAll('.gp-toolbar .gp-btn')].some((b) => (b.textContent || '').includes('feature'))

  // Drill into a commit → detail pane with a back button; back returns to list.
  const firstCommit = document.querySelector('.gp-commit-row')
  firstCommit?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.ovDrilledToDetail = document.querySelector('.gp-overview--compact .gp-detail') !== null && document.querySelector('.gp-overview--compact .gp-commit-row') === null
  result.ovDetailHasBack = [...document.querySelectorAll('.gp-subhead__back')].some((b) => (b.textContent || '').includes('overview.backToList'))
  result.ovDetailShowsFiles = document.querySelector('.gp-detail__files') !== null
  result.ovfOverviewDrill = rootFits(panelRoot) && rootFits(document.querySelector('.gp-detail'))
  document.querySelector('.gp-subhead__back')?.click()
  await new Promise((r) => setTimeout(r, 300))
  result.ovBackToList = document.querySelector('.gp-overview--compact .gp-commit-row') !== null

  // Left-column status bar (compact renders it at the overview footer): the
  // GitHub repo link opens the parsed web URL, the branch is 2 behind, and the
  // pull button opens a fast-forward confirm dialog.
  const statusbar = document.querySelector('.gp-overview--compact .gp-statusbar')
  result.statusBarShown = statusbar !== null
  const repoLink = statusbar?.querySelector('a.gp-statusbar__repo')
  result.statusRepoHref = repoLink?.getAttribute('href') ?? null
  result.statusRepoNewTab = repoLink?.getAttribute('target') === '_blank'
  result.statusBehindShown = (statusbar?.querySelector('.gp-statusbar__state')?.textContent || '').includes('status.behind')
  const pullBtn = statusbar?.querySelector('.gp-statusbar__pull')
  result.statusPullShown = pullBtn != null
  pullBtn?.click()
  await new Promise((r) => setTimeout(r, 150))
  result.statusPullConfirmOpened = [...document.querySelectorAll('.gp-modal__path')].some((n) => (n.textContent || '').includes('status.pullConfirmTitle'))
  // The confirm shows the resolved incoming scope (highlighted node, not loading).
  result.statusPullScopeShown = (() => {
    const el = document.querySelector('.gp-pullscope')
    if (el == null) return false
    const txt = el.textContent || ''
    return txt.includes('status.pullScope') && !el.classList.contains('gp-pullscope--loading')
  })()
  // Click the confirm → the pull runs (mock delays 250ms): a busy overlay with a
  // spinner covers the dialog mid-flight, then success closes the dialog.
  const confirmBtn = [...document.querySelectorAll('.gp-modal__footer .gp-btn--primary')].find((b) => (b.textContent || '').includes('status.pullConfirm'))
  confirmBtn?.click()
  await new Promise((r) => setTimeout(r, 90))
  result.statusPullOverlayShown = document.querySelector('.gp-modal__overlay') !== null
  result.statusPullSpinnerShown = document.querySelector('.gp-modal__overlay .gp-spinner') !== null
  result.statusPullLabelShown = (document.querySelector('.gp-modal__overlay .gp-modal__overlay-label')?.textContent || '').includes('status.pulling')
  // No progress bar — only a spinner + the "syncing" label (no real % to show).
  result.statusPullNoProgressBar = document.querySelector('.gp-modal__overlay .gp-progress') === null
  // Escape is swallowed while busy, so the dialog stays until the pull resolves.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 40))
  result.statusPullOverlayKeptOnEscape = document.querySelector('.gp-modal__overlay') !== null
  await new Promise((r) => setTimeout(r, 300))
  result.statusPullConfirmClosed = [...document.querySelectorAll('.gp-modal__path')].every((n) => !(n.textContent || '').includes('status.pullConfirmTitle'))

  // Changes compact: drill list → diff → back.
  tabByText('tab.changes')?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.chSingleColumn = document.querySelector('.gp-changes--compact') !== null
  result.chListShown = document.querySelector('.gp-changes--compact .gp-changes__left') !== null && document.querySelector('.gp-changes--compact .gp-commitbox') !== null
  result.ovfChangesList = rootFits(panelRoot) && rootFits(document.querySelector('.gp-changes--compact'))
  const chFileRow = document.querySelector('.gp-file-row')
  chFileRow?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.chDrilledToDiff = document.querySelector('.gp-changes--compact .gp-changes__right') !== null && document.querySelector('.gp-changes--compact .gp-commitbox') === null
  result.chDiffHasBack = [...document.querySelectorAll('.gp-diff__toolbar .gp-subhead__back')].some((b) => (b.textContent || '').includes('changes.backToList'))
  // Compact drops the side-by-side mode button from the diff seg.
  result.chNoSplitButton = [...document.querySelectorAll('.gp-diff__toolbar .gp-seg__btn')].every((b) => (b.textContent || '') !== 'diff.split')
  // The fixture's defaultDiffView is 'split', so compact must fall back to
  // rendering unified — button absence alone wouldn't prove the render mode.
  result.chUnifiedRender = document.querySelector('.gp-changes--compact .gp-diff__unified') !== null
  result.chNoSideRender = document.querySelector('.gp-changes--compact .gp-diff__side') === null
  result.chUnifiedActive = [...document.querySelectorAll('.gp-diff__toolbar .gp-seg__btn--active')].some((b) => (b.textContent || '') === 'diff.unified')
  result.ovfChangesDrill = rootFits(panelRoot) && rootFits(document.querySelector('.gp-changes--compact'))
  document.querySelector('.gp-diff__toolbar .gp-subhead__back')?.click()
  await new Promise((r) => setTimeout(r, 300))
  result.chBackToList = document.querySelector('.gp-changes--compact .gp-commitbox') !== null

  // Files compact: drill tree → preview → back.
  tabByText('tab.files')?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.flTreeShown = document.querySelector('.gp-files--compact .gp-files__tree') !== null
  result.ovfFilesTree = rootFits(panelRoot) && rootFits(document.querySelector('.gp-files--compact'))
  const txtRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('a.txt'))
  txtRow?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.flDrilledToPreview = document.querySelector('.gp-files--compact .gp-files__preview') !== null && document.querySelector('.gp-files--compact .gp-files__tree') === null
  result.flPreviewHasBack = [...document.querySelectorAll('.gp-files__bar .gp-subhead__back')].some((b) => (b.textContent || '').includes('files.backToTree'))
  result.ovfFilesDrill = rootFits(panelRoot) && rootFits(document.querySelector('.gp-files--compact'))
  document.querySelector('.gp-files__bar .gp-subhead__back')?.click()
  await new Promise((r) => setTimeout(r, 300))
  result.flBackToTree = document.querySelector('.gp-files--compact .gp-files__tree') !== null

  // Widen the panel → the wide three-column layout returns.
  panelHost.style.width = '1000px'
  await new Promise((r) => setTimeout(r, 200))
  result.restoredWide = panelRoot.getAttribute('data-layout') === 'wide'
  result.ovfWide = rootFits(panelRoot)
  tabByText('tab.overview')?.click()
  await new Promise((r) => setTimeout(r, 300))
  result.wideHasThreeColumns = document.querySelector('.gp-col--left') !== null && document.querySelector('.gp-col--mid') !== null && document.querySelector('.gp-col--right') !== null
  // The status bar lives inside the wide left column (below the scrolling list).
  result.wideStatusBarInLeft = document.querySelector('.gp-col--left .gp-statusbar') !== null && document.querySelector('.gp-col--left .gp-col-left__scroll') !== null
  return result
}, SNAP)

await browser.close()

try {
  assert.equal(out.error, undefined, out.error)
  assert.equal(out.compactLayout, 'compact', 'a phone-width panel mounts in the compact layout')
  assert.equal(out.ovSingleColumn, true, 'overview collapses to a single compact column')
  assert.equal(out.ovNoLeftColumn, true, 'the always-on branch side column is gone in compact')
  assert.equal(out.ovTwoLineRows, true, 'compact commit rows stack subject + meta on two lines')
  assert.equal(out.ovGraphStillDrawn, true, 'the commit graph still renders in compact rows')
  assert.equal(out.ovNoHoverCard, true, 'no hover card in compact (tap drills in instead)')
  assert.equal(out.ovfOverview, true, 'compact overview fits without horizontal overflow')
  assert.equal(out.ovfOverviewDrill, true, 'the commit detail pane fits without horizontal overflow')
  assert.equal(out.ovHasFilterButton, true, 'compact overview exposes a branch-filter button')
  assert.equal(out.sheetOpened, true, 'the branch filter opens as a bottom sheet')
  assert.equal(out.sheetClosedByEscape, true, 'Escape dismisses the bottom sheet')
  assert.equal(out.sheetClosedAfterPick, true, 'picking a branch closes the sheet')
  assert.equal(out.filterButtonShowsRef, true, 'the filter button reflects the active ref')
  assert.equal(out.ovDrilledToDetail, true, 'tapping a commit drills into the detail pane')
  assert.equal(out.ovDetailHasBack, true, 'the detail pane shows a back-to-list button')
  assert.equal(out.ovDetailShowsFiles, true, 'the detail pane lists the commit changed files')
  assert.equal(out.ovBackToList, true, 'back returns to the commit list')
  assert.equal(out.statusBarShown, true, 'the overview renders a left-column status bar')
  assert.equal(out.statusRepoHref, 'https://github.com/owner/repo', 'the status bar links to the parsed GitHub repo page')
  assert.equal(out.statusRepoNewTab, true, 'the repo link opens in a new tab')
  assert.equal(out.statusBehindShown, true, 'the status bar reports the behind count')
  assert.equal(out.statusPullShown, true, 'a strictly-behind branch offers a pull button')
  assert.equal(out.statusPullConfirmOpened, true, 'pull opens a fast-forward confirm dialog')
  assert.equal(out.statusPullScopeShown, true, 'the confirm shows the incoming fast-forward scope')
  assert.equal(out.statusPullOverlayShown, true, 'confirming pull shows a busy overlay over the dialog')
  assert.equal(out.statusPullSpinnerShown, true, 'the busy overlay carries a spinner')
  assert.equal(out.statusPullLabelShown, true, 'the busy overlay shows the syncing label')
  assert.equal(out.statusPullNoProgressBar, true, 'the busy overlay has no progress bar (no real % available)')
  assert.equal(out.statusPullOverlayKeptOnEscape, true, 'Escape does not dismiss the dialog while the pull is in flight')
  assert.equal(out.statusPullConfirmClosed, true, 'a successful pull closes the confirm dialog')
  assert.equal(out.chSingleColumn, true, 'changes collapses to a single compact column')
  assert.equal(out.chListShown, true, 'the compact changes list shows the commit box')
  assert.equal(out.ovfChangesList, true, 'the compact changes list fits without horizontal overflow')
  assert.equal(out.chDrilledToDiff, true, 'tapping a change drills into the diff pane')
  assert.equal(out.chDiffHasBack, true, 'the compact diff pane shows a back-to-list button')
  assert.equal(out.chNoSplitButton, true, 'the compact diff drops the side-by-side mode')
  assert.equal(out.chUnifiedRender, true, 'the split default falls back to unified rendering')
  assert.equal(out.chNoSideRender, true, 'compact never renders the side-by-side diff layout')
  assert.equal(out.chUnifiedActive, true, 'the unified seg button is the active one')
  assert.equal(out.ovfChangesDrill, true, 'the compact diff pane fits without horizontal overflow')
  assert.equal(out.chBackToList, true, 'back returns to the change list')
  assert.equal(out.flTreeShown, true, 'files shows the tree full width in compact')
  assert.equal(out.ovfFilesTree, true, 'the compact file tree fits without horizontal overflow')
  assert.equal(out.flDrilledToPreview, true, 'tapping a file drills into the preview pane')
  assert.equal(out.flPreviewHasBack, true, 'the compact preview shows a back-to-tree button')
  assert.equal(out.ovfFilesDrill, true, 'the compact preview fits without horizontal overflow')
  assert.equal(out.flBackToTree, true, 'back returns to the file tree')
  assert.equal(out.restoredWide, true, 'widening the panel restores the wide layout')
  assert.equal(out.ovfWide, true, 'the widened panel fits without horizontal overflow')
  assert.equal(out.wideHasThreeColumns, true, 'the wide overview shows all three columns again')
  assert.equal(out.wideStatusBarInLeft, true, 'the wide left column keeps the status bar below the scrolling branch list')
  assert.equal(errors.length, 0, 'no console errors: ' + JSON.stringify(errors))
  console.log('e2e run3.mjs: PASS', JSON.stringify(out))
} catch (e) {
  console.error('e2e run3.mjs: FAIL', e.message)
  console.error(JSON.stringify(out, null, 2))
  process.exit(1)
}
