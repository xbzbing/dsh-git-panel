/**
 * E2E: the split commit button (issue #152).
 *
 * The primary button records a commit; a 24px caret to its right opens the two
 * choices, and the chosen one is remembered for the session (not the install).
 * The caret keeps the contract it owns (aria-haspopup / aria-expanded, Escape
 * closes and returns focus), the accelerator is announced as aria-keyshortcuts,
 * and the checked row pins the `selectedId` this plugin passes — the real
 * platform Menu paints selection with a class and a check glyph, not
 * aria-checked (that is Switch's attribute), so `menuState().checked` reads the
 * harness stub, not a platform guarantee. The chain must never push after a
 * failed commit, never push a checkout the commit did not confirm, and never
 * unwind a commit because its push was skipped or rejected.
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
 */
import { chromium, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const THEME = `body{margin:0;font:13px system-ui,sans-serif;--dsh-composer-height:0px;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;
--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
--dsw-alias-bg-module-platform:#f5f6f7;
--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
--dsw-alias-label-quaternary:#a5a9b0;--dsw-alias-label-caption:#6f747c;
--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
--dsw-radius-sm:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
#panel{border:0!important}`

const REMOTE = { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' }

const CLEAN = {
  root: 'commit-split-fixture', branch: 'feat/x', head: 'de54fc0', unborn: false,
  dirty: true, staged: 1, modified: 1, untracked: 0, ahead: 0, behind: 0,
  hasUpstream: true, remote: REMOTE, lastCommit: null,
  changes: [
    { path: 'staged.txt', status: 'modified', staged: true, isDirectory: false },
    { path: 'a.txt', status: 'modified', staged: false, isDirectory: false },
  ],
  stats: { fileCount: 2, staged: 1, modified: 1, untracked: 0, insertions: 2, deletions: 1, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, suggestEnabled: true,
  capabilities: { syncMerge: true },
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
const consoleErrors = []

async function flush(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

/**
 * Mount the panel against the mock and open the changes tab. `panelHeight` and
 * `phone` drive the cramped fold (the commit editor folds into the bar).
 */
async function openPanel(snapshot, { panelWidth = 1000, panelHeight = 764, phone = false, folded = false } = {}) {
  const page = await browser.newPage(phone
    ? { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } }
    : { viewport: { width: 1440, height: 900 } })
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (error) => consoleErrors.push('PAGEERROR ' + error.message))
  await page.goto(new URL('./harness.html', import.meta.url).href)
  await page.addStyleTag({ content: THEME })
  for (const file of ['client.js', 'mock-rpc.mjs']) await page.addScriptTag({ path: resolve(DIR, file) })
  await page.evaluate(({ snapshot, panelWidth, panelHeight }) => {
    const panel = document.getElementById('panel')
    panel.style.width = panelWidth + 'px'
    panel.style.height = panelHeight + 'px'
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    fixture.actions.length = 0
    window.__gpFixture = fixture
    const registered = {}
    const dictionaries = {}
    const ctx = {
      get: (key) => key === 'connection' ? connection : undefined,
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
    window.ReactDOM.createRoot(panel).render(registered['conversation.view']({ sessionId: 'commit-split-session' }))
  }, { snapshot, panelWidth, panelHeight })
  await page.locator('[role="tab"]').nth(1).waitFor()
  await page.locator('[role="tab"]').nth(1).click()
  // A cramped panel starts folded: the editor exists only after the bar is tapped.
  await page.locator(folded ? '.gp-commitbar' : '.gp-commitbox').waitFor()
  await flush(page)
  return page
}

const actions = (page) => page.evaluate(() => window.__gpFixture.actions.map((a) => a.kind))
const label = (page) => page.locator('.gp-commit-split__main').innerText()
const feedback = (page) => page.locator('.gp-feedback__text').innerText()
const menuItems = (page) => page.locator('[data-menu-surface] [role="menuitem"]')

/** Open the split button's menu and wait for its portaled surface. */
async function openMenu(page) {
  await page.locator('.gp-commit-split__caret').click()
  await page.locator('[data-menu-surface]').waitFor()
  await flush(page)
}

/** The two visible states of the split button, plus the stub's checked row
 * (see the header: aria-checked is how the harness Menu stub exposes
 * `selectedId`; the real Menu only paints the class and glyph). */
async function menuState(page) {
  return page.evaluate(() => ({
    expanded: document.querySelector('.gp-commit-split__caret')?.getAttribute('aria-expanded'),
    caretLabel: document.querySelector('.gp-commit-split__caret')?.getAttribute('aria-label'),
    checked: [...document.querySelectorAll('[data-menu-surface] [role="menuitem"]')]
      .filter((node) => node.getAttribute('aria-checked') === 'true')
      .map((node) => node.textContent),
  }))
}

/* ── 1. default state: one primary action, an inert caret menu ───────────── */
{
  const page = await openPanel(CLEAN)
  assert.equal(await label(page), '提交', 'a session starts on plain commit')
  assert.equal(await page.locator('.gp-commit-split__main').getAttribute('aria-haspopup'), null, 'the action button itself is not the menu')
  const caret = page.locator('.gp-commit-split__caret')
  assert.equal(await caret.getAttribute('aria-haspopup'), 'menu')
  assert.equal(await caret.getAttribute('aria-expanded'), 'false')
  assert.equal(await caret.getAttribute('aria-label'), '选择提交动作')
  await openMenu(page)
  assert.equal(await caret.getAttribute('aria-expanded'), 'true')
  assert.equal(await menuItems(page).count(), 2, 'one row per choice')
  assert.match(
    (await menuItems(page).nth(1).getAttribute('aria-keyshortcuts')) ?? '',
    /^(Control|Meta)\+Alt\+K$/,
    'the accelerator is announced on the row (the platform renders shortcut.aria as aria-keyshortcuts)',
  )
  assert.deepEqual((await menuState(page)).checked, ['提交'])
  await page.close()
}

/* ── 2. choosing a mode relabels the primary button and checks the row ───── */
{
  const page = await openPanel(CLEAN)
  await openMenu(page)
  await menuItems(page).nth(1).click()
  await flush(page)
  assert.equal(await label(page), '提交并推送', 'the label follows the choice')
  assert.equal(await page.locator('.gp-commit-split__caret').getAttribute('aria-expanded'), 'false')
  await openMenu(page)
  assert.deepEqual((await menuState(page)).checked, ['提交并推送'])
  // Escape closes and hands focus back to the caret.
  await page.keyboard.press('Escape')
  await page.locator('[data-menu-surface]').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => document.activeElement?.className.includes('gp-commit-split__caret')), true, 'focus returns to the caret')
  // Keyboard: opening focuses the checked row, ↓ moves, Enter picks.
  await openMenu(page)
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '提交', 'the menu focuses its first row')
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '提交并推送')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await flush(page)
  assert.equal(await label(page), '提交', 'keyboard selection round-trips')
  await page.close()
}

