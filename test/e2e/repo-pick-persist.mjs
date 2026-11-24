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
 * `pick` clicks that row once the panel settled.
 */
async function load({ refuse = null, repos = [WORKSPACE_REPO, NESTED_REPO], worktrees = 'ok', pick = null } = {}) {
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  return page.evaluate(async ({ snap, refuse, repos, worktrees, pick, key }) => {
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
    await until(() => document.querySelectorAll('.gp-panel .gp-tabbar__tabs [role="tab"]').length === 3 && rows().length > 0)
    await wait(250)
    if (pick !== null) {
      const row = rows().find((node) => nameOf(node) === pick)
      if (!row) return { error: 'no row ' + pick }
      row.click()
      await until(() => tags.includes(pick))
      await wait(250)
    }
    const active = rows().find((node) => node.classList.contains('gp-repolist__item--active'))
    const raw = sessionStorage.getItem(key)
    return {
      tags,
      active: active ? nameOf(active) : null,
      record: raw === null ? null : (JSON.parse(raw).sessions ?? {})['sess-1'] ?? null,
    }
  }, { snap: SNAP, refuse, repos, worktrees, pick, key: KEY })
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
    const out = await load({ pick: 'site' })
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
