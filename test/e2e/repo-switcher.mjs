/**
 * E2E: the repository list and the checkout it selects.
 *
 * A workspace may hold nested repositories beside its own checkout (issue
 * #83). The Git overview lists every checkout in its left column, above the
 * branch tree, so picking one keeps branches, commit list and the list itself
 * on screen together; the pick rides every repository-scoped request while the
 * panes themselves never learn about it. The compact layout has no left column,
 * so the list leads its branch-filter surface instead (no extra tab). The list block boots collapsed with the
 * checkout in use named in its head line, and no row ever represents a non-git
 * workspace root. A cwd that is not a checkout shows **no repository entries**:
 * it opens straight into its first sub-repository (a session that never picked
 * anything); a scan that found nothing shows the browser alone with the tree
 * column's status bar (absolute path, click-to-copy, refresh). The probe switch
 * (detail-page config) re-answers the list in place: flipping it off empties
 * the list (one checkout needs no list) with no page switch.
 * A switch never blanks the panel: the old sample stays up, dimmed, under a
 * "switching" badge until the new one lands. A host that cannot answer the scan
 * keeps the three-pane panel unchanged.
 * The changes column docks the same list (one collapse state with the
 * overview; compact keeps it in the overview's branch filter only), and the
 * file browser roots itself independently of the repository the panel follows:
 * the config only sets each session's default (off: the project root, tree
 * state intact across a switch; on: the followed repository), the address is a
 * candidate-root dropdown either way,
 * a session's own pick or follow opt-in sticks across switches, and a config
 * flip (delivered by the next polled sample) re-arms the new default. The
 * coupling is one-way: a root pick that lands on a checkout switches Git too.
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

// A clean checkout: the list is what this runner measures, so the panes stay
// quiet (no expanded lists, no diffs, no image fetches).
const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

const WORKSPACE_REPO = { path: '', root: 'fixture-repo', name: 'fixture-repo', kind: 'workspace' }
const NESTED_REPO = { path: 'site', root: 'fixture-repo/site', name: 'site', kind: 'nested' }
// A checkout whose folder name does not identify it: the row needs the path.
const DEEP_REPO = { path: 'apps/web', root: 'fixture-repo/apps/web', name: 'web', kind: 'nested' }

// Scenario B/C: a repository family (the main work tree plus its worktrees)
// next to unrelated repositories of the workspace. The two disabled worktrees
// are the host's trust decisions: one outside the cwd, one whose directory is
// gone — both stay visible, neither may ever be picked.
const WT_WORKSPACE = { path: '', root: 'fixture-repo', name: 'fixture-repo', kind: 'workspace', role: 'main', branch: 'main' }
const WT_LINKED = { path: '.agents/worktrees/feat/sidebar', root: 'fixture-repo/.agents/worktrees/feat/sidebar', name: 'sidebar', kind: 'nested', role: 'linked', branch: 'feat/sidebar' }
const WT_OUTSIDE = { path: '../spike', root: '/mock/spike', name: 'spike', kind: 'nested', role: 'linked', branch: 'spike', disabled: 'outside' }
const WT_STALE = { path: 'gone', root: 'fixture-repo/gone', name: 'gone', kind: 'nested', role: 'linked', branch: 'old', disabled: 'stale' }
const MIXED_FAMILY = [WT_WORKSPACE, WT_LINKED, WT_OUTSIDE, WT_STALE, NESTED_REPO, DEEP_REPO]

const browser = await chromium.launch()

/**
 * Mount the panel in a fresh page. `action` drives the page ('inspect' only
 * observes; 'switch' also moves between checkouts) and the page hands back
 * observations so every assertion stays on this side of the RPC.
 */
