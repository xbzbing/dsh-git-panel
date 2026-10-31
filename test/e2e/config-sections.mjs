/**
 * The plugin detail page's config form: four collapsible sections whose open
 * body reads as subordinate to its title.
 *
 * Locks the hierarchy: section titles outrank field titles (16px/600 over
 * 14px/500), every body child is one `.gp-cfg__field` (title / control / hint
 * grouped, 8px inside, 20px between fields), and an open body hangs off a 2px
 * guide rule centred under the section chip, tinted per section. Also locks the
 * collapse contract: only the basic section boots open, a header toggles its
 * body via `hidden`, and `aria-controls` always resolves.
 */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const E2E = dirname(fileURLToPath(import.meta.url))
const harness = 'file://' + resolve(E2E, 'harness.html')
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
  --dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;
  --dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;--dsw-alias-border-l3:#00000026;
  --dsw-alias-interactive-bg-hover:#2631480f;--dsw-alias-interactive-bg-hover-solid:#f1f3f5;
  --dsw-alias-label-primary:#0f1115;--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#81858c;
  --dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
  --dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
  #panel{border:0!important;width:480px!important;height:auto!important;padding:16px}`

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: '44638f7', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, suggestEnabled: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 560, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(harness)
  await page.addStyleTag({ content: THEME })
  await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
  await page.addScriptTag({ path: resolve(E2E, 'client.js') })

  await page.evaluate(async ({ snap }) => {
    const { connection } = window.createGitPanelMock(snap)
    const registered = {}
    const value = { showInputPill: true, placement: 'all' }
    const settings = { view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {}, placement: {} } }, value }] }, status: 'ready' }
    const configForms = {
      describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
      get: () => ({ getSnapshot: () => ({ status: 'ready', value, revision: 0, writable: true }), subscribe: () => () => {}, set: async () => true }),
    }
    const services = { connection, configForms, sidebarRightTabs: { register: () => () => {} }, sidebarRight: { openTab: () => {} } }
    const ctx = {
      get: (k) => services[k],
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: () => () => {},
      inject: (_d, cb) => cb(ctx),
      slots: {
        inject: (_n, p) => p(),
        register: (reg, component) => {
          const key = reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`
          registered[key] = component
          return () => { delete registered[key] }
        },
      },
      locale: { register: () => () => {}, bind: () => (key) => key },
    }
    window.__getLoaded().apply(ctx)
    await new Promise((r) => setTimeout(r, 300))
    const key = Object.keys(registered).find((k) => k.startsWith('plugins.bundle.config'))
    window.ReactDOM.createRoot(document.getElementById('panel')).render(registered[key]({ t: (k) => k }))
    await new Promise((r) => setTimeout(r, 600))
  }, { snap: SNAP })

  await page.waitForSelector('.gp-cfg__section')

  const boot = await page.evaluate(() => [...document.querySelectorAll('.gp-cfg__section-hd')].map((hd) => ({
    expanded: hd.getAttribute('aria-expanded'),
    resolves: document.getElementById(hd.getAttribute('aria-controls') ?? '') !== null,
    hidden: document.getElementById(hd.getAttribute('aria-controls') ?? '')?.hidden ?? null,
  })))
  assert.equal(boot.length, 4, 'four sections')
  assert.deepEqual(boot.map((s) => s.expanded), ['true', 'false', 'false', 'false'], 'only the basic section boots open')
  assert.ok(boot.every((s) => s.resolves), 'every aria-controls resolves while collapsed')
  assert.deepEqual(boot.map((s) => s.hidden), [false, true, true, true], 'collapsed bodies are hidden, not unmounted')

  // Open everything: the confusion this guards against shows in the open state.
  for (const hd of await page.$$('.gp-cfg__section-hd[aria-expanded="false"]')) await hd.click()

  const m = await page.evaluate(() => {
    const px = (v) => Number.parseFloat(v)
    const font = (el) => { const c = getComputedStyle(el); return { size: px(c.fontSize), weight: Number(c.fontWeight) } }
    return [...document.querySelectorAll('.gp-cfg__section')].map((sec) => {
      const hd = sec.querySelector('.gp-cfg__section-hd')
      const chip = sec.querySelector('.gp-cfg__section-ic').getBoundingClientRect()
      const body = sec.querySelector('.gp-cfg__section-body')
      const bc = getComputedStyle(body)
      const kids = [...body.children]
      const fields = kids.filter((k) => k.classList.contains('gp-cfg__field'))
      const bodyBox = body.getBoundingClientRect()
      const gaps = fields.slice(1).map((f, i) => f.getBoundingClientRect().top - fields[i].getBoundingClientRect().bottom)
      const title = sec.querySelector('.gp-cfg__title')
      return {
        expanded: hd.getAttribute('aria-expanded'),
        header: font(hd.querySelector('.gp-cfg__section-title')),
        fieldTitle: title === null ? null : font(title),
        allFields: kids.length > 0 && fields.length === kids.length,
        fieldCount: fields.length,
        fieldGap: getComputedStyle(fields[0]).rowGap,
        gaps,
        ruleWidth: px(bc.borderLeftWidth),
        ruleStyle: bc.borderLeftStyle,
        ruleColor: bc.borderLeftColor,
        // The rule's centre against the chip's centre.
        ruleOffset: (bodyBox.left + px(bc.borderLeftWidth) / 2) - (chip.left + chip.width / 2),
        // Field content starts right of the rule, not on the section title's column.
        indent: fields[0].getBoundingClientRect().left - bodyBox.left,
      }
    })
  })

  assert.ok(m.every((s) => s.expanded === 'true'), 'every header opens on click')
  for (const s of m) {
    assert.deepEqual(s.header, { size: 16, weight: 600 }, 'section titles are 16px/600')
    assert.ok(s.allFields, 'every body child is one field group')
    assert.equal(s.fieldGap, '8px', 'a field groups its title / control / hint 8px apart')
    assert.ok(s.gaps.every((g) => Math.abs(g - 20) < 0.5), `fields sit 20px apart: ${JSON.stringify(s.gaps)}`)
    assert.equal(s.ruleWidth, 2, 'the open body carries a 2px guide rule')
    assert.equal(s.ruleStyle, 'solid')
    assert.ok(Math.abs(s.ruleOffset) < 0.5, `the guide rule centres under the section chip: ${s.ruleOffset}`)
    assert.ok(s.indent >= 20, 'fields indent past the rule')
  }
  const titled = m.filter((s) => s.fieldTitle !== null)
  assert.ok(titled.length >= 2)
  for (const s of titled) assert.deepEqual(s.fieldTitle, { size: 14, weight: 500 }, 'field titles are 14px/500, below the section title')
  assert.deepEqual(m.map((s) => s.fieldCount), [2, 3, 6, 3], 'field groups per section')
  assert.equal(new Set(m.map((s) => s.ruleColor)).size, 4, `each section tints its rule: ${m.map((s) => s.ruleColor).join(' | ')}`)

  // Collapse again: the body hides and the rule goes with it.
  await page.click('.gp-cfg__section-hd[aria-controls="gp-cfg-sec-view"]')
  const viewHidden = await page.evaluate(() => {
    const body = document.getElementById('gp-cfg-sec-view')
    return { hidden: body.hidden, display: getComputedStyle(body).display }
  })
  assert.deepEqual(viewHidden, { hidden: true, display: 'none' }, 'a collapsed body takes no space')

  assert.deepEqual(errors, [], 'no page errors')
  console.log('e2e/config-sections: all assertions passed')
} finally {
  await browser.close()
}
