/** History search scopes against the shipped bundle and controllable RPC replies. */
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const OUT = new URL('../../docs/local/history-path-search/e2e/', import.meta.url)
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
const MESSAGE = '消息 / 哈希'
const PATH = '文件 / 路径'
const UNSUPPORTED = '当前 Git 插件宿主不支持路径搜索，请更新并重新加载宿主。'
const browser = await chromium.launch()

async function boot({ host = 'conversation', width = 1400, height = 900, fontDelta = 0, phone = false, automatic = false } = {}) {
  const page = await browser.newPage({
    viewport: phone ? { width: 390, height: 844 } : { width: 1480, height: 1050 },
    screen: phone ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
    hasTouch: phone,
  })
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(new URL('./harness.html', import.meta.url).href)
  await page.addStyleTag({ content: THEME })
  for (const file of ['client.js', 'mock-rpc.mjs']) {
    await page.addScriptTag({ path: fileURLToPath(new URL(file, import.meta.url)) })
  }
  await page.evaluate(({ host, width, height, fontDelta, automatic }) => {
    const snap = {
      root: '/history-path-fixture', branch: 'main', head: '1111111', unborn: false, dirty: false,
      staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
      remote: { name: 'origin', webUrl: 'https://github.com/example/history', hostKind: 'github' },
      changes: [], refreshIntervalMs: 0, checkedAt: Date.now(), fontDelta,
      stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
    }
    const { connection } = window.createGitPanelMock(snap)
    const call = connection.rpc.call
    const requests = []
    const success = (value) => ({ ok: true, value: { ok: true, value } })
    connection.rpc.call = async (channel, endpoint, payload) => {
      const query = payload?.args?.request?.query
      if (endpoint === 'dbGitPanel/query' && query?.kind === 'history') {
        const id = requests.length
        const hash = (id + 1).toString(16).padStart(40, '0')
        const subject = `${query.pathSearch ? 'path' : 'message'}:${query.pathSearch || query.search || 'all'}:reply-${id}`
        const commits = [{ hash, shortHash: hash.slice(-7), subject, author: 'Tester', dateIso: '2026-01-01T10:00:00Z', parents: [], refs: [] }]
        const request = { id, query, subject, released: false, completed: false, release: null }
        const pending = new Promise((resolve) => {
          request.release = (supported = true, empty = false) => {
            if (request.released) throw new Error(`history response already released: ${id}`)
            request.released = true
            const rows = empty ? [] : commits
            resolve(success({ kind: 'history', commits: rows, total: rows.length, ...(supported ? { pathSearchSupported: true } : {}) }))
          }
        })
        requests.push(request)
        if (automatic) request.release()
        const response = await pending
        request.completed = true
        return response
      }
      return call(channel, endpoint, payload)
    }
    const registered = {}
    const dictionaries = {}
    const value = { showInputPill: true, placement: host === 'sidebar' ? 'sidebar' : 'conversation' }
    const configForms = {
      describe: () => ({
        getSnapshot: () => ({ status: 'ready', view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {}, placement: {} } }, value }] } }),
        subscribe: () => () => {}, ensure: async () => {},
      }),
      get: () => ({ getSnapshot: () => ({ status: 'ready', value, revision: 0, writable: true }), subscribe: () => () => {}, set: async () => true }),
    }
    const services = { connection, ...(host === 'sidebar' ? {
      configForms, sidebarRightTabs: { register: () => () => {} }, sidebarRight: { openTab: () => {} },
    } : {}) }
    const ctx = {
      get: (name) => services[name], effect: (callback) => callback(), on: () => () => {}, inject: (_deps, callback) => callback(ctx),
      slots: {
        inject: (_name, provider) => provider(),
        register: (reg, component) => { registered[reg.key === undefined ? reg.name : `${reg.name}::${reg.key}`] = component; return () => {} },
      },
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict; return () => {} },
        bind: (ns) => (key, params) => {
          const text = dictionaries[ns]?.zh?.[key] ?? dictionaries[ns]?.en?.[key] ?? key
          return params === undefined ? text : text.replace(/\{(\w+)\}/g, (match, key) => key in params ? String(params[key]) : match)
        },
      },
    }
    const inspect = () => [...document.querySelectorAll('.gp-history__list .gp-commit-row')].map((row) => ({
      subject: row.querySelector('.gp-commit-subject')?.textContent,
      svg: row.querySelector('.gp-graph-svg')?.outerHTML.replace(/id="[^"]+"/g, 'id="MASK"').replace(/url\(#[^)]+\)/g, 'url(#MASK)'),
    }))
    let trace = null
    const record = () => {
      if (trace === null) return
      const signature = JSON.stringify(inspect())
      if (trace.at(-1) !== signature) trace.push(signature)
    }
    new MutationObserver(record).observe(document.getElementById('panel'), { subtree: true, childList: true, attributes: true, characterData: true })
    window.historyPath = {
      requests, registered, inspect,
      release: (id, supported) => requests[id].release(supported),
      releaseEmpty: (id) => requests[id].release(true, true),
      startTrace: () => { trace = []; record() },
      finishTrace: () => { record(); const result = trace; trace = null; return result },
      frames: async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => requestAnimationFrame(resolve)) },
    }
    window.__getLoaded().apply(ctx)
    const panel = document.getElementById('panel')
    panel.style.width = `${width}px`
    panel.style.height = `${height}px`
    window.historyPath.mount = () => {
      const component = registered[host === 'sidebar' ? 'sidebar.right.pane.tab::@xbzbing/dsh-git-panel' : 'conversation.view']
      if (!component) throw new Error(`missing ${host} panel registration`)
      window.ReactDOM.createRoot(panel).render(component({ sessionId: 'history-path', useTabInfo: () => ({ tab: { visible: true } }), t: (key) => key }))
    }
  }, { host, width, height, fontDelta, automatic })
  await page.waitForFunction((host) => window.historyPath.registered[host === 'sidebar' ? 'sidebar.right.pane.tab::@xbzbing/dsh-git-panel' : 'conversation.view'] !== undefined, host)
  await page.evaluate(() => window.historyPath.mount())
  await page.waitForSelector('.gp-history-search')
  return { page, errors }
}

