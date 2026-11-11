/**
 * HTML preview lifecycle: the async state machine behind the rendered HTML view.
 *
 * The happy-path runners (`run.mjs`) prove the modes, the heavy-document
 * question, the mask and the reader. This runner locks what those cannot see,
 * because their RPCs answer immediately:
 *
 *  - a pack that is still in flight holds the source preview and mounts no
 *    frame, so the raw page never runs first and then gets thrown away;
 *  - a late pack (cancelled by a file switch, or by unmounting the tab) cannot
 *    mount a frame or create an object URL;
 *  - a manual refresh keeps the heavy-document approval and the script
 *    preference of the same path, while selecting that path again resets both;
 *  - object URLs are released when the rendered view goes away;
 *  - a page that declares no charset still decodes as UTF-8, because the frame
 *    is a blob: and the blob's own type is the only label it gets.
 *
 * Self-contained: its own fixtures and a file-content route the test can park,
 * so a "delayed" asset read is a genuine in-flight request rather than a sleep.
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
--dsw-alias-state-business-primary:#4176e6;--dsw-alias-state-error-primary:#ec1313;
--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#f59e0b;
background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
#panel,#panel-b{border:0!important}`

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: '44638f7', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

// The page's own script reports a load, so "did this document run?" is answered
// by the document itself: the panel cannot read into the opaque frame.
const page = (mark, extra = '') => `<!doctype html><title>${mark}</title>${extra}<p>${mark} MARK</p><script>parent.postMessage('page-load:${mark}','*')</script>`
const FILES = {
  // A relative stylesheet: packing reads `race.css` through file-content, which
  // is the request this runner parks.
  'race.html': page('RACE', '<link rel="stylesheet" href="race.css">'),
  'race.css': 'body { color: rgb(9, 9, 9); }\n',
  // No asset references, so packing settles within a microtask (plain bytes).
  'other.html': page('OTHER'),
  'light.html': page('LIGHT'),
  // An inline script past the 512 KiB confirmation threshold.
  'heavy.html': `<!doctype html><title>HEAVY</title><p>HEAVY MARK</p><script>/*${'x'.repeat(600 * 1024)}*/parent.postMessage('page-load:HEAVY','*')</script>`,
  // No `<meta charset>` and no BOM on purpose: a blob: frame carries no headers
  // and is not encoding-sniffed, so only the blob's own label makes this page
  // readable.
  'zh.html': '<!doctype html><title>ZH</title><p>A · Q 版抱鲸鱼</p>',
}
const TREE = [['race.html', false], ['race.css', false], ['other.html', false], ['light.html', false], ['heavy.html', false], ['zh.html', false]]

const browser = await chromium.launch()

async function boot(id = 'panel') {
  const p = await browser.newPage({ viewport: { width: 1000, height: 720 } })
  await p.goto(harness)
  await p.addStyleTag({ content: THEME })
  // Installed before the bundle runs: the panel must reach the spied globals.
  await p.evaluate(() => {
    window.__loads = {}
    window.addEventListener('message', (event) => {
      const data = event.data
      if (typeof data !== 'string' || !data.startsWith('page-load:')) return
      const mark = data.slice('page-load:'.length)
      window.__loads[mark] = (window.__loads[mark] ?? 0) + 1
    })
    // Object-URL ledger: every URL the panel creates, with the document it
    // carries (the blob is wrapped with the ready-ping script, so a mark in the
    // text still identifies the page).
    const created = []
    const revoked = []
    const realCreate = URL.createObjectURL.bind(URL)
    const realRevoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      const url = realCreate(blob)
      const record = { url, text: '' }
      created.push(record)
      void blob.text().then((text) => { record.text = text })
      return url
    }
    URL.revokeObjectURL = (url) => { revoked.push(url); realRevoke(url) }
    window.__blob = { created, revoked }
  })
  await p.addScriptTag({ path: resolve(E2E, 'client.js') })
  await p.evaluate(async ({ snap, id, tree, files }) => {
    const ctl = {
      tree: { '': tree.map(([name, dir]) => [name, dir]) },
      files,
      // Every file-content read, in order: proves which asset the packer asked
      // for, and that no read happened before the user opted into the preview.
      contentCalls: [],
      // Paths whose file-content answer parks until the test releases it.
      parkPaths: [],
      parked: [],
    }
    window.__ctl = ctl
    const listing = (path) => (ctl.tree[path] ?? []).map(([name, dir]) => dir ? { name, dir } : { name, dir, size: 12 })
    const connection = { rpc: { call: async (_channel, endpoint, payload) => {
      const request = payload && payload.args && payload.args.request
      if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
      if (endpoint === 'dbGitPanel/query') {
        const q = request.query
        if (q.kind === 'dir-list') {
          return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries: listing(q.path) } } }
        }
        if (q.kind === 'file-content') {
          ctl.contentCalls.push(q.path)
          if (ctl.parkPaths.includes(q.path)) await new Promise((r) => ctl.parked.push(r))
          const content = ctl.files[q.path] ?? ''
          const variant = q.path.endsWith('.css') ? 'text' : 'text'
          return { ok: true, value: { ok: true, value: { kind: 'file-content', path: q.path, variant, content, lines: content.split('\n').length - 1, size: content.length } } }
        }
        if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: '44638f7' }], remote: [] } } }
        if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
        if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
        if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 0, commits: [] } } }
        if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
      }
      if (endpoint === 'dbGitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
      if (endpoint === 'dbGitPanel/version') return { ok: true, value: { current: '1.8.2', repositoryUrl: '', updateAvailable: false, checkedRemote: false } }
      return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
    } } }
    const registered = {}
    const dictionaries = {}
    const ctx = {
      get: (key) => ({ connection })[key],
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: () => () => {},
      inject: (_deps, cb) => cb(ctx),
      slots: { inject: (_name, provider) => provider(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
      locale: {
        register: (ns, dict) => { dictionaries[ns] = dict },
        // Keys, not translations: assertions then read the same identifiers the
        // source uses and never depend on a locale's wording.
        bind: () => (key) => key,
      },
    }
    window.__getLoaded().apply(ctx)
    await new Promise((r) => setTimeout(r, 300))
    const host = document.getElementById(id)
    host.style.width = '960px'
    host.style.height = '640px'
    const root = window.ReactDOM.createRoot(host)
    root.render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    window.__root = root
    // Page-side drivers: every helper is a real page function, so a step is one
    // evaluate instead of a dozen round-trips.
    window.__t = {
      row(name) { return [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').trim() === name) ?? null },
      select(name) { const row = this.row(name); if (row === null) throw new Error('no tree row ' + name); row.click() },
      modeTab(label) { return [...document.querySelectorAll('.gp-files__bar [role="tab"]')].find((b) => b.textContent === label) ?? null },
      mode(label) { const tab = this.modeTab(label); if (tab === null) throw new Error('no mode tab ' + label); tab.click() },
      frame() { return document.querySelector('.gp-files__html') },
      frameSrc() { return this.frame()?.getAttribute('src') ?? '' },
      frameSrcdoc() { return this.frame()?.getAttribute('srcdoc') ?? '' },
      async frameBody() {
        const frame = this.frame()
        if (frame === null) return ''
        const src = frame.getAttribute('src') || ''
        return src === '' ? (frame.getAttribute('srcdoc') || '') : await (await fetch(src)).text()
      },
      code() { return document.querySelector('.gp-files__code')?.textContent ?? '' },
      heavyModal() { return document.querySelector('[data-gp-heavy-modal]')?.closest('.gp-modal') ?? null },
      heavyButton(key) { return [...(this.heavyModal()?.querySelectorAll('button') ?? [])].find((b) => (b.textContent || '').trim() === key) ?? null },
      jsToggle() { return document.querySelector('.gp-files__scripts') },
      refresh() { document.querySelector('.gp-files__refresh')?.click() },
      blobMarks() { return window.__blob.created.map((r) => ({ url: r.url, mark: r.text.includes('RACE MARK') ? 'RACE' : r.text.includes('OTHER MARK') ? 'OTHER' : r.text.includes('LIGHT MARK') ? 'LIGHT' : r.text.includes('HEAVY MARK') ? 'HEAVY' : '?' })) },
    }
    await new Promise((r) => setTimeout(r, 500))
  }, { snap: SNAP, id, tree: TREE, files: FILES })
  await p.evaluate(() => {
    ;[...document.querySelectorAll('.gp-tabbar [role="tab"], .gp-tabbar button')]
      .find((t) => /tab\.files|文件浏览/.test(t.textContent || ''))?.click()
  })
  await p.waitForFunction(() => document.querySelectorAll('.gp-files__tree .gp-tree-row').length > 0, null, { timeout: 5000 })
  return p
}

/** Park the next read of `path` so the pack stays in flight. */
const park = (p, path) => p.evaluate((target) => { if (!window.__ctl.parkPaths.includes(target)) window.__ctl.parkPaths.push(target) }, path)
/** Release every parked read; later reads answer immediately. */
const release = (p) => p.evaluate(() => {
  window.__ctl.parkPaths = []
  const parked = window.__ctl.parked
  window.__ctl.parked = []
  for (const resolve of parked) resolve()
})
const waitParked = (p) => p.waitForFunction(() => window.__ctl.parked.length > 0, null, { timeout: 5000 })
const waitFrame = (p) => p.waitForFunction(() => document.querySelector('.gp-files__html') !== null, null, { timeout: 5000 })
/** The mounted blob: frame, once its navigation has committed. */
const waitBlobFrame = async (p) => {
  for (let tries = 0; tries < 100; tries += 1) {
    const frame = p.frames().find((candidate) => candidate !== p.mainFrame() && candidate.url().startsWith('blob:'))
    if (frame !== undefined) return frame
    await p.waitForTimeout(50)
  }
  return undefined
}
/** Select a tree row and wait for the toolbar that carries the mode switcher. */
const selectFile = async (p, name) => {
  await p.evaluate((target) => window.__t.select(target), name)
  await p.waitForFunction(() => window.__t.modeTab('files.render') !== null, null, { timeout: 5000 })
}
/** Switch the source/render view of the already selected file. */
const setMode = async (p, label) => {
  await p.evaluate((target) => window.__t.mode(target), label)
}

const errors = []
const watch = (p) => {
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
}

// ── 1. An in-flight pack holds the source preview and mounts nothing ───────
{
  const p = await boot()
  watch(p)
  await selectFile(p, 'race.html')
  // HTML defaults to source: selecting it reads the page only, never its assets.
  await p.waitForFunction(() => window.__ctl.contentCalls.includes('race.html'), null, { timeout: 5000 })
  const atSource = await p.evaluate(() => ({
    assets: window.__ctl.contentCalls.filter((c) => c === 'race.css').length,
    frame: window.__t.frame() !== null,
    blobs: window.__blob.created.length,
    code: window.__t.code(),
  }))
  assert.equal(atSource.frame, false, 'the source view is the default: no frame before the reader asks to render')
  assert.equal(atSource.assets, 0, 'selecting an HTML page does not read its assets (packing runs only for the rendered view)')
  assert.equal(atSource.blobs, 0, 'no object URL is created for the source view')
  assert.ok(atSource.code.includes('RACE MARK'), 'the source view shows the page bytes')

  await park(p, 'race.css')
  await setMode(p, 'files.render')
  await waitParked(p)
  const inFlight = await p.evaluate(() => ({
    assets: window.__ctl.contentCalls.filter((c) => c === 'race.css').length,
    frame: window.__t.frame() !== null,
    blobs: window.__blob.created.length,
    code: window.__t.code(),
    loads: window.__loads.RACE ?? 0,
  }))
  assert.equal(inFlight.assets, 1, 'the rendered view reads the relative stylesheet through file-content')
  assert.equal(inFlight.frame, false, 'the frame is not mounted while the pack is in flight (the raw page never runs first)')
  assert.equal(inFlight.blobs, 0, 'no object URL exists before the pack settles')
  assert.equal(inFlight.loads, 0, 'the page has not run at all yet')
  assert.ok(inFlight.code.includes('RACE MARK'), 'the source preview is held instead of a blank pane')

  await release(p)
  await waitFrame(p)
  await p.waitForFunction(() => (window.__loads.RACE ?? 0) > 0, null, { timeout: 5000 })
  const settled = await p.evaluate(async () => ({
    src: window.__t.frameSrc(),
    sandbox: window.__t.frame()?.getAttribute('sandbox') ?? null,
    body: await window.__t.frameBody(),
    loads: window.__loads.RACE ?? 0,
    blobs: window.__t.blobMarks(),
  }))
  assert.ok(settled.src.startsWith('blob:'), 'the interactive frame travels through a blob: URL')
  assert.equal(settled.sandbox, 'allow-scripts', 'the interactive frame keeps allow-scripts without allow-same-origin')
  assert.ok(settled.body.includes('data:text/css;base64,'), 'the settled document carries the inlined stylesheet')
  assert.equal(settled.loads, 1, 'the page ran exactly once: the raw bytes were never mounted and replaced')
  assert.deepEqual(settled.blobs.map((b) => b.mark), ['RACE'], 'exactly one document was ever handed to the frame')

  // ── 3. Leaving the rendered view releases the object URL ──────────────────
  const live = settled.blobs[0].url
  await setMode(p, 'files.source')
  await p.waitForFunction(() => document.querySelector('.gp-files__html') === null, null, { timeout: 5000 })
  const revoked = await p.evaluate(() => window.__blob.revoked.slice())
  assert.ok(revoked.includes(live), 'switching back to the source view revokes the object URL it created')
  assert.deepEqual(await p.evaluate(() => window.__loads.RACE ?? 0), 1, 'leaving the rendered view does not re-run the page')
  await p.close()
}

// ── 2. A late pack cannot take over the file that replaced it ─────────────
{
  const p = await boot()
  watch(p)
  await park(p, 'race.css')
  await selectFile(p, 'race.html')
  await setMode(p, 'files.render')
  await waitParked(p)
  assert.equal(await p.evaluate(() => window.__t.frame() !== null), false, 'the first document is still packing')

  // Switch to a page whose pack settles immediately, then let the first one land.
  await selectFile(p, 'other.html')
  await setMode(p, 'files.render')
  await waitFrame(p)
  await p.waitForFunction(() => (window.__loads.OTHER ?? 0) > 0, null, { timeout: 5000 })
  await release(p)
  // Give the stale promise every chance to run its continuation.
  await p.waitForTimeout(300)

  const after = await p.evaluate(async () => ({
    body: await window.__t.frameBody(),
    src: window.__t.frameSrc(),
    marks: window.__t.blobMarks().map((b) => b.mark),
    raceLoads: window.__loads.RACE ?? 0,
    raceAssets: window.__ctl.contentCalls.filter((c) => c === 'race.css').length,
  }))
  assert.ok(after.body.includes('OTHER MARK'), 'the frame still holds the file that is selected')
  assert.equal(after.body.includes('RACE MARK'), false, 'the late pack did not take over the preview')
  assert.deepEqual(after.marks, ['OTHER'], 'the stale pack created no document for the frame')
  assert.equal(after.raceLoads, 0, 'the abandoned page never ran')
  assert.equal(after.raceAssets, 1, 'the parked read was the abandoned document, not a retry')
  await p.close()
}

// ── 4. Refresh keeps the same path's approval and script preference ───────
{
  const p = await boot()
  watch(p)
  // Heavy document: rendering asks first; approving is remembered per path.
  await selectFile(p, 'heavy.html')
  await setMode(p, 'files.render')
  await p.waitForFunction(() => window.__t.heavyModal() !== null, null, { timeout: 5000 })
  await p.evaluate(() => window.__t.heavyButton('files.htmlHeavyRun')?.click())
  await waitFrame(p)
  const approved = await p.evaluate(() => ({ blobs: window.__blob.created.length, modal: window.__t.heavyModal() !== null }))
  assert.equal(approved.modal, false, 'approving closes the question')
  assert.ok(approved.blobs >= 1, 'the approved document is handed to the frame')

  await p.evaluate(() => window.__t.refresh())
  await p.waitForFunction((before) => window.__blob.created.length > before, approved.blobs, { timeout: 5000 })
  const refreshed = await p.evaluate(async () => ({
    modal: window.__t.heavyModal() !== null,
    frame: window.__t.frame() !== null,
    src: window.__t.frameSrc(),
    body: await window.__t.frameBody(),
  }))
  assert.equal(refreshed.modal, false, 'a manual refresh does not ask about the same path again')
  assert.equal(refreshed.frame, true, 'the refreshed document is rendered without a second confirmation')
  assert.ok(refreshed.src.startsWith('blob:'), 'the refreshed document is a fresh interactive frame')
  assert.ok(refreshed.body.includes('HEAVY MARK'), 'the refreshed bytes are the same document')

  // Script preference: turning JS off and refreshing keeps the static preview.
  await selectFile(p, 'light.html')
  await setMode(p, 'files.render')
  await waitFrame(p)
  await p.evaluate(() => window.__t.jsToggle()?.click())
  await p.waitForFunction(() => (document.querySelector('.gp-files__html')?.getAttribute('sandbox') ?? null) === '', null, { timeout: 5000 })
  const staticBefore = await p.evaluate(() => ({ blobs: window.__blob.created.length, pressed: window.__t.jsToggle()?.getAttribute('aria-pressed') }))
  assert.equal(staticBefore.pressed, 'false', 'the JS toggle is off')
  await p.evaluate(() => window.__t.refresh())
  // A refresh re-reads the file; wait for the read to land, then for the frame.
  await p.waitForFunction(() => window.__ctl.contentCalls.filter((c) => c === 'light.html').length >= 2, null, { timeout: 5000 })
  await p.waitForTimeout(300)
  const staticAfter = await p.evaluate(() => ({
    sandbox: window.__t.frame()?.getAttribute('sandbox') ?? null,
    srcdoc: window.__t.frameSrcdoc(),
    pressed: window.__t.jsToggle()?.getAttribute('aria-pressed'),
    blobs: window.__blob.created.length,
  }))
  assert.equal(staticAfter.sandbox, '', 'a refresh keeps the script preference: the preview stays static')
  assert.ok(staticAfter.srcdoc.includes('Content-Security-Policy'), 'the static preview keeps its CSP')
  assert.equal(staticAfter.pressed, 'false', 'the JS toggle still reads off')
  assert.equal(staticAfter.blobs, staticBefore.blobs, 'a static preview never creates an object URL, refreshed or not')

  // ── 5. Selecting the same path again resets both ────────────────────────
  await selectFile(p, 'light.html')
  await p.waitForTimeout(300)
  const reselected = await p.evaluate(() => ({
    frame: window.__t.frame() !== null,
    code: window.__t.code(),
    pressed: window.__t.jsToggle()?.getAttribute('aria-pressed') ?? null,
  }))
  assert.equal(reselected.frame, false, 'selecting a file goes back to its source view')
  assert.ok(reselected.code.includes('LIGHT MARK'), 'the source view shows the page bytes')
  assert.equal(reselected.pressed, null, 'the JS toggle only exists for the rendered view')

  await setMode(p, 'files.render')
  await waitFrame(p)
  const rerendered = await p.evaluate(() => ({
    sandbox: window.__t.frame()?.getAttribute('sandbox') ?? null,
    pressed: window.__t.jsToggle()?.getAttribute('aria-pressed'),
  }))
  assert.equal(rerendered.sandbox, 'allow-scripts', 'selecting the same path again restores the default script permission')
  assert.equal(rerendered.pressed, 'true', 'the JS toggle reads on again')

  // The heavy approval resets the same way: rendering asks once more.
  await selectFile(p, 'heavy.html')
  await setMode(p, 'files.render')
  await p.waitForFunction(() => window.__t.heavyModal() !== null, null, { timeout: 5000 })
  await p.evaluate(() => window.__t.heavyButton('files.htmlHeavyRun')?.click())
  await waitFrame(p)
  await selectFile(p, 'heavy.html')
  await p.waitForTimeout(300)
  assert.equal(await p.evaluate(() => window.__t.heavyModal() !== null), false, 'selecting the path again leaves the source view without a question')
  await setMode(p, 'files.render')
  await p.waitForFunction(() => window.__t.heavyModal() !== null, null, { timeout: 5000 })
  assert.equal(await p.evaluate(() => window.__t.frame() !== null), false, 'the question comes before the frame is mounted')
  await p.evaluate(() => window.__t.heavyButton('common.cancel')?.click())
  await p.close()
}

// ── 6. Unmounting releases the document the frame was built from ──────────
{
  const p = await boot()
  watch(p)
  await selectFile(p, 'light.html')
  await setMode(p, 'files.render')
  await waitFrame(p)
  await p.waitForFunction(() => (window.__loads.LIGHT ?? 0) > 0, null, { timeout: 5000 })
  const live = await p.evaluate(() => window.__blob.created.map((r) => r.url))
  assert.equal(live.length, 1, 'one document was handed to the frame')
  await p.evaluate(() => window.__root.unmount())
  await p.waitForTimeout(300)
  const after = await p.evaluate(() => ({ revoked: window.__blob.revoked.slice(), frame: document.querySelector('.gp-files__html') !== null }))
  assert.equal(after.frame, false, 'unmounting removes the frame')
  assert.ok(after.revoked.includes(live[0]), 'unmounting revokes the object URL')
  await p.close()
}

// ── 7. A pack that lands after unmount creates no document ────────────────
{
  const p = await boot()
  watch(p)
  await park(p, 'race.css')
  await selectFile(p, 'race.html')
  await setMode(p, 'files.render')
  await waitParked(p)
  const before = await p.evaluate(() => window.__blob.created.length)
  await p.evaluate(() => window.__root.unmount())
  await release(p)
  await p.waitForTimeout(400)
  const after = await p.evaluate(() => ({ created: window.__blob.created.length, loads: window.__loads.RACE ?? 0 }))
  assert.equal(after.created, before, 'a pack that settles after unmount creates no object URL')
  assert.equal(after.loads, 0, 'the abandoned page never ran')
  await p.close()
}

// ── 8. A page that declares no charset still decodes as UTF-8 ─────────────
{
  const p = await boot()
  watch(p)
  await selectFile(p, 'zh.html')
  await setMode(p, 'files.render')
  await waitFrame(p)
  // The frame is a blob: document on an opaque origin, so only the Playwright
  // frame handle can look inside it — the panel itself never can.
  const frame = await waitBlobFrame(p)
  assert.ok(frame !== undefined, 'the rendered page is mounted in a blob: frame')
  await frame.waitForFunction(() => document.body.innerText.trim() !== '', null, { timeout: 5000 })
  const seen = await frame.evaluate(() => ({ enc: document.characterSet, text: document.body.innerText.trim() }))
  assert.equal(seen.enc, 'UTF-8', 'the blob: type declares its encoding, so the browser never falls back to the platform default')
  assert.equal(seen.text, 'A · Q 版抱鲸鱼', 'text with no <meta charset> renders as authored instead of mojibake')
  await p.close()
}

// One console error is the behaviour under test, not a defect: the static
// preview of light.html denies that page's inline script. It must actually
// appear, so a silent regression cannot hide behind the allow list; every other
// console error stays fatal.
const expectedErrors = [
  { pattern: /frame is sandboxed and the 'allow-scripts' permission is not set/, seen: 'the static preview blocks the page script' },
]
for (const expected of expectedErrors) {
  assert.ok(errors.some((message) => expected.pattern.test(message)), `expected console error missing (${expected.seen}): ${JSON.stringify(errors)}`)
}
assert.deepEqual(
  errors.filter((message) => !expectedErrors.some((expected) => expected.pattern.test(message))),
  [],
  'no console errors: ' + JSON.stringify(errors),
)
await browser.close()
console.log('e2e html-preview-lifecycle.mjs: PASS')
