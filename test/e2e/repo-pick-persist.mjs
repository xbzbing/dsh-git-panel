/**
 * E2E: the repository pick survives a reload of the page (and so a hot reload
 * of the bundle, which loses the same in-memory state), and only a refusal the
 * host gave as definitive deletes it.
 *
 * Every phase states the record it starts from (`seed`), so a failure stays in
 * its own phase; only the first two share state on purpose, because carrying
 * the tab's `sessionStorage` across a reload is what they test.
 *
 *  - a pick writes the record, and the next load samples it from the first frame
 *  - the sample's verdict: `unverified` falls back but keeps the record, a
 *    definitive `invalid-repo` deletes it, and the next load starts untagged
 *  - the list's verdict: a list whose worktree probe failed retires nothing, a
 *    `stale` row deletes the record, a missing row only falls back
 *  - the file-root pin: written with the repository pick, deleted by a `stale`
 *    row, kept by a list whose probe failed
 *  - the files-only auto-pick stays in memory: nothing is written
 *  - a panel switching sessions does not judge the next session's pick by the
 *    previous session's list
 *
 * Fully isolated — a local file:// harness, no dsh server. Requires the e2e
 * fixtures (run test/e2e/setup.mjs first, or `npm run test:e2e`).
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')
const KEY = 'dbGitPanel.picks'
const VERSION = 1

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}
const WORKSPACE_REPO = { path: '', root: 'fixture-repo', name: 'fixture-repo', kind: 'workspace' }
const NESTED_REPO = { path: 'site', root: 'fixture-repo/site', name: 'site', kind: 'nested' }
const STALE_REPO = { ...NESTED_REPO, disabled: 'stale' }

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
/**
 * Load the harness and mount the panel for `sess-1`.
 *
 * - `seed`: the tab record to start from — a `{ sessionId: record }` map, null
 *   for an empty tab, undefined to keep what the previous load left.
 * - `refuse` / `refuseRoot`: the failure every snapshot tagged `site` / untagged
 *   is answered with.
 * - `lists`: the repo-list reply per session (`{ repos, worktrees, delayMs }`).
 * - `steps`, in order once the page settled: `{ pick }` clicks that switcher
 *   row, `{ tab }` selects a tab, `{ root }` picks that file-root menu entry,
 *   `{ session }` re-renders the same panel for another session.
 *
 * "Settled" is the list answered and no request for a quiet window: a repair
 * the panel would make is a new snapshot request, so a negative assertion is
 * only read once nothing else is coming.
 */
