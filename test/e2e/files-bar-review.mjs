/**
 * Review capture: Files preview toolbar at phone and desktop widths. Compact at
 * a phone width drills into a single bar (plain files have no source/render
 * switcher, so the trailing icons must stay pinned to the right edge); the wide
 * bar keeps the path, both copy buttons, the official source/render switcher
 * and the fullscreen reading entry. Also locks the wrap contract: the trailing
 * cluster is one flex item, so a narrow preview moves it whole instead of
 * splitting its buttons across rows. Run setup.mjs first.
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(DIR, '../../docs/local/review')
const harness = 'file://' + resolve(DIR, 'harness.html')
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;
--dsw-alias-bg-layer-3:#fff;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
#panel{border:0!important}`

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'de54fc0', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

await page.evaluate(async (snap) => {
  const entry = window.__getLoaded()
  const connection = {
    rpc: {
      call: async (_c, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
        if (endpoint === 'dbGitPanel/query') {
          const q = request.query
          if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 0, commits: [] } } }
          if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: 'de54fc0' }], remote: [] } } }
          if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
          if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
          if (q.kind === 'dir-list') {
            return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries: q.path === ''
              ? [{ name: 'README.md', dir: false, size: 24 }, { name: 'b.md', dir: false, size: 24 }, { name: 'a.txt', dir: false, size: 12 }]
              : [] } } }
          }
          if (q.kind === 'file-content') {
            // The switch-stability scenario parks this read to make the loading
            // state observable; every other read answers at once.
            const delay = window.__fileContentDelay || 0
            if (delay > 0) await new Promise((r) => setTimeout(r, delay))
            const md = typeof q.path === 'string' && q.path.endsWith('.md')
            const content = md ? `# ${q.path}\n\nbody line\n` : 'const x = 1\n'
            return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content, lines: md ? 3 : 1 } } }
          }
          if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
        }
        if (endpoint === 'dbGitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
        if (endpoint === 'dbGitPanel/version') return { ok: true, value: { current: '0.1.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: false } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }
  const registered = {}
  const dictionaries = {}
  const ctx = {
    get: (k) => ({ connection })[k],
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_d, cb) => cb(ctx),
    slots: { inject: (_n, p) => p(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
    locale: {
      register: (ns, dict) => { dictionaries[ns] = dict },
      bind: (ns) => (key, params) => {
        const text = dictionaries[ns]?.zh?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  entry.apply(ctx)
  await new Promise((r) => setTimeout(r, 600))
  const panelHost = document.getElementById('panel')
  panelHost.style.width = '390px'
  window.ReactDOM.createRoot(panelHost).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 600))
  window.__panelHost = panelHost
  window.__openFile = async (name) => {
    if (!document.querySelector('.gp-files')) {
      const tab = [...document.querySelectorAll('.gp-tabbar [role="tab"], .gp-tabbar button')]
        .find((b) => /文件浏览|tab\.files/.test(b.textContent || ''))
      tab?.click()
      await new Promise((r) => setTimeout(r, 500))
    }
    document.querySelector('.gp-files__bar .gp-subhead__back')?.click()
    await new Promise((r) => setTimeout(r, 250))
    const row = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').includes(name))
    row?.click()
    await new Promise((r) => setTimeout(r, 400))
  }
  window.__measureBar = () => {
    const compact = document.querySelector('.gp-panel')?.getAttribute('data-layout') === 'compact'
    const bar = document.querySelector(compact ? '.gp-files__bar--compact' : '.gp-files__bar')
    if (!bar) return { error: 'no compact bar' }
    const box = bar.getBoundingClientRect()
    const padRight = parseFloat(getComputedStyle(bar).paddingRight)
    const rect = (n) => { const b = n?.getBoundingClientRect(); return b ? { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), h: Math.round(b.height) } : null }
    const end = bar.querySelector('.gp-files__bar-end')
    const back = bar.querySelector('.gp-subhead__back')
    const seg = bar.querySelector('[role="tablist"]')
    return {
      barBox: { right: Math.round(box.right), left: Math.round(box.left), h: Math.round(box.height) },
      contentRight: Math.round(box.right - padRight),
      back: rect(back),
      seg: rect(seg),
      end: rect(end),
      full: rect(bar.querySelector('[aria-label="files.fullscreen"]')),
      props: rect(bar.querySelector('[aria-label="files.propsTitle"]')),
      rows: new Set(['.gp-subhead__back', '.gp-files__bar-end', '[role="tablist"]']
        .flatMap((sel) => [...bar.querySelectorAll(sel)]
          .map((n) => { const b = n.getBoundingClientRect(); return Math.round(b.top + b.height / 2) }))).size,
      // Trailing buttons loose in the bar (neither the path nor the back entry)
      // mean the cluster is not one item and a wrap can split it.
      stray: [...bar.children].filter((c) => c.tagName === 'BUTTON'
        && !c.classList.contains('gp-files__path') && !c.classList.contains('gp-subhead__back')).length,
      overflowX: bar.scrollWidth > bar.clientWidth + 1,
    }
  }
}, SNAP)

const report = {}
for (const width of [1000, 640, 620, 390, 304]) {
  await page.evaluate((w) => { window.__panelHost.style.width = w + 'px' }, width)
  await page.waitForTimeout(250)
  report[width] = {}
  for (const name of ['a.txt', 'README.md']) {
    const key = name.endsWith('.md') ? 'rich' : 'plain'
    await page.evaluate((n) => window.__openFile(n), name)
    report[width][key] = await page.evaluate(() => window.__measureBar())
    const bar = resolve(OUT, `files-bar-${width}-${key}.png`)
    await page.locator('.gp-files__bar').screenshot({ path: bar })
    const panel = resolve(OUT, `files-panel-${width}-${key}.png`)
    await page.locator('.gp-panel').screenshot({ path: panel })
  }
}

console.log(JSON.stringify(report, null, 2))
if (errors.length) console.log('CONSOLE ERRORS:', errors)

// ── Wrap contract ──────────────────────────────────────────────────────────
const rowCenter = (r) => (r === null ? null : Math.round(r.top + r.h / 2))
for (const [width, keys] of Object.entries(report)) {
  for (const [key, m] of Object.entries(keys)) {
    const tag = `${width}/${key}`
    assert.equal(m.overflowX, false, `${tag}: the bar never scrolls sideways`)
    assert.equal(m.stray, 0, `${tag}: every trailing button sits inside .gp-files__bar-end (${m.stray} loose)`)
    if (m.end !== null) assert.ok(m.end.h <= 44, `${tag}: the cluster stays one row tall (${m.end.h}px)`)
    if (m.rows > 1 && m.seg !== null && rowCenter(m.end) !== rowCenter(m.seg)) {
      assert.ok(m.end.right >= m.contentRight - 8,
        `${tag}: a cluster on its own row hugs the right edge (right ${m.end.right} vs content ${m.contentRight})`)
    }
  }
}
// The reported case: a narrow wide-tier preview (640px panel) keeps the
// source/render switcher on row one and drops the whole cluster below it.
assert.notEqual(report[640].rich.end, null, 'the wide bar wraps its buttons as one group')
assert.equal(report[640].rich.rows, 2, 'at 640 the cluster wraps to its own row under the switcher')

// ── Switch stability ──────────────────────────────────────────────────────
// A document switch blanks the body to its loading state; the bar must keep
// the settled file's shape while the read is parked: the mode switch and the
// content actions must not unmount for the loading frame and come back with
// the content.
const switchStability = await page.evaluate(async () => {
  window.__panelHost.style.width = '900px'
  await new Promise((r) => setTimeout(r, 300))
  // The width loop ends in the compact drill-in: return to the tree first.
  document.querySelector('.gp-files__bar--compact .gp-subhead__back')?.click()
  await new Promise((r) => setTimeout(r, 250))
  const row = (name) => [...document.querySelectorAll('.gp-files__tree .gp-tree-row')]
    .find((r) => (r.textContent || '').includes(name))
  row('README.md')?.click()
  await new Promise((r) => setTimeout(r, 400))
  const shape = () => {
    const bar = document.querySelector('.gp-files__bar')
    const end = bar?.querySelector('.gp-files__bar-end') ?? null
    const endButtons = end === null ? [] : [...end.querySelectorAll('button')]
    const seg = bar?.querySelector('.gp-files__mode-seg') ?? null
    return {
      height: bar === null ? 0 : Math.round(bar.getBoundingClientRect().height),
      buttons: endButtons.map((b) => b.getAttribute('aria-label') || b.textContent || '').join('|'),
      seg: seg !== null,
      segWidth: seg === null ? 0 : Math.round(seg.getBoundingClientRect().width),
      endWidth: end === null ? 0 : Math.round(end.getBoundingClientRect().width),
      path: (bar?.querySelector('.gp-files__path')?.textContent || '').trim(),
      propsDisabled: endButtons.length === 0 ? null : endButtons[endButtons.length - 1].disabled,
      body: (document.querySelector('.gp-files__preview-content')?.textContent || '').trim().slice(0, 24),
    }
  }
  const before = shape()
  window.__fileContentDelay = 500
  row('b.md')?.click()
  await new Promise((r) => setTimeout(r, 120))
  const during = shape()
  await new Promise((r) => setTimeout(r, 700))
  const after = shape()
  window.__fileContentDelay = 0
  return { before, during, after }
})
assert.equal(switchStability.during.path, 'b.md', 'the bar follows the new path at once')
assert.match(switchStability.during.body, /加载中/, 'the parked read still shows the loading state in the body')
assert.equal(switchStability.during.height, switchStability.before.height, 'the bar keeps its height while the read is in flight')
assert.deepEqual(switchStability.during.buttons, switchStability.before.buttons, 'the content actions stay mounted while the read is in flight')
assert.equal(switchStability.during.seg, switchStability.before.seg, 'the mode switch stays mounted while the read is in flight')
assert.equal(switchStability.during.segWidth, switchStability.before.segWidth, 'the mode switch keeps its width while the read is in flight')
assert.equal(switchStability.during.endWidth, switchStability.before.endWidth, 'the trailing cluster keeps its width while the read is in flight')
assert.equal(switchStability.during.propsDisabled, false, 'the properties entry does not dim for the loading frame')
assert.equal(switchStability.after.height, switchStability.before.height, 'the bar height is unchanged once the document lands')
assert.deepEqual(switchStability.after.buttons, switchStability.before.buttons, 'the content actions are unchanged once the document lands')
assert.match(switchStability.after.body, /b\.md/, 'the new document replaces the loading placeholder')

await browser.close()
console.log('e2e files-bar-review.mjs: PASS')