async function mount(repos, action, options = {}) {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error' || msg.text().includes('GPSEL')) errors.push(msg.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  if (options.viewportWidth !== undefined) {
    await page.setViewportSize({ width: options.viewportWidth, height: 780 })
  }
  await page.goto(harness)
  // The layout mode is measured on the panel's own box, not on the viewport: a
  // squeezed desktop panel is as compact as a phone's.
  if (options.panelWidth !== undefined) {
    await page.evaluate((width) => {
      const el = document.getElementById('panel')
      el.style.width = width + 'px'
      el.style.height = '700px'
    }, options.panelWidth)
  }
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  // `true` fails the untagged sample (a cwd that is not a checkout); a code
  // string fails the tagged ones (a pick the host can no longer resolve).
  const snapshotFails = options.snapshotFails === true
    ? true
    : typeof options.snapshotFails === 'string' ? options.snapshotFails : false
  const snap = options.dirty === true
    ? { ...SNAP, dirty: true, modified: 2, changes: [{ path: 'a.txt', status: 'M', side: 'worktree' }] }
    : SNAP
  // A non-zero poll makes fresh snapshots arrive on their own — the way the
  // config form's resync delivers a flipped switch to the panel.
  const polled = options.pollMs === undefined ? snap : { ...snap, refreshIntervalMs: options.pollMs }
  const snapUsed = options.foldOnPick === true ? { ...polled, collapseReposOnPick: true } : polled
  const scene = options.scene || 'scene'
  const out = await page.evaluate(async ({ snap, repos: listed, action, snapshotFails, scene, probeToggle, taggedRoot, followActive, followOn }) => {
    const React = window.React
    const origWarn = console.warn.bind(console)
    console.warn = (...args) => origWarn('[' + scene + ']', ...args)
    const { fixture, connection } = window.createGitPanelMock(snap)
    fixture.repos = listed
    // Follow-mode fixtures (files-follow-Git): `taggedRoot` answers every
    // tagged snapshot with the repository's own root the way the host resolves
    // it, and while follow is active the flag rides every reply — a flip is
    // then delivered by the next polled sample, like a config write.
    const follow = { active: followActive, on: followOn }
    window.__gpFollow = (on) => { follow.on = on }
    // Every repository-scoped request, so the test can prove the pick reaches
    // the wire rather than only the row highlight. The client captures the
    // connection face before apply(), so patch it first.
    // Scenario 9: the probe switch (config) flips mid-run — snapshots then
    // carry detectCheckouts:false and repo-list answers with the workspace row
    // alone, the way the host gates its two probes behind that switch.
    const probe = { active: probeToggle, off: false }
    const calls = []
    const mockCall = connection.rpc.call
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload && payload.args && payload.args.request
      calls.push({
        endpoint,
        kind: request && request.query ? request.query.kind : null,
        repo: request && typeof request.repo === 'string' ? request.repo : '',
      })
      if (probe.active && endpoint === 'gitPanel/snapshot') {
        const tag = request && typeof request.repo === 'string' ? request.repo : ''
        return { ok: true, value: { ok: true, value: { ...snap, detectCheckouts: !probe.off, root: tag === '' ? snap.root : 'fixture-repo/' + tag } } }
      }
      if (probe.active && endpoint === 'gitPanel/query' && request && request.query && request.query.kind === 'repo-list') {
        const rows = probe.off ? listed.filter((entry) => entry.path === '') : listed
        return { ok: true, value: { ok: true, value: { kind: 'repo-list', cwd: '/mock/workspace', repos: rows } } }
      }
      if ((taggedRoot || follow.active) && endpoint === 'gitPanel/snapshot') {
        const tag = request && typeof request.repo === 'string' ? request.repo : ''
        // Every sample is stamped when it is taken, the way the host does: the
        // follow flip is read off the newest sample.
        const value = { ...snap, root: tag === '' ? snap.root : 'fixture-repo/' + tag, checkedAt: Date.now() }
        if (follow.active) value.filesFollowRepo = follow.on
        return { ok: true, value: { ok: true, value } }
      }
      // A workspace directory that is not a checkout: the session root has no
      // repository of its own, only nested ones, so only the untagged request
      // fails. A pick of a nested checkout answers normally, which is what lets
      // the panel's default pick land on a git view.
      if (snapshotFails && endpoint === 'gitPanel/snapshot') {
        const tag = request && typeof request.repo === 'string' ? request.repo : ''
        const fails = snapshotFails === true ? tag === '' : tag !== ''
        if (fails) return { ok: true, value: { ok: false, error: { code: snapshotFails === true ? 'not-a-git-repo' : snapshotFails, cwd: '/mock/workspace' } } }
        return { ok: true, value: { ok: true, value: { ...snap, root: tag === '' ? snap.root : 'fixture-repo/' + tag } } }
      }
      return mockCall(channel, endpoint, payload)
    }
    const entry = window.__getLoaded()
    if (!entry || typeof entry.apply !== 'function') return { error: 'plugin did not load' }
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
    const view = registered['conversation.view']
    if (!view) return { error: 'conversation.view was not registered' }
    // `component(props)` returns the mounted element; wrapping it in another
    // createElement would hand React the element object as a component type.
    window.ReactDOM.createRoot(document.getElementById('panel'))
      .render(view.component({ sessionId: 'sess-1' }))
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    await wait(500)

    // Path lines may carry the invisible LRM prefix (rtlPathText); test reads
    // compare the visible path, so strip it.
    const textOf = (node, selector) => {
      const found = node.querySelector(selector)
      return found === null ? '' : found.textContent.replace(/\u200e/g, '').trim()
    }
    const tabNodes = () => [...document.querySelectorAll('.gp-panel .gp-tabbar__tabs [role="tab"]')]
    const tabLabels = () => tabNodes().map((node) => (node.querySelector('.gp-tab__label') || node).textContent.trim())
    const activeTabLabel = () => {
      const node = tabNodes().find((n) => n.getAttribute('aria-selected') === 'true')
      return node ? (node.querySelector('.gp-tab__label') || node).textContent.trim() : null
    }
    const clickTab = (label) => {
      const node = tabNodes().find((n) => (n.querySelector('.gp-tab__label') || n).textContent.trim() === label)
      if (!node) throw new Error('no tab ' + label + ' in ' + tabLabels().join('|'))
      node.click()
    }
    // The left column of the overview: the list has to live inside it, beside
    // the branch tree, not on a page of its own.
    const listInLeftColumn = () => {
      const left = document.querySelector('.gp-panel .gp-col--left')
      return left !== null && left.querySelector('.gp-repolist') !== null
    }
    // Rows and head of the list that is actually on screen: the changes pane
    // docks the same block, and a hidden pane's copy must not double the read.
    // The predicate is the pane, not the row — a collapsed block keeps its rows
    // in the DOM (behind [hidden]) and those still count as the pane's list.
    const inVisiblePane = (node) => {
      let el = node
      while (el !== null && el !== document.body) {
        if (el.getAttribute('role') === 'tabpanel' && el.style.display === 'none') return false
        el = el.parentElement
      }
      return true
    }
    const visibleList = () => [...document.querySelectorAll('.gp-panel .gp-repolist')].find((n) => inVisiblePane(n)) ?? null
    const listRows = () => [...document.querySelectorAll('.gp-panel .gp-repolist__item')]
      .filter((node) => inVisiblePane(node))
      .map((node) => ({
        name: textOf(node, '.gp-repolist__name'),
        meta: textOf(node, '.gp-repolist__meta'),
        // The branch chip sits on the name line; it may hold the row's own
        // reported branch (a worktree), the checked row's snapshot, or nothing.
        branch: textOf(node, '.gp-repolist__branch'),
        active: node.classList.contains('gp-repolist__item--active'),
        current: node.getAttribute('aria-current'),
        count: textOf(node, '.gp-repolist__count'),
        disabled: node.disabled === true,
        // Rows carry no native title any more: the detail moved to the fast
        // hover tip. The field stays to pin that absence.
        title: node.getAttribute('title') || '',
      }))
    // Group headers: they exist only when both checkout families do — a lone
    // family stays a flat list whose rows these helpers already read.
    const groupInfo = () => ({
      titles: [...document.querySelectorAll('.gp-panel .gp-repolist__grouptitle')].map((n) => n.textContent.trim()),
      counts: [...document.querySelectorAll('.gp-panel .gp-repolist__groupcount')].map((n) => n.textContent.trim()),
      labels: [...document.querySelectorAll('.gp-panel .gp-repolist__group')].map((n) => n.getAttribute('aria-label')),
    })
    const pickRow = (selector, name) => {
      const row = [...document.querySelectorAll('.gp-panel ' + selector)]
        .find((node) => textOf(node, selector.replace('__item', '__name')) === name)
      if (!row) {
        const panel = document.querySelector('.gp-panel')
        const have = [...document.querySelectorAll('.gp-panel ' + selector)].map((node) => textOf(node, selector.replace('__item', '__name')))
        const tabs = [...panel.querySelectorAll('.gp-tabbar [role="tab"]')].map((node) => (node.getAttribute('aria-selected') === 'true' ? '*' : '') + node.textContent.trim())
        const body = [...panel.querySelectorAll('.gp-body > *')].map((node) => node.className + '|' + node.textContent.trim().slice(0, 40))
        throw new Error('no repository row ' + name + ' in ' + selector + ' (have ' + have.join('|') + ') tabs=' + tabs.join(',') + ' body=' + body.join(' ; '))
      }
      row.click()
    }
    // A collapsed list is not on screen: every pick expands the block first.
    const expandRepos = async () => {
      const btn = document.querySelector('.gp-panel .gp-repolist__head')
      if (btn !== null && btn.getAttribute('aria-expanded') === 'false') {
        btn.click()
        await wait(250)
      }
    }
    // The head line: toggle state and, while collapsed, the checkout it names.
    const headInfo = () => {
      const list = visibleList() ?? document.querySelector('.gp-panel .gp-repolist')
      const btn = list === null ? null : list.querySelector('.gp-repolist__head')
      const chip = list === null ? null : list.querySelector('.gp-repolist__selected')
      return {
        present: btn !== null,
        expanded: btn === null ? null : btn.getAttribute('aria-expanded') === 'true',
        selected: chip === null ? '' : chip.textContent.trim(),
      }
    }
    // The body dims and the tab bar shows a badge while the next sample is in
    // flight; the list itself must stay put, or the switch reads as a collapse.
    const switchingNow = () => document.querySelector('.gp-panel').getAttribute('data-repo-switching') === 'true'
    // The tree column's header: the absolute browse root on the left, the
    // refresh control on the right — inside the directory tree column, never a
    // full-width row on top of the page, and never covering the entries.
    const statusbarInfo = () => {
      const bar = document.querySelector('.gp-panel .gp-files__statusbar')
      const wrap = document.querySelector('.gp-panel .gp-files__tree-wrap')
      const rows = document.querySelector('.gp-panel .gp-files__tree')
      const b = bar?.getBoundingClientRect()
      const w = wrap?.getBoundingClientRect()
      return {
        present: bar !== null,
        path: bar === null ? '' : textOf(bar, '.gp-files__status-code'),
        hasPath: bar !== null && bar.querySelector('.gp-files__status-path') !== null,
        refreshInBar: bar !== null && bar.querySelector('.gp-files__refresh') !== null,
        // Inside the tree column, above its scrolling entries, and exactly as
        // wide as that column (never spilling over the preview side).
        barInTree: !!(bar && wrap && wrap.contains(bar)),
        precedesRows: !!(bar && rows && (bar.compareDocumentPosition(rows) & 4) !== 0),
        spansColumnOnly: !!(b && w && Math.abs(b.width - w.width) <= 1),
      }
    }
    // Arm the clipboard spy the copy buttons write through (the harness
    // primitive prefers navigator.clipboard when the page provides one).
    const armClipboard = (field) => {
      window[field] = null
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => { window[field] = text } },
      })
    }
    // Visible-only variants: the panes behind the active one stay mounted
    // (display:none), so a document-wide query would read the hidden
    // overview's list while the changes pane is the one on screen.
    const rootButton = () => document.querySelector('.gp-panel .gp-files__status-path')
    const rootMenuInfo = () => {
      const menu = document.querySelector('.gp-panel .gp-files__rootmenu')
      const trigger = rootButton()
      return {
        triggerPresent: trigger !== null,
        hasPopup: trigger !== null && trigger.getAttribute('aria-haspopup') === 'listbox',
        expanded: trigger !== null && trigger.getAttribute('aria-expanded') === 'true',
        open: menu !== null,
        items: menu === null ? [] : [...menu.querySelectorAll('.gp-files__rootmenu__item')].map((node) => ({
          key: textOf(node, '.gp-files__rootmenu__name'),
          path: textOf(node, '.gp-files__rootmenu__path'),
          active: node.classList.contains('gp-files__rootmenu__item--active'),
          selected: node.getAttribute('aria-selected'),
        })),
      }
    }
    const openRootMenu = async () => {
      const trigger = rootButton()
      if (trigger === null) throw new Error('no browse-root trigger')
      // Idempotent: the trigger toggles, and a menu left open over a tab
      // switch (synthetic clicks send no pointerdown) would close instead.
      if (trigger.getAttribute('aria-expanded') !== 'true') {
        trigger.click()
        await wait(150)
      }
    }
    const clickRootItem = async (key) => {
      const menu = document.querySelector('.gp-panel .gp-files__rootmenu')
      const item = menu === null ? null : [...menu.querySelectorAll('.gp-files__rootmenu__item')].find((node) => textOf(node, '.gp-files__rootmenu__name') === key)
      if (item === null || item === undefined) throw new Error('no root menu item ' + key)
      item.click()
      await wait(250)
    }
    const expandTree = async (name) => {
      const row = [...document.querySelectorAll('.gp-panel .gp-files__entry--dir')]
        .find((n) => (n.getAttribute('aria-label') || '').trim() === name)
      if (row === undefined) throw new Error('no tree dir ' + name)
      row.click()
      await wait(300)
    }
    const treeText = () => (document.querySelector('.gp-panel .gp-files__tree')?.textContent ?? '').trim()

    const observed = {
      tabs: tabLabels(),
      tabCount: document.querySelector('.gp-panel .gp-tabbar').getAttribute('data-tab-count'),
      switching: switchingNow(),
      // The requests sent before any pick: the root sample must never be tagged.
      rootCalls: calls.slice(),
    }
    if (action === 'switch' && observed.tabs.includes('tab.overview') && activeTabLabel() !== 'tab.overview') {
      // A dirty checkout opens on Changes; the list lives in the overview.
      clickTab('tab.overview')
      await wait(300)
    }
    observed.activeTab = activeTabLabel()
    observed.inLeftColumn = listInLeftColumn()
    observed.rows = listRows()
    // Boot state, read before any pick expands the block.
    observed.head = headInfo()
    // The tight-stacked checkout bar must stay out of every other layout.
    observed.repoBarPresent = document.querySelector('.gp-repobar') !== null
    // The compact branch filter (a bottom sheet on a desktop-sized screen) is
    // portaled outside the panel; it leads with the same repository block the
    // stacked drawer carries.
    const sheetList = () => document.querySelector('.gp-sheet .gp-repolist')
    const sheetRows = () => [...document.querySelectorAll('.gp-sheet .gp-repolist__item')].map((node) => ({
      name: textOf(node, '.gp-repolist__name'),
      meta: textOf(node, '.gp-repolist__meta'),
      active: node.classList.contains('gp-repolist__item--active'),
      disabled: node.disabled === true,
      title: node.getAttribute('title') || '',
    }))
    const sheetGroups = () => ({
      titles: [...document.querySelectorAll('.gp-sheet .gp-repolist__grouptitle')].map((n) => n.textContent.trim()),
      counts: [...document.querySelectorAll('.gp-sheet .gp-repolist__groupcount')].map((n) => n.textContent.trim()),
    })
    const openSheet = async () => {
      const btn = document.querySelector('.gp-panel .gp-overview--compact .gp-toolbar button[title="overview.filterBranch"]')
      if (btn === null) throw new Error('no compact branch filter button')
      btn.click()
      await wait(250)
    }
    const expandSheetRepos = async () => {
      const btn = document.querySelector('.gp-sheet .gp-repolist__head')
      if (btn !== null && btn.getAttribute('aria-expanded') === 'false') {
        btn.click()
        await wait(250)
      }
    }
    const pickSheetRow = (name) => {
      const row = [...document.querySelectorAll('.gp-sheet .gp-repolist__item')].find((node) => textOf(node, '.gp-repolist__name') === name)
      if (!row) throw new Error('no sheet repository row ' + name + ' (have ' + sheetRows().map((r) => r.name).join('|') + ')')
      row.click()
    }
    if (action === 'compact') {
      // Compact keeps the three-cell bar: the repository list rides the branch
      // filter surface instead of a page of its own.
      const track = document.querySelector('.gp-panel .gp-tabbar__tabs')
      const indicator = track === null ? null : track.querySelector('span[aria-hidden="true"]')
      observed.layout = document.querySelector('.gp-panel').getAttribute('data-layout')
      observed.indicator = indicator === null || track === null
        ? null
        : { width: indicator.getBoundingClientRect().width, track: track.getBoundingClientRect().width }
      await openSheet()
      const head = sheetList()?.querySelector('.gp-repolist__head') ?? null
      observed.sheet = {
        open: document.querySelector('.gp-sheet') !== null,
        listPresent: sheetList() !== null,
        // The list precedes the branch tree inside the sheet body.
        leadsBody: sheetList() !== null && sheetList().parentElement?.classList.contains('gp-sheet__body') === true
          && sheetList().parentElement.firstElementChild === sheetList(),
        collapsed: head === null ? null : head.getAttribute('aria-expanded') === 'false',
      }
      await expandSheetRepos()
      observed.sheet.rows = sheetRows()
      const mark = calls.length
      pickSheetRow('site')
      await wait(700)
      observed.afterPick = {
        activeTab: activeTabLabel(),
        sheetOpen: document.querySelector('.gp-sheet') !== null,
        collapsed: document.querySelector('.gp-sheet .gp-repolist__head')?.getAttribute('aria-expanded') === 'false',
        selected: textOf(document.querySelector('.gp-sheet .gp-repolist') ?? document.body, '.gp-repolist__selected'),
        calls: calls.slice(mark),
      }
      await expandSheetRepos()
      observed.afterPick.rows = sheetRows()
      // The compact changes page docks no list: the overview's filter owns it.
      document.querySelector('.gp-sheet__close')?.click()
      await wait(200)
      clickTab('tab.changesShort')
      await wait(300)
      observed.changesList = document.querySelector('.gp-panel .gp-changes .gp-repolist') !== null
      return { observed, calls }
    }
    if (action === 'worktree') {
      // The mixed workspace: one family of checkouts (main + worktrees, two of
      // them disabled) plus unrelated repositories. Nothing to navigate for a
      // clean checkout, but the list lives in the overview either way.
      if (activeTabLabel() !== 'tab.overview') {
        clickTab('tab.overview')
        await wait(300)
      }
      await expandRepos()
      observed.groups = groupInfo()
      observed.rows = listRows()
      // A disabled row must be inert: no request, no switch, no tab jump.
      let mark = calls.length
      pickRow('.gp-repolist__item', 'gone')
      await wait(400)
      observed.disabledTap = {
        switching: switchingNow(),
        active: listRows().map((row) => row.active),
        snapshots: calls.slice(mark).filter((call) => call.endpoint === 'gitPanel/snapshot'),
      }
      // A worktree pick rides every repository-scoped request, exactly like a
      // nested repository pick does.
      mark = calls.length
      pickRow('.gp-repolist__item', 'sidebar')
      await wait(700)
      observed.afterPick = {
        activeTab: activeTabLabel(),
        rows: listRows(),
        switching: switchingNow(),
        calls: calls.slice(mark),
      }
      // …and the way back works the same: the workspace checkout sends no tag.
      mark = calls.length
      pickRow('.gp-repolist__item', 'fixture-repo')
      await wait(700)
      observed.afterBack = { activeTab: activeTabLabel(), rows: listRows(), calls: calls.slice(mark) }
      // Every pick retired the block; the post-script hover probe needs rows
      // on screen, so reopen it — state only, no assertions read it after.
      await expandRepos()
      return { observed, calls }
    }
    if (action === 'compact-groups') {
      // The compact sheet carries the same grouped rows as the overview: two
      // families split it into sections, and the disabled rows keep their
      // reason instead of dying.
      observed.layout = document.querySelector('.gp-panel').getAttribute('data-layout')
      clickTab('tab.changesShort')
      await wait(300)
      observed.changesList = document.querySelector('.gp-panel .gp-changes .gp-repolist') !== null
      clickTab('tab.overviewShort')
      await wait(300)
      await openSheet()
      await expandSheetRepos()
      observed.activeTab = activeTabLabel()
      observed.groups = sheetGroups()
      observed.rows = sheetRows()
      const mark = calls.length
      pickSheetRow('gone')
      await wait(400)
      observed.disabledTap = {
        active: sheetRows().map((row) => row.active),
        snapshots: calls.slice(mark).filter((call) => call.endpoint === 'gitPanel/snapshot'),
      }
      // The sheet stays open with the rows on screen for the hover probe.
      return { observed, calls }
    }
    if (action === 'reject') {
      // The pick names a checkout the host can no longer resolve: the sample
      // comes back as invalid-repo, and the panel has to return to the cwd
      // checkout instead of leaving every pane on an error page. The empty
      // slot is sampled while the repair runs, so the copy it used is known.
      const empties = []
      const sampleEmpty = () => {
        const node = document.querySelector('.gp-panel .gp-empty')
        const text = node === null ? '' : node.textContent.trim()
        if (text !== '' && !empties.includes(text)) empties.push(text)
      }
      const mark = calls.length
      await expandRepos()
      pickRow('.gp-repolist__item', 'site')
      for (let i = 0; i < 50; i += 1) { sampleEmpty(); await wait(24) }
      sampleEmpty()
      observed.rejected = {
        activeTab: activeTabLabel(),
        rows: listRows(),
        empties: empties.slice(),
        calls: calls.slice(mark),
      }
      return { observed, calls }
    }
    if (action === 'files-only') {
      // No interaction yet: the default entered the first sub-repository, the
      // block boots collapsed naming it, and the list has no workspace-root row.
      observed.snapshotTags = calls.filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo)
      observed.optionRows = listRows().map((row) => row.name)
      observed.statusAfterPick = textOf(document, '.gp-panel .gp-files__statusbar .gp-files__status-code')
      // Boot, before any interaction: the collapsed block keeps its path line
      // behind [hidden], and the files page itself carries no repository entry.
      const bootRoot = document.querySelector('.gp-panel .gp-repolist__root')
      observed.rootHiddenAtBoot = bootRoot !== null && getComputedStyle(bootRoot).display === 'none'
      observed.filesEntries = document.querySelectorAll('.gp-panel .gp-files .gp-repolist').length
      // The expanded block's absolute path line: click-to-copy with ✓ (1.6 s).
      await expandRepos()
      observed.afterExpand = headInfo()
      observed.rootLine = textOf(document, '.gp-panel .gp-repolist__root')
      const shownRoot = document.querySelector('.gp-panel .gp-repolist__root')
      observed.rootShownAfterExpand = shownRoot !== null && getComputedStyle(shownRoot).display !== 'none'
      armClipboard('__copiedRoot')
      const rootBtn = document.querySelector('.gp-panel .gp-repolist__root')
      if (rootBtn !== null) rootBtn.click()
      await wait(80)
      observed.rootLineCopy = window.__copiedRoot
      observed.rootLineCopiedClass = document.querySelector('.gp-panel .gp-repolist__root')?.classList.contains('gp-repolist__root--copied') ?? false
      // The remembered pick holds; a re-fired default would sample the root again.
      const steadyMark = calls.length
      await wait(700)
      observed.steady = {
        head: headInfo(),
        newSnapshotTags: calls.slice(steadyMark).filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo),
      }
      // Tabs / status bar / repository rows, read for either landing state.
      observed.state = {
        tabs: tabLabels(),
        activeTab: activeTabLabel(),
        tabCount: document.querySelector('.gp-panel .gp-tabbar').getAttribute('data-tab-count'),
        statusbar: statusbarInfo(),
        switching: switchingNow(),
        repoRows: document.querySelectorAll('.gp-panel .gp-repolist__item').length,
      }
      // The status bar path: with several candidate roots the click opens the
      // dropdown instead of copying, and the copy entry inside it does the
      // copying; with one root the click still writes straight through.
      armClipboard('__copiedStatus')
      const statusBtn = document.querySelector('.gp-panel .gp-files__status-path')
      if (statusBtn !== null) statusBtn.click()
      await wait(120)
      observed.statusMenuOpen = document.querySelector('.gp-panel .gp-files__rootmenu') !== null
      if (observed.statusMenuOpen) await clickRootItem('files.copyRootMenu')
      observed.statusPathCopy = window.__copiedStatus
      observed.statusPathCopiedClass = document.querySelector('.gp-panel .gp-files__status-path')?.classList.contains('gp-files__status-path--copied') ?? false
      return { observed, calls }
    }
    if (action === 'fold-on-pick') {
      // collapseReposOnPick is on: a pick folds the block, a repeat pick of
      // the checkout in use is no switch and leaves it open.
      if (activeTabLabel() !== 'tab.overview') {
        clickTab('tab.overview')
        await wait(300)
      }
      await expandRepos()
      observed.opened = headInfo()
      pickRow('.gp-repolist__item', 'site')
      await wait(700)
      observed.afterPick = { head: headInfo(), rows: listRows() }
      await expandRepos()
      pickRow('.gp-repolist__item', 'site')
      await wait(300)
      observed.afterRepeat = headInfo()
      return { observed, calls }
    }
    if (action === 'probe') {
      // The switch flips mid-run: the next polled snapshot carries the flag and
      // the list re-answers itself — no page switch, no reload.
      if (activeTabLabel() !== 'tab.overview') {
        clickTab('tab.overview')
        await wait(300)
      }
      observed.rowsBefore = listRows().map((row) => row.name)
      const mark = calls.length
      probe.off = true
      for (let i = 0; i < 80 && listRows().length >= 2; i += 1) await wait(50)
      await wait(400)
      observed.probeOff = {
        rows: listRows().map((row) => row.name),
        headPresent: headInfo().present,
        repoListCalls: calls.slice(mark).filter((call) => call.kind === 'repo-list').length,
        lastSnapshotTag: calls.filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo).at(-1),
      }
      return { observed, calls }
    }
    if (action === 'probe-files-pin') {
      // The browser is pinned to a checkout when the probe switch goes off: the
      // checkout leaves the list, so the pin is repaired back to the default
      // root instead of leaving the address blank over the old tree.
      clickTab('tab.files')
      await wait(400)
      await openRootMenu()
      await clickRootItem('site')
      await wait(700)
      observed.pinned = { status: statusbarInfo(), menu: rootMenuInfo() }
      const mark = calls.length
      probe.off = true
      for (let i = 0; i < 80 && statusbarInfo().path !== 'fixture-repo'; i += 1) await wait(50)
      await wait(400)
      const dirLists = calls.slice(mark).filter((call) => call.kind === 'dir-list')
      observed.afterProbeOff = { status: statusbarInfo(), menu: rootMenuInfo(), lastDirListTag: dirLists.length === 0 ? null : dirLists.at(-1).repo }
      return { observed, calls }
    }
    if (action === 'changes-bar') {
      // The changes column docks the same list as the overview: same rows, one
      // collapse state read from either side.
      if (activeTabLabel() !== 'tab.overview') { clickTab('tab.overview'); await wait(300) }
      await expandRepos()
      observed.overviewHead = headInfo()
      clickTab('tab.changes')
      await wait(300)
      observed.changesBar = {
        present: visibleList() !== null,
        inChangesColumn: !!(document.querySelector('.gp-panel .gp-changes__left')?.contains(visibleList())),
        head: headInfo(),
        rows: listRows(),
      }
      // A pick from this column must not navigate away: the same list lives
      // here, so the switch happens in place on the changes page.
      const collapse = visibleList()?.querySelector('.gp-repolist__head')
      if (collapse !== null && collapse !== undefined && collapse.getAttribute('aria-expanded') === 'true') {
        collapse.click()
        await wait(200)
      }
      observed.changesBar.afterCollapse = headInfo()
      clickTab('tab.overview')
      await wait(300)
      observed.changesBar.overviewAfter = headInfo()
      // Back on the changes column for the in-place pick: reopen the block so
      // the pick comes from an on-screen row — it then retires the block it
      // left behind, without navigating anywhere.
      clickTab('tab.changes')
      await wait(300)
      await expandRepos()
      const pickMark = calls.length
      const pickList = visibleList()
      const siteRow = pickList === null ? null : [...pickList.querySelectorAll('.gp-repolist__item')]
        .find((node) => textOf(node, '.gp-repolist__name') === 'site')
      if (siteRow === null || siteRow === undefined) throw new Error('no site row in the changes column list')
      // Park the new sample: the old checkout's rows stay on screen while every
      // request is already tagged with the new one, so they must not act.
      fixture.holdSnapshot = true
      siteRow.click()
      await wait(250)
      const body = document.querySelector('.gp-panel .gp-body')
      const stageBtn = document.querySelector('.gp-panel .gp-changes__left .gp-file-row__actions .gp-icon-btn')
      const box = stageBtn?.getBoundingClientRect()
      const hit = box === undefined ? null : document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      stageBtn?.focus()
      observed.changesBar.midSwitch = {
        switching: switchingNow(),
        stageShown: stageBtn !== null,
        inert: body?.hasAttribute('inert') ?? false,
        busy: body?.getAttribute('aria-busy') ?? null,
        stageHit: hit !== null && stageBtn !== null && stageBtn.contains(hit),
        stageFocus: stageBtn !== null && document.activeElement === stageBtn,
      }
      if (typeof fixture.releaseSnapshot === 'function') fixture.releaseSnapshot()
      fixture.holdSnapshot = false
      await wait(700)
      observed.changesBar.afterPick = {
        activeTab: activeTabLabel(),
        switching: switchingNow(),
        expanded: headInfo().expanded,
        scoped: calls.slice(pickMark).filter((call) => call.endpoint === 'gitPanel/snapshot'),
        inert: document.querySelector('.gp-panel .gp-body')?.hasAttribute('inert') ?? null,
      }
      return { observed, calls }
    }
    if (action === 'files-root') {
      // Follow off (the default): the browser stays at the project root across
      // a repository switch and keeps the tree it was showing. The address
      // still carries the candidate-root dropdown — the config only sets the
      // default — so this session can opt into following from there.
      clickTab('tab.files')
      await wait(400)
      observed.boot = { status: statusbarInfo(), menu: rootMenuInfo(), tree: treeText() }
      await openRootMenu()
      observed.menuOpen = rootMenuInfo()
      armClipboard('__copiedStatus')
      await clickRootItem('files.copyRootMenu')
      observed.boot.copy = window.__copiedStatus
      await expandTree('src')
      observed.boot.treeAfterExpand = treeText()
      clickTab('tab.overview')
      await wait(250)
      await expandRepos()
      pickRow('.gp-repolist__item', 'site')
      await wait(700)
      clickTab('tab.files')
      await wait(400)
      observed.afterSwitch = {
        status: statusbarInfo(),
        tree: treeText(),
        snapshotTags: calls.filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo),
      }
      // File properties describe the browser's files: the path hangs off the
      // browse root, and the Git facts belong to the followed checkout only
      // while the browser is rooted in it.
      const readProps = async () => {
        const row = [...document.querySelectorAll('.gp-panel .gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes('a.txt'))
        row?.click()
        await wait(350)
        document.querySelector('.gp-panel .gp-files__props[aria-label="files.propsTitle"]')?.click()
        await wait(150)
        const absRow = [...document.querySelectorAll('.gp-props__row')].find((r) => r.querySelector('.gp-props__label')?.textContent === 'files.propsAbsPath')
        const out = {
          opened: document.querySelector('.gp-props__statusbar') !== null,
          abs: absRow?.querySelector('.gp-props__copy')?.textContent ?? null,
          badges: [...document.querySelectorAll('.gp-props__badge')].map((b) => b.textContent),
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await wait(150)
        return out
      }
      observed.afterSwitch.props = await readProps()
      // The override: pick the follow row and this session tracks the switch
      // the config default kept it out of.
      await openRootMenu()
      await clickRootItem('files.rootFollowGit')
      observed.afterFollow = { status: statusbarInfo() }
      await openRootMenu()
      observed.afterFollow.menuOpen = rootMenuInfo()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await wait(400)
      observed.afterFollow.props = await readProps()
      return { observed, calls }
    }
    if (action === 'files-root-follow') {
      // Follow on: the address becomes the candidate-root dropdown; a manual
      // pick sticks across repository switches until the follow row takes it
      // back.
      clickTab('tab.files')
      await wait(400)
      observed.boot = { status: statusbarInfo(), menu: rootMenuInfo() }
      await openRootMenu()
      observed.menuOpen = rootMenuInfo()
      await clickRootItem('files.rootProject')
      observed.afterPick = { status: statusbarInfo(), menu: rootMenuInfo() }
      await openRootMenu()
      observed.afterPick.menuOpen = rootMenuInfo()
      clickTab('tab.overview')
      await wait(250)
      await expandRepos()
      pickRow('.gp-repolist__item', 'web (apps/web)')
      await wait(700)
      clickTab('tab.files')
      await wait(400)
      observed.afterGitSwitch = {
        status: statusbarInfo(),
        lastSnapshotTag: calls.filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo).at(-1),
      }
      await openRootMenu()
      observed.menuAfterSwitch = rootMenuInfo()
      await clickRootItem('files.rootFollowGit')
      observed.afterResume = { status: statusbarInfo(), menu: rootMenuInfo() }
      return { observed, calls }
    }
    if (action === 'files-root-flip') {
      // A config flip rides the polled sample: off clears every override and
      // parks the browser on the project root — the dropdown stays, the config
      // only re-arms the default; back on, the unchosen session follows again.
      clickTab('tab.files')
      await wait(400)
      await openRootMenu()
      await clickRootItem('site')
      observed.beforeFlip = { status: statusbarInfo(), menu: rootMenuInfo() }
      window.__gpFollow(false)
      for (let i = 0; i < 80 && statusbarInfo().path !== 'fixture-repo'; i += 1) await wait(50)
      observed.afterOff = { status: statusbarInfo(), menu: rootMenuInfo() }
      clickTab('tab.overview')
      await wait(250)
      await expandRepos()
      pickRow('.gp-repolist__item', 'site')
      await wait(700)
      clickTab('tab.files')
      await wait(400)
      observed.afterGitSwitch = { status: statusbarInfo() }
      window.__gpFollow(true)
      for (let i = 0; i < 80 && statusbarInfo().path !== 'fixture-repo/site'; i += 1) await wait(50)
      await wait(300)
      await openRootMenu()
      observed.afterOn = { status: statusbarInfo(), menu: rootMenuInfo() }
      return { observed, calls }
    }
    if (action === 'files-root-cold-mount') {
      // Follow on. This session parks its browser on the project root, then the
      // panel follows another checkout, so the override is what keeps the root.
      // A second panel for a session whose controller is cold reads the same
      // config value for the first time: that is no flip, and this session's
      // override must survive it.
      clickTab('tab.files')
      await wait(400)
      await openRootMenu()
      await clickRootItem('files.rootProject')
      await wait(400)
      clickTab('tab.overview')
      await wait(250)
      await expandRepos()
      pickRow('.gp-repolist__item', 'site')
      await wait(700)
      clickTab('tab.files')
      await wait(400)
      observed.pinned = { status: statusbarInfo() }
      const second = document.createElement('div')
      second.style.cssText = 'width:900px;height:600px'
      document.body.appendChild(second)
      window.ReactDOM.createRoot(second).render(view.component({ sessionId: 'sess-2' }))
      await wait(900)
      observed.secondMounted = second.querySelector('.gp-panel') !== null
      clickTab('tab.overview')
      await wait(250)
      clickTab('tab.files')
      await wait(400)
      observed.afterColdMount = { status: statusbarInfo() }
      await openRootMenu()
      observed.afterColdMount.menu = rootMenuInfo()
      return { observed, calls }
    }
    if (action === 'files-root-git') {
      // A browse-root pick is a directory switch: when the root is a checkout,
      // Git switches with it while the browser stays in front. The reverse
      // stays the follow setting's call (off here: the browser keeps its root).
      const snapTags = (from) => calls.slice(from).filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo ?? '')
      clickTab('tab.files')
      await wait(400)
      let mark = calls.length
      await openRootMenu()
      await clickRootItem('site')
      await wait(700)
      observed.afterSitePick = { activeTab: activeTabLabel(), status: statusbarInfo(), switching: switchingNow(), tags: snapTags(mark) }
      clickTab('tab.overview')
      await wait(300)
      observed.afterSitePick.overviewSelected = headInfo().selected
      clickTab('tab.files')
      await wait(300)
      mark = calls.length
      await openRootMenu()
      await clickRootItem('files.rootProject')
      await wait(700)
      observed.afterProjectPick = { activeTab: activeTabLabel(), status: statusbarInfo(), tags: snapTags(mark) }
      clickTab('tab.overview')
      await wait(300)
      observed.afterProjectPick.overviewSelected = headInfo().selected
      await expandRepos()
      mark = calls.length
      pickRow('.gp-repolist__item', 'site')
      await wait(700)
      clickTab('tab.files')
      await wait(400)
      observed.afterGitPick = { status: statusbarInfo(), tags: snapTags(mark) }
      mark = calls.length
      await openRootMenu()
      await clickRootItem('files.rootFollowGit')
      await wait(500)
      observed.afterFollow = { status: statusbarInfo(), tags: snapTags(mark) }
      return { observed, calls }
    }
    if (action === 'inspect') {
      // The track must keep one width whichever tab is selected: the selected
      // label turns bold, and the cells size to the widest label.
      const track = document.querySelector('.gp-panel .gp-tabbar__tabs')
      observed.trackWidths = []
      for (const label of tabLabels()) {
        clickTab(label)
        await wait(150)
        observed.trackWidths.push(track.getBoundingClientRect().width)
      }
    }
    if (action !== 'switch') return { observed, calls }

    // Park the sample the pick triggers, so the in-flight state can be read
    // before the new snapshot replaces the old one.
    let mark = calls.length
    fixture.holdSnapshot = true
    await expandRepos()
    observed.afterExpand = headInfo()
    pickRow('.gp-repolist__item', 'site')
    await wait(250)
    observed.duringSwitch = {
      switching: switchingNow(),
      badge: textOf(document.querySelector('.gp-panel .gp-tabbar'), '.gp-tabbar__switching'),
      inLeftColumn: listInLeftColumn(),
      rows: listRows(),
      tabCount: document.querySelector('.gp-panel .gp-tabbar').getAttribute('data-tab-count'),
    }
    if (typeof fixture.releaseSnapshot === 'function') fixture.releaseSnapshot()
    fixture.holdSnapshot = false
    await wait(700)
    observed.afterNested = {
      activeTab: activeTabLabel(), tabs: tabLabels(), inLeftColumn: listInLeftColumn(),
      rows: listRows(), switching: switchingNow(), calls: calls.slice(mark),
      head: headInfo(),
    }
    // A cwd without a checkout of its own lists no workspace row to return to;
    // the pick is the last step there.
    if (listRows().some((row) => row.name === 'fixture-repo')) {
      // The workspace was read moments ago, so the way back replays its sample:
      // no dimming while the calibrating read is parked, and no sub-query until
      // that read lands.
      mark = calls.length
      fixture.holdSnapshot = true
      // Any frame of dimming counts, not only the state 250 ms later.
      let dimmed = false
      const panelNode = document.querySelector('.gp-panel')
      const watch = new MutationObserver(() => { if (switchingNow()) dimmed = true })
      watch.observe(panelNode, { attributes: true, attributeFilter: ['data-repo-switching'] })
      pickRow('.gp-repolist__item', 'fixture-repo')
      await wait(250)
      watch.disconnect()
      observed.backDuring = { switching: dimmed || switchingNow(), rows: listRows(), calls: calls.slice(mark) }
      if (typeof fixture.releaseSnapshot === 'function') fixture.releaseSnapshot()
      fixture.holdSnapshot = false
      await wait(600)
      observed.afterBack = { activeTab: activeTabLabel(), rows: listRows(), calls: calls.slice(mark) }
    }
    return { observed, calls }
  }, { snap: snapUsed, repos, action, snapshotFails, scene, probeToggle: options.probeToggle === true, taggedRoot: options.taggedRoot === true, followActive: options.follow === 'on' || options.follow === 'flip', followOn: options.follow === 'on' || options.follow === 'flip' })
  // A row's hover tip needs a real pointer, so the probe runs after the page
  // script finished and before the page goes away; failures stay out of the
  // scene's own try/catch.
  let hover = null
  if (typeof options.hoverProbe === 'function') {
    try { hover = await options.hoverProbe(page) } catch (error) { hover = { error: String(error) } }
  }
  await page.close()
  return { out, errors, hover }
}

