/**
 * Isolated regression for the changes list's two views (issue #99): the flat
 * list and the directory tree, the tree's collapse / count / directory-level
 * actions, the config-backed view choice (one switch icon on the action
 * toolbar, hidden while the bar is compressed), and the remembered default. Run
 * setup.mjs first.
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
// Visual review aid (gitignored): the tree view next to its flat list.
const SHOT_FLAT = resolve(DIR, '../../docs/local/review/changes-flat.png')
const SHOT_TREE = resolve(DIR, '../../docs/local/review/changes-tree.png')
const THEME = `body{margin:0;font:13px system-ui,sans-serif;--dsh-composer-height:0px;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;
--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
--dsw-alias-bg-module-platform:#f5f6f7;
--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
#panel{border:0!important}`

const change = (path, options = {}) => ({ path, status: 'modified', staged: false, isDirectory: false, ...options })

const CLEAN = {
  root: 'changes-tree-fixture', branch: 'main', head: 'de54fc0', unborn: false,
  dirty: false, staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0,
  hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/changes-tree', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const DIRTY = {
  ...CLEAN, dirty: true, staged: 1, modified: 4, untracked: 1,
  changes: [
    change('src/client/a.ts'),
    change('src/client/b.ts'),
    change('src/server/c.ts'),
    change('readme.md'),
    change('docs/guide.md', { status: 'untracked' }),
    change('lib/core.ts', { status: 'renamed', staged: true, oldPath: 'lib/old-core.ts' }),
  ],
  stats: { ...CLEAN.stats, fileCount: 6, staged: 1, modified: 4, untracked: 1, insertions: 9, deletions: 2 },
}

/** The same checkout with the config's tree view applied (an older host that
 * omits the field degrades to flat — normalizeViewMode covers that). */
const DIRTY_TREE = { ...DIRTY, changesView: 'tree' }

const browser = await chromium.launch()
const consoleErrors = []

async function flush(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

/** Boot the harness on an existing page (reused after a reload). */
async function boot(page, snapshot, { panelWidth = 1000 } = {}) {
  await page.addStyleTag({ content: THEME })
  for (const file of ['client.js', 'mock-rpc.mjs']) await page.addScriptTag({ path: resolve(DIR, file) })
  await page.evaluate(({ snapshot, panelWidth }) => {
    const panel = document.getElementById('panel')
    panel.style.width = panelWidth + 'px'
    panel.style.height = '764px'
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    fixture.fingerprints = true
    window.__gpFixture = fixture
    window.__gpConfigWrites = []
    const registered = {}
    const dictionaries = {}
    const services = { connection, configForms: window.__gpConfigForms() }
    const ctx = {
      get: (key) => services[key],
      effect: (cb) => cb(),
      on: () => () => {},
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
    window.ReactDOM.createRoot(panel).render(registered['conversation.view']({ sessionId: 'changes-tree-session' }))
  }, { snapshot, panelWidth })
  await page.locator('[role="tab"]').nth(1).waitFor()
  await page.locator('[role="tab"]').nth(1).click()
  await page.locator('.gp-changes__toolbar').waitFor()
  await page.waitForFunction(() => window.__gpFixture.queries.includes('stash-list'))
  await flush(page)
}

async function openPanel(snapshot, options = {}) {
  // A touch page emulates the phone: the empty-hover contract below only holds
  // when the pointer really cannot hover.
  const page = await browser.newPage(options.touch
    ? { ...devices['Pixel 5'] }
    : { viewport: { width: options.viewportWidth ?? 1440, height: 764 } })
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (error) => consoleErrors.push('PAGEERROR ' + error.message))
  await page.goto(new URL('./harness.html', import.meta.url).href)
  await page.evaluate(() => {
    // The settings face used by both boots; `set` records into the page-global
    // so a scenario can assert what the toggle wrote.
    window.__gpConfigForms = () => ({
      describe: () => ({
        getSnapshot: () => ({
          view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {}, placement: {}, changesView: {} } }, value: {} }] },
          status: 'ready',
        }),
        subscribe: () => () => {},
        ensure: async () => {},
      }),
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: {}, revision: 0, writable: true }),
        subscribe: () => () => {},
        set: async (field, value) => { window.__gpConfigWrites.push([field, value]); return true },
      }),
    })
  })
  await boot(page, snapshot, options)
  return page
}

