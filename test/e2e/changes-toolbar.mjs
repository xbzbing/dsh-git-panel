/**
 * Isolated Changes toolbar regression: icon geometry/accessibility, read-only
 * controller refresh (including an unchanged fingerprint), and the direct
 * push (no confirm dialog): one click, busy guard, refusal, and the shared
 * Overview entry. Run setup.mjs first.
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const SCREENSHOT = resolve(DIR, '../../docs/local/review/changes-toolbar.png')
const ACTIONS = ['stage-picked', 'stage-all', 'unstage-all', 'discard-picked', 'discard-all', 'stash', 'push', 'refresh']
const LABELS = ['暂存选中的更改', '全部暂存', '全部取消暂存', '放弃选中的更改', '放弃全部变更', '贮藏更改', '推送本地提交到远程', '刷新当前仓库状态']
// The tail switch names the view in use and what a click does; the toolbar in
// these fixtures always mounts flat (no changesView in the snapshot).
const VIEW_SWITCH = '当前平铺，点击切换到树形'
// Hover copy: stage-picked explains its scope (picked rows only) instead of
// repeating the accessible name.
const TIPS = ['暂存勾选文件在工作区的改动，未勾选的文件不受影响', ...LABELS.slice(1)]
const THEME = `body{margin:0;font:13px system-ui,sans-serif;--dsh-composer-height:0px;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;
--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
--dsw-alias-bg-module-platform:#f5f6f7;
--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
#panel{border:0!important}`

const CLEAN = {
  root: 'changes-toolbar-fixture', branch: 'main', head: 'de54fc0', unborn: false,
  dirty: false, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
  hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/toolbar', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}
const DIRTY = {
  ...CLEAN, dirty: true, staged: 1, modified: 1,
  changes: [
    { path: 'staged.txt', status: 'modified', staged: true, isDirectory: false },
    { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
  ],
  stats: { ...CLEAN.stats, fileCount: 2, staged: 1, modified: 1, insertions: 2, deletions: 1 },
}
const AHEAD = { ...CLEAN, ahead: 5 }
const browser = await chromium.launch()
const consoleErrors = []

async function flush(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

async function openPanel(snapshot, { panelWidth = 1000, leftWidth = 380, viewportWidth = 1440, touch = false } = {}) {
  // A touch page emulates the phone: the tap sequence it produces (mouse enter
  // without a leave) is what the hints below have to survive.
  const page = await browser.newPage(touch ? { ...devices['Pixel 5'] } : { viewport: { width: viewportWidth, height: 764 } })
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (error) => consoleErrors.push('PAGEERROR ' + error.message))
  await page.goto(new URL('./harness.html', import.meta.url).href)
  await page.addStyleTag({ content: THEME })
  for (const file of ['client.js', 'mock-rpc.mjs']) await page.addScriptTag({ path: resolve(DIR, file) })
  await page.evaluate(({ snapshot, panelWidth, leftWidth }) => {
    const panel = document.getElementById('panel')
    panel.style.width = panelWidth + 'px'
    panel.style.height = '764px'
    localStorage.setItem('gp.changes.left', String(leftWidth))
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    fixture.fingerprints = true
    fixture.pushCalls = 0
    fixture.holdPush = false
    fixture.releasePush = null
    fixture.pushFailure = null
    window.__gpFixture = fixture
    const call = connection.rpc.call
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload?.args?.request
      if (endpoint === 'dbGitPanel/run' && request?.action?.kind === 'push') {
        fixture.actions.push(request.action)
        fixture.pushCalls++
        if (fixture.holdPush) await new Promise((done) => { fixture.releasePush = done })
        fixture.releasePush = null
        if (fixture.pushFailure !== null) {
          const code = fixture.pushFailure
          fixture.pushFailure = null
          return { ok: true, value: { ok: false, error: { code, message: 'raw push failure' } } }
        }
        fixture.snapshot = { ...fixture.snapshot, ahead: 0, behind: 0 }
        return { ok: true, value: { ok: true, snapshot: fixture.snapshot } }
      }
      return call(channel, endpoint, payload)
    }
    const registered = {}
    const dictionaries = {}
    // Minimal configForms so the wide font stepper can write fontDelta.
    const configState = { fontDelta: 0 }
    const ctx = {
      get: (key) => key === 'connection' ? connection : key === 'configForms' ? {
        describe: () => ({
          getSnapshot: () => ({ status: 'ready', view: { namespaces: [{ ns: 'dbGitPanel', schema: { dict: { showInputPill: {} } } }] }, revision: 0, writable: true }),
          subscribe: () => () => {},
          ensure: async () => {},
        }),
        get: () => ({
          getSnapshot: () => ({ status: 'ready', value: { ...configState }, revision: 0, writable: true }),
          subscribe: () => () => {},
          set: async (field, value) => {
            configState[field] = value
            if (field === 'fontDelta') fixture.snapshot = { ...fixture.snapshot, fontDelta: value }
            return true
          },
        }),
      } : undefined,
      effect: (cb) => cb(),
      on: (event, cb) => { if (event === 'connection/reset') fixture.resetConnection = cb; return () => {} },
      inject: (_deps, cb) => cb(ctx),
      slots: {
        inject: (_name, provider) => provider(),
        register: (reg, component) => { registered[reg.name] = component; return () => {} },
      },
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict },
        bind: (ns) => (key, params) => {
          const text = dictionaries[ns]?.zh[key] ?? key
          return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => k in params ? String(params[k]) : m)
        },
      },
    }
    window.__getLoaded().apply(ctx)
    window.ReactDOM.createRoot(panel).render(registered['conversation.view']({ sessionId: 'toolbar-session' }))
  }, { snapshot, panelWidth, leftWidth })
  await page.locator('[role="tab"]').nth(1).waitFor()
  await page.locator('[role="tab"]').nth(1).click()
  await page.locator('.gp-changes__toolbar').waitFor()
  await page.waitForFunction(() => window.__gpFixture.queries.includes('stash-list'))
  await flush(page)
  return page
}

async function counts(page) {
  return page.evaluate(() => ({
    snapshots: window.__gpFixture.snapshotCalls,
    replies: window.__gpFixture.snapshotReplies,
    stashes: window.__gpFixture.queries.filter((q) => q === 'stash-list').length,
    diffs: window.__gpFixture.queries.filter((q) => q === 'diff').length,
    actions: window.__gpFixture.actions.length,
  }))
}

async function refresh(page) {
  const before = await counts(page)
  await page.locator('.gp-changes__refresh').click()
  await page.waitForFunction((n) => window.__gpFixture.snapshotReplies === n + 1
    && document.querySelector('.gp-changes__refresh')?.getAttribute('aria-busy') === 'false', before.replies)
  await page.waitForFunction((n) => window.__gpFixture.queries.filter((q) => q === 'stash-list').length === n + 1, before.stashes)
  await flush(page)
  const after = await counts(page)
  assert.equal(after.snapshots, before.snapshots + 1, 'refresh uses one shared-controller snapshot request')
  assert.equal(after.actions, before.actions, 'refresh sends no write/fetch action')
}

async function geometry(page, label) {
  // The view switch yields (display:none) once the column is too narrow for the
  // actions plus the switch; changes-tree.mjs pins that policy, this runner only
  // measures what is actually on screen.
  // A display:none ancestor still reports the button's own display, so the
  // yield shows up as a zero-width box instead.
  const yielded = await page.locator('.gp-changes__viewbtn').evaluate((node) => node.getBoundingClientRect().width === 0)
  const expectedActions = yielded ? ACTIONS : [...ACTIONS, 'viewbtn']
  const expectedLabels = yielded ? LABELS : [...LABELS, VIEW_SWITCH]
  const actual = await page.locator('.gp-changes__toolbar').evaluate((toolbar) => {
    const rect = (node) => {
      const r = node.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    return {
      role: toolbar.getAttribute('role'), name: toolbar.getAttribute('aria-label'),
      toolbar: rect(toolbar), left: rect(toolbar.parentElement),
      clientWidth: toolbar.clientWidth, scrollWidth: toolbar.scrollWidth,
      buttons: [...toolbar.querySelectorAll('button')]
        .filter((button) => button.getBoundingClientRect().width > 0)
        .map((button) => ({
          rect: rect(button), label: button.getAttribute('aria-label'), title: button.getAttribute('title'),
          text: button.textContent.trim(), disabled: button.disabled, native: button instanceof HTMLButtonElement,
          icon: button.querySelector('svg') !== null,
          decorative: button.querySelector('[aria-hidden="true"]') !== null,
          action: [...button.classList].find((c) => c.startsWith('gp-changes__'))?.replace('gp-changes__', ''),
        })),
    }
  })
  assert.equal(actual.role, 'group', label + ': action group semantics')
  assert.equal(actual.name, '仓库变更操作', label + ': localized group label')
  assert.deepEqual(actual.buttons.map((b) => b.action), expectedActions, label + ': the actions (plus the yielded-in view switch) in order')
  assert.deepEqual(actual.buttons.map((b) => b.label), expectedLabels, label + ': meaningful accessible names')
  assert.ok(actual.scrollWidth <= actual.clientWidth + 1, label + ': toolbar has no horizontal overflow')
  const first = actual.buttons[0].rect
  for (const button of actual.buttons) {
    assert.equal(button.native, true, label + ': native button/disabled semantics')
    assert.equal(button.text, '', label + ': icon only')
    assert.equal(button.title, null, label + ': shared hover tip replaces native title')
    assert.equal(button.icon && button.decorative, true, label + ': decorative SVG icon')
    assert.ok(button.rect.width >= 24 && button.rect.height >= 24, label + ': usable button geometry')
    assert.ok(Math.abs(button.rect.top - first.top) < 1, label + ': a single button row')
    assert.ok(button.rect.left >= actual.toolbar.left - 1 && button.rect.right <= actual.toolbar.right + 1,
      label + ': each button fits inside the toolbar')
  }
  for (let i = 1; i < actual.buttons.length; i++) {
    assert.ok(actual.buttons[i].rect.left >= actual.buttons[i - 1].rect.right, label + ': controls do not overlap')
  }
  return { ...actual, yielded }
}

async function geometryScenario() {
  for (const [state, snapshot] of [['dirty', DIRTY], ['clean', CLEAN]]) {
    for (const [label, options] of [
      ['wide left 380', {}],
      ['wide left 320', { leftWidth: 320 }],
      ['compact 320', { panelWidth: 320, viewportWidth: 320 }],
    ]) {
      const page = await openPanel(snapshot, options)
      const normal = await geometry(page, `${state}, ${label}`)
      // The measured boundary: every pointer column here is wide enough for
      // the eight actions plus the switch (283px of content box); the phone's
      // 34px buttons need 337px, which changes-tree.mjs pins in compact.
      assert.equal(normal.yielded, false, `${state}, ${label}: a pointer column keeps the switch`)
      if (label === 'wide left 380') assert.ok(Math.abs(normal.left.width - 380) < 1, 'representative left column is 380px')
      if (label === 'compact 320') assert.equal(await page.locator('.gp-panel').getAttribute('data-layout'), 'compact')
      if (state === 'clean') {
        // stage-picked / stage-all / unstage-all / discard-picked / discard-all
        // / stash / push are all unavailable on a clean repo; only refresh stays
        // enabled (stage-picked also needs picked rows, of which there are none).
        // The view switch is presentation-only and never disables.
        const expectedDisabled = [...Array(7).fill(true), false, ...(normal.yielded ? [] : [false])]
        assert.deepEqual(normal.buttons.map((b) => b.disabled), expectedDisabled, 'clean repo keeps refresh (and the view switch) enabled')
        assert.equal(await page.locator('.gp-changes__list .gp-empty').textContent(), '没有未提交的变更')
      }
      // Compact unmounts the font stepper (it lives on the config page).
      if (label !== 'compact 320') {
        await page.locator('.gp-font__increase').click()
        await flush(page)
        assert.equal(await page.locator('.gp-panel').getAttribute('data-font-delta'), '1')
        await geometry(page, `${state}, ${label}, font +1`)
        if (state === 'clean' && label === 'wide left 380') {
          await page.locator('.gp-font__reset').click()
          await flush(page)
          const left = await page.locator('.gp-changes__left').boundingBox()
          mkdirSync(dirname(SCREENSHOT), { recursive: true })
          await page.screenshot({ path: SCREENSHOT, clip: { x: left.x, y: left.y, width: left.width, height: Math.min(left.height, 320) } })
        }
      } else {
        assert.equal(await page.locator('.gp-font').count(), 0, 'compact layout has no font stepper')
        const left = await page.locator('.gp-changes__left').boundingBox()
        if (state === 'clean') {
          mkdirSync(dirname(SCREENSHOT), { recursive: true })
          await page.screenshot({ path: SCREENSHOT, clip: { x: left.x, y: left.y, width: left.width, height: Math.min(left.height, 320) } })
        }
      }
      await page.close()
    }
  }
}

async function tipsAndStageScenario() {
  const page = await openPanel({ ...DIRTY, ahead: 5 })
  await page.locator('.gp-file-row', { hasText: 'a.txt' }).locator('input.gp-check').check()
  const before = await counts(page)
  for (let i = 0; i < ACTIONS.length; i++) {
    const button = page.locator('.gp-changes__' + ACTIONS[i])
    await button.hover()
    await page.waitForFunction((text) => document.querySelector('.gp-tip')?.textContent === text, TIPS[i])
    assert.equal(await page.locator('.gp-tip').evaluate((tip) => tip.parentElement === document.body), true, 'hover hint is portaled')
    await page.mouse.move(1430, 750)
    await page.waitForFunction(() => document.querySelector('.gp-tip') === null)
  }
  assert.equal((await counts(page)).actions, before.actions, 'hovering writes nothing')
  await page.locator('.gp-changes__stage-all').hover()
  await page.waitForSelector('.gp-tip')
  await page.locator('.gp-changes__stage-all').click()
  await page.waitForFunction(() => window.__gpFixture.actions.length === 1)
  await page.waitForFunction(() => !document.querySelector('.gp-changes__unstage-all').disabled)
  assert.equal(await page.locator('.gp-tip').count(), 0, 'click dismisses the tooltip')
  await page.locator('.gp-changes__unstage-all').click()
  await page.waitForFunction(() => window.__gpFixture.actions.length === 2)
  assert.deepEqual(await page.evaluate(() => window.__gpFixture.actions), [{ kind: 'stage-all' }, { kind: 'unstage-all' }], 'existing stage/unstage RPC kinds remain unchanged')
  await page.close()
}

/**
 * Batch stage (issue #82): the toolbar entry stages exactly the checked
 * working-tree rows. A staged-only pick has nothing to stage and leaves it
 * disabled; the request carries the deduped paths, never the whole work tree.
 */
