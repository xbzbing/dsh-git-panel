/**
 * Diff line comments into the composer (issue #123, ADR-0038), and the entry
 * into the platform's "Local changes" review tab.
 *
 * Pins: line numbers pick lines only when a composer exists; Shift grows the
 * range inside one hunk; the comment bar sits below the scroller (the windowed
 * rows never move); the quote text and the composer chip; numbering continues
 * after comments already in the draft; a refusing composer keeps the comment;
 * Escape closes the form wherever its focus is, not what surrounds it, and
 * hands the keyboard back to the gutter; the gutters work from the keyboard
 * through one tab stop; a refreshed diff that moved the code marks the comment
 * stale and keeps its frozen quote; expanding the context keeps the form, its
 * text and its pick; a composing Escape reaches neither the enlarged card nor
 * the commit dialog; an unreadable draft still numbers on; the
 * review-tab button opens the session's local changes at the file, fits the
 * compact toolbar, and is absent without the bundle.
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

/** Mount the panel with an optional composer (whose draft may be unreadable)
 * and an optional review bundle, in a panel box of the given size. */
async function mount({ composer, forge, draft = true, size = [960, 720] }) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addStyleTag({ content: THEME })
  await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
  await page.addScriptTag({ path: resolve(E2E, 'client.js') })
  await page.evaluate(async ({ snap, composer, forge, draft, size }) => {
    const { connection, fixture } = window.createGitPanelMock(snap)
    window.__fixture = fixture
    // The composer: a draft that grows by each accepted quote (blockquoted, as
    // the platform's clipboard projection writes it), and a switch to refuse.
    window.__review = { quotes: [], draft: 'Please look at these:\n', refuse: false, focus: 0, opened: [] }
    // The composer's keyboard ownership: insertQuote focuses it for real, so
    // "an added comment leaves focus with the composer" can be observed instead
    // of only counting calls.
    const composerEl = document.createElement('textarea')
    composerEl.id = 'composer-fixture'
    composerEl.style.cssText = 'position:fixed;left:-9999px;top:0;width:8px;height:8px'
    document.body.appendChild(composerEl)
    const input = {
      insertQuote: (text, summary) => {
        if (window.__review.refuse) return false
        window.__review.quotes.push({ text, summary })
        window.__review.draft += text.split('\n').map((l) => `> ${l}`).join('\n') + '\n'
        return true
      },
      focus: () => { window.__review.focus += 1; composerEl.focus() },
      ...(draft ? { state: { getSnapshot: () => ({ draft: window.__review.draft }) } } : {}),
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
    panelHost.style.width = `${size[0]}px`
    panelHost.style.height = `${size[1]}px`
    window.ReactDOM.createRoot(panelHost).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 700))
    document.querySelector('.gp-changes .gp-file-row')?.click()
    await new Promise((r) => setTimeout(r, 600))
  }, { snap: SNAP, composer, forge, draft, size })
  return page
}

const gutter = (side, line) => `.gp-diff-no--pick[data-side="${side}"][data-line="${line}"]`
/** The focused gutter as `R2`, or null when focus is elsewhere. */
const focusedGutter = (p) => p.evaluate(() => {
  const el = document.activeElement
  return el?.classList.contains('gp-diff-no--pick') ? `${el.dataset.side}${el.dataset.line}` : null
})

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
assert.ok(await page.evaluate(() => window.__review.focus) >= 1, 'the composer is asked to take the keyboard')
assert.equal(await page.evaluate(() => document.activeElement?.id), 'composer-fixture', 'an added comment leaves focus with the composer, not the gutter')

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

// Escape closes the form only, and the keyboard returns to the picked gutter.
await page.locator('.gp-review__input').press('Escape')
assert.equal(await page.locator('.gp-review').count(), 0, 'Escape closes the form')
assert.ok(await page.locator('[class*="gp-diff-row"]').count() > 0, 'the diff stays')
assert.equal(await focusedGutter(page), 'R2', 'focus goes back to the gutter the form was opened from')

