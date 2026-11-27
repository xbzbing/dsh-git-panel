import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildSuggestPrompt } from '../../lib/host/suggest-prompt.js'

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('suggest-prompt-config-scenario is merged into config-sections.mjs; run that runner')
  process.exit(1)
}

const DIR = dirname(fileURLToPath(import.meta.url))
const draft = '.gp-cfg__prompt-input'
const save = '.gp-cfg__prompt-save'
const defaultButton = '.gp-cfg__prompt-default'
const effectiveButton = '.gp-cfg__prompt-effective'
const modal = '.gp-cfg__prompt-modal'
const effectiveModal = '.gp-cfg__prompt-modal--effective'
const defaultModal = '.gp-cfg__prompt-modal--default'
const original = `${effectiveModal} .gp-cfg__prompt-original`

async function mount(browser, context, options = {}) {
  const page = await browser.newPage({ viewport: { width: 760, height: 1000 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(context.harness)
  await page.addStyleTag({ content: context.theme })
  await page.addScriptTag({ path: resolve(DIR, 'mock-rpc.mjs') })
  await page.evaluate(() => {
    MOD['@deepseek-ai/dsh-client-ui-primitives'].writeClipboard = async (text) => {
      window.__promptFixture.copies.push(text)
      return window.__promptFixture.copyOk
    }
  })
  await page.addScriptTag({ path: resolve(DIR, 'client.js') })
  await page.evaluate(({ snap, options }) => {
    const { connection } = window.createGitPanelMock(snap)
    const registered = {}
    const fixture = window.__promptFixture = {
      writes: [], queries: [], copies: [], copyOk: true, echo: options.echo ?? true,
      failSet: false, holdSet: false, holdView: null, releaseSet: null, releasePreview: null,
      answers: [], hostPrompt: Object.hasOwn(options, 'prompt') ? options.prompt : 'old rules', language: options.language ?? 'auto',
      aborted: 0, previewDelivered: 0, setReleased: false, hostDelayMs: options.hostDelayMs ?? 0,
      hostAcceptedAt: 0, hostPublishedAt: 0,
    }
    const baseCall = connection.rpc.call.bind(connection.rpc)
    const preview = (view) => {
      if (view === 'effective' && typeof fixture.hostPrompt !== 'string') return { ok: false, error: { code: 'suggest-prompt-invalid' } }
      const configuredPrompt = view === 'default' ? '' : fixture.hostPrompt.trim() === '' ? '' : fixture.hostPrompt
      return { ok: true, value: {
        kind: 'suggest-prompt', view, configuredPrompt, languageSetting: fixture.language,
        source: configuredPrompt === '' ? 'default' : 'custom',
        variants: options.realPrompts
          ? (configuredPrompt === '' ? options.realPrompts.defaults : options.realPrompts.custom)
          : {
            zh: { system: `中文系统指令\n<user-rules>${configuredPrompt}\n结束`, userReminder: '中文末尾提醒\n原文' },
            en: { system: `English system\n<user-rules>${configuredPrompt}\nEnd`, userReminder: 'English ending reminder\nOriginal' },
          },
      } }
    }
    connection.rpc.call = async (channel, endpoint, payload, signal) => {
      const request = payload?.args?.request
      if (endpoint !== 'dbGitPanel/query' || request?.query?.kind !== 'suggest-prompt') return baseCall(channel, endpoint, payload, signal)
      const view = request.query.view
      fixture.queries.push({ sessionId: request.sessionId, repo: request.repo, view, at: performance.now(), hostPrompt: fixture.hostPrompt, language: fixture.language })
      signal?.addEventListener('abort', () => { fixture.aborted++ }, { once: true })
      let answer = options.oldHost ? { ok: false, error: { code: 'unsupported-query' } } : preview(view)
      const mode = fixture.answers.shift()
      if (mode === 'fail') answer = { ok: false, error: { code: 'transport', message: 'fixture read failure' } }
      if (mode === 'config-invalid') answer = { ok: false, error: { code: 'suggest-prompt-invalid' } }
      if (mode === 'invalid') answer.value.variants.en.userReminder = 17
      if (fixture.holdView === view) {
        fixture.holdView = null
        // Intentionally ignore abort: a transport may deliver its old reply anyway.
        await new Promise((resolve) => { fixture.releasePreview = () => resolve() })
      }
      fixture.previewDelivered++
      return { ok: true, value: answer }
    }
    const allListeners = new Set()
    const makeForms = (value) => {
      const listeners = new Set()
      const dict = { showInputPill: {}, placement: {}, ...(options.supported === false ? {} : { suggestPrompt: {} }) }
      const schema = options.serialized ? { uid: 4, refs: { 1: { type: 'boolean' }, 2: { type: 'union' }, 3: { type: 'any' }, 4: { type: 'object', dict: { showInputPill: 1, placement: 2, ...(options.supported === false ? {} : { suggestPrompt: 3 }) } } } } : { dict }
      const settings = { status: 'ready', view: { namespaces: [{ ns: 'dbGitPanel', schema, value }] } }
      const mirror = {
        getSnapshot: () => settings,
        subscribe: (listener) => { allListeners.add(listener); return () => allListeners.delete(listener) },
        ensure: async () => {},
      }
      const face = {
        getSnapshot: () => ({ status: 'ready', value, revision: 0, writable: options.writable !== false }),
        subscribe: (listener) => { listeners.add(listener); allListeners.add(listener); return () => { listeners.delete(listener); allListeners.delete(listener) } },
        set: async (field, text) => {
          fixture.writes.push([field, text])
          if (fixture.failSet) { fixture.failSet = false; return false }
          if (fixture.holdSet) {
            fixture.holdSet = false
            const accepted = await new Promise((resolve) => { fixture.releaseSet = (ok) => { fixture.setReleased = true; resolve(ok) } })
            if (!accepted) return false
          }
          if (fixture.value === value) {
            fixture.hostAcceptedAt = performance.now()
            const publish = () => {
              if (fixture.value !== value) return
              fixture.hostPrompt = text
              fixture.hostPublishedAt = performance.now()
            }
            if (fixture.hostDelayMs > 0) setTimeout(publish, fixture.hostDelayMs)
            else publish()
            if (fixture.echo) { value[field] = text; fixture.notify() }
          }
          return true
        },
      }
      return { describe: () => mirror, get: () => face }
    }
    const value = {
      showInputPill: true, placement: 'all', suggestEnabled: options.aiEnabled !== false,
      suggestLanguage: fixture.language,
      ...(options.absent ? {} : { suggestPrompt: fixture.hostPrompt }),
    }
    fixture.value = value
    fixture.notify = () => { for (const listener of [...allListeners]) listener() }
    fixture.mirror = (text) => { fixture.value.suggestPrompt = text; fixture.notify() }
    fixture.external = (text, language = fixture.language) => {
      fixture.hostPrompt = text
      fixture.language = language
      fixture.value.suggestPrompt = text
      fixture.value.suggestLanguage = language
      fixture.notify()
    }
    let configForms = makeForms(value)
    const services = { connection, sidebarRightTabs: { register: () => () => {} }, sidebarRight: { openTab: () => {} } }
    const dictionaries = {}
    const translate = (key, parameters = {}) => {
      let text = options.translated ? dictionaries[options.locale ?? 'zh']?.[key] ?? key : key
      if (key === 'cfg.suggestPromptBytes' && !options.translated) text = '{bytes} B / {max} KiB (UTF-8)'
      for (const [name, value] of Object.entries(parameters)) text = text.replaceAll(`{${name}}`, String(value))
      return text
    }
    const ctx = {
      get: (key) => key === 'configForms' ? configForms : services[key],
      effect: (callback) => { callback() }, on: () => () => {}, inject: (_dependencies, callback) => callback(ctx),
      slots: {
        inject: (_name, provider) => provider(),
        register: (registration, component) => {
          const key = registration.key === undefined ? registration.name : `${registration.name}::${registration.key}`
          registered[key] = component
          return () => { delete registered[key] }
        },
      },
      locale: { register: (_namespace, values) => { Object.assign(dictionaries, values); return () => {} }, bind: () => translate },
    }
    fixture.replaceForm = (text) => {
      const next = { ...fixture.value, suggestPrompt: text }
      fixture.value = next
      fixture.hostPrompt = text
      configForms = makeForms(next)
      fixture.notify()
    }
    window.__getLoaded().apply(ctx)
    const key = Object.keys(registered).find((name) => name.startsWith('plugins.bundle.config'))
    window.__promptRoot = window.ReactDOM.createRoot(document.getElementById('panel'))
    window.__promptRoot.render(registered[key]({ t: (key) => key }))
  }, { snap: context.snap, options })
  await page.waitForSelector('.gp-cfg__section-hd')
  await page.click('.gp-cfg__section-hd[aria-controls="gp-cfg-sec-suggest"]')
  await page.waitForSelector(draft)
  return { page, errors }
}

async function checkOriginal(page, text, selector = original) {
  await page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent?.includes(text), { selector, text })
}

async function assertSingleModal(page, view = 'effective') {
  await page.waitForSelector(`.gp-cfg__prompt-modal--${view}`)
  assert.equal(await page.locator(modal).count(), 1, 'default and effective never stack dialogs')
  assert.equal(await page.locator('.gp-modal-backdrop').count(), 1, 'only one overlay shell is mounted')
  assert.equal(await page.locator(`${modal}[data-gp-overlay]`).count(), 1, 'the dialog declares its overlay lifecycle')
  assert.equal(await page.locator(`${modal}[role="dialog"][aria-modal="true"]`).count(), 1)
}

async function closePrompt(page, opener = effectiveButton) {
  await page.keyboard.press('Escape')
  await page.waitForFunction((selector) => document.querySelector(selector) === null, modal)
  assert.equal(await page.evaluate((selector) => document.activeElement === document.querySelector(selector), opener), true, 'closing restores focus to the enabled reader entry')
  assert.equal(await page.isDisabled(opener), false, 'the restore target stays enabled after saving')
}

// Give delivered RPC promises and React commits a paint checkpoint, not a timed sleep.
async function afterDelivery(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function releasePreview(page) {
  const before = await page.evaluate(() => window.__promptFixture.previewDelivered)
  await page.evaluate(() => window.__promptFixture.releasePreview())
  await page.waitForFunction((count) => window.__promptFixture.previewDelivered > count, before)
  await afterDelivery(page)
}

async function setPromptWidth(page, width) {
  await page.setViewportSize({ width, height: 1000 })
  await page.addStyleTag({ content: '#panel{box-sizing:border-box;width:100%!important;padding:12px!important}' })
  await afterDelivery(page)
}

async function assertPromptToolbar(page, width, { chinese = false, busy = false, wrapped = false } = {}) {
  const boxes = await page.evaluate(() => {
    const selectors = {
      prompt: '.gp-cfg__prompt', head: '.gp-cfg__prompt > .gp-cfg__prompt-head', defaults: '.gp-cfg__prompt-default',
      footer: '.gp-cfg__prompt-footer', actions: '.gp-cfg__prompt-actions', start: '.gp-cfg__prompt-actions-start',
      meta: '.gp-cfg__prompt-meta', bytes: '.gp-cfg__prompt-bytes',
      save: '.gp-cfg__prompt-save', clear: '.gp-cfg__prompt-clear', effective: '.gp-cfg__prompt-effective',
    }
    return Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const element = document.querySelector(selector)
      const rect = element.getBoundingClientRect()
      return [name, { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height, centerY: rect.top + rect.height / 2, scroll: element.scrollWidth, width: element.clientWidth }]
    }))
  })
  for (const [name, box] of Object.entries(boxes)) {
    assert.ok(box.scroll <= box.width + 1, `${width}px ${busy ? 'busy' : 'idle'} ${name} has no horizontal overflow: ${JSON.stringify(box)}`)
    assert.ok(box.left >= 0 && box.right <= width, `${width}px ${name} stays inside the viewport`)
  }
  assert.ok(Math.abs(boxes.effective.right - boxes.actions.right) <= 1, `${width}px final viewer aligns to the action row's right edge`)
  assert.ok(Math.abs(boxes.defaults.right - boxes.head.right) <= 1, `${width}px default viewer aligns to its heading's right edge`)
  assert.ok(boxes.meta.top >= boxes.actions.bottom, 'byte accounting and save status have their own line, not the button flex group')
  assert.ok(boxes.save.right <= boxes.clear.left, 'save and clear keep their field-action order')
  if (chinese && !busy) {
    assert.ok(Math.abs(boxes.save.centerY - boxes.clear.centerY) <= 1 && Math.abs(boxes.save.centerY - boxes.effective.centerY) <= 1, `${width}px Chinese idle save/clear/final viewer stay on the same row: ${JSON.stringify(boxes)}`)
    assert.ok(boxes.clear.right <= boxes.effective.left, `${width}px Chinese buttons do not overlap`)
  }
  if (wrapped) {
    assert.ok(boxes.effective.top >= boxes.start.bottom, `${width}px long-language trailing action wraps as a whole item`)
    // Compare like elements instead of a font-metric pixel floor: both buttons
    // share one line box, so a wrapped label would make the final viewer taller.
    assert.ok(Math.abs(boxes.effective.height - boxes.save.height) <= 1, `${width}px trailing action text stays on one line after whole-item wrapping: ${JSON.stringify({ effective: boxes.effective.height, save: boxes.save.height })}`)
  }
  assert.equal(await page.locator(`${save} svg[data-state="ongoing"]`).count(), busy ? 1 : 0, 'busy fixture includes the real-sized platform loading mark')
  return boxes
}

