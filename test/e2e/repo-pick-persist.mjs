/**
 * E2E: the repository pick survives a reload of the page (and so a hot reload
 * of the bundle, which loses the same in-memory state), and only a refusal the
 * host gave as definitive deletes it.
 *
 * Phases share one page, so the tab's `sessionStorage` carries over between
 * them exactly as it does across the platform's reloads:
 *
 *  1. pick `site` in the switcher; the record is written
 *  2. reload: the very first snapshot is already tagged `site`
 *  3. reload with the tagged sample refused as `unverified`: the panel falls
 *     back, but the record stays
 *  4. reload with a list whose worktree probe failed and lacks the row: the
 *     pick is not retired
 *  5. reload with a definitive `invalid-repo`: the panel falls back and the
 *     record is deleted, so
 *  6. the next reload starts untagged
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

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}
const WORKSPACE_REPO = { path: '', root: 'fixture-repo', name: 'fixture-repo', kind: 'workspace' }
const NESTED_REPO = { path: 'site', root: 'fixture-repo/site', name: 'site', kind: 'nested' }

const browser = await chromium.launch()
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })

/**
 * Load the harness and mount the panel. `refuse` answers every snapshot tagged
 * `site` with that failure; `repos` / `worktrees` shape the repo-list reply.
 * `steps` drives the page once it settled, in order: `{ pick }` clicks that
 * switcher row, `{ tab }` selects a tab, `{ root }` picks that file-root menu
 * entry (the files tab is selected first).
 */