// Escape during IME composition cancels the candidate list, not the form.
await page.locator(gutter('R', 2)).click()
await page.locator('.gp-review__input').fill('组合中的评论')
await page.locator('.gp-review__input').evaluate((el) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }))
})
assert.equal(await page.locator('.gp-review').count(), 1, 'a composing Escape does not close the form')
assert.equal(await page.locator('.gp-review__input').inputValue(), '组合中的评论', 'the text survives the IME cancel')
await page.locator('.gp-review__input').press('Escape')
assert.equal(await page.locator('.gp-review').count(), 0, 'a plain Escape still closes it')
assert.equal(await focusedGutter(page), 'R2', 'and returns focus to the gutter')

// With focus on a button of the form, Escape still closes the form.
await page.locator(gutter('R', 2)).click()
await page.locator('.gp-review__actions .gp-btn:not(.gp-btn--primary)').focus()
await page.keyboard.press('Escape')
assert.equal(await page.locator('.gp-review').count(), 0, 'Escape from a form button closes the form')
assert.equal(await focusedGutter(page), 'R2')

// The gutters from the keyboard: one tab stop, arrows walk a side, Enter picks
// and Shift+Enter grows the range.
assert.equal(await page.locator('.gp-diff-no--pick[tabindex="0"]').count(), 1, 'one gutter takes Tab')
assert.equal(await page.locator(gutter('R', 2)).getAttribute('role'), 'button')
assert.equal(await page.locator(gutter('R', 2)).getAttribute('aria-label'), 'R2', 'a gutter names its side and line for the screen reader')
await page.locator(gutter('R', 1)).focus()
await page.keyboard.press('ArrowDown')
assert.equal(await focusedGutter(page), 'R2', 'ArrowDown moves to the next line of the side')
assert.equal(await page.locator('.gp-diff-no--pick[tabindex="0"]').getAttribute('data-line'), '2', 'the Tab stop follows the focused gutter')
await page.keyboard.press('Enter')
assert.match(await page.locator('.gp-review__title').innerText(), /R2$/, 'Enter picks the focused line')
assert.equal(await page.locator(gutter('R', 2)).getAttribute('tabindex'), '0', 'the anchor becomes the tab stop')
await page.locator(gutter('R', 2)).focus()
await page.keyboard.press('ArrowUp')
assert.equal(await focusedGutter(page), 'R1')
await page.keyboard.press('Shift+Enter')
assert.match(await page.locator('.gp-review__title').innerText(), /R1\u20132$/, 'Shift+Enter grows the range')
await page.locator('.gp-review__input').press('Escape')
assert.equal(await focusedGutter(page), 'R2', 'focus returns to the anchor')

// Inside the enlarged card (a capture-phase Escape owner) the form still wins
// the first Escape, and the card takes the second.
await page.locator('.gp-diff__modal-btn').click()
assert.equal(await page.locator('.gp-diff--card').count(), 1, 'the card is up')
await page.locator(gutter('R', 2)).click()
await page.locator('.gp-review__input').press('Escape')
assert.equal(await page.locator('.gp-review').count(), 0, 'the first Escape closes the form')
assert.equal(await page.locator('.gp-diff--card').count(), 1, 'and leaves the card open')
// A composing Escape belongs to the input method: neither the form nor the
// card around it takes it.
await page.locator(gutter('R', 2)).click()
await page.locator('.gp-review__input').fill('卡片里的组合输入')
await page.locator('.gp-review__input').evaluate((el) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }))
})
assert.equal(await page.locator('.gp-diff--card').count(), 1, 'a composing Escape leaves the card open')
assert.equal(await page.locator('.gp-review__input').inputValue(), '卡片里的组合输入', 'and the comment in it')
await page.locator('.gp-review__input').press('Escape')
assert.equal(await page.locator('.gp-review').count(), 0)
// The same from a button of the form: the card does not take the key.
await page.locator(gutter('R', 2)).click()
await page.locator('.gp-review__actions .gp-btn:not(.gp-btn--primary)').focus()
await page.keyboard.press('Escape')
assert.equal(await page.locator('.gp-review').count(), 0, 'Escape from a form button closes the form in the card')
assert.equal(await page.locator('.gp-diff--card').count(), 1, 'and leaves the card open')
await page.keyboard.press('Escape')
assert.equal(await page.locator('.gp-diff--card').count(), 0, 'the next Escape closes the card')

