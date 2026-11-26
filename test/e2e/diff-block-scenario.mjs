/**
 * Issue #156: replacement blocks retain patch order, conservative word emphasis,
 * numbered multi-line comments and mode-local Find. Merged into diff-review;
 * its mount creates a fresh file:// page with only mock RPC and a fake composer.
 */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('diff-block-scenario is merged into diff-review.mjs: run node test/e2e/diff-review.mjs')
  process.exit(1)
}

const OLD = ['  alphaValue', '# First introduction', 'const count = 1;']
const NEW = ['  omegaResult', '# Entirely rewritten heading', 'const count = 2;', 'inserted-only sentinel']
const BODY = [' context-before', ...OLD.map((s) => '-' + s), ...NEW.map((s) => '+' + s), ' context-after']
const TEXT = ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,5 +1,6 @@', ...BODY].join('\n')
const gutter = (side, line) => `.gp-diff-no--pick[data-side="${side}"][data-line="${line}"]`
const quote = (index, side, end, snippet, body) => [
  `## User Comment ${index}`, 'Repository: /work/fixture-repo', 'File: a.txt',
  `Side: ${side}`, `Lines: 2-${end}`, 'Source: Local (unstaged)', 'Diff hunk:',
  '```diff', snippet, '```', 'Comment:', body,
].join('\n')

async function switchMode(page, name) {
  const control = name === 'unified'
    ? page.locator('.gp-diff__mode[aria-pressed="true"]')
    : page.locator(`.gp-diff__mode[data-diff-mode="${name}"]`)
  await control.click()
  await page.waitForSelector(name === 'unified' ? '.gp-diff__unified' : name === 'split' ? '.gp-diff__side' : '.gp-diff__single')
  if (name !== 'unified') assert.equal(await control.getAttribute('aria-pressed'), 'true', `${name} is active`)
}

/** Compare actual theme colors, including the empty half of a split row. */
async function gutterBackgrounds(page, mode) {
  await page.mouse.move(0, 0)
  const rows = await page.evaluate((mode) => {
    const body = document.querySelector(mode === 'unified' ? '.gp-diff__unified' : mode === 'split' ? '.gp-diff__side' : '.gp-diff__single')
    return [...body.querySelectorAll('.gp-diff-cell:not(.gp-diff-row--hunk)')].map((code) => {
      const right = mode === 'unified' ? code.previousElementSibling.previousElementSibling : code.previousElementSibling
      const gutters = mode === 'unified' ? [right.previousElementSibling, right] : [right]
      return {
        text: code.textContent,
        kind: code.classList.contains('gp-diff-row--del') ? 'del' : code.classList.contains('gp-diff-row--add') ? 'add' : 'context',
        code: getComputedStyle(code).backgroundColor,
        gutters: gutters.map((g) => ({ text: g.textContent, background: getComputedStyle(g).backgroundColor })),
      }
    })
  }, mode)
  assert.ok(rows.length > 0, `${mode} has code rows to compare`)
  const neutralCode = rows[0].code
  const neutralGutter = rows[0].gutters[0].background
  const changes = rows.filter((row) => row.kind !== 'context')
  assert.equal(changes.length, mode === 'before' || mode === 'after' ? 0 : 7, `${mode} has the expected changed cells`)
  for (const row of rows) {
    if (row.kind === 'context') {
      assert.equal(row.code, neutralCode, `${mode}: context code stays neutral`)
      assert.ok(row.gutters.every((g) => g.background === neutralGutter), `${mode}: context and empty opposite gutters stay neutral`)
    } else {
      assert.notEqual(row.code, neutralCode, `${mode}: ${row.kind} has a real background tint`)
      assert.ok(row.gutters.every((g) => g.background === row.code), `${mode}: ${row.kind} gutter tint matches its code, including empty unified gutters`)
    }
  }
  if (mode === 'split') {
    assert.equal(rows.filter((row) => row.text === '').length, 1, 'split includes the empty old half opposite the fourth addition')
  }
  return rows
}

