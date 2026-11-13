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
    const value = { showInputPill: true, placement: 'all', codeWorkspace: 'off' }
    const settings = { view: { namespaces: [{ ns: 'dbGitPanel', schema: { dict: { showInputPill: {}, placement: {} } }, value }] }, status: 'ready' }
    const configForms = {
      describe: () => ({ getSnapshot: () => settings, subscribe: () => () => {}, ensure: async () => {} }),
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value, revision: 0, writable: true }),
        subscribe: () => () => {},
        set: async (field, next) => {
          window.__cfgWrites = [...(window.__cfgWrites ?? []), [field, next]]
          // The mirror reports what was written, as the host's does after a
          // write round-trip; a form that never sees its own value cannot be
          // told apart from one that dropped it.
          value[field] = next
          return true
        },
      }),
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
  assert.deepEqual(m.map((s) => s.fieldCount), [3, 5, 6, 5], 'field groups per section (repositories gained the workspace-file and list-ceiling rows)')

  // The package-folding row is a real setting, not just a count. This harness
  // binds the locale to the raw key on purpose (the CSS assertions below must
  // not depend on translations), so the check pins the *keys and their
  // section* — a wrong or shared key would surface here, and the eight
  // dictionaries that spell these keys are covered by the locale unit test.
  const packagesRow = await page.evaluate(() => {
    const body = document.getElementById('gp-cfg-sec-view')
    const row = [...body.querySelectorAll('.gp-cfg__row')]
      .find((r) => r.querySelector('.gp-cfg__text')?.textContent?.trim() === 'cfg.packagesToggle')
    if (row === undefined) return null
    const field = row.closest('.gp-cfg__field')
    return {
      label: (row.querySelector('.gp-cfg__text')?.textContent ?? '').trim(),
      checked: row.querySelector('input[role="switch"]').checked,
      hint: (field?.querySelector('.gp-cfg__hint')?.textContent ?? '').trim(),
      title: (field?.querySelector('.gp-cfg__title')?.textContent ?? '').trim(),
    }
  })
  assert.notEqual(packagesRow, null, 'the view section offers the package-folding switch under its own key')
  assert.equal(packagesRow.hint, 'cfg.packagesHint', 'the row carries its own hint key, not a reused one')
  assert.equal(packagesRow.checked, true, 'package folding is on by default')
  assert.equal(packagesRow.title, '', 'the row has no field title of its own, like the other switches')

  // The list ceiling is a real numeric row, seeded from the host default and
  // clamped at the shared bounds before the write: the host enforces the same
  // range, so the form must not hand it 500.
  const repoLimitBoot = await page.evaluate(() => {
    const input = document.getElementById('gp-cfg-repolimit')
    const field = input?.closest('.gp-cfg__field')
    if (input === null || field === null) return null
    return {
      value: input.value,
      min: input.min,
      max: input.max,
      label: (field.querySelector('.gp-cfg__numlabel')?.textContent ?? '').trim(),
      unit: (field.querySelector('.gp-cfg__numunit')?.textContent ?? '').trim(),
      hint: (field.querySelector('.gp-cfg__rangehint')?.textContent ?? '').trim(),
    }
  })
  assert.deepEqual(repoLimitBoot, {
    value: '50', min: '10', max: '100',
    label: 'cfg.repoLimitLabel', unit: 'cfg.repoLimitUnit', hint: 'cfg.repoLimitHint',
  }, 'the repositories section carries the list ceiling under its own keys')
  await page.fill('#gp-cfg-repolimit', '500')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(150)
  const repoLimitWrite = await page.evaluate(() => ({
    value: document.getElementById('gp-cfg-repolimit').value,
    wrote: (window.__cfgWrites ?? []).filter(([name]) => name === 'repoLimit').at(-1)?.[1] ?? null,
  }))
  assert.deepEqual(repoLimitWrite, { value: '100', wrote: 100 }, 'an over-range count is clamped to the host ceiling before the write')
  assert.equal(new Set(m.map((s) => s.ruleColor)).size, 4, `each section tints its rule: ${m.map((s) => s.ruleColor).join(' | ')}`)

  // Collapse again: the body hides and the rule goes with it.
  await page.click('.gp-cfg__section-hd[aria-controls="gp-cfg-sec-view"]')
  const viewHidden = await page.evaluate(() => {
    const body = document.getElementById('gp-cfg-sec-view')
    return { hidden: body.hidden, display: getComputedStyle(body).display }
  })
  assert.deepEqual(viewHidden, { hidden: true, display: 'none' }, 'a collapsed body takes no space')

  // The workspace control (issue #125): three states in one row, and the third
  // state owns a name box. A malformed name is refused before it can reach the
  // config — a host-side `invalid` state is a fallback, not the first line.
  const cwBoot = await page.evaluate(() => {
    const title = [...document.querySelectorAll('.gp-cfg__title')].find((el) => el.textContent === 'cfg.cwTitle')
    const field = title?.closest('.gp-cfg__field')
    if (!field) return null
    return {
      title: title.textContent,
      buttons: [...field.querySelectorAll('.gp-seg__btn')].map((el) => el.textContent),
      pressed: [...field.querySelectorAll('.gp-seg__btn')].map((el) => el.getAttribute('aria-pressed')),
      box: field.querySelector('.gp-cfg__textinput') !== null,
      hint: (field.querySelector('.gp-cfg__hint')?.textContent ?? '').trim(),
    }
  })
  assert.notEqual(cwBoot, null, 'the repositories section carries the workspace control')
  assert.deepEqual(cwBoot.buttons, ['cfg.cwOff', 'cfg.cwAuto', 'cfg.cwCustom'], 'one row, three states')
  assert.deepEqual(cwBoot.pressed, ['true', 'false', 'false'], 'off is the default state')
  assert.equal(cwBoot.box, false, 'no name box while a state that has no name is picked')
  assert.equal(cwBoot.hint, 'cfg.cwHint', 'the control carries its own hint')
  // Picking "specific file" is an editing state, not a written one: leaving it
  // with an empty box closes the box and falls back to the stored value, so the
  // control cannot sit on a selection the config does not contain.
  await page.evaluate(() => {
    const title = [...document.querySelectorAll('.gp-cfg__title')].find((el) => el.textContent === 'cfg.cwTitle')
    title.closest('.gp-cfg__field').querySelectorAll('.gp-seg__btn')[2].click()
  })
  await page.waitForSelector('.gp-cfg__textinput')
  // Blur is the commit point; the empty box means "no name", so nothing is
  // written and the control returns to the value the host has. Focus first —
  // an unfocused input never fires the blur that this path is about.
  await page.focus('.gp-cfg__textinput')
  await page.evaluate(() => { document.querySelector('.gp-cfg__textinput')?.blur() })
  await page.waitForTimeout(150)
  const abandoned = await page.evaluate(() => {
    const title = [...document.querySelectorAll('.gp-cfg__title')].find((el) => el.textContent === 'cfg.cwTitle')
    const field = title.closest('.gp-cfg__field')
    return {
      box: field.querySelector('.gp-cfg__textinput') !== null,
      pressed: [...field.querySelectorAll('.gp-seg__btn')].map((el) => el.getAttribute('aria-pressed')),
      writes: (window.__cfgWrites ?? []).filter(([name]) => name === 'codeWorkspace').length,
    }
  })
  assert.equal(abandoned.box, false, 'an empty name closes the box instead of pinning "specific file"')
  assert.deepEqual(abandoned.pressed, ['true', 'false', 'false'], 'and the control falls back to the stored value')
  assert.equal(abandoned.writes, 0, 'nothing was written for a name that was never given')


  await page.evaluate(() => {
    const title = [...document.querySelectorAll('.gp-cfg__title')].find((el) => el.textContent === 'cfg.cwTitle')
    title.closest('.gp-cfg__field').querySelectorAll('.gp-seg__btn')[2].click()
  })
  await page.waitForSelector('.gp-cfg__textinput')
  await page.fill('.gp-cfg__textinput', 'nope.json')
  await page.keyboard.press('Enter')
  const refused = await page.evaluate(() => {
    const title = [...document.querySelectorAll('.gp-cfg__title')].find((el) => el.textContent === 'cfg.cwTitle')
    const field = title.closest('.gp-cfg__field')
    return { err: field.querySelector('.gp-cfg__err')?.textContent ?? null, box: field.querySelector('.gp-cfg__textinput')?.value ?? null }
  })
  assert.equal(refused.err, 'cfg.cwNameInvalid', 'a name that is not a workspace file is refused')
  assert.equal(refused.box, 'nope.json', 'the text stays where the user typed it')

  await page.fill('.gp-cfg__textinput', 'hub.code-workspace')
  await page.keyboard.press('Enter')
  // The commit keeps the box mounted until the settings mirror carries the
  // name; give the write round-trip a tick before reading it back.
  await page.waitForTimeout(300)
  const accepted = await page.evaluate(() => {
    const title = [...document.querySelectorAll('.gp-cfg__title')].find((el) => el.textContent === 'cfg.cwTitle')
    const field = title.closest('.gp-cfg__field')
    return { err: field.querySelector('.gp-cfg__err')?.textContent ?? null, box: field.querySelector('.gp-cfg__textinput')?.value ?? null }
  })
  assert.equal(accepted.err, null, 'a shaped name clears the refusal')
  assert.equal(accepted.box, 'hub.code-workspace', 'the box keeps the committed name')

  assert.deepEqual(errors, [], 'no page errors')
  console.log('e2e/config-sections: all assertions passed')
} finally {
  await browser.close()
}