async function stagePickedScenario() {
  const page = await openPanel({
    ...DIRTY, ahead: 5, staged: 2, modified: 3,
    changes: [
      ...DIRTY.changes,
      { path: 'b.txt', status: 'modified', staged: false, isDirectory: false },
      { path: 'dup.txt', status: 'modified', staged: true, isDirectory: false },
      { path: 'dup.txt', status: 'modified', staged: false, isDirectory: false },
    ],
    stats: { ...DIRTY.stats, fileCount: 4, staged: 2, modified: 3 },
  })
  const button = page.locator('.gp-changes__stage-picked')
  assert.equal(await button.isEnabled(), false, 'nothing picked → stage-picked is disabled')
  const rowOf = (path, glyph) => page.locator('.gp-file-row', { hasText: path })
    .filter({ has: page.locator('.gp-file-row__actions button', { hasText: glyph }) })
  // An index-side pick is already staged: it never enables the entry nor
  // widens the request.
  await rowOf('dup.txt', '−').locator('input.gp-check').check()
  assert.equal(await button.isEnabled(), false, 'a staged-only pick has nothing to stage')
  await rowOf('dup.txt', '+').locator('input.gp-check').check()
  await rowOf('a.txt', '+').locator('input.gp-check').check()
  assert.equal(await button.isEnabled(), true, 'working-tree picks enable stage-picked')
  await button.click()
  await page.waitForFunction(() => window.__gpFixture.actions.length === 1)
  assert.deepEqual(
    await page.evaluate(() => window.__gpFixture.actions),
    [{ kind: 'stage', paths: ['a.txt', 'dup.txt'] }],
    'the request stages the picked working-tree paths, deduped and scoped',
  )
  // The accepted snapshot retires the staged `:w` rows (a now fully-staged
  // path has no working-tree row at all); the selection prunes to the living
  // keys and the entry falls back to disabled with nothing left to stage.
  await page.evaluate(() => {
    const fixture = window.__gpFixture
    fixture.snapshot = {
      ...fixture.snapshot,
      changes: fixture.snapshot.changes.filter((c) => !(!c.staged && (c.path === 'a.txt' || c.path === 'dup.txt'))),
      staged: 4, modified: 1,
      stats: { ...fixture.snapshot.stats, staged: 4, modified: 1 },
    }
  })
  await refresh(page)
  assert.equal(await rowOf('a.txt', '+').count(), 0, 'the staged row leaves the working-tree group')
  assert.equal(await rowOf('dup.txt', '+').count(), 0, 'a fully-staged path drops its working-tree row')
  assert.equal(
    await page.locator('.gp-file-row input.gp-check:checked').count(), 1,
    'the surviving index-side pick keeps its selection; the retired :w keys prune',
  )
  assert.equal(await button.isEnabled(), false, 'a fresh snapshot with nothing stageable picked disables the entry')
  await page.close()
}

