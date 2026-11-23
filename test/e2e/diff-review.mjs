/**
 * Diff line comments into the composer (issue #123, ADR-0038), and the entry
 * into the platform's "Local changes" review tab.
 *
 * Pins: line numbers pick lines only when a composer exists; Shift grows the
 * range inside one hunk; the comment bar sits below the scroller (the windowed
 * rows never move); the quote text and the composer chip; numbering continues
 * after comments already in the draft; a refusing composer keeps the comment;
 * Escape closes the form, not what surrounds it; the review-tab button opens
 * the session's local changes at the file and is absent without the bundle.
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

// Dirty, so the panel lands on the changes tab. The mock serves `a.txt` as
// `@@ -1 +1,2 @@` with a context line 1 and an added line 2.
const SNAP = {
  root: '/work/fixture-repo', branch: 'main', head: 'ba78eb4', unborn: false, dirty: true,
  staged: 0, modified: 1, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: null, lastCommit: null,
  changes: [{ path: 'a.txt', status: 'modified', staged: false, isDirectory: false }],
  stats: { fileCount: 1, staged: 0, modified: 1, untracked: 0, insertions: 1, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, suggestEnabled: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
const errors = []

/** Mount the panel with an optional composer and an optional review bundle. */
async function mount({ composer, forge }) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addStyleTag({ content: THEME })
  await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
  await page.addScriptTag({ path: resolve(E2E, 'client.js') })
  await page.evaluate(async ({ snap, composer, forge }) => {
    const { connection } = window.createGitPanelMock(snap)
    // The composer: a draft that grows by each accepted quote (blockquoted, as
    // the platform's clipboard projection writes it), and a switch to refuse.
    window.__review = { quotes: [], draft: 'Please look at these:\n', refuse: false, focus: 0, opened: [] }
    const input = {
      insertQuote: (text, summary) => {
        if (window.__review.refuse) return false
        window.__review.quotes.push({ text, summary })
        window.__review.draft += text.split('\n').map((l) => `> ${l}`).join('\n') + '\n'
        return true
      },
      focus: () => { window.__review.focus += 1 },
      state: { getSnapshot: () => ({ draft: window.__review.draft }) },
    }
    const scope = { get: (key) => (key === 'conversation' ? { input: { for: () => input } } : undefined) }
    const services = {
      connection,
      ...(composer ? { sessions: { scope: () => scope } } : {}),
      ...(forge ? { forgeChanges: { open: (target, params) => { window.__review.opened.push({ target, params }) } } } : {}),
    }
    const registered = {}
    const dictionaries = {}
    const ctx = {
      get: (k) => services[k],
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
    document.querySelector('.gp-changes .gp-file-row')?.click()
    await new Promise((r) => setTimeout(r, 600))
  }, { snap: SNAP, composer, forge })
  return page
}

const gutter = (side, line) => `.gp-diff-no--pick[data-side="${side}"][data-line="${line}"]`

// ── with a composer and the review bundle ─────────────────────────────────
const page = await mount({ composer: true, forge: true })
assert.ok(await page.locator('[class*="gp-diff-row"]').count() > 0, 'the diff rendered')
assert.ok(await page.locator('.gp-diff-no--pick').count() >= 2, 'numbered gutters pick lines')
assert.equal(await page.locator('.gp-review').count(), 0, 'no form before a pick')

// Hovering anywhere on a line shows the "+" on its gutter, over the sign column.
const badge = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  const after = getComputedStyle(el, '::after')
  return { content: after.content, top: parseFloat(after.top), half: el.getBoundingClientRect().height / 2, transform: after.transform }
}, sel)
assert.equal((await badge(gutter('R', 2))).content, 'none', 'no badge at rest')
await page.evaluate((s) => document.querySelector(s).nextElementSibling.nextElementSibling.scrollIntoView(), gutter('R', 2))
const codeBox = await page.evaluate((s) => {
  const r = document.querySelector(s).nextElementSibling.nextElementSibling.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}, gutter('R', 2))
await page.mouse.move(codeBox.x, codeBox.y)
const hovered = await badge(gutter('R', 2))
assert.equal(hovered.content, '"+"', 'hovering the code shows the badge on its gutter')
assert.ok(Math.abs(hovered.top - hovered.half) < 1 && hovered.transform !== 'none', 'the badge is centered on the row height')
// The badge covers the sign column and belongs to the gutter, so a click on it picks.
const onBadge = await page.evaluate((s) => {
  const g = document.querySelector(s)
  const r = g.nextElementSibling.getBoundingClientRect()
  return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === g
}, gutter('R', 2))
assert.equal(onBadge, true, 'the sign column under the badge hits the gutter')
await page.mouse.move(0, 0)
assert.equal((await badge(gutter('R', 2))).content, 'none', 'the badge goes with the pointer')

// A pick opens the form under the scroller, titled by its range.
await page.locator(gutter('R', 2)).click()
assert.equal(await page.locator('.gp-review').count(), 1)
assert.match(await page.locator('.gp-review__title').innerText(), /R2$/)
assert.equal(await page.locator('.gp-diff-no--sel').count(), 1, 'the picked number is marked')
const layout = await page.evaluate(() => {
  const scroll = document.querySelector('.gp-diff__scroll').getBoundingClientRect()
  const bar = document.querySelector('.gp-review').getBoundingClientRect()
  return { below: bar.top >= scroll.bottom - 1, sameParent: document.querySelector('.gp-review').parentElement === document.querySelector('.gp-diff__scroll').parentElement }
})
assert.deepEqual(layout, { below: true, sameParent: true }, 'the form sits below the scroller, outside the windowed rows')
assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('gp-review__input')), true, 'the field takes focus')