const frames = (page) => page.evaluate(() => window.historyPath.frames())
const count = (page) => page.evaluate(() => window.historyPath.requests.length)
const inspect = (page) => page.evaluate(() => JSON.stringify(window.historyPath.inspect()))
const scope = (page) => page.locator('.gp-history-search')
const input = (page) => scope(page).locator('input.gp-search')
const trigger = (page) => scope(page).locator('.gp-search-scope__trigger')
const pathItem = (page) => page.getByRole('menuitem').filter({ hasText: PATH })

async function waitRequest(page, after, expected) {
  await page.waitForFunction(({ after, expected }) => window.historyPath.requests.some((r) => r.id >= after
    && Object.entries(expected).every(([key, value]) => (r.query[key] ?? '') === value)), { after, expected })
  return page.evaluate(({ after, expected }) => {
    const request = window.historyPath.requests.find((r) => r.id >= after
      && Object.entries(expected).every(([key, value]) => (r.query[key] ?? '') === value))
    return { id: request.id, query: request.query, subject: request.subject }
  }, { after, expected })
}

async function release(page, request, supported = true) {
  await page.evaluate(({ id, supported }) => window.historyPath.release(id, supported), { id: request.id, supported })
  await page.waitForFunction((id) => window.historyPath.requests[id].completed, request.id)
  await frames(page)
}

async function published(page, request) {
  await page.waitForFunction((subject) => window.historyPath.inspect()[0]?.subject === subject, request.subject)
  await frames(page)
}

async function pickScope(page, label) {
  await trigger(page).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
  await page.waitForSelector('[role="menu"]', { state: 'detached' })
}

async function assertPending(page, request, before, label) {
  await frames(page)
  assert.equal(await page.evaluate((id) => window.historyPath.requests[id].released, request.id), false, `${label}: reply is controlled by the test`)
  assert.equal(await inspect(page), before, `${label}: waiting preserves the complete previous rows and graph`)
}

async function assertRequests(page) {
  const requests = await page.evaluate(() => window.historyPath.requests.map(({ query, released, completed }) => ({ query, released, completed })))
  assert.ok(requests.length > 0)
  for (const { query, released, completed } of requests) {
    assert.ok(!(query.search && query.pathSearch), `search scopes are mutually exclusive: ${JSON.stringify(query)}`)
    assert.equal(query.skip, 0, 'this runner only drives page zero; paging has its own host tests')
    assert.equal(released && completed, true, 'every deferred response is explicitly released')
  }
}