async function refreshScenario() {
  const clean = await openPanel(CLEAN)
  const before = await counts(clean)
  await clean.evaluate(() => { window.__gpFixture.holdSnapshot = true })
  // Two synchronous native clicks also probe the ref guard before React renders.
  await clean.locator('.gp-changes__refresh').evaluate((button) => { button.click(); button.click() })
  await clean.waitForFunction(() => window.__gpFixture.releaseSnapshot !== null)
  const held = await clean.locator('.gp-changes__refresh').evaluate((button) => ({
    busy: button.getAttribute('aria-busy'), disabled: button.disabled,
    animation: getComputedStyle(button.querySelector('svg')).animationName,
  }))
  assert.equal(held.busy, 'true', 'refresh announces busy')
  assert.equal(held.disabled, true, 'refresh disables in flight')
  assert.equal(held.animation, 'gp-spin', 'refresh icon spins in flight')
  assert.equal((await counts(clean)).snapshots, before.snapshots + 1, 'held refresh issues only one snapshot')
  assert.equal((await counts(clean)).actions, 0, 'refresh does not fetch or write')
  await clean.evaluate(() => {
    const fixture = window.__gpFixture
    fixture.holdSnapshot = false
    fixture.releaseSnapshot()
    fixture.releaseSnapshot = null
  })
  await clean.waitForFunction(() => document.querySelector('.gp-changes__refresh')?.getAttribute('aria-busy') === 'false')
  await clean.waitForFunction((n) => window.__gpFixture.queries.filter((q) => q === 'stash-list').length === n + 1, before.stashes)
  await flush(clean)
  assert.equal((await counts(clean)).snapshots, before.snapshots + 1, 'release starts no trailing snapshot')
  assert.equal(await clean.locator('.gp-changes__refresh').isEnabled(), true, 'clean refresh becomes available again')
  await clean.close()

  const page = await openPanel(DIRTY)
  const row = page.locator('.gp-file-row', { hasText: 'a.txt' })
  await row.locator('input.gp-check').check()
  await page.locator('.gp-commitbox__msg').fill('feat: preserve my draft')
  await row.locator('.gp-tree-name').click()
  await page.waitForSelector('.gp-diff__path')
  await page.waitForFunction(() => document.querySelector('.gp-diff__wrap')?.textContent.includes('line2'))
  const initial = await counts(page)
  const fingerprint = await page.evaluate(() => JSON.stringify(window.__gpFixture.snapshot))
  await page.evaluate(() => {
    window.__gpFixture.diffText = 'refreshed-with-same-fingerprint'
    window.__gpFixture.stashes = [
      { index: 0, sha: 'updated-stash', message: 'fresh stash entry', branch: 'main', relTime: 'now' },
      { index: 1, sha: 'another-stash', message: 'another entry', branch: 'main', relTime: 'now' },
    ]
  })
  await refresh(page)
  await page.waitForFunction(() => document.querySelector('.gp-diff__wrap')?.textContent.includes('refreshed-with-same-fingerprint'))
  assert.equal(await page.evaluate(() => JSON.stringify(window.__gpFixture.snapshot)), fingerprint, 'business snapshot remains byte-identical')
  assert.equal((await counts(page)).diffs, initial.diffs + 1, 'same fingerprint still reloads the open diff through query tick')
  assert.match(await page.locator('.gp-stash > .gp-group-head').textContent(), /\(2\)/, 'same fingerprint reloads the stash list')
  assert.equal(await row.locator('input.gp-check').isChecked(), true, 'refresh keeps a living selection')
  assert.equal(await page.locator('.gp-commitbox__msg').inputValue(), 'feat: preserve my draft', 'refresh keeps the commit draft')
  await page.evaluate(() => {
    const fixture = window.__gpFixture
    fixture.snapshot = {
      ...fixture.snapshot, modified: 2,
      changes: [...fixture.snapshot.changes, { path: 'fresh.txt', status: 'modified', staged: false, isDirectory: false }],
      stats: { ...fixture.snapshot.stats, modified: 2, fileCount: 3 },
    }
  })
  await refresh(page)
  await page.locator('.gp-file-row', { hasText: 'fresh.txt' }).waitFor()
  assert.equal(await row.locator('input.gp-check').isChecked(), true, 'fresh snapshot preserves rows still selected')
  assert.equal(await page.locator('.gp-commitbox__msg').inputValue(), 'feat: preserve my draft')
  assert.equal((await counts(page)).actions, 0, 'all refresh paths remain read-only')
  await page.close()
}