// A refresh that changes the picked line marks the comment stale: no tint, a
// notice, and the quote is still the code the reader saw.
await page.locator(gutter('R', 2)).click()
await page.locator('.gp-review__input').fill('About the line I saw.')
await page.evaluate(() => { window.__fixture.diffText = 'line2-edited' })
await page.locator('.gp-changes__refresh').click()
await page.waitForFunction(() => document.querySelector('.gp-diff__wrap')?.textContent.includes('line2-edited'))
assert.equal(await page.locator('.gp-review__stale').count(), 1, 'the stale notice shows')
assert.equal(await page.locator('.gp-diff-no--sel').count(), 0, 'the moved range is not tinted')
assert.equal(await page.locator('.gp-review__input').inputValue(), 'About the line I saw.', 'the text survives the refresh')
const quotesBefore = await page.evaluate(() => window.__review.quotes.length)
await add.click()
const staleQuote = await page.evaluate(() => window.__review.quotes.at(-1))
assert.equal(await page.evaluate(() => window.__review.quotes.length), quotesBefore + 1, 'a stale comment can still be added')
assert.ok(staleQuote.text.includes('\n+line2\n') && !staleQuote.text.includes('line2-edited'), 'the quote keeps the frozen snippet')
await page.evaluate(() => { window.__fixture.diffText = null })

// Expanding the context keeps the diff mounted: the comment being written, its
// text and its pick survive, and a wider hunk around the same lines is not
// "changed code". The collapsed diff ends in a gap (the file has six lines), so
// the "expanded to the cap" notice would be wrong until the expanded text lands.
await page.evaluate(() => {
  const head = ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt']
  window.__fixture.diffFullText = [...head, '@@ -1 +1,2 @@', ' line1', '+line2'].join('\n')
  window.__fixture.diffFullNewLines = 6
  window.__fixture.diffContextText = [...head, '@@ -1,5 +1,6 @@', ' line1', '+line2', ' line3', ' line4', ' line5', ' line6'].join('\n')
  window.__fixture.holdContextDiff = true
})
await page.locator('.gp-changes__refresh').click()
await page.waitForFunction(() => !(document.querySelector('.gp-diff__wrap')?.textContent || '').includes('line2-edited'))
const cappedShown = () => page.evaluate(() => (document.querySelector('.gp-diff__wrap')?.textContent || '').includes('文件较大'))
await page.locator(gutter('R', 2)).click()
await page.locator('.gp-review__input').fill('Half written.')
await page.locator('.gp-diff__expand').click()
await page.waitForFunction(() => typeof window.__fixture.releaseContextDiff === 'function')
assert.equal(await page.locator('.gp-review__input').inputValue(), 'Half written.', 'the form stays while the expanded text loads')
assert.equal(await cappedShown(), false, 'no "expanded to the cap" notice over the collapsed text')
await page.evaluate(() => { window.__fixture.holdContextDiff = false; window.__fixture.releaseContextDiff() })
await page.waitForFunction(() => (document.querySelector('.gp-diff__wrap')?.textContent || '').includes('line6'))
assert.equal(await page.locator('.gp-review').count(), 1, 'expanding the context keeps the form')
assert.equal(await page.locator('.gp-review__input').inputValue(), 'Half written.', 'and its text')
assert.equal(await page.locator('.gp-review__stale').count(), 0, 'a wider hunk is not changed code')
assert.equal(await page.locator('.gp-diff-no--sel').count(), 1, 'the pick stays tinted')
// Collapsing again keeps the form too. A line next to the change stays in the
// narrower hunk and stays current; one that falls into the gap is "not shown",
// not "changed", and is current again once the context comes back.
await page.locator('.gp-diff__expand').click()
await page.waitForFunction(() => !(document.querySelector('.gp-diff__wrap')?.textContent || '').includes('line6'))
assert.equal(await page.locator('.gp-review__input').inputValue(), 'Half written.', 'collapsing keeps the text')
assert.equal(await page.locator('.gp-review__stale').count(), 0, 'a line the narrower hunk keeps stays current')
await page.locator('.gp-diff__expand').click()
await page.waitForFunction(() => (document.querySelector('.gp-diff__wrap')?.textContent || '').includes('line6'))
await page.locator(gutter('R', 5)).click()
await page.locator('.gp-diff__expand').click()
await page.waitForFunction(() => !(document.querySelector('.gp-diff__wrap')?.textContent || '').includes('line6'))
assert.equal(await page.locator('.gp-review').count(), 1, 'a line collapsed out of view keeps the form')
assert.match(await page.locator('.gp-review__stale').innerText(), /不在当前显示的差异里/, 'it says the line is not shown')
assert.doesNotMatch(await page.locator('.gp-review__stale').innerText(), /代码已经变化/, 'not that the code changed')
await page.locator('.gp-diff__expand').click()
await page.waitForFunction(() => (document.querySelector('.gp-diff__wrap')?.textContent || '').includes('line6'))
assert.equal(await page.locator('.gp-review__stale').count(), 0, 'back in view, it is current again')
await page.locator('.gp-review__input').press('Escape')
await page.locator('.gp-diff__expand').click()
await page.waitForFunction(() => !(document.querySelector('.gp-diff__wrap')?.textContent || '').includes('line6'))
await page.evaluate(() => { window.__fixture.diffContextText = null; window.__fixture.diffFullText = null })
await page.locator('.gp-changes__refresh').click()

