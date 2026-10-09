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
    { path: 'icon.svg', status: 'modified', staged: false, isDirectory: false },
  ],
  stats: { fileCount: 5, staged: 0, modified: 4, untracked: 1, insertions: 3, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
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
  const fileQueries = []
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
          if (q.kind === 'show') return { ok: true, value: { ok: true, value: { kind: 'show', ref: q.ref, commit: { hash: q.ref, shortHash: q.ref.slice(0, 7), subject: 'feat: add c', author: 'Tester', dateIso: new Date().toISOString() }, body: 'detailed body text', stats: [{ path: 'index.ts', status: 'modified' }] } } }
          if (q.kind === 'diff') {
            // An image path diffs as the binary marker, like real git.
            if (q.path.endsWith('.png')) return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n' } } }
            // An SVG is text: git produces a real source diff for it.
            if (q.path.endsWith('.svg')) return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/icon.svg b/icon.svg\n--- a/icon.svg\n+++ b/icon.svg\n@@ -1 +1 @@\n-<svg width="1"/>\n+<svg width="2"/>\n' } } }
            if (q.path.endsWith('.ts')) return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-const count = 1\n+const count = 2\n' } } }
            return { ok: true, value: { ok: true, value: { kind: 'diff', path: q.path, text: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1,2 @@\n line1\n+line2\n' } } }
          }
          if (q.kind === 'image-diff') return { ok: true, value: { ok: true, value: { kind: 'image-diff', path: q.path, mime: q.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png', old: `data:image/png;base64,${MOCK_PNG}`, new: `data:image/png;base64,${MOCK_PNG}` } } }
          if (q.kind === 'dir-list') {
            fileQueries.push(q.path)
            if (q.path === '') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: '', truncated: false, entries: [
              { name: 'src', dir: true }, { name: 'cache', dir: true, ignored: true }, { name: 'a.txt', dir: false, size: 12 }, { name: 'logo.png', dir: false, size: 64 }, { name: 'README.md', dir: false, size: 18 }, { name: 'page.html', dir: false, size: 60 }, { name: 'big.js', dir: false, size: 60000 }, { name: 'ignored.log', dir: false, ignored: true },
            ] } } }
            if (q.path === 'src') return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: 'src', truncated: false, entries: [
              { name: 'index.ts', dir: false, size: 40 },
            ] } } }
            return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries: [] } } }
          }
          if (q.kind === 'file-content') {
            if (q.path.endsWith('.md')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '# Hello Markdown\n', lines: 1 } } }
            if (q.path.endsWith('.html')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: '<!doctype html><title>Doc</title><p id="hi">Hello HTML</p>', lines: 1 } } }
            // A big text file exercises both source-view guards: >5000 lines
            // (highlight off) with one >5000-char line (truncation).
            if (q.path.endsWith('big.js')) {
              const huge = 'x'.repeat(6000)
              const body = `const long = "${huge}"\n` + Array.from({ length: 5100 }, (_, i) => `line ${i}`).join('\n') + '\n'
              return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: body, lines: 5101 } } }
            }
            if (q.path.endsWith('.png')) return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'image', dataUrl: `data:image/png;base64,${MOCK_PNG}` } } }
            return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content: 'const x = 1\nconst y = 2\n', lines: 2 } } }
          }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: 'init: first commit' } } }
          if (q.kind === 'stash-list') return { ok: true, value: { ok: true, value: { kind: 'stash-list', entries: [{ index: 0, sha: 'abcdef1234', message: 'wip on main', branch: 'main', relTime: '1 hour ago' }] } } }
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
  result.pillHasDirty = document.querySelector('.gp-pill--dirty') !== null

  const viewEntry = registered['conversation.view']
  result.viewLabel = viewEntry.reg.label ? viewEntry.reg.label() : null
  result.viewOrder = viewEntry.reg.order
  const viewRoot = ReactDOM.createRoot(document.getElementById('panel'))
  viewRoot.render(viewEntry.component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 500))
  result.tabCount = document.querySelectorAll('.gp-tab').length
  result.dirtyDefault = document.querySelector('.gp-tab--active')?.textContent?.includes('tab.changes') ?? false
  result.noInitialFileListing = fileQueries.length === 0
  const panelRoot = document.querySelector('.gp-panel')
  result.fontDefault = getComputedStyle(panelRoot).fontSize
  document.querySelector('.gp-font__increase')?.click()
  await new Promise((r) => setTimeout(r, 60))
  result.fontIncreased = getComputedStyle(panelRoot).fontSize
  result.fontStored = localStorage.getItem('gp.panel.fontDelta')
  document.querySelector('.gp-font__reset')?.click()
  await new Promise((r) => setTimeout(r, 60))
  result.fontReset = getComputedStyle(panelRoot).fontSize
  // Responsive tab bar: a wide panel is the three-column 'wide' layout with the
  // trailing controls inline; narrowing to a phone width switches to the
  // 'compact' layout, which keeps the font stepper + version bar (wrapped onto a
  // second row, not hidden) and keeps the tab labels; only a very narrow panel
  // drops the labels to icon-only.
  const panelHost = document.getElementById('panel')
  const fontCluster = panelRoot.querySelector('.gp-font')
  const firstLabel = panelRoot.querySelector('.gp-tab__label')
  result.wideLayout = panelRoot.getAttribute('data-layout')
  result.wideShowsControls = getComputedStyle(fontCluster).display !== 'none'
  result.wideShowsLabel = getComputedStyle(firstLabel).display !== 'none'
  panelHost.style.width = '400px'
  await new Promise((r) => setTimeout(r, 120))
  result.narrowLayout = panelRoot.getAttribute('data-layout')
  result.narrowShowsControls = getComputedStyle(panelRoot.querySelector('.gp-font')).display !== 'none'
  result.narrowKeepsLabel = getComputedStyle(panelRoot.querySelector('.gp-tab__label')).display !== 'none'
  panelHost.style.width = '260px'
  await new Promise((r) => setTimeout(r, 80))
  result.tinyHidesLabel = getComputedStyle(panelRoot.querySelector('.gp-tab__label')).display === 'none'
  result.tinyKeepsIcon = getComputedStyle(panelRoot.querySelector('.gp-tab__icon')).display !== 'none'
  result.tinyShowsControls = getComputedStyle(panelRoot.querySelector('.gp-font')).display !== 'none'
  panelHost.style.width = '1000px'
  await new Promise((r) => setTimeout(r, 120))
  result.restoresLayout = panelRoot.getAttribute('data-layout')
  result.restoresLabel = getComputedStyle(panelRoot.querySelector('.gp-tab__label')).display !== 'none'
  const changesTab = [...document.querySelectorAll('.gp-tab')].find((t) => (t.textContent || '').includes('tab.changes'))
  if (changesTab) { changesTab.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.hasStats = document.querySelector('.gp-stats') !== null
  result.hasCommitBox = document.querySelector('.gp-commitbox') !== null
  result.changeRows = document.querySelectorAll('.gp-file-row').length
  result.hasAmend = document.querySelector('.gp-commitbox__amend') !== null
  // Stash: the toolbar carries a stash button; the stash list (mock → one entry)
  // expands to a row, and the drop confirm shows the shared AI hint.
  result.hasStashBtn = [...document.querySelectorAll('.gp-toolbar .gp-btn')].some((b) => (b.textContent || '').includes('changes.stash'))
  const stashHead = document.querySelector('.gp-stash .gp-group-head')
  if (stashHead) { stashHead.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.stashRows = document.querySelectorAll('.gp-stash-row').length
  const dropBtn = document.querySelector('.gp-stash-row__actions .gp-icon-btn')
  if (dropBtn) { dropBtn.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.stashDropHint = (document.querySelector('.gp-modal--sm .gp-modal__hint')?.textContent || '') === 'ops.aiHint'
  // Escape dismisses the confirm dialog (matches the panel's dialog contract).
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.stashDropEscClosed = document.querySelector('.gp-modal--sm') === null
  const commitBtn = [...document.querySelectorAll('.gp-commitbox__actions .gp-btn--primary')][0]
  result.commitDisabledEmpty = commitBtn?.disabled === true
  const primaryStyle = getComputedStyle(commitBtn)
  result.commitPrimaryBg = primaryStyle.backgroundColor
  const msgBox = document.querySelector('.gp-commitbox__msg')
  if (msgBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(msgBox, 'feat: add feature')
    msgBox.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  }
  const commitBtnAfter = [...document.querySelectorAll('.gp-commitbox__actions .gp-btn--primary')][0]
  result.commitEnabledWithMessage = commitBtnAfter?.disabled === false
  result.commitPrimaryHoverKeepsColor = [...document.styleSheets].some((sheet) => {
    try { return [...sheet.cssRules].some((rule) => rule.selectorText === '.gp-btn--primary:hover' || rule.selectorText === '.gp-btn--primary:hover:not(:disabled)') } catch { return false }
  })
  if (msgBox) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(msgBox, '')
    msgBox.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  }

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

  // SVG diff: an SVG is image + text, so it shows a render/source toggle. It
  // defaults to the rendered comparison (image panes), and switching to source
  // reveals the text diff; switching back returns to the rendered panes.
  const svgRow = [...document.querySelectorAll('.gp-file-row')].find((r) => (r.textContent || '').includes('icon.svg'))
  if (svgRow) { svgRow.click(); await new Promise((r) => setTimeout(r, 600)) }
  result.svgHasToggle = document.querySelector('.gp-svgdiff__bar') !== null
  result.svgRenderDefault = document.querySelector('.gp-svgdiff .gp-imgcmp') !== null
  const svgSourceBtn = [...document.querySelectorAll('.gp-svgdiff__bar .gp-seg__btn')].find((b) => (b.textContent || '') === 'diff.svgSource')
  if (svgSourceBtn) { svgSourceBtn.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.svgSourceShowsDiff = document.querySelector('.gp-svgdiff .gp-diff__unified, .gp-svgdiff .gp-diff__side, .gp-svgdiff .gp-diff__single') !== null
  const svgRenderBtn = [...document.querySelectorAll('.gp-svgdiff__bar .gp-seg__btn')].find((b) => (b.textContent || '') === 'diff.svgRender')
  if (svgRenderBtn) { svgRenderBtn.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.svgRenderRestored = document.querySelector('.gp-svgdiff .gp-imgcmp') !== null

  const tabs = [...document.querySelectorAll('.gp-tab')]
  const overviewTab = tabs.find((t) => (t.textContent || '').includes('tab.overview'))
  if (overviewTab) { overviewTab.click(); await new Promise((r) => setTimeout(r, 500)) }
  result.hasBranchList = document.querySelector('.gp-branch-group') !== null
  result.commitRows = document.querySelectorAll('.gp-commit-row').length
  result.hasGraph = document.querySelector('.gp-graph-svg') !== null
  // Search box: a wide panel uses the full "(message / hash)" placeholder key;
  // narrowing it below the threshold swaps to the short key (a placeholder is a
  // DOM attribute, so this is a JS swap, not CSS). The harness binds t() to the
  // raw key, so assert on the key that lands in the placeholder.
  const searchBox = document.querySelector('.gp-search')
  result.searchFullHint = searchBox?.getAttribute('placeholder') === 'overview.search'
  const panelHostForSearch = document.getElementById('panel')
  panelHostForSearch.style.width = '360px'
  await new Promise((r) => setTimeout(r, 120))
  result.searchShortHint = document.querySelector('.gp-search')?.getAttribute('placeholder') === 'overview.searchShort'
  panelHostForSearch.style.width = '1000px'
  await new Promise((r) => setTimeout(r, 120))
  result.searchHintRestored = document.querySelector('.gp-search')?.getAttribute('placeholder') === 'overview.search'

  // Select the first commit → its changed-file tree appears on the right.
  const firstCommit = document.querySelector('.gp-commit-row')
  if (firstCommit) { firstCommit.click(); await new Promise((r) => setTimeout(r, 400)) }
  const fileRow = document.querySelector('.gp-detail__files .gp-tree-row')
  result.hasDetailFileRow = fileRow !== null
  // Commit detail action area: a create-tag button opens the tag dialog, which
  // carries the shared "trust the AI" hint. Close it before the file-diff test.
  const createTagBtn = [...document.querySelectorAll('.gp-detail__ops .gp-btn')].find((b) => (b.textContent || '').includes('overview.createTag'))
  result.hasCreateTagBtn = createTagBtn != null
  if (createTagBtn) { createTagBtn.click(); await new Promise((r) => setTimeout(r, 200)) }
  result.tagModalOpened = document.querySelector('.gp-modal--sm') !== null
  result.tagModalHint = (document.querySelector('.gp-modal--sm .gp-modal__hint')?.textContent || '') === 'ops.aiHint'
  const tagClose = document.querySelector('.gp-modal--sm .gp-modal__close')
  if (tagClose) { tagClose.click(); await new Promise((r) => setTimeout(r, 150)) }
  // Click a changed file → the diff modal opens (portaled to document.body).
  if (fileRow) { fileRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.hasModal = document.querySelector('.gp-modal') !== null
  result.modalHasDiff = document.querySelector('.gp-modal .gp-diff__unified') !== null
  result.modalWordSyntax = [...document.querySelectorAll('.gp-modal .gp-diff-word span')].some((el) => el.style.color.includes('--shiki-keyword'))
  // In-diff Find (Ctrl+F) inside the modal: open, search a token present in the
  // fixture diff, assert marks + count, then Esc dismisses Find (not the modal).
  const diffWrap = document.querySelector('.gp-modal .gp-diff__wrap')
  if (diffWrap) { Object.defineProperty(diffWrap, 'offsetParent', { configurable: true, get: () => document.body }) }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 60))
  result.diffFindOpened = document.querySelector('.gp-modal .gp-find__input') !== null
  const diffFindInput = document.querySelector('.gp-modal .gp-find__input')
  if (diffFindInput) {
    // Fixture .ts diff replaces "const count = 1" → "const count = 2"; "count"
    // appears on both sides in split-derived unified rows.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(diffFindInput, 'count')
    diffFindInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  }
  result.diffFindHits = document.querySelectorAll('.gp-modal .gp-find-hit').length
  result.diffFindActive = document.querySelectorAll('.gp-modal .gp-find-hit--active').length
  result.diffFindCount = document.querySelector('.gp-modal .gp-find__count')?.textContent
  // Case toggle in the diff find: uppercase query matches by default, and
  // enabling Match case drops it to zero.
  if (diffFindInput) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(diffFindInput, 'COUNT')
    diffFindInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  }
  result.diffFindCaseInsensitiveHits = document.querySelectorAll('.gp-modal .gp-find-hit').length
  document.querySelector('.gp-modal .gp-find__case')?.click()
  await new Promise((r) => setTimeout(r, 80))
  result.diffFindCaseSensitiveHits = document.querySelectorAll('.gp-modal .gp-find-hit').length
  document.querySelector('.gp-modal .gp-find__case')?.click()
  await new Promise((r) => setTimeout(r, 60))
  diffFindInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 60))
  result.diffFindClosedModalKept = document.querySelector('.gp-modal .gp-find__input') === null && document.querySelector('.gp-modal') !== null
  // Esc closes it.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 200))
  result.modalClosedByEsc = document.querySelector('.gp-modal') === null
  // Reopen, then close via the close button.
  if (fileRow) { fileRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  const closeBtn = document.querySelector('.gp-modal__bar .gp-icon-btn')
  if (closeBtn) { closeBtn.click(); await new Promise((r) => setTimeout(r, 200)) }
  result.modalClosedByBtn = document.querySelector('.gp-modal') === null
  document.querySelector('#pill .gp-pill')?.click()
  await new Promise((r) => setTimeout(r, 100))
  result.livePillJump = document.querySelector('.gp-tab--active')?.textContent?.includes('tab.changes') ?? false

  // Files tab: open it, the root tree lists entries; expand a dir; select a
  // text file → code preview; select an image → inline image pane.
  const filesTab = [...document.querySelectorAll('.gp-tab')].find((t) => (t.textContent || '').includes('tab.files'))
  if (filesTab) { filesTab.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.filesTreeRows = document.querySelectorAll('.gp-files__tree .gp-tree-row').length
  const cacheRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('cache'))
  const ignoredRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('ignored.log'))
  result.ignoredRowsDimmed = cacheRow?.classList.contains('gp-tree-row--ignored') && ignoredRow?.classList.contains('gp-tree-row--ignored') && getComputedStyle(cacheRow).opacity < 1
  result.folderIcon = cacheRow?.querySelector('[data-file-type]')?.getAttribute('data-file-type')
  const dirRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('src'))
  if (dirRow) { dirRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.filesTreeRowsAfterExpand = document.querySelectorAll('.gp-files__tree .gp-tree-row').length
  const txtRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('a.txt'))
  if (txtRow) { txtRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.filesCodeShown = document.querySelector('.gp-files__code') !== null
  result.txtRowSelected = txtRow?.classList.contains('gp-tree-row--active') === true
  // Selection styling is shared across the three list panes via --gp-select-*:
  // the active row rule references the vars, and the panel defines them from
  // business-primary. Assert both halves so the shared token can't silently
  // drift from the primary accent.
  result.selectionStyled = (() => {
    const rules = [...document.styleSheets].flatMap((sheet) => {
      try { return [...sheet.cssRules] } catch { return [] }
    })
    const rowUsesVar = rules.some((rule) => (rule.selectorText || '').includes('gp-tree-row--active')
      && /var\(--gp-select-bar\)/.test(rule.style.cssText) && /var\(--gp-select-bg\)/.test(rule.style.cssText))
    const panelDefinesToken = rules.some((rule) => (rule.selectorText || '').includes('.gp-panel')
      && /--gp-select-bar:[^;]*business-primary/.test(rule.style.cssText))
    return rowUsesVar && panelDefinesToken
  })()
  const tsRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('index.ts'))
  if (tsRow) { tsRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.officialCodeHighlight = [...document.querySelectorAll('.gp-files__code .gp-diff-cell span')].some((node) => node.style.color.includes('--shiki-keyword'))
  result.codeIconPath = tsRow?.querySelector('[data-file-type]')?.getAttribute('data-file-type')
  let copiedPath = null
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { copiedPath = text } } })
  document.querySelector('.gp-files__copy-path')?.click()
  await new Promise((r) => setTimeout(r, 100))
  result.copiedPath = copiedPath
  result.copyFeedback = document.querySelector('.gp-files__copy-path')?.textContent
  const pngRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('logo.png'))
  if (pngRow) { pngRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.filesImageShown = document.querySelector('.gp-files__image img') !== null
  let finishCopy
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise((resolve) => { finishCopy = resolve }) } })
  document.querySelector('.gp-files__copy-path')?.click()
  const mdRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('README.md'))
  if (mdRow) { mdRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  finishCopy?.()
  await new Promise((r) => setTimeout(r, 50))
  result.copyFeedbackReset = document.querySelector('.gp-files__copy-path')?.textContent === 'files.copyPath'
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('clipboard denied') } } })
  document.querySelector('.gp-files__copy-path')?.click()
  await new Promise((r) => setTimeout(r, 50))
  result.copyDeniedFeedback = document.querySelector('.gp-files__copy-path')?.textContent === 'files.pathCopyFailed'
  // Markdown defaults to the rendered view; switch to source, then back.
  result.markdownRenderedDefault = document.querySelector('[data-markdown-rendered]')?.textContent === 'Hello Markdown' && document.querySelector('.gp-files__code') === null
  const sourceBtn = [...document.querySelectorAll('.gp-files__mode-btn')].find((b) => b.textContent === 'files.source')
  if (sourceBtn) { sourceBtn.click(); await new Promise((r) => setTimeout(r, 100)) }
  result.markdownSourceShown = document.querySelector('.gp-files__code') !== null && document.querySelector('[data-markdown-rendered]') === null
  const renderBtn = [...document.querySelectorAll('.gp-files__mode-btn')].find((b) => b.textContent === 'files.render')
  if (renderBtn) { renderBtn.click(); await new Promise((r) => setTimeout(r, 100)) }
  result.markdownRenderRestored = document.querySelector('[data-markdown-rendered]')?.textContent === 'Hello Markdown'
  // HTML defaults to source (no auto-run); switching to render mounts a
  // sandboxed iframe that carries the page bytes but drops same-origin.
  const htmlRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('page.html'))
  if (htmlRow) { htmlRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.htmlSourceDefault = document.querySelector('.gp-files__code') !== null && document.querySelector('.gp-files__html') === null
  const htmlRenderBtn = [...document.querySelectorAll('.gp-files__mode-btn')].find((b) => b.textContent === 'files.render')
  if (htmlRenderBtn) { htmlRenderBtn.click(); await new Promise((r) => setTimeout(r, 100)) }
  const htmlFrame = document.querySelector('.gp-files__html')
  result.htmlRenderShown = htmlFrame !== null && document.querySelector('.gp-files__code') === null
  result.htmlFrameSandbox = htmlFrame?.getAttribute('sandbox') ?? null
  result.htmlFrameHasSrcdoc = (htmlFrame?.getAttribute('srcdoc') || '').includes('Hello HTML')
  // Large-file source guards: highlighting is skipped (a notice shows, no
  // syntax spans) and the over-long line is truncated with a marker.
  const bigRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('big.js'))
  if (bigRow) { bigRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.bigHighlightOff = document.querySelector('.gp-files__note')?.textContent === 'files.highlightOff'
  result.bigNoSyntaxSpans = document.querySelector('.gp-files__code .gp-diff-cell span[style]') === null
  result.bigLineTruncated = [...document.querySelectorAll('.gp-files__trunc')].some((n) => n.textContent === 'files.lineTruncated')
  // Virtualization: the 5101-line big.js mounts only a windowed subset of rows,
  // not all of them, while the spacer height reflects the full line count.
  result.bigMountedRows = document.querySelectorAll('.gp-files__row').length
  result.bigTotalLines = 5101
  const virtGrid = document.querySelector('.gp-files__single--virt')
  result.bigSpacerHeight = virtGrid ? parseInt(virtGrid.style.height || '0', 10) : 0
  // In-panel Find (Ctrl+F): open on a text file, type a query, assert match
  // count + highlighted hits + next-match navigation, then Esc closes it.
  const findRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('a.txt'))
  if (findRow) { findRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  const codeEl = document.querySelector('.gp-files__code')
  Object.defineProperty(codeEl, 'offsetParent', { configurable: true, get: () => document.body })
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 60))
  result.findOpened = document.querySelector('.gp-find__input') !== null
  const findInput = document.querySelector('.gp-find__input')
  if (findInput) {
    // Fixture a.txt content is "const x = 1\nconst y = 2\n" → two "const".
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(findInput, 'const')
    findInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  }
  result.findHitCount = document.querySelectorAll('.gp-find-hit').length
  result.findActiveCount = document.querySelectorAll('.gp-find-hit--active').length
  result.findCountLabel = document.querySelector('.gp-find__count')?.textContent
  document.querySelector('.gp-find__btn[title="files.findNext"]')?.click()
  await new Promise((r) => setTimeout(r, 60))
  result.findCountAfterNext = document.querySelector('.gp-find__count')?.textContent
  if (findInput) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(findInput, 'zzzznotfound')
    findInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  }
  result.findNoMatchLabel = document.querySelector('.gp-find__count')?.textContent
  // Case sensitivity: default is insensitive, so "CONST" matches the lowercase
  // "const"; toggling Match case drops the matches to zero.
  if (findInput) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(findInput, 'CONST')
    findInput.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 200))
  }
  result.findCaseInsensitiveHits = document.querySelectorAll('.gp-find-hit').length
  document.querySelector('.gp-find__case')?.click()
  await new Promise((r) => setTimeout(r, 80))
  result.findCaseButtonActive = document.querySelector('.gp-find__case')?.classList.contains('gp-find__case--active') === true
  result.findCaseSensitiveHits = document.querySelectorAll('.gp-find-hit').length
  result.findCaseSensitiveLabel = document.querySelector('.gp-find__count')?.textContent
  // Toggle case back off so the Esc-close assertion below starts from a clean
  // insensitive state.
  document.querySelector('.gp-find__case')?.click()
  await new Promise((r) => setTimeout(r, 60))
  findInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 60))
  result.findClosed = document.querySelector('.gp-find__input') === null

  // Sticky restore: on the Files tab with `src` expanded and a file selected,
  // a view-tab switch unmounts the panel; returning within the window must
  // restore the Files tab, the expanded dir, and the selection (not reset to
  // the root). Simulate the switch by unmounting and remounting the view root.
  result.preUnmountFilesActive = document.querySelector('.gp-tab--active')?.textContent?.includes('tab.files') ?? false
  result.preUnmountSelected = document.querySelector('.gp-files__tree .gp-tree-row--active')?.textContent?.trim() ?? null
  result.preUnmountChildVisible = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].some((r) => (r.textContent || '').includes('a.txt'))
  viewRoot.unmount()
  await new Promise((r) => setTimeout(r, 50))
  const viewRoot2 = ReactDOM.createRoot(document.getElementById('panel'))
  viewRoot2.render(viewEntry.component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 500))
  result.restoredFilesActive = document.querySelector('.gp-tab--active')?.textContent?.includes('tab.files') ?? false
  result.restoredChildVisible = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].some((r) => (r.textContent || '').includes('a.txt'))
  result.restoredSelected = document.querySelector('.gp-files__tree .gp-tree-row--active')?.textContent?.trim() ?? null
  result.restoredPreviewShown = document.querySelector('.gp-files__code, .gp-files__markdown, .gp-files__image') !== null
  return result
}, SNAP)