async function pushFromChanges(page) {
  await page.locator('.gp-changes__push').click()
  await flush(page)
}

async function pushBanner(page) {
  return page.locator('.gp-changes__left .gp-feedback--dismissible').evaluate((banner) => ({
    text: banner.querySelector('.gp-feedback__text').textContent,
  }))
}

async function pushScenario() {
  const page = await openPanel(CLEAN)
  // Every row states one independent state: the branch/unborn/head trio is
  // reset to the fixture baseline before the row's own patch lands, so a row
  // like "unborn" cannot accidentally run as "detached AND unborn" because the
  // previous row cleared the branch.
  const BASELINE = { branch: 'main', unborn: false, head: 'de54fc0' }
  for (const [state, patch] of [
    ['synced', { ahead: 0, behind: 0, hasUpstream: true, remote: CLEAN.remote }],
    ['behind', { ahead: 0, behind: 3 }],
    ['diverged', { ahead: 2, behind: 3 }],
    // A local-only branch is publishable, not pushable: the control is live but
    // opens the publish dialog instead (covered in publish-branch.mjs).
    ['no upstream', { ahead: 5, behind: 0, hasUpstream: false }],
    // Detached HEAD and an unborn repo have no branch to create remotely.
    ['detached', { hasUpstream: false, ahead: 0, behind: 0, branch: null }],
    ['unborn', { hasUpstream: false, ahead: 0, behind: 0, unborn: true, head: null }],
    ['no remote/upstream', { ahead: 0, behind: 0, hasUpstream: false, remote: null }],
  ]) {
    const publishable = state === 'no upstream'
    await page.evaluate(({ baseline, patch }) => {
      window.__gpFixture.snapshot = { ...window.__gpFixture.snapshot, ...baseline, ...patch }
    }, { baseline: BASELINE, patch })
    await refresh(page)
    assert.equal(await page.locator('.gp-changes__push').isDisabled(), !publishable, state + (publishable ? ': publish is offered' : ': upload is disabled'))
    if (!publishable) {
      await page.locator('.gp-changes__push').evaluate((button) => button.click())
      assert.equal(await page.locator('.gp-modal--sm').count(), 0, state + ': native disabled blocks the write')
      assert.equal(await page.evaluate(() => window.__gpFixture.pushCalls), 0, state + ': no push RPC fires')
    }
  }
  // Back to a plain push: a strictly-ahead branch with an upstream.
  await page.evaluate((remote) => {
    window.__gpFixture.snapshot = { ...window.__gpFixture.snapshot, head: 'abc1234', ahead: 5, behind: 0, hasUpstream: true, remote, unborn: false, branch: 'main' }
  }, CLEAN.remote)
  await refresh(page)
  assert.equal(await page.locator('.gp-changes__push').isEnabled(), true, 'strictly ahead snapshot enables push')
  assert.equal((await counts(page)).actions, 0, 'state checks and commit simulation have no write actions')
  assert.equal(await page.locator('.gp-modal--sm').count(), 0, 'push runs with no confirm dialog')
  await pushFromChanges(page)
  await page.waitForFunction(() => window.__gpFixture.pushCalls === 1)
  assert.equal(await page.locator('.gp-modal--sm').count(), 0, 'success keeps it dialog-free')
  assert.deepEqual(await page.evaluate(() => window.__gpFixture.actions), [{ kind: 'push' }], 'one click sends one ordinary push')
  assert.equal(await page.evaluate(() => window.__gpFixture.snapshot.ahead), 0, 'successful push accepts synced snapshot')
  assert.equal(await page.locator('.gp-changes__push').isDisabled(), true, 'successful push disables the now-synced control')

  // Overview offers the same direct push with the same shared button state.
  await page.evaluate((remote) => {
    window.__gpFixture.snapshot = { ...window.__gpFixture.snapshot, head: 'def5678', ahead: 2, behind: 0, hasUpstream: true, remote, unborn: false, branch: 'main' }
  }, CLEAN.remote)
  await refresh(page)
  await page.locator('[role="tab"]').nth(0).click()
  const pushesBeforeOverview = await page.evaluate(() => window.__gpFixture.pushCalls)
  await page.locator('.gp-statusbar button[aria-label="推送本地提交到远程"]').click()
  await page.waitForFunction((n) => window.__gpFixture.pushCalls === n + 1, pushesBeforeOverview)
  assert.equal(await page.locator('.gp-modal--sm').count(), 0, 'Overview push runs directly too')
  await page.locator('[role="tab"]').nth(1).click()
  await page.close()
}

