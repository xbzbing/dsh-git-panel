/**
 * E2E: publishing a branch that only exists locally (issue #63), and attaching
 * the upstream when the same-named remote branch already points at HEAD.
 *
 * A fresh local branch has no upstream, so the ordinary push is (correctly)
 * unavailable — but creating a same-named remote branch cannot overwrite
 * anything, and that is exactly the moment a user wants a "publish" entry. When
 * that remote branch already exists at HEAD, pushing would send nothing: the
 * same control attaches the tracking config instead (`set-upstream`). Both
 * surfaces must offer either intent:
 *   - the overview status bar button (publish / set-upstream replaces push),
 *   - the changes page toolbar upload icon, which switches intent instead of
 *     sitting there disabled.
 *
 * Also pins the states that must NOT offer a remote write: detached HEAD, an
 * unborn repo (no commits to send), no remote at all, and a branch that already
 * has an upstream.
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(DIR, 'harness.html')

const REMOTE = { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' }
const ICODE = { name: 'icode', url: 'ssh://xubingzhen@icode.baidu.com:8235/baidu/personal-code/repo', webUrl: null, host: 'icode.baidu.com', hostKind: 'other' }

/** A local-only branch: one commit, no upstream, a remote to publish to. */
const LOCAL_ONLY = {
  root: 'publish-fixture', branch: 'feature/new', head: 'abc1234', unborn: false,
  dirty: false, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
  hasUpstream: false, remote: REMOTE, lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
const consoleErrors = []

async function flush(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

/** Mount the panel on the Changes tab with a recording mock connection. */
async function openPanel(snapshot, { tab = 1 } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 764 } })
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (error) => consoleErrors.push('PAGEERROR ' + error.message))
  await page.goto(harness)
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  await page.evaluate(({ snapshot }) => {
    const panel = document.getElementById('panel')
    panel.style.width = '1000px'
    panel.style.height = '764px'
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    fixture.fingerprints = true
    fixture.publishCalls = 0
    fixture.holdPublish = false
    fixture.releasePublish = null
    fixture.publishFailure = null
    fixture.setUpstreamCalls = 0
    fixture.holdSetUpstream = false
    fixture.releaseSetUpstream = null
    fixture.setUpstreamFailure = null
    window.__gpFixture = fixture
    const call = connection.rpc.call
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload?.args?.request
      const kind = request?.action?.kind
      if (endpoint === 'dbGitPanel/run' && (kind === 'publish' || kind === 'set-upstream')) {
        fixture.actions.push(request.action)
        if (kind === 'publish') {
          fixture.publishCalls++
          if (fixture.holdPublish) await new Promise((done) => { fixture.releasePublish = done })
          fixture.releasePublish = null
          if (fixture.publishFailure !== null) {
            const failure = fixture.publishFailure
            fixture.publishFailure = null
            return { ok: true, value: { ok: false, error: failure } }
          }
        } else {
          fixture.setUpstreamCalls++
          if (fixture.holdSetUpstream) await new Promise((done) => { fixture.releaseSetUpstream = done })
          fixture.releaseSetUpstream = null
          if (fixture.setUpstreamFailure !== null) {
            const failure = fixture.setUpstreamFailure
            fixture.setUpstreamFailure = null
            return { ok: true, value: { ok: false, error: failure } }
          }
        }
        fixture.snapshot = { ...fixture.snapshot, hasUpstream: true, remoteBranchAtHead: false, remoteCandidates: [] }
        return { ok: true, value: { ok: true, snapshot: fixture.snapshot } }
      }
      return call(channel, endpoint, payload)
    }
    const registered = {}
    const dictionaries = {}
    const interpolate = (raw, params) => params === undefined
      ? raw
      : raw.replace(/\{(\w+)\}/g, (m, key) => (key in params ? String(params[key]) : m))
    const ctx = {
      get: (key) => (key === 'connection' ? connection : undefined),
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: (event, listener) => { if (event === 'connection/reset') fixture.resetConnection = listener; return () => {} },
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
    window.ReactDOM.createRoot(panel).render(registered['conversation.view']({ sessionId: 'publish-session' }))
  }, { snapshot })
  await page.locator('[role="tab"]').nth(tab).waitFor()
  await page.locator('[role="tab"]').nth(tab).click()
  await page.waitForFunction(() => window.__gpFixture.snapshotReplies > 0)
  await flush(page)
  return page
}

/** Re-serve a different snapshot through a page-owned refresh control. The
 * overview drives sync through the status-bar check button; the changes page
 * has no status bar, so it re-samples through its own toolbar refresh. */
