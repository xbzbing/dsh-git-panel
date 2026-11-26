/** Composer-only session checkout follow: actual slot registration, isolated file:// pages, no polling. */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const KEY = 'dbGitPanel.picks'
const MAIN = '/mock/project'
const WT = '.agents/worktrees/pill-follow'
const rows = [
  { path: '', root: MAIN, name: 'project', kind: 'workspace', role: 'main', branch: 'main' },
  { path: WT, root: MAIN + '/' + WT, name: 'pill-follow', kind: 'nested', role: 'linked', branch: 'feat/pill-follow' },
  { path: 'site', root: MAIN + '/site', name: 'site', kind: 'nested', role: 'repo', branch: 'site' },
]
const SNAP = {
  root: MAIN, branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null, changes: [], truncated: false,
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: 1,
  followSessionCheckout: true,
}
const browser = await chromium.launch()
const failures = []

async function boot(page, options = {}) {
  await page.goto('file://' + resolve(DIR, 'harness.html'))
  await page.addScriptTag({ path: resolve(DIR, '../../lib/client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  await page.evaluate(({ snap, rows, key, main, options }) => {
    const React = window.React
    sessionStorage.removeItem(key)
    if (options.seed) sessionStorage.setItem(key, JSON.stringify({ v: 1, sessions: options.seed }))
    const ctl = window.__ctl = {
      calls: [], answered: [], opens: [], registered: {}, session: 'sess-1', panel: options.panel === true,
      rows: options.rows ?? rows, projections: new Map(), hidden: options.hidden === true, gates: new Map(), snapshotGates: new Map(),
    }
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => ctl.hidden })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ctl.hidden ? 'hidden' : 'visible' })
    ctl.visibility = (hidden) => { ctl.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')) }
    const projection = (sid) => {
      if (!ctl.projections.has(sid)) {
        const store = { value: options.directory ?? main, listeners: new Set() }
        store.subscribe = (listener) => { store.listeners.add(listener); return () => store.listeners.delete(listener) }
        store.hook = (key) => key === 'workingDirectory'
          ? React.useSyncExternalStore(store.subscribe, () => store.value) : undefined
        ctl.projections.set(sid, store)
      }
      return ctl.projections.get(sid)
    }
    ctl.directory = (directory, sid = ctl.session) => {
      const store = projection(sid)
      store.value = directory
      for (const listener of [...store.listeners]) listener()
    }
    ctl.hold = (sid) => ctl.gates.set(sid, new Promise((release) => { ctl.release = release }))
    ctl.holdSnapshot = (tag) => ctl.snapshotGates.set(tag, new Promise((release) => { ctl.releaseSnapshot = release }))
    const { connection } = window.createGitPanelMock(snap)
    const baseCall = connection.rpc.call
    const ok = (value) => ({ ok: true, value: { ok: true, value } })
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload?.args?.request
      const sid = request?.sessionId ?? ''
      const tag = request?.repo ?? ''
      const kind = request?.query?.kind ?? null
      ctl.calls.push({ endpoint, kind, sid, repo: tag })
      if (endpoint === 'dbGitPanel/snapshot') {
        const gate = ctl.snapshotGates.get(tag)
        if (gate) { ctl.snapshotGates.delete(tag); await gate }
        if (options.refuse?.repo === tag) {
          const error = options.refuse.error
          options.refuse = null
          return { ok: true, value: { ok: false, error } }
        }
        const row = rows.find((row) => row.path === tag)
        const value = { ...snap, root: row?.root ?? main, branch: row?.branch ?? 'main', checkedAt: Date.now() }
        if (options.missingField) delete value.followSessionCheckout
        if (options.off) value.followSessionCheckout = false
        return ok(value)
      }
      if (kind === 'repo-list') {
        const answer = { kind, cwd: main, repos: ctl.rows, worktrees: options.worktrees ?? 'ok' }
        const gate = ctl.gates.get(sid)
        if (gate) { ctl.gates.delete(sid); await gate }
        ctl.answered.push(sid)
        return ok(answer)
      }
      return baseCall(channel, endpoint, payload)
    }
    const services = {
      connection,
      sidebarRightTabs: { register: () => () => {} },
      sidebarRight: { openTab: (kind) => { ctl.opens.push(kind) }, isExpanded: () => false, openTabs: { getSnapshot: () => [] } },
    }
    const ctx = {
      get: (key) => services[key], effect: (cb) => cb(), on: () => () => {},
      inject: (_deps, cb) => cb(ctx),
      slots: {
        inject: (_name, provider) => provider(),
        register: (reg, component) => {
          const key = reg.key === undefined ? reg.name : reg.name + '::' + reg.key
          ctl.registered[key] = component
          return () => { delete ctl.registered[key] }
        },
      },
      locale: { register: () => () => {}, bind: () => (key) => key },
    }
    window.__getLoaded().apply(ctx)
    const pillRoot = window.ReactDOM.createRoot(document.getElementById('pill'))
    const panelRoot = window.ReactDOM.createRoot(document.getElementById('panel'))
    const copy = options.secondPanel ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'panel-copy' })) : null
    if (copy) copy.style.cssText = 'width:1000px;height:600px'
    const copyRoot = copy ? window.ReactDOM.createRoot(copy) : null
    ctl.render = () => {
      const props = { sessionId: ctl.session, ...(options.missingHook ? {} : { useProjection: projection(ctl.session).hook }) }
      pillRoot.render(ctl.registered['conversation.input.left'](props))
      panelRoot.render(ctl.panel ? ctl.registered['conversation.view'](props) : null)
      copyRoot?.render(ctl.registered['conversation.view'](props))
    }
    ctl.render()
  }, { snap: SNAP, rows, key: KEY, main: MAIN, options })
}
const state = (page) => page.evaluate((key) => ({
  branch: document.querySelector('.gp-pill__branch')?.textContent ?? null,
  repo: document.querySelector('.gp-pill__repo')?.textContent ?? null,
  root: document.querySelector('.gp-tip__path')?.textContent ?? null,
  panels: document.querySelectorAll('.gp-panel').length,
  calls: window.__ctl.calls, opens: window.__ctl.opens, stored: sessionStorage.getItem(key),
}), KEY)
async function pill(page, branch, repo) {
  try {
    await page.waitForFunction(({ branch, repo }) =>
      document.querySelector('.gp-pill__branch')?.textContent === branch &&
      document.querySelector('.gp-pill__repo')?.textContent === repo,
    { branch, repo }, { timeout: 2500 })
  } catch {
    assert.fail('pill did not reach ' + repo + ' (' + branch + '): ' + JSON.stringify(await state(page)))
  }
}
async function root(page, expected) {
  await page.locator('.gp-pill').hover()
  await page.waitForFunction((path) => document.querySelector('.gp-tip__path')?.textContent === path, expected)
  await page.mouse.move(0, 0)
}
async function phase(name, options, run) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors = []
  page.setDefaultTimeout(3000)
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (msg) => { if (['error', 'warning'].includes(msg.type())) errors.push(msg.type() + ': ' + msg.text()) })
  try {
    await boot(page, options)
    await run(page)
    assert.deepEqual((await state(page)).opens, [], 'no unprompted sidebar opens')
    assert.deepEqual(errors, [], 'console errors/warnings')
    console.log('PASS ' + name)
  } catch (error) {
    failures.push(name)
    console.log('FAIL ' + name + '\n' + error.stack + '\nconsole: ' + JSON.stringify(errors))
  } finally { await page.close() }
}
const tags = (out, sid = 'sess-1') => out.calls.filter((c) => c.sid === sid && c.endpoint === 'dbGitPanel/snapshot').map((c) => c.repo)
const lists = (out) => out.calls.filter((c) => c.kind === 'repo-list').length
const record = (out, sid = 'sess-1') => out.stored === null ? null : JSON.parse(out.stored).sessions[sid] ?? null
// Sleeps are negative-assertion stability windows only; transitions wait on DOM or wire evidence.
async function stable(page) { await page.waitForTimeout(150) }
async function listed(page, sid = 'sess-1') {
  await page.waitForFunction((sid) => window.__ctl.answered.includes(sid), sid)
}
async function move(page, directory) { await page.evaluate((dir) => window.__ctl.directory(dir), directory) }
try {
  await phase('composer only: main -> newly created worktree -> main', { rows: [rows[0], rows[2]] }, async (page) => {
    await pill(page, 'main', 'project')
    await listed(page)
    await root(page, MAIN)
    await page.evaluate(({ rows, wt }) => { window.__ctl.rows = rows; window.__ctl.directory(wt) }, { rows, wt: MAIN + '/' + WT })
    await pill(page, 'feat/pill-follow', 'pill-follow')
    await root(page, MAIN + '/' + WT)
    await page.evaluate((main) => window.__ctl.directory(main), MAIN)
    await pill(page, 'main', 'project')
    await root(page, MAIN)
    const out = await state(page)
    assert.deepEqual(tags(out), ['', WT, ''], 'snapshot requests carry the selected checkout')
    assert.equal(lists(out), 2, 'initial shared list plus one new-worktree refetch')
    assert.equal(out.stored, null, 'automatic follow writes no pick record')
    assert.equal(out.panels, 0, 'the panel was never mounted')
    assert.deepEqual(out.opens, [], 'follow never opens the sidebar')
  })
  await phase('composer only: initial worktree', { directory: MAIN + '/' + WT }, async (page) => {
    await pill(page, 'feat/pill-follow', 'pill-follow')
    await root(page, MAIN + '/' + WT)
    const out = await state(page)
    assert.deepEqual(tags(out), ['', WT])
    assert.equal(lists(out), 1)
    assert.equal(out.panels, 0)
    assert.equal(out.stored, null)
  })
  for (const flag of ['missingHook', 'missingField', 'off']) {
    await phase('composer only: ' + flag + ' does not follow', { [flag]: true }, async (page) => {
      await pill(page, 'main', 'project')
      await stable(page)
      const before = await state(page)
      await move(page, MAIN + '/' + WT)
      await stable(page)
      const out = await state(page)
      assert.equal(out.branch, 'main')
      assert.deepEqual(tags(out), [''])
      assert.equal(lists(out), lists(before), 'disabled follow does not refetch the list')
      assert.equal(out.stored, null)
    })
  }
  for (const picked of [{ repo: 'site' }, { rootPick: true }]) {
    await phase('composer only: stored ' + Object.keys(picked)[0] + ' holds until directory changes', {
      directory: MAIN + '/' + WT, seed: { 'sess-1': { ...picked, at: 1 } },
    }, async (page) => {
      await pill(page, picked.repo ? 'site' : 'main', picked.repo ? 'site' : 'project')
      await listed(page)
      await stable(page)
      assert.deepEqual(tags(await state(page)), [picked.repo ?? ''], 'restored intent wins at mount')
      await move(page, MAIN)
      await pill(page, 'main', 'project')
      await move(page, MAIN + '/' + WT)
      await pill(page, 'feat/pill-follow', 'pill-follow')
      assert.deepEqual(record(await state(page)), { ...picked, at: 1 }, 'automatic follow preserves stored intent')
    })
  }
  await phase('Pill + two Panels share list/snapshot, inert/focus switching and manual pick across remount', { panel: true, secondPanel: true }, async (page) => {
    await pill(page, 'main', 'project')
    await listed(page)
    await page.locator('.gp-repolist__head').first().waitFor()
    await stable(page)
    const before = await state(page)
    assert.equal(lists(before), 1, 'both consumers share the initial repository list')
    assert.deepEqual(tags(before), [''], 'all consumers share the initial snapshot')
    const head = page.locator('#panel .gp-body .gp-repolist__head').first()
    await head.focus()
    await page.evaluate(() => { window.__ctl.focused = document.activeElement })
    assert.equal(await head.getAttribute('aria-expanded'), 'false', 'the focus target stays mounted through a switch')
    await page.evaluate((wt) => { window.__ctl.holdSnapshot(wt); window.__ctl.directory('/mock/project/' + wt) }, WT)
    await page.waitForFunction(() => document.querySelectorAll('.gp-panel').length === 2 && [...document.querySelectorAll('.gp-panel')].every((el) => el.dataset.repoSwitching === 'true'))
    assert.deepEqual(await page.locator('.gp-body').evaluateAll((els) => els.map((el) => el.inert)), [true, true], 'shared switch makes both panel bodies inert')
    assert.equal((await state(page)).branch, 'main', 'previous sample remains while tagged snapshot waits')
    await page.evaluate(() => window.__ctl.releaseSnapshot())
    await pill(page, 'feat/pill-follow', 'pill-follow')
    await page.waitForFunction(() => [...document.querySelectorAll('.gp-panel')].every((el) => el.dataset.repoSwitching !== 'true'))
    assert.deepEqual(await page.locator('.gp-body').evaluateAll((els) => els.map((el) => el.inert)), [false, false], 'new sample releases both panel bodies')
    await page.waitForFunction(() => window.__ctl.focused.isConnected && document.activeElement === window.__ctl.focused)
    await head.click()
    await page.locator('.gp-repolist__item').filter({ has: page.locator('.gp-repolist__name', { hasText: /^site$/ }) }).first().click()
    await pill(page, 'site', 'site')
    const picked = await state(page)
    assert.equal(record(picked)?.repo, 'site')
    await page.evaluate(() => { window.__ctl.panel = false; window.__ctl.render() })
    await page.locator('#panel .gp-panel').waitFor({ state: 'detached' })
    assert.equal((await state(page)).panels, 1, 'unmounting one copy preserves the other')
    assert.equal(await page.locator('#panel-copy .gp-repolist__item--active .gp-repolist__name').first().textContent(), 'site')
    await page.evaluate(() => { window.__ctl.panel = true; window.__ctl.render() })
    await page.locator('#panel .gp-panel').waitFor()
    await stable(page)
    const out = await state(page)
    assert.equal(out.branch, 'site', 'new panel cannot undo manual pick on unchanged directory')
    assert.deepEqual(tags(out), ['', WT, 'site'], 'no duplicate or remount snapshot')
    assert.equal(lists(out), 1, 'no duplicate or remount repository list')
    assert.equal(await page.locator('.gp-repolist__item--active .gp-repolist__name').first().textContent(), 'site')
  })
  await phase('a follow switch returns only the focus it took', { panel: true, secondPanel: true }, async (page) => {
    await pill(page, 'main', 'project')
    await listed(page)
    const head = page.locator('#panel .gp-body .gp-repolist__head').first()
    await head.waitFor()
    await stable(page)
    await head.focus()
    // The user leaves the panel with the keyboard. A click on the page
    // background ends in the same place: focus on the document. The switch that
    // follows must not pull the keyboard back to a control left behind.
    await page.evaluate(() => { document.body.setAttribute('tabindex', '-1'); document.body.focus() })
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'the document holds the focus before the switch')
    await page.evaluate((wt) => { window.__ctl.holdSnapshot(wt); window.__ctl.directory('/mock/project/' + wt) }, WT)
    await page.waitForFunction(() => [...document.querySelectorAll('.gp-panel')].every((el) => el.dataset.repoSwitching === 'true'))
    await page.evaluate(() => window.__ctl.releaseSnapshot())
    await pill(page, 'feat/pill-follow', 'pill-follow')
    await page.waitForFunction(() => [...document.querySelectorAll('.gp-panel')].every((el) => el.dataset.repoSwitching !== 'true'))
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'a switch whose focus was already on the document revives no old target')
  })
  await phase('switched session ignores an old delayed repository list', {
    rows: [rows[0], rows[2]], seed: { 'sess-2': { repo: 'site', at: 1 } },
  }, async (page) => {
    await pill(page, 'main', 'project')
    await listed(page)
    await page.evaluate(({ rows, wt }) => {
      window.__ctl.rows = [rows[0], { ...rows[2], disabled: 'stale' }]
      window.__ctl.hold('sess-1')
      window.__ctl.directory(wt)
    }, { rows, wt: MAIN + '/' + WT })
    await page.waitForFunction(() => window.__ctl.calls.filter((c) => c.kind === 'repo-list' && c.sid === 'sess-1').length === 2)
    await page.evaluate(({ rows, wt }) => {
      window.__ctl.rows = rows
      window.__ctl.directory(wt, 'sess-2')
      window.__ctl.session = 'sess-2'
      window.__ctl.render()
    }, { rows, wt: MAIN + '/' + WT })
    await pill(page, 'site', 'site')
    await listed(page, 'sess-2')
    await page.evaluate(() => window.__ctl.release())
    await page.waitForFunction(() => window.__ctl.answered.filter((sid) => sid === 'sess-1').length === 2)
    await stable(page)
    const out = await state(page)
    assert.equal(out.branch, 'site')
    assert.deepEqual(tags(out, 'sess-2'), ['site'], 'old stale row cannot repair the new session selection')
    assert.equal(record(out, 'sess-2')?.repo, 'site')
  })
  await phase('hidden page makes no queries until visible and then follows latest directory', { hidden: true }, async (page) => {
    await page.waitForFunction(() => window.__ctl.projections.get('sess-1')?.listeners.size > 0)
    await move(page, MAIN + '/' + WT)
    await stable(page)
    assert.deepEqual((await state(page)).calls, [], 'hidden mount and directory movement make no requests')
    await page.evaluate(() => window.__ctl.visibility(false))
    await pill(page, 'feat/pill-follow', 'pill-follow')
    await listed(page)
    await page.evaluate(() => window.__ctl.visibility(true))
    const before = await state(page)
    await move(page, MAIN)
    await stable(page)
    assert.deepEqual((await state(page)).calls, before.calls, 'hidden movement starts neither snapshot nor list query')
    await page.evaluate(() => window.__ctl.visibility(false))
    await pill(page, 'main', 'project')
    assert.equal(tags(await state(page)).at(-1), '')
    assert.equal((await state(page)).stored, null)
  })
  await phase('composer only: failed worktree probe never follows the enclosing main row', { rows: [rows[0]], worktrees: 'failed' }, async (page) => {
    await pill(page, 'main', 'project')
    await listed(page)
    await move(page, MAIN + '/' + WT)
    await page.waitForFunction(() => window.__ctl.answered.length === 2)
    await stable(page)
    const out = await state(page)
    assert.deepEqual(tags(out), [''])
    assert.equal(lists(out), 2, 'one bounded follow refetch, no retry loop')
    assert.equal(out.branch, 'main')
    assert.equal(out.stored, null)
  })
  for (const unverified of [false, true]) {
    await phase('composer only: refused pick recovers, ' + (unverified ? 'unverified record kept' : 'definitive record removed'), {
      directory: MAIN + '/' + WT, seed: { 'sess-1': { repo: 'site', at: 1 } },
      refuse: { repo: 'site', error: { code: 'invalid-repo', ...(unverified ? { unverified: true } : {}) } },
    }, async (page) => {
      await pill(page, 'feat/pill-follow', 'pill-follow')
      await root(page, MAIN + '/' + WT)
      const out = await state(page)
      assert.deepEqual(tags(out), ['site', '', WT], 'repair samples the fallback then follows the projected checkout')
      assert.equal(record(out)?.repo ?? null, unverified ? 'site' : null)
      assert.equal(out.panels, 0, 'repair does not require a mounted panel')
    })
  }
} finally { await browser.close() }
if (failures.length) { console.log('pill-follow: ' + failures.length + ' phase(s) failed'); process.exitCode = 1 }
else console.log('pill-follow: all assertions passed')