async function interactions() {
  const { page, errors } = await boot()
  try {
    const initial = await waitRequest(page, 0, { search: '', pathSearch: '' })
    assert.equal(await scope(page).getAttribute('data-search-scope'), 'message', 'default scope is message/hash')
    assert.equal(await input(page).getAttribute('aria-label'), '搜索提交（消息 / 哈希）')
    await trigger(page).focus()
    await page.keyboard.press('Enter')
    assert.equal(await trigger(page).getAttribute('aria-expanded'), 'true', 'native Enter opens the scope menu')
    assert.equal(await pathItem(page).isDisabled(), true, 'path scope stays disabled until capability arrives')
    assert.match(await pathItem(page).innerText(), /正在确认路径搜索支持/)
    await page.keyboard.press('Escape')
    await page.waitForSelector('[role="menu"]', { state: 'detached' })
    assert.equal(await trigger(page).getAttribute('aria-expanded'), 'false', 'Escape closes the menu')
    await release(page, initial)
    await published(page, initial)

    let after = await count(page)
    await input(page).fill('message needle')
    const message = await waitRequest(page, after, { search: 'message needle', pathSearch: '' })
    await release(page, message)
    await published(page, message)
    const beforeMode = await inspect(page)
    after = await count(page)
    // The platform stub has native buttons and Escape, but no portal or arrow-key
    // navigation. Tab/Enter below exercise the browser's actual keyboard events.
    await trigger(page).focus()
    await page.keyboard.press('Enter')
    assert.equal(await pathItem(page).isEnabled(), true, 'ordinary history advertises path support')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    assert.equal(await pathItem(page).evaluate((node) => document.activeElement === node), true, 'native Tab reaches the enabled path item')
    await page.keyboard.press('Enter')
    await page.waitForSelector('[role="menu"]', { state: 'detached' })
    assert.equal(await scope(page).getAttribute('data-search-scope'), 'path')
    assert.equal(await input(page).inputValue(), 'message needle', 'scope switch preserves the input')
    assert.equal(await input(page).getAttribute('aria-label'), '搜索文件名 / 路径')
    assert.equal(await input(page).getAttribute('maxlength'), '1024')
    const path = await waitRequest(page, after, { pathSearch: 'message needle', search: '' })
    await assertPending(page, path, beforeMode, 'message to path')
    await release(page, path)
    await published(page, path)

    after = await count(page)
    await input(page).fill('abcdef1')
    const hex = await waitRequest(page, after, { pathSearch: 'abcdef1', search: '' })
    assert.equal(Object.hasOwn(hex.query, 'search'), false, 'hash-shaped path sends no message/hash search field')
    await release(page, hex)
    await published(page, hex)

    const race = async (label, startStale, startLatest, staleCapability = true) => {
      const before = await inspect(page)
      await page.evaluate(() => window.historyPath.startTrace())
      const stale = await startStale()
      await assertPending(page, stale, before, label)
      const latest = await startLatest()
      await assertPending(page, latest, before, label)
      await release(page, latest)
      await published(page, latest)
      const accepted = await inspect(page)
      await release(page, stale, staleCapability)
      assert.equal(await inspect(page), accepted, `${label}: delayed old reply cannot overwrite the latest result`)
      const trace = await page.evaluate(() => window.historyPath.finishTrace())
      assert.ok(trace.includes(accepted), `${label}: observed the accepted publication`)
      assert.ok(trace.every((signature) => signature === before || signature === accepted), `${label}: no mixed or stale rows/graph flash`)
    }
    await race('scope race', async () => {
      const start = await count(page)
      await input(page).fill('slow/path')
      return waitRequest(page, start, { pathSearch: 'slow/path', search: '' })
    }, async () => {
      const start = await count(page)
      await pickScope(page, MESSAGE)
      await input(page).fill('latest message')
      return waitRequest(page, start, { search: 'latest message', pathSearch: '' })
    }, false)
    await trigger(page).click()
    assert.equal(await pathItem(page).isEnabled(), true, 'stale reply without capability cannot downgrade current support')
    await page.keyboard.press('Escape')

    after = await count(page)
    // One task: every scope/text change tears down the previous 300 ms debounce
    // before it can fire, so this asserts cancellation without racing the clock.
    // Type in path mode, switch scope and type again right away. If the first
    // debounce survived the switch, a pathSearch request for the abandoned text
    // would appear. The menu needs one frame to render in this React build, so
    // the window is two frames plus two input events, not three CDP round trips.
    const switchMs = await page.evaluate(async ({ message, path }) => {
      const started = performance.now()
      const trigger = document.querySelector('.gp-history-search .gp-search-scope__trigger')
      const field = document.querySelector('.gp-history-search input')
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
      const setValue = (value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value)
        field.dispatchEvent(new Event('input', { bubbles: true }))
      }
      setValue('cancelled path')
      trigger.click()
      await frame()
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((node) => node.textContent === message)
      if (item === undefined) throw new Error('missing scope item ' + message)
      item.click()
      await frame()
      setValue('final message')
      if (!path) throw new Error('path label is required')
      return performance.now() - started
    }, { message: MESSAGE, path: PATH })
    const finalMessage = await waitRequest(page, after, { search: 'final message', pathSearch: '' })
    await release(page, finalMessage)
    await published(page, finalMessage)
    const cancelled = await page.evaluate(() => window.historyPath.requests.filter((r) =>
      r.query.pathSearch === 'cancelled path').map((r) => r.query))
    assert.deepEqual(cancelled, [], `no debounce survives the scope switch (${Math.round(switchMs)} ms)`)

    // A supported host answering with no match is the ordinary empty history:
    // not a failed load and not a capability notice.
    after = await count(page)
    await pickScope(page, PATH)
    const carried = await waitRequest(page, after, { pathSearch: 'final message', search: '' })
    await release(page, carried)
    await published(page, carried)
    after = await count(page)
    await input(page).fill('no-such/path')
    const none = await waitRequest(page, after, { pathSearch: 'no-such/path', search: '' })
    await page.evaluate((id) => window.historyPath.releaseEmpty(id), none.id)
    await page.waitForFunction((id) => window.historyPath.requests[id].completed, none.id)
    await frames(page)
    assert.equal(await page.locator('.gp-history .gp-empty').innerText(), '没有匹配的提交')
    assert.equal(await page.locator('.gp-history [role="status"]').count(), 0, 'an empty match raises no capability notice')
    await trigger(page).click()
    assert.equal(await pathItem(page).isEnabled(), true, 'an empty match keeps the scope available')
    await page.keyboard.press('Escape')

    // A message value above the path cap is truncated when its scope changes,
    // so the first path request cannot be rejected for length.
    after = await count(page)
    await pickScope(page, MESSAGE)
    await input(page).fill('x'.repeat(1100))
    const longMessage = await waitRequest(page, after, { search: 'x'.repeat(1100), pathSearch: '' })
    await release(page, longMessage)
    await pickScope(page, PATH)
    assert.equal((await input(page).inputValue()).length, 1024, 'switching to path truncates the carried value')
    const clamped = await waitRequest(page, after, { pathSearch: 'x'.repeat(1024), search: '' })
    await release(page, clamped)
    await frames(page)

    await race('keyword race', async () => {
      const start = await count(page)
      await input(page).fill('old/keyword')
      return waitRequest(page, start, { pathSearch: 'old/keyword', search: '' })
    }, async () => {
      const start = await count(page)
      await input(page).fill('new/keyword')
      return waitRequest(page, start, { pathSearch: 'new/keyword', search: '' })
    })

    after = await count(page)
    await page.locator('.gp-col--left .gp-tree-name').filter({ hasText: /^feature$/ }).click()
    const ref = await waitRequest(page, after, { pathSearch: 'new/keyword', ref: 'feature' })
    await release(page, ref)
    await published(page, ref)
    const filterTriggers = page.locator('.gp-history .gp-select-trigger:not(.gp-search-scope__trigger)')
    after = await count(page)
    await filterTriggers.nth(0).click()
    await page.getByRole('menuitem', { name: 'Tester', exact: true }).click()
    const author = await waitRequest(page, after, { pathSearch: 'new/keyword', ref: 'feature', author: 'Tester' })
    await release(page, author)
    await published(page, author)
    after = await count(page)
    await filterTriggers.nth(1).click()
    await page.getByRole('menuitem', { name: '近 7 天', exact: true }).click()
    const combined = await waitRequest(page, after, { pathSearch: 'new/keyword', ref: 'feature', author: 'Tester', since: '7 days ago', search: '' })
    await release(page, combined)
    await published(page, combined)
    after = await count(page)
    await input(page).fill('')
    const cleared = await waitRequest(page, after, { pathSearch: '', search: '', ref: 'feature', author: 'Tester', since: '7 days ago' })
    assert.equal(Object.hasOwn(cleared.query, 'pathSearch'), false, 'clear removes the path filter from the request')
    assert.equal(Object.hasOwn(cleared.query, 'search'), false, 'clear leaves no message filter')
    await release(page, cleared)
    await published(page, cleared)
    assert.equal(await scope(page).getAttribute('data-search-scope'), 'path', 'clear keeps the selected scope')

    after = await count(page)
    await input(page).fill('supported/path')
    const supported = await waitRequest(page, after, { pathSearch: 'supported/path' })
    await release(page, supported)
    await published(page, supported)
    const beforeUnsupported = await inspect(page)
    after = await count(page)
    await input(page).fill('host-lost-capability')
    const unsupported = await waitRequest(page, after, { pathSearch: 'host-lost-capability' })
    await assertPending(page, unsupported, beforeUnsupported, 'host capability loss')
    await release(page, unsupported, false)
    assert.equal(await inspect(page), beforeUnsupported, 'path reply without capability cannot publish unfiltered host results')
    assert.equal(await scope(page).getAttribute('data-search-scope'), 'path', 'unsupported reply does not silently switch scopes')
    assert.equal(await input(page).inputValue(), 'host-lost-capability')
    assert.equal(await page.locator('.gp-history [role="status"]').innerText(), UNSUPPORTED, 'unsupported path response displays the Chinese notice')
    await trigger(page).click()
    assert.equal(await pathItem(page).isDisabled(), true, 'capability loss disables path selection')
    assert.match(await pathItem(page).innerText(), /请更新并重新加载宿主/)
    await page.keyboard.press('Escape')
    await page.locator('.gp-history').screenshot({ path: fileURLToPath(new URL('unsupported-host.png', OUT)) })
    await assertRequests(page)
    assert.deepEqual(errors, [], 'interaction fixture has no frontend errors')
    console.log('history path search interactions: PASS')
  } finally {
    await page.close()
  }
}