async function load({ seed, refuse = null, refuseRoot = null, lists = {}, steps = [] } = {}) {
  await page.goto(harness)
  await page.evaluate(({ seed, key, version }) => {
    if (seed === null) sessionStorage.removeItem(key)
    else if (seed !== undefined) sessionStorage.setItem(key, JSON.stringify({ v: version, sessions: seed }))
  }, { seed, key: KEY, version: VERSION })
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  const defaults = { repos: [WORKSPACE_REPO, NESTED_REPO], worktrees: 'ok', delayMs: 0 }
  return page.evaluate(async ({ snap, refuse, refuseRoot, lists, defaults, steps, key }) => {
    const { connection } = window.createGitPanelMock(snap)
    const seen = []
    const answered = new Set()
    let lastCall = Date.now()
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const mockCall = connection.rpc.call
    connection.rpc.call = async (channel, endpoint, payload) => {
      lastCall = Date.now()
      const request = payload && payload.args && payload.args.request
      const sid = request && typeof request.sessionId === 'string' ? request.sessionId : ''
      const tag = request && typeof request.repo === 'string' ? request.repo : ''
      if (endpoint === 'dbGitPanel/snapshot') {
        seen.push(sid + ':' + tag)
        const failure = tag === 'site' ? refuse : tag === '' ? refuseRoot : null
        if (failure !== null) return { ok: true, value: { ok: false, error: failure } }
        return { ok: true, value: { ok: true, value: { ...snap, root: tag === '' ? snap.root : 'fixture-repo/' + tag, checkedAt: Date.now() } } }
      }
      if (endpoint === 'dbGitPanel/query' && request && request.query && request.query.kind === 'repo-list') {
        const list = { ...defaults, ...(lists[sid] ?? {}) }
        if (list.delayMs > 0) await wait(list.delayMs)
        answered.add(sid)
        lastCall = Date.now()
        return { ok: true, value: { ok: true, value: { kind: 'repo-list', cwd: '/mock/workspace', repos: list.repos, worktrees: list.worktrees } } }
      }
      return mockCall(channel, endpoint, payload)
    }
    const entry = window.__getLoaded()
    if (!entry || typeof entry.apply !== 'function') return { error: 'plugin did not load' }
    const registered = {}
    const services = { connection }
    const ctx = {
      get: (k) => services[k],
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: () => () => {},
      inject: (_deps, cb) => cb(ctx),
      slots: {
        inject: (_name, provider) => provider(),
        register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} },
      },
      locale: { register: () => () => {}, bind: () => (k) => k },
    }
    entry.apply(ctx)
    const view = registered['conversation.view']
    if (!view) return { error: 'conversation.view was not registered' }
    const root = window.ReactDOM.createRoot(document.getElementById('panel'))
    let session = 'sess-1'
    root.render(view.component({ sessionId: session }))
    const until = async (cond, ms = 3000) => {
      const start = Date.now()
      while (!cond() && Date.now() - start < ms) await wait(20)
      return cond()
    }
    const quiet = async (ms = 250) => {
      const ok = await until(() => Date.now() - lastCall >= ms, 4000)
      return ok ? null : 'the page never went quiet'
    }
    const settle = async () => {
      if (!(await until(() => answered.has(session)))) return 'no repo-list answer for ' + session
      return quiet()
    }
    const rows = () => [...document.querySelectorAll('.gp-panel .gp-repolist__item')]
    const nameOf = (node) => (node.querySelector('.gp-repolist__name')?.textContent ?? '').replace(/\u200e/g, '').trim()
    const activeRow = () => {
      const node = rows().find((n) => n.classList.contains('gp-repolist__item--active'))
      return node ? nameOf(node) : null
    }
    const tabNodes = () => [...document.querySelectorAll('.gp-panel .gp-tabbar__tabs [role="tab"]')]
    const labelOf = (node) => (node.querySelector('.gp-tab__label') || node).textContent.trim()
    const clickTab = async (label) => {
      const node = tabNodes().find((n) => labelOf(n) === label)
      if (!node) return 'no tab ' + label + ' in ' + tabNodes().map(labelOf).join('|')
      node.click()
      if (!(await until(() => node.getAttribute('aria-selected') === 'true'))) return 'tab ' + label + ' never selected'
      return quiet()
    }
    const pickRow = async (name) => {
      const row = rows().find((node) => nameOf(node) === name)
      if (!row) return 'no row ' + name + ' in ' + rows().map(nameOf).join('|')
      row.click()
      if (!(await until(() => activeRow() === name))) return 'row ' + name + ' never became active'
      return quiet()
    }
    // The file browser's root dropdown: the trigger names the current root and
    // the menu lists the project root plus every checkout.
    const rootItems = () => [...document.querySelectorAll('.gp-panel .gp-files__rootmenu .gp-files__rootmenu__item')]
    const rootName = (node) => (node.querySelector('.gp-files__rootmenu__name')?.textContent ?? '').trim()
    const clickRoot = async (name) => {
      const trigger = document.querySelector('.gp-panel .gp-files__status-path')
      if (trigger === null) return 'no browse-root trigger'
      if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
      if (!(await until(() => rootItems().length > 0))) return 'the root menu never opened'
      const item = rootItems().find((node) => rootName(node) === name)
      if (!item) return 'no root ' + name + ' in ' + rootItems().map(rootName).join('|')
      item.click()
      return quiet()
    }
    const switchSession = async (next) => {
      session = next
      root.render(view.component({ sessionId: next }))
      return settle()
    }
    const settled = await settle()
    if (settled !== null) return { error: settled }
    for (const step of steps) {
      const failure = step.pick !== undefined ? await pickRow(step.pick)
        : step.tab !== undefined ? await clickTab(step.tab)
          : step.root !== undefined ? await clickRoot(step.root)
            : step.session !== undefined ? await switchSession(step.session)
              : 'unknown step ' + JSON.stringify(step)
      if (failure !== null) return { error: failure }
    }
    const raw = sessionStorage.getItem(key)
    const records = raw === null ? {} : (JSON.parse(raw).sessions ?? {})
    const tagsOf = (sid) => seen.filter((s) => s.startsWith(sid + ':')).map((s) => s.slice(sid.length + 1))
    return {
      tags: tagsOf('sess-1'),
      tagsOf: Object.fromEntries(['sess-1', 'sess-2'].map((sid) => [sid, tagsOf(sid)])),
      active: activeRow(),
      record: records['sess-1'] ?? null,
      records,
    }
  }, { snap: SNAP, refuse, refuseRoot, lists, defaults, steps, key: KEY })
}

