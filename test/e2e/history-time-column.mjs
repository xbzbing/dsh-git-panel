/**
 * The history date track follows the active locale's labels.
 *
 * The commit grid's last track used to be a fixed 96px. Chinese and Japanese
 * labels are barely half that width, so the column carried a band of empty space
 * on the far right; Russian and Portuguese nearly filled it. The width is now
 * measured per locale (time-column.ts), and this runner checks the three things
 * only a browser can show: the shipped bundle derives the track from the real
 * font, a locale switch re-derives it in place, and the panel's font zoom scales
 * the text and the track together without re-breaking the fit.
 */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { TIME_COLUMN_MAX, TIME_COLUMN_MIN } from '../../lib/testkit.mjs'

const OUT = new URL('../../docs/local/history-time-column/e2e/', import.meta.url)
mkdirSync(OUT, { recursive: true })
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
  --dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f7f8fa;
  --dsw-alias-bg-layer-3:#fff;--dsw-alias-bg-module-platform:#e9eaec;
  --dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
  --dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-label-primary:#0f1115;
  --dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
  --dsw-alias-label-caption:#81858c;--dsw-alias-state-business-primary:#4176e6;
  --dsw-alias-state-error-primary:#ec1313;--dsw-alias-state-success-primary:#22c55e;
  --dsw-alias-state-warn-primary:#f59e0b;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
  #panel{border:0!important;box-sizing:border-box}`
// The widest label each locale can print: 59 minutes, 23 hours, four-digit days.
const EXPECTED = {
  zh: { widest: '9999 天前', oldest: /^9999 天前$/, youngest: '刚刚' },
  de: { widest: 'vor 9999 T.', oldest: /^vor 9999 T\.$/, youngest: 'gerade eben' },
  // The widest date column any shipped locale asks for; the squeezed case uses it
  // so the row has to give way even at the column's 150px floor.
  ru: { widest: '9999 дн. назад', oldest: /^9999 дн\. назад$/, youngest: 'только что' },
}
const browser = await chromium.launch()