async function feed(page, patch, control = '.gp-statusbar__btn') {
  await page.evaluate((patch) => {
    window.__gpFixture.snapshot = { ...window.__gpFixture.snapshot, ...patch }
  }, patch)
  const before = await page.evaluate(() => window.__gpFixture.snapshotReplies)
  await page.locator(control).click()
  await page.waitForFunction((n) => window.__gpFixture.snapshotReplies > n, before)
  await flush(page)
}

async function counts(page) {
  return page.evaluate(() => ({
    publishCalls: window.__gpFixture.publishCalls,
    setUpstreamCalls: window.__gpFixture.setUpstreamCalls,
    actions: window.__gpFixture.actions.map((a) => a.kind),
  }))
}

/** The changes page: the toolbar upload icon is its only publish entry. */
async function changesPageScenario() {
  const page = await openPanel(LOCAL_ONLY)
  // One entry on this page: the upload icon switches intent instead of sitting
  // disabled. The old full-width "Publish Branch" strip above the commit editor
  // is gone — two controls for one action read as two different actions.
  assert.equal(await page.locator('.gp-publishbar').count(), 0, 'no publish strip above the commit editor')
  assert.equal(await page.locator('.gp-changes__push').isEnabled(), true, 'the toolbar upload icon offers publish instead of sitting disabled')
  assert.equal(await page.locator('.gp-changes__push').getAttribute('aria-label'), '发布分支并设置上游', 'the toolbar icon is named for the publish intent')
  // Tip/aria state the publish intent; no push-only wording leaks in.
  assert.ok(!/推送本地提交到远程/.test(await page.locator('.gp-changes__push').getAttribute('aria-label') ?? ''), 'publish does not read as push')

  // The icon opens the shared confirm dialog.
  await page.locator('.gp-changes__push').click()
  await page.locator('.gp-modal--sm').waitFor()
  const dialog = await page.locator('.gp-modal--sm').evaluate((modal) => ({
    title: modal.querySelector('.gp-modal__path').textContent,
    body: modal.querySelector('.gp-modal__confirmtext').textContent,
    confirm: modal.querySelector('.gp-modal__footer .gp-btn--primary').textContent,
    portaled: !document.getElementById('panel').contains(modal),
  }))
  assert.equal(dialog.title, '发布分支到远程')
  assert.match(dialog.body, /feature\/new.*origin/, 'the confirm names the branch and the remote')
  assert.equal(dialog.confirm, '发布')
  assert.equal(dialog.portaled, true, 'the publish dialog is portaled')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.gp-modal--sm') === null)
  assert.deepEqual((await counts(page)).actions, [], 'cancelling publishes nothing')

  // A double click on confirm must reach the wire exactly once, and the panel
  // locks while it is in flight.
  await page.locator('.gp-changes__push').click()
  await page.locator('.gp-modal__footer .gp-btn--primary').waitFor()
  await page.evaluate(() => { window.__gpFixture.holdPublish = true })
  await page.locator('.gp-modal__footer .gp-btn--primary').evaluate((button) => { button.click(); button.click() })
  await page.waitForFunction(() => window.__gpFixture.releasePublish !== null)
  await page.locator('.gp-modal__overlay').waitFor()
  assert.equal(await page.locator('.gp-modal__overlay-label').textContent(), '发布中…')
  assert.equal(await page.locator('.gp-modal__footer .gp-btn--primary').isDisabled(), true, 'busy confirm disabled')
  assert.equal(await page.locator('.gp-modal__close').isDisabled(), true, 'busy close disabled')
  assert.equal(await page.locator('.gp-changes__push').isDisabled(), true, 'the toolbar control locks while publishing')
  assert.equal(await page.evaluate(() => window.__gpFixture.publishCalls), 1, 'busy guard prevents duplicate publishes')
  await page.evaluate(() => {
    window.__gpFixture.holdPublish = false
    window.__gpFixture.releasePublish()
  })
  await page.waitForFunction(() => document.querySelector('.gp-modal--sm') === null)
  assert.deepEqual((await counts(page)).actions, ['publish'], 'confirm sends exactly one publish action')
  assert.equal(await page.evaluate(() => window.__gpFixture.actions[0].remote), 'origin', 'the action carries the primary remote name')
  // The branch has an upstream now and nothing to send, so the same control
  // reads as push and is unavailable: publish is gone from this page.
  assert.equal(await page.locator('.gp-changes__push').getAttribute('aria-label'), '推送本地提交到远程', 'the toolbar icon falls back to push once the branch has an upstream')
  assert.equal(await page.locator('.gp-changes__push').isDisabled(), true, 'a synced branch has no remote write to offer')
  await page.close()
}