await browser.close()

try {
  assert.equal(out.error, undefined, out.error)
  assert.deepEqual(out.slots.sort(), ['conversation.input.left', 'conversation.view', 'plugins.bundle.config'])
  assert.equal(out.pillHasDirty, true, 'dirty pill shows the orange git class')
  assert.equal(out.viewOrder, 30, 'panel is ordered after Chat/Trajectory')
  assert.equal(out.tabCount, 3, 'three sub-tabs')
  assert.equal(out.dirtyDefault, true, 'opening a dirty Git workspace defaults to Changes')
  assert.equal(out.noInitialFileListing, true, 'dirty default does not fetch hidden file-browser data')
  assert.equal(out.fontDefault, '13px', 'panel keeps the existing default font size')
  assert.equal(out.fontIncreased, '14px', 'font control increases panel text size')
  assert.equal(out.fontStored, '1', 'font adjustment persists locally')
  assert.equal(out.fontReset, '13px', 'font reset restores default size')
  assert.equal(out.wideLayout, 'wide', 'a wide panel uses the three-column wide layout')
  assert.equal(out.wideShowsControls, true, 'a wide panel shows the trailing controls')
  assert.equal(out.wideShowsLabel, true, 'a wide panel shows the tab labels')
  assert.equal(out.narrowLayout, 'compact', 'a phone-width panel switches to the compact layout')
  assert.equal(out.narrowShowsControls, true, 'the compact layout keeps the trailing controls (wrapped, not hidden)')
  assert.equal(out.narrowKeepsLabel, true, 'the compact layout still keeps the tab labels')
  assert.equal(out.tinyHidesLabel, true, 'a very narrow panel drops the tab labels')
  assert.equal(out.tinyKeepsIcon, true, 'a very narrow panel keeps the tab icons')
  assert.equal(out.tinyShowsControls, true, 'a very narrow compact panel still keeps the trailing controls')
  assert.equal(out.restoresLayout, 'wide', 'widening the panel restores the wide layout')
  assert.equal(out.restoresLabel, true, 'widening the panel restores the tab labels')
  assert.equal(out.hasStats, true, 'stats bar rendered')
  assert.equal(out.hasCommitBox, true, 'commit box rendered')
  assert.equal(out.hasAmend, true, 'amend checkbox present')
  assert.equal(out.hasStashBtn, true, 'stash button present in the changes toolbar')
  assert.equal(out.stashRows, 1, 'the stash list expands to its one entry')
  assert.equal(out.stashDropHint, true, 'the stash drop confirm shows the AI hint')
  assert.equal(out.stashDropEscClosed, true, 'Escape dismisses the stash drop confirm')
  assert.equal(out.commitDisabledEmpty, true, 'commit button is disabled without a message')
  assert.equal(out.commitEnabledWithMessage, true, 'commit button enables once a message is typed')
  assert.equal(out.commitPrimaryHoverKeepsColor, true, 'primary button defines a hover style that keeps its color')
  assert.equal(out.changeRows, 5, 'five change rows (three text + one image + one svg)')
  assert.equal(out.imagePanes, 2, 'image diff renders both panes in split mode')
  assert.equal(out.imageImgs, 2, 'both panes render an image')
  assert.equal(out.imageSrcOk, true, 'panes carry data URL images')
  assert.deepEqual(out.imageHeads, ['diff.before', 'diff.after'], 'pane labels before/after')
  assert.equal(out.imageSingle, true, 'after-mode collapses to one pane')
  assert.equal(out.imageSingleHead, 'diff.after', 'the single pane keeps its label')
  assert.equal(out.svgHasToggle, true, 'an SVG diff shows the render/source toggle bar')
  assert.equal(out.svgRenderDefault, true, 'an SVG diff defaults to the rendered comparison')
  assert.equal(out.svgSourceShowsDiff, true, 'switching an SVG to source shows the text diff')
  assert.equal(out.svgRenderRestored, true, 'switching an SVG back to render restores the comparison')
  assert.equal(out.hasBranchList, true, 'branch list rendered on overview')
  assert.equal(out.searchFullHint, true, 'a wide search box shows the full message/hash hint')
  assert.equal(out.searchShortHint, true, 'a narrow search box drops the hint to the short placeholder')
  assert.equal(out.searchHintRestored, true, 'widening the search box restores the full hint')
  assert.equal(out.commitRows, 2, 'two commit rows')
  assert.equal(out.hasGraph, true, 'commit graph svg rendered')
  assert.equal(out.hasDetailFileRow, true, 'selecting a commit lists its changed files')
  assert.equal(out.hasCreateTagBtn, true, 'commit detail shows a create-tag action')
  assert.equal(out.tagModalOpened, true, 'the create-tag dialog opens')
  assert.equal(out.tagModalHint, true, 'the create-tag dialog shows the AI hint')
  assert.equal(out.hasModal, true, 'clicking a file opens the diff modal')
  assert.equal(out.modalHasDiff, true, 'the modal renders a unified diff (default view)')
  assert.equal(out.modalWordSyntax, true, 'word emphasis retains DSH syntax colors')
  assert.equal(out.diffFindOpened, true, 'Ctrl+F opens Find inside the diff modal')
  assert.ok(out.diffFindHits >= 1, 'the diff Find highlights matches')
  assert.equal(out.diffFindActive, 1, 'exactly one diff match is the active hit')
  assert.ok(/^1\/\d+$/.test(out.diffFindCount || ''), 'the diff Find shows an active/total count')
  assert.ok(out.diffFindCaseInsensitiveHits >= 1, 'diff Find is case-insensitive by default: COUNT matches count')
  assert.equal(out.diffFindCaseSensitiveHits, 0, 'enabling Match case in the diff Find drops mismatched-case matches')
  assert.equal(out.diffFindClosedModalKept, true, 'Esc closes diff Find without closing the modal')
  assert.equal(out.modalClosedByEsc, true, 'Esc closes the modal')
  assert.equal(out.modalClosedByBtn, true, 'the close button closes the modal')
  assert.equal(out.livePillJump, true, 'pill jump still takes the active panel to Changes')
  assert.ok(out.filesTreeRows >= 3, 'files tab lists the root directory entries')
  assert.equal(out.ignoredRowsDimmed, true, 'Git ignored files and directories appear translucent')
  assert.equal(out.folderIcon, 'folder', 'folder rows use the official folder glyph')
  assert.ok(out.filesTreeRowsAfterExpand > out.filesTreeRows, 'expanding a directory reveals its children')
  assert.equal(out.filesCodeShown, true, 'selecting a text file shows the code preview')
  assert.equal(out.txtRowSelected, true, 'the selected file row carries the active class')
  assert.equal(out.selectionStyled, true, 'the active file row has a distinct primary-tinted highlight')
  assert.equal(out.officialCodeHighlight, true, 'code preview renders syntax spans from the DSH highlighter')
  assert.equal(out.codeIconPath, 'src/index.ts', 'code file glyph receives its relative path for official type classification')
  assert.equal(out.copiedPath, 'src/index.ts', 'preview copies the selected file path relative to browse root')
  assert.equal(out.copyFeedback, 'files.pathCopied', 'copy button confirms successful clipboard write')
  assert.equal(out.copyFeedbackReset, true, 'late copy of previous file cannot change current file feedback')
  assert.equal(out.copyDeniedFeedback, true, 'clipboard denial shows an actionable failure state')
  assert.equal(out.filesImageShown, true, 'selecting an image shows the inline image preview')
  assert.equal(out.markdownRenderedDefault, true, 'Markdown defaults to the rendered view')
  assert.equal(out.markdownSourceShown, true, 'source button shows the code view')
  assert.equal(out.markdownRenderRestored, true, 'render button restores official MarkdownText')
  assert.equal(out.htmlSourceDefault, true, 'HTML defaults to the source view, never auto-rendered')
  assert.equal(out.htmlRenderShown, true, 'switching HTML to render mounts the preview iframe')
  assert.equal(out.htmlFrameSandbox, 'allow-scripts', 'the HTML iframe runs scripts but stays a unique opaque origin (no allow-same-origin)')
  assert.equal(out.htmlFrameHasSrcdoc, true, 'the HTML iframe carries the page bytes via srcdoc (no extra fetch)')
  assert.equal(out.bigHighlightOff, true, 'a large text file skips highlighting and shows the notice')
  assert.equal(out.bigNoSyntaxSpans, true, 'a large text file renders plain text (no syntax spans)')
  assert.equal(out.bigLineTruncated, true, 'an over-long line is truncated with a marker')
  assert.ok(out.bigMountedRows > 0 && out.bigMountedRows < out.bigTotalLines, `virtualized: mounts a window (${out.bigMountedRows}), not all ${out.bigTotalLines} rows`)
  assert.equal(out.bigSpacerHeight, out.bigTotalLines * 20, 'the virtual spacer height reflects the full line count')
  assert.equal(out.findOpened, true, 'Ctrl+F opens the in-panel find while the preview is visible')
  assert.equal(out.findHitCount, 2, 'the query highlights every match in the file')
  assert.equal(out.findActiveCount, 1, 'exactly one match is the active hit')
  assert.equal(out.findCountLabel, '1/2', 'the count shows the active index and total')
  assert.equal(out.findCountAfterNext, '2/2', 'next-match navigation advances the active index')
  assert.equal(out.findNoMatchLabel, 'files.findNoMatch', 'a query with no results shows the no-match label')
  assert.equal(out.findCaseInsensitiveHits, 2, 'case-insensitive by default: CONST matches lowercase const')
  assert.equal(out.findCaseButtonActive, true, 'the Match case toggle reflects its active state')
  assert.equal(out.findCaseSensitiveHits, 0, 'enabling Match case drops mismatched-case matches')
  assert.equal(out.findCaseSensitiveLabel, 'files.findNoMatch', 'case-sensitive no-match shows the no-match label')
  assert.equal(out.findClosed, true, 'Esc closes the find box')
  assert.equal(out.preUnmountFilesActive, true, 'before the switch the Files tab is active')
  assert.ok(out.preUnmountSelected, 'before the switch a file is selected')
  assert.equal(out.preUnmountChildVisible, true, 'before the switch the expanded dir shows its child')
  assert.equal(out.restoredFilesActive, true, 'a quick return restores the Files sub-tab')
  assert.equal(out.restoredChildVisible, true, 'a quick return keeps the expanded directory open')
  assert.equal(out.restoredSelected, out.preUnmountSelected, 'a quick return keeps the same file selected')
  assert.equal(out.restoredPreviewShown, true, 'a quick return restores the file preview')
  assert.equal(errors.length, 0, 'no console errors: ' + JSON.stringify(errors))
  console.log('e2e run.mjs: PASS', JSON.stringify(out))
} catch (e) {
  console.error('e2e run.mjs: FAIL', e.message)
  console.error(JSON.stringify(out, null, 2))
  process.exit(1)
}
