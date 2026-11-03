/**
 * Isolated regression for the changes list's two views (issue #99): the flat
 * list and the directory tree, the tree's collapse / count / directory-level
 * actions, the path filter, and the remembered choice. Run setup.mjs first.
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

const browser = await chromium.launch()
const consoleErrors = []

async function flush(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

/** Boot the harness on an existing page (reused after a reload). */
async function boot(page, snapshot, { clearView = true, panelWidth = 1000 } = {}) {
  await page.addStyleTag({ content: THEME })
  for (const file of ['client.js', 'mock-rpc.mjs']) await page.addScriptTag({ path: resolve(DIR, file) })
  await page.evaluate(({ snapshot, clearView, panelWidth }) => {
    if (clearView) localStorage.removeItem('gp.changes.view')
    const panel = document.getElementById('panel')
    panel.style.width = panelWidth + 'px'
    panel.style.height = '764px'
    const { fixture, connection } = window.createGitPanelMock(snapshot)
    fixture.fingerprints = true
    window.__gpFixture = fixture
    const registered = {}
    const dictionaries = {}
    const ctx = {
      get: (key) => key === 'connection' ? connection : undefined,
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
  }, { snapshot, clearView, panelWidth })
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

const viewButton = (page, label) => page.locator('.gp-changes__viewseg .gp-seg__btn', { hasText: label })

/** The view bar exists and both controls are named for assistive tech. */
async function viewBarScenario() {
  const page = await openPanel(DIRTY)
  const bar = page.locator('.gp-changes__viewbar')
  assert.equal(await bar.count(), 1, 'the view bar sits above the change list')
  assert.deepEqual(await page.locator('.gp-changes__viewseg .gp-seg__btn').allTextContents(), ['平铺', '树形'], 'flat / tree switch is localized')
  assert.equal(await page.locator('.gp-changes__viewseg').getAttribute('role'), 'group')
  assert.equal(await page.locator('.gp-changes__viewseg').getAttribute('aria-label'), '变更列表视图')
  assert.equal(await page.locator('.gp-changes__filter').getAttribute('placeholder'), '过滤路径…', 'the filter explains itself when empty')
  assert.equal(await page.locator('.gp-changes__filter').getAttribute('aria-label'), '过滤变更文件')
  assert.equal(await page.locator('.gp-changes__filter-clear').count(), 0, 'no clear control while the filter is empty')
  // Default view is the flat list: no directory rows, one row per change.
  assert.deepEqual(entries(await rows(page)).map((r) => r.kind), ['file', 'file', 'file', 'file', 'file', 'file'])
  assert.equal(await page.locator('.gp-dir-row').count(), 0)
  assert.equal(await page.evaluate(() => localStorage.getItem('gp.changes.view')), null, 'a fresh mount writes no preference')
  const left = await page.locator('.gp-changes__left').boundingBox()
  if (left !== null) {
    mkdirSync(dirname(SHOT_FLAT), { recursive: true })
    await page.screenshot({ path: SHOT_FLAT, clip: { x: left.x, y: left.y, width: left.width, height: Math.min(left.height, 420) } })
  }
  await page.close()
}

/** Switching to the tree groups rows by directory, indents them and counts them. */
async function treeScenario() {
  const page = await openPanel(DIRTY)
  await viewButton(page, '树形').click()
  await page.waitForFunction(() => document.querySelector('.gp-dir-row') !== null)
  assert.equal(await page.evaluate(() => localStorage.getItem('gp.changes.view')), 'tree', 'the choice is remembered')
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
  await page.close()
}

/** Folding a directory hides its rows and keeps its aggregated target. */
async function collapseScenario() {
  const page = await openPanel(DIRTY)
  await viewButton(page, '树形').click()
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
  await viewButton(page, '树形').click()
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
  assert.equal(await page.locator('.gp-modal__path').textContent(), '放弃此目录的更改：client')
  const body = await page.locator('.gp-modal__confirmtext').textContent()
  assert.match(body, /2 个文件/, 'the dialog counts the directory’s working-tree files')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelector('.gp-modal--sm') === null)
  assert.equal((await page.evaluate(() => window.__gpFixture.actions)).length, 1, 'cancelling sends no discard')
  await page.close()
}

/** The filter narrows both views and reveals hits inside folded directories. */
async function filterScenario() {
  const page = await openPanel(DIRTY)
  const filter = page.locator('.gp-changes__filter')
  // Flat view first: only the matching file row survives.
  await filter.fill('b.ts')
  await flush(page)
  assert.deepEqual(entries(await rows(page)).map((r) => r.name), ['b.ts'], 'flat view keeps only the hit')
  assert.equal(await page.locator('.gp-group-head').first().textContent(), '更改 (1)', 'the group header counts the hits')
  await viewButton(page, '树形').click()
  await flush(page)
  // One hit is left under `src`: the single-child chain folds into `src/client`.
  assert.deepEqual(entries(await rows(page)).map((r) => r.name), ['src/client', 'b.ts'], 'the tree keeps the hit under its directory')
  // Fold the directory, then filter again: the hit reopens its ancestor.
  await filter.fill('')
  await flush(page)
  await page.locator('.gp-dir-row', { hasText: 'client' }).locator('.gp-dir-row__name').click()
  await flush(page)
  assert.equal(await page.locator('.gp-file-row', { hasText: 'a.ts' }).count(), 0)
  await filter.fill('a.ts')
  await flush(page)
  assert.deepEqual(entries(await rows(page)).map((r) => r.name), ['src/client', 'a.ts'], 'a filtered hit ignores the folded ancestor')
  // Nothing matches: the list says so instead of looking empty.
  await filter.fill('zzz')
  await flush(page)
  assert.equal(await page.locator('.gp-changes__list .gp-empty').textContent(), '没有匹配的变更')
  assert.equal(await page.locator('.gp-dir-row').count(), 0)
  // The clear control appears with a query and restores the whole list.
  await page.locator('.gp-changes__filter-clear').click()
  await flush(page)
  assert.equal(await filter.inputValue(), '')
  assert.equal(await page.locator('.gp-changes__filter-clear').count(), 0)
  const restored = entries(await rows(page))
  assert.deepEqual(restored.filter((r) => r.kind === 'dir').map((r) => r.name), ['lib', 'src', 'client', 'server', 'docs'], 'clearing restores every directory')
  // The filter revealed rows, it did not unfold anything: the directory folded
  // earlier in this scenario is folded again once the query is gone.
  assert.equal(restored.filter((r) => r.kind === 'file').length, 4, 'the fold the reader made survives the filter')
  await page.locator('.gp-dir-row', { hasText: 'client' }).locator('.gp-dir-row__name').click()
  await flush(page)
  assert.equal(entries(await rows(page)).filter((r) => r.kind === 'file').length, 6, 'unfolding shows the whole list again')
  await page.close()
}

/** The remembered view applies to the next mount of the same panel. */
async function persistenceScenario() {
  const page = await openPanel(DIRTY)
  await viewButton(page, '树形').click()
  await page.waitForFunction(() => document.querySelector('.gp-dir-row') !== null)
  assert.equal(await page.evaluate(() => localStorage.getItem('gp.changes.view')), 'tree')
  // Same origin, same page: a reload drops the boot but keeps storage, so the
  // panel must come back in the view the reader left it in.
  await page.reload()
  await page.waitForFunction(() => document.getElementById('panel') !== null)
  await boot(page, DIRTY, { clearView: false })
  assert.equal(await page.locator('.gp-dir-row').count(), 5, 'the remembered tree view mounts directly')
  assert.equal(await viewButton(page, '树形').evaluate((button) => button.classList.contains('gp-seg__btn--active')), true)
  // Switching back is remembered too.
  await viewButton(page, '平铺').click()
  await flush(page)
  assert.equal(await page.evaluate(() => localStorage.getItem('gp.changes.view')), 'flat')
  assert.equal(await page.locator('.gp-dir-row').count(), 0)
  await page.close()

  const clean = await openPanel(CLEAN)
  assert.equal(await clean.locator('.gp-changes__viewbar').count(), 0, 'nothing to view on a clean work tree: the bar stays away')
  assert.equal(await clean.locator('.gp-changes__list .gp-empty').textContent(), '没有未提交的变更')
  await clean.close()
}

/** The bar has to fit the narrowest layout without squeezing the switch out. */
async function compactScenario() {
  const page = await openPanel(DIRTY, { viewportWidth: 320, panelWidth: 320, touch: true })
  assert.equal(await page.locator('.gp-panel').getAttribute('data-layout'), 'compact')
  const bar = await page.locator('.gp-changes__viewbar').evaluate((node) => ({
    overflow: node.scrollWidth - node.clientWidth,
    height: node.getBoundingClientRect().height,
    controls: [...node.querySelectorAll('.gp-seg__btn, input, button')].map((el) => ({
      left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right,
      width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
    })),
  }))
  assert.ok(bar.overflow <= 1, `the view bar fits a 320px panel (overflow ${bar.overflow}px)`)
  for (const control of bar.controls) {
    assert.ok(control.width >= 24 && control.height >= 24, 'every view-bar control keeps a usable hit box')
  }
  // The filter stays one row: the switch and the input sit side by side.
  assert.ok(Math.abs(bar.controls[0].right - bar.controls[1].left) < 12, 'the switch and the filter share one row')
  await viewButton(page, '树形').click()
  await page.waitForFunction(() => document.querySelector('.gp-dir-row') !== null)
  assert.equal(await page.locator('.gp-dir-row__toggle').count(), 5, 'the tree works in the compact layout too')
  // A phone has no hover: the directory actions must be visible without it.
  assert.equal(await page.locator('.gp-dir-row__actions').first().evaluate((node) => getComputedStyle(node).visibility), 'visible', 'no hover on a phone, so the row actions stay visible')
  await page.close()
}

try {
  await viewBarScenario()
  await treeScenario()
  await collapseScenario()
  await directoryActionsScenario()
  await filterScenario()
  await persistenceScenario()
  await compactScenario()
  assert.deepEqual(consoleErrors, [], 'no frontend errors')
  console.log('e2e changes-tree.mjs: PASS', JSON.stringify({ screenshots: [SHOT_FLAT, SHOT_TREE] }))
} catch (error) {
  console.error('e2e changes-tree.mjs: FAIL', error.stack ?? error.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