/** Rendered rows in list order: kind + label, for compact assertions. */
async function rows(page) {
  return page.locator('.gp-changes__vlist > .gp-changes__vrow').evaluateAll((nodes) => nodes.map((node) => {
    const dir = node.querySelector('.gp-dir-row')
    if (dir !== null) {
      return {
        kind: 'dir',
        name: dir.querySelector('.gp-dir-row__name').textContent,
        count: Number(dir.querySelector('.gp-dir-row__count').textContent),
        collapsed: dir.querySelector('.gp-dir-row__toggle').getAttribute('aria-expanded') === 'false',
        pad: Math.round(parseFloat(getComputedStyle(dir).paddingLeft)),
        aside: null,
      }
    }
    const file = node.querySelector('.gp-file-row')
    if (file === null) {
      return { kind: 'head', name: node.textContent.trim(), count: 0, collapsed: false, pad: 0, aside: null }
    }
    return {
      kind: 'file',
      name: file.querySelector('.gp-tree-name').firstChild.textContent.trim(),
      pad: Math.round(parseFloat(getComputedStyle(file).paddingLeft)),
      aside: file.querySelector('.gp-file-row__aside')?.textContent ?? null,
    }
  }))
}

/** Only the rows the reader sees as entries (heads carry the group counts). */
const entries = (list) => list.filter((row) => row.kind !== 'head')

/** The toolbar's view switch: one icon, whichever view is in use. */
const viewSwitch = (page) => page.locator('.gp-changes__viewbtn')
const viewState = (page) => viewSwitch(page).getAttribute('data-view')
/** The two glyphs the switch alternates between (icons.tsx). */
const LIST_PATH = 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11'
const TREE_PATH = 'M2.5 4.5h11M5.5 8h8M8.5 11.5h5'

/**
 * The row-height contract in rendered form: every row's child fills exactly the
 * box the window math declared (a dropped CSS pin lets it grow to content),
 * the offsets add up row by row (a row sized from the wrong constant would
 * break the chain), the spacer reserves exactly what it mounts, and no row's
 * content spills past its fixed height.
 */
async function assertRowGeometry(page, expectedMounted) {
  const geo = await page.locator('.gp-changes__vlist > .gp-changes__vrow').evaluateAll((nodes) => ({
    rows: nodes.map((node) => {
      const child = node.firstElementChild
      return {
        top: parseFloat(node.style.top),
        height: parseFloat(node.style.height),
        childH: child === null ? -1 : child.getBoundingClientRect().height,
        spill: child === null ? 0 : child.scrollHeight - child.clientHeight,
      }
    }),
    spacer: parseFloat(document.querySelector('.gp-changes__vlist').style.height),
  }))
  assert.equal(geo.rows.length, expectedMounted, `all ${expectedMounted} rows fit this viewport and mount`)
  for (let i = 0; i < geo.rows.length; i++) {
    const row = geo.rows[i]
    assert.ok(Math.abs(row.childH - row.height) <= 0.5, `row ${i}: its child fills the declared ${row.height}px box (measured ${row.childH}px)`)
    assert.ok(row.spill <= 1, `row ${i}: content stays inside the fixed row (${row.spill}px over)`)
    if (i > 0) {
      const prev = geo.rows[i - 1]
      assert.ok(Math.abs(row.top - (prev.top + prev.height)) <= 0.5, `row ${i}: top ${row.top} follows the previous row (${prev.top} + ${prev.height})`)
    }
  }
  const last = geo.rows[geo.rows.length - 1]
  assert.ok(Math.abs(geo.spacer - (last.top + last.height)) <= 0.5, 'the spacer reserves exactly the rows it mounts')
}

/** The action toolbar's fit, its controls' hit boxes and their row sharing. */
async function measureToolbar(page) {
  return page.locator('.gp-changes__toolbar').evaluate((node) => ({
    overflow: node.scrollWidth - node.clientWidth,
    height: node.getBoundingClientRect().height,
    // The yielded switch (display:none) reports an empty box.
    controls: [...node.querySelectorAll('button')]
      .map((el) => ({
        left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right,
        top: el.getBoundingClientRect().top,
        width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
      }))
      .filter((box) => box.width > 0 && box.height > 0),
  }))
}