async function load({ refuse = null, repos = [WORKSPACE_REPO, NESTED_REPO], worktrees = 'ok', steps = [] } = {}) {
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  return page.evaluate(async ({ snap, refuse, repos, worktrees, steps, key }) => {
    const { connection } = window.createGitPanelMock(snap)
    const tags = []
    const mockCall = connection.rpc.call
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload && payload.args && payload.args.request
      const tag = request && typeof request.repo === 'string' ? request.repo : ''
      if (endpoint === 'dbGitPanel/snapshot') {
        tags.push(tag)
        if (tag === 'site' && refuse !== null) return { ok: true, value: { ok: false, error: refuse } }
        return { ok: true, value: { ok: true, value: { ...snap, root: tag === '' ? snap.root : 'fixture-repo/' + tag, checkedAt: Date.now() } } }
      }
      if (endpoint === 'dbGitPanel/query' && request && request.query && request.query.kind === 'repo-list') {
        return { ok: true, value: { ok: true, value: { kind: 'repo-list', cwd: '/mock/workspace', repos, worktrees } } }
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
    window.ReactDOM.createRoot(document.getElementById('panel')).render(view.component({ sessionId: 'sess-1' }))
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const until = async (cond, ms = 2000) => {
      const start = Date.now()
      while (!cond() && Date.now() - start < ms) await wait(20)
      return cond()
    }
    const rows = () => [...document.querySelectorAll('.gp-panel .gp-repolist__item')]
    const nameOf = (node) => (node.querySelector('.gp-repolist__name')?.textContent ?? '').replace(/\u200e/g, '').trim()
    const tabNodes = () => [...document.querySelectorAll('.gp-panel .gp-tabbar__tabs [role="tab"]')]
    const labelOf = (node) => (node.querySelector('.gp-tab__label') || node).textContent.trim()
    const clickTab = async (label) => {
      const node = tabNodes().find((n) => labelOf(n) === label)
      if (!node) return 'no tab ' + label + ' in ' + tabNodes().map(labelOf).join('|')
      node.click()
      await wait(250)
      return null
    }
    const pickRow = async (name) => {
      const row = rows().find((node) => nameOf(node) === name)
      if (!row) return 'no row ' + name + ' in ' + rows().map(nameOf).join('|')
      row.click()
      await wait(350)
      return null
    }
    // The file browser's root dropdown: the trigger names the current root and
    // the menu lists the project root plus every checkout.
    const clickRoot = async (name) => {
      const trigger = document.querySelector('.gp-panel .gp-files__status-path')
      if (trigger === null) return 'no browse-root trigger'
      if (trigger.getAttribute('aria-expanded') !== 'true') {
        trigger.click()
        await wait(200)
      }
      const menu = document.querySelector('.gp-panel .gp-files__rootmenu')
      const items = menu === null ? [] : [...menu.querySelectorAll('.gp-files__rootmenu__item')]
      const item = items.find((node) => (node.querySelector('.gp-files__rootmenu__name')?.textContent ?? '').trim() === name)
      if (!item) return 'no root ' + name + ' in ' + items.map((n) => (n.querySelector('.gp-files__rootmenu__name')?.textContent ?? '').trim()).join('|')
      item.click()
      await wait(350)
      return null
    }
    await until(() => tabNodes().length === 3 && rows().length > 0)
    await wait(250)
    for (const step of steps) {
      const failure = step.pick !== undefined ? await pickRow(step.pick)
        : step.tab !== undefined ? await clickTab(step.tab)
          : step.root !== undefined ? await clickRoot(step.root)
            : 'unknown step ' + JSON.stringify(step)
      if (failure !== null) return { error: failure }
    }
    const active = rows().find((node) => node.classList.contains('gp-repolist__item--active'))
    const raw = sessionStorage.getItem(key)
    return {
      tags,
      active: active ? nameOf(active) : null,
      record: raw === null ? null : (JSON.parse(raw).sessions ?? {})['sess-1'] ?? null,
    }
  }, { snap: SNAP, refuse, repos, worktrees, steps, key: KEY })
}

const failures = []
async function phase(name, fn) {
  try {
    await fn()
    console.log('PASS ' + name)
  } catch (error) {
    failures.push(name)
    console.log('FAIL ' + name + '\n' + (error && error.stack ? error.stack : error))
  }
}

try {
  await phase('a pick writes the tab record', async () => {
    const out = await load({ steps: [{ pick: 'site' }] })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], '', 'a fresh tab starts on the workspace checkout')
    assert.equal(out.active, 'site')
    assert.equal(out.record?.repo, 'site')
  })

  await phase('a reload samples the picked checkout from the first frame', async () => {
    const out = await load()
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site', 'no untagged sample before the restored one: ' + out.tags.join(','))
    assert.equal(out.tags.includes(''), false, 'the workspace checkout is never sampled')
    assert.equal(out.active, 'site')
  })

  await phase('an unverified refusal falls back but keeps the record', async () => {
    const out = await load({ refuse: { code: 'invalid-repo', cwd: '/mock/workspace', unverified: true } })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site')
    assert.equal(out.tags.at(-1), '', 'the panel returns to the workspace checkout')
    assert.equal(out.record?.repo, 'site', 'the next load tries the pick again')
  })

  await phase('a list whose worktree probe failed retires nothing', async () => {
    const out = await load({ repos: [WORKSPACE_REPO], worktrees: 'failed' })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags.includes(''), false, 'the pick is not dropped: ' + out.tags.join(','))
    assert.equal(out.record?.repo, 'site')
  })

  await phase('a definitive refusal deletes the record', async () => {
    const out = await load({ refuse: { code: 'invalid-repo', cwd: '/mock/workspace' } })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site')
    assert.equal(out.tags.at(-1), '')
    assert.equal(out.record?.repo, undefined)
  })

  await phase('after the deletion a reload starts on the workspace checkout', async () => {
    const out = await load()
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], '')
    assert.equal(out.tags.includes('site'), false)
    assert.equal(out.active, 'fixture-repo')
  })

  // ── the list's own verdict (not the sample's) drives the repair ──────────
  await phase('a pick is written again for the list-verdict phases', async () => {
    const out = await load({ steps: [{ pick: 'site' }] })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.record?.repo, 'site')
  })

  await phase('a row git reports as stale falls back and deletes the record', async () => {
    const out = await load({ repos: [WORKSPACE_REPO, { ...NESTED_REPO, disabled: 'stale' }] })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site', 'the restored pick is sampled first')
    assert.equal(out.tags.at(-1), '', 'the list repair returns to the workspace checkout')
    assert.equal(out.record?.repo, undefined, 'a stale row is definitive')
  })

  await phase('a missing row falls back for this load but keeps the record', async () => {
    const picked = await load({ steps: [{ pick: 'site' }] })
    assert.equal(picked.record?.repo, 'site')
    // Worktrees answered, so the row is missing rather than unreported: the
    // ceiling can cut a row too, so the sample decides, not the list.
    const out = await load({ repos: [WORKSPACE_REPO] })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site')
    assert.equal(out.tags.at(-1), '', 'the panel returns to the workspace checkout')
    assert.equal(out.record?.repo, 'site', 'the pick survives for the next load')
  })

  await phase('the kept record is restored by the next load', async () => {
    const out = await load()
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.tags[0], 'site')
    assert.equal(out.active, 'site')
  })

  // ── the file browser's own pin, repaired the same way ───────────────────
  await phase('a pinned file root is written with the repository pick', async () => {
    const out = await load({ steps: [{ tab: 'tab.files' }, { root: 'site' }] })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.record?.files?.mode, 'pin', JSON.stringify(out.record))
    assert.equal(out.record?.files?.path, 'site')
    assert.equal(out.record?.repo, 'site', 'picking a checkout root switches Git too')
  })

  await phase('a stale row deletes the file-root pin but keeps the repository pick', async () => {
    // Back on the workspace checkout first: the stale row must repair the pin
    // on its own, without the repository pick taking the blame.
    const pinned = await load({
      steps: [{ tab: 'tab.files' }, { root: 'site' }, { tab: 'tab.overview' }, { pick: 'fixture-repo' }],
    })
    assert.equal(pinned.error, undefined, pinned.error)
    assert.equal(pinned.record?.rootPick, true, JSON.stringify(pinned.record))
    assert.equal(pinned.record?.files?.path, 'site')

    const out = await load({ repos: [WORKSPACE_REPO, { ...NESTED_REPO, disabled: 'stale' }] })
    assert.equal(out.error, undefined, out.error)
    assert.equal(out.record?.files, undefined, 'the pin is forgotten')
    assert.equal(out.record?.rootPick, true, 'the deliberate root pick stays')
  })

  await phase('no page errors', async () => {
    assert.deepEqual(errors, [])
  })
} finally {
  await browser.close()
}

if (failures.length > 0) {
  console.log(`\n${failures.length} phase(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nrepo-pick-persist: all phases passed')
