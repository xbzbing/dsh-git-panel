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
  const runActions = []
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
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: q.ref, shortHash: q.ref.slice(0, 7), subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString() }, body: 'detailed body text', stats: [{ path: 'index.ts', status: 'modified' }], insertions: 27, deletions: 2 } } }
          if (q.kind === 'diff') return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n line1\n+line2\n', newLines: 2 } } }
          if (q.kind === 'dir-list') {
            if (q.path === '') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: '', truncated: false, entries: [
              { name: 'src', dir: true }, { name: 'a.txt', dir: false, size: 12 }, { name: 'README.md', dir: false, size: 24 },
            ] } } }
            return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries: [{ name: 'index.ts', dir: false, size: 40 }] } } }
          }
          if (q.kind === 'file-content') {
            const md = typeof q.path === 'string' && q.path.endsWith('.md')
            // The long line exists so the wrap toggle's scrollWidth assertions
            // can tell a wrapping body from a horizontally scrolling one.
            const long = 'const long = "' + 'x'.repeat(300) + '"\n'
            return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: md ? '# Hello\n\nbody line\n' : 'const x = 1\n' + long, lines: md ? 3 : 2 } } }
          }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: 'init: first commit' } } }
          if (q.kind === 'pull-preview') return { ok: true, value: { ok: true, value: { kind: 'pull-preview', hasUpstream: true, commits: 2, files: 3, insertions: 10, deletions: 4 } } }
        }
        if (endpoint === 'gitPanel/run') {
          runActions.push(request?.action ?? {})
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
  const tabByText = (txt) => [...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => (t.textContent || '').includes(txt))
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
  // Compact history toolbar: branch pill / search / more-toggle share one 30px
  // height and one row; author + since + refresh hide behind the chevron.
  const tb = document.querySelector('.gp-history .gp-toolbar')
  const tbSearch = tb?.querySelector('.gp-search')
  const tbToggle = tb?.querySelector('.gp-toolbar__more-toggle')
  const heights = [filterBtn, tbSearch, tbToggle].map((n) => Math.round(n?.getBoundingClientRect().height ?? 0))
  const centers = [...(tb?.children ?? [])].map((n) => {
    const b = n.getBoundingClientRect()
    return Math.round(b.top + b.height / 2)
  })
  result.ovToolbarEqualHeights = heights.every((v) => v === 30)
  const tbToggleRect = tbToggle?.getBoundingClientRect()
  result.ovMoreToggleSize = tbToggleRect !== undefined
    && Math.round(tbToggleRect.width) === 30 && Math.round(tbToggleRect.height) === 30
  result.ovToolbarOneRow = new Set(centers).size === 1
  result.ovMoreCollapsed = tb?.querySelector('.gp-toolbar__more') === null
    && tb?.querySelectorAll('.gp-select-trigger').length === 0
    && tbToggle?.getAttribute('aria-expanded') === 'false'
  // A collapsed panel must not name an element that does not exist.
  result.ovMoreAriaControls = tbToggle?.getAttribute('aria-controls') === null
  tbToggle?.click()
  await new Promise((r) => setTimeout(r, 200))
  const moreGroup = tb?.querySelector('.gp-toolbar__more')
  result.ovMoreExpanded = moreGroup !== null
    && moreGroup.querySelectorAll('.gp-select-trigger').length === 2
    && moreGroup.querySelector('button[title="overview.fetch"]') !== null
    && tbToggle?.getAttribute('aria-expanded') === 'true'
  result.ovMoreAriaControlsExpanded = tbToggle?.getAttribute('aria-controls') === moreGroup?.id
  result.ovMoreSecondRow = moreGroup !== null
    && Math.round(moreGroup.getBoundingClientRect().top) >= Math.round(tbToggle.getBoundingClientRect().bottom)
  const moreHeights = [...(moreGroup?.querySelectorAll('.gp-select-trigger, button[title="overview.fetch"]') ?? [])]
    .map((n) => Math.round(n.getBoundingClientRect().height))
  result.ovMoreHeights = moreHeights.length === 3 && moreHeights.every((v) => v === 30)
  result.ovfToolbar = rootFits(tb)
  tbToggle?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.ovMoreRecollapsed = tb?.querySelector('.gp-toolbar__more') === null
    && tbToggle?.getAttribute('aria-expanded') === 'false'
    && tbToggle?.getAttribute('aria-controls') === null
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

  // Branch switch in compact: the filter sheet's branch rows carry the switch
  // button (no hover on touch, so the sheet keeps it reachable); using it closes
  // the sheet and opens the confirm dialog, portaled and centered in both layouts.
  result.ovNoToolbarSwitch = ![...document.querySelectorAll('.gp-toolbar .gp-btn')].some((b) => b.getAttribute('title') === 'switch.entry')
  filterBtn?.click()
  await new Promise((r) => setTimeout(r, 200))
  // Match by the full ref name in `title` — a ref nested in a directory row
  // only shows its last path segment.
  const sheetRow = (name) => [...document.querySelectorAll('.gp-sheet .gp-branch-row')].find((r) => (r.getAttribute('title') || '') === name) || null
  result.sheetCurrentNoSwitch = sheetRow('main') !== null && sheetRow('main').querySelector('.gp-branch-row__switch') === null
  const sheetSwitch = sheetRow('feature')?.querySelector('.gp-branch-row__switch') ?? null
  result.sheetHasSwitch = sheetSwitch !== null
  const filterBefore = [...document.querySelectorAll('.gp-toolbar .gp-btn')].map((b) => b.textContent).join('|')
  sheetSwitch?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.switchSheetClosedAfterPick = document.querySelector('.gp-sheet') === null
  result.sheetSwitchKeepsFilter = [...document.querySelectorAll('.gp-toolbar .gp-btn')].map((b) => b.textContent).join('|') === filterBefore
  result.switchConfirmPortaled = document.querySelector('.gp-modal__path')?.textContent === 'switch.confirmTitle'
  ;[...document.querySelectorAll('.gp-modal__footer .gp-btn')].find((b) => (b.textContent || '').includes('switch.confirm'))?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.switchConfirmRan = runActions.some((a) => a.kind === 'branch-checkout' && a.name === 'feature')
  result.switchConfirmClosed = document.querySelector('.gp-modal__path') === null

  // Drill into a commit → detail pane with a back button; back returns to list.
  const firstCommit = document.querySelector('.gp-commit-row')
  firstCommit?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.ovDrilledToDetail = document.querySelector('.gp-overview--compact .gp-detail') !== null && document.querySelector('.gp-overview--compact .gp-commit-row') === null
  result.ovDetailHasBack = [...document.querySelectorAll('.gp-subhead__back')].some((b) => (b.textContent || '').includes('overview.backToList'))
  result.ovBackBtnHeight = Math.round(document.querySelector('.gp-overview--compact .gp-subhead__back').getBoundingClientRect().height)
  result.ovDetailShowsFiles = document.querySelector('.gp-detail__files') !== null
  // Header row: back button + change summary on one line. The short hash it
  // used to repeat is already in the commit-row meta and the message meta
  // below, and the summary no longer costs a second row.
  const ovHead = document.querySelector('.gp-overview--compact .gp-subhead')
  const ovBackBox = ovHead?.querySelector('.gp-subhead__back')?.getBoundingClientRect() ?? null
  const ovSumEl = ovHead?.querySelector('.gp-detail__summary--inline') ?? null
  const ovSumBox = ovSumEl?.getBoundingClientRect() ?? null
  const ovHeadBox = ovHead?.getBoundingClientRect() ?? null
  result.ovDetailHeadNoHash = ovHead !== null && ovHead.querySelector('.gp-commit-hash') === null
  result.ovDetailHeadSummary = ovSumEl !== null
    && (ovSumEl.textContent || '').includes('overview.changeSummary')
    && (ovSumEl.querySelector('.gp-stats__add')?.textContent || '') === '+27'
    && (ovSumEl.querySelector('.gp-stats__del')?.textContent || '') === '\u2212' + '2'
  result.ovDetailHeadSameRow = ovBackBox !== null && ovSumBox !== null
    && Math.abs((ovBackBox.top + ovBackBox.height / 2) - (ovSumBox.top + ovSumBox.height / 2)) <= 4
  result.ovDetailHeadOneRow = ovHeadBox !== null && ovBackBox !== null && ovHeadBox.height < ovBackBox.height * 1.8
  result.ovDetailHeadRightAligned = ovSumBox !== null && ovHeadBox !== null && (ovHeadBox.right - ovSumBox.right) <= 12
  result.ovDetailHeadFits = ovHead !== null && ovHead.scrollWidth <= ovHead.clientWidth + 1
  // The summary left the scrollable file list in compact (the wide layout keeps
  // it there — asserted once the panel widens below).
  result.ovDetailFilesNoSummary = document.querySelector('.gp-detail__files .gp-detail__summary') === null
  // Commit ops are low-frequency: compact keeps them at the 30px control height
  // instead of the 36px touch .gp-btn height.
  result.ovDetailActionBtnHeight = [...document.querySelectorAll('.gp-detail__actions .gp-btn')]
    .map((b) => Math.round(b.getBoundingClientRect().height))
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
  result.chListShown = document.querySelector('.gp-changes--compact .gp-changes__left') !== null
    && document.querySelector('.gp-changes--compact .gp-commitbar, .gp-changes--compact .gp-commitbox') !== null
  result.ovfChangesList = rootFits(panelRoot) && rootFits(document.querySelector('.gp-changes--compact'))
  const chFileRow = document.querySelector('.gp-file-row')
  chFileRow?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.chDrilledToDiff = document.querySelector('.gp-changes--compact .gp-changes__right') !== null
    && document.querySelector('.gp-changes--compact .gp-commitbar, .gp-changes--compact .gp-commitbox') === null
  result.chDiffHasBack = [...document.querySelectorAll('.gp-diff__toolbar .gp-subhead__back')].some((b) => (b.textContent || '').includes('changes.backToList'))
  result.chBackBtnHeight = Math.round(document.querySelector('.gp-diff__toolbar .gp-subhead__back').getBoundingClientRect().height)
  // Compact drops the side-by-side mode button from the diff seg.
  result.chNoSplitButton = [...document.querySelectorAll('.gp-diff__toolbar .gp-seg__btn')].every((b) => (b.textContent || '') !== 'diff.split')
  // The fixture's defaultDiffView is 'split', so compact must fall back to
  // rendering unified — button absence alone wouldn't prove the render mode.
  result.chUnifiedRender = document.querySelector('.gp-changes--compact .gp-diff__unified') !== null
  result.chNoSideRender = document.querySelector('.gp-changes--compact .gp-diff__side') === null
  result.chUnifiedActive = [...document.querySelectorAll('.gp-diff__toolbar .gp-seg__btn--active')].some((b) => (b.textContent || '') === 'diff.unified')
  // The compact toolbar splits into two rows: back/path/stats on top, the
  // expand toggle + mode seg on their own row below (one row squeezed the seg
  // buttons into a stacked wrap at phone widths).
  const tbRows = [...document.querySelectorAll('.gp-diff__toolbar .gp-diff__toolbar-row')]
  result.chToolbarRows = tbRows.length
  const ctrlRow = document.querySelector('.gp-diff__toolbar-row--controls')
  result.chControlsRowHasExpand = ctrlRow?.querySelector('.gp-diff__expand') !== null
  result.chControlsRowHasSeg = ctrlRow?.querySelector('.gp-seg') !== null
  result.chBackOnFirstRow = tbRows[0]?.querySelector('.gp-subhead__back') !== null
  if (ctrlRow) {
    // Seg buttons sit side by side on one line (equal width), not stacked.
    const segBtns = [...ctrlRow.querySelectorAll('.gp-seg .gp-seg__btn')]
    const tops = segBtns.map((b) => Math.round(b.getBoundingClientRect().top))
    result.chSegOneLine = segBtns.length >= 2 && new Set(tops).size === 1
    const widths = segBtns.map((b) => Math.round(b.getBoundingClientRect().width))
    result.chSegEvenWidth = widths.length >= 2 && Math.max(...widths) - Math.min(...widths) <= 2
    // The label itself must never wrap ("变更前" broke into 变更 / 前 when the
    // equal-width buttons were allowed to shrink below their content).
    result.chSegLabelsOneLine = segBtns.length >= 2
      && segBtns.every((b) => b.getBoundingClientRect().height <= 28 && getComputedStyle(b).whiteSpace === 'nowrap')
    // The whole track may wrap below the expand toggle, but never below itself.
    result.chSegTrackFits = (() => {
      const seg = ctrlRow.querySelector('.gp-seg')
      const row = ctrlRow.getBoundingClientRect()
      const r = seg.getBoundingClientRect()
      return r.left >= row.left - 1 && r.right <= row.right + 1
    })()
  }
  result.ovfChangesDrill = rootFits(panelRoot) && rootFits(document.querySelector('.gp-changes--compact'))
  document.querySelector('.gp-diff__toolbar .gp-subhead__back')?.click()
  await new Promise((r) => setTimeout(r, 300))
  result.chBackToList = document.querySelector('.gp-changes--compact .gp-commitbar, .gp-changes--compact .gp-commitbox') !== null

  // Files compact: drill tree → preview → back.
  tabByText('tab.files')?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.flTreeShown = document.querySelector('.gp-files--compact .gp-files__tree') !== null
  result.ovfFilesTree = rootFits(panelRoot) && rootFits(document.querySelector('.gp-files--compact'))
  // The official folder glyphs carry the expansion state: closed by default,
  // open while a directory is expanded, closed again after collapsing.
  const dirRow = () => [...document.querySelectorAll('.gp-files__tree .gp-files__entry--dir')]
    .find((r) => (r.textContent || '').includes('src'))
  result.flDirClosedIcon = dirRow()?.querySelector('svg[data-folder="closed"]') != null
  dirRow()?.click()
  await new Promise((r) => setTimeout(r, 300))
  result.flDirOpenIcon = dirRow()?.querySelector('svg[data-folder="open"]') != null
  result.flDirChildren = (document.querySelector('.gp-files__tree')?.textContent || '').includes('index.ts')
  dirRow()?.click()
  await new Promise((r) => setTimeout(r, 300))
  result.flDirReclosedIcon = dirRow()?.querySelector('svg[data-folder="closed"]') != null
  const txtRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('a.txt'))
  txtRow?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.flDrilledToPreview = document.querySelector('.gp-files--compact .gp-files__preview') !== null && document.querySelector('.gp-files--compact .gp-files__tree') === null
  result.flPreviewHasBack = [...document.querySelectorAll('.gp-files__bar .gp-subhead__back')].some((b) => (b.textContent || '').includes('files.backToTree'))
  result.flBackBtnHeight = Math.round(document.querySelector('.gp-files__bar .gp-subhead__back').getBoundingClientRect().height)
  result.ovfFilesDrill = rootFits(panelRoot) && rootFits(document.querySelector('.gp-files--compact'))
  // The compact toolbar drops the relative path and both copy buttons; a plain
  // text file has no source/render switch, only word-wrap + fullscreen +
  // properties.
  result.flNoPath = document.querySelector('.gp-files__bar .gp-files__path') === null
  result.flNoCopy = document.querySelector('.gp-files__bar .gp-files__copy-path') === null
  result.flPlainNoMode = document.querySelector('.gp-files__bar [role="tablist"]') === null
  result.flHasFullscreen = document.querySelector('.gp-files__bar [aria-label="files.fullscreen"]') !== null
  result.flHasProps = document.querySelector('.gp-files__bar [aria-label="files.propsTitle"]') !== null
  result.flHasWrap = document.querySelector('.gp-files__bar [aria-label="files.wrap"]') !== null
  result.flWrapDefaultOn = document.querySelector('.gp-files__bar [aria-label="files.wrap"]')?.getAttribute('aria-pressed') === 'true'
  result.flWrapDefaultWrapped = (() => {
    const cell = document.querySelector('.gp-files__preview-content .gp-files__code .gp-diff-cell')
    return cell !== null && getComputedStyle(cell).whiteSpace.startsWith('pre-wrap')
  })()
  // Wrap must keep the body inside the viewport (no horizontal overflow), so
  // the nowrap state below has something real to contrast against.
  const codeBox = () => document.querySelector('.gp-files__preview-content .gp-files__code')
  result.flWrapNoHScroll = (() => {
    const el = codeBox()
    return el !== null && el.scrollWidth <= el.clientWidth + 1
  })()
  // Trailing icons stay pinned to the toolbar's right edge even when the file
  // has no source/render switcher to take up the space between.
  const barEl = document.querySelector('.gp-files__bar--compact')
  const propsBtn = document.querySelector('.gp-files__bar [aria-label="files.propsTitle"]')
  const barContentRight = barEl.getBoundingClientRect().right - parseFloat(getComputedStyle(barEl).paddingRight)
  result.flPropsRightAligned = Math.abs(propsBtn.getBoundingClientRect().right - barContentRight) <= 1
  result.flIconsOneRow = Math.abs(
    propsBtn.getBoundingClientRect().top + propsBtn.getBoundingClientRect().height / 2
    - (document.querySelector('.gp-files__bar .gp-subhead__back').getBoundingClientRect().top
      + document.querySelector('.gp-files__bar .gp-subhead__back').getBoundingClientRect().height / 2),
  ) <= 2
  // The three icon buttons match the 30px back button / mode control, not
  // their inline 24px size.
  const barEndBtns = [...document.querySelectorAll('.gp-files__bar-end .gp-files__props')]
  result.flBarEndHeights = barEndBtns.length === 3
    && barEndBtns.every((b) => Math.round(b.getBoundingClientRect().height) === 30)
  // Toggling wrap off switches the source body to non-wrapping cells and
  // re-enables the aria-pressed state.
  const wrapBtn = document.querySelector('.gp-files__bar [aria-label="files.wrap"]')
  wrapBtn?.click()
  await new Promise((r) => setTimeout(r, 150))
  result.flWrapToggledOff = wrapBtn?.getAttribute('aria-pressed') === 'false'
    && (() => {
      const cell = document.querySelector('.gp-files__preview-content .gp-files__code .gp-diff-cell')
      return cell !== null && getComputedStyle(cell).whiteSpace === 'pre'
    })()
  // The spec's other half: nowrap must actually scroll the long fixture line
  // horizontally (not clip it silently — the pre-PR box model did exactly that).
  result.flNowrapHScroll = (() => {
    const el = codeBox()
    return el !== null && el.scrollWidth > el.clientWidth + 1
  })()
  wrapBtn?.click()
  await new Promise((r) => setTimeout(r, 150))
  result.flWrapRestored = wrapBtn?.getAttribute('aria-pressed') === 'true'
  result.flWrapRestoredNoHScroll = (() => {
    const el = codeBox()
    return el !== null && el.scrollWidth <= el.clientWidth + 1
  })()
  // Fullscreen renders the same mode in the near-fullscreen modal and closes on Escape.
  // Focus the trigger first: a programmatic .click() does not focus it, and the
  // dialog is expected to restore focus to the control that opened it.
  const fullBtn = document.querySelector('.gp-files__bar [aria-label="files.fullscreen"]')
  fullBtn?.focus()
  fullBtn?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.flFullscreenOpened = document.querySelector('.gp-modal-backdrop .gp-modal') !== null
  result.flFullscreenCode = document.querySelector('.gp-modal .gp-files__code') !== null
  result.flFullscreenHasPath = document.querySelector('.gp-modal .gp-modal__path') !== null
  // The dialog owns focus while open (shared dialog lifecycle).
  result.flFullscreenFocusIn = document.activeElement instanceof HTMLElement
    && document.activeElement.closest('.gp-modal') !== null
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 200))
  result.flFullscreenEscClosed = document.querySelector('.gp-modal-backdrop') === null
  result.flFullscreenFocusRestored = document.activeElement instanceof HTMLElement
    && document.activeElement.getAttribute('aria-label') === 'files.fullscreen'

  // Rich file (Markdown): the official source/render SegmentedControl replaces
  // the two custom buttons and its panels resolve.
  document.querySelector('.gp-files__bar .gp-subhead__back')?.click()
  await new Promise((r) => setTimeout(r, 300))
  const mdRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('README.md'))
  mdRow?.click()
  await new Promise((r) => setTimeout(r, 400))
  const modeList = document.querySelector('.gp-files__bar [role="tablist"]')
  const modeTabs = [...document.querySelectorAll('.gp-files__bar [role="tab"]')]
  result.flModeSegShown = modeList !== null && modeList.getAttribute('aria-label') === 'files.previewMode' && modeTabs.length === 2
  result.flModePanelsResolve = modeTabs.every((tab) => {
    const panel = document.getElementById(tab.getAttribute('aria-controls') || '')
    return panel !== null && panel.getAttribute('role') === 'tabpanel' && panel.getAttribute('aria-labelledby') === tab.id
  })
  const richBar = document.querySelector('.gp-files__bar--compact')
  const richProps = document.querySelector('.gp-files__bar [aria-label="files.propsTitle"]')
  const richContentRight = richBar.getBoundingClientRect().right - parseFloat(getComputedStyle(richBar).paddingRight)
  result.flModePropsRightAligned = Math.abs(richProps.getBoundingClientRect().right - richContentRight) <= 1
  result.flRenderDefault = document.querySelector('.gp-files__preview-content [data-markdown-rendered]') !== null
  const sourceTab = modeTabs.find((tab) => (tab.textContent || '') === 'files.source')
  sourceTab?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.flSourceMode = document.querySelector('.gp-files__preview-content .gp-files__code') !== null
    && document.querySelector('.gp-files__preview-content [data-markdown-rendered]') === null
  document.querySelector('.gp-files__bar [aria-label="files.fullscreen"]')?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.flScreenSource = document.querySelector('.gp-modal .gp-files__code') !== null
    && document.querySelector('.gp-modal [data-markdown-rendered]') === null
  document.querySelector('.gp-modal-backdrop')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  document.querySelector('.gp-modal-backdrop')?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.flScreenBackdropClosed = document.querySelector('.gp-modal-backdrop') === null
  // Back in the panel the render mode comes back with the official switcher.
  const renderTab = [...document.querySelectorAll('.gp-files__bar [role="tab"]')].find((tab) => (tab.textContent || '') === 'files.render')
  renderTab?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.flRenderModeRestored = document.querySelector('.gp-files__preview-content [data-markdown-rendered]') !== null
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
  // Selecting a commit in wide mode puts the change summary back above the
  // changed-file tree — the compact inline variant never renders here.
  document.querySelector('.gp-commit-row')?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.wideDetailSummaryInFiles = document.querySelector('.gp-detail__files .gp-detail__summary') !== null
    && document.querySelector('.gp-detail__summary--inline') === null
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
  assert.equal(out.sheetClosedAfterPick, true, 'the switch button closes the sheet')
  assert.equal(out.filterButtonShowsRef, true, 'the filter button reflects the active ref')
  assert.equal(out.ovNoToolbarSwitch, true, 'compact has no separate toolbar switch button any more')
  assert.equal(out.sheetHasSwitch, true, 'the filter sheet rows carry the switch button')
  assert.equal(out.sheetCurrentNoSwitch, true, 'the checked-out branch has no switch button')
  assert.equal(out.sheetSwitchKeepsFilter, true, 'the switch button does not change the history filter')
  assert.equal(out.switchSheetClosedAfterPick, true, 'the switch button closes the sheet')
  assert.equal(out.switchConfirmPortaled, true, 'the confirm step is a centered dialog, not a sheet')
  assert.equal(out.switchConfirmRan, true, 'confirming runs the branch checkout')
  assert.equal(out.switchConfirmClosed, true, 'a landed switch closes the confirm')
  assert.equal(out.ovDrilledToDetail, true, 'tapping a commit drills into the detail pane')
  assert.equal(out.ovDetailHasBack, true, 'the detail pane shows a back-to-list button')
  assert.equal(out.ovBackBtnHeight, 30, 'the detail back button matches the 30px toolbar controls')
  assert.equal(out.ovDetailShowsFiles, true, 'the detail pane lists the commit changed files')
  assert.equal(out.ovDetailHeadNoHash, true, 'the compact detail header drops the repeated short hash')
  assert.equal(out.ovDetailHeadSummary, true, 'the compact detail header carries the file/line change summary')
  assert.equal(out.ovDetailHeadSameRow, true, 'the change summary shares the back button row')
  assert.equal(out.ovDetailHeadOneRow, true, 'the header stays one control row tall')
  assert.equal(out.ovDetailHeadRightAligned, true, 'the summary takes the trailing edge of the header row')
  assert.equal(out.ovDetailHeadFits, true, 'the header row does not overflow its pane')
  assert.equal(out.ovDetailFilesNoSummary, true, 'compact does not repeat the summary inside the file list')
  assert.deepEqual(out.ovDetailActionBtnHeight, [30, 30, 30], 'compact commit ops keep one 30px height')
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
  assert.equal(out.chBackBtnHeight, 30, 'the diff back button matches the 30px toolbar controls')
  assert.equal(out.chNoSplitButton, true, 'the compact diff drops the side-by-side mode')
  assert.equal(out.chUnifiedRender, true, 'the split default falls back to unified rendering')
  assert.equal(out.chNoSideRender, true, 'compact never renders the side-by-side diff layout')
  assert.equal(out.chUnifiedActive, true, 'the unified seg button is the active one')
  assert.equal(out.chToolbarRows, 2, 'the compact diff toolbar splits into two rows')
  assert.equal(out.chControlsRowHasExpand, true, 'the second row holds the expand toggle')
  assert.equal(out.chControlsRowHasSeg, true, 'the second row holds the mode seg')
  assert.equal(out.chBackOnFirstRow, true, 'the back button stays on the first row')
  assert.equal(out.chSegOneLine, true, 'the seg buttons sit side by side on one line')
  assert.equal(out.chSegEvenWidth, true, 'the seg buttons are evenly sized')
  assert.equal(out.chSegLabelsOneLine, true, 'each mode label stays on one line')
  assert.equal(out.chSegTrackFits, true, 'the wrapped seg track still fits inside its row')
  assert.equal(out.ovfChangesDrill, true, 'the compact diff pane fits without horizontal overflow')
  assert.equal(out.chBackToList, true, 'back returns to the change list')
  assert.equal(out.ovToolbarEqualHeights, true, 'branch pill, search and more-toggle share one control height')
  assert.equal(out.ovMoreToggleSize, true, 'the more-filters toggle is a 30px square')
  assert.equal(out.ovToolbarOneRow, true, 'the compact history toolbar keeps a single row by default')
  assert.equal(out.ovMoreCollapsed, true, 'author / since / refresh start collapsed behind the chevron')
  assert.equal(out.ovMoreAriaControls, true, 'collapsed: the toggle names no missing element')
  assert.equal(out.ovMoreExpanded, true, 'the chevron reveals the secondary filter group')
  assert.equal(out.ovMoreAriaControlsExpanded, true, 'expanded: the toggle controls the revealed group')
  assert.equal(out.ovMoreSecondRow, true, 'the revealed filters take a second row below the toggle')
  assert.equal(out.ovMoreHeights, true, 'the revealed controls match the first row height')
  assert.equal(out.ovfToolbar, true, 'the compact toolbar never overflows horizontally')
  assert.equal(out.ovMoreRecollapsed, true, 'the chevron folds the second row again')
  assert.equal(out.flTreeShown, true, 'files shows the tree full width in compact')
  assert.equal(out.flDirClosedIcon, true, 'a collapsed directory shows the closed folder glyph')
  assert.equal(out.flDirOpenIcon, true, 'an expanded directory shows the open folder glyph')
  assert.equal(out.flDirChildren, true, 'expanding a directory reveals its children')
  assert.equal(out.flDirReclosedIcon, true, 'collapsing the directory restores the closed glyph')
  assert.equal(out.ovfFilesTree, true, 'the compact file tree fits without horizontal overflow')
  assert.equal(out.flDrilledToPreview, true, 'tapping a file drills into the preview pane')
  assert.equal(out.flPreviewHasBack, true, 'the compact preview shows a back-to-tree button')
  assert.equal(out.flBackBtnHeight, 30, 'the files back button matches the 30px toolbar controls')
  assert.equal(out.ovfFilesDrill, true, 'the compact preview fits without horizontal overflow')
  assert.equal(out.flNoPath, true, 'the compact preview toolbar drops the relative path')
  assert.equal(out.flNoCopy, true, 'the compact preview toolbar drops both copy buttons')
  assert.equal(out.flPlainNoMode, true, 'a plain text file shows no source/render switch')
  assert.equal(out.flHasFullscreen, true, 'the compact toolbar carries the fullscreen entry')
  assert.equal(out.flHasProps, true, 'the compact toolbar keeps the properties entry')
  assert.equal(out.flHasWrap, true, 'the compact toolbar carries the word-wrap toggle')
  assert.equal(out.flWrapDefaultOn, true, 'word wrap defaults to on')
  assert.equal(out.flWrapDefaultWrapped, true, 'the source body wraps by default')
  assert.equal(out.flWrapNoHScroll, true, 'the wrapped body fits the viewport without horizontal scrolling')
  assert.equal(out.flWrapToggledOff, true, 'toggling wrap off stops wrapping')
  assert.equal(out.flNowrapHScroll, true, 'nowrap exposes horizontal scrolling for a long line instead of clipping it')
  assert.equal(out.flWrapRestored, true, 'toggling wrap on again restores wrapping')
  assert.equal(out.flWrapRestoredNoHScroll, true, 'restoring wrap removes the horizontal overflow again')
  assert.equal(out.flPropsRightAligned, true, 'without a mode switcher the properties entry still sits at the right edge')
  assert.equal(out.flIconsOneRow, true, 'the back button and the trailing icons share one row')
  assert.equal(out.flBarEndHeights, true, 'wrap / fullscreen / properties match the 30px bar height')
  assert.equal(out.flFullscreenOpened, true, 'fullscreen opens the near-fullscreen modal')
  assert.equal(out.flFullscreenCode, true, 'the fullscreen modal renders the code view')
  assert.equal(out.flFullscreenHasPath, true, 'the fullscreen modal shows the file path')
  assert.equal(out.flFullscreenFocusIn, true, 'opening fullscreen moves focus into the dialog')
  assert.equal(out.flFullscreenEscClosed, true, 'Escape closes the fullscreen modal')
  assert.equal(out.flFullscreenFocusRestored, true, 'closing fullscreen restores the toolbar control')
  assert.equal(out.flModeSegShown, true, 'a rich file shows the official two-choice source/render control')
  assert.equal(out.flModePanelsResolve, true, 'each mode tab controls its own tabpanel')
  assert.equal(out.flModePropsRightAligned, true, 'the properties entry stays right-aligned next to the mode switcher')
  assert.equal(out.flRenderDefault, true, 'the rich file previews rendered by default')
  assert.equal(out.flSourceMode, true, 'the source tab swaps the rendered body for the code view')
  assert.equal(out.flScreenSource, true, 'fullscreen honours the selected source mode')
  assert.equal(out.flScreenBackdropClosed, true, 'a backdrop click closes the fullscreen modal')
  assert.equal(out.flRenderModeRestored, true, 'the render tab restores the rendered body')
  assert.equal(out.flBackToTree, true, 'back returns to the file tree')
  assert.equal(out.restoredWide, true, 'widening the panel restores the wide layout')
  assert.equal(out.ovfWide, true, 'the widened panel fits without horizontal overflow')
  assert.equal(out.wideHasThreeColumns, true, 'the wide overview shows all three columns again')
  assert.equal(out.wideDetailSummaryInFiles, true, 'the wide detail keeps the summary above the changed-file tree')
  assert.equal(out.wideStatusBarInLeft, true, 'the wide left column keeps the status bar below the scrolling branch list')
  assert.equal(errors.length, 0, 'no console errors: ' + JSON.stringify(errors))
  console.log('e2e run3.mjs: PASS', JSON.stringify(out))
} catch (e) {
  console.error('e2e run3.mjs: FAIL', e.message)
  console.error(JSON.stringify(out, null, 2))
  process.exit(1)
}