/** The toolbar hosts the view switch; the old view bar (switch + filter) is gone. */
async function toolbarViewScenario() {
  const page = await openPanel(DIRTY)
  assert.equal(await page.locator('.gp-changes__viewbar').count(), 0, 'the view bar above the list no longer exists')
  assert.equal(await page.locator('.gp-changes__filter').count(), 0, 'no path filter')
  const toggle = viewSwitch(page)
  assert.equal(await toggle.count(), 1, 'one switch icon rides the action toolbar')
  assert.equal(await page.locator('.gp-changes__viewtoggle').count(), 0, 'the two-button group is gone')
  assert.equal(await toggle.evaluate((node) => node.parentElement?.className), 'gp-tip-wrap gp-changes__viewslot', 'the switch rides the bar as its last item')
  // Parked against the right edge: the bar's own padding is the only gap after it.
  const barBox = await page.locator('.gp-changes__toolbar').boundingBox()
  const slotBox = await page.locator('.gp-changes__viewslot').boundingBox()
  assert.ok(barBox !== null && slotBox !== null, 'the bar and the switch are both laid out')
  assert.ok(Math.abs((slotBox.x + slotBox.width) - (barBox.x + barBox.width - 8)) <= 1, `the switch hugs the right edge (${Math.round(slotBox.x + slotBox.width)} vs ${Math.round(barBox.x + barBox.width - 8)})`)
  assert.equal(await viewState(page), 'flat', 'flat is the configured default')
  assert.equal(await toggle.getAttribute('aria-label'), '当前平铺，点击切换到树形', 'the name states the view in use and what a click does')
  // The switch is not a bare icon: it carries a grey plate (the theme token, so
  // the dark theme follows), which is what tells it apart from the actions.
  const plate = await toggle.evaluate((node) => getComputedStyle(node).backgroundColor)
  assert.equal(plate, 'rgb(245, 246, 247)', 'the switch sits on a grey plate')
  assert.equal(await toggle.locator('svg path').getAttribute('d'), LIST_PATH, 'flat draws the list glyph')
  // Default view is the flat list: one row per change, no directory rows.
  assert.deepEqual(entries(await rows(page)).map((r) => r.kind), ['file', 'file', 'file', 'file', 'file', 'file'])
  assert.equal(await page.locator('.gp-dir-row').count(), 0)
  // A rename names its source in the flat list — and does not repeat the
  // directory beside it (the source path already names one).
  const flatRename = entries(await rows(page)).find((r) => r.name === 'core.ts')
  assert.equal(flatRename.aside, '← lib/old-core.ts', 'one "from" per row, the directory suffix stays away')
  const left = await page.locator('.gp-changes__left').boundingBox()
  if (left !== null) {
    mkdirSync(dirname(SHOT_FLAT), { recursive: true })
    await page.screenshot({ path: SHOT_FLAT, clip: { x: left.x, y: left.y, width: left.width, height: Math.min(left.height, 420) } })
  }
  // Switching writes the plugin config — the choice is install-level, not this
  // browser's storage.
  await toggle.click()
  await page.waitForFunction(() => document.querySelector('.gp-dir-row') !== null)
  assert.deepEqual(await page.evaluate(() => window.__gpConfigWrites), [['changesView', 'tree']], 'the switch writes changesView through the settings service')
  assert.equal(await viewState(page), 'tree', 'the glyph follows the new view')
  assert.equal(await toggle.locator('svg path').getAttribute('d'), TREE_PATH, 'tree draws the indented glyph')
  assert.equal(await toggle.getAttribute('aria-label'), '当前树形，点击切换到平铺', 'the name flips with the view')
  await toggle.click()
  await page.waitForFunction(() => document.querySelector('.gp-dir-row') === null)
  assert.deepEqual(await page.evaluate(() => window.__gpConfigWrites), [['changesView', 'tree'], ['changesView', 'flat']])
  assert.equal(await viewState(page), 'flat', 'the same control toggles back')
  assert.equal(await page.evaluate(() => localStorage.getItem('gp.changes.view')), null, 'nothing lands in browser storage')
  await page.close()
}