async function pushBusyAndFailureScenario() {
  // In flight: the busy guard covers the whole toolbar, and one held push
  // absorbs two synchronous clicks from the Changes entry.
  const page = await openPanel(AHEAD)
  await page.evaluate(() => { window.__gpFixture.holdPush = true })
  await page.locator('.gp-changes__push').evaluate((button) => { button.click(); button.click() })
  await page.waitForFunction(() => window.__gpFixture.releasePush !== null)
  assert.equal(await page.locator('.gp-changes__push').isDisabled(), true, 'push in flight disables itself')
  assert.equal(await page.locator('.gp-changes__toolbar button:disabled').count(), 8, 'push in flight disables the complete toolbar')
  await page.evaluate(() => {
    window.__gpFixture.holdPush = false
    window.__gpFixture.releasePush()
  })
  // The accepted synced snapshot lands: the toolbar re-enables except the push
  // control itself, which retires with nothing left to push.
  await page.waitForFunction(() => document.querySelector('.gp-changes__refresh')?.disabled === false)
  assert.equal(await page.evaluate(() => window.__gpFixture.pushCalls), 1, 'one held push absorbed the double click')
  assert.equal(await page.locator('.gp-changes__push').isDisabled(), true, 'the synced snapshot retires the push control')
  await page.close()

  // Refused (e.g. remote moved): the localized failure surfaces in the inline
  // banner and the toolbar recovers; the next push can retry.
  const refused = await openPanel(AHEAD)
  await refused.evaluate(() => { window.__gpFixture.pushFailure = 'push-rejected' })
  await refused.locator('.gp-changes__push').click()
  await refused.locator('.gp-changes__left .gp-feedback--dismissible').waitFor()
  assert.equal((await pushBanner(refused)).text, '推送被拒绝：远程已有新提交，请先「检查同步」并拉取后再推送', 'push failure stays localized in the inline banner')
  assert.equal(await refused.locator('.gp-changes__push').isEnabled(), true, 'failed push can be retried')
  await refused.close()
}