/**
 * Hover one repository row with a real pointer and read the fast tip it
 * raises: the actual bubble text, its portal, and that leaving the row takes
 * the bubble away. `exit` names a tip-free element to move onto next.
 */
async function hoverRowTip(page, rowSelector, nameSelector, name, exit) {
  const row = page.locator(rowSelector + ':visible', { has: page.locator(nameSelector, { hasText: name }) })
  await row.hover()
  await page.waitForFunction(() => document.querySelector('.gp-tip') !== null)
  // Structured rows tip: icon-led lines with a hairline above the path, so the
  // probe reads the shape — plain textContent would concatenate the lines.
  const shape = await page.locator('.gp-tip').evaluate((tip) => {
    const lineInfo = [...tip.querySelectorAll('.gp-tip__line')].map((node) => ({
      text: node.textContent,
      kind: ['reason', 'branch', 'path'].find((key) => node.classList.contains('gp-tip__line--' + key)) ?? '',
    }))
    return {
      lines: lineInfo.map((line) => line.text),
      kinds: lineInfo.map((line) => line.kind),
      icons: tip.querySelectorAll('.gp-tip__ic svg').length,
      seps: tip.querySelectorAll('.gp-tip__sep').length,
      onBody: tip.parentElement === document.body,
    }
  })
  await page.locator(exit).hover()
  await page.waitForFunction(() => document.querySelector('.gp-tip') === null)
  return { ...shape, gone: true }
}

