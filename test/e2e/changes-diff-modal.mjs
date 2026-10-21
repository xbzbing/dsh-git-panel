/**
 * The changes diff enlarged in place: the toolbar's modal button restyles the
 * SAME inline .gp-diff node into the card (the fullscreen reader's trick), so
 * the DiffView must never render twice — the row count is the discriminator
 * (a second instance would double it), and a marked attribute on the node
 * proves the DOM element survived the toggle rather than being replaced.
 *
 * Also pins the two toolbar icons sharing the plain gp-icon-btn style (the
 * expand lost its bordered-pill look when it became an icon).
 *
 * Isolated file:// harness, no dsh server. Requires test/e2e/setup.mjs first.
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
  --dsw-alias-label-caption:#81858c;
  --dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
  --dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
  #panel{border:0!important}`

// Dirty on purpose: the panel lands on the changes tab by itself. Two files, so
// the copy confirmation can be watched across a path switch (one header button
// is reused for both, which is where a stale check mark would show up).
const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'ba78eb4', unborn: false, dirty: true,
  staged: 0, modified: 2, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null,
  changes: [
    { path: 'src/client/testkit.ts', status: 'modified', staged: false, isDirectory: false },
    { path: 'src/index.ts', status: 'modified', staged: false, isDirectory: false },
  ],
  stats: { fileCount: 2, staged: 0, modified: 2, untracked: 0, insertions: 2, deletions: 2, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, suggestEnabled: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

await page.goto(harness)
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
await page.addScriptTag({ path: resolve(E2E, 'client.js') })

await page.evaluate(async (snap) => {
  const { connection } = window.createGitPanelMock(snap)
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
  window.__getLoaded().apply(ctx)
  await new Promise((r) => setTimeout(r, 500))
  const panelHost = document.getElementById('panel')
  panelHost.style.width = '960px'
  panelHost.style.height = '720px'
  window.ReactDOM.createRoot(panelHost).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 700))
  // Land on the change and load its diff (dirty default = changes tab).
  document.querySelector('.gp-changes .gp-file-row')?.click()
  await new Promise((r) => setTimeout(r, 600))
}, SNAP)

const out = { errors }
// Row classes are variants only (gp-diff-row--add/--del/--hunk), so match by
// substring — a bare .gp-diff-row token does not exist in the DOM.
const rows = () => page.evaluate(() => document.querySelectorAll('[class*="gp-diff-row"]').length)

// Baseline: one diff instance rendered.
out.rowsBefore = await rows()
assert.ok(out.rowsBefore > 0, 'the diff rendered after picking the change')

// The toolbar path doubles as the copy control: clicking writes the relative
// path to the clipboard. The path NEVER swaps out for the phrase — in a
// squeezed toolbar a bare text node wraps and balloons the row — the
// confirmation is a check mark in the directory slot + tints + aria/title +
// a visually-hidden live region; a denied write tints without a check.
await page.evaluate(() => {
  window.__copiedPath = null
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.__copiedPath = text } } })
})
out.pathIdle = await page.evaluate(() => {
  const p = document.querySelector('.gp-diff__path')
  return p === null ? null : {
    tag: p.tagName,
    text: p.textContent,
    title: p.getAttribute('title'),
    live: p.querySelector('.gp-copy-live')?.textContent ?? null,
  }
})
assert.equal(out.pathIdle.tag, 'BUTTON', 'the header path is a button')
assert.equal(out.pathIdle.text, 'src/client/testkit.ts', 'idle it shows the whole relative path')
assert.equal(out.pathIdle.live, '', 'the live region starts quiet')
out.pathCopied = await page.evaluate(async () => {
  const tb = document.querySelector('.gp-diff__toolbar')
  const toolbarBefore = tb === null ? 0 : tb.getBoundingClientRect().height
  document.querySelector('.gp-diff__path')?.click()
  await new Promise((r) => setTimeout(r, 150))
  const p = document.querySelector('.gp-diff__path')
  const toolbarAfter = tb === null ? 0 : tb.getBoundingClientRect().height
  return {
    copied: window.__copiedPath,
    cls: p?.classList.contains('gp-diff__path--copied') ?? false,
    hasCheck: p?.querySelector('svg') !== null,
    name: p?.querySelector('.gp-diff__path-name')?.textContent ?? null,
    dirGone: p?.querySelector('.gp-diff__path-dir') === null,
    title: p?.getAttribute('title') ?? null,
    aria: p?.getAttribute('aria-label') ?? null,
    live: p?.querySelector('.gp-copy-live')?.textContent ?? null,
    toolbarBefore,
    toolbarAfter,
  }
})
assert.equal(out.pathCopied.copied, 'src/client/testkit.ts', 'click copies the relative path')
// This runner registers the real zh dictionary, so the labels read as text.
assert.equal(out.pathCopied.cls, true, 'the confirmation state lands on the path')
assert.equal(out.pathCopied.hasCheck, true, 'the directory slot trades places with a check mark')
assert.equal(out.pathCopied.name, 'testkit.ts', 'the filename stays on screen')
assert.equal(out.pathCopied.dirGone, true, 'only the directory slot is swapped out')
assert.equal(out.pathCopied.title, '路径已复制 src/client/testkit.ts', 'the tooltip leads with the confirmation')
assert.equal(out.pathCopied.aria, '路径已复制 src/client/testkit.ts', 'the accessible name announces the outcome')
assert.equal(out.pathCopied.live, '路径已复制', 'the phrase rides the visually-hidden live region')
assert.equal(
  out.pathCopied.toolbarAfter,
  out.pathCopied.toolbarBefore,
  `the confirmation never changes the toolbar height (${out.pathCopied.toolbarBefore} → ${out.pathCopied.toolbarAfter})`,
)
await page.waitForTimeout(1700)
out.pathReverted = await page.evaluate(() => {
  const p = document.querySelector('.gp-diff__path')
  return {
    cls: p?.classList.contains('gp-diff__path--copied') ?? false,
    text: p?.textContent ?? null,
    title: p?.getAttribute('title') ?? null,
    live: p?.querySelector('.gp-copy-live')?.textContent ?? null,
  }
})
assert.equal(out.pathReverted.cls, false, 'the confirmation clears on its timer')
assert.equal(out.pathReverted.text, 'src/client/testkit.ts', 'the whole path shows again')
assert.equal(out.pathReverted.title, 'src/client/testkit.ts', 'the tooltip returns to the plain path')
assert.equal(out.pathReverted.live, '', 'the live region goes quiet')
await page.evaluate(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied') } } })
})
out.pathDenied = await page.evaluate(async () => {
  document.querySelector('.gp-diff__path')?.click()
  await new Promise((r) => setTimeout(r, 150))
  const p = document.querySelector('.gp-diff__path')
  return {
    error: p?.classList.contains('gp-diff__path--error') ?? false,
    check: p?.querySelector('svg') !== null,
    name: p?.querySelector('.gp-diff__path-name')?.textContent ?? null,
    live: p?.querySelector('.gp-copy-live')?.textContent ?? null,
  }
})
assert.equal(out.pathDenied.error, true, 'a denied write shows the failure state')
assert.equal(out.pathDenied.check, false, 'failure carries no check mark')
assert.equal(out.pathDenied.name, 'testkit.ts', 'failure keeps the path untouched')
assert.equal(out.pathDenied.live, '复制失败', 'the failure rides the live region')
await page.waitForTimeout(1700)

// Switching to another file mid-confirmation must not carry the old check mark
// onto the new path. The header button is one node reused for every file, so a
// stale cooked state would flash a tick on a file just opened. The probe reads
// inside the FIRST animation frame (before it paints): that is the earliest
// picture the user could possibly see.
out.crossFile = await page.evaluate(async () => {
  const snapshot = () => {
    const p = document.querySelector('.gp-diff__path')
    return {
      text: p?.textContent ?? null,
      label: p?.getAttribute('aria-label') ?? null,
      copied: p?.classList.contains('gp-diff__path--copied') ?? false,
      live: p?.querySelector('.gp-copy-live')?.textContent ?? null,
      title: p?.getAttribute('title') ?? null,
    }
  }
  // Clipboard answers again, so the copy lands in its confirmation state.
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })
  document.querySelector('.gp-diff__path')?.click()
  await new Promise((r) => setTimeout(r, 120))
  const armed = document.querySelector('.gp-diff__path')?.classList.contains('gp-diff__path--copied') ?? false
  const before = snapshot()
  // The row click loads the new diff asynchronously, so the header switches on
  // a later frame. Sample every frame and capture the FIRST one that already
  // shows the new file — that frame is what the user sees.
  // Row text is "status + name + dir", never the joined path — the name span's
  // title carries it.
  const other = [...document.querySelectorAll('.gp-changes .gp-file-row')]
    .find((row) => row.querySelector('.gp-tree-name')?.getAttribute('title') === 'src/index.ts')
  other?.click()
  // The row click commits the new diff synchronously; sample several frames
  // from that commit on and fail if ANY of them shows the new path together
  // with the previous file's check mark — that frame is what the user sees.
  const watched = []
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => requestAnimationFrame(r))
    const now = snapshot()
    watched.push(now)
    if ((now.label || '').includes('src/index.ts')) break
  }
  return { armed, before, watched, settled: snapshot() }
  return { armed, before, firstFrame, settled: snapshot() }
})
assert.equal(out.crossFile.armed, true, 'the first file really is in its confirmation state')
const onNewFile = out.crossFile.watched.filter((f) => (f.label || '').includes('src/index.ts'))
assert.ok(onNewFile.length > 0, 'the header switches to the other file')
assert.equal(onNewFile[0].text, 'src/index.ts', 'the first frame showing the new file carries its path')
assert.ok(
  onNewFile.every((f) => !f.copied),
  `no frame paints a check mark on the new file (got ${JSON.stringify(out.crossFile.watched.map((f) => [f.label, f.copied]))})`,
)
assert.equal(onNewFile[0].live, '', 'the live region is quiet for the new file')
assert.equal(out.crossFile.settled.text, 'src/index.ts', 'the settled header shows the second file')
assert.equal(out.crossFile.settled.copied, false, 'no delayed confirmation arrives for the previous file')
assert.equal(out.crossFile.settled.title, 'src/index.ts', 'the tooltip names the new file')

// Back to the first file: the rest of this runner drives that one.
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.gp-changes .gp-file-row')]
    .find((r) => r.querySelector('.gp-tree-name')?.getAttribute('title') === 'src/client/testkit.ts')
  row?.click()
})
await page.waitForTimeout(600)
out.backOnFirst = await page.evaluate(() => document.querySelector('.gp-diff__path')?.textContent ?? null)
assert.equal(out.backOnFirst, 'src/client/testkit.ts', 'switching back restores the first file\'s header')

await page.evaluate(() => {
  const diff = document.querySelector('.gp-diff')
  if (diff === null) throw new Error('no inline diff block')
  diff.setAttribute('data-probe', 'same-node')
})

// Open the enlarged card.
await page.click('.gp-diff__modal-btn')
await page.waitForTimeout(300)
out.open = await page.evaluate(() => {
  const diff = document.querySelector('.gp-diff')
  const expand = document.querySelector('.gp-diff__expand')
  const modalBtn = document.querySelector('.gp-diff__modal-btn')
  const eb = expand === null || modalBtn === null ? null : getComputedStyle(expand)
  const mb = expand === null || modalBtn === null ? null : getComputedStyle(modalBtn)
  return {
    card: diff !== null && diff.classList.contains('gp-diff--card'),
    sameNode: diff !== null && diff.getAttribute('data-probe') === 'same-node',
    backdrop: document.querySelector('.gp-diff-backdrop') !== null,
    closeBtn: document.querySelector('.gp-diff__card-close') !== null,
    pressed: modalBtn?.getAttribute('aria-pressed') ?? null,
    expandIsIcon: expand?.querySelector('svg') !== null,
    // Compare the actually-visible geometry, not borderTopColor: with
    // border-style:none the computed color mirrors `color`, which the pressed
    // tint deliberately recolors on the (open) trigger.
    iconStylesMatch: eb !== null && mb !== null
      && eb.borderTopWidth === mb.borderTopWidth
      && eb.borderTopStyle === mb.borderTopStyle
      && eb.width === mb.width
      && eb.height === mb.height,
  }
}
)
assert.equal(out.open.card, true, 'the inline diff is restyled into the card')
assert.equal(out.open.sameNode, true, 'the SAME DOM node carried over — no remount')
assert.equal(out.open.backdrop, true, 'the backdrop covers the page')
assert.equal(out.open.closeBtn, true, 'a close button appears in the card bar')
assert.equal(out.open.pressed, 'true', 'the trigger reports its pressed state')
assert.equal(out.open.expandIsIcon, true, 'expand-all renders as an icon')
assert.equal(out.open.iconStylesMatch, true, 'the two toolbar icons share one style')
out.rowsOpen = await rows()
assert.equal(out.rowsOpen, out.rowsBefore, 'the diff did not render a second time')

// The card carries the dialog contract: role/aria-modal on the card itself,
// the backdrop hidden from AT, the sibling change list inert (focus cannot
// wander out), and initial focus inside the card (its close button).
out.a11y = await page.evaluate(() => {
  const diff = document.querySelector('.gp-diff')
  const backdrop = document.querySelector('.gp-diff-backdrop')
  const left = document.querySelector('.gp-changes__left')
  const active = document.activeElement
  return {
    role: diff?.getAttribute('role') ?? null,
    modal: diff?.getAttribute('aria-modal') ?? null,
    label: diff?.getAttribute('aria-label') ?? null,
    backdropHidden: backdrop?.getAttribute('aria-hidden') ?? null,
    leftInert: left !== null && left.hasAttribute('inert'),
    focusInCard: diff !== null && active !== null && diff.contains(active),
    focusIsClose: active?.classList.contains('gp-diff__card-close') ?? false,
  }
})
assert.equal(out.a11y.role, 'dialog', 'the card advertises role=dialog')
assert.equal(out.a11y.modal, 'true', 'the card is aria-modal while open')
assert.equal(out.a11y.label, 'src/client/testkit.ts', 'the card is labelled with the file path')
assert.equal(out.a11y.backdropHidden, 'true', 'the backdrop is hidden from assistive tech')
assert.equal(out.a11y.leftInert, true, 'the sibling change list goes inert behind the card')
assert.equal(out.a11y.focusInCard, true, 'initial focus moves inside the card')
assert.equal(out.a11y.focusIsClose, true, 'the close button takes the initial focus')

// The card's GEOMETRY, not just its class: `.gp-diff--card` is what turns the
// inline pane into a centred fixed dialog. Dropping that rule (or any of its
// declarations) leaves every other assertion green — the class is still there,
// the dialog contract still holds — so these read the computed box.
out.cardBox = await page.evaluate(() => {
  const el = document.querySelector('.gp-diff--card')
  const bd = document.querySelector('.gp-diff-backdrop')
  if (el === null || bd === null) return null
  const s = getComputedStyle(el)
  const bs = getComputedStyle(bd)
  const r = el.getBoundingClientRect()
  const br = bd.getBoundingClientRect()
  return {
    position: s.position,
    zIndex: s.zIndex,
    // computed width/height are the content box: the 1px border is excluded, so
    // this compares the declared box directly instead of eating the tolerance.
    width: Math.round(parseFloat(s.width)),
    height: Math.round(parseFloat(s.height)),
    borderBox: { w: Math.round(r.width), h: Math.round(r.height) },
    radius: s.borderTopLeftRadius,
    centered: Math.abs((r.left + r.width / 2) - window.innerWidth / 2) <= 2,
    backdropPosition: bs.position,
    backdropZ: bs.zIndex,
    backdropCovers: Math.round(br.width) === window.innerWidth && Math.round(br.height) === window.innerHeight,
    expectedWidth: Math.round(Math.min(920, window.innerWidth * 0.86)),
    expectedHeight: Math.round(Math.min(680, window.innerHeight * 0.82)),
  }
})
assert.ok(out.cardBox !== null, 'the card and its backdrop are both up')
assert.equal(out.cardBox.position, 'fixed', 'the card leaves the flow and pins to the viewport')
assert.equal(out.cardBox.zIndex, '1000', 'the card sits above the backdrop')
assert.equal(out.cardBox.width, out.cardBox.expectedWidth, `the card is min(920px,86vw) wide (${out.cardBox.width} vs ${out.cardBox.expectedWidth})`)
assert.equal(out.cardBox.height, out.cardBox.expectedHeight, `the card is min(680px,82vh) tall (${out.cardBox.height} vs ${out.cardBox.expectedHeight})`)
assert.equal(out.cardBox.borderBox.w, out.cardBox.width + 2, 'the border box adds the 1px border on each side')
assert.equal(out.cardBox.radius, '14px', 'the card keeps its rounded corners')
assert.equal(out.cardBox.centered, true, 'the card is centred horizontally')
assert.equal(out.cardBox.backdropPosition, 'fixed', 'the backdrop is fixed too')
assert.equal(out.cardBox.backdropZ, '999', 'the backdrop sits just under the card')
assert.equal(out.cardBox.backdropCovers, true, 'the backdrop covers the viewport')

// The width clamp has two branches and only one is reachable at 1100px wide
// (min(920, 86vw) picks the 920 cap). Deleting the vw fallback would leave the
// card overflowing a narrow window with every other assertion green, so walk
// the second branch here. 800px is the window that isolates it: 86vw = 688 is
// under the cap, and the <=640px media query (which re-declares width as 96vw)
// does not apply yet.
await page.setViewportSize({ width: 800, height: 800 })
await page.waitForTimeout(150)
out.narrowCard = await page.evaluate(() => {
  const el = document.querySelector('.gp-diff--card')
  if (el === null) return null
  const s = getComputedStyle(el)
  const r = el.getBoundingClientRect()
  return {
    width: Math.round(parseFloat(s.width)),
    expected: Math.round(Math.min(920, window.innerWidth * 0.86)),
    fits: r.right <= window.innerWidth + 1 && r.left >= -1,
  }
})
assert.ok(out.narrowCard !== null, 'the card survives a narrow viewport')
assert.equal(out.narrowCard.width, out.narrowCard.expected, `86vw takes over below the cap (${out.narrowCard.width} vs ${out.narrowCard.expected})`)
assert.equal(out.narrowCard.fits, true, 'and the card still fits inside the viewport')
await page.setViewportSize({ width: 1100, height: 800 })
await page.waitForTimeout(150)

// Esc closes; the node survives for the next open.
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
out.afterEsc = await page.evaluate(() => ({
  card: document.querySelector('.gp-diff')?.classList.contains('gp-diff--card') ?? false,
  backdrop: document.querySelector('.gp-diff-backdrop') !== null,
  sameNode: document.querySelector('.gp-diff')?.getAttribute('data-probe') === 'same-node',
}))
assert.equal(out.afterEsc.card, false, 'Esc closes the card')
assert.equal(out.afterEsc.backdrop, false, 'Esc removes the backdrop')
assert.equal(out.afterEsc.sameNode, true, 'the node is still the same instance')

// Focus goes back to the control that opened the card — the dialog contract's
// other half, and the reason the trigger ref is threaded through the hook.
out.afterEscFocus = await page.evaluate(() => {
  const active = document.activeElement
  return {
    tag: active?.tagName ?? null,
    isTrigger: active?.classList.contains('gp-diff__modal-btn') ?? false,
  }
})
assert.equal(out.afterEscFocus.isTrigger, true, `closing returns focus to the toolbar toggle (got ${out.afterEscFocus.tag})`)

// Backdrop click closes as well.
await page.click('.gp-diff__modal-btn')
await page.waitForTimeout(250)
await page.mouse.click(6, 6)
await page.waitForTimeout(250)
out.afterBackdrop = await page.evaluate(() => document.querySelector('.gp-diff--card') !== null)
assert.equal(out.afterBackdrop, false, 'a backdrop click closes the card')

// Rows still single-instance after the round trip.
out.rowsAfter = await rows()
assert.equal(out.rowsAfter, out.rowsBefore, 'still exactly one diff instance')

// ── compact: the card must behave the same where the diff is a drilled-in pane
// The card's visibility depends on the pane as well as the flag (`cardOpen` is
// false while the list is on screen), and that combination was never exercised:
// every assertion above runs in the wide layout.
await page.evaluate(() => {
  const host = document.getElementById('panel')
  host.style.width = '400px'
})
await page.waitForTimeout(250)
out.compact = await page.evaluate(() => ({ layout: document.querySelector('.gp-panel')?.getAttribute('data-layout') ?? null }))
assert.equal(out.compact.layout, 'compact', 'narrowing the panel switches to the compact layout')
// Drilling in happens on a row click; the diff loads on its own query.
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.gp-changes .gp-file-row')]
    .find((r) => r.querySelector('.gp-tree-name')?.getAttribute('title') === 'src/client/testkit.ts')
  row?.click()
})
await page.waitForTimeout(700)
out.compactDiff = await page.evaluate(() => ({
  toolbar: document.querySelector('.gp-diff__toolbar--compact') !== null,
  card: document.querySelector('.gp-diff--card') !== null,
}))
assert.equal(out.compactDiff.toolbar, true, 'the drilled-in diff shows the compact toolbar')
assert.equal(out.compactDiff.card, false, 'the card is not up just from drilling in')
await page.click('.gp-diff__modal-btn')
await page.waitForTimeout(250)
out.compactCard = await page.evaluate(() => {
  const el = document.querySelector('.gp-diff--card')
  const left = document.querySelector('.gp-changes__left')
  const active = document.activeElement
  const s = el === null ? null : getComputedStyle(el)
  return {
    up: el !== null,
    position: s?.position ?? null,
    role: el?.getAttribute('role') ?? null,
    modal: el?.getAttribute('aria-modal') ?? null,
    backdrop: document.querySelector('.gp-diff-backdrop') !== null,
    backdropHidden: document.querySelector('.gp-diff-backdrop')?.getAttribute('aria-hidden') ?? null,
    focusInCard: el !== null && active !== null && el.contains(active),
    // compact renders one pane at a time, so there is no sibling to inert
    leftInert: left === null ? null : left.hasAttribute('inert'),
  }
})
assert.equal(out.compactCard.up, true, 'the card opens in compact too')
assert.equal(out.compactCard.position, 'fixed', 'and it is the same fixed dialog')
assert.equal(out.compactCard.role, 'dialog', 'with the dialog role')
assert.equal(out.compactCard.modal, 'true', 'and aria-modal')
assert.equal(out.compactCard.backdrop, true, 'and its backdrop')
assert.equal(out.compactCard.backdropHidden, 'true', 'the backdrop stays out of the a11y tree')
assert.equal(out.compactCard.focusInCard, true, 'focus still moves inside the card')
// Escape closes it, and drilling back to the list drops the card with the pane.
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
out.compactEsc = await page.evaluate(() => document.querySelector('.gp-diff--card') === null)
assert.equal(out.compactEsc, true, 'Esc closes the compact card')
await page.evaluate(() => document.querySelector('.gp-subhead__back')?.click())
await page.waitForTimeout(250)
out.compactBack = await page.evaluate(() => ({
  list: document.querySelector('.gp-changes .gp-file-row') !== null,
  diff: document.querySelector('.gp-diff') !== null,
}))
assert.equal(out.compactBack.list, true, 'the back control returns to the change list')
assert.equal(out.compactBack.diff, false, 'and unmounts the diff pane entirely')

assert.deepEqual(errors, [], 'no console errors')
console.log('e2e/changes-diff-modal: all assertions passed', JSON.stringify(out))
await browser.close()