/** Switching to the tree groups rows by directory, indents them and counts them. */
async function treeScenario() {
  const page = await openPanel(DIRTY)
  await viewSwitch(page).click()
  await page.waitForFunction(() => document.querySelector('.gp-dir-row') !== null)
  const tree = entries(await rows(page))
  const dirs = tree.filter((r) => r.kind === 'dir')
  // `src` has two child directories, so it stays its own row; a directory with a
  // single directory child would be folded into one `a/b` row.
  assert.deepEqual(dirs.map((d) => d.name), ['lib', 'src', 'client', 'server', 'docs'], 'one row per directory, in group order')
  assert.deepEqual(dirs.map((d) => d.count), [1, 3, 2, 1, 1], 'each directory counts its whole subtree')
  // Each level indents one step, and a file row starts one base offset in.
  const src = dirs.find((d) => d.name === 'src')
  const client = dirs.find((d) => d.name === 'client')
  assert.equal(client.pad - src.pad, 14, 'a child directory indents one level under its parent')
  const nested = tree.find((r) => r.kind === 'file' && r.name === 'a.ts')
  assert.equal(nested.pad, client.pad + 24, 'a nested file indents under its directory')
  // The root-level file keeps the flat row's indent.
  const root = tree.find((r) => r.kind === 'file' && r.name === 'readme.md')
  assert.equal(root.pad, 20)
  assert.equal(nested.aside, null, 'the tree does not repeat the directory after the name')
  // Review shots: the same snapshot in both views, left column only.
  const left = await page.locator('.gp-changes__left').boundingBox()
  if (left !== null) {
    mkdirSync(dirname(SHOT_TREE), { recursive: true })
    await page.screenshot({ path: SHOT_TREE, clip: { x: left.x, y: left.y, width: left.width, height: Math.min(left.height, 420) } })
  }
  // A rename names its source on either view.
  const renamed = tree.find((r) => r.kind === 'file' && r.name === 'core.ts')
  assert.match(renamed.aside, /lib\/old-core\.ts$/, 'a rename shows the old path')
  const row = page.locator('.gp-file-row', { hasText: 'core.ts' }).locator('.gp-tree-name')
  assert.equal(await row.getAttribute('title'), 'lib/old-core.ts → lib/core.ts', 'the row title spells the move')
  // Heads, directories and files together: 3 groups + 5 directories + 6 files.
  await assertRowGeometry(page, 14)
  await page.close()
}

/** Folding a directory hides its rows and keeps its aggregated target. */
async function collapseScenario() {
  const page = await openPanel(DIRTY)
  await viewSwitch(page).click()
  const dir = page.locator('.gp-dir-row', { hasText: 'client' }).first()
  await dir.waitFor()
  await dir.locator('.gp-dir-row__name').click()
  await flush(page)
  assert.equal(await dir.locator('.gp-dir-row__toggle').getAttribute('aria-expanded'), 'false', 'the directory reports itself folded')
  assert.equal(await page.locator('.gp-file-row', { hasText: 'a.ts' }).count(), 0, 'folded children leave the list')
  // The sibling directory and the root-level file are untouched.
  assert.equal(await page.locator('.gp-dir-row', { hasText: 'server' }).count(), 1)
  assert.equal(await page.locator('.gp-file-row', { hasText: 'readme.md' }).count(), 1)
  assert.equal(entries(await rows(page)).find((r) => r.kind === 'dir' && r.name === 'client').count, 2, 'the folded directory keeps its count')
  // The checkbox still picks the folded subtree.
  await dir.locator('input.gp-check').check()
  assert.equal(await page.locator('.gp-file-row input.gp-check:checked').count(), 0, 'folded rows are not mounted')
  assert.equal(await dir.locator('input.gp-check').isChecked(), true, 'picking a folded directory selects its rows')
  await dir.locator('.gp-dir-row__name').click()
  await flush(page)
  assert.equal(await dir.locator('.gp-dir-row__toggle').getAttribute('aria-expanded'), 'true')
  assert.equal(await page.locator('.gp-file-row input.gp-check:checked').count(), 2, 'the picked subtree survives the fold')
  await page.close()
}