const DARK = 'body{--dsw-alias-bg-base:#111827;--dsw-alias-bg-layer-1:#111827;--dsw-alias-bg-layer-2:#1f2937;--dsw-alias-label-primary:#e5e7eb;--dsw-alias-label-tertiary:#9ca3af;--dsw-alias-state-business-primary:#60a5fa;--dsw-alias-state-success-primary:#4ade80;--dsw-alias-state-error-primary:#f87171}'

async function layerReferences(page) {
  return page.evaluate(() => {
    const probe = document.createElement('span')
    document.body.appendChild(probe)
    const color = (variable, share) => {
      probe.style.backgroundColor = `color-mix(in srgb,var(${variable}) ${share}%,transparent)`
      return getComputedStyle(probe).backgroundColor
    }
    const image = (share) => {
      const mix = `color-mix(in srgb,var(--dsw-alias-state-business-primary) ${share}%,transparent)`
      probe.style.backgroundImage = `linear-gradient(${mix},${mix})`
      return getComputedStyle(probe).backgroundImage
    }
    probe.style.color = 'var(--dsw-alias-state-business-primary)'
    const business = getComputedStyle(probe).color
    const result = { business, color: business, del: color('--dsw-alias-state-error-primary', 15), add: color('--dsw-alias-state-success-primary', 15), hover: image(12), selected: image(20), codeSelected: image(14) }
    probe.remove()
    return result
  })
}

const gutterState = (page, selector) => page.locator(selector).evaluate((g) => {
  let code = g.nextElementSibling
  while (!code.classList.contains('gp-diff-cell')) code = code.nextElementSibling
  const style = getComputedStyle(g)
  const codeStyle = getComputedStyle(code)
  return { base: style.backgroundColor, image: style.backgroundImage, codeBase: codeStyle.backgroundColor, codeImage: codeStyle.backgroundImage, badge: getComputedStyle(g, '::after').content, hovered: g.matches(':hover'), focused: g === document.activeElement && g.matches(':focus-visible'), outline: style.outlineStyle, width: parseFloat(style.outlineWidth), color: style.outlineColor }
})

async function dynamicLayers(page, layers, capture = false) {
  for (const mode of ['unified', 'split']) {
    if (mode === 'split') await switchMode(page, mode)
    for (const side of ['L', 'R']) {
      const target = page.locator(gutter(side, 4))
      const base = side === 'L' ? layers.del : layers.add
      await page.mouse.move(0, 0)
      const rest = await gutterState(page, gutter(side, 4))
      assert.equal(rest.base, base, `${mode}/${side}: gutter starts with the theme's 15% add/del base`)
      assert.equal(rest.image, 'none', `${mode}/${side}: idle gutter has no business overlay`)
      await target.hover()
      const hover = await gutterState(page, gutter(side, 4))
      assert.equal(hover.hovered, true, 'the pointer really hovers the gutter')
      assert.equal(hover.base, base, `${mode}/${side}: hover preserves the 15% add/del backgroundColor`)
      assert.equal(hover.image, layers.hover, `${mode}/${side}: hover paints the business 12% backgroundImage`)
      assert.notEqual(hover.image, 'none')
      assert.equal(hover.codeBase, base, 'hover keeps the neighboring code base')
      assert.equal(hover.badge, '"+"', 'hover still displays the comment badge')
      await target.click()
      await page.mouse.move(0, 0)
      const selected = await gutterState(page, gutter(side, 4))
      assert.equal(selected.base, base, `${mode}/${side}: selection preserves the 15% gutter base`)
      assert.equal(selected.image, layers.selected, 'selection adds a business 20% gutter image')
      assert.equal(selected.codeBase, base, 'selection preserves the 15% code base')
      assert.equal(selected.codeImage, layers.codeSelected, 'selection adds a business 14% code image')
      assert.notEqual(selected.image, 'none')
      assert.notEqual(selected.codeImage, 'none')
      await target.hover()
      const selectedHover = await gutterState(page, gutter(side, 4))
      assert.equal(selectedHover.hovered, true)
      assert.equal(selectedHover.base, base, 'selected + hovered gutter retains the add/del base')
      assert.equal(selectedHover.image, layers.selected, 'selected + hover keeps 20%, never downgrades to the 12% hover image')
      assert.equal(selectedHover.codeBase, base)
      assert.equal(selectedHover.codeImage, layers.codeSelected)
      assert.equal(selectedHover.badge, '"+"')
      if (capture && mode === 'unified' && side === 'R' && process.env.E2E_DIFF_BLOCK_SCREENSHOT === '1') {
        const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/local/issue156-layers-after.png')
        await mkdir(dirname(path), { recursive: true })
        await page.locator('.gp-panel').screenshot({ path })
      }
      await page.locator(gutter(side, 5)).focus()
      await page.keyboard.press('ArrowUp')
      const focus = await gutterState(page, gutter(side, 4))
      assert.equal(focus.focused, true, 'keyboard focus-visible survives selection and hover')
      assert.ok(focus.width > 0 && focus.outline !== 'none', 'the keyboard outline is visible')
      assert.equal(focus.color, layers.business)
      await page.locator('.gp-review__input').press('Escape')
      await page.mouse.move(0, 0)
      const cleared = await gutterState(page, gutter(side, 4))
      assert.equal(cleared.base, base)
      assert.equal(cleared.image, 'none', 'clearing selection removes its gutter overlay')
      assert.equal(cleared.codeImage, 'none', 'clearing selection removes its code overlay')
    }
  }
  await switchMode(page, 'unified')
}

