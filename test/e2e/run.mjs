/**
 * E2E: render the built client bundle in a headless Chromium against a mock
 * connection RPC (a dirty repo snapshot), then assert the panel structure.
 *
 * Fully isolated — a local file:// harness, no dsh server, no touch of any
 * running instance. Requires the e2e fixtures (run test/e2e/setup.mjs first,
 * or `npm run test:e2e` which chains it).
 */
import { chromium } from 'playwright-core'
import { assertPanelResults } from './assert-panel-results.mjs'
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
  staged: 0, modified: 3, untracked: 2, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' },
  lastCommit: null,
  changes: [
    { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
    { path: 'd.txt', status: 'untracked', staged: false, isDirectory: false },
    // `--untracked-files=all` reports the files inside an untracked directory
    // individually; the row renders the file name plus the grey directory suffix.
    { path: 'newdir/note.txt', status: 'untracked', staged: false, isDirectory: false },
    // A nested repository stays directory-level, so its files must still be
    // recognised through the untracked ancestor.
    { path: 'vendored', status: 'untracked', staged: false, isDirectory: true },
    { path: 'img.png', status: 'modified', staged: false, isDirectory: false },
    { path: 'icon.svg', status: 'modified', staged: false, isDirectory: false },
  ],
  stats: { fileCount: 7, staged: 0, modified: 4, untracked: 3, insertions: 3, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })
await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
await page.addScriptTag({ path: resolve(DIR, 'steady-state-helper.mjs') })
await page.addScriptTag({ path: resolve(DIR, 'overview-fetch-helper.mjs') })
await page.addScriptTag({ path: resolve(DIR, 'confirmation-state-helper.mjs') })