const failures = []

// 1. A host that cannot answer the scan: the panel keeps its three panes, no
// list, and never tags a request.
{
  const { out, errors } = await mount([], 'inspect')
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    assert.deepEqual(out.observed.tabs, ['tab.overview', 'tab.changes', 'tab.files'], 'no scan result means no repository list')
    assert.equal(out.observed.tabCount, '3', 'the bar reports its three tabs')
    assert.equal(out.observed.inLeftColumn, false, 'nothing to list')
    assert.ok(out.calls.length > 0, 'the panel still asked for a snapshot')
    assert.ok(out.calls.some((call) => call.endpoint === 'gitPanel/snapshot'), 'the panel sampled the checkout')
    assert.ok(out.calls.every((call) => call.repo === ''), 'a single checkout never tags requests')
    assert.equal(out.observed.trackWidths.length, 3, 'every tab was selected once')
    assert.ok(Math.max(...out.observed.trackWidths) - Math.min(...out.observed.trackWidths) < 0.5, 'the tab track keeps its width whichever tab is selected: ' + JSON.stringify(out.observed.trackWidths))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('scan-less observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 2. A lone checkout: there is nothing to pick between, so the bar stays at
// three tabs and the overview shows no list at all.
{
  const { out, errors } = await mount([WORKSPACE_REPO], 'inspect', { dirty: true })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.tabs, ['tab.overview', 'tab.changes', 'tab.files'], 'one checkout needs no tab')
    assert.equal(seen.inLeftColumn, false, 'and no list either')
    assert.deepEqual(seen.rows, [], 'no rows are rendered')
    assert.ok(out.calls.some((call) => call.endpoint === 'gitPanel/snapshot'), 'the panel sampled the checkout')
    assert.ok(out.calls.every((call) => call.repo === ''), 'nothing is tagged while only one checkout exists')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('single-checkout observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 3. A workspace plus nested checkouts: the list rides in the overview's left
// column, and a pick moves the requests without leaving that page.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO, DEEP_REPO], 'switch', { dirty: true })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.tabs, ['tab.overview', 'tab.changes', 'tab.files'], 'the list needs no tab of its own')
    assert.equal(seen.inLeftColumn, true, 'the list sits in the overview left column')
    assert.equal(seen.head.expanded, false, 'the list block boots collapsed')
    assert.equal(seen.head.selected, 'fixture-repo', 'the collapsed head names the checkout in use')
    assert.equal(seen.afterExpand.expanded, true, 'the toggle expands the block')
    assert.deepEqual(seen.rows.map((row) => row.name), ['fixture-repo', 'site', 'web (apps/web)'], 'every checkout is listed')
    assert.deepEqual(seen.rows.map((row) => row.active), [true, false, false], 'the workspace checkout starts checked')
    assert.equal(seen.repoBarPresent, false, 'the wide overview carries no stacked checkout bar')
    assert.equal(seen.rows[1].meta, 'site', 'a first-level row states its path like every other row')
    assert.equal(seen.rows[2].meta, 'apps/web', 'a nested row carries its relative path')
    assert.equal(seen.rows[0].current, 'true')
    assert.ok(seen.rows[0].branch.includes('main'), 'the checked row reports its branch on the name line: ' + seen.rows[0].branch)
    assert.equal(seen.rows[0].count, '2', 'and how many files are pending')
    // `repo-list` is the one query that spans the whole workspace — it has to
    // stay untagged, or the list could not offer the checkouts it switches
    // between.
    const scoped = (calls) => calls.filter((call) => call.kind !== 'repo-list')
    const nestedCalls = seen.afterNested.calls
    // The switch never blanks the panel: the previous sample stays up, dimmed,
    // with a badge naming the reason, and the list keeps its rows.
    assert.equal(seen.duringSwitch.switching, true, 'the switch is announced instead of collapsing the panel')
    assert.equal(seen.duringSwitch.badge, 'repo.switching', 'the tab bar names the reason')
    assert.equal(seen.duringSwitch.inLeftColumn, true, 'the list never leaves the column mid-switch')
    assert.equal(seen.duringSwitch.tabCount, '3', 'and the tabs stay mounted')
    assert.deepEqual(seen.duringSwitch.rows.map((row) => row.active), [false, true, false], 'the picked row is checked immediately')
    assert.equal(seen.afterNested.activeTab, 'tab.overview', 'picking a checkout stays on the overview')
    assert.equal(seen.afterNested.inLeftColumn, true, 'the list stays on screen while the panes reload')
    assert.equal(seen.afterNested.switching, false, 'the badge clears once the new sample lands')
    assert.deepEqual(seen.afterNested.rows.map((row) => row.active), [false, true, false], 'the list marks the checkout the panes act on')
    assert.equal(seen.afterNested.head.expanded, true, 'the pick leaves the block open: the next switch stays one click away')
    assert.ok(nestedCalls.some((call) => call.endpoint === 'gitPanel/snapshot'), 'the switch refetched a snapshot')
    // The scan answers "which repositories does this cwd offer", not "which one
    // is picked": a switch must not walk the tree again for an answer that has
    // already arrived.
    assert.equal(nestedCalls.filter((call) => call.kind === 'repo-list').length, 0, 'a switch does not re-scan the workspace')
    assert.ok(scoped(nestedCalls).every((call) => call.repo === 'site'), 'every repository-scoped request carries the picked checkout: ' + JSON.stringify(nestedCalls))
    assert.equal(seen.backDuring.switching, false, 'a checkout read moments ago turns the page without dimming')
    assert.equal(seen.backDuring.rows[0].active, true, 'the replayed sample checks the workspace row at once')
    assert.deepEqual(scoped(seen.backDuring.calls).map((call) => call.endpoint), ['gitPanel/snapshot'], 'the replay starts no sub-query before the calibrating sample lands: ' + JSON.stringify(seen.backDuring.calls))
    assert.equal(seen.afterBack.activeTab, 'tab.overview', 'switching back stays on the overview')
    assert.deepEqual(seen.afterBack.rows.map((row) => row.active), [true, false, false], 'and marks the workspace checkout again')
    assert.ok(scoped(seen.afterBack.calls).some((call) => call.endpoint === 'gitPanel/snapshot'), 'the way back samples the workspace again: ' + JSON.stringify(seen.afterBack.calls))
    assert.ok(scoped(seen.afterBack.calls).every((call) => call.repo === ''), 'the workspace checkout sends no tag: ' + JSON.stringify(seen.afterBack.calls))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('switch observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 4. A workspace directory that is not a checkout, holding two nested
// repositories. Entering one defaults straight in (no click): the three git
// panes come up on their own, the block boots collapsed naming it, and the
// list offers no workspace-root row. Expanding states the checkout's absolute
// path (click-to-copy); the remembered pick keeps every later sample tagged.
{
  const { out, errors } = await mount([NESTED_REPO, DEEP_REPO], 'files-only', { snapshotFails: true, scene: 'S4' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    // The default entered the checkout without any interaction.
    assert.deepEqual(seen.tabs, ['tab.overview', 'tab.changes', 'tab.files'], 'the sub-repository brings the git panes up on its own')
    assert.equal(seen.tabCount, '3', 'the bar reports all three pages')
    assert.equal(seen.activeTab, 'tab.overview', 'and the overview is what opens')
    assert.equal(seen.filesEntries, 0, 'the files page carries no repository entry')
    assert.equal(seen.head.present, true, 'the overview carries the repository block')
    assert.equal(seen.head.expanded, false, 'the block boots collapsed')
    assert.equal(seen.rootHiddenAtBoot, true, 'the collapsed block keeps its path line hidden')
    assert.equal(seen.head.selected, 'site', 'the collapsed head names the checkout in use')
    assert.deepEqual(seen.optionRows, ['site', 'web (apps/web)'], 'the list offers only real checkouts: no workspace-root row')
    const tags = seen.snapshotTags
    assert.ok(tags.includes(''), 'the root was sampled first (and failed): ' + JSON.stringify(tags))
    assert.ok(tags.includes('site'), 'the default then sampled the sub-repository: ' + JSON.stringify(tags))
    assert.equal(seen.statusAfterPick, '/mock', 'the browser stays at the project root (the cwd), not the sampled checkout')
    assert.equal(seen.afterExpand.expanded, true, 'the block expands')
    assert.equal(seen.rootLine, 'fixture-repo/site', 'the expanded block states the checkout root')
    assert.equal(seen.rootShownAfterExpand, true, 'and shows that path line again once expanded')
    assert.equal(seen.rootLineCopy, 'fixture-repo/site', 'clicking the path line writes it to the clipboard')
    assert.equal(seen.rootLineCopiedClass, true, 'and confirms on the button')
    assert.ok(seen.steady.newSnapshotTags.every((tag) => tag === 'site'), 'the default never re-samples the root: ' + JSON.stringify(seen.steady.newSnapshotTags))
    const snapTags = out.calls.filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo)
    assert.ok(!snapTags.slice(snapTags.indexOf('site')).includes(''), 'once the pick landed no sample walks back to the root: ' + JSON.stringify(snapTags))
    assert.equal(seen.steady.head.expanded, true, 'the block stays where it was left')
    assert.equal(seen.state.activeTab, 'tab.overview', 'the panel stays on the overview')
    assert.equal(seen.state.switching, false, 'and settled')
    assert.equal(seen.statusMenuOpen, true, 'several candidate roots make the status path a dropdown even with follow off')
    assert.equal(seen.statusPathCopy, '/mock', 'the menu copy entry writes the project root to the clipboard')
    assert.equal(seen.statusPathCopiedClass, true, 'and confirms on the button')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('non-checkout observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 4b. The same directory with nothing to scan: the browser alone is the page —
// one tab, no repository rows — and the status bar roots itself at the cwd
// (absolute path + refresh, as the tree column's header).
{
  const { out, errors } = await mount([], 'files-only', { snapshotFails: true, scene: 'S4b' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.tabs, ['tab.files'], 'with nothing to scan the browser is the only page')
    assert.equal(seen.activeTab, 'tab.files', 'and that is the page that opens')
    assert.equal(seen.state.tabCount, '1', 'the bar reports the single page')
    assert.equal(seen.head.present, false, 'no list block renders')
    assert.equal(seen.state.repoRows, 0, 'and no repository rows in any form: the browser alone is the page')
    assert.equal(seen.optionRows.length, 0, 'the list offers no rows')
    assert.equal(seen.rootLine, '', 'and states no checkout path')
    assert.equal(seen.rootLineCopy, null, 'nothing was copied')
    assert.equal(seen.state.switching, false, 'the panel settled')
    assert.equal(seen.state.statusbar.present, true, 'the files page carries a status bar')
    assert.equal(seen.state.statusbar.hasPath, true, 'with the browse root on it')
    assert.equal(seen.state.statusbar.path, '/mock', 'the degrade shows the project root it is rooted at (the scan\'s cwd)')
    assert.equal(seen.state.statusbar.refreshInBar, true, 'the refresh control lives in the bar')
    assert.equal(seen.state.statusbar.barInTree, true, 'the bar is the tree column header, not a full-width row on top of the page')
    assert.equal(seen.state.statusbar.precedesRows, true, 'and it stands above the file entries, outside the scrolling list')
    assert.equal(seen.state.statusbar.spansColumnOnly, true, 'the bar only spans the tree column, never the preview side')
    assert.equal(seen.statusMenuOpen, false, 'one candidate root keeps the status path a plain copy button')
    assert.equal(seen.statusPathCopy, '/mock', 'clicking the status path writes the project root to the clipboard')
    assert.equal(seen.statusPathCopiedClass, true, 'and confirms on the button')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('plain-browser observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 5. The compact layout keeps the three-cell bar: the repository list rides
// the branch-filter surface (the bottom sheet on a desktop-sized screen), the
// same block the tight stacked drawer leads with, and a pick stays on the
// overview.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'compact', { panelWidth: 360, viewportWidth: 360 })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.layout, 'compact', 'a 360px panel is the compact layout')
    assert.deepEqual(seen.tabs, ['tab.overviewShort', 'tab.changesShort', 'tab.filesShort'], 'compact grows no repositories tab')
    assert.equal(seen.tabCount, '3', 'and the bar reports three cells')
    assert.ok(seen.indicator !== null, 'the bar draws an indicator')
    assert.ok(Math.abs(seen.indicator.width - (seen.indicator.track - 4) / 3) < 2, 'the indicator takes a third of the track: ' + JSON.stringify(seen.indicator))
    assert.equal(seen.activeTab, 'tab.overviewShort', 'the overview opens first')
    assert.equal(seen.sheet.open, true, 'the branch filter opens its sheet')
    assert.equal(seen.sheet.listPresent, true, 'the sheet carries the repository list')
    assert.equal(seen.sheet.leadsBody, true, 'ahead of the branch tree')
    assert.equal(seen.sheet.collapsed, true, 'collapsed by default, like every docked copy')
    assert.deepEqual(seen.sheet.rows.map((row) => row.name), ['fixture-repo', 'site'], 'every checkout is listed')
    assert.deepEqual(seen.sheet.rows.map((row) => row.active), [true, false], 'the workspace checkout starts checked')
    assert.equal(seen.afterPick.activeTab, 'tab.overviewShort', 'a pick stays on the overview')
    assert.equal(seen.afterPick.sheetOpen, true, 'and leaves the sheet open, like the stacked drawer')
    assert.equal(seen.afterPick.collapsed, false, 'the pick leaves the block open for the next switch')
    assert.equal(seen.afterPick.selected, '', 'an open block names the pick by the checked row, not by a collapsed chip')
    assert.deepEqual(seen.afterPick.rows.map((row) => row.active), [false, true], 'and marks it')
    // `repo-list` is the one query that spans the whole workspace, so it stays
    // untagged; everything else has to follow the pick.
    const scoped = seen.afterPick.calls.filter((call) => call.kind !== 'repo-list')
    assert.ok(scoped.some((call) => call.endpoint === 'gitPanel/snapshot'), 'the pick refetched a snapshot')
    assert.ok(scoped.every((call) => call.repo === 'site'), 'every repository-scoped request carries the pick: ' + JSON.stringify(seen.afterPick.calls))
    assert.equal(seen.changesList, false, 'the compact changes page docks no repository list')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('compact observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 6. A pick the host can no longer resolve (the checkout was deleted, or it
// stopped being a work-tree top) must not strand the panel on an error page:
// the selection falls back to the cwd checkout, the page stays put, and the
// copy never blames a missing git.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'reject', { snapshotFails: 'invalid-repo', scene: 'S6' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.rows.map((row) => row.name), ['fixture-repo', 'site'], 'both checkouts are listed')
    const rejected = seen.rejected
    assert.deepEqual(rejected.rows.map((row) => row.active), [true, false], 'the rejected pick falls back to the workspace checkout')
    assert.equal(rejected.activeTab, 'tab.overview', 'a repair is not a navigation: the page stays')
    assert.equal(rejected.empties.includes('pill.unavailable'), false, 'a stale pick is never reported as a missing git: ' + JSON.stringify(rejected.empties))
    assert.equal(seen.tabCount, '3', 'a rejected pick does not collapse the bar into the browser')
    const tags = rejected.calls.filter((call) => call.endpoint === 'gitPanel/snapshot').map((call) => call.repo)
    assert.ok(tags.includes('site'), 'the rejected pick was sampled: ' + JSON.stringify(tags))
    assert.ok(tags.slice(tags.indexOf('site')).includes(''), 'the workspace checkout was sampled again: ' + JSON.stringify(tags))
    assert.equal(tags[tags.length - 1], '', 'and the panel settles on it: ' + JSON.stringify(tags))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('rejected pick observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 7. A repository family with worktrees beside unrelated repositories: two
// groups with their own headers and counts, the family's branches on every
// row, disabled rows that say why — and are inert — and a worktree pick that
// rides every repository-scoped request like any other checkout.
{
  const { out, errors, hover } = await mount(MIXED_FAMILY, 'worktree', {
    scene: 'S7',
    // Real pointer after the script finished: a worktree row tips branch over
    // path; a disabled row leads with its reason — both replace the native
    // title the rows used to carry.
    hoverProbe: async (page) => ({
      worktree: await hoverRowTip(page, '.gp-repolist__row', '.gp-repolist__name', 'sidebar', '.gp-tabbar'),
      disabled: await hoverRowTip(page, '.gp-repolist__row', '.gp-repolist__name', 'gone', '.gp-tabbar'),
    }),
  })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.groups.titles, ['repos.group.own', 'repos.group.foreign'], 'two families earn two headers')
    assert.deepEqual(seen.groups.labels, ['repos.group.own', 'repos.group.foreign'], 'each group names itself')
    assert.deepEqual(seen.groups.counts, ['2/4', '2'], 'the family header shows choosable/total, the flat one just the total')
    assert.deepEqual(seen.rows.map((row) => row.name), ['fixture-repo', 'sidebar', 'spike', 'gone', 'site', 'web (apps/web)'], 'family rows lead, the workspace follows')
    assert.deepEqual(seen.rows.map((row) => row.branch), ['main', 'feat/sidebar', 'spike', 'old', '', ''], 'every family row prints the branch git reported; foreign rows claim none')
    assert.deepEqual(seen.rows.map((row) => row.disabled), [false, false, true, true, false, false], 'outside and lost directories are visible but unchoosable')
    assert.equal(seen.rows.length, 6, 'four family rows and two foreign rows')
    assert.equal(seen.rows[0].meta, 'repos.mainTag', 'the main work tree declares itself with its badge')
    assert.equal(seen.rows[2].title, '', 'the reason left the native title: the row states it inline')
    assert.equal(seen.rows[2].meta, 'repos.disabled.outside', 'an outside worktree names its reason on the row')
    assert.equal(seen.rows[3].meta, 'repos.disabled.stale', 'a lost directory names its cleanup')
    assert.ok(seen.rows.every((row) => row.title === ''), 'no row carries a native title any more: ' + JSON.stringify(seen.rows.map((row) => row.title)))
    // The fast tip takes over where the native title stood: icon-led branch and
    // absolute root with a hairline between them, portaled to the body, gone
    // when the pointer leaves.
    assert.equal(hover.error, undefined, 'the hover probe ran: ' + hover.error)
    assert.deepEqual(hover.worktree, {
      lines: ['feat/sidebar', 'fixture-repo/.agents/worktrees/feat/sidebar'],
      kinds: ['branch', 'path'], icons: 2, seps: 1, onBody: true, gone: true,
    }, 'hovering a worktree row tips an icon-led branch over the ruled path')
    assert.deepEqual(hover.disabled, {
      lines: ['repos.disabled.stale', 'old', 'fixture-repo/gone'],
      kinds: ['reason', 'branch', 'path'], icons: 2, seps: 1, onBody: true, gone: true,
    }, 'a disabled row leads with its reason (no icon), then branch, then the ruled path')
    // The disabled rows must be inert: no request, no switch, no movement.
    assert.equal(seen.disabledTap.switching, false, 'a disabled row never starts a switch')
    assert.deepEqual(seen.disabledTap.active, [true, false, false, false, false, false], 'the selection does not move')
    assert.deepEqual(seen.disabledTap.snapshots, [], 'and no sample is even requested')
    // The worktree pick rides the wire, exactly like a nested repository pick.
    const scoped = (calls) => calls.filter((call) => call.kind !== 'repo-list')
    assert.ok(scoped(seen.afterPick.calls).length > 0, 'the worktree pick fetched: ' + JSON.stringify(seen.afterPick.calls))
    assert.ok(scoped(seen.afterPick.calls).every((call) => call.repo === '.agents/worktrees/feat/sidebar'), 'every repository-scoped request carries the worktree: ' + JSON.stringify(seen.afterPick.calls))
    assert.equal(seen.afterPick.rows.find((row) => row.name === 'sidebar').active, true, 'the worktree row is checked')
    assert.equal(seen.afterPick.activeTab, 'tab.overview', 'picking a worktree stays on the overview')
    assert.equal(seen.afterPick.switching, false, 'the switch completes')
    assert.ok(scoped(seen.afterBack.calls).some((call) => call.endpoint === 'gitPanel/snapshot'), 'the way back samples the workspace again: ' + JSON.stringify(seen.afterBack.calls))
    assert.ok(scoped(seen.afterBack.calls).every((call) => call.repo === ''), 'the way back sends no tag: ' + JSON.stringify(seen.afterBack.calls))
    assert.equal(seen.afterBack.rows[0].active, true, 'and the workspace checkout is checked again')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('worktree observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 8. The compact sheet carries the same families as the overview list, with
// the disabled rows greyed and their reason on the row — and a tap on one of
// them must be as inert as in the overview.
{
  const { out, errors, hover } = await mount(MIXED_FAMILY, 'compact-groups', {
    panelWidth: 360, viewportWidth: 360, scene: 'S8',
    // The script leaves the sheet open on the expanded list; a disabled row
    // explains itself the same way it does in the overview.
    hoverProbe: async (page) => ({
      goneRow: await hoverRowTip(page, '.gp-sheet .gp-repolist__row', '.gp-repolist__name', 'gone', '.gp-sheet__title'),
    }),
  })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.layout, 'compact', 'a 360px panel is the compact layout')
    assert.deepEqual(seen.tabs, ['tab.overviewShort', 'tab.changesShort', 'tab.filesShort'], 'the bar keeps three cells')
    assert.equal(seen.changesList, false, 'the compact changes page docks no list — the overview filter owns it')
    assert.equal(seen.activeTab, 'tab.overviewShort', 'the sheet opens over the overview')
    assert.deepEqual(seen.groups.titles, ['repos.group.own', 'repos.group.foreign'], 'the list splits into one section per family')
    assert.deepEqual(seen.groups.counts, ['2/4', '2'], 'each section counts its choosable rows')
    assert.deepEqual(seen.rows.map((row) => row.name), ['fixture-repo', 'sidebar', 'spike', 'gone', 'site', 'web (apps/web)'], 'every checkout is listed, family first')
    assert.deepEqual(seen.rows.map((row) => row.disabled), [false, false, true, true, false, false], 'the two disabled worktrees stay visible but dead')
    assert.equal(seen.rows[2].meta, 'repos.disabled.outside', 'an outside worktree states its reason on the row')
    assert.equal(seen.rows[3].meta, 'repos.disabled.stale', 'and a lost one names its cleanup')
    assert.ok(seen.rows.every((row) => row.title === ''), 'no row carries a native title: ' + JSON.stringify(seen.rows.map((row) => row.title)))
    assert.equal(hover.error, undefined, 'the hover probe ran: ' + hover.error)
    assert.deepEqual(hover.goneRow, {
      lines: ['repos.disabled.stale', 'old', 'fixture-repo/gone'],
      kinds: ['reason', 'branch', 'path'], icons: 2, seps: 1, onBody: true, gone: true,
    }, 'a disabled row tips reason, branch and ruled path — portaled, gone on leave')
    assert.deepEqual(seen.disabledTap.active, [true, false, false, false, false, false], 'a tap on a disabled row changes nothing')
    assert.deepEqual(seen.disabledTap.snapshots, [], 'and asks for nothing')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('compact-groups observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 9. The probe switch re-answers the list in place: flipping it off (as the
// config form does) empties the list — one checkout needs no list — and drops
// the stale sub-repository pick, without any page switch or reload.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'probe', { pollMs: 500, probeToggle: true, scene: 'S9' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.deepEqual(seen.rowsBefore, ['fixture-repo', 'site'], 'both checkouts are listed while the probe is on')
    assert.ok(seen.probeOff.repoListCalls > 0, 'the list was re-answered after the flip')
    assert.deepEqual(seen.probeOff.rows, [], 'one checkout needs no list')
    assert.equal(seen.probeOff.headPresent, false, 'the block unmounts with it')
    assert.equal(seen.probeOff.lastSnapshotTag, '', 'the stale sub-repository pick fell back to the workspace')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('probe-toggle observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 9b. The collapseReposOnPick setting folds the block on a pick, handing the
// column back to the branch tree; the default (scene 3) leaves it open.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'fold-on-pick', { foldOnPick: true, scene: 'S9b' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.opened.expanded, true, 'the toggle expands the block')
    assert.deepEqual(seen.afterPick.rows.map((row) => row.active), [false, true], 'the pick switched checkouts')
    assert.equal(seen.afterPick.head.expanded, false, 'the setting folds the block after a pick')
    assert.equal(seen.afterPick.head.selected, 'site', 'the folded head names the picked checkout')
    assert.equal(seen.afterRepeat.expanded, true, 'picking the checkout in use is no switch and leaves the block open')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('fold-on-pick observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 10. The changes column docks the same repository list as the overview: one
// block, one collapse state, the same rows, and a pick from it switches in
// place without navigating to the overview (the compact copy is asserted in
// scenes 5 and 8).
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'changes-bar', { scene: 'S10', dirty: true })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.changesBar.present, true, 'the list is docked in the changes pane')
    assert.equal(seen.changesBar.inChangesColumn, true, 'inside the changes column, not the hidden overview')
    assert.equal(seen.changesBar.head.expanded, true, 'it reads the overview\'s expanded state')
    assert.deepEqual(seen.changesBar.rows.map((row) => row.name), ['fixture-repo', 'site'], 'and the same rows')
    assert.equal(seen.changesBar.afterCollapse.expanded, false, 'collapsing from the changes side lands')
    assert.equal(seen.changesBar.overviewAfter.expanded, false, 'the overview reads the same state back')
    assert.equal(seen.changesBar.midSwitch.switching, true, 'the parked sample keeps the switch in flight')
    assert.equal(seen.changesBar.midSwitch.stageShown, true, 'the previous checkout\'s rows stay on screen')
    assert.equal(seen.changesBar.midSwitch.inert, true, 'but the body is inert while every request already names the next checkout')
    assert.equal(seen.changesBar.midSwitch.busy, 'true', 'and reports itself busy')
    assert.equal(seen.changesBar.midSwitch.stageHit, false, 'a pointer cannot reach the old stage button')
    assert.equal(seen.changesBar.midSwitch.stageFocus, false, 'nor can the keyboard')
    assert.equal(seen.changesBar.afterPick.inert, false, 'the body is live again once the new sample lands')
    assert.equal(seen.changesBar.afterPick.activeTab, 'tab.changes', 'a pick from the changes column stays on the changes page')
    assert.equal(seen.changesBar.afterPick.switching, false, 'and the switch completes there')
    assert.ok(seen.changesBar.afterPick.scoped.some((call) => call.repo === 'site'), 'the pick reached the wire tagged with the new checkout')
    assert.equal(seen.changesBar.afterPick.expanded, true, 'and the pick leaves the block it came from open')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('changes-bar observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 11. Follow off (the default): the browser roots itself at the project root
// and a repository switch must not move it or reset the tree it shows — but
// the address still carries the candidate-root dropdown, so a session can opt
// into following without touching the config.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'files-root', { taggedRoot: true, scene: 'S11' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.boot.status.path, 'fixture-repo', 'the browser opens at the project root')
    assert.equal(seen.boot.menu.hasPopup, true, 'follow off keeps the dropdown: the config only sets the default')
    assert.equal(seen.menuOpen.open, true, 'the click opens the candidate roots')
    assert.deepEqual(seen.menuOpen.items.map((item) => item.key), ['files.rootFollowGit', 'files.rootProject', 'site', 'files.copyRootMenu'], 'follow row, project root, the checkout, then the copy entry')
    assert.equal(seen.menuOpen.items[1].active, true, 'the default parks the session on the project row')
    assert.equal(seen.menuOpen.items[0].active, false, 'and the follow row is not the source')
    assert.equal(seen.boot.copy, 'fixture-repo', 'the copy entry writes the browse root')
    assert.ok(seen.boot.treeAfterExpand.includes('index.ts'), 'the tree was expanded')
    assert.equal(seen.afterSwitch.status.path, 'fixture-repo', 'a repository switch leaves the browser where it was')
    assert.ok(seen.afterSwitch.tree.includes('index.ts'), 'and does not reset the tree it was showing')
    assert.ok(seen.afterSwitch.snapshotTags.includes('site'), 'the repository switch really happened: ' + JSON.stringify(seen.afterSwitch.snapshotTags))
    assert.equal(seen.afterFollow.status.path, 'fixture-repo/site', 'the follow row opts this session in: the browser re-roots on the switched repository')
    assert.equal(seen.afterFollow.menuOpen.items[0].active, true, 'and the follow row marks the source')
    assert.equal(seen.afterSwitch.props.opened, true, 'properties open on the parked browser')
    assert.equal(seen.afterSwitch.props.abs, 'fixture-repo/a.txt', 'the absolute path hangs off the browse root, not the followed checkout')
    assert.deepEqual(seen.afterSwitch.props.badges, [], 'and the followed checkout\'s Git facts are not claimed for another root')
    assert.equal(seen.afterFollow.props.abs, 'fixture-repo/site/a.txt', 'rooted in the followed checkout, the path follows')
    assert.ok(seen.afterFollow.props.badges.length > 0, 'and its Git facts apply: ' + JSON.stringify(seen.afterFollow.props.badges))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('files-root observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 12. Follow on: the address becomes the candidate-root dropdown; a manual
// pick sticks across a repository switch, and the follow row takes it back.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO, DEEP_REPO], 'files-root-follow', { taggedRoot: true, follow: 'on', scene: 'S12' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.boot.status.path, 'fixture-repo', 'following, the browser starts on the project root')
    assert.equal(seen.boot.menu.hasPopup, true, 'follow on turns the address into a dropdown')
    assert.equal(seen.menuOpen.open, true, 'the click opens the candidate roots')
    assert.deepEqual(seen.menuOpen.items.map((item) => item.key), ['files.rootFollowGit', 'files.rootProject', 'site', 'web', 'files.copyRootMenu'], 'follow row, project root, the checkouts, then the copy entry')
    assert.equal(seen.menuOpen.items[0].active, true, 'following highlights the follow row')
    assert.equal(seen.menuOpen.items[0].selected, 'true', 'as aria-selected')
    assert.equal(seen.menuOpen.items[2].path, 'site', 'a checkout row carries its relative path')
    assert.equal(seen.afterPick.status.path, 'fixture-repo', 'the project-root pick shows the same address…')
    assert.equal(seen.afterPick.menuOpen.items[1].active, true, '…but the manual pick is what the menu marks now')
    assert.equal(seen.afterGitSwitch.status.path, 'fixture-repo', 'a repository switch leaves the manual root alone')
    assert.equal(seen.afterGitSwitch.lastSnapshotTag, 'apps/web', 'while the panel itself follows the new repository')
    assert.equal(seen.menuAfterSwitch.items[0].active, false, 'the follow row is no longer the source')
    assert.equal(seen.afterResume.status.path, 'fixture-repo/apps/web', 'picking Follow Git switches re-roots the browser on the repository')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('files-follow observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 13. A config flip rides the polled sample: off clears every override and
// parks the browser on the project root while the dropdown stays offered;
// back on, the unchosen session follows the switched repository again.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'files-root-flip', { taggedRoot: true, follow: 'flip', pollMs: 500, scene: 'S13' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.beforeFlip.status.path, 'fixture-repo/site', 'the manual pick roots the browser on the checkout')
    assert.equal(seen.afterOff.status.path, 'fixture-repo', 'flipping follow off clears the pick and parks the browser on the project root')
    assert.equal(seen.afterOff.menu.hasPopup, true, 'the dropdown stays: the config only re-arms the default')
    assert.equal(seen.afterGitSwitch.status.path, 'fixture-repo', 'with follow off a repository switch still does not move it')
    assert.equal(seen.afterOn.status.path, 'fixture-repo/site', 'back on, the browser follows the switched repository again')
    assert.equal(seen.afterOn.menu.items[0].active, true, 'the cleared override leaves the follow row as the source')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('files-flip observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls, errors }))
    failures.push(error)
  }
}

// 16. A browser pinned to a checkout that leaves the list (probe switched off)
// returns to the default root: the address stays, the tree re-roots.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'probe-files-pin', { pollMs: 500, probeToggle: true, scene: 'S16' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.pinned.status.path, 'fixture-repo/site', 'the browser is pinned to the checkout')
    assert.equal(seen.afterProbeOff.status.present, true, 'the status bar stays')
    assert.equal(seen.afterProbeOff.status.path, 'fixture-repo', 'the pin is repaired back to the project root')
    assert.equal(seen.afterProbeOff.lastDirListTag, '', 'and the tree re-lists untagged: ' + JSON.stringify(seen.afterProbeOff))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('probe-files-pin observation: ' + JSON.stringify({ observed: out.observed, errors }))
    failures.push(error)
  }
}

// 15. Follow on: a second panel mounting cold reads the config for the first
// time — no flip — so another session's manual root survives it.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'files-root-cold-mount', { taggedRoot: true, follow: 'on', scene: 'S15' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.pinned.status.path, 'fixture-repo', 'the manual project root holds while the panel follows site')
    assert.equal(seen.secondMounted, true, 'a second panel mounted for another session')
    assert.equal(seen.afterColdMount.status.path, 'fixture-repo', 'its first sample is no config flip: the override stays')
    assert.equal(seen.afterColdMount.menu.items[1].active, true, 'and the project row is still the source')
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('files-cold-mount observation: ' + JSON.stringify({ observed: out.observed, errors }))
    failures.push(error)
  }
}

// 14. Git follows every directory switch: a browse-root pick that lands on a
// checkout moves the overview and the changes with it (the browser stays in
// front), the project root counts when it is the cwd's own checkout, while a
// Git pick leaves a parked browser alone and the follow row moves only the
// browser.
{
  const { out, errors } = await mount([WORKSPACE_REPO, NESTED_REPO], 'files-root-git', { taggedRoot: true, scene: 'S14' })
  try {
    assert.equal(out.error, undefined, 'the panel mounted')
    const seen = out.observed
    assert.equal(seen.afterSitePick.activeTab, 'tab.files', 'a root pick keeps the browser in front')
    assert.equal(seen.afterSitePick.status.path, 'fixture-repo/site', 'the browser roots on the checkout')
    assert.ok(seen.afterSitePick.tags.includes('site'), 'and Git samples the same checkout: ' + JSON.stringify(seen.afterSitePick.tags))
    assert.equal(seen.afterSitePick.switching, false, 'the switch completes in place')
    assert.equal(seen.afterSitePick.overviewSelected, 'site', 'the overview list reads the checkout the browser picked')
    assert.equal(seen.afterProjectPick.status.path, 'fixture-repo', 'the project-root pick re-roots the browser')
    assert.ok(seen.afterProjectPick.tags.includes(''), 'and, the project root being the cwd\'s own checkout, Git returns to it: ' + JSON.stringify(seen.afterProjectPick.tags))
    assert.equal(seen.afterProjectPick.overviewSelected, 'fixture-repo', 'the overview list follows')
    assert.ok(seen.afterGitPick.tags.includes('site'), 'a Git pick still switches Git: ' + JSON.stringify(seen.afterGitPick.tags))
    assert.equal(seen.afterGitPick.status.path, 'fixture-repo', 'but leaves the parked browser where it was')
    assert.equal(seen.afterFollow.status.path, 'fixture-repo/site', 'the follow row re-roots the browser on the Git checkout')
    assert.ok(!seen.afterFollow.tags.some((tag) => tag !== 'site'), 'and moves no Git selection: ' + JSON.stringify(seen.afterFollow.tags))
    assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
  } catch (error) {
    console.error('files-root-git observation: ' + JSON.stringify({ observed: out.observed, calls: out.calls.slice(-30), errors }))
    failures.push(error)
  }
}

await browser.close()

if (failures.length > 0) {
  console.error('repo-switcher: ' + failures.length + ' failed')
  for (const failure of failures) console.error(failure)
  process.exit(1)
}
console.log('repo-switcher: ok')
