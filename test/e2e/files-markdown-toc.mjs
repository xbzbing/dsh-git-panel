/**
 * Rendered Markdown: the reader's floating outline, and the reader card's size.
 *
 * Locks the two things a Markdown document now carries:
 *  - the outline is read off the rendered document, floats in the document's
 *    top-right corner without narrowing the reading column, marks the section
 *    the reader is in while scrolling, jumps to a section when a row is
 *    picked, and can be put away — with the pill that brings it back, because
 *    hiding it must not be a one-way door for the file;
 *  - a document with nothing to navigate gets no outline at all;
 *  - the reader card grows with a big screen instead of sitting at the size it
 *    shipped with, and still fits inside a small one.
 *
 * Motion is reduced for this runner: the jump animates otherwise, and the
 * contract being locked is where the box lands, not how it gets there.
 */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const E2E = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(E2E, 'harness.html')
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f7f8fa;
--dsw-alias-bg-layer-3:#fff;--dsw-alias-bg-module-platform:#e9eaec;
--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
--dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
#panel{border:0!important}`

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: '44638f7', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

// A document with enough sections — and enough text under each — that the
// scroll box genuinely scrolls and every jump has somewhere to land. One
// paragraph per line: the harness renders blank-line-separated lines as their
// own paragraphs, so the body is as tall as the text rather than one run-on
// paragraph.
const README = [
  '# Panel guide',
  '',
  'Short intro paragraph.',
  '',
  '## Install',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Install line ${i + 1}.\n`),
  '',
  '## Usage',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Usage line ${i + 1}.\n`),
  '',
  '### Keyboard',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Shortcut line ${i + 1}.\n`),
  '',
  '## Security',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Security line ${i + 1}.\n`),
  '',
  '## Troubleshooting',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Troubleshooting line ${i + 1}.\n`),
  '',
].join('\n')

// One heading is not an outline: the reader already sees the whole document.
const ONE = '# Only section\n\nBody.\n'

// Enough sections that the card's row list overflows — the case where a
// current-row highlight can scroll out of the card and read as a frozen list.
const LONG = Array.from({ length: 26 }, (_, i) => [
  `## Section ${i + 1}`,
  '',
  `Body line for section ${i + 1}.`,
  '',
].join('\n')).join('')

const browser = await chromium.launch()

async function boot(page) {
  await page.goto(harness)
  await page.addStyleTag({ content: THEME })
  await page.addScriptTag({ path: resolve(E2E, 'client.js') })
  await page.evaluate(async ({ snap, readme, one, long }) => {
    const files = { 'README.md': readme, 'one.md': one, 'long.md': long, 'a.txt': 'const x = 1\n' }
    // The runner flips this to prove a re-read does not resurrect a closed
    // outline (the refresh path re-reads without re-opening the file).
    window.__files = files
    const connection = { rpc: { call: async (_channel, endpoint, payload) => {
      const q = payload && payload.args && payload.args.request && payload.args.request.query
      if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
      if (endpoint === 'dbGitPanel/query') {
        if (q.kind === 'dir-list') {
          const entries = q.path === ''
            ? [{ name: 'README.md', dir: false, size: readme.length }, { name: 'one.md', dir: false, size: one.length }, { name: 'long.md', dir: false, size: long.length }, { name: 'a.txt', dir: false, size: 12 }]
            : []
          return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries } } }
        }
        if (q.kind === 'file-content') {
          const content = files[q.path] ?? ''
          return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant: 'text', content, lines: content.split('\n').length - 1, size: content.length } } }
        }
        if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: '44638f7' }], remote: [] } } }
        if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
        if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
        if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 0, commits: [] } } }
        if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
      }
      if (endpoint === 'dbGitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
      if (endpoint === 'dbGitPanel/version') return { ok: true, value: { current: '1.8.1', repositoryUrl: '', updateAvailable: false, checkedRemote: false } }
      return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
    } } }
    const registered = {}
    const dictionaries = {}
    const ctx = {
      get: (key) => ({ connection })[key],
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: () => () => {},
      inject: (_deps, cb) => cb(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict },
        bind: (ns) => (key, params) => {
          const text = dictionaries[ns]?.zh?.[key] ?? key
          return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
        },
      },
    }
    window.__getLoaded().apply(ctx)
    // Resolved zh labels for the controls this runner drives: the toolbar's
    // accessible names are translated text here, not the raw key.
    const ns = Object.keys(dictionaries)[0]
    window.__t = (key) => dictionaries[ns]?.zh?.[key] ?? key
    await new Promise((r) => setTimeout(r, 300))
    const host = document.getElementById('panel')
    host.style.width = '960px'
    host.style.height = '640px'
    window.ReactDOM.createRoot(host).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 500))
  }, { snap: SNAP, readme: README, one: ONE, long: LONG })
}