/**
 * An inline failure is dismissible. Provider errors (e.g. an AI suggest that the
 * model gateway refuses) arrive as long, wrapping text; the banner carries its
 * own close control instead of occupying the list until the next action.
 */
async function errorDismissScenario() {
  const page = await openPanel(DIRTY)
  await page.evaluate(() => {
    window.__gpFixture.runFailure = { kind: 'stage-all', code: 'git-error', message: 'model gateway refused the request' }
  })
  await page.locator('.gp-changes__stage-all').click()
  await page.locator('.gp-feedback--dismissible').waitFor()
  assert.equal(await page.locator('.gp-feedback__text').textContent(), 'model gateway refused the request')
  assert.equal(await page.locator('.gp-feedback__close').getAttribute('aria-label'), '关闭', 'the close control is named for screen readers')
  assert.equal(await page.locator('.gp-feedback__close').isEnabled(), true)
  await page.locator('.gp-feedback__close').click()
  await page.waitForFunction(() => document.querySelector('.gp-feedback') === null)
  assert.equal(await page.locator('.gp-feedback').count(), 0, 'closing the banner clears it')
  await page.close()
}

/**
 * Committing with nothing staged is refused by git on stdout (exit 1). The
 * banner must show the localized explanation, never git's English line, and
 * centre the message on a one-line banner instead of pinning it to the bottom.
 */