// The commit file-diff dialog closes on any Escape that reaches the document;
// a composing one stays with the form, and the dialog with it.
await page.locator('[role="tab"]').nth(0).click()
await page.locator('.gp-commit-row').first().click()
const commitFile = page.locator('.gp-tree-row').filter({ hasText: 'index.ts' }).first()
await commitFile.click()
await page.waitForSelector('.gp-modal .gp-diff-no--pick')
await page.locator('.gp-modal .gp-diff-no--pick[data-side="R"]').first().click()
await page.locator('.gp-modal .gp-review__input').fill('弹窗里的组合输入')
await page.locator('.gp-modal .gp-review__input').evaluate((el) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }))
})
assert.equal(await page.locator('.gp-modal').count(), 1, 'a composing Escape leaves the commit dialog open')
assert.equal(await page.locator('.gp-modal .gp-review__input').inputValue(), '弹窗里的组合输入', 'and the comment in it')
// Expanding the dialog's context keeps the comment too.
const diffQueries = await page.evaluate(() => window.__fixture.queries.filter((k) => k === 'diff').length)
await page.locator('.gp-modal .gp-diff__expand').click()
await page.waitForFunction((n) => window.__fixture.queries.filter((k) => k === 'diff').length > n, diffQueries)
await page.waitForSelector('.gp-modal .gp-diff__expand[aria-pressed="true"]')
await page.waitForTimeout(150)
assert.equal(await page.locator('.gp-modal .gp-review__input').inputValue(), '弹窗里的组合输入', 'expanding the dialog keeps the comment')
await page.locator('.gp-modal .gp-review__input').press('Escape')
assert.equal(await page.locator('.gp-modal .gp-review').count(), 0, 'a plain Escape closes the form first')
assert.equal(await page.locator('.gp-modal').count(), 1, 'and only the form')
await page.keyboard.press('Escape')
assert.equal(await page.locator('.gp-modal').count(), 0, 'the next Escape closes the dialog')
await page.locator('[role="tab"]').nth(1).click()

