/**
 * E2E: the repository list on the stacked tiers (right-sidebar seat).
 *
 * `panelMode` only produces `stacked` for a desktop sidebar host, so this runs
 * on the sidebar seat rather than the conversation mount the other switcher
 * runner uses. What is asserted is the design's stacked contract:
 *
 *  - the list rides the top band's left column (above the branch tree) at 420,
 *    capped by the stacked 34% budget with the rows scrolling inside it;
 *  - it boots collapsed (the head line names the checkout) and, expanded, both
 *    checkout families keep their group headers — stacked hides no row by
 *    layout;
 *  - a pick inside the band tags every repository-scoped request, like any
 *    other host;
 *  - at 320 (≤ STACKED_TIGHT_BP) the column — list included — collapses into
 *    the drawer, and a switch made from inside the open drawer leaves it open
 *    (switching several checkouts in a row must not dismiss the list).
 *
 * Fully isolated — a local file:// harness, no dsh server. Requires the e2e
 * fixtures (run test/e2e/setup.mjs first, or `npm run test:e2e`).
 */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const E2E = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(E2E, 'harness.html')

// A clean checkout: the list is what this runner measures.
const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'ba78eb4', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, suggestEnabled: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

// The mixed workspace: a family (main + worktrees, two of them disabled) plus
// one unrelated repository — two groups, six rows, both tiers must show all of
// them.
const REPOS = [
  { path: '', root: 'fixture-repo', name: 'fixture-repo', kind: 'workspace', role: 'main', branch: 'main' },
  { path: '.agents/worktrees/feat/sidebar', root: 'fixture-repo/.agents/worktrees/feat/sidebar', name: 'sidebar', kind: 'nested', role: 'linked', branch: 'feat/sidebar' },
  { path: '../spike', root: '/mock/spike', name: 'spike', kind: 'nested', role: 'linked', branch: 'spike', disabled: 'outside' },
  { path: 'gone', root: 'fixture-repo/gone', name: 'gone', kind: 'nested', role: 'linked', branch: 'old', disabled: 'stale' },
  { path: 'site', root: 'fixture-repo/site', name: 'site', kind: 'nested', role: 'repo' },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 480, height: 980 }, screen: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

await page.goto(harness)
await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await page.addScriptTag({ path: resolve(E2E, 'client.js') })

/** Boot the sidebar seat straight at `width` — the only way to observe the
 * tight tier's default (a pass through a non-tight width resets the drawer). */
