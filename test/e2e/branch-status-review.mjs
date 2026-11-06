/**
 * Branch-status regressions (independent review): the current branch is pinned
 * first and the primary second, each with its own icon + role label, and the
 * ahead/behind counts render as sync arrows in the business colour.
 *
 * Isolated file:// harness, no dsh server — same mode as branch-tree-review.mjs.
 * The first case also captures the left column in the real light/dark palettes
 * and repeats the pin/arrow checks in the compact branch sheet.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

const SCREENSHOT_DIR = new URL('../../docs/local/', import.meta.url)
mkdirSync(SCREENSHOT_DIR, { recursive: true })

const BUSINESS_TOKEN = '--dsw-alias-state-business-primary'
/** The real light-theme value of the token above. */
const BUSINESS_RGB = 'rgb(65, 118, 230)'

/**
 * The real dsh theme tokens (extracted from `dsh-client-ui-theme`'s
 * design-platform stylesheet) for every `--dsw-*` name this plugin's own
 * stylesheet references, so the screenshots show real colours instead of the
 * harness's token-less fallbacks. The selectors mirror the shell: `body` is
 * light, `body[data-ds-dark-theme]` is dark.
 */
const LIGHT_TOKENS = '--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-caption:#adb2b8;--dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;--dsw-focus-ring-color:transparent;--dsw-focus-ring-width:2px;--dsw-radius-lg:16px;--dsw-radius-sm:8px;--dsw-static-neutral-1000:#000'
const DARK_TOKENS = '--dsw-alias-bg-base:#151517;--dsw-alias-bg-layer-1:#232324;--dsw-alias-bg-layer-2:#2c2c2e;--dsw-alias-bg-layer-3:#353638;--dsw-alias-border-l1:#ffffff0f;--dsw-alias-border-l2:#ffffff1f;--dsw-alias-interactive-bg-hover:#ffffff14;--dsw-alias-label-caption:#81858c;--dsw-alias-label-primary:#f9fafb;--dsw-alias-label-secondary:#cfd3d6;--dsw-alias-label-tertiary:#adb2b8;--dsw-alias-state-business-primary:#7aaaff;--dsw-alias-state-error-primary:#f25a5a;--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;--dsw-focus-ring-color:transparent;--dsw-focus-ring-width:2px;--dsw-radius-lg:16px;--dsw-radius-sm:8px;--dsw-static-neutral-1000:#000'
const THEME_CSS = `body{margin:0;background:var(--dsw-alias-bg-base);font:13px system-ui,sans-serif;color:var(--dsw-alias-label-primary);${LIGHT_TOKENS}}\nbody[data-ds-dark-theme]{${DARK_TOKENS}}`

const CASES = [
  { label: 'current pinned first, primary second', current: 'feature/deep/current', primary: 'main', switchTo: null, screenshots: true },
  { label: 'current === primary collapses to one row', current: 'main', primary: 'main', switchTo: null, screenshots: false },
  { label: 'switching current recomputes the pin', current: 'feature/deep/current', primary: 'main', switchTo: 'feature/other', screenshots: false },
]