// Shift grows the range inside the hunk.
await page.locator(gutter('R', 1)).click({ modifiers: ['Shift'] })
assert.match(await page.locator('.gp-review__title').innerText(), /R1\u20132$/)
assert.ok(await page.locator('.gp-diff-cell--sel').count() >= 2, 'both lines are tinted')

// Empty comments cannot be added.
const add = page.locator('.gp-review__actions .gp-btn--primary')
assert.equal(await add.isDisabled(), true)
await page.locator('.gp-review__input').fill('  Reuse the existing helper.  ')
assert.equal(await add.isDisabled(), false)
await add.click()

const first = await page.evaluate(() => window.__review.quotes[0])
assert.equal(first.text, [
  '## User Comment 1',
  'Repository: /work/fixture-repo',
  'File: a.txt',
  'Side: R',
  'Lines: 1-2',
  'Source: Local (unstaged)',
  'Diff hunk:',
  '```diff',
  '@@ -1,1 +1,2 @@',
  ' line1',
  '+line2',
  '```',
  'Comment:',
  'Reuse the existing helper.',
].join('\n'), 'the quote mirrors the platform review tab, plus the repository')
assert.deepEqual(first.summary, { label: 'a.txt R1\u20132', title: 'a.txt', detail: 'R1\u20132', body: 'Reuse the existing helper.' })
assert.equal(await page.locator('.gp-review').count(), 0, 'an accepted comment closes the form')
assert.equal(await page.locator('.gp-diff-no--sel').count(), 0, 'and clears the pick')
assert.ok(await page.evaluate(() => window.__review.focus) >= 1, 'the composer takes the keyboard')

// The next comment numbers on from the draft (Ctrl/⌘+Enter adds).
await page.locator(gutter('L', 1)).click()
await page.locator('.gp-review__input').fill('Old side.')
await page.locator('.gp-review__input').press('ControlOrMeta+Enter')
const second = await page.evaluate(() => window.__review.quotes[1])
assert.ok(second.text.startsWith('## User Comment 2\n'), 'numbered after the quoted one already in the draft')
assert.match(second.text, /\nSide: L\nLines: 1\n/)

// A composer that refuses keeps the comment and says so.
await page.evaluate(() => { window.__review.refuse = true })
await page.locator(gutter('R', 2)).click()
await page.locator('.gp-review__input').fill('Kept on failure.')
await add.click()
assert.equal(await page.locator('.gp-review__error').count(), 1, 'the refusal is reported')
assert.equal(await page.locator('.gp-review__input').inputValue(), 'Kept on failure.', 'the text survives')
assert.equal(await page.evaluate(() => window.__review.quotes.length), 2, 'nothing was written')
await page.evaluate(() => { window.__review.refuse = false })

// Escape closes the form only.
await page.locator('.gp-review__input').press('Escape')
assert.equal(await page.locator('.gp-review').count(), 0, 'Escape closes the form')
assert.ok(await page.locator('[class*="gp-diff-row"]').count() > 0, 'the diff stays')

// Inside the enlarged card (a capture-phase Escape owner) the form still wins
// the first Escape, and the card takes the second.
await page.locator('.gp-diff__modal-btn').click()
assert.equal(await page.locator('.gp-diff--card').count(), 1, 'the card is up')
await page.locator(gutter('R', 2)).click()
await page.locator('.gp-review__input').press('Escape')
assert.equal(await page.locator('.gp-review').count(), 0, 'the first Escape closes the form')
assert.equal(await page.locator('.gp-diff--card').count(), 1, 'and leaves the card open')
await page.keyboard.press('Escape')
assert.equal(await page.locator('.gp-diff--card').count(), 0, 'the next Escape closes the card')

// The review-tab entry opens the session's local changes at this file.
const reviewBtn = page.locator('.gp-diff__review-btn')
assert.equal(await reviewBtn.count(), 1, 'offered for the session checkout with the bundle on')
assert.equal(await reviewBtn.locator('svg[data-files-diff]').count(), 1, 'it wears the "Local changes" tab glyph')
await reviewBtn.click()
assert.deepEqual(await page.evaluate(() => window.__review.opened), [
  { target: { sessionId: 'sess-1', source: { kind: 'local' } }, params: { path: 'a.txt' } },
])
await page.close()

// ── without a composer or the bundle ──────────────────────────────────────
const bare = await mount({ composer: false, forge: false })
assert.ok(await bare.locator('[class*="gp-diff-row"]').count() > 0, 'the diff still renders')
assert.equal(await bare.locator('.gp-diff-no--pick').count(), 0, 'no composer, no picking')
assert.equal(await bare.locator('.gp-diff__review-btn').count(), 0, 'no bundle, no review-tab entry')
await bare.locator('.gp-diff-no').first().click()
assert.equal(await bare.locator('.gp-review').count(), 0, 'a plain number does nothing')
await bare.close()

await browser.close()
assert.deepEqual(errors, [], 'no console errors')
console.log('diff-review: ok')
