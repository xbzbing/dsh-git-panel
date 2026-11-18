/**
 * E2E: Git Flow dialogs run through the shared `onAction` write path.
 *
 * Covers the four things the dialog shell cannot prove on its own:
 *   - the branch-list entry only exists on a host that declares
 *     `capabilities.flow`;
 *   - a start form submits the wire action with the resolved base (`develop`),
 *     not a display label;
 *   - a finish form's squash strategy with the branch delete needs the extra
 *     forced-delete acknowledgement, and the submitted action carries exactly
 *     the choices the form showed (strategy / forceDelete / pushRemote);
 *   - an in-flight submit locks the dialog, and a refusal renders inside it
 *     instead of closing it or claiming success.
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

const SNAP = {
  root: 'flow-fixture', branch: 'feature/login', head: '44638f7', unborn: false,
  dirty: false, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
  hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
  capabilities: {
    revDiff: true, pathHistory: true, commitCheckout: true, branchDelete: true, remoteBranchDelete: true,
    branchCreate: true, branchMerge: true, cherryPick: true, flow: true,
  },
}

/** The branch list the flow dialogs read: both long-lived lines plus one branch
 * of every short-lived kind, and a tag so a release start prefills a version. */
const LOCAL = [
  { name: 'feature/login', shortHash: '44638f7' },
  { name: 'develop', shortHash: 'de54fc0' },
  { name: 'main', shortHash: 'de54fc0' },
  { name: 'release/1.2.0', shortHash: 'de54fc0' },
  { name: 'hotfix/1.2.1', shortHash: 'de54fc0' },
]
const REMOTE_BRANCHES = [
  { name: 'origin/develop', shortHash: 'de54fc0' },
  { name: 'origin/main', shortHash: 'de54fc0' },
]

const browser = await chromium.launch()
const consoleErrors = []

async function flush(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

/** Mount the panel on the Overview tab with a flow-shaped mock connection. */
async function openPanel(snapshot) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } })
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (error) => consoleErrors.push('PAGEERROR ' + error.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  await page.evaluate(({ snapshot, local, remoteBranches }) => {
    const panel = document.getElementById('panel')
    panel.style.width = '900px'
    panel.style.height = '740px'
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    fixture.fingerprints = true
    window.__gpFixture = fixture
    const call = connection.rpc.call
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload?.args?.request
      if (endpoint === 'dbGitPanel/query' && request?.query?.kind === 'branches') {
        fixture.branchQueries += 1
        return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'feature/login', defaultBranch: 'main', local, remote: remoteBranches } } }
      }
      if (endpoint === 'dbGitPanel/query' && request?.query?.kind === 'tags') {
        return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [{ name: 'v1.2.3', shortHash: 'de54fc0' }] } } }
      }
      return call(channel, endpoint, payload)
    }
    const registered = {}
    const dictionaries = {}
    const interpolate = (raw, params) => params === undefined
      ? raw
      : raw.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match))
    const ctx = {
      get: (key) => (key === 'connection' ? connection : undefined),
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: () => () => {},
      inject: (_deps, cb) => cb(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = component; return () => {} } },
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict },
        bind: (ns) => (key, params) => {
          const raw = dictionaries[ns]?.zh[key]
          return raw === undefined ? key : interpolate(raw, params)
        },
      },
    }
    window.__getLoaded().apply(ctx)
    window.ReactDOM.createRoot(panel).render(registered['conversation.view']({ sessionId: 'flow-session' }))
  }, { snapshot, local: LOCAL, remoteBranches: REMOTE_BRANCHES })
  await page.locator('[role="tab"]').first().waitFor()
  await page.waitForFunction(() => window.__gpFixture.snapshotReplies > 0)
  await flush(page)
  return page
}

/** Open the grouped flow menu and pick one entry. */
async function pickEntry(page, name) {
  await page.locator('.gp-flow-btn').click()
  await page.getByRole('menuitem', { name, exact: true }).click()
  await page.locator('.gp-modal--flow').waitFor()
  await flush(page)
}

/** Submit the open dialog and wait for its RPC to settle. */
async function submit(page) {
  await page.locator('.gp-modal__footer .gp-btn--primary').click()
}

async function actions(page) {
  return page.evaluate(() => window.__gpFixture.actions)
}

// ── 1. entry + start form ───────────────────────────────────────────────────