/* ── 3. the choice survives leaving and re-entering the tab ──────────────── */
{
  const page = await openPanel(CLEAN)
  await openMenu(page)
  await menuItems(page).nth(1).click()
  await flush(page)
  await page.locator('[role="tab"]').nth(0).click()
  await page.locator('.gp-commitbox').waitFor({ state: 'hidden' }).catch(() => {})
  await page.locator('[role="tab"]').nth(1).click()
  await page.locator('.gp-commitbox').waitFor()
  await flush(page)
  assert.equal(await label(page), '提交并推送', 'the mode is session state, not component state')
  await page.close()
}

/* ── 4. commit and push: both writes, in order, then the box clears ─────── */
{
  const page = await openPanel(CLEAN)
  await openMenu(page)
  await menuItems(page).nth(1).click()
  await flush(page)
  await page.locator('.gp-commitbox__msg').fill('feat: split')
  await page.locator('.gp-commit-split__main').click()
  await page.waitForFunction(() => window.__gpFixture.actions.length === 2)
  assert.deepEqual(await actions(page), ['commit', 'push'])
  assert.equal(await page.locator('.gp-commitbox__msg').inputValue(), '', 'the commit clears the message')
  assert.equal(await page.locator('.gp-feedback').count(), 0, 'a clean push leaves no error')
  await page.close()
}

/* ── 5. plain commit never pushes ───────────────────────────────────────── */
{
  const page = await openPanel(CLEAN)
  await page.locator('.gp-commitbox__msg').fill('feat: only commit')
  await page.locator('.gp-commit-split__main').click()
  await page.waitForFunction(() => window.__gpFixture.actions.length === 1)
  await flush(page)
  assert.deepEqual(await actions(page), ['commit'])
  await page.close()
}

/* ── 6. the accelerator always commits and pushes, without changing the mode */
{
  const page = await openPanel(CLEAN)
  await page.locator('.gp-commitbox__msg').fill('feat: shortcut')
  await page.locator('.gp-commitbox__msg').press('Control+Alt+KeyK')
  await page.waitForFunction(() => window.__gpFixture.actions.length === 2)
  assert.deepEqual(await actions(page), ['commit', 'push'])
  assert.equal(await label(page), '提交', 'the shortcut does not arm the menu')
  await page.close()
}

/* ── 7. behind the remote: the commit lands, the push is skipped and named ─ */
{
  const page = await openPanel({ ...CLEAN, behind: 2 })
  await openMenu(page)
  const hint = page.locator('[data-menu-label]')
  assert.equal(await hint.count(), 1, 'the menu says the branch cannot be pushed right now')
  assert.match(await hint.innerText(), /不能推送/)
  await menuItems(page).nth(1).click()
  await flush(page)
  await page.locator('.gp-commitbox__msg').fill('feat: behind')
  await page.locator('.gp-commit-split__main').click()
  await page.waitForFunction(() => window.__gpFixture.actions.length === 1)
  await flush(page)
  assert.deepEqual(await actions(page), ['commit'], 'no push is attempted')
  const skipNotice = await page.locator('.gp-notice__text').first().innerText()
  assert.match(skipNotice, /提交已保存到本地/)
  assert.match(skipNotice, /落后远程 2 个提交/)
  assert.equal(await page.locator('.gp-feedback').count(), 0, 'a deliberate skip is not painted as an error')
  assert.equal(await page.locator('.gp-commitbox__msg').inputValue(), '', 'the commit still cleared the box')
  await page.close()
}