async function classStrings(page) {
  const classes = await page.locator('.gp-diff-no, .gp-diff-cell, .gp-diff-uni__sign').evaluateAll((els) => els.map((el) => el.getAttribute('class')))
  assert.ok(classes.length > 0, 'there are rendered diff class strings to check')
  for (const value of classes) {
    assert.equal(value, value.trim(), 'diff classes have no leading or trailing spaces')
    assert.ok(!/\s{2,}/.test(value), 'diff classes have no consecutive whitespace')
  }
}

async function selectedBackgrounds(page, blue, baseline) {
  await page.mouse.move(0, 0)
  const selected = await page.locator('.gp-diff-no--sel').evaluateAll((gutters) => gutters.map((g) => {
    let code = g.nextElementSibling
    while (!code.classList.contains('gp-diff-cell')) code = code.nextElementSibling
    return { background: getComputedStyle(g).backgroundColor, image: getComputedStyle(g).backgroundImage, color: getComputedStyle(g).color, text: code.textContent, code: getComputedStyle(code).backgroundColor, codeImage: getComputedStyle(code).backgroundImage }
  }))
  assert.ok(selected.length > 0, 'selected gutters are mounted')
  for (const row of selected) {
    const base = baseline.find((b) => b.text === row.text).code
    assert.equal(row.background, base, 'selected gutter retains its original add/del backgroundColor')
    assert.equal(row.image, blue.selected, 'comment selection adds the business 20% gutter layer')
    assert.equal(row.color, blue.color, 'selected numbers use the business color')
    assert.equal(row.code, base, 'selected code retains its original add/del backgroundColor')
    assert.equal(row.codeImage, blue.codeSelected, 'selected code keeps its business 14% layer')
  }
}