const page = await openPanel(SNAP)
assert.equal(await page.locator('.gp-flow-btn').count(), 1, 'the host capability renders the Git Flow entry')
assert.equal((await page.locator('.gp-flow-btn').textContent()).trim(), 'Git Flow')

await pickEntry(page, '开始 Feature')
assert.equal(await page.locator('.gp-modal--flow .gp-flow__field select').inputValue(), 'develop', 'a feature starts on develop when it exists')
await page.locator('.gp-modal--flow .gp-flow__field input').fill('login2')
await flush(page)
assert.match(await page.locator('.gp-flow__preview').textContent(), /feature\/login2/, 'the form previews the full branch name')
await submit(page)
await page.waitForFunction(() => document.querySelector('.gp-modal--flow') === null)
let sent = await actions(page)
assert.deepEqual(sent[sent.length - 1], { kind: 'flow-start', flow: 'feature', branch: 'feature/login2', base: 'develop' }, 'the start action carries the resolved base')

// ── 2. finish form: squash needs the forced-delete acknowledgement ─────────

await pickEntry(page, '完成 Feature')
const confirm = page.locator('.gp-modal__footer .gp-btn--primary')
assert.equal(await confirm.isDisabled(), false, 'merge + delete is the default and needs no extra step')
assert.equal(await page.locator('.gp-modal__check').count(), 3, 'delete branch / delete remote / push (no force box yet)')

await page.locator('.gp-flow__mode input').nth(1).check()
await flush(page)
assert.equal(await confirm.isDisabled(), true, 'a squashed branch delete needs its own acknowledgement')
const labels = await page.locator('.gp-modal__check').allTextContents()
assert.ok(labels.some((text) => /压缩合并/.test(text)), 'the force checkbox explains why the delete is forced')

await page.locator('.gp-modal__check input').nth(1).check()
await flush(page)
assert.equal(await confirm.isDisabled(), false, 'the acknowledgement unlocks the finish')
const finishLabels = await page.locator('.gp-modal__check').allTextContents()
await page.locator('.gp-modal__check input').nth(3).check()
await flush(page)
assert.ok(finishLabels.length === 4)
await submit(page)
await page.waitForFunction(() => document.querySelector('.gp-modal--flow') === null)
sent = await actions(page)
assert.deepEqual(sent[sent.length - 1], {
  kind: 'flow-finish', flow: 'feature', branch: 'feature/login', target: 'develop',
  strategy: 'squash', message: '完成 git-flow', deleteBranch: true, deleteRemote: false,
  pushRemote: 'origin', forceDelete: true,
}, 'the finish action carries exactly the choices the form showed')

// ── 3. busy lock + a refusal stays inside the dialog ───────────────────────

await pickEntry(page, '完成 Feature')
await page.evaluate(() => {
  const fixture = window.__gpFixture
  fixture.holdRun = { kind: 'flow-finish' }
  fixture.runFailure = { kind: 'flow-finish', code: 'local-changes-block' }
})
const before = (await actions(page)).length
await page.locator('.gp-modal__footer .gp-btn--primary').evaluate((button) => { button.click(); button.click() })
await page.waitForFunction(() => window.__gpFixture.releaseRun !== null)
assert.equal(await page.locator('.gp-modal__footer .gp-btn--primary').isDisabled(), true, 'busy confirm disabled')
assert.equal(await page.locator('.gp-modal__close').isDisabled(), true, 'busy close disabled')
await page.evaluate(() => {
  window.__gpFixture.holdRun = null
  window.__gpFixture.releaseRun()
})
await page.waitForFunction(() => document.querySelector('.gp-modal--flow .gp-feedback') !== null)
assert.match(await page.locator('.gp-modal--flow .gp-feedback').textContent(), /未提交变更/, 'the host refusal renders in the open dialog')
assert.equal(await page.locator('.gp-modal--flow').count(), 1, 'a failure does not close the dialog')
assert.equal((await actions(page)).length, before + 1, 'a double press reaches the wire once')
await page.locator('.gp-modal__footer .gp-btn').first().click()
await page.waitForFunction(() => document.querySelector('.gp-modal--flow') === null)
await page.close()

// ── 4. the entry is gated on the host capability ───────────────────────────

const { capabilities: _capabilities, ...older } = SNAP
const oldHost = await openPanel(older)
assert.equal(await oldHost.locator('.gp-flow-btn').count(), 0, 'an older host gets no flow entry instead of a failing button')
await oldHost.close()

assert.deepEqual(consoleErrors, [], 'no console errors')
await browser.close()
console.log('flow-dialogs: ok')