const openFiles = async (page) => {
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.gp-tabbar [role="tab"]')].find((t) => (t.textContent || '').includes('文件'))?.click()
  })
  await page.waitForTimeout(400)
}

// Click a tree row and wait for that document to be on screen. The marker is
// the document's own first heading: the toolbar's path control only exists in
// the wide bar, so the rendered text is the signal both tiers share.
const selectFile = async (page, name, marker) => {
  await page.evaluate((fileName) => {
    const row = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')]
      .find((r) => (r.textContent || '').trim() === fileName)
    row?.click()
  }, name)
  await page.waitForFunction((text) => {
    const body = document.querySelector('.gp-files__markdown-body')
    return body !== null && (body.textContent || '').includes(text)
  }, marker, { timeout: 5000 })
  // The outline is read in an effect after the document commits.
  await page.waitForTimeout(120)
}

const errors = []
const watch = (page) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
}

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
watch(page)
await page.emulateMedia({ reducedMotion: 'reduce' })
await boot(page)
await openFiles(page)
await selectFile(page, 'README.md', 'Panel guide')

// ── The outline lists the document's sections, in document order ───────────
const outline = await page.evaluate(() => {
  const card = document.querySelector('.gp-files__toc')
  const wrap = document.querySelector('.gp-files__mdwrap')
  const box = document.querySelector('.gp-files__markdown')
  const rows = [...document.querySelectorAll('.gp-files__toc-item')]
  const cardBox = card?.getBoundingClientRect()
  const wrapBox = wrap?.getBoundingClientRect()
  const boxBox = box?.getBoundingClientRect()
  return {
    hasCard: card !== null,
    closed: card?.classList.contains('gp-files__toc--closed') ?? null,
    labels: rows.map((r) => (r.textContent || '').trim()),
    // Indent is the nesting the outline draws for h1 / h2 / h3.
    indents: rows.map((r) => parseInt(getComputedStyle(r).paddingLeft, 10)),
    position: card === null ? null : getComputedStyle(card).position,
    zIndex: card === null ? null : getComputedStyle(card).zIndex,
    insideWrap: !!(wrap && card && wrap.contains(card)),
    // The card floats in the top-right corner of the document's box.
    topGap: cardBox && wrapBox ? Math.round(cardBox.top - wrapBox.top) : null,
    rightGap: cardBox && wrapBox ? Math.round(wrapBox.right - cardBox.right) : null,
    // The reading column is untouched: the outline covers a corner instead of
    // taking a column of its own.
    columnKeptFullWidth: !!(boxBox && wrapBox) && Math.round(boxBox.width) === Math.round(wrapBox.width),
    scrollable: box ? box.scrollHeight > box.clientHeight : false,
  }
})
assert.equal(outline.hasCard, true, 'a document with several sections gets an outline')
assert.equal(outline.closed, false, 'the wide tier opens it')
assert.deepEqual(outline.labels, ['Panel guide', 'Install', 'Usage', 'Keyboard', 'Security', 'Troubleshooting'],
  'every heading, in document order, with its own label')
assert.deepEqual(outline.indents, [8, 18, 18, 28, 18, 18],
  'the outline indents by heading depth (h1 < h2 < h3)')
assert.equal(outline.position, 'absolute', 'the outline floats over the document rather than being laid out beside it')
assert.notEqual(outline.zIndex, 'auto', 'it paints above the text it covers')
assert.equal(outline.insideWrap, true, 'it belongs to the document pane, so it leaves with it')
assert.equal(outline.topGap, 8, 'it sits 8px below the pane top')
assert.equal(outline.rightGap, 8, 'and 8px in from the right edge')
assert.equal(outline.columnKeptFullWidth, true, 'the document keeps the full column width')
assert.equal(outline.scrollable, true, 'fixture is long enough to scroll')

