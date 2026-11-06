/**
 * E2E (merged into run): clean-repo pill color + non-git directory marker + jump click.
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
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
    staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
    remote: { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' },
    lastCommit: null,
    changes: [],
    stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
    truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
  }
}

/** Run this scenario on the caller's browser; it owns only its own page. */
export async function run(browser) {
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addScriptTag({ path: resolve(DIR, 'client.js') })
await page.addScriptTag({ path: resolve(DIR, 'panel-aria-helper.mjs') })

const out = await page.evaluate(async ({ snap, nonGitDir }) => {
  const result = {}
  const entry = window.__getLoaded()

  // Case 1: clean repo → synced (green) pill + jump click.
  let cleanFileListings = 0
  const cleanConn = { rpc: { call: async (_c, ep, payload) => {
    if (ep === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
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
  result.cleanDefault = cleanPanel.querySelector('.gp-panel [role="tab"][aria-selected="true"]')?.textContent?.includes('tab.overview') ?? false
  result.cleanAvoidsFileListing = cleanFileListings === 0
  cleanPanelRoot.render(registered['conversation.view'].component({ sessionId: 'clean-second' }))
  await new Promise((r) => setTimeout(r, 300))
  result.cleanAfterSessionSwitch = cleanPanel.querySelector('.gp-panel [role="tab"][aria-selected="true"]')?.textContent?.includes('tab.overview') ?? false

  // Fake tab bar → the pill click should click a role=tab button labeled panel.tab.
  // The real shell wraps view tabs in [data-conversation-tabs] and puts each
  // name in its own nowrap block span (its `.tabLabel`); mirror that here so the
  // dot's line placement is the one the shell produces, and add a sibling
  // "chat" tab so the toggle-back path has somewhere to go.
  const mkShellTab = (label) => {
    const btn = document.createElement('button')
    btn.setAttribute('role', 'tab')
    btn.setAttribute('aria-selected', 'false')
    const span = document.createElement('span')
    span.className = 'shell-tab-label'
    span.style.cssText = 'display:block;white-space:nowrap;max-width:88px;'
      + 'overflow:hidden;text-overflow:ellipsis;line-height:16px'
    span.textContent = label
    btn.appendChild(span)
    return btn
  }
  document.getElementById('tabbar').setAttribute('data-conversation-tabs', '')
  const chatTab = mkShellTab('chat')
  chatTab.setAttribute('aria-selected', 'true')
  chatTab.addEventListener('click', () => {
    chatTab.setAttribute('aria-selected', 'true'); fakeTab.setAttribute('aria-selected', 'false')
  })
  document.getElementById('tabbar').appendChild(chatTab)
  const fakeTab = mkShellTab('panel.tab')
  let clicked = false
  fakeTab.addEventListener('click', () => {
    clicked = true; fakeTab.setAttribute('aria-selected', 'true'); chatTab.setAttribute('aria-selected', 'false')
  })
  document.getElementById('tabbar').appendChild(fakeTab)
  document.querySelector('.gp-pill').click()
  await new Promise((r) => setTimeout(r, 100))
  result.jumpClicked = clicked
  result.jumpSelectedGit = fakeTab.getAttribute('aria-selected') === 'true'
  // A second click while the Git tab is active returns to the conversation tab.
  document.querySelector('.gp-pill').click()
  await new Promise((r) => setTimeout(r, 100))
  result.toggleBackToChat = chatTab.getAttribute('aria-selected') === 'true' && fakeTab.getAttribute('aria-selected') === 'false'

  // A narrow conversation (a phone) folds every view but the conversation into
  // the row's "more views" menu: the button sits beside the tablist and opens a
  // portaled menu one render later, and the active folded view shows no state
  // on screen — the shell just mounts it. The pill must reach Git through the
  // menu and read the mounted panel to toggle back.
  // The shell mounts the active view only; the earlier scenario's panel would
  // read as "Git is open", so it goes first.
  cleanPanelRoot.unmount()
  cleanPanel.remove()
  fakeTab.remove()
  const more = document.createElement('button')
  more.setAttribute('aria-haspopup', 'menu')
  more.setAttribute('aria-expanded', 'false')
  document.getElementById('tabbar').after(more)
  const tabRow = document.createElement('div')
  document.getElementById('tabbar').before(tabRow)
  tabRow.append(document.getElementById('tabbar'), more)
  let gitMount = null
  const showGit = () => {
    chatTab.setAttribute('aria-selected', 'false')
    gitMount = document.createElement('div')
    gitMount.className = 'gp-panel'
    gitMount.setAttribute('data-gp-host', 'conversation')
    tabRow.append(gitMount)
  }
  chatTab.addEventListener('click', () => { gitMount?.remove(); gitMount = null })
  let menuOpens = 0
  more.addEventListener('click', () => {
    menuOpens += 1
    more.setAttribute('aria-expanded', 'true')
    setTimeout(() => {
      const menu = document.createElement('div')
      menu.setAttribute('role', 'menu')
      for (const name of ['trajectory', 'panel.tab']) {
        const item = document.createElement('button')
        item.setAttribute('role', 'menuitem')
        item.textContent = name
        item.addEventListener('click', () => {
          menu.remove(); more.setAttribute('aria-expanded', 'false')
          if (name === 'panel.tab') showGit()
        })
        menu.append(item)
      }
      document.body.append(menu)
    }, 30)
  })
  document.querySelector('.gp-pill').click()
  await new Promise((r) => setTimeout(r, 300))
  result.foldedOpensMenu = menuOpens === 1
  result.foldedSelectsGit = gitMount !== null && chatTab.getAttribute('aria-selected') === 'false'
  result.foldedMenuClosed = document.querySelector('[role="menu"]') === null
  document.querySelector('.gp-pill').click()
  await new Promise((r) => setTimeout(r, 100))
  result.foldedToggleBack = gitMount === null && chatTab.getAttribute('aria-selected') === 'true' && menuOpens === 1
  more.remove()
  tabRow.replaceWith(document.getElementById('tabbar'))
  document.getElementById('tabbar').appendChild(fakeTab)

  // Case 2: a non-git directory has no input marker but opens the Files view.
  const notGitConn = { rpc: { call: async (_c, ep) => ep === 'dbGitPanel/snapshot'
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
  result.notGitFilesOnly = document.querySelectorAll('#panel .gp-panel [role="tab"]').length === 1
    && document.querySelector('#panel .gp-panel [role="tab"][aria-selected="true"]')?.textContent?.includes('tab.files')
  result.notGitFileListed = document.querySelector('#panel .gp-files__tree')?.textContent?.includes('note.md')

  // Case 3: showInputPill=false → the input-bar marker is hidden and the Git
  // tab shows a status dot instead (pill ↔ tab-dot mutual exclusion, T5).
  const dirtySnap = { ...snap, dirty: true, modified: 1, showInputPill: false, changes: [{ path: 'x.txt', status: 'modified', staged: false, isDirectory: false }] }
  const dotConn = { rpc: { call: async (_c, ep) => ep === 'dbGitPanel/snapshot'
    ? { ok: true, value: { ok: true, value: dirtySnap } }
    : { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [], remote: [] } } } } }
  entry.apply(mkCtx(dotConn))
  const pill3 = registered['conversation.input.left']
  ReactDOM.createRoot(document.getElementById('pill')).render(pill3.component({ sessionId: 's3' }))
  await new Promise((r) => setTimeout(r, 300))
  result.dotPillHidden = document.querySelector('#pill .gp-pill') === null
  result.dotOnTab = document.querySelector('[data-gp-tab-dot]') !== null
  result.dotDirty = document.querySelector('.gp-tab-dot--dirty') !== null
  // issue #84: the dot belongs beside the tab name, on the label's own line.
  // As a sibling of the shell's block-level label it fell to the line below the
  // name and stretched the tab row, so measure the real boxes.
  const dotEl = document.querySelector('[data-gp-tab-dot]')
  const labelEl = fakeTab.querySelector('.shell-tab-label')
  const nameNode = labelEl === null ? null
    : [...labelEl.childNodes].find((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
  const nameRange = document.createRange()
  if (nameNode !== undefined && nameNode !== null) nameRange.selectNode(nameNode)
  const nameBox = nameNode === undefined || nameNode === null ? null : nameRange.getBoundingClientRect()
  const dotBox = dotEl === null ? null : dotEl.getBoundingClientRect()
  result.dotBesideName = nameBox !== null && dotBox !== null
    && dotBox.left >= nameBox.right - 1
    && dotBox.top < nameBox.bottom && dotBox.bottom > nameBox.top
  result.dotKeepsTabHeight = dotBox !== null
    && Math.abs(fakeTab.getBoundingClientRect().height - chatTab.getBoundingClientRect().height) <= 1

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

  // Case 5: a detached HEAD has no branch name, and `pill.detached` is the
  // label without parentheses. The pill owns the one visible pair, so the
  // fallback must not bring its own; the repo→branch gap stays one tight
  // interval instead of reading as two spaces.
  const detachedSnap = { ...snap, branch: null, dirty: false }
  const detachedConn = { rpc: { call: async (_c, ep) => ep === 'dbGitPanel/snapshot'
    ? { ok: true, value: { ok: true, value: detachedSnap } }
    : { ok: true, value: { ok: true, value: { kind: 'branches', current: null, defaultBranch: null, local: [], remote: [] } } } } }
  entry.apply(mkCtx(detachedConn))
  const detachedRegion = document.createElement('div')
  detachedRegion.setAttribute('data-conversation-region', '')
  detachedRegion.style.width = '1000px'
  document.body.appendChild(detachedRegion)
  const detachedHost = document.createElement('div')
  detachedRegion.appendChild(detachedHost)
  const detachedRoot = ReactDOM.createRoot(detachedHost)
  detachedRoot.render(registered['conversation.input.left'].component({ sessionId: 's-detached' }))
  await new Promise((r) => setTimeout(r, 300))
  const detachedPill = detachedHost.querySelector('.gp-pill')
  const detachedRepo = detachedPill?.querySelector('.gp-pill__repo')
  const detachedGit = detachedPill?.querySelector('.gp-pill__git')
  result.detachedText = detachedPill?.textContent ?? ''
  result.detachedSinglePair = detachedPill?.querySelectorAll('.gp-pill__git')?.length === 1
    && result.detachedText === 'fixture-repo(pill.detached)'
  result.pillGap = detachedRepo && detachedGit
    ? Math.round((detachedGit.getBoundingClientRect().left - detachedRepo.getBoundingClientRect().right) * 100) / 100
    : -1
  detachedRoot.unmount()
  detachedRegion.remove()

  // Case 6: every visible sub-tab owns a resolvable, correctly-labelled
  // role=tabpanel in every view state (ready / loading / no-cwd / error /
  // files-only / no-session) — never a dangling aria-controls. Runs last: it
  // applies its own contexts and leaves its scenario roots mounted.
  result.panelAria = await window.runPanelAriaScenarios({ snap, nonGitDir })

  return result
}, { snap: cleanSnap(), nonGitDir: NON_GIT_DIR })

try {
  assert.equal(out.hasSynced, true, 'clean repo pill uses the green synced class')
  assert.equal(out.hasDirty, false, 'clean repo pill is not orange')
  assert.equal(out.cleanDefault, true, 'clean Git workspace defaults to Overview')
  assert.equal(out.cleanAfterSessionSwitch, true, 'switching between clean sessions still selects Overview')
  assert.equal(out.cleanAvoidsFileListing, true, 'clean default does not fetch hidden file-browser data')
  assert.equal(out.jumpClicked, true, 'pill click activates the Git tab button')
  assert.equal(out.jumpSelectedGit, true, 'pill click selects the Git tab')
  assert.equal(out.toggleBackToChat, true, 'a second pill click while on Git returns to the conversation tab')
  assert.equal(out.foldedOpensMenu, true, 'with Git folded into the more-views menu, the pill opens that menu')
  assert.equal(out.foldedSelectsGit, true, 'and picks the Git entry once the menu renders')
  assert.equal(out.foldedMenuClosed, true, 'leaving the menu closed behind it')
  assert.equal(out.foldedToggleBack, true, 'a second click reads the mounted panel and returns to the conversation without the menu')
  assert.equal(out.notGitPillHidden, true, 'non-git directory hides the input marker')
  assert.equal(out.notGitFilesOnly, true, 'non-git panel defaults to Files only')
  assert.equal(out.notGitFileListed, true, 'non-git panel lists cwd files')
  assert.equal(out.dotPillHidden, true, 'showInputPill=false hides the input-bar marker')
  assert.equal(out.dotOnTab, true, 'showInputPill=false injects the Git tab status dot')
  assert.equal(out.dotDirty, true, 'the tab dot is the dirty (orange) variant')
  assert.equal(out.dotBesideName, true, 'the tab dot sits beside the tab name, on the label line')
  assert.equal(out.dotKeepsTabHeight, true, 'the tab dot does not stretch the tab row (issue #84)')
  assert.equal(out.compactWhenNarrow, true, 'a narrow workspace collapses the marker to a dot')
  assert.equal(out.compactKeepsStatus, true, 'the collapsed marker keeps its git status class')
  assert.equal(out.compactDotShown, true, 'the status dot is visible when collapsed')
  assert.equal(out.expandsWhenWide, true, 'widening the workspace expands the marker again')
  assert.equal(out.detachedSinglePair, true,
    `detached HEAD gets exactly one parenthesis pair (got ${JSON.stringify(out.detachedText)})`)
  assert.ok(Math.abs(out.pillGap - 4) < 0.5, `the repo→branch gap is tight (got ${out.pillGap}px)`)
  // Sub-tab ARIA: a tab's aria-controls must resolve to its own labelled
  // tabpanel in every view state, with exactly one selected/shown pane.
  const aria = out.panelAria
  const soundPanel = (state) => state.everyTabResolves && state.everyPaneLabelledByOwnTab
    && state.exactlyOneSelected && state.selectionMatchesShownPane
  for (const state of ['ready', 'loading', 'noCwd', 'error', 'filesOnly', 'gitUnavailable', 'noSession']) {
    assert.equal(soundPanel(aria[state]), true, state + ': every tab resolves to its own labelled tabpanel')
  }
  assert.equal(aria.ready.tabCount, 3, 'a git repo shows three tabs')
  assert.deepEqual(aria.ready.contentByLabel, { 'tab.overview': true, 'tab.changes': false, 'tab.files': false },
    'only the visited tab pane carries content (lazy mount preserved)')
  assert.equal(aria.ready.statePlaceholderText, null, 'a ready panel renders the tab, not a state placeholder')
  assert.equal(aria.loading.tabCount, 3, 'loading still shows three tabs')
  assert.equal(aria.loading.statePlaceholderText, 'common.loading', 'loading shows the loading placeholder in its pane')
  assert.equal(aria.noCwd.statePlaceholderText, 'error.noCwd', 'no-cwd shows the no-cwd placeholder in its pane')
  assert.equal(aria.error.statePlaceholderText, 'pill.unavailable', 'a generic error shows the unavailable placeholder in its pane')
  assert.equal(aria.filesOnly.tabCount, 1, 'a non-git directory exposes the Files tab alone')
  assert.equal(aria.filesOnly.contentByLabel['tab.files'], true, 'files-only mounts the file browser')
  assert.equal(aria.filesOnly.statePlaceholderText, null, 'files-only renders the browser, not a state placeholder')
  assert.equal(aria.filesOnly.noticeText, null, 'a plain non-git directory shows no install notice')
  assert.equal(aria.gitUnavailable.tabCount, 1, 'git-unavailable also exposes the Files tab alone')
  assert.equal(aria.gitUnavailable.contentByLabel['tab.files'], true, 'git-unavailable still mounts the file browser')
  assert.equal(aria.gitUnavailable.noticeText, 'files.gitNotInstalled', 'git-unavailable inside a repo stacks the install notice')
  assert.equal(aria.noSession.tabCount, 3, 'no session still renders the tab list')
  assert.equal(aria.noSession.statePlaceholderText, 'error.noCwd', 'no session shows the no-cwd placeholder in its pane')
  assert.equal(errors.length, 0, 'no page errors: ' + JSON.stringify(errors))
  console.log('e2e run2 (merged in run): PASS')
} finally {
  await page.close()
}
}