const boot = (width) => page.evaluate(async ({ snap, repos, w }) => {
  const { fixture, connection } = window.createGitPanelMock(snap)
  fixture.repos = repos
  // Every repository-scoped request, so the pick can be proven on the wire.
  const calls = []
  const origCall = connection.rpc.call
  connection.rpc.call = async (channel, endpoint, payload) => {
    const request = payload && payload.args && payload.args.request
    calls.push({
      endpoint,
      kind: request && request.query ? request.query.kind : null,
      repo: request && typeof request.repo === 'string' ? request.repo : '',
    })
    return origCall(channel, endpoint, payload)
  }
  window.__calls = calls
  const ctl = { registered: {}, sidebarTypes: [], openedTabs: [] }
  window.__ctl = ctl
  const settings = {
    view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {}, placement: {} } }, value: { showInputPill: true, placement: 'sidebar' } }] },
    status: 'ready',
  }
  const configForms = {
    describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
    get: () => ({
      getSnapshot: () => ({ status: 'ready', value: { showInputPill: true, placement: 'sidebar' }, revision: 0, writable: true }),
      subscribe: () => () => {},
      set: async () => true,
    }),
  }
  const sidebarTabs = {
    register: (definition) => {
      ctl.sidebarTypes.push(definition)
      return () => { const at = ctl.sidebarTypes.indexOf(definition); if (at !== -1) ctl.sidebarTypes.splice(at, 1) }
    },
  }
  const sidebarRight = { openTab: (kind) => { ctl.openedTabs.push(kind) } }

  const services = { connection, configForms, sidebarRightTabs: sidebarTabs, sidebarRight }
  const dictionaries = {}
  const ctx = {
    get: (key) => services[key],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (_name, provider) => provider(),
      register: (reg, component) => {
        const key = reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`
        ctl.registered[key] = { reg, component }
        return () => { delete ctl.registered[key] }
      },
    },
    locale: {
      register: (ns, dict) => { dictionaries[ns] = dict; return () => { delete dictionaries[ns] } },
      bind: (ns) => (key, params) => {
        const text = dictionaries[ns]?.zh?.[key] ?? dictionaries[ns]?.en?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  window.__getLoaded().apply(ctx)
  await new Promise((r) => setTimeout(r, 400))

  const entry = ctl.registered['sidebar.right.pane.tab::@xbzbing/dsh-git-panel']
  if (entry === undefined) throw new Error('sidebar body seat did not register')
  const host = document.getElementById('panel')
  host.style.width = `${w}px`
  host.style.height = '900px'
  window.ReactDOM.createRoot(host).render(entry.component({
    sessionId: 'sess-1',
    useTabInfo: () => ({ tab: { visible: true } }),
    t: (key) => key,
  }))
  await new Promise((r) => setTimeout(r, 800))
}, { snap: SNAP, repos: REPOS, w: width })

const textOf = async (selector) => page.evaluate((sel) => {
  const node = document.querySelector(sel)
  return node === null ? null : node.textContent.trim()
}, selector)

/** Everything about the list that the stacked contract cares about. Scoped to
 * the pane on screen: the changes band docks its own copy of the list, and the
 * hidden pane's nodes must not double the read. */
const probe = () => page.evaluate(() => {
  const panel = document.querySelector('.gp-panel')
  const inVisiblePane = (node) => {
    let el = node
    while (el !== null && el !== document.body) {
      if (el.getAttribute('role') === 'tabpanel' && el.style.display === 'none') return false
      el = el.parentElement
    }
    return true
  }
  const list = [...document.querySelectorAll('.gp-repolist')].find((n) => inVisiblePane(n)) ?? null
  const top = document.querySelector('.gp-overview__top')
  const inline = document.querySelector('.gp-col--left:not(.gp-drawer)')
  const drawer = document.querySelector('.gp-drawer')
  const branchTree = document.querySelector('.gp-col--left .gp-branch-tree, .gp-drawer .gp-branch-tree, .gp-branch-row')
  const scroll = list === null ? null : list.querySelector('.gp-repolist__list')
  const collapse = list === null ? null : list.querySelector('.gp-repolist__head')
  const rows = (list === null ? [] : [...list.querySelectorAll('.gp-repolist__item')]).map((node) => ({
    name: (node.querySelector('.gp-repolist__name') || node).textContent.trim(),
    branch: (node.querySelector('.gp-repolist__branch') || { textContent: '' }).textContent.trim(),
    disabled: node.disabled === true,
    active: node.classList.contains('gp-repolist__item--active'),
  }))
  return {
    layout: panel === null ? null : panel.getAttribute('data-layout'),
    switching: panel === null ? null : panel.getAttribute('data-repo-switching'),
    collapse: collapse === null ? null : {
      expanded: collapse.getAttribute('aria-expanded') === 'true',
      selected: list.querySelector('.gp-repolist__selected')?.textContent.trim() ?? '',
    },
    list: list === null ? null : {
      inTop: top !== null && top.contains(list),
      inInline: inline !== null && inline.contains(list),
      inDrawer: drawer !== null && drawer.contains(list),
      maxHeight: getComputedStyle(list).maxHeight,
      // The collapsed block's row height: the checkout bar mirrors it.
      height: +list.getBoundingClientRect().height.toFixed(2),
      // Above the branch tree: the list is the first block of the column.
      aboveBranches: branchTree === null ? false : (list.compareDocumentPosition(branchTree) & 4) !== 0,
      scrollOverflow: scroll === null ? null : getComputedStyle(scroll).overflow,
    },
    drawer: drawer === null ? null : {
      open: drawer.getAttribute('data-open'),
      inert: drawer.hasAttribute('inert'),
      hasRows: drawer.querySelectorAll('.gp-repolist__item').length,
    },
    groups: {
      titles: [...document.querySelectorAll('.gp-repolist__grouptitle')].filter((n) => inVisiblePane(n)).map((n) => n.textContent.trim()),
      counts: [...document.querySelectorAll('.gp-repolist__groupcount')].filter((n) => inVisiblePane(n)).map((n) => n.textContent.trim()),
    },
    rows,
    activeName: rows.find((row) => row.active)?.name ?? null,
    // The checkout bar above the history search (tight stacked only); the path
    // text carries the invisible LRM prefix, so strip it before comparing.
    repoBar: (() => {
      const bar = document.querySelector('.gp-repobar')
      const search = document.querySelector('.gp-search')
      if (bar === null) return null
      return {
        aboveSearch: search !== null && (bar.compareDocumentPosition(search) & 4) !== 0,
        // The bar mirrors the collapsed repository block's row height.
        height: +bar.getBoundingClientRect().height.toFixed(2),
        path: (bar.querySelector('.gp-repobar__text')?.textContent ?? '').replace(/\u200e/g, '').trim(),
        branch: (bar.querySelector('.gp-repobar__branch')?.textContent ?? '').trim(),
      }
    })(),
    calls: window.__calls.slice(),
  }
})

const pickRow = async (name) => page.evaluate((wanted) => {
  const rows = [...document.querySelectorAll('.gp-repolist__item')]
  const row = rows.find((node) => (node.querySelector('.gp-repolist__name') || node).textContent.trim() === wanted)
  if (!row) throw new Error('no row ' + wanted + ' (have ' + rows.map((n) => n.textContent.trim()).join('|') + ')')
  row.click()
}, name)

const setWidth = async (w) => {
  await page.evaluate((width) => { document.getElementById('panel').style.width = `${width}px` }, w)
  await page.waitForTimeout(400)
}
const settleDrawer = (open) => page.waitForFunction((want) => {
  const drawer = document.querySelector('.gp-drawer')
  if (drawer === null) return false
  const transform = getComputedStyle(drawer).transform
  return want ? transform === 'none' : transform !== 'none' && !transform.endsWith(', 0, 0)')
}, open, { timeout: 3000 })

// ── 420 (stacked, not tight): the list rides the top band's left column. ──
await boot(420)
const booted = await probe()
assert.equal(booted.layout, 'stacked', 'the desktop sidebar stacks below its wide bar')
assert.equal(booted.collapse.expanded, false, 'the list block boots collapsed')
assert.equal(booted.collapse.selected, 'fixture-repo', 'the collapsed head names the checkout in use')
const collapsedBlockHeight = booted.list.height
assert.equal(booted.repoBar, null, 'the band tier drops the checkout bar: the left column already names the checkout')
await page.click('.gp-repolist__head')
await page.waitForTimeout(300)
const inline = await probe()
assert.equal(inline.collapse.expanded, true, 'the toggle expands the block')
assert.ok(inline.list !== null, 'the repository list renders')
assert.equal(inline.list.inTop, true, 'inside the top band')
assert.equal(inline.list.inInline, true, 'and inside the inline left column')
assert.equal(inline.list.aboveBranches, true, 'above the branch tree — the family leads')
assert.equal(inline.list.maxHeight, '34%', 'the stacked tier spends at most 34% of the column: ' + inline.list.maxHeight)
assert.equal(inline.list.scrollOverflow, 'auto', 'and the rows scroll inside their block')
assert.deepEqual(inline.groups.titles, ['工作树', '存储库'], 'two families keep their headers on stacked')
assert.deepEqual(inline.groups.counts, ['2/4', '1'], 'with their choosable/total counts')
assert.deepEqual(inline.rows.map((row) => row.name), ['fixture-repo', 'sidebar', 'spike', 'gone', 'site'], 'stacked hides nothing: every row is on screen')
assert.deepEqual(inline.rows.map((row) => row.disabled), [false, false, true, true, false], 'disabled rows stay disabled here too')

// A pick inside the band tags every repository-scoped request.
const mark = await page.evaluate(() => window.__calls.length)
await pickRow('sidebar')
await page.waitForTimeout(700)
const picked = await probe()
assert.equal(picked.activeName, 'sidebar', 'the worktree row is checked')
assert.equal(picked.list.inTop, true, 'and the list stayed in the band')
const scoped = picked.calls.slice(mark).filter((call) => !(call.endpoint === 'gitPanel/query' && call.kind === 'repo-list'))
assert.ok(scoped.length > 0, 'the pick produced requests: ' + JSON.stringify(picked.calls.slice(mark)))
assert.ok(scoped.every((call) => call.repo === '.agents/worktrees/feat/sidebar'), 'every repository-scoped request carries the worktree: ' + JSON.stringify(picked.calls.slice(mark)))
// A pick leaves the block open (both docked copies share that state), so the
// cross-band read below finds its rows on screen without reopening anything.
assert.equal(picked.collapse.expanded, true, 'a pick leaves the block open for the next switch')

// ── the changes band docks the same list: one block, one collapse state,
// the same rows with the pick still marked (read against the changes pane —
// the overview's copy stays mounted behind display:none). ──
const markTab = await page.evaluate(() => window.__calls.length)
await page.locator('.gp-panel [role="tab"]').filter({ hasText: '变更记录' }).click()
await page.waitForTimeout(300)
const inChanges = await page.evaluate(() => {
  const host = document.querySelector('.gp-changes--stacked')
  const list = host === null ? null : host.querySelector('.gp-repolist')
  const collapse = list === null ? null : list.querySelector('.gp-repolist__head')
  return {
    present: list !== null,
    firstChild: list !== null && list.previousElementSibling === null,
    expanded: collapse === null ? null : collapse.getAttribute('aria-expanded') === 'true',
    rows: list === null ? [] : [...list.querySelectorAll('.gp-repolist__item')].map((node) => ({
      name: (node.querySelector('.gp-repolist__name') || node).textContent.trim(),
      active: node.classList.contains('gp-repolist__item--active'),
    })),
    calls: window.__calls.slice(),
  }
})
assert.equal(inChanges.present, true, 'the changes band docks the repository list')
assert.equal(inChanges.firstChild, true, 'as the band\'s first block')
assert.equal(inChanges.expanded, true, 'sharing the overview band\'s expanded state')
assert.deepEqual(inChanges.rows.map((row) => row.name), ['fixture-repo', 'sidebar', 'spike', 'gone', 'site'], 'and the same rows')
assert.equal(inChanges.rows.find((row) => row.active)?.name, 'sidebar', 'with the pick still marked')
// Opening the changes page loads its own data for the picked checkout only:
// no re-scan of the list, no request that falls back to the workspace.
const tabCalls = inChanges.calls.slice(markTab)
assert.equal(tabCalls.some((call) => call.kind === 'repo-list'), false, 'switching pages does not re-scan the repositories: ' + JSON.stringify(tabCalls))
assert.ok(tabCalls.every((call) => call.repo === '.agents/worktrees/feat/sidebar'), 'whatever the changes page loads is tagged with the pick: ' + JSON.stringify(tabCalls))
await page.locator('.gp-panel [role="tab"]').filter({ hasText: 'Git 总览' }).click()
await page.waitForTimeout(300)

// ── 320 (tight): the column — list included — moves into the drawer. ──
await setWidth(320)
const collapsed = await probe()
assert.equal(collapsed.layout, 'stacked', 'tight is still the stacked tier')
assert.ok(collapsed.drawer !== null, 'the left column becomes a drawer')
assert.equal(collapsed.drawer.open, 'false', 'collapsed by default: the list is reachable, not permanent')
assert.equal(collapsed.drawer.inert, true, 'and inert while collapsed')
assert.equal(collapsed.list.inDrawer, true, 'the repository list collapsed with the column')
assert.equal(collapsed.list.inInline, false, 'no inline copy remains')
assert.ok(collapsed.repoBar !== null, 'the tight tier keeps the checkout bar above the search')
// The bar matches the repository block's collapsed height (the changes column's
// collapsed info bar is the same block with the same CSS).
assert.equal(collapsed.repoBar.height, collapsedBlockHeight, 'the bar matches the collapsed repository block height: ' + collapsed.repoBar.height + ' vs ' + collapsedBlockHeight)
assert.equal(collapsed.repoBar.aboveSearch, true, 'it sits above the search')
assert.equal(collapsed.repoBar.path, 'fixture-repo', 'the bar states the checkout root')
assert.equal(collapsed.repoBar.branch, 'main', 'and the current branch')

await page.click('.gp-toolbar__branches')
await settleDrawer(true)
const opened = await probe()
assert.equal(opened.drawer.open, 'true', 'the toolbar toggle opens the drawer')
assert.equal(opened.drawer.inert, false, 'which is interactive')
assert.equal(opened.list.inDrawer, true, 'the list lives inside the open drawer')
assert.ok(opened.drawer.hasRows >= 5, `every row moved into the drawer (${opened.drawer.hasRows})`)
assert.deepEqual(opened.groups.titles, ['工作树', '存储库'], 'the group headers came along')

// Switching from inside the open drawer must leave it open: cutting the list
// away between two consecutive picks would strand the user (拍板⑥).
const markBack = await page.evaluate(() => window.__calls.length)
await pickRow('fixture-repo')
await page.waitForTimeout(700)
const returned = await probe()
assert.equal(returned.drawer.open, 'true', 'the drawer stays open after the switch')
assert.equal(returned.drawer.inert, false, 'and interactive')
assert.equal(returned.activeName, 'fixture-repo', 'the workspace checkout is checked again')
assert.equal(returned.list.inDrawer, true, 'with the list still inside it')
const backCalls = returned.calls.slice(markBack)
assert.ok(backCalls.some((call) => call.endpoint === 'gitPanel/snapshot' && call.repo === ''), 'the way back was sampled in the workspace checkout: ' + JSON.stringify(backCalls))
assert.ok(backCalls.filter((call) => !(call.endpoint === 'gitPanel/query' && call.kind === 'repo-list')).every((call) => call.repo === ''), 'the way back tags nothing: ' + JSON.stringify(backCalls))

assert.deepEqual(errors, [], 'no page errors: ' + JSON.stringify(errors))
await browser.close()
console.log('stacked-repos: ok')
