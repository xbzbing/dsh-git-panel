/**
 * E2E: the workspace-file hint row and the enable action (issue #125, ADR-0035).
 *
 * A cwd that holds a `.code-workspace` file is the whole point of the setting,
 * but with the setting `off` the panel used to say nothing at all: the feature
 * existed only for someone who already knew the config key. The repository list
 * now states what it found and offers the one-click switch, and it renders that
 * row even when it has no checkout to list (a hub directory: the case the
 * feature was built for). A configured but unusable file states why instead of
 * leaving an empty list unexplained.
 *
 * The enable path is end to end here: the click writes `codeWorkspace: auto`
 * through the settings form and the list is fetched again until the host
 * answers with the roots — the hint must not be a dead label.
 *
 * Also pins the row rule the same release changed: a worktree of the session's
 * own repository outside the cwd is selectable, not a disabled row.
 *
 * Fully isolated — a local file:// harness, no dsh server, no running instance.
 */
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const WORKSPACE = { path: '', root: '/mock/hub', name: 'hub', kind: 'workspace', role: 'main', branch: 'main' }
const EXTERNAL = { path: '../service-a', root: '/mock/service-a', name: 'service-a', kind: 'external', role: 'repo', label: 'API' }
// The row this release made selectable: a worktree of the session's own
// repository, created outside the cwd. No `disabled` field — the host only
// emits one when no relative selector exists (another Windows drive).
const OUTSIDE_WORKTREE = { path: '../spike', root: '/mock/spike', name: 'spike', kind: 'nested', role: 'linked', branch: 'spike' }

/** The few strings this runner asserts on; every other key renders as itself. */
const DICT = {
  'repos.workspaceAvailable': 'Found {file}: its repositories can join the list',
  'repos.workspaceMany': 'Found {n} workspace files: choose one in the plugin settings',
  'repos.workspaceEnable': 'Enable',
  'repos.workspaceEnabling': 'Enabling…',
  'repos.workspaceMissing': 'Workspace file {file} not found',
  'repos.workspaceInvalid': 'Workspace file unusable',
  'repos.workspaceAmbiguous': 'Several workspace files: auto-detect cannot choose',
  'repos.workspaceEmpty': 'Workspace file enabled, but none of its folders is a repository',
}

const browser = await chromium.launch()

/**
 * Mount the panel with one repo-list answer. `withForm` decides whether the
 * settings service exists — the enable action hides itself without it.
 */
async function mount({ repos, repoWorkspace, withForm = true }) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 820 } })
  const errors = []
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  await page.evaluate(async ({ snap, listed, workspace, withForm, dict }) => {
    const { fixture, connection } = window.createGitPanelMock(snap)
    fixture.repos = listed
    if (workspace !== undefined) fixture.repoWorkspace = workspace
    const calls = []
    const mockCall = connection.rpc.call
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload && payload.args && payload.args.request
      if (endpoint === 'dbGitPanel/query' && request && request.query && request.query.kind === 'repo-list') calls.push(1)
      return mockCall(channel, endpoint, payload)
    }
    const value = { showInputPill: true, placement: 'all', codeWorkspace: 'off' }
    const settings = { view: { namespaces: [{ ns: 'dbGitPanel', schema: { dict: { showInputPill: {}, placement: {}, codeWorkspace: {} } }, value }] }, status: 'ready' }
    const configForms = {
      describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value, revision: 0, writable: true }),
        subscribe: () => () => {},
        set: async () => true,
      }),
    }
    const services = withForm ? { connection, configForms } : { connection }
    window.__gpRepoListCalls = () => calls.length
    window.__gpRegistered = {}
    const registered = window.__gpRegistered
    const ctx = {
      get: (k) => services[k],
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: () => () => {},
      inject: (_deps, cb) => cb(ctx),
      slots: {
        inject: (name, provider) => provider(),
        register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} },
      },
      locale: { register: () => () => {}, bind: () => (key, params) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? '')) },
    }
    window.__getLoaded().apply(ctx)
    const view = registered['conversation.view']
    if (!view) throw new Error('conversation.view was not registered')
    window.ReactDOM.createRoot(document.getElementById('panel'))
      .render(view.component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 500))
  }, { snap: SNAP, listed: repos, workspace: repoWorkspace, withForm, dict: DICT })
  return { page, errors }
}