/** A refusal stays inside the open dialog and can be retried. */
async function publishFailureScenario() {
  const page = await openPanel(LOCAL_ONLY)
  await page.locator('.gp-changes__push').click()
  await page.locator('.gp-modal--sm').waitFor()
  await page.evaluate(() => { window.__gpFixture.publishFailure = { code: 'auth-failed' } })
  await page.locator('.gp-modal__footer .gp-btn--primary').click()
  await page.waitForFunction(() => document.querySelector('.gp-modal--sm .gp-feedback') !== null)
  assert.equal(
    await page.locator('.gp-modal--sm .gp-feedback').textContent(),
    '认证失败：没有可用的 git 凭据（HTTPS 需凭据助手、SSH 需密钥）。请先在命令行完成一次推送以缓存凭据',
    'the failure is localized from the wire code inside the dialog',
  )
  assert.equal(await page.locator('.gp-modal__overlay').count(), 0, 'a failed publish unlocks the dialog')
  assert.equal(await page.locator('.gp-modal__footer .gp-btn--primary').isEnabled(), true, 'a failed publish can be retried')
  assert.equal(await page.locator('.gp-changes__push').isDisabled(), false, 'the toolbar control unlocks again')
  await page.close()
}

/** States that must never offer a publish. */
async function unavailableScenario() {
  const cases = [
    ['detached HEAD', { branch: null }],
    ['no commits yet', { unborn: true, head: null }],
    ['no remote', { remote: null }],
    ['already tracked', { hasUpstream: true }],
  ]
  for (const [state, patch] of cases) {
    const page = await openPanel(LOCAL_ONLY)
    await feed(page, patch, '.gp-changes__refresh')
    assert.equal(await page.locator('.gp-changes__push').isDisabled(), true, `${state}: the upload icon is unavailable`)
    await page.close()
  }
}

/** The overview status bar swaps push for publish on the same snapshot. */
async function statusBarScenario() {
  const page = await openPanel(LOCAL_ONLY, { tab: 0 })
  const barButton = (label) => page.locator(`.gp-col--left .gp-statusbar__sync button[aria-label="${label}"]`)
  assert.equal(await barButton('发布分支并设置上游').count(), 1, 'a local-only branch offers publish in the status bar')
  assert.equal(await barButton('推送本地提交到远程').count(), 0, 'push is not offered alongside publish')
  await barButton('发布分支并设置上游').click()
  await page.locator('.gp-modal--sm').waitFor()
  assert.equal(await page.locator('.gp-modal__path').textContent(), '发布分支到远程', 'the status bar opens the same publish dialog')
  await page.locator('.gp-modal__footer .gp-btn--primary').click()
  await page.waitForFunction(() => document.querySelector('.gp-modal--sm') === null)
  assert.deepEqual((await counts(page)).actions, ['publish'], 'the status-bar publish sends one action')
  assert.equal(await barButton('发布分支并设置上游').count(), 0, 'publish disappears once the upstream exists')
  await page.close()
}

/** A same-named remote branch at HEAD opens the chooser even with one
 * candidate; confirming attaches tracking and the control falls back to push. */
async function setUpstreamChangesScenario() {
  const page = await openPanel({ ...LOCAL_ONLY, remoteBranchAtHead: true })
  const button = page.locator('.gp-changes__push')
  assert.equal(await button.isEnabled(), true, 'the toolbar control is live')
  assert.equal(await button.getAttribute('aria-label'), '设置上游', 'the control is named for attaching, not publishing')
  await button.click()
  await page.locator('.gp-modal--sm').waitFor()
  assert.equal(await page.locator('.gp-modal__path').textContent(), '设置上游', 'the dialog is the chooser')
  const dialog = await page.locator('.gp-modal--sm').evaluate((modal) => ({
    body: modal.querySelector('.gp-modal__confirmtext').textContent,
    options: [...modal.querySelectorAll('.gp-upstream__option')].map((o) => o.textContent),
    checked: [...modal.querySelectorAll('.gp-upstream__option input')].findIndex((i) => i.checked),
  }))
  assert.match(dialog.body, /feature\/new/, 'the body names the current branch')
  assert.match(dialog.body, /不推送/, 'the body states the config-only contract')
  assert.equal(dialog.options.length, 1, 'a single candidate still opens the chooser')
  assert.equal(dialog.checked, 0, 'the only candidate is preselected')
  await page.locator('.gp-modal__footer .gp-btn--primary').click()
  await page.waitForFunction(() => window.__gpFixture.setUpstreamCalls === 1)
  await page.waitForFunction(() => document.querySelector('.gp-modal--sm') === null)
  assert.deepEqual((await counts(page)).actions, ['set-upstream'], 'the changes page sends set-upstream')
  assert.equal(await page.evaluate(() => window.__gpFixture.actions[0].remote), 'origin', 'the action carries the chosen remote')
  // The mock reports a tracked snapshot: the control falls back to push and is
  // unavailable because the branch is now synced.
  await page.waitForFunction(() => document.querySelector('.gp-changes__push')?.getAttribute('aria-label') === '推送本地提交到远程')
  assert.equal(await button.isDisabled(), true, 'a synced branch has no remote write to offer')
  await page.close()
}