// ── Picking a row jumps to its heading and marks the section ───────────────
const jump = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.gp-files__toc-item')]
  const install = rows.find((r) => (r.textContent || '').trim() === 'Install')
  install?.click()
  await new Promise((r) => setTimeout(r, 250))
  const box = document.querySelector('.gp-files__markdown')
  const heading = [...(box?.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? [])]
    .find((h) => (h.textContent || '').trim() === 'Install')
  const active = [...document.querySelectorAll('.gp-files__toc-item')].filter((r) => r.getAttribute('aria-current') === 'true')
  return {
    scrolled: (box?.scrollTop ?? 0) > 0,
    // Where the heading sits now, relative to the box top: the jump parks it
    // there rather than leaving it anywhere on screen.
    headingOffsetFromTop: box && heading ? Math.round(heading.getBoundingClientRect().top - box.getBoundingClientRect().top) : null,
    activeLabels: active.map((r) => (r.textContent || '').trim()),
    activeClass: active[0]?.classList.contains('gp-files__toc-item--active') ?? false,
  }
})
assert.equal(jump.scrolled, true, 'picking a section scrolls the document')
assert.ok(jump.headingOffsetFromTop !== null && jump.headingOffsetFromTop <= 16 && jump.headingOffsetFromTop >= -2,
  `the picked heading is parked at the top of the box (offset ${jump.headingOffsetFromTop}px)`)
assert.deepEqual(jump.activeLabels, ['Install'], 'the picked section is the current one')
assert.equal(jump.activeClass, true, 'the current row is drawn as current')

// ── The current row follows the reader's own scrolling ─────────────────────
const spy = await page.evaluate(async () => {
  const box = document.querySelector('.gp-files__markdown')
  const activeNow = () => [...document.querySelectorAll('.gp-files__toc-item')]
    .filter((r) => r.getAttribute('aria-current') === 'true')
    .map((r) => (r.textContent || '').trim())
  const at = (top) => {
    box.scrollTop = top
    box.dispatchEvent(new Event('scroll'))
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(activeNow()))))
  }
  const headings = [...box.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  const usage = headings.find((h) => (h.textContent || '').trim() === 'Usage')
  return {
    top: await at(0),
    usage: await at(usage.offsetTop + 4),
    bottom: await at(box.scrollHeight),
  }
})
assert.deepEqual(spy.top, ['Panel guide'], 'at the start of the document the first section is current')
assert.deepEqual(spy.usage, ['Usage'], 'scrolling to a heading makes its row current')
assert.deepEqual(spy.bottom, ['Troubleshooting'], 'at the end of the document the last section is current')

// ── The outline paints above a stuck code-block banner ────────────────────
// The platform's code banner is position:sticky, top:0, z-index 6; at the
// outline's old z-index the banner scrolled over its rows. The probe below is
// the platform's own shape (sticky at 6, full content width), so a hit test at
// a point both cover reports whichever actually paints on top.
const stacking = await page.evaluate(async () => {
  const body = document.querySelector('.gp-files__markdown-body')
  const box = document.querySelector('.gp-files__markdown')
  const probe = document.createElement('div')
  probe.setAttribute('data-sticky-probe', '')
  probe.style.cssText = 'position:sticky;top:0;z-index:6;height:30px;background:#fff;border-bottom:1px solid #ccc'
  probe.textContent = 'probe-banner'
  body.insertBefore(probe, body.firstChild)
  box.scrollTop = 260
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const card = document.querySelector('.gp-files__toc')
  const row = document.querySelector('.gp-files__toc-item')
  const cardBox = card.getBoundingClientRect()
  const bannerBox = probe.getBoundingClientRect()
  const point = {
    x: Math.round(cardBox.left + cardBox.width / 2),
    y: Math.round(bannerBox.top + bannerBox.height / 2),
  }
  const hit = document.elementFromPoint(point.x, point.y)
  const out = {
    tocZ: Number(getComputedStyle(card).zIndex),
    bannerZ: Number(getComputedStyle(probe).zIndex),
    bannerStuck: Math.round(bannerBox.top - box.getBoundingClientRect().top),
    overlaps: bannerBox.bottom > cardBox.top && bannerBox.top < cardBox.bottom,
    // DOCUMENT_POSITION over the point, not just "an element": the hit must be
    // the outline's card or something inside it.
    hitInsideOutline: !!(hit && hit.closest('.gp-files__toc')),
    firstRowBox: row ? { top: Math.round(row.getBoundingClientRect().top) } : null,
  }
  probe.remove()
  box.scrollTop = 0
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return out
})
assert.equal(stacking.bannerStuck, 0, 'the probe really sticks to the top of the scroll box')
assert.equal(stacking.overlaps, true, 'the stuck banner and the outline share screen space')
assert.ok(stacking.tocZ > stacking.bannerZ,
  `the outline paints above the code banner (${stacking.tocZ} vs ${stacking.bannerZ})`)
