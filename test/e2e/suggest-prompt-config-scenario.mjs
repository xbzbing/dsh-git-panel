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
const previewToggle = '.gp-cfg__prompt-preview-toggle'
const original = '.gp-cfg__prompt-preview .gp-cfg__prompt-original'

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
      aborted: 0,
    }
    const baseCall = connection.rpc.call.bind(connection.rpc)
    const preview = (view) => {
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
      fixture.queries.push({ sessionId: request.sessionId, repo: request.repo, view })
      signal?.addEventListener('abort', () => { fixture.aborted++ }, { once: true })
      let answer = preview(view)
      const mode = fixture.answers.shift()
      if (mode === 'fail') answer = { ok: false, error: { code: 'transport', message: 'fixture read failure' } }
      if (mode === 'invalid') answer.value.variants.en.userReminder = 17
      if (fixture.holdView === view) {
        fixture.holdView = null
        // Intentionally ignore abort: a transport may deliver its old reply anyway.
        await new Promise((resolve) => { fixture.releasePreview = () => resolve() })
      }
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
            const accepted = await new Promise((resolve) => { fixture.releaseSet = (ok) => resolve(ok) })
            if (!accepted) return false
          }
          if (fixture.value === value) {
            fixture.hostPrompt = text
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
      let text = options.translated ? dictionaries.zh?.[key] ?? key : key
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

/** Isolated pages; no runtime profile, shared server, or extra model calls. */
export async function runPromptConfigScenario(browser, context) {
  const outputRoot = resolve(DIR, '../../test-results')
  await mkdir(outputRoot, { recursive: true })
  const screenshots = await mkdtemp(resolve(outputRoot, 'issue159-'))
  const { page, errors } = await mount(browser, context, { echo: false })
  try {
    assert.equal(await page.evaluate(() => window.__promptFixture.queries.length), 0, 'opening settings starts no prompt query')
    await page.fill(draft, 'first line\nsecond line')
    await page.keyboard.press('Enter')
    const typed = await page.inputValue(draft)
    await page.locator(draft).blur()
    assert.equal(await page.evaluate(() => window.__promptFixture.writes.length), 0, 'Enter and blur never save')
    await page.evaluate(() => { window.__promptFixture.failSet = true })
    await page.click(save)
    await page.waitForSelector('.gp-cfg__prompt .gp-cfg__err')
    assert.equal(await page.inputValue(draft), typed, 'failed save retains the entire draft')
    await page.click(save)
    await checkOriginal(page, typed)
    assert.equal(await page.locator('.gp-cfg__prompt-preview .gp-seg__btn').count(), 2, 'auto exposes both effective language variants')
    await page.locator('.gp-cfg__prompt-preview .gp-seg__btn').nth(1).click()
    await checkOriginal(page, 'English system')
    await page.locator('.gp-cfg__prompt-preview .gp-seg__btn').nth(0).click()
    assert.deepEqual(await page.evaluate(() => window.__promptFixture.writes), [['suggestPrompt', typed], ['suggestPrompt', typed]], 'each explicit save calls set exactly once')
    assert.equal(await page.inputValue(draft), typed, 'successful save does not flash back to the old mirror')
    await page.click(previewToggle)
    const readsWhileCollapsed = await page.evaluate(() => window.__promptFixture.queries.length)
    await page.waitForSelector('.gp-cfg__prompt-reload')
    assert.equal(await page.inputValue(draft), typed, 'the saved text also survives the mirror propagation bound')
    await page.locator('.gp-cfg__prompt > .gp-cfg__prompt-error button').nth(1).click()
    await page.waitForFunction((before) => document.querySelector('.gp-cfg__prompt-preview-toggle')?.getAttribute('aria-expanded') === 'true' && window.__promptFixture.queries.length > before, readsWhileCollapsed)
    await checkOriginal(page, typed)
    await page.evaluate((text) => { window.__promptFixture.value.unrelated = true; window.__promptFixture.notify(); window.__promptFixture.mirror(text) }, typed)
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-reload') === null)

    await page.click('.gp-cfg__prompt-clear')
    assert.equal(await page.inputValue(draft), '')
    assert.equal(await page.evaluate(() => window.__promptFixture.writes.length), 2, 'clearing changes only the local draft')
    await checkOriginal(page, typed)
    await page.click(save)
    await checkOriginal(page, '<user-rules>\n结束')
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
    await page.waitForFunction(() => typeof window.__promptFixture.releasePreview === 'function')
    await page.evaluate(() => window.__promptFixture.external('new config', 'en'))
    await checkOriginal(page, 'English system\n<user-rules>new config')
    await page.evaluate(() => window.__promptFixture.releasePreview())
    await page.waitForTimeout(80)
    assert.equal((await page.textContent(original)).includes('held old config'), false, 'old preview cannot overwrite the new saved result')
    assert.ok(await page.evaluate(() => window.__promptFixture.aborted > 0), 'obsolete reads are aborted')

    // A host still on the prior volatile config gets only two extra reads.
    await page.evaluate(() => { window.__promptFixture.hostPrompt = 'stale config' })
    await page.click(previewToggle)
    const beforeReads = await page.evaluate(() => window.__promptFixture.queries.length)
    await page.click(previewToggle)
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-preview')?.textContent.includes('cfg.suggestPromptPreviewSync'))
    assert.equal((await page.evaluate(() => window.__promptFixture.queries.length)) - beforeReads, 3, 'initial read plus two bounded propagation retries')
    assert.equal((await page.textContent('.gp-cfg__prompt-preview')).includes('<user-rules>stale config'), false, 'mismatched config is never presented as the new result')
    const writesBeforeRetry = await page.evaluate(() => window.__promptFixture.writes.length)
    await page.evaluate(() => { window.__promptFixture.hostPrompt = 'new config' })
    await page.locator('.gp-cfg__prompt-preview .gp-cfg__prompt-error button').click()
    await checkOriginal(page, 'new config')
    assert.equal(await page.evaluate(() => window.__promptFixture.writes.length), writesBeforeRetry, 'retry only reads; it never saves again')

    // Default reads are independent of a dirty custom draft and always validate both variants.
    await page.fill(draft, 'unsaved custom')
    await page.evaluate(() => { window.__promptFixture.answers.push('invalid') })
    await page.click(defaultButton)
    await page.waitForSelector('.gp-cfg__prompt-modal')
    assert.equal(await page.locator('[data-gp-overlay]').count() > 0, true)
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-modal')?.textContent.includes('cfg.suggestPromptPreviewInvalid'))
    await page.locator('.gp-cfg__prompt-modal .gp-cfg__prompt-error button').click()
    await checkOriginal(page, '中文系统指令', '.gp-cfg__prompt-modal .gp-cfg__prompt-original')
    assert.equal(await page.locator('.gp-cfg__prompt-modal user-rules').count(), 0, 'original text is escaped, not rendered as HTML')
    await page.locator('.gp-cfg__prompt-modal .gp-seg__btn').nth(1).click()
    await checkOriginal(page, 'English system', '.gp-cfg__prompt-modal .gp-cfg__prompt-original')
    await page.evaluate(() => { window.__promptFixture.copyOk = false })
    await page.locator('.gp-cfg__prompt-modal .gp-cfg__prompt-text button').first().click()
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-modal')?.textContent.includes('cfg.suggestPromptCopyFailed'))
    await page.evaluate(() => { window.__promptFixture.copyOk = true })
    await page.locator('.gp-cfg__prompt-modal .gp-cfg__prompt-text button').first().click()
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-modal')?.textContent.includes('cfg.suggestPromptCopied'))
    assert.equal(await page.evaluate(() => window.__promptFixture.copies.at(-1)), 'English system\n<user-rules>\nEnd', 'copy uses the full original string')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-modal') === null)
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('gp-cfg__prompt-default')), true, 'closing the modal restores focus to its opener')
    assert.equal(await page.inputValue(draft), 'unsaved custom', 'default read and copy do not touch the draft')
    assert.ok(await page.evaluate(() => window.__promptFixture.queries.every((query) => query.sessionId === '' && query.repo === undefined)), 'prompt queries are host-level and repository-independent')
    assert.deepEqual(errors, [])
  } finally {
    await page.close()
  }

  const limits = await mount(browser, context, { prompt: 'base', echo: true })
  try {
    await limits.page.fill(draft, ' '.repeat(17000))
    await limits.page.waitForFunction(() => [...document.querySelectorAll('.gp-cfg__prompt p')].some((element) => element.textContent === 'cfg.suggestPromptDirty'))
    assert.equal(await limits.page.isDisabled(save), false, 'arbitrary whitespace is the default, not an over-limit custom prompt')
    await limits.page.click(save)
    await limits.page.waitForFunction(() => window.__promptFixture.writes.at(-1)?.[1] === '' && document.querySelector('.gp-cfg__prompt-input')?.value === '')
    await limits.page.fill(draft, '😀'.repeat(4097))
    await limits.page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-input')?.getAttribute('aria-invalid') === 'true')
    assert.equal(await limits.page.isDisabled(save), true, 'UTF-8 bytes, not UTF-16 length, guard the limit')
    assert.equal(await limits.page.getAttribute(draft, 'maxlength'), null, 'textarea maxLength is not a byte limit')
    assert.deepEqual(limits.errors, [])
  } finally {
    await limits.page.close()
  }

  for (const invalidPrompt of [17, null]) {
    const repair = await mount(browser, context, { prompt: invalidPrompt })
    try {
      assert.equal(await repair.page.inputValue(draft), '')
      assert.equal(await repair.page.isDisabled(save), false, 'invalid saved values can be repaired by an explicit empty-string save')
      await repair.page.click(defaultButton)
      await checkOriginal(repair.page, '中文系统指令', '.gp-cfg__prompt-modal .gp-cfg__prompt-original')
      await repair.page.keyboard.press('Escape')
      await repair.page.click(save)
      await checkOriginal(repair.page, '<user-rules>\n结束')
      assert.deepEqual(await repair.page.evaluate(() => window.__promptFixture.writes), [['suggestPrompt', '']])
      assert.equal(await repair.page.locator('.gp-cfg__prompt .gp-cfg__err').count(), 0)
      assert.deepEqual(repair.errors, [])
    } finally {
      await repair.page.close()
    }
  }

  for (const options of [{ supported: false }, { writable: false, aiEnabled: false }, { supported: false, absent: true, aiEnabled: false }]) {
    const mounted = await mount(browser, context, options)
    try {
      assert.equal(await mounted.page.isDisabled(draft), true, 'unsupported or read-only settings never allow editing')
      assert.equal(await mounted.page.isDisabled(save), true)
      assert.equal(await mounted.page.isDisabled(defaultButton), false, 'schema, read-only, and AI-off do not disable default reading')
      await mounted.page.click(defaultButton)
      await checkOriginal(mounted.page, '中文系统指令', '.gp-cfg__prompt-modal .gp-cfg__prompt-original')
      assert.equal(await mounted.page.evaluate(() => window.__promptFixture.writes.length), 0)
      assert.deepEqual(mounted.errors, [])
    } finally {
      await mounted.page.close()
    }
  }

  const final = await mount(browser, context, { absent: true, serialized: true })
  try {
    assert.equal(await final.page.isDisabled(draft), false, 'schema declares support even when the value is absent')
    await final.page.evaluate(() => { window.__promptFixture.answers.push('fail') })
    await final.page.fill(draft, 'saved but unread')
    await final.page.click(save)
    await final.page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-preview')?.textContent.includes('cfg.suggestPromptSavedPreviewFailed'))
    const savedWrites = await final.page.evaluate(() => window.__promptFixture.writes.length)
    await final.page.locator('.gp-cfg__prompt-preview .gp-cfg__prompt-error button').click()
    await checkOriginal(final.page, 'saved but unread')
    assert.equal(await final.page.evaluate(() => window.__promptFixture.writes.length), savedWrites, 'failed post-save preview retry never repeats set')

    // Replacing the settings form under a parked save resets state immediately.
    await final.page.evaluate(() => { window.__promptFixture.holdSet = true })
    await final.page.fill(draft, 'old form draft')
    await final.page.click(save)
    await final.page.waitForFunction(() => typeof window.__promptFixture.releaseSet === 'function')
    await final.page.evaluate(() => window.__promptFixture.replaceForm('replacement form'))
    await final.page.waitForFunction(() => document.querySelector('.gp-cfg__prompt-input')?.value === 'replacement form')
    assert.equal(await final.page.isDisabled(draft), false, 'new form is not pinned to the old saving state')
    await final.page.fill(draft, 'new form draft')
    assert.equal(await final.page.isDisabled(save), false)
    await final.page.click(save)
    await checkOriginal(final.page, 'new form draft')
    await final.page.evaluate(() => window.__promptFixture.releaseSet(false))
    await final.page.waitForTimeout(80)
    assert.equal(await final.page.inputValue(draft), 'new form draft', 'old save result cannot repaint the replacement form')
    assert.equal(await final.page.locator('.gp-cfg__prompt .gp-cfg__err').count(), 0)

    const long = '非常长的规范😀'.repeat(400)
    await final.page.fill(draft, long)
    await final.page.click(save)
    await checkOriginal(final.page, long)
    await final.page.setViewportSize({ width: 320, height: 880 })
    await final.page.addStyleTag({ content: '#panel{box-sizing:border-box;width:100%!important;padding:12px!important}' })
    const overflow = await final.page.evaluate(() => {
      const selectors = ['.gp-cfg__prompt', '.gp-cfg__prompt-input', '.gp-cfg__prompt-preview', '.gp-cfg__prompt-original']
      return selectors.map((selector) => {
        const element = document.querySelector(selector)
        return { selector, scroll: element.scrollWidth, width: element.clientWidth, right: element.getBoundingClientRect().right }
      })
    })
    for (const element of overflow) {
      assert.ok(element.scroll <= element.width + 1, `${element.selector} wraps long prompt at 320px: ${JSON.stringify(element)}`)
      assert.ok(element.right <= 320, `${element.selector} stays inside the viewport`)
    }
    await final.page.click(defaultButton)
    await checkOriginal(final.page, '中文系统指令', '.gp-cfg__prompt-modal .gp-cfg__prompt-original')
    const modalWidth = await final.page.locator('.gp-cfg__prompt-modal').evaluate((element) => element.getBoundingClientRect().width)
    assert.ok(modalWidth <= 296, 'default modal fits the 320px viewport')
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
    await visual.page.fill(draft, realRules)
    await visual.page.waitForFunction(() => !document.querySelector('.gp-cfg__prompt-save').disabled)
    await visual.page.click(save)
    await checkOriginal(visual.page, realRules)
    const strings = await visual.page.locator(original).allTextContents()
    assert.deepEqual(strings, [realPrompts.custom.zh.system, realPrompts.custom.zh.userReminder], 'visual fixture shows complete strings from the real host prompt builder')
    await visual.page.screenshot({ path: resolve(screenshots, 'saved-preview-wide.png'), fullPage: true })
    await visual.page.setViewportSize({ width: 320, height: 880 })
    await visual.page.addStyleTag({ content: '#panel{box-sizing:border-box;width:100%!important;padding:12px!important}' })
    for (const selector of ['.gp-cfg__prompt', '.gp-cfg__prompt-input', '.gp-cfg__prompt-preview', '.gp-cfg__prompt-original']) {
      const bounds = await visual.page.locator(selector).first().evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right }))
      assert.ok(bounds.scroll <= bounds.width + 1 && bounds.right <= 320, `actual Chinese labels and host prompt fit 320px: ${selector} ${JSON.stringify(bounds)}`)
    }
    await visual.page.screenshot({ path: resolve(screenshots, 'saved-preview-320px.png'), fullPage: true })
    await visual.page.click(defaultButton)
    await checkOriginal(visual.page, realPrompts.defaults.zh.system, '.gp-cfg__prompt-modal .gp-cfg__prompt-original')
    assert.deepEqual(visual.errors, [])
  } finally {
    await visual.page.close()
  }
  console.log(`e2e/config-sections issue159: all assertions passed; screenshots: ${screenshots}`)
}