/** Directory-level stage / discard act on the directory's own rows. */
async function directoryActionsScenario() {
  const page = await openPanel(DIRTY)
  await viewSwitch(page).click()
  const dir = page.locator('.gp-dir-row', { hasText: 'client' }).first()
  await dir.waitFor()
  const stage = dir.locator('.gp-dir-row__actions button', { hasText: '+' })
  assert.equal(await stage.getAttribute('aria-label'), '暂存此目录')
  await dir.hover()
  await stage.click()
  await page.waitForFunction(() => window.__gpFixture.actions.length === 1)
  assert.deepEqual(
    await page.evaluate(() => window.__gpFixture.actions),
    [{ kind: 'stage', paths: ['src/client/a.ts', 'src/client/b.ts'] }],
    'staging a directory names its working-tree rows only',
  )
  // Discard goes through the confirmation dialog, scoped to the directory.
  const discard = dir.locator('.gp-dir-row__actions button[aria-label="放弃此目录的更改"]')
  await dir.hover()
  await discard.click()
  await page.locator('.gp-modal--sm').waitFor()
  assert.equal(await page.locator('.gp-modal__path').textContent(), '放弃此目录的更改：src/client', 'the dialog names the directory by its full path')
  const body = await page.locator('.gp-modal__confirmtext').textContent()
  assert.match(body, /2 个文件/, 'the dialog counts the directory’s working-tree files')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.gp-modal--sm') === null)
  assert.equal((await page.evaluate(() => window.__gpFixture.actions)).length, 1, 'cancelling sends no discard')
  await page.close()
}

/** The configured view is what a fresh mount shows; config, not storage. */
async function configViewScenario() {
  const page = await openPanel(DIRTY_TREE)
  assert.equal(await page.locator('.gp-dir-row').count(), 5, 'the configured tree view mounts directly')
  assert.equal(await viewState(page), 'tree', 'the glyph follows the configured view')
  await page.close()

  // A clean work tree: the empty state says what it is, and the switch is part
  // of the toolbar (it does not depend on rows existing).
  const clean = await openPanel(CLEAN)
  assert.equal(await clean.locator('.gp-changes__list .gp-empty').textContent(), '没有未提交的变更')
  assert.equal(await clean.locator('.gp-changes__viewbtn').count(), 1)
  await clean.close()
}

/** The bar has to fit the narrowest layout: the switch yields, actions stay. */
async function compactScenario() {
  const page = await openPanel(DIRTY_TREE, { viewportWidth: 320, panelWidth: 320, touch: true })
  assert.equal(await page.locator('.gp-panel').getAttribute('data-layout'), 'compact')
  const bar = await measureToolbar(page)
  assert.ok(bar.overflow <= 1, `the action bar fits a 320px panel (overflow ${bar.overflow}px)`)
  for (const control of bar.controls) {
    assert.ok(control.width >= 24 && control.height >= 24, 'every visible control keeps a usable hit box')
  }
  const tops = new Set(bar.controls.map((c) => Math.round(c.top)))
  assert.equal(tops.size, 1, 'all the actions share one row')
  // The wrap (the bar's flex item) is what yields; a display:none ancestor
  // still reports the button's own display, so measure the box instead.
  const yielded = await viewSwitch(page).evaluate((node) => node.getBoundingClientRect().width === 0)
  assert.equal(yielded, true, 'the view switch steps aside while the bar is compressed')
  // The configured tree still renders in the compact layout.
  assert.equal(await page.locator('.gp-dir-row__toggle').count(), 5, 'the tree works in the compact layout too')
  // A phone has no hover: the directory actions must be visible without it —
  // and pinned to the 26px row, so they never spill into the neighbours.
  assert.equal(await page.locator('.gp-dir-row__actions').first().evaluate((node) => getComputedStyle(node).visibility), 'visible', 'no hover on a phone, so the row actions stay visible')
  const actionBox = await page.locator('.gp-dir-row__actions button').first().boundingBox()
  const dirBox = await page.locator('.gp-dir-row').first().boundingBox()
  assert.ok(actionBox !== null && dirBox !== null && actionBox.height <= dirBox.height + 0.5, `a directory action fits its row (${actionBox?.height}px in ${dirBox?.height}px)`)
  await page.close()
}