const failures = []
/** Run one phase; page errors raised during it fail that phase, by name. */
async function phase(name, fn) {
  const before = errors.length
  try {
    await fn()
    const raised = errors.slice(before)
    assert.deepEqual(raised, [], 'page errors during the phase')
    console.log('PASS ' + name)
  } catch (error) {
    failures.push(name)
    console.log('FAIL ' + name + '\n' + (error && error.stack ? error.stack : error))
  }
}

/** A tab record for `sess-1` holding `record`. */
const only = (record) => ({ 'sess-1': { at: 1, ...record } })
const SITE = only({ repo: 'site' })

try {
  await phase('a pick writes the tab record', async () => {
    const out = await load({ seed: null, steps: [{ pick: 'site' }] })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], '', 'a fresh tab starts on the workspace checkout')
    assert.equal(out.active, 'site')
    assert.equal(out.record?.repo, 'site')
  })

  await phase('a reload samples the picked checkout from the first frame', async () => {
    // No seed: the record is the one the previous load wrote.
    const out = await load()
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site', 'no untagged sample before the restored one: ' + out.tags.join(','))
    assert.equal(out.tags.includes(''), false, 'the workspace checkout is never sampled')
    assert.equal(out.active, 'site')
  })

  // ── the sample's verdict ─────────────────────────────────────────────────
  await phase('an unverified refusal falls back but keeps the record', async () => {
    const out = await load({ seed: SITE, refuse: { code: 'invalid-repo', cwd: '/mock/workspace', unverified: true } })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site')
    assert.equal(out.tags.at(-1), '', 'the panel returns to the workspace checkout')
    assert.equal(out.record?.repo, 'site', 'the next load tries the pick again')
  })

  await phase('a definitive refusal deletes the record', async () => {
    const out = await load({ seed: SITE, refuse: { code: 'invalid-repo', cwd: '/mock/workspace' } })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site')
    assert.equal(out.tags.at(-1), '')
    assert.equal(out.record, null)
  })

  await phase('an empty tab starts on the workspace checkout', async () => {
    const out = await load({ seed: null })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], '')
    assert.equal(out.tags.includes('site'), false)
    assert.equal(out.active, 'fixture-repo')
  })

  // ── the list's verdict ───────────────────────────────────────────────────
  await phase('a list whose worktree probe failed retires nothing', async () => {
    const out = await load({ seed: SITE, lists: { 'sess-1': { repos: [WORKSPACE_REPO], worktrees: 'failed' } } })
    assert.equal(out.error, undefined, out.error)
    assert.deepEqual(out.tags, ['site'], 'the pick is not dropped')
    assert.equal(out.record?.repo, 'site')
  })

  await phase('a row git reports as stale falls back and deletes the record', async () => {
    const out = await load({ seed: SITE, lists: { 'sess-1': { repos: [WORKSPACE_REPO, STALE_REPO] } } })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site', 'the restored pick is sampled first')
    assert.equal(out.tags.at(-1), '', 'the list repair returns to the workspace checkout')
    assert.equal(out.record, null, 'a stale row is definitive')
  })

  await phase('a missing row falls back for this load but keeps the record', async () => {
    // Worktrees answered, so the row is missing rather than unreported: the
    // ceiling can cut a row too, so the sample decides, not the list.
    const out = await load({ seed: SITE, lists: { 'sess-1': { repos: [WORKSPACE_REPO] } } })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site')
    assert.equal(out.tags.at(-1), '', 'the panel returns to the workspace checkout')
    assert.equal(out.record?.repo, 'site', 'the pick survives for the next load')
  })

  // ── the file browser's own pin, repaired the same way ───────────────────
  const PINNED = only({ rootPick: true, files: { mode: 'pin', path: 'site' }, follow: false })

  await phase('a pinned file root is written with the repository pick', async () => {
    const out = await load({ seed: null, steps: [{ tab: 'tab.files' }, { root: 'site' }] })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.record?.files?.mode, 'pin', JSON.stringify(out.record))
    assert.equal(out.record?.files?.path, 'site')
    assert.equal(out.record?.repo, 'site', 'picking a checkout root switches Git too')
  })

  await phase('a stale row deletes the file-root pin but keeps the repository pick', async () => {
    const out = await load({ seed: PINNED, lists: { 'sess-1': { repos: [WORKSPACE_REPO, STALE_REPO] } } })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.record?.files, undefined, 'the pin is forgotten: ' + JSON.stringify(out.record))
    assert.equal(out.record?.rootPick, true, 'the deliberate root pick stays')
  })

  await phase('a list whose worktree probe failed keeps the file-root pin', async () => {
    const out = await load({ seed: PINNED, lists: { 'sess-1': { repos: [WORKSPACE_REPO, STALE_REPO], worktrees: 'failed' } } })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.record?.files?.path, 'site', 'not even a stale row retires a pin then: ' + JSON.stringify(out.record))
  })

  // ── the files-only auto-pick is a convenience, not intent ───────────────
  await phase('the files-only auto-pick writes nothing', async () => {
    const filesOnly = {
      seed: null,
      refuseRoot: { code: 'not-a-git-repo', cwd: '/mock/workspace' },
      lists: { 'sess-1': { repos: [NESTED_REPO] } },
    }
    const first = await load(filesOnly)
    assert.equal(first.error, undefined, first.error)
    assert.equal(first.tags.includes('site'), true, 'the first sub-repository is opened: ' + first.tags.join(','))
    assert.equal(first.record, null, 'and not remembered')
    const again = await load({ ...filesOnly, seed: undefined })
    assert.equal(again.error, undefined, again.error)
    assert.equal(again.tags[0], '', 'a reload derives the pick again instead of restoring it')
  })

  // ── one panel, two sessions ─────────────────────────────────────────────
  await phase('a session switch waits for the next session\'s own list', async () => {
    // sess-1's list carries a stale `site`; sess-2 picked its own `site`, whose
    // list answers late. Judged by sess-1's list, sess-2 would lose its pick.
    const out = await load({
      seed: { 'sess-2': { repo: 'site', at: 1 } },
      lists: {
        'sess-1': { repos: [WORKSPACE_REPO, STALE_REPO] },
        'sess-2': { repos: [WORKSPACE_REPO, NESTED_REPO], delayMs: 400 },
      },
      steps: [{ session: 'sess-2' }],
    })
    assert.equal(out.error, undefined, out.error)
    assert.deepEqual(out.tagsOf['sess-2'], ['site'], 'sess-2 stays on its pick')
    assert.equal(out.records['sess-2']?.repo, 'site', 'and keeps its record')
  })
} finally {
  await browser.close()
}

if (failures.length > 0) {
  console.log(`\n${failures.length} phase(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nrepo-pick-persist: all phases passed')