async function oldHost() {
  const { page, errors } = await boot()
  try {
    const initial = await waitRequest(page, 0, { search: '', pathSearch: '' })
    await release(page, initial, false)
    await published(page, initial)
    await trigger(page).click()
    assert.equal(await pathItem(page).isDisabled(), true, 'old host without capability disables the path item')
    assert.match(await pathItem(page).innerText(), /请更新并重新加载宿主/)
    assert.doesNotMatch(await pathItem(page).innerText(), /正在确认/)
    await page.keyboard.press('Escape')
    const after = await count(page)
    await input(page).fill('abcdef1')
    const hash = await waitRequest(page, after, { search: 'abcdef1', pathSearch: '' })
    assert.equal(Object.hasOwn(hash.query, 'pathSearch'), false, 'old host still receives ordinary message/hash requests')
    await release(page, hash, false)
    await published(page, hash)
    assert.equal(await scope(page).getAttribute('data-search-scope'), 'message')
    assert.equal(await page.locator('.gp-history [role="status"]').count(), 0, 'normal old-host history does not raise a path failure notice')
    await assertRequests(page)
    assert.deepEqual(errors, [], 'old-host fixture has no frontend errors')
    console.log('history path search old host: PASS')
  } finally {
    await page.close()
  }
}

async function layouts() {
  const reports = []
  for (const fontDelta of [0, 1, -1]) {
    for (const variant of [
      { name: 'wide', host: 'conversation', mode: 'wide', widths: [1400, 1000], height: 900 },
      { name: 'stacked', host: 'sidebar', mode: 'stacked', widths: [600, 420, 320], height: 900 },
      { name: 'compact', host: 'conversation', mode: 'compact', widths: [560, 304], height: 700 },
      { name: 'phone', host: 'sidebar', mode: 'compact', widths: [390, 304], height: 700, phone: true },
    ]) {
      const { page, errors } = await boot({ ...variant, width: variant.widths[0], fontDelta, automatic: true })
      try {
        await page.waitForSelector('.gp-commit-row')
        await pickScope(page, PATH)
        await input(page).fill('src/abcdef1.ts')
        await page.waitForFunction(() => window.historyPath.requests.at(-1)?.query.pathSearch === 'src/abcdef1.ts')
        for (const width of variant.widths) {
          const label = `${variant.name}/${width}/font${fontDelta}`
          await page.evaluate((width) => { document.getElementById('panel').style.width = `${width}px` }, width)
          await page.waitForFunction((mode) => document.querySelector('.gp-panel')?.getAttribute('data-layout') === mode, variant.mode).catch(async (error) => {
            const actual = await page.locator('.gp-panel').getAttribute('data-layout')
            throw new Error(`${label}: expected layout ${variant.mode}, got ${actual}`, { cause: error })
          })
          await page.mouse.move(0, 0)
          await frames(page)
          const measure = await page.evaluate(() => {
            const root = document.querySelector('.gp-panel')
            const bar = root.querySelector('.gp-history .gp-toolbar')
            const group = bar.querySelector('.gp-history-search')
            const input = group.querySelector('input')
            const trigger = group.querySelector('.gp-search-scope__trigger')
            const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
            const zoom = Number(getComputedStyle(root).zoom) || 1
            return {
              zoom, layout: root.getAttribute('data-layout'), root: rect(root), bar: rect(bar), group: rect(group), input: rect(input), trigger: rect(trigger),
              inputCssWidth: input.getBoundingClientRect().width / zoom,
              barOverflow: bar.scrollWidth - bar.clientWidth,
              groupOverflow: group.scrollWidth - group.clientWidth,
              // Rows are counted by laid-out top: a wrapped toolbar leaves the
              // refresh button alone on a second line, which no overflow check sees.
              barRows: new Set([...bar.children].map((node) => Math.round(node.getBoundingClientRect().top))).size,
              inputValue: input.value, scope: group.getAttribute('data-search-scope'),
              coarse: matchMedia('(pointer: coarse)').matches,
            }
          })
          reports.push({ label, ...measure })
          const failedGeometry = measure.inputCssWidth < 60
            || Math.abs(measure.input.height - measure.trigger.height) > 1
            || Math.abs(measure.input.y - measure.trigger.y) > 1
            || measure.barOverflow > 1 || measure.groupOverflow > 1
          if (fontDelta === 0 || width === variant.widths.at(-1) || failedGeometry) {
            await page.locator('.gp-panel').screenshot({ path: fileURLToPath(new URL(`${variant.name}-${width}-font${fontDelta}.png`, OUT)) })
          }
          assert.equal(measure.layout, variant.mode, `${label}: intended layout is exercised`)
          assert.equal(measure.zoom, fontDelta === 1 ? 1.08 : fontDelta === -1 ? 0.92 : 1, `${label}: configured font zoom is exercised`)
          assert.equal(measure.coarse, variant.phone === true, `${label}: pointer matches the device fixture`)
          assert.ok(measure.inputCssWidth >= 60, `${label}: input retains at least 60 usable CSS px: ${JSON.stringify(measure)}`)
          assert.ok(Math.abs(measure.input.height - measure.trigger.height) <= 1, `${label}: scope button and input have equal height (${measure.trigger.height}/${measure.input.height})`)
          assert.ok(Math.abs(measure.input.y - measure.trigger.y) <= 1, `${label}: scope and input share one row`)
          assert.ok(measure.trigger.width >= 24 * measure.zoom, `${label}: scope entry remains reachable`)
          assert.ok(measure.input.right <= measure.bar.right + 1 && measure.trigger.x >= measure.bar.x - 1, `${label}: search controls stay inside the toolbar`)
          assert.ok(measure.barOverflow <= 1, `${label}: toolbar has no horizontal overflow (${measure.barOverflow})`)
          if (variant.mode === 'wide') {
            assert.equal(measure.barRows, 1, `${label}: the wide toolbar keeps every control on one row: ${JSON.stringify(measure)}`)
          }
          assert.ok(measure.groupOverflow <= 1, `${label}: compound search has no horizontal overflow (${measure.groupOverflow})`)
          assert.equal(measure.scope, 'path')
          assert.equal(measure.inputValue, 'src/abcdef1.ts', `${label}: resizing keeps the path text`)
          // Menu is an inline stub: screenshot and geometry use its closed state.
          // Open/dismiss assertions only cover its supported observable contract.
          await trigger(page).focus()
          await page.keyboard.press('Enter')
          assert.equal(await pathItem(page).isEnabled(), true, `${label}: scope menu can be opened by keyboard`)
          await page.keyboard.press('Escape')
          await page.waitForSelector('[role="menu"]', { state: 'detached' })
          assert.equal(await trigger(page).getAttribute('aria-expanded'), 'false', `${label}: Escape dismisses the menu`)
        }
        await assertRequests(page)
        assert.deepEqual(errors, [], `${variant.name}/font${fontDelta}: no frontend errors`)
      } finally {
        await page.close()
      }
    }
  }
  console.log('history path search layouts: PASS', JSON.stringify(reports.map((r) => ({
    label: r.label, layout: r.layout, inputCssWidth: Math.round(r.inputCssWidth), barRows: r.barRows,
    barOverflow: r.barOverflow, groupOverflow: r.groupOverflow,
  }))))
}

try {
  await interactions()
  await oldHost()
  await layouts()
} finally {
  await browser.close()
}