/** The caller owns the browser; this scenario closes only its own pages. */
export async function run(mount) {
  const page = await mount({ composer: true, forge: false, diff: { text: TEXT, newLines: 6 } })
  try {
    await page.waitForSelector('.gp-diff__unified .gp-diff-uni__code')
    const rows = await page.locator('.gp-diff-uni__code').evaluateAll((cells) => cells.map((cell) => {
      const right = cell.previousElementSibling.previousElementSibling
      const left = right.previousElementSibling
      return {
        text: cell.textContent,
        left: left.textContent === '' ? null : Number(left.textContent),
        right: right.textContent === '' ? null : Number(right.textContent),
        kind: cell.classList.contains('gp-diff-row--del') ? 'del' : cell.classList.contains('gp-diff-row--add') ? 'add' : 'context',
        words: [...cell.querySelectorAll('.gp-diff-word')].map((el) => el.textContent),
      }
    }))
    assert.deepEqual(rows, [
      { text: 'context-before', left: 1, right: 1, kind: 'context', words: [] },
      ...OLD.map((text, i) => ({ text, left: i + 2, right: null, kind: 'del', words: i === 2 ? ['1'] : [] })),
      ...NEW.map((text, i) => ({ text, left: null, right: i + 2, kind: 'add', words: i === 2 ? ['2'] : [] })),
      { text: 'context-after', left: 5, right: 6, kind: 'context', words: [] },
    ], 'unified emits all deletions before all additions, with original numbers and only the token edit emphasized')

    const baseline = await gutterBackgrounds(page, 'unified')
    const blue = await layerReferences(page)
    // Dynamic layers run before class formatting so the old fixture fails on
    // the actual hover regression, not merely on incidental class whitespace.
    await dynamicLayers(page, blue, true)
    await classStrings(page)
    for (const name of ['split', 'before', 'after']) {
      await switchMode(page, name)
      await gutterBackgrounds(page, name)
      await classStrings(page)
    }
    await switchMode(page, 'unified')

    const mode = (name) => switchMode(page, name)
    const selected = () => page.locator('.gp-diff-no--sel').evaluateAll((els) => els.map((el) => `${el.dataset.side}${el.dataset.line}`))
    const numbers = () => page.locator('.gp-diff-no--pick').evaluateAll((els) => els.map((el) => `${el.dataset.side}${el.dataset.line}`))
    const words = () => page.locator('.gp-diff-word').allTextContents()
    const pick = async (side, end, body) => {
      await page.locator(gutter(side, 2)).click()
      await page.locator(gutter(side, end)).click({ modifiers: ['Shift'] })
      assert.match(await page.locator('.gp-review__title').innerText(), new RegExp(`${side}2\u2013${end}$`))
      await page.locator('.gp-review__input').fill(body)
    }
    const add = () => page.locator('.gp-review__actions .gp-btn--primary').click()

    await pick('L', 4, 'Old replacement block.')
    assert.deepEqual(await selected(), ['L2', 'L3', 'L4'])
    await selectedBackgrounds(page, blue, baseline)
    await page.locator(gutter('L', 2)).focus()
    await page.keyboard.press('ArrowDown')
    const focus = await page.locator(gutter('L', 3)).evaluate((g) => {
      const style = getComputedStyle(g)
      return { visible: g === document.activeElement && g.matches(':focus-visible'), width: parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor }
    })
    assert.equal(focus.visible, true, 'keyboard focus remains visible on a selected colored gutter')
    assert.ok(focus.width > 0 && focus.style !== 'none', 'the focused gutter has a real outline')
    assert.equal(focus.color, blue.business, 'the outline uses the current business color')
    await mode('split')
    assert.deepEqual(await selected(), ['L2', 'L3', 'L4'], 'split preserves the old-side range')
    await selectedBackgrounds(page, blue, baseline)
    assert.deepEqual(await words(), ['1', '2'], 'split applies the same word-emphasis policy')
    assert.equal(await page.locator('.gp-review__input').inputValue(), 'Old replacement block.')
    await mode('unified')
    assert.deepEqual(await selected(), ['L2', 'L3', 'L4'], 'the range maps back onto the deletion block')
    await add()
    // Context is three raw patch lines per side, not the reordered display rows.
    const oldSnippet = ['@@ -1,4 +1,4 @@', ...BODY.slice(0, 7)].join('\n')
    assert.equal(await page.evaluate(() => window.__review.quotes[0].text),
      quote(1, 'L', 4, oldSnippet, 'Old replacement block.'), 'old-side quote retains its exact bounded patch')

    await pick('R', 5, 'New replacement block.')
    assert.deepEqual(await selected(), ['R2', 'R3', 'R4', 'R5'])
    await selectedBackgrounds(page, blue, baseline)
    await mode('after')
    assert.deepEqual(await numbers(), ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'], 'after keeps the complete new-side numbering')
    assert.deepEqual(await selected(), ['R2', 'R3', 'R4', 'R5'])
    await mode('before')
    assert.deepEqual(await numbers(), ['L1', 'L2', 'L3', 'L4', 'L5'], 'before keeps the complete old-side numbering')
    assert.deepEqual(await selected(), [], 'the old-side projection does not tint the new-side range')
    assert.equal(await page.locator('.gp-review__input').inputValue(), 'New replacement block.', 'mode switches keep the comment')
    assert.equal(await page.locator('.gp-review__stale').count(), 0, 'a mode switch is not a code change')
    await mode('unified')
    assert.deepEqual(await selected(), ['R2', 'R3', 'R4', 'R5'])
    await add()
    const newSnippet = ['@@ -2,4 +2,5 @@', ...BODY.slice(1)].join('\n')
    assert.equal(await page.evaluate(() => window.__review.quotes[1].text),
      quote(2, 'R', 5, newSnippet, 'New replacement block.'), 'new-side quote retains its exact bounded patch')

    // An active hit must follow each mode's cell keys/row indexes, rather than
    // retaining the unified index when it switches to split or a single side.
    await page.keyboard.press('Control+f')
    const find = page.locator('.gp-find__input')
    await find.fill('const count')
    const hit = async (count, text) => {
      await page.waitForFunction((expected) => document.querySelector('.gp-find__count')?.textContent === expected, count)
      assert.equal(await page.locator('.gp-find-hit').count(), Number(count.split('/')[1]), 'each visible matching cell is marked')
      assert.equal(await page.locator('.gp-find-hit--active').count(), 1)
      assert.equal(await page.locator('.gp-find-hit--active').evaluate((el) => el.closest('.gp-diff-cell').textContent), text, 'the active hit addresses the correct current-mode row')
    }
    await hit('1/2', OLD[2])
    await find.press('Enter')
    await hit('2/2', NEW[2])
    await mode('split')
    await hit('2/2', NEW[2])
    await mode('before')
    await hit('1/1', OLD[2])
    await mode('after')
    await hit('1/1', NEW[2])
    await mode('unified')
    await hit('2/2', NEW[2])
    await find.press('Escape')
    assert.equal(await page.locator('.gp-find').count(), 0)
    assert.deepEqual(await words(), ['1', '2'], 'closing Find restores token emphasis after the mode switches')
    await page.locator(gutter('R', 4)).click()
    await page.locator('.gp-review__input').fill('Token after switching.')
    assert.deepEqual(await selected(), ['R4'], 'the post-switch gutter still picks the displayed new token line')
    await add()
    const last = await page.evaluate(() => window.__review.quotes[2].text)
    assert.match(last, /\nSide: R\nLines: 4\n/)
    assert.ok(last.includes('-const count = 1;\n') && last.includes('+const count = 2;\n'), 'the post-switch comment quotes the original token edit')
    const dark = await mount({ composer: true, forge: false, diff: { text: TEXT, newLines: 6 } })
    try {
      await dark.addStyleTag({ content: DARK })
      await dynamicLayers(dark, await layerReferences(dark))
      await classStrings(dark)
      for (const name of ['before', 'after']) {
        await switchMode(dark, name)
        await gutterBackgrounds(dark, name)
        await classStrings(dark)
      }
    } finally {
      await dark.close()
    }
    // Plain, non-interactive numbers must be tinted too. Reuse the same small
    // fixture in a separate page and compare computed colors in both themes.
    const bare = await mount({ composer: false, forge: false, diff: { text: TEXT, newLines: 6 } })
    try {
      assert.equal(await bare.locator('.gp-diff-no--pick').count(), 0, 'the plain-number page has no comment controls')
      for (const theme of ['light', 'dark']) {
        if (theme === 'dark') await bare.addStyleTag({ content: DARK })
        await gutterBackgrounds(bare, 'unified')
        await classStrings(bare)
        for (const name of ['split', 'before', 'after']) {
          await switchMode(bare, name)
          await gutterBackgrounds(bare, name)
          await classStrings(bare)
        }
        await switchMode(bare, 'unified')
      }
    } finally {
      await bare.close()
    }
    console.log('diff-block-scenario: ok')
  } finally {
    await page.close()
  }
}