async function nothingToCommitScenario() {
  const page = await openPanel(DIRTY)
  await page.evaluate(() => {
    window.__gpFixture.runFailure = { kind: 'commit', code: 'nothing-to-commit' }
  })
  await page.locator('.gp-commitbox__msg').fill('docs: probe')
  await page.locator('.gp-commitbox .gp-btn--primary').click()
  await page.locator('.gp-feedback--dismissible').waitFor()
  assert.equal(
    await page.locator('.gp-feedback__text').textContent(),
    '没有可提交的变更：请先暂存，或在列表中勾选有改动的文件',
    'a refusal with no git stderr is localized, not shown as English git output',
  )
  const oneLine = await page.locator('.gp-feedback--dismissible').evaluate((banner) => {
    const rect = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height } }
    return { banner: rect(banner), text: rect(banner.querySelector('.gp-feedback__text')) }
  })
  assert.ok(
    Math.abs((oneLine.banner.top + oneLine.banner.bottom) / 2 - (oneLine.text.top + oneLine.text.bottom) / 2) <= 1,
    'one-line message is vertically centred in the banner',
  )

  // A wrapped message grows downward; the close control keeps the bottom-right.
  await page.locator('.gp-feedback__close').click()
  await page.waitForFunction(() => document.querySelector('.gp-feedback') === null)
  const long = 'the model gateway refused the request because the prompt exceeded the provider context window and no fallback route was configured'
  await page.evaluate((message) => {
    window.__gpFixture.runFailure = { kind: 'stage-all', code: 'git-error', message }
  }, long)
  await page.locator('.gp-changes__stage-all').click()
  await page.locator('.gp-feedback--dismissible').waitFor()
  const wrapped = await page.locator('.gp-feedback--dismissible').evaluate((banner) => {
    const rect = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height } }
    return { banner: rect(banner), text: rect(banner.querySelector('.gp-feedback__text')), close: rect(banner.querySelector('.gp-feedback__close')) }
  })
  assert.ok(wrapped.text.height > 20, 'a long provider error wraps to more than one line')
  assert.ok(wrapped.banner.bottom - wrapped.close.bottom <= 7, 'wrapped banner keeps its close control at the bottom-right')
  assert.equal(await page.locator('.gp-feedback__text').textContent(), long, 'provider detail still rides along verbatim')
  await page.close()
}

/** A disabled control must still explain itself on hover (issue #61). */
async function disabledTipScenario() {
  const page = await openPanel(CLEAN)
  // Clean repo: every entry but refresh is disabled (no changes, nothing
  // picked). A disabled button is pointer-events:none so the tip shell takes
  // the hover.
  const shell = page.locator('.gp-tip-wrap', { has: page.locator('.gp-changes__stage-all') })
  assert.equal(await page.locator('.gp-changes__stage-all').isDisabled(), true, 'stage-all is disabled on a clean repo')
  await shell.hover()
  await page.waitForFunction(() => document.querySelector('.gp-tip')?.textContent === '全部暂存')
  assert.equal(await page.locator('.gp-tip').evaluate((tip) => tip.parentElement === document.body), true, 'disabled hover hint is portaled')
  await page.mouse.move(1430, 750)
  await page.waitForFunction(() => document.querySelector('.gp-tip') === null)
  // The tip shell must not change the button box (geometry suite still pins it).
  const box = await page.locator('.gp-changes__stage-all').boundingBox()
  assert.ok(box !== null && box.width >= 24 && box.height >= 24, 'disabled button keeps its geometry')
  // stage-picked carries its own scope wording (distinct from the accessible
  // name), and it must explain itself while disabled like any other entry.
  const pickedShell = page.locator('.gp-tip-wrap', { has: page.locator('.gp-changes__stage-picked') })
  assert.equal(await page.locator('.gp-changes__stage-picked').isDisabled(), true, 'stage-picked is disabled with nothing picked')
  await pickedShell.hover()
  await page.waitForFunction(() => document.querySelector('.gp-tip')?.textContent === '暂存勾选文件在工作区的改动，未勾选的文件不受影响')
  await page.mouse.move(1430, 750)
  await page.waitForFunction(() => document.querySelector('.gp-tip') === null)
  await page.close()
}