assert.equal(stacking.hitInsideOutline, true, 'a point both cover belongs to the outline, not the banner')

// ── The header fold: rows away, header (and both controls) kept ───────────
const fold = await page.evaluate(async () => {
  const head = document.querySelector('.gp-files__toc-head')
  const foldBtn = document.querySelector('.gp-files__toc-fold')
  const closeBtn = document.querySelector('.gp-files__toc-close')
  const list = document.querySelector('.gp-files__toc-list')
  const foldBox = foldBtn?.getBoundingClientRect()
  const closeBox = closeBtn?.getBoundingClientRect()
  const before = {
    // The fold control sits in the header, immediately left of the close one.
    inHeader: !!(head && foldBtn && head.contains(foldBtn)),
    leftOfClose: !!(foldBox && closeBox) && foldBox.right <= closeBox.left + 1,
    sameRow: !!(foldBox && closeBox) && Math.abs((foldBox.top + foldBox.height / 2) - (closeBox.top + closeBox.height / 2)) <= 2,
    expanded: foldBtn?.getAttribute('aria-expanded'),
    controls: foldBtn?.getAttribute('aria-controls'),
    controlsResolve: !!(foldBtn && document.getElementById(foldBtn.getAttribute('aria-controls') || '') === list),
    rowsShown: list ? getComputedStyle(list).display !== 'none' && list.querySelectorAll('.gp-files__toc-item').length : 0,
  }
  foldBtn?.click()
  await new Promise((r) => setTimeout(r, 120))
  const folded = {
    classed: document.querySelector('.gp-files__toc')?.classList.contains('gp-files__toc--folded'),
    rowsHidden: getComputedStyle(document.querySelector('.gp-files__toc-list')).display === 'none',
    headerKept: document.querySelector('.gp-files__toc-head') !== null,
    titleKept: (document.querySelector('.gp-files__toc-title')?.textContent || '') !== '',
    bothControlsKept: document.querySelector('.gp-files__toc-fold') !== null && document.querySelector('.gp-files__toc-close') !== null,
    expanded: document.querySelector('.gp-files__toc-fold')?.getAttribute('aria-expanded'),
    label: document.querySelector('.gp-files__toc-fold')?.getAttribute('aria-label'),
    documentKept: document.querySelector('[data-markdown-rendered]') !== null,
  }
  document.querySelector('.gp-files__toc-fold')?.click()
  await new Promise((r) => setTimeout(r, 120))
  const unfolded = {
    classed: document.querySelector('.gp-files__toc')?.classList.contains('gp-files__toc--folded'),
    rows: document.querySelectorAll('.gp-files__toc-item').length,
    expanded: document.querySelector('.gp-files__toc-fold')?.getAttribute('aria-expanded'),
  }
  return { before, folded, unfolded }
})
assert.equal(fold.before.inHeader, true, 'the fold control lives in the outline header')
assert.equal(fold.before.leftOfClose, true, 'and stands immediately left of the close control')
assert.equal(fold.before.sameRow, true, 'both controls share the header row')
assert.equal(fold.before.expanded, 'true', 'the fold control reports the rows as shown')
assert.equal(fold.before.controlsResolve, true, 'its aria-controls names the row list that exists')
assert.equal(fold.before.rowsShown, 6, 'the rows are listed before folding')
assert.equal(fold.folded.classed, true, 'folding marks the card as folded')
assert.equal(fold.folded.rowsHidden, true, 'the rows are gone')
assert.equal(fold.folded.headerKept, true, 'the header stays, so the card can be unfolded from it')
assert.equal(fold.folded.titleKept, true, 'with its title')
assert.equal(fold.folded.bothControlsKept, true, 'and both header controls')
assert.equal(fold.folded.expanded, 'false', 'the fold control now reports the rows as hidden')
assert.equal(fold.folded.label !== '', true, 'and names what clicking it does')
assert.equal(fold.folded.documentKept, true, 'the document is untouched by folding')
assert.equal(fold.unfolded.classed, false, 'clicking again unfolds the card')
assert.equal(fold.unfolded.rows, 6, 'and the same rows come back')
assert.equal(fold.unfolded.expanded, 'true', 'with the control reporting them as shown again')