const out = await page.evaluate(async (snap) => {
  const result = { steps: [] }
  const { fixture, connection } = window.createGitPanelMock(snap)
  // Record the full history query objects (fixture.queries keeps kinds only) so
  // the filter-menu assertions can see the author/since params that actually
  // reach the RPC. Patched before apply() so the client's captured caller wraps it.
  const historyQueries = []
  const mockCall = connection.rpc.call
  connection.rpc.call = async (channel, endpoint, payload) => {
    const q = payload && payload.args && payload.args.request && payload.args.request.query
    if (endpoint === 'gitPanel/query' && q && q.kind === 'history') historyQueries.push(q)
    return mockCall(channel, endpoint, payload)
  }
  const entry = window.__getLoaded()
  if (!entry || typeof entry.apply !== 'function') return { error: 'plugin did not load' }

  const registered = {}
  // Minimal configForms face so the wide font stepper can write fontDelta
  // (issue: font moved from localStorage to the host volatile config).
  const configState = { fontDelta: 0, showInputPill: true }
  // One-shot write failure so the panel's optimistic font step can be pinned
  // to roll back (review O7).
  let failFontWrite = false
  const services = {
    connection,
    configForms: {
      describe: () => ({
        getSnapshot: () => ({ status: 'ready', view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {} } } }] }, revision: 0, writable: true }),
        subscribe: () => () => {},
        ensure: async () => {},
      }),
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: { ...configState }, revision: 0, writable: true }),
        subscribe: () => () => {},
        set: async (field, value) => {
          if (field === 'fontDelta' && failFontWrite) {
            failFontWrite = false
            return false
          }
          configState[field] = value
          if (field === 'fontDelta') fixture.snapshot = { ...fixture.snapshot, fontDelta: value }
          return true
        },
      }),
    },
  }
  const ctx = {
    get: (k) => services[k],
    effect: (cb) => { try { cb() } catch (e) { /* ignore */ } },
    on: (event, listener) => { if (event === 'connection/reset') fixture.resetConnection = listener; return () => {} },
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (name, provider) => provider(),
      register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} },
    },
    locale: { register: () => () => {}, bind: () => (key, params) => (key.startsWith('time.') || key === 'stats.lastChange' || key === 'changes.truncatedCap') && params ? key + JSON.stringify(params) : key },
  }
  entry.apply(ctx)
  result.slots = Object.keys(registered)

  const ReactDOM = window.ReactDOM
  const pillEntry = registered['conversation.input.left']
  const pillElement = pillEntry.component({ sessionId: 'sess-1' })
  function CountedPill(props) { fixture.renders.pill++; return pillElement.type(props) }
  ReactDOM.createRoot(document.getElementById('pill')).render(window.React.createElement(CountedPill, pillElement.props))
  await new Promise((r) => setTimeout(r, 300))
  result.pillHasDirty = document.querySelector('.gp-pill--dirty') !== null

  const viewEntry = registered['conversation.view']
  result.viewLabel = viewEntry.reg.label ? viewEntry.reg.label() : null
  result.viewOrder = viewEntry.reg.order
  const viewRoot = ReactDOM.createRoot(document.getElementById('panel'))
  const panelElement = viewEntry.component({ sessionId: 'sess-1' })
  function CountedPanel(props) { fixture.renders.panel++; return panelElement.type(props) }
  viewRoot.render(window.React.createElement(CountedPanel, panelElement.props))
  await new Promise((r) => setTimeout(r, 500))
  result.tabCount = document.querySelectorAll('.gp-panel [role="tab"]').length
  result.dirtyDefault = document.querySelector('.gp-panel [role="tab"][aria-selected="true"]')?.textContent?.includes('tab.changes') ?? false
  result.noInitialFileListing = fixture.fileQueries.length === 0

  // The sub-tab switcher is the platform SegmentedTabs primitive: a role=tablist
  // owning one role=tab button per pane (aria-selected/aria-controls/tabIndex)
  // plus one aria-hidden sliding indicator whose translateX tracks the active
  // index. Asserted on observable DOM only; the click test restores the
  // dirty-default (Changes) selection it started from.
  result.segmentedTabs = await (async () => {
    const list = document.querySelector('.gp-panel [role="tablist"]')
    const tabs = [...document.querySelectorAll('.gp-panel [role="tab"]')]
    // The indicator is the tablist's own direct aria-hidden span.
    const indicator = list?.querySelector(':scope > span[aria-hidden="true"]') ?? null
    const selectedIndex = () => tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')
    const selectedText = () => tabs[selectedIndex()]?.textContent ?? null
    const paneOf = (tab) => tab === undefined ? null : document.getElementById(tab.getAttribute('aria-controls') || '')
    const paneShown = (key) => {
      const tab = tabs.find((t) => (t.textContent || '').includes(key))
      return paneOf(tab)?.style.display === 'contents'
    }
    const out = {
      hasTablist: list !== null,
      ariaLabel: list?.getAttribute('aria-label') ?? null,
      tabCount: tabs.length,
      everyTabHasAria: tabs.length === 3 && tabs.every((t) => t.hasAttribute('aria-selected') && (t.getAttribute('aria-controls') || '') !== ''),
      // Each aria-controls must resolve to that tab's own role=tabpanel node.
      controlsResolve: tabs.every((t) => paneOf(t)?.getAttribute('role') === 'tabpanel'),
      uniqueIds: new Set(tabs.map((t) => t.id)).size === tabs.length,
      onlySelectedIsTabStop: tabs.every((t) => (t.getAttribute('tabindex') === '0') === (t.getAttribute('aria-selected') === 'true')),
      indicatorHidden: indicator?.getAttribute('aria-hidden') === 'true',
      indicatorTransformAtChanges: indicator?.style.transform ?? null,
      activeAtChanges: selectedText(),
      changesPaneShown: paneShown('tab.changes'),
      overviewPaneHidden: !paneShown('tab.overview'),
      // The hand-rolled tab markup is gone.
      legacyTabButtons: document.querySelectorAll('.gp-panel .gp-tab').length,
    }
    const clickTab = async (key) => {
      tabs.find((t) => (t.textContent || '').includes(key))?.click()
      await new Promise((r) => setTimeout(r, 250))
    }
    await clickTab('tab.overview')
    out.activeAfterOverview = selectedText()
    out.indicatorTransformAtOverview = indicator?.style.transform ?? null
    out.overviewPaneShown = paneShown('tab.overview')
    out.changesPaneHidden = !paneShown('tab.changes')
    await clickTab('tab.changes')
    out.activeAfterChanges = selectedText()
    out.indicatorTransformAtChangesAgain = indicator?.style.transform ?? null
    out.changesPaneShownAgain = paneShown('tab.changes')
    return out
  })()

  const panelRoot = document.querySelector('.gp-panel')
  result.fontDefault = getComputedStyle(panelRoot).fontSize
  // The stepper marks the step in force (aria-pressed), so the default "A" is
  // not a dead, unmarked middle cell.
  const fontBtn = (cls) => document.querySelector('.gp-font__' + cls)
  const pressedState = () => ['decrease', 'reset', 'increase'].map((k) => fontBtn(k)?.getAttribute('aria-pressed')).join(',')
  result.fontPressedDefault = pressedState() === 'false,true,false'
  document.querySelector('.gp-font__increase')?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.fontIncreased = getComputedStyle(panelRoot).fontSize
  result.fontStored = String(configState.fontDelta)
  result.fontPressedIncreased = pressedState() === 'false,false,true'
  document.querySelector('.gp-font__reset')?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.fontReset = getComputedStyle(panelRoot).fontSize
  result.fontPressedReset = pressedState() === 'false,true,false'
  // A failed config write must roll the optimistic step back to the snapshot.
  failFontWrite = true
  document.querySelector('.gp-font__increase')?.click()
  await new Promise((r) => setTimeout(r, 400))
  result.fontWriteFailRolledBack = getComputedStyle(panelRoot).fontSize === '13px'
    && pressedState() === 'false,true,false'
    && panelRoot.getAttribute('data-font-delta') === '0'
    && String(configState.fontDelta) === '0'
  // The active cell is a neutral (module-platform) fill with the primary label
  // in bold; the harness only carries the variables we set, so pin them.
  panelRoot.style.setProperty('--dsw-alias-bg-module-platform', '#e6e6e6')
  panelRoot.style.setProperty('--dsw-alias-label-primary', '#0f1115')
  await new Promise((r) => setTimeout(r, 60))
  const activeFontStyle = getComputedStyle(fontBtn('reset'))
  result.fontPressedStyle = activeFontStyle.backgroundColor === 'rgb(230, 230, 230)'
    && activeFontStyle.color === 'rgb(15, 17, 21)' && activeFontStyle.fontWeight === '600'
  panelRoot.style.removeProperty('--dsw-alias-bg-module-platform')
  panelRoot.style.removeProperty('--dsw-alias-label-primary')
  // Responsive tab bar: a wide panel is the three-column 'wide' layout with the
  // trailing controls inline; narrowing to a phone width switches to the
  // 'compact' layout, which shows the short tab labels, drops the font stepper
  // (it lives on the plugin config page), and does not mount the version
  // cluster at all.
  const panelHost = document.getElementById('panel')
  const fontCluster = panelRoot.querySelector('.gp-font')
  const firstLabel = panelRoot.querySelector('.gp-tab__label')
  const verbar = () => panelRoot.querySelector('.gp-verbar')
  const labelVisible = (el) => {
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1
  }
  const rowCenter = (el) => {
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2
  }
  const sameRow = () => Math.abs(rowCenter(panelRoot.querySelector('.gp-tabbar__tabs')) - rowCenter(fontCluster)) <= 2
  result.wideLayout = panelRoot.getAttribute('data-layout')
  result.wideShowsControls = getComputedStyle(fontCluster).display !== 'none'
  result.wideShowsLabel = labelVisible(firstLabel)
  result.wideShowsVersion = verbar() !== null
  result.wideLabelFull = firstLabel?.textContent ?? null
  // The update-check pill centres its refresh glyph on the label's line: the
  // 12px svg used to sit at the top of the 15px icon slot, 1.5px above the text.
  const verBtn = panelRoot.querySelector('.gp-verbar__btn')
  const verSvg = verBtn?.querySelector('svg')
  const verLabelNode = [...(verBtn?.childNodes ?? [])].find((n) => n.nodeType === 3 && (n.textContent || '').trim() !== '')
  const verLabelCenter = (() => {
    if (!verLabelNode) return null
    const range = document.createRange()
    range.selectNodeContents(verLabelNode)
    const r = range.getBoundingClientRect()
    return r.top + r.height / 2
  })()
  result.versionIconAligned = verBtn !== null && verSvg !== null && verLabelCenter !== null
    && Math.abs(rowCenter(verSvg) - verLabelCenter) <= 0.5
    && Math.abs(rowCenter(verSvg) - rowCenter(verBtn)) <= 0.5
  panelHost.style.width = '400px'
  await new Promise((r) => setTimeout(r, 120))
  result.narrowLayout = panelRoot.getAttribute('data-layout')
  result.narrowFontUnmounted = panelRoot.querySelector('.gp-font') === null
  const narrowLabel = panelRoot.querySelector('.gp-tab__label')
  result.narrowShowsLabel = labelVisible(narrowLabel)
  result.narrowShortLabel = narrowLabel?.textContent ?? null
  result.narrowKeepsIcon = getComputedStyle(panelRoot.querySelector('.gp-tab__icon')).display !== 'none'
  result.narrowHidesVersion = verbar() === null
  result.narrowTabBarRows = Math.round(panelRoot.querySelector('.gp-tabbar').getBoundingClientRect().height)
  // Compact indicator geometry: the platform slides a direct aria-hidden span
  // whose width must track the selected column (pinned DOM contract).
  {
    const tabs = [...panelRoot.querySelectorAll('.gp-tabbar__tabs [role="tab"]')]
    const indicator = panelRoot.querySelector('.gp-tabbar__tabs > span[aria-hidden="true"]')
    const selected = tabs.find((tb) => tb.getAttribute('aria-selected') === 'true')
    result.narrowIndicatorTracksTab = indicator !== null && selected !== null && tabs.length === 3
      && Math.abs(indicator.getBoundingClientRect().width - selected.getBoundingClientRect().width) <= 2
      && Math.abs(indicator.getBoundingClientRect().left - selected.getBoundingClientRect().left) <= 2
  }
  panelHost.style.width = '260px'
  await new Promise((r) => setTimeout(r, 80))
  result.tinyShowsLabel = labelVisible(panelRoot.querySelector('.gp-tab__label'))
  result.tinyKeepsIcon = getComputedStyle(panelRoot.querySelector('.gp-tab__icon')).display !== 'none'
  result.tinyFontUnmounted = panelRoot.querySelector('.gp-font') === null
  panelHost.style.width = '1000px'
  await new Promise((r) => setTimeout(r, 120))
  result.restoresLayout = panelRoot.getAttribute('data-layout')
  result.restoresLabel = labelVisible(panelRoot.querySelector('.gp-tab__label'))
  result.restoresVersion = verbar() !== null
  result.restoresFont = panelRoot.querySelector('.gp-font') !== null
  const changesTab = [...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => (t.textContent || '').includes('tab.changes'))
  if (changesTab) { changesTab.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.hasStats = document.querySelector('.gp-stats') !== null
  result.hasCommitBox = document.querySelector('.gp-commitbox') !== null
  result.changeRows = document.querySelectorAll('.gp-file-row').length
  // A desktop panel squeezed by a sidebar is the compact layout but is not a
  // phone: the commit editor stays docked and open, so its AI entry is never
  // folded away (issue #66). Only the action row has to fit the 400px panel
  // without wrapping its labels.
  panelHost.style.width = '400px'
  await new Promise((r) => setTimeout(r, 120))
  result.squeezedLayout = panelRoot.getAttribute('data-layout')
  result.squeezedKeepsEditor = document.querySelector('.gp-commitbox') !== null
  result.squeezedNoCommitBar = document.querySelector('.gp-commitbar') === null
  result.squeezedNoFoldControl = document.querySelector('.gp-commitbox__fold') === null
  const compactCommitBtn = document.querySelector('.gp-commitbox__actions .gp-btn--primary')
  const compactSuggestBtn = document.querySelector('.gp-commitbox__actions .gp-btn:not(.gp-btn--primary)')
  const amendLabel = document.querySelector('.gp-commitbox__amend')
  result.squeezedShowsAi = compactSuggestBtn !== null
  result.commitActionsNowrap = [compactCommitBtn, compactSuggestBtn].every((b) => b !== null && getComputedStyle(b).whiteSpace === 'nowrap')
  result.commitActionsInsideRow = [compactCommitBtn, compactSuggestBtn].every((b) => b !== null
    && b.getBoundingClientRect().right <= panelRoot.getBoundingClientRect().right + 1)
  result.amendLabelSingleLine = amendLabel !== null
    && getComputedStyle(amendLabel).whiteSpace === 'nowrap'
    && amendLabel.getBoundingClientRect().height <= 28
  // A press inside or outside the always-open editor leaves it in place.
  document.querySelector('.gp-commitbox__msg')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 80))
  document.querySelector('.gp-stats')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.squeezedPressKeepsEditor = document.querySelector('.gp-commitbox') !== null
  // Compact stats bar: the panel is narrow but tall (600px), so it keeps the
  // timestamps on a row of their own — a squeezed column must not cost content
  // the screen can afford (issue #66 follow-up). Narrow width alone never hides
  // them; only a panel that is narrow *and* short does.
  result.compactStatsShowsTimes = document.querySelector('.gp-stats .gp-stats__times') !== null
  result.compactKeepsEditorWhenTall = document.querySelector('.gp-commitbox') !== null
  result.compactStatsNoToggle = document.querySelector('.gp-stats__toggle') === null
  // Shrinking the height alone flips the panel to cramped: the timestamps drop
  // and the commit editor folds into its one-row bar.
  panelHost.style.height = '420px'
  await new Promise((r) => setTimeout(r, 150))
  const crampedStats = document.querySelector('.gp-stats')
  result.crampedStatsOneLine = crampedStats !== null && crampedStats.getBoundingClientRect().height <= 40
  result.crampedStatsNoTimes = document.querySelector('.gp-stats .gp-stats__times') === null
  result.crampedCommitBar = document.querySelector('.gp-commitbar') !== null
  // Restoring the height brings both back without touching the width.
  panelHost.style.height = '600px'
  await new Promise((r) => setTimeout(r, 150))
  result.restoredStatsTimes = document.querySelector('.gp-stats .gp-stats__times') !== null
  result.restoredCommitEditor = document.querySelector('.gp-commitbox') !== null
  panelHost.style.width = '1000px'
  await new Promise((r) => setTimeout(r, 120))
  result.wideStatsShowsTimes = document.querySelector('.gp-stats .gp-stats__times') !== null
  // A capped snapshot: the list only carries the visible slice, so the changes
  // page must surface the truncation and keep the group headers on the full
  // stats counts (a group whose rows all fell past the cap still shows up).
  const visibleSlice = fixture.snapshot.changes.slice(0, 2)
  fixture.snapshot = {
    ...fixture.snapshot,
    changes: visibleSlice,
    truncated: true,
    truncatedReason: 'cap',
    modified: 4,
    untracked: 1200,
    stats: { ...fixture.snapshot.stats, fileCount: 1204, modified: 4, untracked: 1200 },
  }
  const stageAllBtn = document.querySelector('.gp-changes__stage-all')
  stageAllBtn?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.truncatedReloadAction = fixture.actions[fixture.actions.length - 1]?.kind
  result.truncatedNotice = document.querySelector('.gp-notice')?.textContent || ''
  // Notice banners are dismissible: the close button hides it until the text changes.
  const noticeClose = document.querySelector('.gp-notice .gp-notice__close')
  result.noticeHasClose = noticeClose !== null && noticeClose.getAttribute('aria-label') === 'common.close'
  noticeClose?.click()
  await new Promise((r) => setTimeout(r, 80))
  result.noticeDismissed = document.querySelector('.gp-notice') === null
  result.truncatedHeads = [...document.querySelectorAll('.gp-group-head')].map((n) => n.textContent)
  // A lossy read plus a collapsed untracked side: both notices show, with the
  // neutral incomplete wording for the stream-clipped reason.
  fixture.snapshot = {
    ...fixture.snapshot,
    truncated: true,
    truncatedReason: 'lossy',
    untrackedCollapsed: true,
  }
  stageAllBtn?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.incompleteNotices = [...document.querySelectorAll('.gp-notice')].map((n) => n.textContent || '')
  // Restore the normal snapshot (another landed action re-delivers it).
  fixture.snapshot = snap
  stageAllBtn?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.hasAmend = document.querySelector('.gp-commitbox__amend') !== null
  // Stash: the toolbar carries a stash button; the stash list (mock → one entry)
  // expands to a row, and the drop confirm shows the shared AI hint.
  result.hasStashBtn = document.querySelector('.gp-changes__stash')?.getAttribute('aria-label') === 'changes.stash'
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
  // Stash push dialog (shares renderModalShell): the toolbar button opens it with
  // the AI hint, and Escape dismisses it.
  const stashPushBtn = document.querySelector('.gp-changes__stash')
  if (stashPushBtn) { stashPushBtn.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.stashPushOpened = document.querySelector('.gp-modal--sm') !== null
  result.stashPushHint = (document.querySelector('.gp-modal--sm .gp-modal__hint')?.textContent || '') === 'ops.aiHint'
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.stashPushEscClosed = document.querySelector('.gp-modal--sm') === null
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

  // AI suggest in flight: the message box and amend toggle lock so typing
  // can't race the incoming message; both unlock once it lands.
  const suggestBtn = [...document.querySelectorAll('.gp-commitbox__actions .gp-btn')].find((b) => !b.classList.contains('gp-btn--primary'))
  if (suggestBtn && msgBox) {
    suggestBtn.click()
    await new Promise((r) => setTimeout(r, 60))
    const amendCb = document.querySelector('.gp-commitbox__amend input')
    result.suggestLocksMessage = msgBox.readOnly === true && msgBox.getAttribute('aria-busy') === 'true'
    result.suggestLocksAmend = amendCb?.disabled === true
    // The platform loader sits inside the locked message field so the disabled
    // state reads as "generating", not as a broken input.
    const spinner = document.querySelector('.gp-commitbox__msg-wrap .gp-commitbox__spin')
    result.suggestFieldSpinner = spinner !== null
    // The glyph is the platform's ongoing mark, not a ring the plugin draws:
    // one loader for the whole APP, so it cannot drift from the shell's.
    result.suggestFieldSpinnerPlatform = spinner?.querySelector('svg[data-state="ongoing"]') !== null
    result.suggestFieldSpinnerAria = spinner?.getAttribute('aria-hidden') === 'true'
    // Presence in the DOM is not enough: the glyph must render inside the
    // field's own box, otherwise it is invisible where it matters.
    if (spinner) {
      const s = spinner.getBoundingClientRect()
      const f = msgBox.getBoundingClientRect()
      result.suggestFieldSpinnerInside = s.width > 0 && s.height > 0
        && s.top >= f.top && s.bottom <= f.bottom
        && s.left >= f.left && s.right <= f.right
    } else {
      result.suggestFieldSpinnerInside = false
    }
    fixture.releaseSuggest?.()
    await new Promise((r) => setTimeout(r, 80))
    result.suggestUnlocksMessage = msgBox.readOnly === false && amendCb?.disabled === false
    result.suggestFieldSpinnerGone = document.querySelector('.gp-commitbox__msg-wrap .gp-commitbox__spin') === null
    result.suggestFilled = msgBox.value === 'feat: suggested'
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
  // Each comparison pane renders its own zoom toolbar (zoom shares one component).
  result.zoomDiffBars = document.querySelectorAll('.gp-imgcmp .gp-zoom__bar').length
  // Each pane zooms on its own: zooming the left one must leave the right alone.
  const paneRoots = [...document.querySelectorAll('.gp-imgcmp .gp-zoom')]
  const panePct = (i) => paneRoots[i]?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  const paneRendered = (i) => Math.round(paneRoots[i]?.querySelector('img')?.getBoundingClientRect().width ?? 0)
  const panePctBefore = [panePct(0), panePct(1)]
  const paneWBefore = paneRendered(1)
  paneRoots[0]?.querySelector('button[aria-label="files.zoomIn"]')?.click()
  await new Promise((r) => setTimeout(r, 150))
  result.zoomDiffPanesIndependent = panePct(0) !== panePctBefore[0] && panePct(1) === panePctBefore[1]
    && paneRendered(0) > paneRendered(1) && paneRendered(1) === paneWBefore
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
  // The left pane was left zoomed above; feeding the comparison panes a new file
  // must drop that zoom instead of carrying it over.
  const panePctsAfterSwitch = [...document.querySelectorAll('.gp-imgcmp .gp-zoom__pct')].map((e) => e.textContent)
  result.zoomDiffResetsOnFileSwitch = panePctsAfterSwitch.length === 0 || panePctsAfterSwitch.every((p) => p === '100%')
  result.svgHasToggle = document.querySelector('.gp-svgdiff__bar') !== null
  result.svgRenderDefault = document.querySelector('.gp-svgdiff .gp-imgcmp') !== null
  const svgSourceBtn = [...document.querySelectorAll('.gp-svgdiff__bar .gp-seg__btn')].find((b) => (b.textContent || '') === 'diff.svgSource')
  if (svgSourceBtn) { svgSourceBtn.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.svgSourceShowsDiff = document.querySelector('.gp-svgdiff .gp-diff__unified, .gp-svgdiff .gp-diff__side, .gp-svgdiff .gp-diff__single') !== null
  const svgRenderBtn = [...document.querySelectorAll('.gp-svgdiff__bar .gp-seg__btn')].find((b) => (b.textContent || '') === 'diff.svgRender')
  if (svgRenderBtn) { svgRenderBtn.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.svgRenderRestored = document.querySelector('.gp-svgdiff .gp-imgcmp') !== null

  const tabs = [...document.querySelectorAll('.gp-panel [role="tab"]')]
  const overviewTab = tabs.find((t) => (t.textContent || '').includes('tab.overview'))
  if (overviewTab) { overviewTab.click(); await new Promise((r) => setTimeout(r, 500)) }
  result.hasBranchList = document.querySelector('.gp-branch-group') !== null
  result.commitRows = document.querySelectorAll('.gp-commit-row').length
  result.hasGraph = document.querySelector('.gp-graph-svg') !== null
  // Left-column status bar (wide): the GitHub repo link resolves to the parsed
  // web URL; the branch is synced (behind 0), so no pull button is offered.
  const sbar = document.querySelector('.gp-col--left .gp-statusbar')
  result.statusBarShown = sbar !== null
  result.statusRepoHref = sbar?.querySelector('a.gp-statusbar__repo')?.getAttribute('href') ?? null
  result.statusSyncedShown = (sbar?.querySelector('.gp-statusbar__state')?.textContent || '').includes('status.synced')
  result.statusNoPullWhenSynced = sbar?.querySelector('.gp-statusbar__pull') == null
  result.statusNoPushWhenSynced = ![...(sbar?.querySelectorAll('.gp-statusbar__pull') || [])].some((b) => (b.textContent || '').includes('status.push'))
  // Flip the served snapshot to strictly-ahead and re-drive through the check
  // button (fetch → onAction → controller.accept): the push button appears, and
  // confirming shows the outgoing scope preview.
  const clickCheck = async () => {
    const btn = document.querySelector('.gp-col--left .gp-statusbar .gp-statusbar__btn')
    if (btn) { btn.click(); await new Promise((r) => setTimeout(r, 300)) }
  }
  const findBarBtn = (key) => [...document.querySelectorAll('.gp-col--left .gp-statusbar__sync button')].find((b) => (b.textContent || '').includes(key)) || null
  fixture.snapshot = { ...snap, ahead: 3, behind: 0 }
  await clickCheck()
  const pushBtn = findBarBtn('status.push')
  result.statusAheadPushShown = pushBtn != null
  if (pushBtn) { pushBtn.click(); await new Promise((r) => setTimeout(r, 250)) }
  result.statusPushConfirmOpened = [...document.querySelectorAll('.gp-modal__path')].some((n) => (n.textContent || '').includes('status.pushConfirmTitle'))
  result.statusPushScopeShown = (document.querySelector('.gp-modal .gp-pullscope')?.textContent || '').includes('status.pushScope')
  document.querySelector('.gp-modal__close')?.click(); await new Promise((r) => setTimeout(r, 150))
  // Flip to a no-upstream branch: the publish button replaces push, and its
  // confirm opens (the second reminder before `git push -u`).
  fixture.snapshot = { ...snap, ahead: 0, behind: 0, hasUpstream: false }
  await clickCheck()
  result.statusNoUpstreamNoPush = findBarBtn('status.push') == null
  const publishBtn = findBarBtn('status.publish')
  result.statusPublishShown = publishBtn != null
  if (publishBtn) { publishBtn.click(); await new Promise((r) => setTimeout(r, 250)) }
  result.statusPublishConfirmOpened = [...document.querySelectorAll('.gp-modal__path')].some((n) => (n.textContent || '').includes('status.publishConfirmTitle'))
  document.querySelector('.gp-modal__close')?.click(); await new Promise((r) => setTimeout(r, 150))
  fixture.snapshot = snap
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

  // ── branch switch (wide): row switch button → confirm → run payload ──
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  // ── filter dropdowns: the official Menu primitive, not a native <select> ──
  // Opening shows a role="menu" surface; picking an author reaches the next
  // history query (the params, not just the kind) and closes the menu; Escape
  // and an outside pointerdown close without applying anything; the trigger
  // label reflects the current value. Asserted on observable DOM + RPC only.
  result.filterMenu = await (async () => {
    const toolbar = document.querySelector('.gp-history .gp-toolbar')
    const triggers = [...(toolbar?.querySelectorAll('.gp-select-trigger') || [])]
    const menu = () => document.querySelector('[role="menu"]')
    const itemWith = (text) => [...(menu()?.querySelectorAll('[role="menuitem"]') || [])]
      .find((b) => (b.textContent || '') === text) || null
    const out = {
      nativeSelects: document.querySelectorAll('.gp-history .gp-toolbar select').length,
      triggerCount: triggers.length,
      fetchStillDirect: toolbar?.querySelector(':scope > button[title="overview.fetch"]') != null,
    }
    const [authorTrigger, sinceTrigger] = triggers
    if (authorTrigger === undefined || sinceTrigger === undefined) return out
    out.initialAuthor = authorTrigger.textContent || ''
    out.initialSince = sinceTrigger.textContent || ''

    authorTrigger.click(); await wait(150)
    out.openShowsMenu = menu() !== null
    out.openAriaExpanded = authorTrigger.getAttribute('aria-expanded')
    out.itemsListed = [...(menu()?.querySelectorAll('[role="menuitem"]') || [])].map((b) => b.textContent)

    const queriesBefore = historyQueries.length
    itemWith('Tester')?.click(); await wait(300)
    out.pickClosesMenu = menu() === null
    out.pickAriaExpanded = authorTrigger.getAttribute('aria-expanded')
    out.authorLabelAfterPick = authorTrigger.textContent || ''
    out.historyCarriedAuthor = historyQueries.slice(queriesBefore).some((q) => q.author === 'Tester')
    // Filtering retains nodes and only draws parent connections with evidence.
    result.graphShownOnAuthorFilter = document.querySelector('.gp-history .gp-graph-svg') !== null

    const sinceBefore = historyQueries.length
    sinceTrigger.click(); await wait(150)
    out.sinceMenuOpened = menu() !== null
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(200)
    out.escapeClosesMenu = menu() === null
    out.escapeKeepsFilter = (sinceTrigger.textContent || '') === out.initialSince
    out.escapeAppliedNothing = !historyQueries.slice(sinceBefore).some((q) => q.since !== undefined)

    sinceTrigger.click(); await wait(150)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await wait(200)
    out.outsideClickClosesMenu = menu() === null
    out.outsideClickKeepsFilter = (sinceTrigger.textContent || '') === out.initialSince
    return out
  })()

  // Rows are matched by the full ref name in `title`: a ref nested in a
  // directory row shows only its last path segment, while the directory row
  // carries the directory path.
  const leftRow = (name) => [...document.querySelectorAll('.gp-col--left .gp-branch-row')].find((r) => (r.getAttribute('title') || '') === name) || null
  const switchBtnOf = (name) => leftRow(name)?.querySelector('.gp-branch-row__switch') ?? null
  result.switchNoFixedEntry = document.querySelector('.gp-switch-row') === null
  // The repo's primary branch leads the local list (host order otherwise).
  const localGroup = [...document.querySelectorAll('.gp-col--left .gp-branch-group')].find((g) => (g.textContent || '').includes('overview.local'))
  result.branchPrimaryFirst = localGroup?.querySelector('.gp-branch-row')?.getAttribute('title') === 'main'
  // The remote section starts collapsed; expand it so its rows are listed.
  ;[...document.querySelectorAll('.gp-col--left .gp-branch-group__head')].find((el) => (el.textContent || '').includes('overview.remote'))?.click()
  await wait(60)
  // Remote refs sharing the `origin/` prefix fold into one collapsible dir row
  // that carries a folder glyph instead of a branch icon; deeper dirs start
  // closed so a remote with many `origin/feat/*` refs does not unfold at once.
  const originDir = leftRow('origin')
  result.branchDirRow = originDir?.classList.contains('gp-branch-row--dir') === true
  result.branchDirLabel = originDir?.querySelector('.gp-tree-name')?.textContent ?? null
  result.branchDirHasFolder = originDir?.querySelector('.gp-branch-row__ic--folder') !== null
  result.branchLeafHasNoFolder = leftRow('origin/main')?.querySelector('.gp-branch-row__ic--folder') === null
  result.branchDirHasNoCount = document.querySelectorAll('.gp-branch-dir__count').length === 0
  result.branchDirExpandedDefault = originDir?.getAttribute('aria-expanded') === 'true'
  // A dir row is a child of its section head, so its chevron must sit to the
  // right of the section chevron — never flush with it.
  const leftOf = (el) => el?.getBoundingClientRect().left ?? -1
  const remoteHead = [...document.querySelectorAll('.gp-col--left .gp-branch-group__head')].find((el) => (el.textContent || '').includes('overview.remote'))
  result.branchDirIndentedFromSection = leftOf(originDir?.querySelector('.gp-branch-row__chev svg')) > leftOf(remoteHead?.querySelector('svg'))
  // Labels are compared by their laid-out x so the indent is real, not just padding.
  const labelX = (name) => leftRow(name)?.querySelector('.gp-tree-name')?.getBoundingClientRect().left ?? -1
  result.branchLeafIndented = labelX('origin/main') > labelX('origin')
  const nestedDir = leftRow('origin/feat')
  result.branchNestedDirCollapsed = nestedDir?.getAttribute('aria-expanded') === 'false' && leftRow('origin/feat/branch-tree') === null
  nestedDir?.click()
  await wait(60)
  result.branchNestedDirExpands = leftRow('origin/feat/branch-tree') !== null && leftRow('origin/feat')?.getAttribute('aria-expanded') === 'true'
  result.branchNestedLeafIndented = labelX('origin/feat/branch-tree') > labelX('origin/feat')
  leftRow('origin/feat')?.click()
  await wait(60)
  result.branchNestedDirRecollapses = leftRow('origin/feat/branch-tree') === null
  // The row's left corners are square (flush against the panel edge, so the
  // highlight and its inset accent bar reach it) while the right end is rounded.
  const rowStyle = getComputedStyle(leftRow('origin/main'))
  result.branchRowLeftSquare = rowStyle.borderTopLeftRadius === '0px' && rowStyle.borderBottomLeftRadius === '0px'
  result.branchRowRightRounded = rowStyle.borderTopRightRadius === '6px' && rowStyle.borderBottomRightRadius === '6px'
  originDir?.click()
  await wait(60)
  result.branchDirCollapsedHidesChild = leftRow('origin/main') === null && leftRow('origin')?.getAttribute('aria-expanded') === 'false'
  leftRow('origin')?.click()
  await wait(60)
  result.branchDirReexpanded = leftRow('origin/main') !== null
  // Only rows with a real target carry the button: not the checked-out branch,
  // not the remote ref resolving to it, never tags, never a directory row.
  result.switchBtnRows = [...document.querySelectorAll('.gp-col--left .gp-branch-row')]
    .filter((r) => r.querySelector('.gp-branch-row__switch') !== null)
    .map((r) => r.getAttribute('title'))
  // Hidden until hover (no pointer in the headless run), revealed by a hover rule.
  result.switchBtnHidden = switchBtnOf('feature') !== null && getComputedStyle(switchBtnOf('feature')).display === 'none'
  result.switchBtnHoverRule = [...document.styleSheets].some((sheet) => {
    try { return [...sheet.cssRules].some((rule) => rule.selectorText === '.gp-branch-row:hover .gp-branch-row__switch') } catch { return false }
  })
  result.switchBtnTitleTrack = switchBtnOf('origin/release')?.getAttribute('title') === 'switch.rowTitleTrack'
  result.switchBtnTitleLocal = switchBtnOf('feature')?.getAttribute('title') === 'switch.rowTitle'
  const branchQueriesBefore = fixture.branchQueries
  // Remote row → confirm dialog states the tracking branch it will create. The
  // button click must not also toggle the row's history filter.
  switchBtnOf('origin/release')?.click()
  await wait(80)
  result.switchBtnNoFilter = leftRow('origin/release')?.classList.contains('gp-branch-row--active') === false
  const confirmText = () => (document.querySelector('.gp-modal')?.textContent || '')
  result.switchConfirmOpened = confirmText().includes('switch.confirmTitle')
  result.switchConfirmBody = confirmText().includes('switch.body')
  result.switchTrackingNote = confirmText().includes('switch.trackingNote')
  result.switchDirtyWarn = confirmText().includes('switch.dirtyWarn')
  result.switchStashChoice = confirmText().includes('switch.modeStash')
  result.switchDefaultNoStash = confirmText().includes('switch.confirm') && !confirmText().includes('switch.confirmStash')
  // Choosing "stash first" is an explicit opt-in and relabels the confirm button.
  const stashRadio = [...document.querySelectorAll('.gp-bpick__mode')].find((l) => (l.textContent || '').includes('switch.modeStash'))
  stashRadio?.querySelector('input')?.click()
  await wait(60)
  result.switchStashRelabel = confirmText().includes('switch.confirmStash')
  // The switch refreshes the panel from the snapshot the action returned, and
  // then checks the new branch's remote state on its own: a switch moves to a
  // different upstream, and the ahead/behind counts are only as fresh as the
  // last fetch. The parked fetch keeps the two apart — the status bar must
  // already show the returned snapshot's sync state while the automatic check
  // is still in flight.
  fixture.holdFetch = true
  fixture.snapshot = { ...snap, ahead: 0, behind: 5, hasUpstream: true }
  const switchActionsBefore = fixture.actions.length
  const confirmBtn = [...document.querySelectorAll('.gp-modal__footer .gp-btn')].find((b) => (b.textContent || '').includes('switch.confirmStash'))
  confirmBtn?.click()
  await wait(200)
  const switchActions = fixture.actions.slice(switchActionsBefore)
  result.switchAction = switchActions.find((a) => a.kind === 'branch-checkout')
  result.switchAutoCheckSync = switchActions.some((a) => a.kind === 'fetch')
  result.switchModalClosed = document.querySelector('.gp-modal__path') === null
  result.switchReloadedBranches = fixture.branchQueries > branchQueriesBefore
  result.switchSyncStateFresh = (document.querySelector('.gp-col--left .gp-statusbar__state')?.textContent || '').includes('status.behind')
  const releaseSwitchFetch = fixture.releaseFetch
  fixture.releaseFetch = null
  fixture.holdFetch = false
  releaseSwitchFetch?.()
  await wait(150)
  fixture.snapshot = snap
  await clickCheck()
  // Closing the confirm without confirming runs nothing.
  const runsBeforeCancel = fixture.actions.length
  switchBtnOf('feature')?.click()
  await wait(80)
  document.querySelector('.gp-modal__close')?.click()
  await wait(60)
  result.switchCancelRunsNothing = fixture.actions.length === runsBeforeCancel && document.querySelector('.gp-modal__path') === null
  // Refusal path: git rejects the switch, the error lands inside the still-open
  // dialog (with the stash option already on screen as the way out).
  switchBtnOf('feature')?.click()
  await wait(80)
  fixture.runFailure = { kind: 'branch-checkout', code: 'local-changes-block', message: 'local changes' }
  ;[...document.querySelectorAll('.gp-modal__footer .gp-btn')].find((b) => (b.textContent || '').includes('switch.confirm'))?.click()
  await wait(150)
  result.switchRefusalShown = (document.querySelector('.gp-modal .gp-feedback')?.textContent || '').includes('error.localChangesBlock')
  result.switchRefusalStaysOpen = document.querySelector('.gp-modal__path')?.textContent === 'switch.confirmTitle'
  document.querySelector('.gp-modal__close')?.click()
  await wait(60)


  // Select the first commit → its changed-file tree appears on the right.
  const firstCommit = document.querySelector('.gp-commit-row')
  if (firstCommit) { firstCommit.click(); await new Promise((r) => setTimeout(r, 400)) }
  // The changed-file list has a `src/` dir (with app.ts) + a root index.ts file.
  const fileRow = document.querySelector('.gp-detail__files .gp-tree-row .gp-status-badge')?.closest('.gp-tree-row') ?? null
  result.hasDetailFileRow = fileRow !== null
  // Change summary above the file tree: file count + colored +/- line counts.
  const summary = document.querySelector('.gp-detail__summary')
  result.hasChangeSummary = summary !== null
  result.summaryHasFileCount = summary !== null && (summary.textContent || '').includes('overview.changeSummary')
  result.summaryAdd = summary ? (summary.querySelector('.gp-stats__add')?.textContent || '') : ''
  result.summaryDel = summary ? (summary.querySelector('.gp-stats__del')?.textContent || '') : ''
  // The summary pins while the file list scrolls — wide as well as stacked:
  // the sticky declaration is layout-independent (stacked's flush gap=0
  // contract is pinned separately by stacked-detail-sticky).
  result.summaryStickyWide = summary !== null && getComputedStyle(summary).position === 'sticky'
  // Collapsible changed-file tree: the folder row toggles its children (bug fix
  // — the chevron used to be inert). Default fully expanded; click to collapse.
  const childVisible = () => [...document.querySelectorAll('.gp-detail__files .gp-tree-row')].some((r) => (r.textContent || '').includes('app.ts'))
  const detailDirRow = document.querySelector('.gp-detail__files .gp-tree-row--dir')
  result.treeDirRowShown = detailDirRow !== null
  result.treeChildVisibleDefault = childVisible()
  result.treeDirExpandedDefault = detailDirRow?.getAttribute('aria-expanded') === 'true'
  if (detailDirRow) { detailDirRow.click(); await new Promise((r) => setTimeout(r, 120)) }
  const detailDirRowAfter = document.querySelector('.gp-detail__files .gp-tree-row--dir')
  result.treeChildHiddenAfterCollapse = !childVisible()
  result.treeDirCollapsedAttr = detailDirRowAfter?.getAttribute('aria-expanded') === 'false'
  if (detailDirRowAfter) { detailDirRowAfter.click(); await new Promise((r) => setTimeout(r, 120)) }
  result.treeChildVisibleAfterReexpand = childVisible()
  // Keyboard a11y: the folder row is focusable (tabIndex 0) and Enter toggles it.
  const kbDirRow = document.querySelector('.gp-detail__files .gp-tree-row--dir')
  result.treeDirFocusable = kbDirRow?.getAttribute('tabindex') === '0'
  if (kbDirRow) { kbDirRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise((r) => setTimeout(r, 120)) }
  result.treeChildHiddenAfterKeyToggle = !childVisible()
  const kbDirRowAfter = document.querySelector('.gp-detail__files .gp-tree-row--dir')
  if (kbDirRowAfter) { kbDirRowAfter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await new Promise((r) => setTimeout(r, 120)) }
  result.treeChildVisibleAfterKeyReexpand = childVisible()
  // Commit detail action area: a create-tag button opens the tag dialog, which
  // carries the shared "trust the AI" hint. Close it before the file-diff test.
  const createTagBtn = [...document.querySelectorAll('.gp-detail__ops .gp-btn')].find((b) => (b.textContent || '').includes('overview.createTag'))
  result.hasCreateTagBtn = createTagBtn != null
  if (createTagBtn) { createTagBtn.click(); await new Promise((r) => setTimeout(r, 200)) }
  result.tagModalOpened = document.querySelector('.gp-modal--sm') !== null
  result.tagModalHint = (document.querySelector('.gp-modal--sm .gp-modal__hint')?.textContent || '') === 'ops.aiHint'
  const tagClose = document.querySelector('.gp-modal--sm .gp-modal__close')
  if (tagClose) { tagClose.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.tagModalClosed = document.querySelector('.gp-modal--sm') === null
  // Commit-undo actions: revert opens a confirm (with the AI hint); reset opens
  // the mode dialog carrying soft/mixed/hard radios + the hard-reset gate.
  const revertBtn = [...document.querySelectorAll('.gp-detail__ops .gp-btn')].find((b) => (b.textContent || '').includes('overview.revert'))
  result.hasRevertBtn = revertBtn != null
  if (revertBtn) { revertBtn.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.revertModalHint = (document.querySelector('.gp-modal--sm .gp-modal__hint')?.textContent || '') === 'ops.aiHint'
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  const resetBtn = [...document.querySelectorAll('.gp-detail__ops .gp-btn')].find((b) => (b.textContent || '').includes('overview.reset'))
  result.hasResetBtn = resetBtn != null
  if (resetBtn) { resetBtn.click(); await new Promise((r) => setTimeout(r, 150)) }
  result.resetModeCount = document.querySelectorAll('.gp-reset__mode').length
  // Pick hard → the acknowledgement appears and the confirm stays disabled until acked.
  const hardRadio = [...document.querySelectorAll('.gp-reset__mode')].find((m) => (m.textContent || '').includes('reset.modeHard'))?.querySelector('input')
  if (hardRadio) { hardRadio.click(); await new Promise((r) => setTimeout(r, 80)) }
  result.resetHardAck = document.querySelector('.gp-reset__ack') != null
  const resetConfirm = [...document.querySelectorAll('.gp-modal--sm .gp-modal__footer .gp-btn')].find((b) => (b.textContent || '').includes('reset.confirm'))
  result.resetConfirmDisabledBeforeAck = resetConfirm ? resetConfirm.disabled === true : false
  const ackCb = document.querySelector('.gp-reset__ack .gp-check')
  if (ackCb) { ackCb.click(); await new Promise((r) => setTimeout(r, 80)) }
  result.resetConfirmEnabledAfterAck = resetConfirm ? resetConfirm.disabled === false : false
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.resetModalClosed = document.querySelector('.gp-reset__modes') === null
  // Click a changed file → the diff modal opens (portaled to document.body).
  // Re-query: the collapse/expand round above re-rendered the tree, detaching
  // the row captured earlier.
  const freshFileRow = document.querySelector('.gp-detail__files .gp-tree-row .gp-status-badge')?.closest('.gp-tree-row') ?? null
  if (freshFileRow) { freshFileRow.click(); await new Promise((r) => setTimeout(r, 400)) }
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
  const reopenRow = document.querySelector('.gp-detail__files .gp-tree-row .gp-status-badge')?.closest('.gp-tree-row') ?? null
  if (reopenRow) { reopenRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  const closeBtn = document.querySelector('.gp-modal__bar .gp-icon-btn')
  if (closeBtn) { closeBtn.click(); await new Promise((r) => setTimeout(r, 200)) }
  result.modalClosedByBtn = document.querySelector('.gp-modal') === null
  document.querySelector('#pill .gp-pill')?.click()
  await new Promise((r) => setTimeout(r, 100))
  result.livePillJump = document.querySelector('.gp-panel [role="tab"][aria-selected="true"]')?.textContent?.includes('tab.changes') ?? false

  // Files tab: open it, the root tree lists entries; expand a dir; select a
  // text file → code preview; select an image → inline image pane.
  const filesTab = [...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => (t.textContent || '').includes('tab.files'))
  if (filesTab) { filesTab.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.filesTreeRows = document.querySelectorAll('.gp-files__tree .gp-tree-row').length
  const cacheRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('cache'))
  const ignoredRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('ignored.log'))
  result.ignoredRowsDimmed = cacheRow?.classList.contains('gp-tree-row--ignored') && ignoredRow?.classList.contains('gp-tree-row--ignored') && getComputedStyle(cacheRow).opacity < 1
  result.folderIcon = cacheRow?.querySelector('svg[data-folder]')?.getAttribute('data-folder')
  const dirRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('src'))
  if (dirRow) { dirRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.folderIconOpen = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')]
    .find((r) => (r.textContent || '').includes('src'))?.querySelector('svg[data-folder]')?.getAttribute('data-folder')
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
  // Files refresh: the tree's floating button re-lists the expanded directories
  // and re-reads the selected file. Stage a change made outside the panel (a
  // new root entry + modified index.ts) and assert one click lands both.
  const refreshBtn = document.querySelector('.gp-files__tree-wrap [aria-label="files.refresh"]')
  result.filesRefreshShown = refreshBtn !== null
  const rootListsBeforeRefresh = fixture.fileQueries.filter((p) => p === '').length
  const srcListsBeforeRefresh = fixture.fileQueries.filter((p) => p === 'src').length
  const fileReadsBeforeRefresh = fixture.contentQueries.filter((p) => p === 'src/index.ts').length
  fixture.rootExtraEntries = [{ name: 'fresh.txt', dir: false, size: 9 }]
  fixture.textOverrides = { 'src/index.ts': 'const x = 42\n' }
  refreshBtn?.click()
  await new Promise((r) => setTimeout(r, 500))
  result.refreshRelistedRoot = fixture.fileQueries.filter((p) => p === '').length > rootListsBeforeRefresh
  result.refreshRelistedOpenDir = fixture.fileQueries.filter((p) => p === 'src').length > srcListsBeforeRefresh
  result.refreshRereadSelectedFile = fixture.contentQueries.filter((p) => p === 'src/index.ts').length > fileReadsBeforeRefresh
  result.refreshNewEntryShown = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].some((r) => (r.textContent || '').includes('fresh.txt'))
  result.refreshContentUpdated = (document.querySelector('.gp-files__code')?.textContent || '').includes('const x = 42')
  // The in-flight lock must clear: a stuck `refreshing` would disable every
  // later refresh.
  result.refreshReenabled = refreshBtn !== null && !refreshBtn.disabled
  // Leave the mock as the rest of the runner expects it.
  fixture.rootExtraEntries = []
  fixture.textOverrides = {}
  let copiedPath = null
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { copiedPath = text } } })
  document.querySelector('.gp-files__copy-path')?.click()
  await new Promise((r) => setTimeout(r, 100))
  result.copiedPath = copiedPath
  result.copyFeedback = document.querySelector('.gp-files__copy-path')?.textContent
  const pngRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('logo.png'))
  if (pngRow) { pngRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  result.filesImageShown = document.querySelector('.gp-files__image img') !== null
  // Image zoom: toolbar presence, pinch (ctrl+wheel) zooms, plain wheel is a
  // native-pan passthrough, double click returns to fit, fullscreen lightbox
  // opens from the bar and closes on Escape. Queries are scoped to the Files
  // zoom root — the diff view renders its own zoom bars.
  const zoomRoot = document.querySelector('.gp-files__image')?.parentElement ?? null
  const zoomImg = zoomRoot?.querySelector('img') ?? null
  const zoomRect = () => Math.round(zoomImg?.getBoundingClientRect().width ?? -1)
  result.zoomBarShown = zoomRoot?.querySelector('.gp-zoom__bar') !== null
  result.zoomPctBefore = zoomRoot?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  const zoomW0 = zoomRect()
  zoomImg?.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 120))
  // Rendered width, not the inline style: a flex-shrink regression once kept the
  // inline width while the picture itself never grew.
  result.zoomWheelZoomed = zoomRect() > zoomW0
  result.zoomPctAfter = zoomRoot?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  const zoomW1 = zoomRect()
  zoomImg?.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true }))
  await new Promise((r) => setTimeout(r, 80))
  result.zoomPlainWheelNoop = zoomRect() === zoomW1
  zoomImg?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 80))
  result.zoomDblClickFit = zoomRect() === (zoomImg?.naturalWidth ?? -2)
  result.zoomFitPressed = zoomRoot?.querySelector('.gp-zoom__btn[aria-pressed]')?.getAttribute('aria-pressed') === 'true'
  // Fullscreen is a zoom-bar control now: an inline click must not open it, or
  // the first click of every double click would.
  zoomImg?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 320))
  result.zoomImgClickNoFullscreen = document.querySelector('.gp-zl-backdrop') === null
  zoomRoot?.querySelector('button[aria-label="files.zoomFullscreen"]')?.click()
  await new Promise((r) => setTimeout(r, 120))
  result.zoomLightboxShown = document.querySelector('.gp-zl-backdrop') !== null
    && document.querySelector('.gp-zl-backdrop')?.getAttribute('aria-modal') === 'true'
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 120))
  result.zoomLightboxClosed = document.querySelector('.gp-zl-backdrop') === null
  // A press on the lightbox's own empty area closes it (the frame covers the
  // mask, so the mask alone would leave most of the visible background inert);
  // a press on the image keeps it open.
  zoomRoot?.querySelector('button[aria-label="files.zoomFullscreen"]')?.click()
  await new Promise((r) => setTimeout(r, 120))
  document.querySelector('.gp-zl-viewport img')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.zoomLightboxImagePressKeeps = document.querySelector('.gp-zl-backdrop') !== null
  document.querySelector('.gp-zl-viewport')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  await new Promise((r) => setTimeout(r, 120))
  result.zoomLightboxBackdropCloses = document.querySelector('.gp-zl-backdrop') === null
  // Fit-label honesty: zoom in, resize the panel while zoomed (the ResizeObserver
  // must not record the numeric scale as a fit value), then switch back to Fit —
  // the percentage shown has to match the size actually rendered.
  zoomRoot?.querySelector('button[aria-label="files.zoomIn"]')?.click()
  await new Promise((r) => setTimeout(r, 80))
  result.zoomInZoomed = zoomRect() > (zoomImg?.naturalWidth ?? Number.MAX_SAFE_INTEGER)
  const zoomPrevWidth = panelHost.style.width
  panelHost.style.width = '700px'
  await new Promise((r) => setTimeout(r, 200))
  zoomRoot?.querySelector('.gp-zoom__btn[aria-pressed]')?.click() // Fit
  await new Promise((r) => setTimeout(r, 150))
  const zoomFitLabel = zoomRoot?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  const zoomFitReal = zoomImg === null ? '' : `${Math.round((zoomRect() / zoomImg.naturalWidth) * 100)}%`
  result.zoomFitLabelHonest = zoomFitLabel !== '' && zoomFitLabel === zoomFitReal
  // Switching images shows the new picture at fit, never the previous file's
  // zoom level. Today the loading placeholder unmounts the component between
  // files; this pins the user-visible contract for any future in-place src swap
  // (e.g. an ImageCompare pane fed a new URL without a loading gap).
  zoomRoot?.querySelector('button[aria-label="files.zoomIn"]')?.click()
  await new Promise((r) => setTimeout(r, 80))
  const iconRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('icon.png'))
  if (iconRow) { iconRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  const zoomImgAfterSwitch = document.querySelector('.gp-files__image img')
  result.zoomResetsOnNewImage = zoomImgAfterSwitch !== null
    && zoomImgAfterSwitch.style.width === ''
    && Math.round(zoomImgAfterSwitch.getBoundingClientRect().width) === zoomImgAfterSwitch.naturalWidth
    && document.querySelector('.gp-files__image')?.parentElement?.querySelector('.gp-zoom__btn[aria-pressed]')?.getAttribute('aria-pressed') === 'true'
  panelHost.style.width = zoomPrevWidth
  await new Promise((r) => setTimeout(r, 120))
  // Mouse drag-to-pan: a plain mouse has no horizontal wheel, so a zoomed image
  // must be draggable. big.png at 100% is wider than the pane, which makes the
  // viewport actually scrollable (a drag needs somewhere to go).
  panelHost.style.width = '800px'
  await new Promise((r) => setTimeout(r, 150))
  // Fit-label tracking (the ResizeObserver path) needs a *width-constrained*
  // image: a pane-width change moves wide.png's fit ratio, while the square
  // fixture is limited by the pane height and would keep the same percentage.
  const wideRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('wide.png'))
  if (wideRow) { wideRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  const wideRoot = document.querySelector('.gp-files__image')?.parentElement ?? null
  const wideImg = wideRoot?.querySelector('img') ?? null
  const wideLabel = () => wideRoot?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  const wideReal = () => (wideImg === null ? '' : `${Math.round((wideImg.getBoundingClientRect().width / wideImg.naturalWidth) * 100)}%`)
  const fitNarrow = { label: wideLabel(), real: wideReal() }
  panelHost.style.width = '1000px'
  await new Promise((r) => setTimeout(r, 250))
  const fitWide = { label: wideLabel(), real: wideReal() }
  result.zoomFitTracksViewport = fitNarrow.label !== '' && fitNarrow.label === fitNarrow.real
    && fitWide.label === fitWide.real && fitNarrow.label !== fitWide.label
  panelHost.style.width = '800px'
  await new Promise((r) => setTimeout(r, 200))
  const bigImgRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('big.png'))
  if (bigImgRow) { bigImgRow.click(); await new Promise((r) => setTimeout(r, 400)) }
  const panRoot = document.querySelector('.gp-files__image')?.parentElement ?? null
  const panVp = panRoot?.querySelector('.gp-zoom__scroll') ?? null
  const panImg = panRoot?.querySelector('img') ?? null
  result.zoomPanImgNotDraggable = panImg?.getAttribute('draggable') === 'false'
  result.zoomFitCursor = panImg === null ? '' : getComputedStyle(panImg).cursor
  panRoot?.querySelector('.gp-zoom__pct')?.click() // actual size: 800px wide
  await new Promise((r) => setTimeout(r, 150))
  result.zoomGrabCursor = panImg === null ? '' : getComputedStyle(panImg).cursor
  // Zooming past 100% must really grow the rendered picture: as a flex item the
  // image used to stay pinned at its natural width while the label kept climbing
  // (and the anchor correction then just scrolled it).
  const naturalW = panImg?.naturalWidth ?? Number.MAX_SAFE_INTEGER
  panRoot?.querySelector('button[aria-label="files.zoomIn"]')?.click()
  await new Promise((r) => setTimeout(r, 150))
  result.zoomAboveNaturalRendered = Math.round(panImg?.getBoundingClientRect().width ?? 0) > naturalW
  result.zoomAboveNaturalScrolls = panVp !== null && panVp.scrollWidth > Math.max(panVp.clientWidth, naturalW)
  panRoot?.querySelector('.gp-zoom__pct')?.click() // back to 100% for the pan test
  await new Promise((r) => setTimeout(r, 150))
  if (panVp !== null) {
    result.zoomPanScrollable = panVp.scrollWidth > panVp.clientWidth && panVp.scrollHeight > panVp.clientHeight
    // Start mid-range so the drag has room in both directions.
    panVp.scrollLeft = Math.round((panVp.scrollWidth - panVp.clientWidth) / 2)
    panVp.scrollTop = Math.round((panVp.scrollHeight - panVp.clientHeight) / 2)
  }
  const panRect = panVp?.getBoundingClientRect() ?? null
  const panBefore = { left: panVp?.scrollLeft ?? 0, top: panVp?.scrollTop ?? 0 }
  const panPctBefore = panRoot?.querySelector('.gp-zoom__pct')?.textContent ?? ''
  if (panVp !== null && panRect !== null) {
    // Synthetic pointer input mirrors a left-button mouse drag: a press, moves
    // past the 3px threshold, then release. Real trusted input is exercised
    // after this evaluate block, so both the handler logic and the browser's
    // own input path are covered.
    const press = (type, x, y, buttons, pointerType = 'mouse') => panVp.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, pointerType, button: 0, buttons, clientX: x, clientY: y,
    }))
    const cx = panRect.left + panRect.width / 2
    const cy = panRect.top + panRect.height / 2
    press('pointerdown', cx, cy, 1)
    for (const step of [10, 30, 50]) press('pointermove', cx - step, cy - Math.round(step / 2), 1)
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, buttons: 0, clientX: cx - 50, clientY: cy - 25,
    }))
  }
  await new Promise((r) => setTimeout(r, 200))
  const panAfter = { left: panVp?.scrollLeft ?? 0, top: panVp?.scrollTop ?? 0 }
  // Dragging left/up scrolls right/down: the content follows the pointer.
  result.zoomDragPanned = panAfter.left > panBefore.left && panAfter.top > panBefore.top
  // A drag is not a double click: the zoom level must survive it untouched.
  result.zoomDragKeepsMode = (panRoot?.querySelector('.gp-zoom__pct')?.textContent ?? 'x') === panPctBefore
  // Touch and pen keep their native behaviour: their presses never start a pan.
  if (panVp !== null && panRect !== null) {
    const touchBefore = { left: panVp.scrollLeft, top: panVp.scrollTop }
    const cx = panRect.left + panRect.width / 2
    const cy = panRect.top + panRect.height / 2
    const touch = (type, x, y, buttons) => panVp.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, isPrimary: true, pointerType: 'touch', button: 0, buttons, clientX: x, clientY: y,
    }))
    touch('pointerdown', cx, cy, 1)
    for (const step of [10, 40, 70]) touch('pointermove', cx - step, cy - step, 1)
    window.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerId: 7, isPrimary: true, pointerType: 'touch', button: 0, buttons: 0, clientX: cx - 70, clientY: cy - 70,
    }))
    await new Promise((r) => setTimeout(r, 80))
    result.zoomTouchNotTakenOver = panVp.scrollLeft === touchBefore.left && panVp.scrollTop === touchBefore.top
  }
  // Safari's older pinch path: gesture events carry a cumulative scale.
  if (panVp !== null && panRect !== null) {
    const gestureWidth = () => Math.round(panImg?.getBoundingClientRect().width ?? 0)
    const beforeGesture = gestureWidth()
    const gesture = (type, scale) => {
      const ev = new Event(type, { bubbles: true, cancelable: true })
      ev.scale = scale
      ev.clientX = panRect.left + panRect.width / 2
      ev.clientY = panRect.top + panRect.height / 2
      panVp.dispatchEvent(ev)
    }
    gesture('gesturestart', 1)
    gesture('gesturechange', 1.5)
    gesture('gestureend', 1.5)
    await new Promise((r) => setTimeout(r, 150))
    result.zoomGestureScales = gestureWidth() > beforeGesture
    panRoot?.querySelector('.gp-zoom__btn[aria-pressed]')?.click() // back to fit
    await new Promise((r) => setTimeout(r, 120))
  }
  panelHost.style.width = zoomPrevWidth
  await new Promise((r) => setTimeout(r, 120))
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
  // The two copy actions form one joined button group: adjacent borders
  // collapse onto a single 1px line and only the outer corners stay rounded.
  const copyGroup = document.querySelector('.gp-files__copy-group')
  const copyBtns = [...(copyGroup?.querySelectorAll('.gp-files__copy-path') ?? [])]
  const copyRects = copyBtns.map((b) => b.getBoundingClientRect())
  const copyRadii = copyBtns.map((b) => {
    const cs = getComputedStyle(b)
    return [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].join(' ')
  })
  result.copyGroupJoined = copyGroup !== null && copyBtns.length === 2
    // The -1px margin must actually overlap: allowing a 1px tolerance would
    // also accept two plain adjacent buttons (left === right, difference 1).
    && Math.abs(copyRects[1].left - (copyRects[0].right - 1)) <= 0.25
  result.copyGroupRadii = copyRadii.join('|') === '6px 0px 0px 6px|0px 6px 6px 0px'
  // Markdown defaults to the rendered view; switch to source, then back.
  result.markdownRenderedDefault = document.querySelector('[data-markdown-rendered]')?.textContent === 'Hello Markdown' && document.querySelector('.gp-files__code') === null
  // The wide toolbar uses the same official SegmentedControl as compact.
  const modeTab = (label) => [...document.querySelectorAll('.gp-files__bar [role="tab"]')].find((b) => b.textContent === label)
  const wideModeTabs = [...document.querySelectorAll('.gp-files__bar [role="tab"]')]
  result.wideModeSegShown = document.querySelector('.gp-files__bar [role="tablist"]') !== null && wideModeTabs.length === 2
  result.wideModePanelsResolve = wideModeTabs.every((tab) => {
    const panel = document.getElementById(tab.getAttribute('aria-controls') || '')
    return panel !== null && panel.getAttribute('role') === 'tabpanel' && panel.getAttribute('aria-labelledby') === tab.id
  })
  const wideFullBtn = document.querySelector('.gp-files__bar [aria-label="files.fullscreen"]')
  result.wideHasFullscreen = wideFullBtn !== null
  // Captured before opening: a second render would replace this node, so an
  // equal reference afterwards proves the reader reused the live preview.
  const mdBefore = document.querySelector('[data-markdown-rendered]')
  wideFullBtn?.click()
  await new Promise((r) => setTimeout(r, 200))
  // The reader is the tab's own preview restyled, not a second render: the
  // Markdown shown inside the card is the same node that was already there.
  result.wideFullscreenShown = document.querySelector('.gp-files__preview--full') !== null
    && document.querySelector('.gp-files__preview--full [data-markdown-rendered]')?.textContent === 'Hello Markdown'
    && document.querySelector('.gp-files__preview--full [data-markdown-rendered]') === mdBefore
    && document.querySelector('.gp-files__preview--full')?.getAttribute('role') === 'dialog'
    && document.querySelector('.gp-files__preview--full .gp-modal__path')?.textContent === 'README.md'
  // Its bar carries the browser-fullscreen toggle immediately left of close.
  const fsBarBtns = [...document.querySelectorAll('.gp-files__preview--full .gp-modal__bar button')]
  const fsBarLabels = fsBarBtns.map((b) => b.getAttribute('aria-label'))
  result.wideFullscreenBar = fsBarLabels.length === 2
    && fsBarLabels[0] === 'files.screenFull' && fsBarLabels[1] === 'common.close'
    // The toggle keeps a stable name and reports its state instead.
    && fsBarBtns[0]?.getAttribute('aria-pressed') === 'false'
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await new Promise((r) => setTimeout(r, 200))
  result.wideFullscreenClosed = document.querySelector('.gp-files__preview--full') === null
    && document.querySelector('[data-markdown-rendered]') === mdBefore
  const sourceBtn = modeTab('files.source')
  if (sourceBtn) { sourceBtn.click(); await new Promise((r) => setTimeout(r, 100)) }
  result.markdownSourceShown = document.querySelector('.gp-files__code') !== null && document.querySelector('[data-markdown-rendered]') === null
  // Wide bar: source mode for a rich file exposes the wrap toggle too (rendered
  // Markdown hides it — the mode above already restored render, so re-check here).
  result.wideSourceHasWrap = document.querySelector('.gp-files__bar [aria-label="files.wrap"]') !== null
  const renderBtn = modeTab('files.render')
  if (renderBtn) { renderBtn.click(); await new Promise((r) => setTimeout(r, 100)) }
  result.markdownRenderRestored = document.querySelector('[data-markdown-rendered]')?.textContent === 'Hello Markdown'
  // Mermaid: a document with a mermaid fence renders the diagram through the
  // lazy chunk, keeps the surrounding markdown in order, and a diagram the
  // engine rejects falls back to the plain code block.
  const diagramRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('diagram.md'))
  if (diagramRow) { diagramRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.mermaidRendered = document.querySelector('.gp-mermaid svg[data-mermaid-stub]') !== null
    && [...document.querySelectorAll('[data-markdown-rendered]')].some((n) => (n.textContent || '').includes('Intro para'))
    && [...document.querySelectorAll('[data-markdown-rendered]')].some((n) => (n.textContent || '').includes('Outro para'))
  const brokenRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('broken.md'))
  if (brokenRow) { brokenRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.mermaidFallback = document.querySelector('[data-mermaid-fallback]') !== null
    && document.querySelector('.gp-mermaid svg') === null
  // HTML defaults to source (no auto-run); switching to render mounts a
  // sandboxed iframe that carries the page bytes but drops same-origin.
  const htmlRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('page.html'))
  if (htmlRow) { htmlRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.htmlSourceDefault = document.querySelector('.gp-files__code') !== null && document.querySelector('.gp-files__html') === null
  // The panel cannot read into the opaque frame, so the page reports itself:
  // a message per document load proves the scripts really ran (and that a
  // remount really reloaded).
  let pageLoads = 0
  window.addEventListener('message', (event) => { if (event.data === 'html-page-load') pageLoads += 1 })
  const htmlRenderBtn = modeTab('files.render')
  if (htmlRenderBtn) { htmlRenderBtn.click(); await new Promise((r) => setTimeout(r, 100)) }
  for (let i = 0; i < 80 && pageLoads === 0; i++) await new Promise((r) => setTimeout(r, 25))
  result.htmlRunsPageScript = pageLoads === 1
  const htmlFrame = document.querySelector('.gp-files__html')
  result.htmlRenderShown = htmlFrame !== null && document.querySelector('.gp-files__code') === null
  result.htmlFrameSandbox = htmlFrame?.getAttribute('sandbox') ?? null
  // The interactive body travels through a blob: URL, so the frame gets its
  // own renderer process instead of sharing the panel's main thread.
  const htmlFrameSrc = htmlFrame?.getAttribute('src') || ''
  result.htmlFrameUsesBlob = htmlFrameSrc.startsWith('blob:')
  result.htmlFrameHasPageBytes = htmlFrameSrc === ''
    ? (htmlFrame?.getAttribute('srcdoc') || '').includes('Hello HTML')
    : (await (await fetch(htmlFrameSrc)).text()).includes('Hello HTML')
  // Scripts stay on by default; the JS toggle forces the static preview
  // (no script permission + a CSP that blocks the network).
  result.htmlInteractiveDefault = htmlFrame?.getAttribute('sandbox') === 'allow-scripts'
  const scriptToggle = document.querySelector('.gp-files__scripts')
  if (scriptToggle) { scriptToggle.click(); await new Promise((r) => setTimeout(r, 150)) }
  const staticFrame = document.querySelector('.gp-files__html')
  const staticSrcdoc = staticFrame?.getAttribute('srcdoc') || ''
  result.htmlStaticToggle = staticFrame?.getAttribute('sandbox') === ''
    && staticSrcdoc.includes('Content-Security-Policy')
    && scriptToggle?.getAttribute('aria-pressed') === 'false'
  // A static preview of a script-rendered page is blank; the note says why and
  // runs the page when the reader asks for it.
  const staticNote = document.querySelector('.gp-files__html-note')
  result.htmlStaticHint = staticNote !== null && (staticNote.textContent || '').includes('files.scriptsSkipped')
  // A srcdoc document commits in the same task, so the static preview has no
  // mask to show.
  result.htmlStaticNoMask = document.querySelector('.gp-files__html-mask') === null
  result.htmlStaticBlocksScript = pageLoads === 1
  staticNote?.querySelector('.gp-files__html-note-run')?.click()
  await new Promise((r) => setTimeout(r, 150))
  result.htmlScriptsRestored = document.querySelector('.gp-files__html')?.getAttribute('sandbox') === 'allow-scripts'
    && scriptToggle?.getAttribute('aria-pressed') === 'true'
  // A blob frame paints asynchronously: a mask covers it until the document
  // loads, then goes click-through and reports itself as done to AT. Poll for
  // the load event instead of assuming a fixed frame budget.
  for (let i = 0; i < 80 && document.querySelector('.gp-files__html-mask')?.getAttribute('data-state') !== 'ready'; i++) {
    await new Promise((r) => setTimeout(r, 25))
  }
  // Let the 180 ms fade finish before reading the computed opacity.
  await new Promise((r) => setTimeout(r, 250))
  const htmlMask = document.querySelector('.gp-files__html-mask')
  result.htmlLoadingMask = htmlMask !== null
    && htmlMask.getAttribute('data-state') === 'ready'
    && htmlMask.getAttribute('aria-hidden') === 'true'
    // Done means click-through and invisible, not just a different label.
    && getComputedStyle(htmlMask).pointerEvents === 'none'
    && getComputedStyle(htmlMask).opacity === '0'
  // Entering the reader must not reload the page: the frame node is the same,
  // its document is still loaded (the mask never restarts) and the page never
  // reported a second load.
  const pageLoadsBeforeReader = pageLoads
  const htmlFrameBeforeReader = document.querySelector('.gp-files__html')
  document.querySelector('.gp-files__bar [aria-label="files.fullscreen"]')?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.htmlReaderReusesFrame = htmlFrameBeforeReader !== null
    && document.querySelector('.gp-files__preview--full .gp-files__html') === htmlFrameBeforeReader
    && document.querySelector('.gp-files__preview--full .gp-files__html-mask')?.getAttribute('data-state') === 'ready'
  // The browser-fullscreen toggle follows the browser, not a local flag: a
  // refused request leaves the reader and the button alone, a granted one
  // flips it, and pressing it again leaves full screen.
  const screenBtn = document.querySelector('.gp-files__preview--full [aria-label="files.screenFull"]')
  const realRequest = Element.prototype.requestFullscreen
  Element.prototype.requestFullscreen = function () { return Promise.reject(new Error('denied')) }
  screenBtn?.click()
  await new Promise((r) => setTimeout(r, 120))
  result.screenFullRefused = document.querySelector('.gp-files__preview--full') !== null
    && screenBtn?.getAttribute('aria-pressed') === 'false'
  let exits = 0
  const realExit = document.exitFullscreen
  Element.prototype.requestFullscreen = function () {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => this })
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  }
  document.exitFullscreen = function () {
    exits += 1
    delete document.fullscreenElement
    document.dispatchEvent(new Event('fullscreenchange'))
    return Promise.resolve()
  }
  screenBtn?.click()
  await new Promise((r) => setTimeout(r, 120))
  result.screenFullGranted = screenBtn?.getAttribute('aria-pressed') === 'true'
  screenBtn?.click()
  await new Promise((r) => setTimeout(r, 120))
  result.screenFullExited = exits === 1 && screenBtn?.getAttribute('aria-pressed') === 'false'
  Element.prototype.requestFullscreen = realRequest
  document.exitFullscreen = realExit
  delete document.fullscreenElement
  // Leaving it keeps the same document too, and restores the toolbar.
  document.querySelector('.gp-files__preview--full .gp-modal__close')?.click()
  await new Promise((r) => setTimeout(r, 200))
  result.htmlReaderClosedKeepsFrame = document.querySelector('.gp-files__preview--full') === null
    && document.querySelector('.gp-files__html') === htmlFrameBeforeReader
    && document.querySelector('.gp-files__bar') !== null
  result.htmlReaderKeepsDocument = pageLoads === pageLoadsBeforeReader
  // A page whose own CSP blocks the appended paint report: the mask stays up
  // until the load fallback, ignores a forged report from the panel itself,
  // and only then goes click-through.
  const cspRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('csp.html'))
  if (cspRow) { cspRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  const cspRenderBtn = modeTab('files.render')
  if (cspRenderBtn) { cspRenderBtn.click(); await new Promise((r) => setTimeout(r, 200)) }
  const cspMask = document.querySelector('.gp-files__html-mask')
  result.htmlMaskLoadingState = cspMask?.getAttribute('data-state') === 'loading'
    && getComputedStyle(cspMask).pointerEvents !== 'none'
    && (cspMask?.textContent || '').includes('files.htmlRendering')
  // The report is refused unless it comes from the frame's own window.
  window.postMessage('dsh-html-ready', '*')
  await new Promise((r) => setTimeout(r, 200))
  result.htmlMaskIgnoresForeignMessage = document.querySelector('.gp-files__html-mask')?.getAttribute('data-state') === 'loading'
  for (let i = 0; i < 160 && document.querySelector('.gp-files__html-mask')?.getAttribute('data-state') !== 'ready'; i++) {
    await new Promise((r) => setTimeout(r, 25))
  }
  const cspMaskAfter = document.querySelector('.gp-files__html-mask')
  result.htmlMaskFallbackReady = cspMaskAfter?.getAttribute('data-state') === 'ready'
    && getComputedStyle(cspMaskAfter).pointerEvents === 'none'
  // A heavy document asks before it is rendered: the panel must not mount a
  // frame (and start the page's own scripts) without the user's consent.
  const heavyRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('heavy.html'))
  if (heavyRow) { heavyRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  const heavyRenderBtn = modeTab('files.render')
  if (heavyRenderBtn) { heavyRenderBtn.click(); await new Promise((r) => setTimeout(r, 300)) }
  // The question is a modal: a page that can freeze the app must not be
  // started by an easy-to-miss bar.
  const heavyModal = () => document.querySelector('[data-gp-heavy-modal]')?.closest('.gp-modal') ?? null
  result.htmlHeavyAsks = heavyModal() !== null
    && (heavyModal().textContent || '').includes('files.htmlHeavyWhy')
    && document.querySelector('.gp-files__html') === null
  // Cancelling keeps the source and closes the dialog without approving.
  const heavyButtons = () => [...(heavyModal()?.querySelectorAll('button') ?? [])]
  heavyButtons().find((b) => (b.textContent || '').includes('common.cancel'))?.click()
  await new Promise((r) => setTimeout(r, 250))
  result.htmlHeavyKeptSource = heavyModal() === null
    && document.querySelector('.gp-files__html') === null
  // Asking again shows the question again: cancelling is not an approval.
  const heavyRenderBtn2 = modeTab('files.render')
  if (heavyRenderBtn2) { heavyRenderBtn2.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.htmlHeavyAsksAgain = heavyModal() !== null
  // On a loopback GUI the dialog offers the local-open escape; the harness is
  // served from file:// so it lands on the remote copy (no open button).
  result.htmlHeavyOpensLocally = heavyButtons().some((b) => (b.textContent || '').includes('files.htmlOpenInBrowser')) === false
    && (heavyModal()?.textContent || '').includes('files.htmlHeavyRemote')
  // Approving mounts the frame and runs the page.
  heavyButtons().find((b) => (b.textContent || '').includes('files.htmlHeavyRun'))?.click()
  await new Promise((r) => setTimeout(r, 300))
  result.htmlHeavyRuns = document.querySelector('.gp-files__html') !== null
    && heavyModal() === null
  // A slow frame must not look like a dead panel: past the slow threshold the
  // mask stops taking clicks, counts the wait, and offers a way out.
  for (let i = 0; i < 200 && document.querySelector('.gp-files__html-mask')?.getAttribute('data-state') !== 'slow'; i++) {
    await new Promise((r) => setTimeout(r, 50))
  }
  const slowMask = document.querySelector('.gp-files__html-mask')
  result.htmlMaskSlowClickThrough = slowMask !== null
    && slowMask.getAttribute('data-state') === 'slow'
    && getComputedStyle(slowMask).pointerEvents === 'none'
  result.htmlMaskSlowHasStop = slowMask?.querySelector('.gp-files__html-mask-stop') !== null
  result.htmlMaskSlowCounts = slowMask?.querySelector('.gp-files__html-mask-elapsed') !== null
  // Stopping unmounts the frame and returns the source view.
  slowMask?.querySelector('.gp-files__html-mask-stop')?.click()
  await new Promise((r) => setTimeout(r, 300))
  result.htmlStopUnmounts = document.querySelector('.gp-files__html') === null
    && document.querySelector('.gp-files__code') !== null
  // HTML asset pack (ADR-0020): a page with a relative stylesheet is read
  // through the host file-content route and handed to the iframe as the
  // bootstrap document; a missing asset abandons the pack and the plain
  // bytes render instead.
  const contentQueriesBeforeHtml = fixture.contentQueries.length
  const styledRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('styled.html'))
  if (styledRow) { styledRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  const styledRenderBtn = modeTab('files.render')
  if (styledRenderBtn) { styledRenderBtn.click(); await new Promise((r) => setTimeout(r, 300)) }
  const styledFrame = document.querySelector('.gp-files__html')
  const styledSrc = styledFrame?.getAttribute('src') || ''
  const styledSrcdoc = styledSrc === '' ? (styledFrame?.getAttribute('srcdoc') || '') : await (await fetch(styledSrc)).text()
  result.htmlAssetPacked = styledSrcdoc.includes('data:text/css;base64,')
    && !styledSrcdoc.includes('createObjectURL')
  result.htmlAssetCssRead = fixture.contentQueries.slice(contentQueriesBeforeHtml).includes('styled.css')
  result.htmlAssetSandbox = styledFrame?.getAttribute('sandbox') ?? null
  // Decode the bootstrap payload to prove the stylesheet text travelled
  // inside the srcdoc (no network fetch of the css).
  result.htmlAssetBundleHasCss = (() => {
    const inline = styledSrcdoc.match(/data:text\/css;base64,([A-Za-z0-9+/=]+)/)
    if (inline === null) return false
    try { return atob(inline[1]).includes('rgb(1, 2, 3)') } catch { return false }
  })()
  const unpackedRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('unpacked.html'))
  if (unpackedRow) { unpackedRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  const unpackedRenderBtn = modeTab('files.render')
  if (unpackedRenderBtn) { unpackedRenderBtn.click(); await new Promise((r) => setTimeout(r, 300)) }
  const unpackedFrame = document.querySelector('.gp-files__html')
  const unpackedSrc = unpackedFrame?.getAttribute('src') || ''
  const unpackedSrcdoc = unpackedSrc === ''
    ? (unpackedFrame?.getAttribute('srcdoc') || '')
    : await (await fetch(unpackedSrc)).text()
  result.htmlAssetFallback = unpackedSrcdoc.includes('Unpacked HTML')
    && !unpackedSrcdoc.includes('data:text/css;base64,')
  // …because the read was attempted and failed, not skipped up front.
  result.htmlAssetMissingRead = fixture.contentQueries.slice(contentQueriesBeforeHtml).includes('missing.css')
  // Large-file source guards: highlighting is skipped (a notice shows, no
  // syntax spans) and the over-long line is truncated with a marker.
  const bigRow = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('big.js'))
  if (bigRow) { bigRow.click(); await new Promise((r) => setTimeout(r, 300)) }
  result.bigHighlightOff = document.querySelector('.gp-files__note')?.textContent === 'files.highlightOff'
  result.bigNoSyntaxSpans = document.querySelector('.gp-files__code .gp-diff-cell span[style]') === null
  result.bigLineTruncated = [...document.querySelectorAll('.gp-files__trunc')].some((n) => n.textContent === 'files.lineTruncated')
  // Over the wrap cap the toggle stays visible but disabled with a reason,
  // instead of vanishing and silently discarding the preference.
  const bigWrapBtn = document.querySelector('.gp-files__bar [aria-label="files.wrap"]')
  result.bigWrapDisabled = bigWrapBtn !== null && bigWrapBtn.disabled === true
    && bigWrapBtn.getAttribute('title') === 'files.wrapDisabled'
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

  // File properties dialog (`.gp-files__props`): opens from the preview toolbar
  // on a loaded file, derives everything from data already on screen, and
  // closes on Escape. The footer chips state the Git facts — in particular a
  // file inside an untracked directory must read untracked (regression: it used
  // to read tracked) and untracked must appear once. The harness `t` returns the
  // key (params are not interpolated), so assertions read keys and raw values.
  const pickFile = async (name, ms = 300) => {
    const row = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes(name))
    if (row) { row.click(); await new Promise((r) => setTimeout(r, ms)) }
  }
  const propsRow = (labelKey) => [...document.querySelectorAll('.gp-props__row')].find((r) => r.querySelector('.gp-props__label')?.textContent === labelKey) ?? null
  const propsValue = (labelKey) => propsRow(labelKey)?.querySelector('.gp-props__value') ?? null
  const propsBadges = () => [...document.querySelectorAll('.gp-props__badge')].map((b) => b.textContent)
  const openProps = async () => {
    document.querySelector('.gp-files__props[aria-label="files.propsTitle"]')?.click()
    await new Promise((r) => setTimeout(r, 120))
  }
  const closeProps = async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 120))
  }

  // a.txt is selected and loaded from the Find phase above.
  result.propsBtnShown = document.querySelector('.gp-files__props[aria-label="files.propsTitle"]') !== null
  await openProps()
  result.propsOpened = document.querySelector('.gp-props__statusbar') !== null
  result.propsTitle = document.querySelector('.gp-modal--sm .gp-modal__path')?.textContent
  result.propsGroups = [...document.querySelectorAll('.gp-props__group-title')].map((n) => n.textContent)
  result.propsName = propsValue('files.propsName')?.textContent
  result.propsTypeKey = propsValue('files.propsType')?.textContent
  result.propsRelPath = propsRow('files.propsRelPath')?.querySelector('.gp-props__copy')?.textContent
  result.propsAbsPath = propsRow('files.propsAbsPath')?.querySelector('.gp-props__copy')?.textContent
  result.propsSize = propsRow('files.propsSize')?.querySelector('.gp-props__strong')?.textContent
  result.propsSizeSub = propsRow('files.propsSize')?.querySelector('.gp-props__sub')?.textContent ?? null
  result.propsLines = propsValue('files.propsLines')?.textContent
  result.propsMtime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(propsValue('files.propsMtime')?.textContent ?? '')
  result.propsBadges = propsBadges()
  // Copying the absolute-path row must hand over the browse-root-prefixed path.
  let copiedAbs = null
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { copiedAbs = text } } })
  propsRow('files.propsAbsPath')?.querySelector('.gp-props__copy')?.click()
  await new Promise((r) => setTimeout(r, 60))
  result.propsCopiedAbs = copiedAbs
  result.propsCopyFeedback = document.querySelector('.gp-props__copied')?.textContent
  await closeProps()
  result.propsClosed = document.querySelector('.gp-props__statusbar') === null

  // An untracked file: exactly one 未跟踪 chip (the tracked-state chip doubles
  // as the untracked fact; the state badges must not repeat it).
  await pickFile('d.txt')
  await openProps()
  result.propsUntrackedBadges = propsBadges()
  await closeProps()

  // The untracked file inside newdir carries its own change entry now, so the
  // row parses as untracked from the exact path rather than an ancestor match.
  await pickFile('newdir')
  await pickFile('note.txt')
  await openProps()
  result.propsUntrackedDirBadges = propsBadges()
  await closeProps()

  // `vendored` is a directory-level entry (nested repository), so its file has
  // no change of its own and must read untracked through the ancestor rule.
  await pickFile('vendored')
  await pickFile('note.txt')
  await openProps()
  result.propsUntrackedNestedBadges = propsBadges()
  await closeProps()

  // An ignored file: the chip states the ignored fact and nothing else.
  await pickFile('ignored.log')
  await openProps()
  result.propsIgnoredBadges = propsBadges()
  await closeProps()

  // An image: the natural size is probed from the already-loaded data URL.
  await pickFile('logo.png')
  await openProps()
  await new Promise((r) => setTimeout(r, 150))
  result.propsImageDimsRow = propsRow('files.propsImageSize') !== null
  result.propsImageBadges = propsBadges()
  await closeProps()

  // A file at >= 1 KiB: the rounded size carries the raw byte count parenthetical.
  await pickFile('README.md')
  await openProps()
  result.propsSizeKiB = propsRow('files.propsSize')?.querySelector('.gp-props__strong')?.textContent
  result.propsSizeKiBSub = propsRow('files.propsSize')?.querySelector('.gp-props__sub')?.textContent
  await closeProps()

  // Copy-content button: only a loaded text document under the copy envelope
  // shows it; image, binary, and over-cap previews keep just copy-path.
  const copyBtnLabels = () => [...document.querySelectorAll('.gp-files__copy-path')].map((b) => b.textContent)
  await pickFile('a.txt')
  result.copyBtnText = copyBtnLabels()
  await pickFile('logo.png')
  result.copyBtnImage = copyBtnLabels()
  await pickFile('blob.bin')
  result.copyBtnBinary = copyBtnLabels()
  // The placeholder text each unrenderable kind shows. Without it a swapped
  // branch (binary ↔ too large) is invisible: both look like "one line of
  // .gp-empty" to every other assertion in the suite.
  result.placeholderBinary = document.querySelector('.gp-files__preview .gp-empty')?.textContent ?? null
  await pickFile('huge.txt')
  result.copyBtnTooLarge = copyBtnLabels()
  result.placeholderTooLarge = document.querySelector('.gp-files__preview .gp-empty')?.textContent ?? null
  // Leave README.md selected so the sticky-restore phase sees a rendered preview.
  await pickFile('README.md')

  // Sticky restore: on the Files tab with `src` expanded and a file selected,
  // a view-tab switch unmounts the panel; returning within the window must
  // restore the Files tab, the expanded dir, and the selection (not reset to
  // the root). Simulate the switch by unmounting and remounting the view root.
  result.preUnmountFilesActive = document.querySelector('.gp-panel [role="tab"][aria-selected="true"]')?.textContent?.includes('tab.files') ?? false
  result.preUnmountSelected = document.querySelector('.gp-files__tree .gp-tree-row--active')?.textContent?.trim() ?? null
  result.preUnmountChildVisible = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].some((r) => (r.textContent || '').includes('a.txt'))
  viewRoot.unmount()
  await new Promise((r) => setTimeout(r, 50))
  const viewRoot2 = ReactDOM.createRoot(document.getElementById('panel'))
  viewRoot2.render(window.React.createElement(CountedPanel, panelElement.props))
  await new Promise((r) => setTimeout(r, 500))
  result.restoredFilesActive = document.querySelector('.gp-panel [role="tab"][aria-selected="true"]')?.textContent?.includes('tab.files') ?? false
  result.restoredChildVisible = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].some((r) => (r.textContent || '').includes('a.txt'))
  result.restoredSelected = document.querySelector('.gp-files__tree .gp-tree-row--active')?.textContent?.trim() ?? null
  result.restoredPreviewShown = document.querySelector('.gp-files__code, .gp-files__markdown, .gp-files__image') !== null

  // Work-tree generation: a branch switch replaces every file under the root, so
  // the Files tab must drop its preserved state and re-list the root instead of
  // serving the previous branch's tree from its sticky cache.
  const filesTabBtn = [...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => (t.textContent || '').includes('tab.files'))
  const overviewTabBtn = [...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => (t.textContent || '').includes('tab.overview'))
  overviewTabBtn?.click()
  await wait(400)
  const rootListsBefore = fixture.fileQueries.filter((p) => p === '').length
  // The branch tree loads async; wait for the row's button before using it.
  for (let i = 0; i < 20 && switchBtnOf('feature') === null; i += 1) await wait(50)
  switchBtnOf('feature')?.click()
  await wait(80)
  ;[...document.querySelectorAll('.gp-modal__footer .gp-btn')].find((b) => (b.textContent || '').includes('switch.confirm'))?.click()
  await wait(250)
  result.switchRelistsFiles = fixture.fileQueries.filter((p) => p === '').length > rootListsBefore
  result.switchClearsFileSelection = document.querySelector('.gp-files__tree .gp-tree-row--active') === null
  // P1 helper shares the mock RPC state; React roots and all later scenarios
  // remain owned here. Its finally restores the fixture before returning.
  Object.assign(result, await window.runSteadyStateScenarios(fixture))

  // Secondary failures must leave real branch rows visible in the Overview UI.
  result.secondaryFailuresKeepBranches = []
  try {
    for (const kind of ['tags', 'authors']) {
      filesTabBtn?.click(); await wait(80)
      fixture.secondaryQueryFailure = kind
      overviewTabBtn?.click(); await wait(150)
      result.secondaryFailuresKeepBranches.push({
        kind,
        injected: fixture.secondaryFailures.includes(kind),
        visible: [...document.querySelectorAll('.gp-overview .gp-branch-row')].some((row) => (row.textContent || '').includes('feature') && row.getClientRects().length > 0),
        error: (document.querySelector('.gp-overview')?.textContent || '').includes('overview.branchesError'),
      })
    }
  } finally { fixture.secondaryQueryFailure = null }

  // Reopening the same row must reload without waiting for another snapshot.
  ;[...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => (t.textContent || '').includes('tab.changes'))?.click()
  await wait(100)
  const repeatDiffRow = [...document.querySelectorAll('.gp-file-row')].find((row) => (row.textContent || '').includes('a.txt'))
  fixture.repeatedDiffRevision = 0
  try {
    repeatDiffRow?.click(); await wait(80)
    const firstLoaded = (document.querySelector('.gp-changes .gp-diff__wrap')?.textContent || '').includes('repeat-diff-1')
    const diffCallsBeforeReopen = fixture.queries.filter((kind) => kind === 'diff').length
    const snapshotsBeforeReopen = fixture.snapshotCalls
    repeatDiffRow?.click(); await wait(80)
    const pane = document.querySelector('.gp-changes .gp-diff')
    result.repeatedDiffReloads = {
      firstLoaded,
      requests: fixture.queries.filter((kind) => kind === 'diff').length - diffCallsBeforeReopen,
      revision: fixture.repeatedDiffRevision,
      freshRendered: (pane?.querySelector('.gp-diff__wrap')?.textContent || '').includes('repeat-diff-2') && pane.getClientRects().length > 0,
      loading: (pane?.textContent || '').includes('common.loading'),
      snapshots: fixture.snapshotCalls - snapshotsBeforeReopen,
    }
  } finally { fixture.repeatedDiffRevision = null }

  // P0: exercise the actual Panel/registry/controller with resident sub-tabs.
  // Delay the restore snapshot so an early child batch cannot hide in batching.
  const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden')
  let fakeHidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => fakeHidden })
  const setHidden = (hidden) => { fakeHidden = hidden; document.dispatchEvent(new Event('visibilitychange')) }
  const pickTab = (key) => [...document.querySelectorAll('.gp-panel [role="tab"]')].find((button) => (button.textContent || '').includes(key))?.click()
  try {
    pickTab('tab.changes'); await wait(100)
    fixture.deferBinaryDiff = true
    ;[...document.querySelectorAll('.gp-file-row')].find((row) => (row.textContent || '').includes('img.png'))?.click()
    await wait(50)
    setHidden(true); await wait(30)
    const imageStagesBefore = fixture.queries.filter((kind) => kind === 'image-diff').length
    fixture.deferBinaryDiff = false
    fixture.releaseBinaryDiff?.(); fixture.releaseBinaryDiff = null
    await wait(80)
    result.visibilityNoHiddenImageStage = fixture.queries.filter((kind) => kind === 'image-diff').length === imageStagesBefore
    ;[...document.querySelectorAll('.gp-file-row')].find((row) => (row.textContent || '').includes('a.txt'))?.click()
    await wait(100)
    fixture.snapshot = { ...fixture.snapshot, refreshIntervalMs: 300_000 }
    setHidden(true); await wait(50)
    fixture.queries.length = 0
    const snapshotsBeforeRestore = fixture.snapshotCalls
    fixture.holdSnapshot = true
    setHidden(false); await wait(80)
    result.visibilityWaitsForSnapshot = fixture.queries.length === 0 && fixture.snapshotCalls === snapshotsBeforeRestore + 1
    fixture.snapshot = { ...fixture.snapshot, checkedAt: fixture.snapshot.checkedAt + 1 }
    fixture.holdSnapshot = false
    fixture.releaseSnapshot?.(); fixture.releaseSnapshot = null
    await wait(150)
    result.visibilityChangesCatchup = [...fixture.queries].sort()

    pickTab('tab.overview'); await wait(150)
    setHidden(true); await wait(40)
    fixture.queries.length = 0
    fixture.holdSnapshot = true
    setHidden(false); await wait(80)
    result.visibilityOverviewWaits = fixture.queries.length === 0
    fixture.snapshot = { ...fixture.snapshot, checkedAt: fixture.snapshot.checkedAt + 1 }
    fixture.holdSnapshot = false
    fixture.releaseSnapshot?.(); fixture.releaseSnapshot = null
    await wait(150)
    result.visibilityOverviewCatchup = [...fixture.queries].sort()

    pickTab('tab.files'); await wait(100)
    fixture.queries.length = 0
    setHidden(true); await wait(30)
    setHidden(false); await wait(150)
    result.visibilityFilesNoQueries = fixture.queries.length === 0
  } finally {
    fixture.deferBinaryDiff = false
    fixture.releaseBinaryDiff?.(); fixture.releaseBinaryDiff = null
    fixture.holdSnapshot = false
    fixture.releaseSnapshot?.(); fixture.releaseSnapshot = null
    if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor)
    else delete document.hidden
  }
  // Back to Files for the real-input zoom phase (it needs a visible pane).
  pickTab('tab.files')
  await wait(200)
  return result
}, SNAP)