// The review-tab entry opens the session's local changes at this file.
const reviewBtn = page.locator('.gp-diff__review-btn')
assert.equal(await reviewBtn.count(), 1, 'offered for the session checkout with the bundle on')
assert.equal(await reviewBtn.locator('svg[data-files-diff]').count(), 1, 'it wears the "Local changes" tab glyph')
await reviewBtn.click()
assert.deepEqual(await page.evaluate(() => window.__review.opened), [
  { target: { sessionId: 'sess-1', source: { kind: 'local' } }, params: { path: 'a.txt' } },
])
await page.close()

// ── compact, with a composer whose draft cannot be read ─────────────────
const compact = await mount({ composer: true, forge: true, draft: false, size: [360, 480] })
const controls = await compact.evaluate(() => {
  const row = document.querySelector('.gp-diff__toolbar-row--controls')
  if (row === null) return null
  const box = row.getBoundingClientRect()
  return {
    hasReview: row.querySelector('.gp-diff__review-btn') !== null,
    fits: row.scrollWidth <= row.clientWidth
      && [...row.children].every((c) => { const r = c.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1 }),
  }
})
assert.deepEqual(controls, { hasReview: true, fits: true }, 'the compact control row carries the review entry without overflowing')
for (const n of [1, 2]) {
  await compact.locator(gutter('R', 2)).click()
  await compact.locator('.gp-review__input').fill(`Comment ${n}.`)
  await compact.locator('.gp-review__actions .gp-btn--primary').click()
}
assert.deepEqual(
  await compact.evaluate(() => window.__review.quotes.map((q) => q.text.split('\n')[0])),
  ['## User Comment 1', '## User Comment 2'],
  'an unreadable draft numbers on from the comments this panel added',
)
await compact.close()

// ── a long diff: the Tab stop starts inside the viewport ──────────────────
const LONG = (() => {
  const body = []
  for (let i = 1; i <= 60; i++) body.push(` line-${i}`)
  return [
    'diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,60 +1,61 @@',
    ...body, '+line-61',
  ].join('\n')
})()
const long = await mount({ composer: true, forge: false })
await long.evaluate((text) => {
  window.__fixture.diffFullText = text
  window.__fixture.diffFullNewLines = 61
}, LONG)
await long.locator('.gp-changes__refresh').click()
await long.waitForFunction(() => (document.querySelector('.gp-diff__wrap')?.textContent || '').includes('@@ -1,60 +1,61 @@'))
// Scroll into the middle: the window now also mounts the overscan band above
// the viewport, which must not be where Tab lands.
await long.evaluate(() => { document.querySelector('.gp-diff__scroll').scrollTop = 520 })
await long.waitForTimeout(300)
const stopInfo = await long.evaluate(() => {
  const stop = document.querySelector('.gp-diff-no--pick[tabindex="0"]')
  const scroll = document.querySelector('.gp-diff__scroll')
  const g = stop.getBoundingClientRect()
  const s = scroll.getBoundingClientRect()
  // At least partly on screen: the viewport may start in the middle of a row.
  return { count: document.querySelectorAll('.gp-diff-no--pick[tabindex="0"]').length, line: Number(stop.dataset.line), inView: g.bottom > s.top + 1 && g.top < s.bottom - 1 }
})
assert.equal(stopInfo.count, 1, 'still one Tab stop')
assert.equal(stopInfo.inView, true, `the first Tab stop is on screen (line ${stopInfo.line})`)
assert.ok(stopInfo.line > 5, 'and not in the overscan band above the viewport')
// Cancel returns the keyboard to the picked line, still on screen.
await long.locator('.gp-diff-no--pick[tabindex="0"]').click()
await long.locator('.gp-review__input').press('Escape')
const back = await long.evaluate(() => {
  const el = document.activeElement
  const scroll = document.querySelector('.gp-diff__scroll')
  const g = el.getBoundingClientRect()
  const s = scroll.getBoundingClientRect()
  return { isGutter: el.classList.contains('gp-diff-no--pick'), line: Number(el.dataset.line), inView: g.bottom > s.top + 1 && g.top < s.bottom - 1 }
})
assert.deepEqual(back, { isGutter: true, line: stopInfo.line, inView: true }, 'cancel returns focus to the picked line, on screen')
await long.close()

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