// ── A layout shift re-measures the rows' offsets ──────────────────────────
// The outline stores each heading's offset. Anything that grows above them —
// an image finishing, a diagram drawing, a font swap — moves every offset, and
// a stale one jumps the reader somewhere else. The probe below is that shift:
// after it, the jump still has to land the heading at the top.
const remeasure = await page.evaluate(async () => {
  const body = document.querySelector('.gp-files__markdown-body')
  const spacer = document.createElement('div')
  spacer.setAttribute('data-shift-probe', '')
  spacer.style.height = '320px'
  body.insertBefore(spacer, body.firstChild)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 60))))
  const before = [...document.querySelectorAll('.gp-files__toc-item')].map((r) => (r.textContent || '').trim())
  const security = [...document.querySelectorAll('.gp-files__toc-item')].find((r) => (r.textContent || '').trim() === 'Security')
  security?.click()
  await new Promise((r) => setTimeout(r, 250))
  const box = document.querySelector('.gp-files__markdown')
  const heading = [...box.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((h) => (h.textContent || '').trim() === 'Security')
  const offset = heading ? Math.round(heading.getBoundingClientRect().top - box.getBoundingClientRect().top) : null
  spacer.remove()
  await new Promise((r) => setTimeout(r, 120))
  return { rows: before.length, offset }
})
assert.equal(remeasure.rows, 6, 'the rows survive a layout shift above them')
assert.ok(remeasure.offset !== null && remeasure.offset <= 16 && remeasure.offset >= -2,
  `a jump after a 320px shift still parks the heading at the top (offset ${remeasure.offset}px)`)

// ── Closing takes the outline off the page; only a new open brings it back ──
const close = await page.evaluate(async () => {
  const before = document.querySelector('[data-markdown-rendered]')
  const wrap = document.querySelector('.gp-files__mdwrap')
  document.querySelector('.gp-files__toc-close')?.click()
  await new Promise((r) => setTimeout(r, 150))
  return {
    cardGone: document.querySelector('.gp-files__toc') === null,
    // Nothing is left behind in the corner: the pane holds the document and
    // nothing else — no pill, no placeholder, no empty floating box.
    onlyDocumentLeft: wrap !== null && wrap.children.length === 1
      && wrap.firstElementChild?.classList.contains('gp-files__markdown') === true,
    // A second render would replace this node; an equal reference proves the
    // document was never remounted by the dismissal.
    docKept: document.querySelector('[data-markdown-rendered]') === before,
    rendered: document.querySelector('[data-markdown-rendered]') !== null,
    // Focus lands in the document (a tabIndex -1 region), not on <body>.
    focusInDoc: document.activeElement?.classList.contains('gp-files__markdown') ?? false,
    rows: document.querySelectorAll('.gp-files__toc-item').length,
  }
})
assert.equal(close.cardGone, true, 'closing removes the outline entirely')
assert.equal(close.onlyDocumentLeft, true, 'and leaves nothing of it in the pane')
assert.equal(close.docKept, true, 'the document is not re-rendered by the dismissal')
assert.equal(close.rendered, true, 'and stays on screen, bare')
assert.equal(close.focusInDoc, true, 'focus moves into the document instead of falling back to the body')
assert.equal(close.rows, 0, 'no rows are left in the DOM')