/**
 * The stacked sidebar seat: `panelMode` only produces `stacked` for a desktop
 * sidebar host, so this boots the right-sidebar page type (the same seat
 * stacked-repos.mjs mounts) instead of the conversation view. The bar has to
 * survive the band's narrow column the same way it survives compact.
 */
async function stackedScenario() {
  const page = await browser.newPage({ viewport: { width: 760, height: 764 } })
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  page.on('pageerror', (error) => consoleErrors.push('PAGEERROR ' + error.message))
  await page.goto(new URL('./harness.html', import.meta.url).href)
  await page.addStyleTag({ content: THEME })
  for (const file of ['client.js', 'mock-rpc.mjs']) await page.addScriptTag({ path: resolve(DIR, file) })
  await page.evaluate((snapshot) => {
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    fixture.fingerprints = true
    window.__gpFixture = fixture
    window.__gpConfigWrites = []
    const registered = {}
    const settings = {
      view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {}, placement: {}, changesView: {} } }, value: {} }] },
      status: 'ready',
    }
    const configForms = {
      describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: {}, revision: 0, writable: true }),
        subscribe: () => () => {},
        set: async (field, value) => { window.__gpConfigWrites.push([field, value]); return true },
      }),
    }
    const services = {
      connection,
      configForms,
      sidebarRightTabs: { register: () => () => {} },
      sidebarRight: { openTab: () => {} },
    }
    const dictionaries = {}
    const ctx = {
      get: (key) => services[key],
      effect: (cb) => cb(),
      on: () => () => {},
      inject: (_deps, cb) => cb(ctx),
      slots: {
        inject: (_name, provider) => provider(),
        register: (reg, component) => {
          const key = reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`
          registered[key] = component
          return () => { delete registered[key] }
        },
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
    const entry = registered['sidebar.right.pane.tab::@xbzbing/dsh-git-panel']
    if (entry === undefined) throw new Error('sidebar body seat did not register')
    const panel = document.getElementById('panel')
    panel.style.width = '700px'
    panel.style.height = '764px'
    window.ReactDOM.createRoot(panel).render(entry({
      sessionId: 'changes-tree-session',
      useTabInfo: () => ({ tab: { visible: true } }),
      t: ctx.locale.bind('dbGitPanel'),
    }))
  }, DIRTY)
  await page.locator('.gp-panel [role="tab"]', { hasText: '变更记录' }).click()
  await page.locator('.gp-changes__toolbar').waitFor()
  await page.waitForFunction(() => window.__gpFixture.queries.includes('stash-list'))
  await flush(page)
  assert.equal(await page.locator('.gp-panel').getAttribute('data-layout'), 'stacked', 'a desktop sidebar host stacks')
  const bar = await measureToolbar(page)
  assert.ok(bar.overflow <= 1, `the action bar fits the stacked column (overflow ${bar.overflow}px)`)
  for (const control of bar.controls) {
    assert.ok(control.width >= 24 && control.height >= 24, 'stacked controls keep a usable hit box')
  }
  // The wrap (the bar's flex item) is what yields; a display:none ancestor
  // still reports the button's own display, so measure the box instead.
  const yielded = await viewSwitch(page).evaluate((node) => node.getBoundingClientRect().width === 0)
  assert.equal(yielded, false, 'the stacked column has room for the switch')
  await viewSwitch(page).click()
  await page.waitForFunction(() => document.querySelector('.gp-dir-row') !== null)
  assert.equal(await page.locator('.gp-dir-row__toggle').count(), 5, 'the tree renders in the stacked layout')
  await page.close()
}

try {
  await toolbarViewScenario()
  await treeScenario()
  await collapseScenario()
  await directoryActionsScenario()
  await configViewScenario()
  await compactScenario()
  await stackedScenario()
  assert.deepEqual(consoleErrors, [], 'no frontend errors')
  console.log('e2e changes-tree.mjs: PASS', JSON.stringify({ screenshots: [SHOT_FLAT, SHOT_TREE] }))
} catch (error) {
  console.error('e2e changes-tree.mjs: FAIL', error.stack ?? error.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