// Real (trusted) mouse input for drag-to-pan: the in-page block above drives the
// handlers with synthetic PointerEvents, which cannot prove the browser's own
// input path reaches them — nor that zooming past 100% really resizes the picture.
const realInput = await (async () => {
  const dragAt = await page.evaluate(async () => {
    const row = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('big.png'))
    row?.click()
    await new Promise((r) => setTimeout(r, 400))
    const root = document.querySelector('.gp-files__image')?.parentElement
    root?.querySelector('.gp-zoom__pct')?.click() // 100%
    await new Promise((r) => setTimeout(r, 150))
    root?.querySelector('button[aria-label="files.zoomIn"]')?.click() // 125% > natural
    await new Promise((r) => setTimeout(r, 150))
    const rect = document.querySelector('.gp-files__image')?.getBoundingClientRect()
    return rect === undefined ? null : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
  if (dragAt === null) return null
  const read = () => page.evaluate(() => {
    const vp = document.querySelector('.gp-files__image')
    const img = vp?.querySelector('img')
    return {
      left: vp?.scrollLeft ?? 0,
      top: vp?.scrollTop ?? 0,
      rendered: Math.round(img?.getBoundingClientRect().width ?? 0),
      natural: img?.naturalWidth ?? 0,
      pct: vp?.parentElement?.querySelector('.gp-zoom__pct')?.textContent ?? '',
      lightbox: document.querySelector('.gp-zl-backdrop') !== null,
    }
  })
  const before = await read()
  await page.mouse.move(dragAt.x, dragAt.y)
  await page.mouse.down()
  await page.mouse.move(dragAt.x - 60, dragAt.y - 40, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  return { before, after: await read() }
})()

await browser.close()

try {
  assertPanelResults(out, realInput, errors)
  // The two Overview filters are the official Menu, not native <select>: opening
  // shows the surface, picking applies + closes, Escape/outside dismiss without
  // applying. Kept in this runner (rather than assert-panel-results.mjs) so the
  // change stays inside this task's declared write scope.
  assert.deepEqual(out.filterMenu, {
    nativeSelects: 0,
    triggerCount: 2,
    fetchStillDirect: true,
    initialAuthor: 'overview.allUsers',
    initialSince: 'overview.allTime',
    openShowsMenu: true,
    openAriaExpanded: 'true',
    itemsListed: ['overview.allUsers', 'Tester'],
    pickClosesMenu: true,
    pickAriaExpanded: 'false',
    authorLabelAfterPick: 'Tester',
    historyCarriedAuthor: true,
    sinceMenuOpened: true,
    escapeClosesMenu: true,
    escapeKeepsFilter: true,
    escapeAppliedNothing: true,
    outsideClickClosesMenu: true,
    outsideClickKeepsFilter: true,
  }, 'the author/since filters are the official Menu (open / pick / Escape / outside click)')
  assert.deepEqual(out.segmentedTabs, {
    hasTablist: true,
    ariaLabel: 'panel.tabs',
    tabCount: 3,
    everyTabHasAria: true,
    controlsResolve: true,
    uniqueIds: true,
    onlySelectedIsTabStop: true,
    indicatorHidden: true,
    indicatorTransformAtChanges: 'translateX(100%)',
    activeAtChanges: 'tab.changes',
    changesPaneShown: true,
    overviewPaneHidden: true,
    legacyTabButtons: 0,
    activeAfterOverview: 'tab.overview',
    indicatorTransformAtOverview: 'translateX(0%)',
    overviewPaneShown: true,
    changesPaneHidden: true,
    activeAfterChanges: 'tab.changes',
    indicatorTransformAtChangesAgain: 'translateX(100%)',
    changesPaneShownAgain: true,
  }, 'the sub-tab switcher is the official SegmentedTabs (tablist + sliding indicator + pane switch)')
  console.log('e2e run.mjs: PASS', JSON.stringify(out))
} catch (e) {
  console.error('e2e run.mjs: FAIL', e.message)
  console.error(JSON.stringify(out, null, 2))
  process.exit(1)
}