// A re-read is not an open: the refresh control loads the same file again with
// new bytes, which changes the text the pane renders. The outline must stay
// closed — the reader's decision belongs to this reading, and a re-render is
// not a new one.
const afterRefresh = await page.evaluate(async () => {
  window.__files['README.md'] = window.__files['README.md'].replace('Short intro paragraph.', 'Short intro paragraph, refreshed.')
  document.querySelector('.gp-files__refresh')?.click()
  await new Promise((r) => setTimeout(r, 600))
  return {
    bodyText: document.querySelector('.gp-files__markdown-body')?.textContent ?? '',
    toc: document.querySelector('.gp-files__toc') !== null,
  }
})
assert.ok(afterRefresh.bodyText.includes('refreshed'), 'the refresh actually replaced the rendered document')
assert.equal(afterRefresh.toc, false, 'a re-read does not resurrect a closed outline')

// The source/render switch unmounts the pane. The closure is owned by the tab
// (keyed to the open it was made in), so coming back to the rendered view does
// not undo it either.
const afterModes = await page.evaluate(async () => {
  const mode = (key) => [...document.querySelectorAll('.gp-files__bar [role="tab"]')]
    .find((b) => (b.textContent || '').trim() === window.__t(key))
  mode('files.source')?.click()
  await new Promise((r) => setTimeout(r, 150))
  const inSource = document.querySelector('.gp-files__toc') !== null
  mode('files.render')?.click()
  await new Promise((r) => setTimeout(r, 200))
  return { inSource, backInRender: document.querySelector('.gp-files__toc') !== null }
})
assert.equal(afterModes.inSource, false, 'the source view carries no outline')
assert.equal(afterModes.backInRender, false, 'and switching back to the rendered view does not undo the close')

// The same file opened again restores it — the dismissal belongs to the
// reading that ended, not to the file.
await selectFile(page, 'README.md', 'Panel guide')
const reopened = await page.evaluate(() => ({
  card: document.querySelector('.gp-files__toc') !== null,
  rows: document.querySelectorAll('.gp-files__toc-item').length,
  expanded: document.querySelector('.gp-files__toc-fold')?.getAttribute('aria-expanded'),
}))
assert.equal(reopened.card, true, 'opening the file again restores the outline')
assert.equal(reopened.rows, 6, 'with the same rows')
assert.equal(reopened.expanded, 'true', 'expanded, in the wide tier')

// Closing again, then leaving and coming back through another file: also back.
await page.evaluate(async () => {
  document.querySelector('.gp-files__toc-close')?.click()
  await new Promise((r) => setTimeout(r, 120))
})
await selectFile(page, 'one.md', 'Only section')
await selectFile(page, 'README.md', 'Panel guide')
const afterRoundTrip = await page.evaluate(() => document.querySelector('.gp-files__toc') !== null)
assert.equal(afterRoundTrip, true, 'switching files and coming back also restores it')

// ── A document with one heading has nothing to navigate ────────────────────
await selectFile(page, 'one.md', 'Only section')
const single = await page.evaluate(() => ({
  card: document.querySelector('.gp-files__toc') !== null,
  pill: document.querySelector('.gp-files__toc-open') !== null,
  rendered: document.querySelector('[data-markdown-rendered]') !== null,
}))
assert.equal(single.rendered, true, 'the document still renders')
assert.equal(single.card, false, 'one section gets no outline card')
assert.equal(single.pill, false, 'and no pill either — there is nothing to open')

// ── The compact tier starts the outline closed ─────────────────────────────
await selectFile(page, 'README.md', 'Panel guide')
await page.evaluate(async () => {
  document.getElementById('panel').style.width = '480px'
  await new Promise((r) => setTimeout(r, 250))
})
await selectFile(page, 'README.md', 'Panel guide')
const compact = await page.evaluate(() => ({
  card: document.querySelector('.gp-files__toc') !== null,
  folded: document.querySelector('.gp-files__toc--folded') !== null,
  rowsHidden: document.querySelector('.gp-files__toc-list') === null
    || getComputedStyle(document.querySelector('.gp-files__toc-list')).display === 'none',
  foldControl: document.querySelector('.gp-files__toc-fold')?.getAttribute('aria-expanded'),
}))
assert.equal(compact.card, true, 'the narrow tier still has the outline')
assert.equal(compact.folded, true, 'it starts folded: the whole column is the document there')
assert.equal(compact.rowsHidden, true, 'so the rows are not covering the text it indexes')
assert.equal(compact.foldControl, 'false', 'and the fold control offers to open them')
await page.evaluate(async () => {
  document.getElementById('panel').style.width = '960px'
  await new Promise((r) => setTimeout(r, 250))
})
await selectFile(page, 'README.md', 'Panel guide')