/** The status bar opens the same chooser and reports the in-flight write. */
async function setUpstreamStatusBarScenario() {
  const page = await openPanel({ ...LOCAL_ONLY, remoteBranchAtHead: true }, { tab: 0 })
  const button = page.locator('.gp-col--left .gp-statusbar__sync button[aria-label="设置上游"]')
  assert.equal(await button.count(), 1, 'the status bar offers set-upstream')
  assert.equal(await page.locator('.gp-statusbar button[aria-label="发布分支并设置上游"]').count(), 0, 'publish is not offered alongside it')
  await button.click()
  await page.locator('.gp-modal--sm').waitFor()
  await page.evaluate(() => { window.__gpFixture.holdSetUpstream = true })
  await page.locator('.gp-modal__footer .gp-btn--primary').click()
  await page.waitForFunction(() => window.__gpFixture.releaseSetUpstream !== null)
  assert.equal(await page.locator('.gp-statusbar__state').textContent(), '设置上游中…', 'the status bar names the in-flight config write')
  assert.equal(await page.locator('.gp-modal__overlay').count(), 1, 'the chooser stays up while the write runs')
  assert.equal(await page.locator('.gp-modal__footer .gp-btn--primary').isDisabled(), true, 'the confirm locks while the write is in flight')
  assert.equal(await page.evaluate(() => window.__gpFixture.setUpstreamCalls), 1, 'one press sends one action')
  await page.evaluate(() => {
    window.__gpFixture.holdSetUpstream = false
    window.__gpFixture.releaseSetUpstream()
  })
  await page.waitForFunction(() => document.querySelector('.gp-modal--sm') === null)
  await page.waitForFunction(() => document.querySelector('.gp-statusbar button[aria-label="设置上游"]') === null)
  assert.equal(await page.locator('.gp-statusbar__state').textContent(), '已与远程同步', 'the fresh snapshot reads as synced')
  assert.deepEqual((await counts(page)).actions, ['set-upstream'], 'the status bar sends exactly one set-upstream')
  await page.close()
}

/** Two candidates: origin is preselected, cancel sends nothing, and choosing
 * icode sends that name instead of the primary remote. */
async function setUpstreamMultiRemoteScenario() {
  const page = await openPanel({ ...LOCAL_ONLY, remoteBranchAtHead: true, remoteCandidates: [REMOTE, ICODE] })
  const button = page.locator('.gp-changes__push')
  await button.click()
  await page.locator('.gp-modal--sm').waitFor()
  const options = page.locator('.gp-upstream__option')
  assert.equal(await options.count(), 2, 'both candidates are listed')
  assert.equal(await page.locator('.gp-upstream__option input').nth(0).isChecked(), true, 'origin is preselected')
  assert.match(await options.nth(0).textContent(), /origin\/feature\/new/, 'the option names the remote branch')
  // Cancel first: the dialog closes and nothing is sent.
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.gp-modal--sm') === null)
  assert.equal((await counts(page)).setUpstreamCalls, 0, 'cancelling writes nothing')
  // Reopen, choose the non-primary candidate, and confirm.
  await button.click()
  await page.locator('.gp-modal--sm').waitFor()
  await page.locator('.gp-upstream__option', { hasText: 'icode/feature/new' }).click()
  assert.equal(await page.locator('.gp-upstream__option input').nth(1).isChecked(), true, 'the clicked candidate is selected')
  await page.locator('.gp-modal__footer .gp-btn--primary').click()
  await page.waitForFunction(() => window.__gpFixture.setUpstreamCalls === 1)
  await page.waitForFunction(() => document.querySelector('.gp-modal--sm') === null)
  assert.equal(await page.evaluate(() => window.__gpFixture.actions[0].remote), 'icode', 'the chosen non-primary remote crosses the wire')
  await page.close()
}

try {
  await changesPageScenario()
  await publishFailureScenario()
  await unavailableScenario()
  await statusBarScenario()
  await setUpstreamChangesScenario()
  await setUpstreamStatusBarScenario()
  await setUpstreamMultiRemoteScenario()
  assert.deepEqual(consoleErrors, [], 'no frontend errors')
  console.log('e2e publish-branch.mjs: PASS')
} catch (error) {
  console.error('e2e publish-branch.mjs: FAIL', error.stack ?? error.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