async function boot({ width = 1400, height = 900, fontDelta = 0, locale = 'zh' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1480, height: 1050 } })
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(new URL('./harness.html', import.meta.url).href)
  await page.addStyleTag({ content: THEME })
  for (const file of ['client.js', 'mock-rpc.mjs']) {
    await page.addScriptTag({ path: fileURLToPath(new URL(file, import.meta.url)) })
  }
  await page.evaluate(({ width, height, fontDelta, locale }) => {
    const snap = {
      root: '/history-time-fixture', branch: 'main', head: '1111111', unborn: false, dirty: false,
      staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
      remote: { name: 'origin', webUrl: 'https://github.com/example/history', hostKind: 'github' },
      changes: [], refreshIntervalMs: 0, checkedAt: Date.now(), fontDelta,
      stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
    }
    const { connection } = window.createGitPanelMock(snap)
    const call = connection.rpc.call
    // Two rows, one per end of the relative-time range: the old one carries the
    // widest label the locale can print, the fresh one the shortest. Both merge
    // the next two commits, so the graph keeps several lanes open — a wide graph
    // is what used to push the date out of a narrow row, and a single-lane
    // fixture could not see it.
    const h = (i) => (i + 1).toString(16).padStart(40, '0').slice(0, 40)
    const commits = []
    for (let i = 0; i < 12; i++) {
      commits.push({
        hash: h(i), shortHash: h(i).slice(-7), subject: `merge #${i}`, author: 'Tester',
        dateIso: i === 0 ? new Date(Date.now() - 9999 * 86400000 - 3600000).toISOString() : new Date(Date.now() - 5000).toISOString(),
        parents: i < 10 ? [h(i + 1), h(i + 2)] : [], refs: [],
      })
    }
    connection.rpc.call = async (channel, endpoint, payload) => {
      const query = payload?.args?.request?.query
      if (endpoint === 'dbGitPanel/query' && query?.kind === 'history') {
        return { ok: true, value: { ok: true, value: { kind: 'history', commits, total: commits.length, pathSearchSupported: true } } }
      }
      return call(channel, endpoint, payload)
    }
    const registered = {}
    const dictionaries = {}
    // `locale.bind` is one stable function that reads the active language when
    // it is called, exactly like the platform's: switching the id below and
    // re-rendering is what a language switch does to a mounted panel.
    let active = locale
    const services = { connection }
    const ctx = {
      get: (name) => services[name],
      effect: (callback) => callback(), on: () => () => {}, inject: (_deps, callback) => callback(ctx),
      slots: {
        inject: (_name, provider) => provider(),
        register: (reg, component) => { registered[reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`] = component; return () => {} },
      },
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict; return () => {} },
        bind: (ns) => (key, params) => {
          const text = dictionaries[ns]?.[active]?.[key] ?? dictionaries[ns]?.en?.[key] ?? key
          return params === undefined ? text : text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
        },
      },
    }
    window.__getLoaded().apply(ctx)
    let root = null
    let component = null
    const render = () => root.render(component({ sessionId: 'history-time' }))
    window.historyTime = {
      registered,
      mount: () => {
        component = registered['conversation.view']
        if (!component) throw new Error('missing conversation.view panel registration')
        root = window.ReactDOM.createRoot(document.getElementById('panel'))
        render()
      },
      setLocale: (id) => { active = id; render() },
      frames: async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => requestAnimationFrame(resolve)) },
      // Everything a track assertion needs, in one round trip. Canvas-free on
      // purpose: the text width comes from the rendered glyphs (a Range over
      // the cell), so the runner compares the track against what the browser
      // actually drew, not against the measurement that sized it.
      measure: () => {
        const rootEl = document.querySelector('.gp-panel')
        const list = document.querySelector('.gp-history__list')
        const zoom = Number(getComputedStyle(rootEl).zoom) || 1
        const rows = [...document.querySelectorAll('.gp-history__list .gp-commit-row')]
        const cells = rows.flatMap((row) => [...row.querySelectorAll('.gp-commit-date')].map((cell) => {
          const range = document.createRange()
          range.selectNodeContents(cell)
          return { row, cell, textWidth: range.getBoundingClientRect().width / zoom }
        }))
        const widest = cells.reduce((a, b) => (b.textWidth > a.textWidth ? b : a))
        const tracks = getComputedStyle(widest.row).gridTemplateColumns.split(' ').map(Number.parseFloat)
        const rowBox = widest.row.getBoundingClientRect()
        return {
          labels: cells.map((c) => c.cell.textContent),
          tracks,
          track: tracks.at(-1),
          zoom,
          textWidth: widest.textWidth,
          slack: tracks.at(-1) - widest.textWidth,
          rowWidth: rowBox.width / zoom,
          // scrollWidth is layout px (unzoomed), so this comparison is zoom-free.
          overflows: cells.map((c) => c.cell.scrollWidth - c.cell.clientWidth),
          listOverflow: list.scrollWidth - list.clientWidth,
        }
      },
    }
    const panel = document.getElementById('panel')
    panel.style.width = `${width}px`
    panel.style.height = `${height}px`
  }, { width, height, fontDelta, locale })
  await page.waitForFunction(() => window.historyTime?.registered['conversation.view'] !== undefined)
  await page.evaluate(() => window.historyTime.mount())
  await page.waitForFunction((text) => [...document.querySelectorAll('.gp-history__list .gp-commit-date')].some((cell) => cell.textContent === text), EXPECTED[locale].widest)
  await page.evaluate(() => window.historyTime.frames())
  return { page, errors }
}

/** Assert the column hugs the widest label the locale prints. */
function checkFit(measure, locale, note) {
  const expected = EXPECTED[locale]
  assert.ok(measure.labels.includes(expected.widest), `${note}: the widest label is on screen (${JSON.stringify(measure.labels)})`)
  assert.equal(measure.tracks.length, 5, `${note}: the wide row is still the five-column grid`)
  assert.ok(measure.track >= TIME_COLUMN_MIN - 0.05 && measure.track <= TIME_COLUMN_MAX + 0.05,
    `${note}: track stays inside [${TIME_COLUMN_MIN}, ${TIME_COLUMN_MAX}] (${measure.track})`)
  // "Hugs" means the slack is the policy's own 4px padding, not a leftover half
  // column: a regression to 96px would put this in the 40s for Chinese.
  //
  // Above the floor the track is `ceil(text) + 4`, so the slack is 4–5px. At the
  // floor it is whatever the platform's font leaves: Linux's fallback renders
  // the same Chinese label at 44.7px instead of 53.3px, and the track stops at
  // its 56px minimum, so the slack grows instead of shrinking. Only the upper
  // bound is meaningful above the floor; at the floor the meaningful assertion
  // is that the text still fits.
  assert.ok(measure.slack >= 0, `${note}: the date fits its track (track ${measure.track}, text ${measure.textWidth})`)
  if (measure.track > TIME_COLUMN_MIN + 0.5) {
    assert.ok(measure.slack <= 4 + 3, `${note}: no dead band right of the date (track ${measure.track}, text ${measure.textWidth})`)
  }
  assert.ok(measure.overflows.every((gap) => gap <= 0), `${note}: every date cell fits its track (${JSON.stringify(measure.overflows)})`)
  assert.ok(measure.listOverflow <= 0, `${note}: the history list gains no horizontal scrollbar (${measure.listOverflow})`)
  // Only the last track moved: the hash and author columns keep their widths.
  assert.ok(Math.abs(measure.tracks[2] - 72) < 0.05 && Math.abs(measure.tracks[3] - 120) < 0.05,
    `${note}: hash/author tracks are unchanged (${measure.tracks.slice(2)})`)
}

async function localeSwitch() {
  const { page, errors } = await boot({ locale: 'zh' })
  try {
    const zh = await page.evaluate(() => window.historyTime.measure())
    checkFit(zh, 'zh', 'zh')
    assert.equal(zh.labels[0], EXPECTED.zh.widest)
    assert.ok(zh.labels.slice(1).every((label) => label === EXPECTED.zh.youngest), `zh: the rest are the shortest label (${JSON.stringify(zh.labels)})`)
    assert.ok(zh.track < TIME_COLUMN_MAX, `zh: the fixed 96px band is gone (${zh.track})`)
    await page.locator('.gp-history').screenshot({ path: fileURLToPath(new URL('zh.png', OUT)) })

    await page.evaluate(() => window.historyTime.setLocale('de'))
    await page.waitForFunction((text) => [...document.querySelectorAll('.gp-history__list .gp-commit-date')].some((cell) => cell.textContent === text), EXPECTED.de.widest)
    await page.evaluate(() => window.historyTime.frames())
    const de = await page.evaluate(() => window.historyTime.measure())
    checkFit(de, 'de', 'de')
    assert.equal(de.labels[0], EXPECTED.de.widest)
    assert.ok(de.labels.slice(1).every((label) => label === EXPECTED.de.youngest), 'de: labels re-render in place')
    // Both languages can land on the floor on a platform whose font measures
    // them narrow; the widening is only observable above it.
    assert.ok(de.track >= zh.track, `de: a longer locale never narrows the track (zh ${zh.track} → de ${de.track})`)
    if (zh.track > TIME_COLUMN_MIN + 0.5) {
      assert.ok(de.track > zh.track, `de: a longer locale widens the track (zh ${zh.track} → de ${de.track})`)
    }
    assert.ok(Math.abs(de.rowWidth - zh.rowWidth) < 0.5, `locale switch keeps the row width: the subject track yields (${zh.rowWidth} → ${de.rowWidth})`)
    await page.locator('.gp-history').screenshot({ path: fileURLToPath(new URL('de.png', OUT)) })

    await page.evaluate(() => window.historyTime.setLocale('zh'))
    await page.waitForFunction((text) => [...document.querySelectorAll('.gp-history__list .gp-commit-date')].some((cell) => cell.textContent === text), EXPECTED.zh.widest)
    await page.evaluate(() => window.historyTime.frames())
    const back = await page.evaluate(() => window.historyTime.measure())
    checkFit(back, 'zh', 'zh again')
    assert.ok(Math.abs(back.track - zh.track) < 0.05, `switching back restores the zh track exactly (${zh.track} → ${back.track})`)
    assert.deepEqual(errors, [], 'locale switch fixture has no frontend errors')
    console.log('history time column locale switch: PASS', JSON.stringify({ zh: zh.track, de: de.track }))
  } finally {
    await page.close()
  }
}

async function fontZoom() {
  // The canvas measures unzoomed CSS px, so the track must not change with the
  // font step; the panel's zoom scales text and track together. A DOM-based
  // measurement would return zoomed pixels here and shrink the track by 8%,
  // clipping the label.
  const { page, errors } = await boot({ locale: 'zh', fontDelta: 1 })
  try {
    const measure = await page.evaluate(() => window.historyTime.measure())
    checkFit(measure, 'zh', 'zh @ A+')
    assert.ok(Math.abs(measure.zoom - 1.08) < 0.001, `A+ applies the 1.08 zoom (${measure.zoom})`)
    assert.ok(measure.slack >= 0, `A+: zoomed text still fits the unzoomed track (track ${measure.track}, text ${measure.textWidth})`)
    await page.locator('.gp-history').screenshot({ path: fileURLToPath(new URL('zh-zoom.png', OUT)) })
    assert.deepEqual(errors, [], 'font zoom fixture has no frontend errors')
    console.log('history time column font zoom: PASS', JSON.stringify({ track: measure.track, zoom: measure.zoom }))
  } finally {
    await page.close()
  }
}

/**
 * A squeezed history column used to overflow its own row: the date track stuck
 * out past the right edge, outside the selection fill, and the list could scroll
 * sideways — which slid the fill away from the rows. The five columns are now
 * chosen from the list's measured width (commit-columns.ts), so the date stays
 * inside the row at every width the panel can produce.
 */
async function squeezed() {
  // 700 / 660 / 621 all bottom out at the column's 150px floor (the side columns
  // and their resizers take the rest), which is where a wide graph used to push
  // the date out of the row.
  const widths = [1000, 900, 820, 760, 700, 660, 621]
  const { page, errors } = await boot({ locale: 'ru', width: widths[0] })
  try {
    await page.locator('.gp-history__list .gp-commit-row').first().click()
    let previous = null
    for (const width of widths) {
      await page.evaluate((width) => { document.getElementById('panel').style.width = `${width}px` }, width)
      await page.evaluate(() => window.historyTime.frames())
      const m = await page.evaluate(() => {
        const list = document.querySelector('.gp-history__list')
        const row = document.querySelector('.gp-history__list .gp-commit-row')
        const band = document.querySelector('.gp-history__list > .gp-rowslider')
        const date = row.querySelector('.gp-commit-date')
        const right = (el) => el.getBoundingClientRect().right
        return {
          listClient: list.clientWidth,
          listScroll: list.scrollWidth,
          scrollLeft: list.scrollLeft,
          rowRight: right(row),
          listRight: right(list),
          bandRight: right(band),
          dateRight: right(date),
          tracks: getComputedStyle(row).gridTemplateColumns.split(' ').length,
          hash: row.querySelector('.gp-commit-hash') !== null,
          author: row.querySelector('.gp-commit-author') !== null,
          dateText: date.textContent,
        }
      })
      const label = `${width}px`
      assert.ok(m.listScroll <= m.listClient + 1, `${label}: the row never overflows the list (${m.listScroll} > ${m.listClient})`)
      assert.equal(m.scrollLeft, 0, `${label}: the list is not scrolled sideways`)
      assert.ok(m.dateRight <= m.rowRight + 0.5, `${label}: the date stays inside the row (${m.dateRight} > ${m.rowRight})`)
      assert.ok(m.dateRight <= m.listRight + 0.5, `${label}: the date stays inside the list`)
      assert.ok(Math.abs(m.bandRight - m.listRight) < 1, `${label}: the selection fill covers the whole list width (${m.bandRight} vs ${m.listRight})`)
      assert.ok(m.tracks >= 3, `${label}: graph, subject and date survive every tier (${m.tracks} tracks)`)
      assert.match(m.dateText, /назад$/, `${label}: the date column is still the date`)
      if (width <= 820) assert.equal(m.hash, false, `${label}: the hash is dropped before the date leaves the row`)
      if (width <= 900) assert.equal(m.author, false, `${label}: the author is dropped first`)
      // Columns only ever come back as the list grows: a narrower list may not
      // show more of them than a wider one (the widths above descend).
      if (previous !== null) assert.ok(m.tracks <= previous, `${label}: narrowing never adds a column (${previous} → ${m.tracks})`)
      previous = m.tracks
    }
    await page.locator('.gp-history').screenshot({ path: fileURLToPath(new URL('squeezed.png', OUT)) })
    assert.deepEqual(errors, [], 'squeezed fixture has no frontend errors')
    console.log('history time column squeezed columns: PASS')
  } finally {
    await page.close()
  }
}

try {
  await localeSwitch()
  await fontZoom()
  await squeezed()
} finally {
  await browser.close()
}