/* ── 8. amending a pushed tip: skip with the force-push reason ──────────── */
{
  const page = await openPanel({ ...CLEAN, ahead: 0, behind: 0 })
  await openMenu(page)
  await menuItems(page).nth(1).click()
  await flush(page)
  await page.locator('.gp-commitbox__amend input').check()
  await page.locator('.gp-commitbox__msg').fill('fix: amend')
  await page.locator('.gp-commit-split__main').click()
  await page.waitForFunction(() => window.__gpFixture.actions.length === 1)
  await flush(page)
  assert.deepEqual(await actions(page), ['commit'])
  assert.match(await page.locator('.gp-notice__text').first().innerText(), /force push/)
  assert.equal(await page.locator('.gp-commitbox__amend input').isChecked(), false, 'the amend flag is consumed with the commit')
  await page.close()
}

/* ── 9. a rejected push keeps the commit and reports it ─────────────────── */
{
  const page = await openPanel(CLEAN)
  await page.evaluate(() => { window.__gpFixture.runFailure = { kind: 'push', code: 'push-rejected' } })
  await openMenu(page)
  await menuItems(page).nth(1).click()
  await flush(page)
  await page.locator('.gp-commitbox__msg').fill('feat: rejected')
  await page.locator('.gp-commit-split__main').click()
  await page.waitForFunction(() => window.__gpFixture.actions.length === 2)
  await page.waitForFunction(() => document.querySelector('.gp-feedback__text')?.textContent?.includes('提交已保存到本地'))
  assert.deepEqual(await actions(page), ['commit', 'push'])
  assert.match(await feedback(page), /推送被拒绝/)
  await page.close()
}

/* ── 10. phase label + lock: the button names the half that is running ──── */
{
  const page = await openPanel(CLEAN)
  await page.evaluate(() => { window.__gpFixture.holdRun = { kind: 'commit' } })
  await openMenu(page)
  await menuItems(page).nth(1).click()
  await flush(page)
  await page.locator('.gp-commitbox__msg').fill('feat: held')
  await page.locator('.gp-commit-split__main').click()
  await page.waitForFunction(() => document.querySelector('.gp-commit-split__main')?.textContent === '提交中…')
  assert.equal(await page.locator('.gp-commit-split__main').isDisabled(), true)
  assert.equal(await page.locator('.gp-commit-split__caret').isDisabled(), true, 'the menu is locked during the chain')
  // A second press while the first is parked must be a no-op.
  await page.locator('.gp-commit-split__main').click({ force: true }).catch(() => {})
  await page.evaluate(() => window.__gpFixture.releaseRun())
  await page.waitForFunction(() => window.__gpFixture.actions.length === 2)
  await flush(page)
  assert.equal((await actions(page)).filter((kind) => kind === 'commit').length, 1, 'one commit for one press')
  await page.close()
}

/* ── 11. the folded (cramped) bar keeps the same split control ──────────── */
{
  const page = await openPanel(CLEAN, { panelWidth: 390, panelHeight: 420, phone: true, folded: true })
  await page.locator('.gp-commitbar').waitFor()
  assert.equal(await page.locator('.gp-commitbar .gp-commit-split').count(), 1, 'the bar carries the split')
  assert.equal(await page.locator('.gp-commitbar__commit').count(), 1, 'the bar hook stays on the primary half')
  await openMenu(page)
  assert.equal(await menuItems(page).count(), 2)
  await menuItems(page).nth(1).click()
  await flush(page)
  assert.equal(await page.locator('.gp-commitbar__commit').innerText(), '提交并推送')
  await page.close()
}

/* ── 12. the accelerator never fires from behind a confirmation ─────────── */
{
  // The confirm dialog is portaled to body, but its React parent is still this
  // tab's subtree: the synthetic keydown bubbles to the tab's handler. An open
  // overlay owns the keystroke, so nothing is committed from inside the dialog.
  const page = await openPanel(CLEAN)
  await page.locator('.gp-commitbox__msg').fill('feat: guarded')
  await page.locator('.gp-changes__discard-all').click()
  await page.locator('.gp-modal-backdrop[data-gp-overlay]').waitFor()
  await page.locator('.gp-modal--sm .gp-btn--danger').first().focus()
  await page.keyboard.press('Control+Alt+KeyK')
  await flush(page)
  assert.deepEqual(await actions(page), [], 'no commit from inside the dialog')
  assert.equal(await page.locator('.gp-modal--sm').count(), 1, 'the confirmation stays open')
  await page.close()
}

assert.deepEqual(consoleErrors, [], 'zero console errors')
await browser.close()
console.log('commit-split: ok')
