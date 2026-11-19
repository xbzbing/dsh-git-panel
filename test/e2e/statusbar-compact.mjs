/**
 * Compact sync state in the status bar (issue #131).
 *
 * The overview's left column is 200px at its default, user-resizable to 130 and
 * `clamp(120px,38%,180px)` in the stacked band. After the row's own controls
 * (~140px) the state cell gets 40–60px, while the zh sentence needs 66–143px
 * and the en one 107–210px depending on the state — so the steady states are
 * glyphs with counts (`✓`, `↓5`, `↓5 ↑3`, `HEAD`) and the sentence rides the
 * accessible name and the tip.
 *
 * This runner pins both halves of that contract:
 * - every steady state renders its glyph, keeps the sentence as `aria-label`,
 *   and never overflows its own box at the narrowest column the layout allows;
 * - the two width-driven degradations (`data-narrow` at ≤175px, `data-dense` at
 *   ≤150px) fire from the bar's measured width, not from the layout tier — the
 *   stacked 420 mount is the case the tier could not see.
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const E2E = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(E2E, 'harness.html')

// `host` is part of the wire type: a fixture without it would label the repo
// link "open the repository home on undefined" and quietly stop covering the
// branch that names the host.
const BASE = {
  root: 'fixture-repo', branch: 'main', head: 'ba78eb4', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', url: 'git@github.com:example/repo.git', webUrl: 'https://github.com/example/repo', host: 'github.com', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, suggestEnabled: true,
  capabilities: { syncMerge: true },
  defaultDiffView: 'unified', checkedAt: Date.now(),
}
const snap = (patch) => ({ ...BASE, ...patch })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, screen: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

await page.goto(harness)
await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await page.addScriptTag({ path: resolve(E2E, 'client.js') })

// ── conversation mount: the wide three-column overview, plus a resized column ──
await page.evaluate((initial) => {
  const { fixture, connection } = window.createGitPanelMock(initial)
  window.__gpFixture = fixture
  // Every stage starts from the clean base snapshot: mutating one stage's
  // fixture must not leak into the next (the detached case sets branch=null).
  window.__BASE = initial
  const registry = {}
  const settings = {
    view: { namespaces: [{ ns: 'dbGitPanel', schema: { dict: {} }, value: { showInputPill: true } }] },
    status: 'ready',
  }
  const configForms = {
    describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
    get: () => ({ getSnapshot: () => ({ status: 'ready', value: { showInputPill: true }, revision: 0, writable: true }), subscribe: () => () => {}, set: async () => true }),
  }
  const services = { connection, configForms }
  const dictionaries = {}
  const ctx = {
    get: (k) => services[k],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (_name, provider) => provider(),
      register: (reg, component) => { registry[reg.name] = { reg, component }; return () => {} },
    },
    locale: {
      // The real zh strings: the accessible name is the sentence under test.
      register: (_ns, dict) => { dictionaries.zh = dict.zh; return () => {} },
      bind: () => (key, params) => {
        const text = dictionaries.zh?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  window.__getLoaded().apply(ctx)
  window.__gpView = registry['conversation.view']

  // One stage per scenario: a fresh root reads the snapshot the fixture serves
  // at mount time, so a state can be swapped without driving the UI through
  // fetch/switch flows. Each stage gets its own session: the panel's controllers
  // are cached per session (registry.ts), so reusing one would replay the first
  // snapshot and every later scenario would assert against the wrong state.
  window.__stageN = 0
  window.__stage = async (snapshotPatch, width) => {
    const host = document.createElement('div')
    host.style.cssText = `width:${width}px;height:760px;border:1px solid #333`
    document.body.appendChild(host)
    fixture.snapshot = { ...window.__BASE, ...snapshotPatch }
    const root = window.ReactDOM.createRoot(host)
    root.render(window.__gpView.component({ sessionId: `sess-stage-${++window.__stageN}` }))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    await new Promise((r) => setTimeout(r, 120))
    return host
  }
  window.__probe = (host) => {
    const bar = host.querySelector('.gp-col--left .gp-statusbar')
    const state = bar?.querySelector('.gp-statusbar__state')
    const pull = bar?.querySelector('.gp-statusbar__pull')
    const label = pull?.querySelector('.gp-btn__label')
    const col = host.querySelector('.gp-col--left')
    const rect = (el) => (el === null || el === undefined ? null : Math.round(el.getBoundingClientRect().width * 10) / 10)
    return {
      layout: host.querySelector('.gp-panel')?.getAttribute('data-layout'),
      colW: rect(col),
      barW: rect(bar),
      barClient: bar?.clientWidth ?? null,
      barScroll: bar?.scrollWidth ?? null,
      barOverflow: bar === null || bar === undefined ? null : bar.scrollWidth - bar.clientWidth,
      narrow: bar?.getAttribute('data-narrow') ?? null,
      dense: bar?.getAttribute('data-dense') ?? null,
      repo: bar?.querySelector('a.gp-statusbar__repo') !== null && bar?.querySelector('a.gp-statusbar__repo') !== undefined,
      repoLabel: bar?.querySelector('a.gp-statusbar__repo')?.getAttribute('aria-label') ?? null,
      stateText: state === null || state === undefined ? null : state.textContent,
      stateLabel: state?.getAttribute('aria-label') ?? null,
      stateRole: state?.getAttribute('role') ?? null,
      stateClient: state === null || state === undefined ? null : state.clientWidth,
      stateScroll: state === null || state === undefined ? null : state.scrollWidth,
      stateOverflow: state === null || state === undefined ? null : state.scrollWidth - state.clientWidth,
      pullW: rect(pull),
      labelShown: label === null || label === undefined ? null : label.getBoundingClientRect().width > 0,
      hasPublish: bar?.querySelector('button[aria-label="发布分支并设置上游"]') !== null && bar?.querySelector('button[aria-label="发布分支并设置上游"]') !== undefined,
      hasSetUpstream: bar?.querySelector('button[aria-label="设置上游"]') !== null && bar?.querySelector('button[aria-label="设置上游"]') !== undefined,
      hasPull: bar?.querySelector('button[aria-label="快进拉取远程更新"]') !== null && bar?.querySelector('button[aria-label="快进拉取远程更新"]') !== undefined,
      hasPush: bar?.querySelector('button[aria-label="推送本地提交到远程"]') !== null && bar?.querySelector('button[aria-label="推送本地提交到远程"]') !== undefined,
      hasSync: bar?.querySelector('button.gp-statusbar__merge') !== null && bar?.querySelector('button.gp-statusbar__merge') !== undefined,
      syncW: rect(bar?.querySelector('button.gp-statusbar__merge')),
    }
  }
}, snap({}))

// Wide overview (200px column): the full row — link, glyph, labelled actions.
const wide = await page.evaluate(async () => {
  const host = await window.__stage({}, 1000)
  return window.__probe(host)
})
assert.equal(wide.layout, 'wide', 'a 1000px conversation panel is the wide layout')
assert.equal(wide.colW, 200, 'the left column is at its 200px default')
assert.equal(wide.narrow, null, 'a 200px bar is not narrow')
assert.equal(wide.dense, null, 'a 200px bar keeps its action labels')
assert.equal(wide.repo, true, 'the wide bar keeps the GitHub link')
assert.equal(wide.repoLabel, 'example/repo · 在 github.com 打开仓库主页',
  'the link names the host the fixture sends')

// A snapshot from a host that predates `host` (an undefined field, not null):
// the link must fall back to the generic name instead of printing "undefined".
const oldHost = await page.evaluate(async () => {
  const host = await window.__stage({
    remote: { name: 'origin', url: 'git@github.com:example/repo.git', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  }, 1000)
  return window.__probe(host)
})
assert.equal(oldHost.repo, true, 'the link still renders for a GitHub remote')
assert.equal(oldHost.repoLabel, 'example/repo · 在浏览器打开仓库主页',
  'a missing host falls back to the generic label, never "undefined"')
assert.ok(!(oldHost.repoLabel || '').includes('undefined'), 'no undefined leaks into the accessible name')

assert.equal(wide.stateText, '✓', 'synced renders the check glyph, not a sentence')
assert.equal(wide.stateLabel, '已与远程同步', 'the sentence is the accessible name')
assert.equal(wide.stateRole, 'img', 'the glyph cell exposes itself as a named image, not raw punctuation')
assert.equal(wide.stateOverflow, 0, 'the glyph fits its box with no ellipsis')
assert.equal(wide.hasPull, false, 'a synced branch offers no pull')
assert.equal(wide.hasPush, false, 'a synced branch offers no push')

// Behind: `↓5` on the glyph, pull offered, sentence in the name.
const behind = await page.evaluate(async () => {
  const host = await window.__stage({ ahead: 0, behind: 5, hasUpstream: true }, 1000)
  return window.__probe(host)
})
assert.equal(behind.stateText, '↓5', 'behind renders the count with a down arrow')
assert.equal(behind.stateLabel, '比上游落后 5 个提交', 'the behind sentence carries the count')
assert.equal(behind.stateOverflow, 0, 'the behind glyph fits the 200px bar')
assert.equal(behind.hasPull, true, 'a strictly-behind branch offers the pull')

// Ahead: `↑7` on the glyph, push offered.
const ahead = await page.evaluate(async () => {
  const host = await window.__stage({ ahead: 7, behind: 0, hasUpstream: true }, 1000)
  return window.__probe(host)
})
assert.equal(ahead.stateText, '↑7', 'ahead renders the count with an up arrow')
assert.equal(ahead.stateLabel, '比上游领先 7 个提交', 'the ahead sentence carries the count')
assert.equal(ahead.stateOverflow, 0, 'the ahead glyph fits the 200px bar')
assert.equal(ahead.hasPush, true, 'a strictly-ahead branch offers the push')

// Diverged: both counts, behind first, and exactly one action — the merge-based
// sync (ADR-0036). The ordinary pull/push stay absent: neither can succeed.
const diverged = await page.evaluate(async () => {
  const host = await window.__stage({ ahead: 3, behind: 5, hasUpstream: true }, 1000)
  return window.__probe(host)
})
assert.equal(diverged.stateText, '↓5 ↑3', 'diverged reads behind-then-ahead, like the status bar it borrows from')
assert.equal(diverged.stateLabel, '已分叉（领先 3 / 落后 5）', 'the diverged sentence names both sides')
assert.equal(diverged.stateOverflow, 0, 'both counts fit the 200px bar')
assert.equal(diverged.hasPull, false, 'a diverged branch is not fast-forwardable')
assert.equal(diverged.hasPush, false, 'a diverged branch must not be pushed')
assert.equal(diverged.hasSync, true, 'it offers the merge-then-push sync instead')
assert.ok(diverged.syncW > 0, 'the sync control is laid out')
assert.equal(diverged.barOverflow, 0, 'the whole bar fits at 200px with the new control')

// The same diverged state at the 130px floor: the label collapses with the
// other actions, and the bar itself (not just the state cell) must not overflow.
await page.evaluate(async () => {
  window.__syncHost = await window.__stage({ ahead: 3, behind: 5, hasUpstream: true }, 1000)
})
const sync200 = await page.evaluate(() => window.__probe(window.__syncHost))
assert.equal(sync200.hasSync, true, 'the 200px sync control is present')
assert.equal(sync200.labelShown, true, 'and keeps its word at 200px')
assert.equal(sync200.barOverflow, 0, '200px bar fits')
await page.evaluate(async () => {
  window.__syncHost.querySelector('.gp-col--left').style.flex = '0 0 130px'
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  await new Promise((r) => setTimeout(r, 90))
})
const sync130 = await page.evaluate(() => window.__probe(window.__syncHost))
assert.equal(sync130.dense, 'true', 'the floor is the dense tier')
assert.equal(sync130.hasSync, true, 'the sync control survives the floor')
assert.equal(sync130.labelShown, false, 'its label is dropped like the other actions')
assert.equal(sync130.barOverflow, 0, 'the 130px bar itself does not overflow')
assert.equal(sync130.stateOverflow, 0, 'and the state glyph is not ellipsised')


// No upstream (the issue's own screenshot): a bare `↑` — no count, since there
// is no upstream to count against — plus the publish control that names the
// action. A word label cannot be translated into that cell: it has 60px at the
// 200px default and 52px when dragged narrow, while `Unpushed` alone is 54.
const noUpstream = await page.evaluate(async () => {
  const host = await window.__stage({ ahead: 0, behind: 0, hasUpstream: false }, 1000)
  return window.__probe(host)
})
assert.equal(noUpstream.stateText, '↑', 'no-upstream renders the bare up arrow')
assert.equal(noUpstream.stateLabel, '未跟踪远程分支', 'the no-upstream sentence is the accessible name')
assert.equal(noUpstream.stateOverflow, 0, 'the arrow fits the 200px bar with room to spare')
assert.equal(noUpstream.hasPublish, true, 'no-upstream offers the publish control')

// Set-upstream (a same-named remote branch already sits at HEAD): the same
// glyph, and the other control — the two never both appear.
const setUpstream = await page.evaluate(async () => {
  const host = await window.__stage({
    ahead: 0, behind: 0, hasUpstream: false,
    remoteCandidates: [{ name: 'origin', url: 'git@github.com:example/repo.git', webUrl: 'https://github.com/example/repo', host: 'github.com', hostKind: 'github' }],
  }, 1000)
  const bar = host.querySelector('.gp-col--left .gp-statusbar')
  return {
    stateText: bar.querySelector('.gp-statusbar__state')?.textContent ?? null,
    hasSetUpstream: bar.querySelector('button[aria-label="设置上游"]') !== null,
    hasPublish: bar.querySelector('button[aria-label="发布分支并设置上游"]') !== null,
  }
})
assert.equal(setUpstream.stateText, '↑', 'the attach-only state carries the same arrow')
assert.equal(setUpstream.hasSetUpstream, true, 'and offers set-upstream')
assert.equal(setUpstream.hasPublish, false, 'never publish alongside it')

// Detached HEAD: a `HEAD` tag rather than the 143px sentence.
const detached = await page.evaluate(async () => {
  const host = await window.__stage({ branch: null, ahead: 0, behind: 0, hasUpstream: false }, 1000)
  return window.__probe(host)
})
assert.equal(detached.stateText, 'HEAD', 'a detached head renders the HEAD tag')
assert.equal(detached.stateLabel, '游离 HEAD，无分支同步状态', 'the detached sentence stays the accessible name')
assert.equal(detached.stateOverflow, 0, 'the HEAD tag fits the 200px bar')

// Unborn branch (a fresh repo, no commits): `branch` is set but `head` is null,
// so the bare `↑` renders while both publish and set-upstream stay away (there
// is nothing to push and no hash to attach). Pinned so the glyph never promises
// an action the row does not offer.
const unborn = await page.evaluate(async () => {
  const host = await window.__stage({ branch: 'main', head: null, unborn: true, ahead: 0, behind: 0, hasUpstream: false }, 1000)
  return window.__probe(host)
})
assert.equal(unborn.stateText, '↑', 'an unborn branch reads as no-upstream')
assert.equal(unborn.stateLabel, '未跟踪远程分支', 'and keeps the sentence as its name')
assert.equal(unborn.hasPublish, false, 'but offers no publish: there is nothing to push')
assert.equal(unborn.hasSetUpstream, false, 'and no set-upstream: there is no hash to attach')
assert.equal(unborn.stateOverflow, 0, 'the arrow fits the 200px bar')

// ── width-driven degradation, measured on the bar itself ──
const setCol = (w) => page.evaluate(async (width) => {
  // Scope to the stage under test: earlier stages stay mounted in the fixture.
  window.__host.querySelector('.gp-col--left').style.flex = `0 0 ${width}px`
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  await new Promise((r) => setTimeout(r, 80))
}, w)

await page.evaluate(async () => {
  window.__host = await window.__stage({ ahead: 0, behind: 5, hasUpstream: true }, 1000)
})
// Exact breakpoint boundaries: both constants use `<=`. These four points pin
// the numbers themselves — nudging STATUSBAR_REPO_BP 175→165 or
// STATUSBAR_ACTION_BP 150→145 would leave the 160/140 checks below green, but
// must turn one of these red.
await setCol(176)
const aboveRepo = await page.evaluate(() => window.__probe(window.__host))
assert.equal(aboveRepo.narrow, null, '176px is above the repo breakpoint: not narrow')
assert.equal(aboveRepo.repo, true, 'so the repository link stays')

await setCol(175)
const atRepo = await page.evaluate(() => window.__probe(window.__host))
assert.equal(atRepo.narrow, 'true', '175px is the repo breakpoint (<=): narrow fires')
assert.equal(atRepo.repo, false, 'so the repository link is dropped')

await setCol(160)
const mid = await page.evaluate(() => window.__probe(window.__host))
assert.equal(mid.barW, 160, 'the column resized to 160px')
assert.equal(mid.narrow, 'true', 'a 160px bar drops the repository link')
assert.equal(mid.repo, false, 'the 160px bar has no repo link')
assert.equal(mid.dense, null, '160px still has room for the action label')
assert.equal(mid.labelShown, true, 'the pull label is still a word at 160px')
assert.equal(mid.stateText, '↓5', 'the glyph survives the narrower bar')
assert.equal(mid.stateOverflow, 0, 'the glyph is not ellipsised at 160px — the whole point of the issue')

await setCol(151)
const aboveAction = await page.evaluate(() => window.__probe(window.__host))
assert.equal(aboveAction.dense, null, '151px is above the action breakpoint: labels stay')
assert.equal(aboveAction.labelShown, true, 'so the pull keeps its word')

await setCol(150)
const atAction = await page.evaluate(() => window.__probe(window.__host))
assert.equal(atAction.dense, 'true', '150px is the action breakpoint (<=): dense fires')
assert.equal(atAction.labelShown, false, 'so the pull gives its label up')

await setCol(140)
const dense = await page.evaluate(() => window.__probe(window.__host))
assert.equal(dense.barW, 140, 'the column resized to 140px')
assert.equal(dense.narrow, 'true', 'the 140px bar is still narrow')
assert.equal(dense.dense, 'true', 'a 140px bar drops the action labels')
assert.equal(dense.labelShown, false, 'the pull label gives its 32px to the state')
assert.equal(dense.pullW, 24, 'the icon-only action keeps the 24px check-button box')
assert.equal(dense.stateText, '↓5', 'the glyph survives the densest tier')
assert.equal(dense.stateOverflow, 0, 'the glyph is still not ellipsised at 140px')

// The 130px floor: the narrowest column the layout allows. This is the width a
// word label could not survive in, and the reason the no-upstream state is a
// glyph rather than text.
await page.evaluate(async () => {
  window.__floorHost = await window.__stage({ ahead: 0, behind: 0, hasUpstream: false }, 1000)
})
await page.evaluate(async () => {
  window.__floorHost.querySelector('.gp-col--left').style.flex = '0 0 130px'
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  await new Promise((r) => setTimeout(r, 90))
})
const atFloor = await page.evaluate(() => window.__probe(window.__floorHost))
assert.equal(atFloor.barW, 130, 'the column is at its 130px floor')
assert.equal(atFloor.dense, 'true', 'the floor tier is dense')
assert.equal(atFloor.stateText, '↑', 'the no-upstream arrow still renders at the floor')
assert.equal(atFloor.stateOverflow, 0, 'and it is not ellipsised there either')

// ── stacked sidebar mount: the tier cannot see this width, the measurement can ──
const sidebar = await browser.newPage({ viewport: { width: 900, height: 900 }, screen: { width: 1440, height: 900 } })
sidebar.on('pageerror', (e) => errors.push('SIDEBAR PAGEERROR ' + e.message))
await sidebar.goto(harness)
await sidebar.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await sidebar.addScriptTag({ path: resolve(E2E, 'client.js') })
const stacked = await sidebar.evaluate(async (initial) => {
  const { connection } = window.createGitPanelMock(initial)
  const registry = {}
  const settings = {
    view: { namespaces: [{ ns: 'dbGitPanel', schema: { dict: {} }, value: { showInputPill: true, placement: 'sidebar' } }] },
    status: 'ready',
  }
  const services = {
    connection,
    configForms: {
      describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
      get: () => ({ getSnapshot: () => ({ status: 'ready', value: { showInputPill: true, placement: 'sidebar' }, revision: 0, writable: true }), subscribe: () => () => {}, set: async () => true }),
    },
    sidebarRightTabs: { register: () => () => {} },
    sidebarRight: { openTab: () => {} },
  }
  const dictionaries = {}
  const ctx = {
    get: (k) => services[k],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (_name, provider) => provider(),
      register: (reg, component) => { const key = reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`; registry[key] = { reg, component }; return () => {} },
    },
    locale: {
      register: (_ns, dict) => { dictionaries.zh = dict.zh; return () => {} },
      bind: () => (key, params) => {
        const text = dictionaries.zh?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  window.__getLoaded().apply(ctx)
  const entry = registry['sidebar.right.pane.tab::@xbzbing/dsh-git-panel']
  const host = document.getElementById('panel')
  host.style.width = '420px'
  host.style.height = '860px'
  window.ReactDOM.createRoot(host).render(entry.component({ sessionId: 'sess-1', useTabInfo: () => ({ tab: { visible: true } }), t: (k) => k }))
  await new Promise((r) => setTimeout(r, 700))
  ;[...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => (t.textContent || '').includes('总览'))?.click()
  await new Promise((r) => setTimeout(r, 400))
  const bar = document.querySelector('.gp-col--left .gp-statusbar')
  const state = bar?.querySelector('.gp-statusbar__state')
  return {
    layout: document.querySelector('.gp-panel')?.getAttribute('data-layout'),
    barW: Math.round(bar.getBoundingClientRect().width),
    narrow: bar?.getAttribute('data-narrow') ?? null,
    dense: bar?.getAttribute('data-dense') ?? null,
    repo: bar?.querySelector('a.gp-statusbar__repo') != null,
    stateText: state?.textContent ?? null,
    stateLabel: state?.getAttribute('aria-label') ?? null,
    stateOverflow: state === null || state === undefined ? null : state.scrollWidth - state.clientWidth,
  }
}, snap({ ahead: 0, behind: 5, hasUpstream: true }))
assert.equal(stacked.layout, 'stacked', 'the 420 sidebar is the stacked band')
assert.equal(stacked.barW, 160, 'its left column is clamp(120px,38%,180px) = 160px at 420')
assert.equal(stacked.narrow, 'true', 'the measured bar, not the layout tier, decides the drop')
assert.equal(stacked.repo, false, 'the 160px stacked bar keeps the state instead of the link')
assert.equal(stacked.stateText, '↓5', 'the stacked bar shows the count')
assert.equal(stacked.stateLabel, '比上游落后 5 个提交', 'and keeps the sentence in its accessible name')
assert.equal(stacked.stateOverflow, 0, 'the stacked bar is where the issue was reported: no ellipsis remains')
await sidebar.close()

assert.deepEqual(errors, [], 'no console errors or page errors')
console.log('e2e statusbar-compact: PASS')
await page.close()
await browser.close()