try {
  // ── 1. A hub with one workspace file: the block appears just to say so ──
  {
    const { page, errors } = await mount({
      repos: [],
      repoWorkspace: { state: 'available', file: '/mock/hub/lab.code-workspace', count: 1 },
    })
    const boot = await page.evaluate(() => {
      const hint = document.querySelector('.gp-repolist__hint')
      return {
        block: document.querySelector('.gp-repolist') !== null,
        rows: document.querySelectorAll('.gp-repolist__item').length,
        hint: hint === null ? null : hint.textContent,
        button: hint === null ? null : hint.querySelector('.gp-repolist__hint-act')?.textContent ?? null,
        warn: hint === null ? null : hint.classList.contains('gp-repolist__hint--warn'),
      }
    })
    assert.equal(boot.block, true, 'a hub with a workspace file renders the block (it used to be hidden)')
    assert.equal(boot.rows, 0, 'the offer adds no repository rows')
    assert.match(boot.hint, /lab\.code-workspace/, 'the row names the file it found')
    assert.equal(boot.button, 'Enable', 'the row carries the one-click switch')
    assert.equal(boot.warn, false, 'an offer is not a warning')
    assert.deepEqual(errors, [])
    await page.close()
  }

  // ── 2. Without the settings service there is nothing to click ────────────
  {
    const { page } = await mount({
      repos: [],
      repoWorkspace: { state: 'available', file: '/mock/hub/lab.code-workspace', count: 1 },
      withForm: false,
    })
    const act = await page.evaluate(() => document.querySelector('.gp-repolist__hint-act') === null)
    assert.equal(act, true, 'the switch hides when it could not write')
    await page.close()
  }

  // ── 3. Enabling it: the write lands and the list is fetched again ────────
  {
    const page = await browser.newPage({ viewport: { width: 1200, height: 820 } })
    const errors = []
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
    await page.goto(harness)
    await page.addScriptTag({ path: resolve(DIR, 'client.js') })
    await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
    await page.evaluate(async ({ snap, dict }) => {
      const { fixture, connection } = window.createGitPanelMock(snap)
      fixture.repos = []
      fixture.repoWorkspace = { state: 'available', file: '/mock/hub/lab.code-workspace', count: 1 }
      const writes = []
      let repoListCalls = 0
      const mockCall = connection.rpc.call
      connection.rpc.call = async (channel, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'dbGitPanel/query' && request && request.query && request.query.kind === 'repo-list') repoListCalls += 1
        return mockCall(channel, endpoint, payload)
      }
      const value = { showInputPill: true, placement: 'all', codeWorkspace: 'off' }
      const settings = { view: { namespaces: [{ ns: 'dbGitPanel', schema: { dict: { showInputPill: {}, placement: {}, codeWorkspace: {} } }, value }] }, status: 'ready' }
      const configForms = {
        describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
        get: () => ({
          getSnapshot: () => ({ status: 'ready', value, revision: 0, writable: true }),
          subscribe: () => () => {},
          set: async (field, next) => {
            writes.push([field, next])
            if (field === 'codeWorkspace') {
              // The next read answers as an enabled host would: the file is
              // recognized, its roots are listed, and a worktree of the own
              // repository that lives outside the cwd is a selectable row.
              fixture.repoWorkspace = { state: 'applied', file: '/mock/hub/lab.code-workspace' }
              fixture.repos = [
                { path: '', root: '/mock/hub', name: 'hub', kind: 'workspace', role: 'main', branch: 'main' },
                { path: '../service-a', root: '/mock/service-a', name: 'service-a', kind: 'external', role: 'repo', label: 'API' },
                { path: '../spike', root: '/mock/spike', name: 'spike', kind: 'nested', role: 'linked', branch: 'spike' },
              ]
            }
            return true
          },
        }),
      }
      window.__gpWrites = writes
      window.__gpRepoListCalls = () => repoListCalls
      const registered = {}
      const ctx = {
        get: (k) => ({ connection, configForms })[k],
        effect: (cb) => { try { cb() } catch { /* ignore */ } },
        on: () => () => {},
        inject: (_deps, cb) => cb(ctx),
        slots: {
          inject: (name, provider) => provider(),
          register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} },
        },
        locale: { register: () => () => {}, bind: () => (key, params) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? '')) },
      }
      window.__getLoaded().apply(ctx)
      const view = registered['conversation.view']
      if (!view) throw new Error('conversation.view was not registered')
      window.ReactDOM.createRoot(document.getElementById('panel'))
        .render(view.component({ sessionId: 'sess-1' }))
      await new Promise((r) => setTimeout(r, 500))
    }, { snap: SNAP, dict: DICT })

    await page.click('.gp-repolist__hint-act')
    const written = await page.evaluate(() => window.__gpWrites)
    assert.deepEqual(written, [['codeWorkspace', 'auto']], 'the switch writes the setting through the settings form')

    // The list is read again after the write settles; the roots replace the
    // offer once they arrive.
    await page.waitForFunction(() => document.querySelector('.gp-repolist__hint') === null, null, { timeout: 6000 })
    const after = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.gp-repolist__name')].map((el) => el.textContent),
      calls: window.__gpRepoListCalls(),
      disabled: [...document.querySelectorAll('.gp-repolist__item')].map((el) => el.classList.contains('gp-repolist__item--disabled')),
    }))
    // The family groups first (own checkout, then its worktrees), then the
    // foreign roots; within a group the host's order is preserved.
    assert.deepEqual(after.rows, ['hub', 'spike', 'API'], 'the roots the file certifies become rows')
    assert.ok(after.calls >= 2, 'the list was fetched again after the write')
    assert.deepEqual(after.disabled, [false, false, false], 'a worktree outside the cwd is selectable, not a dead row')
    assert.deepEqual(errors, [])
    await page.close()
  }

  // ── 4. A configured file that cannot be used says why ───────────────────
  {
    const { page } = await mount({
      repos: [WORKSPACE, EXTERNAL],
      repoWorkspace: { state: 'missing', file: '/mock/hub/gone.code-workspace' },
    })
    const hint = await page.evaluate(() => {
      const el = document.querySelector('.gp-repolist__hint')
      return {
        text: el?.textContent ?? null,
        warn: el?.classList.contains('gp-repolist__hint--warn') ?? null,
        noAction: el?.querySelector('.gp-repolist__hint-act') === null,
      }
    })
    assert.match(hint.text, /gone\.code-workspace/, 'a typo names the file it could not find')
    assert.match(hint.text, /not found/)
    assert.equal(hint.warn, true, 'a configured-but-unusable file is a warning')
    assert.equal(hint.noAction, true, 'nothing to enable here: the row is a statement')
    await page.close()
  }

  // ── 5. No hint and one checkout: the block stays out of the way ──────────
  {
    const { page } = await mount({ repos: [WORKSPACE] })
    const seen = await page.evaluate(() => ({
      block: document.querySelector('.gp-repolist') !== null,
      hint: document.querySelector('.gp-repolist__hint') !== null,
    }))
    assert.equal(seen.block, false, 'one checkout is not a choice')
    assert.equal(seen.hint, false)
    await page.close()
  }

  // ── 6. Several candidates: stated, but nothing to click ──────────────────
  {
    const { page } = await mount({
      repos: [WORKSPACE, OUTSIDE_WORKTREE],
      repoWorkspace: { state: 'available', count: 2 },
    })
    const hint = await page.evaluate(() => {
      const el = document.querySelector('.gp-repolist__hint')
      return { text: el?.textContent ?? null, act: el?.querySelector('.gp-repolist__hint-act') ?? null }
    })
    assert.match(hint.text, /2 workspace files/, 'the count is stated')
    assert.equal(hint.act, null, 'auto cannot choose between them, so there is no switch to offer')
    await page.close()
  }

  // ── 7. Enabled but nothing to show: the row says which state the file is in ─
  {
    const { page } = await mount({
      repos: [WORKSPACE],
      repoWorkspace: { state: 'applied', file: '/mock/hub/lab.code-workspace' },
    })
    const hint = await page.evaluate(() => {
      const el = document.querySelector('.gp-repolist__hint')
      return {
        text: el?.textContent ?? null,
        warn: el?.classList.contains('gp-repolist__hint--warn') ?? null,
        noAction: el?.querySelector('.gp-repolist__hint-act') === null,
      }
    })
    assert.match(hint.text, /enabled/, 'an enabled file with no checkout says so instead of doing nothing')
    assert.equal(hint.warn, true, 'it is a warning: the feature is on and produces nothing')
    assert.equal(hint.noAction, true, 'nothing to click — the file is already read')
    await page.close()
  }

  console.log('code-workspace-hint: all assertions passed')
} finally {
  await browser.close()
}
