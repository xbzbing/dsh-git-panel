/**
 * E2E: the "open in the system browser" path for a heavy HTML document.
 *
 * Every other runner loads the harness from `file://`, where `location.hostname`
 * is empty and the panel must treat the instance as remote. This one serves the
 * same harness from `http://127.0.0.1`, i.e. a loopback GUI — the shape of a
 * local instance — and asserts the dialog then offers the local-open action and
 * really asks the host for it.
 *
 * Isolated like the rest: a local http server, a headless browser, no dsh.
 */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

const DIR = dirname(fileURLToPath(import.meta.url))

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: 'de54fc0', unborn: false, dirty: true,
  staged: 0, modified: 1, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', url: 'git@github.com:owner/repo.git', webUrl: 'https://github.com/owner/repo', host: 'github.com', hostKind: 'github' },
  lastCommit: null,
  changes: [{ path: 'a.txt', status: 'modified', staged: false, isDirectory: false }],
  stats: { fileCount: 1, staged: 0, modified: 1, untracked: 0, insertions: 1, deletions: 0, lastChangeAt: Date.now(), headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, defaultDiffView: 'unified', checkedAt: Date.now(),
}

// Serve the harness directory so the page has a loopback origin.
const server = createServer((req, res) => {
  const path = (req.url || '/').split('?')[0]
  const name = path === '/' ? '/harness.html' : path
  const type = name.endsWith('.html') ? 'text/html; charset=utf-8'
    : name.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : 'application/octet-stream'
  res.writeHead(200, { 'content-type': type })
  createReadStream(resolve(DIR, '.' + name)).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))

await page.goto(`http://127.0.0.1:${port}/harness.html`)
// The loader fetches the bundle per plugin; the fixtures use plain script tags.
await page.addScriptTag({ url: `http://127.0.0.1:${port}/client.js` })
await page.addScriptTag({ url: `http://127.0.0.1:${port}/mock-rpc.mjs` })

const out = await page.evaluate(async (snap) => {
  const { fixture, connection } = window.createGitPanelMock(snap)
  const entry = window.__getLoaded()
  if (!entry || typeof entry.apply !== 'function') return { error: 'plugin did not load' }

  const registered = {}
  const services = {
    connection,
    configForms: {
      describe: () => ({
        getSnapshot: () => ({ status: 'ready', view: { namespaces: [{ ns: 'dbGitPanel', schema: { dict: { showInputPill: {} } } }] }, revision: 0, writable: true }),
        subscribe: () => () => {},
        ensure: async () => {},
      }),
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: {}, revision: 0, writable: true }),
        subscribe: () => () => {},
        set: async () => true,
      }),
    },
  }
  // The same context shape the other runners build: services resolved through
  // `get`, slots keyed by registration name, locale bound to the raw key.
  const ctx = {
    get: (k) => services[k],
    effect: (cb) => { try { cb() } catch (e) { /* ignore */ } },
    on: (event, listener) => { if (event === 'connection/reset') fixture.resetConnection = listener; return () => {} },
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (name, provider) => provider(),
      register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} },
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
  }
  entry.apply(ctx)

  const React = window.React
  const ReactDOM = window.ReactDOM
  const viewEntry = registered['conversation.view']
  if (!viewEntry) return { error: 'no conversation.view slot' }
  const panelElement = viewEntry.component({ sessionId: 'sess-1' })
  ReactDOM.createRoot(document.getElementById('panel')).render(
    React.createElement(panelElement.type, panelElement.props)
  )
  await new Promise((r) => setTimeout(r, 500))

  const result = { origin: location.hostname }
  const tab = [...document.querySelectorAll('.gp-panel [role="tab"]')].find((t) => /files|文件/i.test(t.textContent || ''))
  tab?.click()
  await new Promise((r) => setTimeout(r, 400))

  // Expand to the heavy fixture and switch to the rendered view.
  const row = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').trim() === 'heavy.html')
  row?.click()
  await new Promise((r) => setTimeout(r, 500))
  const renderTab = [...document.querySelectorAll('.gp-files [role="tab"]')].find((t) => /render|渲染/i.test(t.textContent || ''))
  renderTab?.click()
  await new Promise((r) => setTimeout(r, 400))

  const modal = document.querySelector('[data-gp-heavy-modal]')?.closest('.gp-modal') ?? null
  result.treeRows = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].map((r) => (r.textContent || '').trim()).slice(0, 12)
  result.rowFound = row !== undefined
  result.renderTabFound = renderTab !== undefined
  result.modalShown = modal !== null
  const buttons = [...(modal?.querySelectorAll('button') ?? [])]
  result.hasOpenButton = buttons.some((b) => /OpenInBrowser|浏览器/i.test(b.textContent || ''))
  result.noRemoteNote = !(modal?.textContent || '').includes('files.htmlHeavyRemote')

  // Clicking it must ask the host, not mount a frame.
  buttons.find((b) => /OpenInBrowser|浏览器/i.test(b.textContent || ''))?.click()
  await new Promise((r) => setTimeout(r, 500))
  result.opened = fixture.openedFiles.slice()
  result.frameMounted = document.querySelector('.gp-files__html') !== null
  result.modalClosed = (document.querySelector('[data-gp-heavy-modal]')?.closest('.gp-modal') ?? null) === null
  return result
}, SNAP)

console.log('local-open: ' + JSON.stringify({ ...out, errors: errors.slice(0, 3) }))
assert.equal(out.origin, '127.0.0.1', 'the harness is served from loopback')
assert.equal(out.modalShown, true, 'a heavy document still asks in a modal')
assert.equal(out.hasOpenButton, true, 'a loopback GUI offers "open in the system browser"')
assert.equal(out.noRemoteNote, true, 'a loopback GUI does not claim the file is remote')
assert.deepEqual(out.opened, ['heavy.html'], 'the action asks the host to open that path')
assert.equal(out.frameMounted, false, 'opening externally does not mount a frame')
assert.equal(out.modalClosed, true, 'the dialog closes once the file is handed to the OS')
assert.deepEqual(errors, [], 'no console errors')

await browser.close()
server.close()
process.exit(0)