const browser = await chromium.launch()
try {
  for (const testCase of CASES) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(new URL('./harness.html', import.meta.url).href)
    await page.addStyleTag({ content: THEME_CSS })
    for (const file of ['client.js', 'mock-rpc.mjs']) {
      await page.addScriptTag({ path: fileURLToPath(new URL(file, import.meta.url)) })
    }

    const result = await page.evaluate(async ({ current, primary, switchTo, businessToken, screenshots }) => {
      const snap = {
        root: 'branch-status-review', branch: current, head: 'abc1234', dirty: false,
        unborn: false, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
        remote: { name: 'origin' },
        changes: [],
        stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
        truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
      }
      const { connection } = window.createGitPanelMock(snap)
      const local = [
        { name: 'main', shortHash: 'aaa1111', ahead: 1, behind: 0 },
        { name: 'feature/deep/current', shortHash: 'bbb2222', ahead: 0, behind: 14 },
        { name: 'feature/other', shortHash: 'ccc3333', ahead: 0, behind: 0 },
        { name: 'misc/one', shortHash: 'ddd4444', ahead: 0, behind: 0 },
        // Both directions on one row → two sync arrows.
        { name: 'forked', shortHash: 'fff6666', ahead: 2, behind: 3 },
      ]
      // A remote ref sharing the local current's leaf name must stay unmarked.
      const remote = [{ name: 'origin/current', shortHash: 'eee5555' }, { name: 'origin/main', shortHash: 'aaa1111' }]
      let branchesCurrent = current
      const call = connection.rpc.call
      connection.rpc.call = async (channel, endpoint, payload) => {
        const query = payload && payload.args && payload.args.request && payload.args.request.query
        if (endpoint === 'dbGitPanel/query' && query && query.kind === 'branches') {
          return { ok: true, value: { ok: true, value: { kind: 'branches', current: branchesCurrent, defaultBranch: primary, local, remote } } }
        }
        return call(channel, endpoint, payload)
      }
      const registered = {}
      const ctx = {
        get: (name) => name === 'connection' ? connection : undefined,
        effect: (callback) => callback(), on: () => () => {}, inject: (_deps, callback) => callback(ctx),
        slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = component; return () => {} } },
        locale: { register: () => () => {}, bind: () => (key) => key },
      }
      window.__getLoaded().apply(ctx)
      // The left column's width is the plugin's own persisted UI state (default
      // 200px, too narrow for the pinned full ref). Preset it for the shots so
      // the captured list shows the names the way a widened panel does.
      if (screenshots) localStorage.setItem('gp.overview.left', '340')
      const root = window.ReactDOM.createRoot(document.getElementById('panel'))
      root.render(registered['conversation.view']({ sessionId: 'branch-status-review' }))
      const flush = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const waitFor = async (test, label) => {
        const deadline = performance.now() + 5000
        while (!test()) {
          if (performance.now() > deadline) throw new Error('did not settle: ' + label)
          await flush()
        }
      }

      const groupOf = (key) => [...document.querySelectorAll('.gp-branch-group')]
        .find((group) => (group.querySelector('.gp-branch-group__head')?.textContent || '').includes(key))
      const leaves = (group) => [...group.querySelectorAll('.gp-branch-row:not(.gp-branch-row--dir)')]
      // Deeper directories start collapsed, so expand them before reading.
      const expandAll = async (group) => {
        for (let i = 0; i < 8; i += 1) {
          const closed = [...group.querySelectorAll('.gp-branch-row--dir[aria-expanded="false"]')]
          if (closed.length === 0) return
          closed[0].click()
          await flush()
        }
      }
      const readRow = (row) => {
        const icon = row.querySelector('.gp-branch-row__ic')
        const track = row.querySelector('.gp-branch-row__track')
        return {
          title: row.getAttribute('title'),
          dataCurrent: row.getAttribute('data-current'),
          dataPrimary: row.getAttribute('data-primary'),
          rowClass: row.className,
          iconClass: icon === null ? null : icon.className,
          iconAria: icon === null ? null : icon.getAttribute('aria-label'),
          iconTitle: icon === null ? null : icon.getAttribute('title'),
          hasTrack: track !== null,
          trackColor: track === null ? null : getComputedStyle(track).color,
          sync: track === null ? [] : [...track.querySelectorAll('svg.gp-branch-row__sync-icon')].map((svg) => svg.getAttribute('data-direction')),
          syncText: track === null ? [] : [...track.querySelectorAll('.gp-branch-row__sync')].map((node) => node.lastElementChild?.textContent ?? node.textContent),
        }
      }
      const readLocal = async () => {
        const group = groupOf('overview.local')
        await expandAll(group)
        return leaves(group).map(readRow)
      }

      await waitFor(() => groupOf('overview.local') !== undefined
        && leaves(groupOf('overview.local')).some((row) => row.getAttribute('title') === current), 'pinned current')
      const initial = await readLocal()

      // The remote section starts collapsed.
      const remoteGroup = groupOf('overview.remote')
      remoteGroup.querySelector('.gp-branch-group__head').click()
      await waitFor(() => leaves(remoteGroup).length >= 1, 'remote rows')
      await expandAll(remoteGroup)
      const remoteRows = leaves(remoteGroup).map(readRow)

      const trackRuleUsesToken = [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) => (rule.selectorText || '').includes('.gp-branch-row__track')
            && new RegExp(`var\\(${businessToken}\\)`).test(rule.cssText || ''))
        } catch { return false }
      })

      let afterSwitch = null
      if (switchTo !== null) {
        branchesCurrent = switchTo
        document.querySelector('.gp-toolbar button[title="overview.fetch"]').click()
        await waitFor(() => leaves(groupOf('overview.local'))[0]?.getAttribute('title') === switchTo, 'pin recompute')
        afterSwitch = await readLocal()
      }

      // The root stays mounted for the outer screenshots and the compact pass.
      window.__branchReviewRoot = root
      window.__branchReviewRead = (selector) => {
        const scope = document.querySelector(selector)
        // The list's own "head" row is a bare .gp-branch-row with no title; leaf
        // rows always carry the full ref, so a title is the leaf marker.
        return scope === null ? null : [...scope.querySelectorAll('.gp-branch-row:not(.gp-branch-row--dir)')]
          .filter((row) => row.hasAttribute('title'))
          .map(readRow)
      }
      window.__branchReviewWait = waitFor
      return { initial, remoteRows, trackRuleUsesToken, afterSwitch }
    }, { ...testCase, businessToken: BUSINESS_TOKEN })

    const { initial, remoteRows, trackRuleUsesToken, afterSwitch } = result
    const byTitle = (rows, title) => rows.filter((row) => row.title === title)

    assert.equal(trackRuleUsesToken, true, `${testCase.label}: the track colour comes from the business token`)

    if (testCase.current === testCase.primary) {
      assert.equal(initial[0].title, 'main', `${testCase.label}: the single current+primary row leads the section`)
      // One node carries both roles; current wins the icon.
      const currentRows = initial.filter((row) => row.dataCurrent === 'true')
      assert.equal(currentRows.length, 1, `${testCase.label}: exactly one current row`)
      const both = currentRows[0]
      assert.equal(both.title, 'main', `${testCase.label}: the current+primary row is the default branch`)
      assert.equal(both.dataPrimary, 'true', `${testCase.label}: the same node is also primary`)
      assert.match(both.iconClass, /gp-branch-row__ic--current/, `${testCase.label}: current icon modifier`)
      assert.doesNotMatch(both.iconClass, /--primary/, `${testCase.label}: current wins the single modifier`)
      assert.equal(both.iconAria, 'overview.currentBranch · overview.primaryBranch', `${testCase.label}: joined role label`)
      assert.equal(both.iconTitle, both.iconAria, `${testCase.label}: title mirrors the aria label`)
      assert.equal(byTitle(initial, 'main').length, 1, `${testCase.label}: no duplicate row for the same ref`)
    } else {
      assert.deepEqual(initial.slice(0, 2).map((row) => row.title), [testCase.current, testCase.primary],
        `${testCase.label}: the current leads and the primary follows`)
      const [cur, pri] = initial
      assert.equal(cur.dataCurrent, 'true', `${testCase.label}: current carries data-current`)
      assert.notEqual(cur.dataPrimary, 'true', `${testCase.label}: current is not primary`)
      assert.match(cur.iconClass, /gp-branch-row__ic--current/, `${testCase.label}: current icon modifier`)
      assert.doesNotMatch(cur.iconClass, /--primary/, `${testCase.label}: current icon is not primary`)
      assert.equal(cur.iconAria, 'overview.currentBranch', `${testCase.label}: current role label`)
      assert.equal(cur.iconTitle, 'overview.currentBranch', `${testCase.label}: current title`)
      assert.equal(pri.dataPrimary, 'true', `${testCase.label}: primary carries data-primary`)
      assert.notEqual(pri.dataCurrent, 'true', `${testCase.label}: primary is not current`)
      assert.match(pri.iconClass, /gp-branch-row__ic--primary/, `${testCase.label}: primary icon modifier`)
      assert.doesNotMatch(pri.iconClass, /--current/, `${testCase.label}: primary icon is not current`)
      assert.equal(pri.iconAria, 'overview.primaryBranch', `${testCase.label}: primary role label`)

      // Sync arrows: one per non-zero direction, in the business colour.
      assert.deepEqual(cur.sync, ['behind'], `${testCase.label}: current is behind only`)
      assert.deepEqual(cur.syncText, ['14'], `${testCase.label}: behind count`)
      assert.equal(cur.trackColor, BUSINESS_RGB, `${testCase.label}: behind track uses the business colour`)
      assert.deepEqual(pri.sync, ['ahead'], `${testCase.label}: primary is ahead only`)
      assert.deepEqual(pri.syncText, ['1'], `${testCase.label}: ahead count`)
      assert.equal(pri.trackColor, BUSINESS_RGB, `${testCase.label}: ahead track uses the business colour`)

      const forked = byTitle(initial, 'forked')[0]
      assert.deepEqual(forked.sync, ['ahead', 'behind'], `${testCase.label}: a forked branch renders both arrows`)
      assert.deepEqual(forked.syncText, ['2', '3'], `${testCase.label}: both counts render`)

      // In-sync branches keep the plain icon and no track at all.
      for (const title of ['feature/other', 'misc/one']) {
        const row = byTitle(initial, title)[0]
        assert.ok(row !== undefined, `${testCase.label}: ${title} is listed`)
        assert.notEqual(row.dataCurrent, 'true', `${testCase.label}: ${title} is not current`)
        assert.notEqual(row.dataPrimary, 'true', `${testCase.label}: ${title} is not primary`)
        assert.doesNotMatch(row.iconClass, /--current|--primary/, `${testCase.label}: ${title} keeps the plain icon`)
        assert.equal(row.hasTrack, false, `${testCase.label}: ${title} has no sync track`)
        assert.equal(row.iconAria, null, `${testCase.label}: ${title} has no role label`)
      }

      // The current ref is nested (feature/deep/current): the fold must not
      // swallow it, and it must be the pinned row.
      assert.equal(byTitle(initial, 'feature/deep/current').length, 1, `${testCase.label}: nested current appears once`)
    }

    // A remote ref with the same leaf name is never marked by the local current.
    const remoteCurrent = byTitle(remoteRows, 'origin/current')[0]
    assert.ok(remoteCurrent !== undefined, `${testCase.label}: origin/current is listed`)
    assert.notEqual(remoteCurrent.dataCurrent, 'true', `${testCase.label}: a remote ref is never current`)
    assert.notEqual(remoteCurrent.dataPrimary, 'true', `${testCase.label}: a remote ref is never primary`)
    assert.doesNotMatch(remoteCurrent.iconClass, /--current|--primary/, `${testCase.label}: remote keeps the plain icon`)

    if (afterSwitch !== null) {
      assert.equal(afterSwitch[0].title, testCase.switchTo, `${testCase.label}: the new current is pinned first`)
      assert.equal(afterSwitch[0].dataCurrent, 'true', `${testCase.label}: the new current is marked`)
      assert.equal(afterSwitch[1].title, testCase.primary, `${testCase.label}: the primary stays second`)
      const stale = byTitle(afterSwitch, testCase.current)
      assert.equal(stale.length, 1, `${testCase.label}: the old current returns to the tree exactly once`)
      assert.notEqual(stale[0].dataCurrent, 'true', `${testCase.label}: the old current is unmarked`)
      assert.doesNotMatch(stale[0].iconClass, /--current/, `${testCase.label}: the old current loses its icon`)
      assert.equal(afterSwitch.filter((row) => row.dataCurrent === 'true').length, 1, `${testCase.label}: exactly one current row`)
    }

    if (testCase.screenshots) {
      // Real palettes: the shell flips dark by marking the body.
      await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
      await page.locator('.gp-col--left').screenshot({ path: fileURLToPath(new URL('branch-status-dark.png', SCREENSHOT_DIR)) })
      await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
      await page.locator('.gp-col--left').screenshot({ path: fileURLToPath(new URL('branch-status-light.png', SCREENSHOT_DIR)) })

      // Compact: the branch list moves into the filter sheet and must carry the
      // same pin order and arrows.
      const sheet = await page.evaluate(async () => {
        document.getElementById('panel').style.width = '580px'
        await window.__branchReviewWait(() => document.querySelector('.gp-overview--compact') !== null, 'compact layout')
        document.querySelector('.gp-toolbar .gp-btn[title="overview.filterBranch"]').click()
        await window.__branchReviewWait(() => document.querySelector('.gp-sheet') !== null, 'branch sheet')
        return window.__branchReviewRead('.gp-sheet')
      })
      assert.ok(sheet !== null && sheet.length >= 2, `${testCase.label}: the compact sheet lists the branches`)
      assert.deepEqual(sheet.slice(0, 2).map((row) => row.title), [testCase.current, testCase.primary],
        `${testCase.label}: the sheet repeats the current-then-primary pin`)
      assert.match(sheet[0].iconClass, /gp-branch-row__ic--current/, `${testCase.label}: the sheet keeps the current icon`)
      assert.match(sheet[1].iconClass, /gp-branch-row__ic--primary/, `${testCase.label}: the sheet keeps the primary icon`)
      assert.deepEqual(sheet[0].sync, ['behind'], `${testCase.label}: the sheet keeps the behind arrow`)
      assert.deepEqual(sheet[1].sync, ['ahead'], `${testCase.label}: the sheet keeps the ahead arrow`)
      assert.equal(sheet[0].trackColor, BUSINESS_RGB, `${testCase.label}: the sheet keeps the business colour`)
      await page.locator('.gp-sheet').screenshot({ path: fileURLToPath(new URL('branch-status-compact.png', SCREENSHOT_DIR)) })
    }

    await page.evaluate(() => {
      window.__branchReviewRoot.unmount()
      delete window.__branchReviewRoot
      delete window.__branchReviewRead
      delete window.__branchReviewWait
    })

    assert.deepEqual(errors, [], `${testCase.label}: no browser runtime errors`)
    console.log('branch-status review: PASS', testCase.label, JSON.stringify({
      order: initial.slice(0, 3).map((row) => row.title), switched: afterSwitch === null ? null : afterSwitch.slice(0, 3).map((row) => row.title),
    }))
    await page.close()
  }
} finally {
  await browser.close()
}