/** Isolated pages; no runtime profile, shared server, or extra model calls. */
export async function runPromptConfigScenario(browser, context) {
  const outputRoot = resolve(DIR, '../../test-results')
  await mkdir(outputRoot, { recursive: true })
  const screenshots = await mkdtemp(resolve(outputRoot, 'issue159-'))
  const focusRaces = []
  for (const view of ['default', 'effective']) {
    for (const focus of ['seg', 'copy']) {
      const race = await mount(browser, context)
      try {
        const text = `saved after ${view} ${focus}`
        await race.page.fill(draft, text)
        await race.page.evaluate(() => { window.__promptFixture.holdSet = true })
        await race.page.click(save)
        await race.page.waitForFunction(() => typeof window.__promptFixture.releaseSet === 'function')
        await race.page.click(view === 'default' ? defaultButton : effectiveButton)
        await assertSingleModal(race.page, view)
        const selector = view === 'default' ? defaultModal : effectiveModal
        await checkOriginal(race.page, view === 'default' ? '<user-rules>\n结束' : 'old rules', `${selector} .gp-cfg__prompt-original`)
        const shell = await race.page.locator(modal).elementHandle()
        if (focus === 'seg') {
          await race.page.locator(`${selector} .gp-seg__btn`).nth(1).click()
        } else {
          await race.page.locator(`${selector} .gp-cfg__prompt-text button`).first().click()
          await race.page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptCopied'), selector)
        }
        assert.equal(await race.page.evaluate((selector) => document.querySelector(selector)?.contains(document.activeElement), modal), true, 'held save leaves reader controls focusable')
        await race.page.evaluate(() => window.__promptFixture.releaseSet(true))
        await race.page.waitForFunction(() => window.__promptFixture.setReleased)
        await assertSingleModal(race.page, view)
        if (view === 'effective') await checkOriginal(race.page, text)
        else {
          const defaultText = await race.page.textContent(`${defaultModal} .gp-cfg__prompt-original`)
          assert.ok(defaultText.includes('<user-rules>'), 'the default reader keeps the built-in preview after a slow save')
          assert.equal(defaultText.includes(text), false, 'a save never repaints the default reader with saved rules')
        }
        await race.page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-meta')?.textContent.includes('cfg.suggestPromptSaved'))
        await afterDelivery(race.page)
        const focusInside = await race.page.evaluate((selector) => document.querySelector(selector)?.contains(document.activeElement), modal)
        const sameShell = await shell.evaluate((element) => element.isConnected)
        await race.page.keyboard.press('Escape')
        await race.page.waitForFunction((selector) => document.querySelector(selector) === null, modal)
        const restoreTarget = await race.page.evaluate(({ effective, fallback }) => document.activeElement === document.querySelector(effective) ? 'effective' : document.activeElement === document.querySelector(fallback) ? 'default' : 'other', { effective: effectiveButton, fallback: defaultButton })
        assert.equal(await race.page.isDisabled(view === 'default' ? defaultButton : effectiveButton), false)
        assert.deepEqual(race.errors, [])
        focusRaces.push({ view, focus, focusInside, sameShell, restoreTarget })
      } finally {
        await race.page.close()
      }
    }
  }
  assert.deepEqual(focusRaces, ['default', 'effective'].flatMap((view) => ['seg', 'copy'].map((focus) => ({ view, focus, focusInside: true, sameShell: true, restoreTarget: view }))), 'slow save completion stays inside the reader the user opened and restores its entry')

  // The settings mirror already acknowledges the write; host volatile config
  // remains old for 1.1s. Acknowledgment does not change the accepted identity.
  const propagation = await mount(browser, context, { hostDelayMs: 1100 })
  try {
    const text = 'saved before host propagation'
    await propagation.page.fill(draft, text)
    await propagation.page.click(save)
    await propagation.page.waitForFunction((text) => window.__promptFixture.value.suggestPrompt === text, text)
    await afterDelivery(propagation.page)
    assert.equal(await propagation.page.locator(modal).count(), 0, 'a successful save reports status without opening the final reader')
    await propagation.page.click(effectiveButton)
    await assertSingleModal(propagation.page)
    await checkOriginal(propagation.page, text)
    assert.equal(await propagation.page.inputValue(draft), text, 'accepted identity is already mirrored before host propagation')
    assert.equal(await propagation.page.locator('.gp-cfg__prompt-reload').count(), 0, 'mirror acknowledgment clears pending without a manual retry')
    const reads = await propagation.page.evaluate(() => ({ queries: window.__promptFixture.queries, accepted: window.__promptFixture.hostAcceptedAt, published: window.__promptFixture.hostPublishedAt }))
    assert.equal(reads.queries.length, 3, '1s-level propagation succeeds with initial read and only two extra reads')
    assert.deepEqual(reads.queries.map((query) => query.hostPrompt), ['old rules', 'old rules', text])
    assert.ok(reads.published - reads.accepted >= 1000, 'fake host does not publish the write within the old 900ms retry window')
    assert.ok(reads.queries[2].at - reads.queries[0].at >= 1000, 'last read is beyond the settings 1s follow-up pull')
    assert.equal(await propagation.page.locator(`${effectiveModal} .gp-cfg__prompt-error`).count(), 0, 'bounded reads succeed without pressing Retry')
    assert.equal(await propagation.page.evaluate(() => window.__promptFixture.writes.length), 1)
    await closePrompt(propagation.page)
    assert.deepEqual(propagation.errors, [])
  } finally {
    await propagation.page.close()
  }

  const { page, errors } = await mount(browser, context, { echo: false })
  try {
    assert.equal(await page.evaluate(() => window.__promptFixture.queries.length), 0, 'opening settings starts no prompt query')
    assert.equal(await page.locator('.gp-cfg__prompt-preview').count(), 0, 'final prompt has no inline body')
    await page.fill(draft, 'first line\nsecond line')
    await page.keyboard.press('Enter')
    const typed = await page.inputValue(draft)
    await page.locator(draft).blur()
    assert.equal(await page.evaluate(() => window.__promptFixture.writes.length), 0, 'Enter and blur never save')
    await page.evaluate(() => { window.__promptFixture.failSet = true })
    await page.click(save)
    await page.waitForSelector('.gp-cfg__prompt .gp-cfg__err')
    assert.equal(await page.inputValue(draft), typed, 'failed save retains the entire draft')
    assert.equal(await page.locator(modal).count(), 0, 'failed save never opens a preview')
    assert.equal(await page.evaluate(() => window.__promptFixture.queries.length), 0, 'failed save starts no preview read')
    await page.click(save)
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-meta')?.textContent.includes('cfg.suggestPromptSaved'))
    assert.equal(await page.locator(modal).count(), 0, 'a successful save reports status without opening a reader')
    await page.click(effectiveButton)
    await assertSingleModal(page)
    await checkOriginal(page, typed)
    assert.equal(await page.locator(`${effectiveModal} .gp-seg__btn`).count(), 2, 'the opened reader exposes both effective language variants')
    await page.locator(`${effectiveModal} .gp-seg__btn`).nth(1).click()
    await checkOriginal(page, 'English system')
    await page.locator(`${effectiveModal} .gp-seg__btn`).nth(0).click()
    assert.deepEqual(await page.evaluate(() => window.__promptFixture.writes), [['suggestPrompt', typed], ['suggestPrompt', typed]], 'each explicit save calls set exactly once')
    assert.equal(await page.inputValue(draft), typed, 'successful save does not flash back to the old mirror')
    assert.equal(await page.isDisabled(save), true, 'save is disabled after successful acceptance')
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate((selector) => document.querySelector(selector)?.contains(document.activeElement), modal), true, 'Tab remains inside the modal')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await page.evaluate((selector) => document.querySelector(selector)?.contains(document.activeElement), modal), true, 'Shift+Tab remains inside the modal')
    await closePrompt(page)
    const readsWhileClosed = await page.evaluate(() => window.__promptFixture.queries.length)
    await page.waitForSelector('.gp-cfg__prompt-reload')
    assert.equal(await page.inputValue(draft), typed, 'the saved text also survives the mirror propagation bound')
    assert.equal(await page.evaluate(() => window.__promptFixture.queries.length), readsWhileClosed, 'closed modal starts no propagation queries')
    await page.locator('.gp-cfg__prompt > .gp-cfg__prompt-error button').nth(1).click()
    await assertSingleModal(page)
    await page.waitForFunction((before) => window.__promptFixture.queries.length > before, readsWhileClosed)
    await checkOriginal(page, typed)
    await page.evaluate((text) => { window.__promptFixture.value.unrelated = true; window.__promptFixture.notify(); window.__promptFixture.mirror(text) }, typed)
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-reload') === null)
    await closePrompt(page)

    await page.click('.gp-cfg__prompt-clear')
    assert.equal(await page.inputValue(draft), '')
    assert.equal(await page.evaluate(() => window.__promptFixture.writes.length), 2, 'clearing changes only the local draft')
    await page.click(effectiveButton)
    await assertSingleModal(page)
    await checkOriginal(page, typed)
    assert.ok((await page.textContent(effectiveModal)).includes('cfg.suggestPromptDirty'), 'dirty viewing explicitly describes saved settings')
    await closePrompt(page)
    await page.click(save)
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-meta')?.textContent.includes('cfg.suggestPromptSaved'))
    assert.equal(await page.locator(modal).count(), 0, 'saving the cleared draft keeps the settings page free of overlays')
    await page.click(effectiveButton)
    await assertSingleModal(page)
    await checkOriginal(page, '<user-rules>\n结束')
    await closePrompt(page)
    await page.waitForSelector('.gp-cfg__prompt-reload')
    await page.evaluate(() => { window.__promptFixture.mirror(''); window.__promptFixture.echo = true })
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-reload') === null)
    await page.evaluate(() => window.__promptFixture.external('base'))
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-input')?.value === 'base')
    await page.fill(draft, 'local draft')
    await page.evaluate(() => { window.__promptFixture.value.unrelated = 2; window.__promptFixture.notify() })
    assert.equal(await page.inputValue(draft), 'local draft', 'unrelated mirror updates preserve dirty text')
    await page.evaluate(() => window.__promptFixture.external('other editor'))
    await page.waitForSelector('.gp-cfg__prompt-reload')
    assert.equal(await page.isDisabled(save), true, 'external edits block saving until explicitly handled')
    assert.equal(await page.inputValue(draft), 'local draft')
    await page.click('.gp-cfg__prompt-reload')
    assert.equal(await page.inputValue(draft), 'other editor')

    // A late, aborted read must not replace a newer configuration preview.
    await page.evaluate(() => { window.__promptFixture.holdView = 'effective'; window.__promptFixture.external('held old config') })
    await page.click(effectiveButton)
    await page.waitForFunction(() => typeof window.__promptFixture.releasePreview === 'function')
    await page.evaluate(() => window.__promptFixture.external('new config', 'en'))
    await checkOriginal(page, 'English system\n<user-rules>new config')
    await releasePreview(page)
    assert.equal((await page.textContent(original)).includes('held old config'), false, 'old preview cannot overwrite the new saved result')
    assert.ok(await page.evaluate(() => window.__promptFixture.aborted > 0), 'obsolete reads are aborted')
    await closePrompt(page)

    // A host still on the prior volatile config gets only two extra reads.
    await page.evaluate(() => { window.__promptFixture.hostPrompt = 'stale config' })
    const beforeReads = await page.evaluate(() => window.__promptFixture.queries.length)
    await page.click(effectiveButton)
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptPreviewSync'), effectiveModal)
    assert.equal((await page.evaluate(() => window.__promptFixture.queries.length)) - beforeReads, 3, 'initial read plus two bounded propagation retries')
    assert.equal((await page.textContent(effectiveModal)).includes('<user-rules>stale config'), false, 'mismatched config is never presented as the new result')
    const writesBeforeRetry = await page.evaluate(() => window.__promptFixture.writes.length)
    await page.evaluate(() => { window.__promptFixture.hostPrompt = 'new config' })
    await page.locator(`${effectiveModal} .gp-cfg__prompt-error button`).click()
    await checkOriginal(page, 'new config')
    assert.equal(await page.evaluate(() => window.__promptFixture.writes.length), writesBeforeRetry, 'retry only reads; it never saves again')
    await closePrompt(page)

    // Closing cancels even a transport which ignores abort and later delivers.
    await page.evaluate(() => { window.__promptFixture.holdView = 'effective'; window.__promptFixture.releasePreview = null })
    await page.click(effectiveButton)
    await page.waitForFunction(() => typeof window.__promptFixture.releasePreview === 'function')
    const abortedBefore = await page.evaluate(() => window.__promptFixture.aborted)
    await closePrompt(page)
    assert.ok(await page.evaluate((before) => window.__promptFixture.aborted > before, abortedBefore), 'closing aborts the pending read')
    const closedReads = await page.evaluate(() => window.__promptFixture.queries.length)
    await releasePreview(page)
    assert.equal(await page.locator(modal).count(), 0, 'late read after close cannot reopen a modal')
    assert.equal(await page.evaluate(() => window.__promptFixture.queries.length), closedReads, 'canceled reads never schedule retries')

    // Default reads are independent of a dirty custom draft and validate hidden variants.
    await page.fill(draft, 'unsaved custom')
    await page.evaluate(() => { window.__promptFixture.answers.push('invalid') })
    await page.click(defaultButton)
    await assertSingleModal(page, 'default')
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptPreviewInvalid'), defaultModal)
    await page.locator(`${defaultModal} .gp-cfg__prompt-error button`).click()
    await checkOriginal(page, 'English system', `${defaultModal} .gp-cfg__prompt-original`)
    assert.equal(await page.locator(`${defaultModal} .gp-seg__btn[aria-pressed="true"]`).textContent(), 'cfg.suggestLangEn', 'default reader follows the saved language, not always Chinese')
    assert.equal(await page.locator(`${modal} user-rules`).count(), 0, 'original text is escaped, not rendered as HTML')
    await page.locator(`${defaultModal} .gp-seg__btn`).nth(0).click()
    await checkOriginal(page, '中文系统指令', `${defaultModal} .gp-cfg__prompt-original`)
    await page.locator(`${defaultModal} .gp-seg__btn`).nth(1).click()
    await checkOriginal(page, 'English system', `${defaultModal} .gp-cfg__prompt-original`)
    const systemCopy = page.getByRole('button', { name: 'cfg.suggestPromptSystem: cfg.suggestPromptCopy', exact: true })
    const reminderCopy = page.getByRole('button', { name: 'cfg.suggestPromptUserReminder: cfg.suggestPromptCopy', exact: true })
    assert.equal(await systemCopy.count(), 1, 'system copy has a unique field-specific accessible name')
    assert.equal(await reminderCopy.count(), 1, 'reminder copy has a different field-specific accessible name')
    assert.equal(await systemCopy.textContent(), 'cfg.suggestPromptCopy', 'visible copy label stays short')
    await page.evaluate(() => { window.__promptFixture.copyOk = false })
    await systemCopy.click()
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptCopyFailed'), defaultModal)
    await page.evaluate(() => { window.__promptFixture.copyOk = true })
    await systemCopy.click()
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptCopied'), defaultModal)
    assert.equal(await page.evaluate(() => window.__promptFixture.copies.at(-1)), 'English system\n<user-rules>\nEnd', 'system action copies its full original string')
    await reminderCopy.click()
    assert.equal(await page.evaluate(() => window.__promptFixture.copies.at(-1)), 'English ending reminder\nOriginal', 'reminder action copies the corresponding complete string')
    await closePrompt(page, defaultButton)
    await page.click(effectiveButton)
    await assertSingleModal(page)
    await checkOriginal(page, 'new config')
    assert.equal(await page.locator(defaultModal).count(), 0, 'switching reader kind leaves no default dialog')
    await closePrompt(page)
    assert.equal(await page.inputValue(draft), 'unsaved custom', 'read and copy never touch the draft')
    assert.ok(await page.evaluate(() => window.__promptFixture.queries.every((query) => query.sessionId === '' && query.repo === undefined)), 'prompt queries are host-level and repository-independent')
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }

  const limits = await mount(browser, context, { prompt: 'base', echo: true })
  try {
    await limits.page.fill(draft, ' '.repeat(17000))
    await limits.page.waitForFunction(() => [...document.querySelectorAll('.gp-cfg__prompt p')].some((element) => element.textContent === 'cfg.suggestPromptDirty'))
    assert.equal(await limits.page.textContent('.gp-cfg__prompt-bytes'), '0 B / 16 KiB (UTF-8)', 'arbitrary whitespace displays the same zero-byte default that save writes')
    assert.equal(await limits.page.getAttribute(draft, 'aria-invalid'), null)
    assert.equal(await limits.page.isDisabled(save), false, 'arbitrary whitespace is the default, not an over-limit custom prompt')
    await limits.page.click(save)
    await limits.page.waitForFunction(() => window.__promptFixture.writes.at(-1)?.[1] === '' && document.querySelector('.gp-cfg__prompt-input')?.value === '')
    assert.equal(await limits.page.locator(modal).count(), 0, 'saving whitespace only reports status')
    await limits.page.click(effectiveButton)
    await assertSingleModal(limits.page)
    await checkOriginal(limits.page, '<user-rules>\n结束')
    await closePrompt(limits.page)
    await limits.page.fill(draft, '😀'.repeat(4097))
    await limits.page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-input')?.getAttribute('aria-invalid') === 'true')
    assert.equal(await limits.page.textContent('.gp-cfg__prompt-bytes'), '16388 B / 16 KiB (UTF-8)')
    assert.equal(await limits.page.isDisabled(save), true, 'UTF-8 bytes, not UTF-16 length, guard the limit')
    assert.equal(await limits.page.getAttribute(draft, 'maxlength'), null, 'textarea maxLength is not a byte limit')
    assert.deepEqual(limits.errors, [])
  } finally {
    await limits.page.close()
  }

  const localizedLimit = await mount(browser, context, { translated: true, locale: 'zh' })
  try {
    await localizedLimit.page.fill(draft, '😀'.repeat(4097))
    await localizedLimit.page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-input')?.getAttribute('aria-invalid') === 'true')
    assert.equal(await localizedLimit.page.textContent('.gp-cfg__prompt > .gp-cfg__err'), '超过 16 KiB UTF-8 上限，请缩短后保存。', 'the over-limit message derives its budget from the shared constant')
    assert.deepEqual(localizedLimit.errors, [])
  } finally {
    await localizedLimit.page.close()
  }

  const blank = await mount(browser, context, { prompt: '', absent: true, serialized: true })
  try {
    await blank.page.fill(draft, ' \t\n')
    assert.equal(await blank.page.textContent('.gp-cfg__prompt-bytes'), '0 B / 16 KiB (UTF-8)')
    assert.equal(await blank.page.isDisabled(save), true, 'blank default is not dirty and cannot repeat-save')
    await blank.page.locator(save).evaluate((button) => button.click())
    await afterDelivery(blank.page)
    assert.equal(await blank.page.evaluate(() => window.__promptFixture.writes.length), 0, 'disabled default save never writes again')
    await blank.page.click(effectiveButton)
    await checkOriginal(blank.page, '<user-rules>\n结束')
    await assertSingleModal(blank.page)
    await closePrompt(blank.page)
    assert.deepEqual(blank.errors, [])
  } finally {
    await blank.page.close()
  }

  for (const invalidPrompt of [17, null]) {
    const repair = await mount(browser, context, { prompt: invalidPrompt, hostDelayMs: 1100 })
    try {
      assert.equal(await repair.page.inputValue(draft), '')
      assert.equal(await repair.page.isDisabled(save), false, 'invalid saved values can be repaired by an explicit empty-string save')
      await repair.page.click(effectiveButton)
      await repair.page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptInvalidConfig'), effectiveModal)
      assert.equal(await repair.page.locator(`${effectiveModal} .gp-cfg__prompt-error button`).count(), 0, 'invalid saved config explains repair inside the modal instead of offering an inevitably failed Retry')
      assert.equal(await repair.page.evaluate(() => window.__promptFixture.queries.length), 1, 'known invalid saved config is terminal without propagation polling')
      assert.equal(await repair.page.locator(original).count(), 0, 'invalid config never presents an invented saved preview')
      assert.equal((await repair.page.textContent('.gp-cfg__prompt')).includes('cfg.suggestPromptDirty'), false, 'an untouched invalid config is not accused of an unsaved draft')
      assert.equal((await repair.page.textContent(effectiveModal)).includes('cfg.suggestPromptDirty'), false, 'the reader repeats no dirty warning for an untouched invalid config')
      await closePrompt(repair.page)
      await repair.page.evaluate(() => { window.__promptFixture.answers.push('config-invalid') })
      await repair.page.click(defaultButton)
      await repair.page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptPreviewFailed'), defaultModal)
      await repair.page.locator(`${defaultModal} .gp-cfg__prompt-error button`).click()
      await checkOriginal(repair.page, '中文系统指令', `${defaultModal} .gp-cfg__prompt-original`)
      await closePrompt(repair.page, defaultButton)
      const beforeRepair = await repair.page.evaluate(() => window.__promptFixture.queries.length)
      await repair.page.click(save)
      await repair.page.waitForFunction(() => window.__promptFixture.value.suggestPrompt === '')
      await repair.page.click(effectiveButton)
      await assertSingleModal(repair.page)
      await checkOriginal(repair.page, '<user-rules>\n结束')
      assert.equal((await repair.page.evaluate(() => window.__promptFixture.queries.length)) - beforeRepair, 3, 'valid repair waits through the old invalid host response with only two extra reads')
      assert.equal(await repair.page.locator(`${effectiveModal} .gp-cfg__prompt-error`).count(), 0, 'mirror acknowledgment does not pin the repaired preview to config-invalid')
      assert.deepEqual(await repair.page.evaluate(() => window.__promptFixture.writes), [['suggestPrompt', '']])
      assert.equal(await repair.page.locator('.gp-cfg__prompt .gp-cfg__err').count(), 0)
      await closePrompt(repair.page)
      assert.deepEqual(repair.errors, [])
    } finally {
      await repair.page.close()
    }
  }

  const invalidHost = await mount(browser, context)
  try {
    await invalidHost.page.click(effectiveButton)
    await checkOriginal(invalidHost.page, 'old rules')
    await closePrompt(invalidHost.page)
    const beforeInvalid = await invalidHost.page.evaluate(() => window.__promptFixture.queries.length)
    await invalidHost.page.evaluate(() => { window.__promptFixture.hostPrompt = 17 })
    await invalidHost.page.click(effectiveButton)
    await invalidHost.page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptInvalidConfig'), effectiveModal)
    assert.equal((await invalidHost.page.evaluate(() => window.__promptFixture.queries.length)) - beforeInvalid, 3, 'unexpected invalid host config has the same finite propagation bound')
    assert.equal(await invalidHost.page.locator(original).count(), 0, 'config-invalid terminal state cannot present a matching cached old final prompt')
    assert.equal(await invalidHost.page.locator(`${effectiveModal} .gp-cfg__prompt-error button`).count(), 0, 'exhausted config-invalid has no dead-end Retry')
    // Change only prompt here: language is read directly from the snapshot,
    // while saved prompt follows the mirror reducer effect. A joint update can
    // briefly query old prompt + new language; the late-read case above covers
    // dropping that obsolete response, not an exact one-read count.
    await invalidHost.page.evaluate(() => window.__promptFixture.external('repaired identity'))
    await checkOriginal(invalidHost.page, '中文系统指令\n<user-rules>repaired identity')
    assert.equal(await invalidHost.page.locator(`${effectiveModal} .gp-cfg__prompt-error`).count(), 0, 'new saved identity automatically rereads after a config-invalid terminal state')
    const repaired = await invalidHost.page.evaluate(() => ({ queries: window.__promptFixture.queries.length, aborted: window.__promptFixture.aborted }))
    assert.equal(repaired.queries - beforeInvalid, 4, `identity change starts one new read, not a poll loop: ${JSON.stringify(repaired)}`)
    await closePrompt(invalidHost.page)
    assert.deepEqual(invalidHost.errors, [])
  } finally {
    await invalidHost.page.close()
  }

  // A save accepted under a valid identity, then a host that reports invalid:
  // the terminal explanation must stand alone, not promise a Retry it hides.
  const savedThenInvalid = await mount(browser, context)
  try {
    const page = savedThenInvalid.page
    await page.fill(draft, 'saved rules')
    await page.click(save)
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-meta')?.textContent.includes('cfg.suggestPromptSaved'))
    assert.equal(await page.locator(modal).count(), 0, 'saved rules stay in the settings form until the reader is opened')
    await page.click(effectiveButton)
    await checkOriginal(page, 'saved rules')
    await assertSingleModal(page, 'effective')
    await closePrompt(page)
    const beforeSavedInvalid = await page.evaluate(() => window.__promptFixture.queries.length)
    await page.evaluate(() => { window.__promptFixture.hostPrompt = 17 })
    await page.click(effectiveButton)
    await page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptInvalidConfig'), effectiveModal)
    assert.equal((await page.evaluate(() => window.__promptFixture.queries.length)) - beforeSavedInvalid, 3, 'saved-then-invalid host keeps the same finite propagation bound')
    const errorText = await page.locator(`${effectiveModal} .gp-cfg__prompt-error`).textContent()
    assert.equal(errorText.includes('cfg.suggestPromptSavedPreviewFailed'), false, 'config-invalid does not also claim the saved prompt can be retried')
    assert.equal(await page.locator(`${effectiveModal} .gp-cfg__prompt-error button`).count(), 0, 'saved-then-invalid still has no dead-end Retry')
    assert.equal(await page.locator(original).count(), 0, 'saved-then-invalid presents no stale final prompt')
    await closePrompt(page)
    assert.deepEqual(savedThenInvalid.errors, [])
  } finally {
    await savedThenInvalid.page.close()
  }

  const englishDefault = await mount(browser, context, { language: 'en' })
  try {
    await englishDefault.page.click(defaultButton)
    await assertSingleModal(englishDefault.page, 'default')
    await checkOriginal(englishDefault.page, 'English system', `${defaultModal} .gp-cfg__prompt-original`)
    assert.equal(await englishDefault.page.locator(`${defaultModal} .gp-seg__btn[aria-pressed="true"]`).textContent(), 'cfg.suggestLangEn', 'default reader opens on the configured language, not always Chinese')
    await closePrompt(englishDefault.page, defaultButton)
    assert.deepEqual(englishDefault.errors, [])
  } finally {
    await englishDefault.page.close()
  }

  for (const options of [{ supported: false }, { writable: false, aiEnabled: false }, { supported: false, absent: true, prompt: '', aiEnabled: false }]) {
    const mounted = await mount(browser, context, options)
    try {
      assert.equal(await mounted.page.isDisabled(draft), true, 'unsupported or read-only settings never allow editing')
      assert.equal(await mounted.page.isDisabled(save), true)
      assert.equal(await mounted.page.isDisabled(defaultButton), false, 'schema, read-only, and AI-off do not disable default reading')
      assert.equal(await mounted.page.isDisabled(effectiveButton), false, 'saved prompt reading remains available with AI off or readonly')
      await mounted.page.click(defaultButton)
      await checkOriginal(mounted.page, '中文系统指令', `${defaultModal} .gp-cfg__prompt-original`)
      await assertSingleModal(mounted.page, 'default')
      await closePrompt(mounted.page, defaultButton)
      await mounted.page.click(effectiveButton)
      await checkOriginal(mounted.page, options.prompt === '' ? '<user-rules>\n结束' : 'old rules')
      await assertSingleModal(mounted.page)
      assert.equal(await mounted.page.evaluate(() => window.__promptFixture.writes.length), 0)
      await closePrompt(mounted.page)
      assert.deepEqual(mounted.errors, [])
    } finally {
      await mounted.page.close()
    }
  }

  const switching = await mount(browser, context)
  try {
    await switching.page.click(effectiveButton)
    await checkOriginal(switching.page, 'old rules')
    // Dispatch the other entry while already open to exercise mutual exclusion itself.
    await switching.page.locator(defaultButton).evaluate((button) => button.click())
    await assertSingleModal(switching.page, 'default')
    await checkOriginal(switching.page, '<user-rules>\n结束', `${defaultModal} .gp-cfg__prompt-original`)
    assert.equal(await switching.page.locator(effectiveModal).count(), 0)
    await switching.page.locator(effectiveButton).evaluate((button) => button.click())
    await assertSingleModal(switching.page)
    await checkOriginal(switching.page, 'old rules')
    assert.equal(await switching.page.locator(defaultModal).count(), 0)
    await closePrompt(switching.page)
    await switching.page.click(effectiveButton)
    await checkOriginal(switching.page, 'old rules')
    await switching.page.evaluate(() => window.__promptFixture.replaceForm('new owner'))
    await switching.page.waitForFunction((selector) => document.querySelector(selector) === null, modal)
    assert.equal(await switching.page.inputValue(draft), 'new owner', 'owner replacement closes the active preview and reloads its draft')
    assert.deepEqual(switching.errors, [])
  } finally {
    await switching.page.close()
  }

  const oldHost = await mount(browser, context, { supported: false, oldHost: true })
  try {
    await oldHost.page.click(effectiveButton)
    await oldHost.page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptPreviewFailed'), effectiveModal)
    assert.equal(await oldHost.page.locator(original).count(), 0, 'old host errors visibly instead of inventing a preview')
    await closePrompt(oldHost.page)
    assert.equal(await oldHost.page.evaluate(() => window.__promptFixture.writes.length), 0)
    assert.deepEqual(oldHost.errors, [])
  } finally {
    await oldHost.page.close()
  }

  const final = await mount(browser, context, { absent: true, prompt: '', serialized: true })
  try {
    assert.equal(await final.page.isDisabled(draft), false, 'schema declares support even when the value is absent')
    await final.page.evaluate(() => { window.__promptFixture.answers.push('fail') })
    await final.page.fill(draft, 'saved but unread')
    await final.page.click(save)
    await final.page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-meta')?.textContent.includes('cfg.suggestPromptSaved'))
    assert.equal(await final.page.locator(modal).count(), 0, 'a save whose preview would fail still opens no reader by itself')
    await final.page.click(effectiveButton)
    await assertSingleModal(final.page)
    await final.page.waitForFunction((selector) => document.querySelector(selector)?.textContent.includes('cfg.suggestPromptSavedPreviewFailed'), effectiveModal)
    const savedWrites = await final.page.evaluate(() => window.__promptFixture.writes.length)
    await final.page.locator(`${effectiveModal} .gp-cfg__prompt-error button`).click()
    await checkOriginal(final.page, 'saved but unread')
    assert.equal(await final.page.evaluate(() => window.__promptFixture.writes.length), savedWrites, 'failed post-save preview retry never repeats set')
    await closePrompt(final.page)

    // Replacing the settings owner under a parked successful save closes its lifecycle.
    await final.page.evaluate(() => { window.__promptFixture.holdSet = true })
    await final.page.fill(draft, 'old form draft')
    await final.page.click(save)
    await final.page.waitForFunction(() => typeof window.__promptFixture.releaseSet === 'function')
    await final.page.evaluate(() => window.__promptFixture.replaceForm('replacement form'))
    await final.page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-input')?.value === 'replacement form')
    assert.equal(await final.page.isDisabled(draft), false, 'new form is not pinned to the old saving state')
    await final.page.evaluate(() => window.__promptFixture.releaseSet(true))
    await final.page.waitForFunction(() => window.__promptFixture.setReleased)
    await afterDelivery(final.page)
    assert.equal(await final.page.locator(modal).count(), 0, 'old owner success must not open a new owner modal')
    assert.equal(await final.page.inputValue(draft), 'replacement form', 'old save result cannot repaint the replacement form')
    await final.page.fill(draft, 'new form draft')
    assert.equal(await final.page.isDisabled(save), false)
    await final.page.click(save)
    await final.page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-meta')?.textContent.includes('cfg.suggestPromptSaved'))
    await final.page.click(effectiveButton)
    await assertSingleModal(final.page)
    await checkOriginal(final.page, 'new form draft')
    assert.equal(await final.page.locator('.gp-cfg__prompt .gp-cfg__err').count(), 0)
    await closePrompt(final.page)

    const long = '非常长的规范😀'.repeat(400)
    await final.page.fill(draft, long)
    await final.page.click(save)
    await final.page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-meta')?.textContent.includes('cfg.suggestPromptSaved'))
    await final.page.click(effectiveButton)
    await assertSingleModal(final.page)
    await checkOriginal(final.page, long)
    await final.page.setViewportSize({ width: 320, height: 880 })
    await final.page.addStyleTag({ content: '#panel{box-sizing:border-box;width:100%!important;padding:12px!important}' })
    for (const selector of ['.gp-cfg__prompt', '.gp-cfg__prompt-input', modal, original]) {
      const element = await final.page.locator(selector).first().evaluate((node) => ({ scroll: node.scrollWidth, width: node.clientWidth, right: node.getBoundingClientRect().right }))
      assert.ok(element.scroll <= element.width + 1, `${selector} wraps long prompt at 320px: ${JSON.stringify(element)}`)
      assert.ok(element.right <= 320, `${selector} stays inside the viewport`)
    }
    const longOriginal = await final.page.locator(original).first().evaluate((element) => ({ text: element.textContent, height: element.clientHeight, scroll: element.scrollHeight }))
    assert.ok(longOriginal.text.includes(long), 'narrow modal keeps the complete non-virtualized original')
    assert.ok(longOriginal.scroll > longOriginal.height, 'long originals have a usable vertical scroll range')
    await final.page.locator(original).first().evaluate((element) => { element.scrollTop = element.scrollHeight })
    assert.ok(await final.page.locator(original).first().evaluate((element) => element.scrollTop > 0), 'original text can be scrolled')
    await closePrompt(final.page)
    await final.page.click(defaultButton)
    await checkOriginal(final.page, '中文系统指令', `${defaultModal} .gp-cfg__prompt-original`)
    const modalWidth = await final.page.locator(modal).evaluate((element) => element.getBoundingClientRect().width)
    assert.ok(modalWidth <= 296, 'default modal fits the 320px viewport')
    await assertSingleModal(final.page, 'default')
    assert.deepEqual(final.errors, [])
    await final.page.evaluate(() => window.__promptRoot.unmount())
    assert.equal(await final.page.locator('[data-gp-overlay]').count(), 0, 'unmount cleans the open prompt dialog')
  } finally {
    await final.page.close()
  }

  const realRules = [
    '标题不加 type 前缀，用一句中文说明最重要的变更。',
    '正文分为「变更」「验证」两段，各用列表；保留固定标记 TASK-159，不翻译。',
    '长格式示例：' + 'a'.repeat(2500),
    '多字节规范示例：' + '中文规范😀'.repeat(300),
  ].join('\n')
  const realPrompts = {
    defaults: { zh: buildSuggestPrompt('zh'), en: buildSuggestPrompt('en') },
    custom: { zh: buildSuggestPrompt('zh', realRules), en: buildSuggestPrompt('en', realRules) },
  }
  const visual = await mount(browser, context, { prompt: '', translated: true, serialized: true, realPrompts })
  try {
    assert.equal(await visual.page.textContent('.gp-cfg__prompt .gp-cfg__title'), '自定义提交规范', 'visual fixture uses the actual compiled Chinese locale')
    assert.equal(await visual.page.textContent(effectiveButton), '查看最终提示词', 'final-version entry uses the Chinese modal action label')
    await visual.page.fill(draft, realRules)
    const expectedBytes = Buffer.byteLength(realRules, 'utf8')
    await visual.page.waitForFunction((bytes) => document.querySelector('.gp-cfg__prompt-bytes')?.textContent === `${bytes} B / 16 KiB（UTF-8）`, expectedBytes)
    assert.equal(await visual.page.isDisabled(save), false, 'actual Chinese UTF-8 byte count and save gate agree')
    for (const width of [760, 404, 320]) {
      await setPromptWidth(visual.page, width)
      await assertPromptToolbar(visual.page, width, { chinese: true })
    }
    await visual.page.evaluate(() => { window.__promptFixture.holdSet = true })
    await visual.page.click(save)
    await visual.page.waitForFunction(() => typeof window.__promptFixture.releaseSet === 'function')
    for (const width of [760, 404, 320]) {
      await setPromptWidth(visual.page, width)
      await assertPromptToolbar(visual.page, width, { chinese: true, busy: true })
    }
    await visual.page.evaluate(() => window.__promptFixture.releaseSet(true))
    await visual.page.waitForFunction(() => window.__promptFixture.setReleased)
    assert.equal(await visual.page.locator(modal).count(), 0, 'a successful save keeps the settings page free of overlays')
    await visual.page.click(effectiveButton)
    await assertSingleModal(visual.page)
    await checkOriginal(visual.page, realRules)
    await setPromptWidth(visual.page, 760)
    const strings = await visual.page.locator(original).allTextContents()
    assert.deepEqual(strings, [realPrompts.custom.zh.system, realPrompts.custom.zh.userReminder], 'effective modal shows complete strings from the real host prompt builder')
    await visual.page.screenshot({ path: resolve(screenshots, 'saved-effective-modal-wide.png'), fullPage: true })
    await visual.page.setViewportSize({ width: 320, height: 880 })
    await visual.page.addStyleTag({ content: '#panel{box-sizing:border-box;width:100%!important;padding:12px!important}' })
    for (const selector of ['.gp-cfg__prompt', '.gp-cfg__prompt-input', modal, original]) {
      const bounds = await visual.page.locator(selector).first().evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right }))
      assert.ok(bounds.scroll <= bounds.width + 1 && bounds.right <= 320, `actual Chinese labels and host prompt fit 320px: ${selector} ${JSON.stringify(bounds)}`)
    }
    assert.deepEqual(await visual.page.locator(original).allTextContents(), strings, '320px modal preserves both complete original strings')
    await visual.page.screenshot({ path: resolve(screenshots, 'saved-effective-modal-320px.png'), fullPage: true })
    await closePrompt(visual.page)
    await visual.page.click(defaultButton)
    await assertSingleModal(visual.page, 'default')
    await checkOriginal(visual.page, realPrompts.defaults.zh.system, `${defaultModal} .gp-cfg__prompt-original`)
    await closePrompt(visual.page, defaultButton)
    for (const width of [760, 404, 320]) {
      await setPromptWidth(visual.page, width)
      await assertPromptToolbar(visual.page, width, { chinese: true })
      assert.equal(await visual.page.textContent('.gp-cfg__prompt-bytes'), `${expectedBytes} B / 16 KiB（UTF-8）`, 'real Chinese counter keeps its exact byte count and 16 KiB limit')
      await visual.page.locator('.gp-cfg__prompt-footer').screenshot({ path: resolve(screenshots, `prompt-toolbar-${width}px.png`) })
    }
    assert.deepEqual(visual.errors, [])
  } finally {
    await visual.page.close()
  }
  const longLocale = await mount(browser, context, { translated: true, locale: 'de' })
  try {
    assert.equal(await longLocale.page.textContent(effectiveButton), 'Gespeicherten Prompt ansehen', 'long-language fixture uses the real German dictionary')
    await longLocale.page.fill(draft, 'German toolbar busy sample')
    for (const width of [404, 320]) {
      await setPromptWidth(longLocale.page, width)
      await assertPromptToolbar(longLocale.page, width, { wrapped: true })
    }
    await longLocale.page.evaluate(() => { window.__promptFixture.holdSet = true })
    await longLocale.page.click(save)
    await longLocale.page.waitForFunction(() => typeof window.__promptFixture.releaseSet === 'function')
    for (const width of [404, 320]) {
      await setPromptWidth(longLocale.page, width)
      await assertPromptToolbar(longLocale.page, width, { wrapped: true, busy: true })
    }
    await longLocale.page.evaluate(() => window.__promptFixture.releaseSet(true))
    await longLocale.page.waitForFunction(() => window.__promptFixture.setReleased)
    await longLocale.page.click(effectiveButton)
    await assertSingleModal(longLocale.page)
    await checkOriginal(longLocale.page, 'German toolbar busy sample')
    await closePrompt(longLocale.page)
    assert.deepEqual(longLocale.errors, [])
  } finally {
    await longLocale.page.close()
  }
  console.log(`e2e/config-sections issue159: all assertions passed; screenshots: ${screenshots}`)
}