/**
 * A finger raises no hint, and never leaves one behind. A tap synthesises a
 * mouse *enter* but no matching leave — the virtual cursor stays where the
 * finger was — and it focuses the control too, so both halves of the shared
 * hint have to stay shut. Press-driven hints are the exception: the two-step
 * discard still raises its own confirmation on a tap.
 */
async function touchHintScenario() {
  const clean = await openPanel(CLEAN, { touch: true })
  // A finger press, then focus: the tap's own focus half, reproduced without
  // its click (a click can disable the control, which hides any bubble and
  // would mask the regression).
  await clean.locator('.gp-stats').tap()
  const focused = await clean.evaluate(() => {
    const button = document.querySelector('.gp-changes__refresh')
    button.focus()
    return document.activeElement === button
  })
  await clean.waitForTimeout(400)
  const afterFocus = await clean.locator('.gp-tip').count()
  // The mouse half is untouched: hovering still explains the same control.
  await clean.locator('.gp-changes__refresh').hover()
  await clean.waitForFunction(() => document.querySelector('.gp-tip')?.textContent === '刷新当前仓库状态')
  const afterHover = await clean.locator('.gp-tip').textContent()
  // An empty list must not scroll. The empty pane is full-height AND border-box,
  // so its 24px padding sits inside that height; as content-box it added 48px
  // past the list's content box and a phone-sized panel showed a scrollbar for a
  // pane with nothing in it.
  await clean.evaluate(() => { document.getElementById('panel').style.width = '364px' })
  await clean.waitForTimeout(300)
  const emptyScroll = await clean.evaluate(() => {
    const list = document.querySelector('.gp-changes__list')
    if (list === null) return null
    return {
      layout: document.querySelector('.gp-panel')?.getAttribute('data-layout'),
      clientH: list.clientHeight,
      scrollH: list.scrollHeight,
      paneH: Math.round(document.querySelector('.gp-changes__list .gp-empty')?.getBoundingClientRect().height ?? -1),
    }
  })
  await clean.close()

  const dirty = await openPanel({ ...DIRTY, ahead: 5 }, { touch: true })
  const discard = dirty.locator('.gp-file-row', { hasText: 'a.txt' })
    .locator('button[aria-label="放弃更改"], button[aria-label="再次点击以确认放弃"]')
  await discard.tap()
  await dirty.waitForFunction(() => document.querySelector('.gp-tip') !== null)
  const armed = await dirty.evaluate(() => ({
    tip: document.querySelector('.gp-tip')?.textContent ?? null,
    armedAria: document.querySelector('.gp-file-row button[aria-label="再次点击以确认放弃"]') !== null,
  }))
  await dirty.locator('.gp-stats').tap()
  await dirty.waitForTimeout(250)
  const dismissed = await dirty.locator('.gp-tip').count()
  await dirty.close()
  return { focused, afterFocus, afterHover, emptyScroll, ...armed, dismissed }
}

try {
  await geometryScenario()
  await tipsAndStageScenario()
  await stagePickedScenario()
  await disabledTipScenario()
  await errorDismissScenario()
  await nothingToCommitScenario()
  await refreshScenario()
  await pushScenario()
  await pushBusyAndFailureScenario()
  const touch = await touchHintScenario()
  assert.equal(touch.focused, true, 'the finger press leaves focus on the control, so the focus half is exercised')
  assert.equal(touch.afterFocus, 0, 'a touch press never raises a hover hint')
  assert.equal(touch.afterHover, '刷新当前仓库状态', 'the mouse half still explains controls on a touch device')
  // Empty pane, phone width: nothing to scroll, so no scrollbar.
  assert.equal(touch.emptyScroll?.layout, 'compact', 'the empty-list check runs in the compact layout')
  assert.equal(touch.emptyScroll?.scrollH, touch.emptyScroll?.clientH, `an empty changes list does not scroll (${touch.emptyScroll?.scrollH} vs ${touch.emptyScroll?.clientH})`)
  assert.equal(touch.emptyScroll?.paneH, (touch.emptyScroll?.clientH ?? 0) - 8, 'the empty pane fills the list content box exactly (8px = its vertical padding)')
  assert.ok(touch.tip !== null, `the press-driven confirmation still reaches a finger (got ${JSON.stringify(touch.tip)})`)
  assert.equal(touch.armedAria, true, 'the first tap arms the two-step discard')
  assert.equal(touch.dismissed, 0, 'a press elsewhere drops the touch-raised confirmation')
  assert.deepEqual(consoleErrors, [], 'no frontend errors')
  console.log('e2e changes-toolbar.mjs: PASS', JSON.stringify({ screenshot: SCREENSHOT, actions: ACTIONS }))
} catch (error) {
  console.error('e2e changes-toolbar.mjs: FAIL', error.stack ?? error.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