// ── A long outline keeps the current row inside the card ──────────────────
// Past a couple of dozen sections the row list overflows its own box. Without
// following the current row, scrolling the document leaves the highlight above
// the card's viewport and the outline reads as frozen.
await selectFile(page, 'long.md', 'Section 1')
const longList = await page.evaluate(async () => {
  const box = document.querySelector('.gp-files__markdown')
  const list = document.querySelector('.gp-files__toc-list')
  if (list === null) return null
  const before = list.scrollTop
  box.scrollTop = box.scrollHeight
  await new Promise((r) => setTimeout(r, 300))
  const row = list.querySelector('[aria-current="true"]')
  const listBox = list.getBoundingClientRect()
  const rowBox = row?.getBoundingClientRect()
  return {
    rows: list.querySelectorAll('.gp-files__toc-item').length,
    scrollable: list.scrollHeight > list.clientHeight,
    movedList: list.scrollTop !== before,
    current: (row?.textContent || '').trim(),
    // The highlighted row is inside the card's visible band: not clipped above
    // it, not below it.
    visible: rowBox !== undefined && rowBox !== null
      && rowBox.top >= listBox.top - 1 && rowBox.bottom <= listBox.bottom + 1,
  }
})
assert.ok(longList !== null, 'the long document still gets an outline')
assert.equal(longList.rows, 26, 'every section is listed')
assert.equal(longList.scrollable, true, 'the rows overflow the card, so the list scrolls on its own')
assert.equal(longList.current, 'Section 26', 'scrolled to the end, the last section is current')
assert.equal(longList.movedList, true, 'following the current row scrolled the list itself')
assert.equal(longList.visible, true, 'the current row is inside the card, not clipped out of it')

// ── The reader card grows with the screen, and fits a small one ────────────
const cardSize = async () => page.evaluate(() => {
  const el = document.querySelector('.gp-files__preview--full')
  if (el === null) return null
  const s = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  return {
    width: Math.round(parseFloat(s.width)),
    height: Math.round(parseFloat(s.height)),
    fits: r.left >= -1 && r.top >= -1
      && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
  }
})
const openReader = async () => {
  await page.evaluate(() => document.querySelector(`.gp-files__bar [aria-label="${window.__t('files.fullscreen')}"]`)?.click())
  await page.waitForTimeout(250)
}
const closeReader = async () => {
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  await page.waitForTimeout(200)
}

await openReader()
const big = await cardSize()
assert.ok(big !== null, 'the reader card opens')
// 1600x1000: 68vw / 80vh take over from the 920x680 floor this card shipped
// with, so a big screen gets a reader that uses it.
assert.equal(big.width, 1088, `the card grows with a wide screen (${big.width}px)`)
assert.equal(big.height, 800, `and with a tall one (${big.height}px)`)
assert.ok(big.width > 920 && big.height > 680, 'both outgrow the size it shipped with')
assert.equal(big.fits, true, 'and still sits inside the viewport')
await closeReader()

await page.setViewportSize({ width: 1000, height: 720 })
await page.waitForTimeout(200)
await openReader()
const small = await cardSize()
assert.ok(small !== null, 'the card opens at the smaller viewport too')
assert.equal(small.width, 860, `86vw still wins on a small window (${small.width}px)`)
assert.equal(small.height, 605, `and 84vh on its height (${small.height}px)`)
assert.equal(small.fits, true, 'the card never overflows the window')
await closeReader()

assert.deepEqual(errors, [], 'no console errors along the way')

await browser.close()
console.log('files-markdown-toc: ok')
