/**
 * Files-tab edit mode, against the real CodeMirror chunk (harness.html loads
 * lib/client.editor.js through `require.async`).
 *
 * Locks: the edit button's three states; the save request (path / LF content /
 * base fingerprint) and the snapshot refresh after it; Tab indenting inside the
 * editor and undo; the pre-save YAML / JSON checks with "save anyway" and the
 * JSONC exemption; the conflict notice and its compare-and-swap overwrite; the
 * unsaved-change guard on picking another file; the fullscreen reader's key
 * split (Tab indents, Escape closes the search panel first); the chunk-failure
 * retry; the editor colours following the theme variables; the compact
 * toolbar keeping save / cancel on one row as text buttons; one write per
 * save however fast the keys come, and a leave asked mid-save waiting for its
 * answer; the reader hosting its own confirmations (focus inside, one Escape
 * closes one layer); host refusals in words, not wire tokens; the host's edit
 * switch hiding the entry; and a draft surviving the move into compact.
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
#panel{border:0!important}`

const SNAP = {
  root: 'fixture-repo', branch: 'main', head: '44638f7', unborn: false, dirty: false,
  staged: 0, modified: 0, untracked: 0, ahead: 0, behind: 0, hasUpstream: true,
  remote: { name: 'origin', webUrl: 'https://github.com/example/repo', hostKind: 'github' },
  lastCommit: null, changes: [],
  stats: { fileCount: 0, staged: 0, modified: 0, untracked: 0, insertions: 0, deletions: 0, lastChangeAt: null, headCommittedAt: null },
  truncated: false, refreshIntervalMs: 0, showInputPill: true, allowFileEdit: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()

async function boot(page, opts = {}) {
  await page.goto(harness)
  await page.addStyleTag({ content: THEME })
  await page.addScriptTag({ path: resolve(E2E, 'client.js') })
  await page.evaluate(async ({ snap, width, height, chunkFailures }) => {
    if (chunkFailures > 0) window.__chunkFailures = { 'client.editor.js': chunkFailures }
    const sha = (n) => String(n).repeat(64).slice(0, 64)
    const ctl = {
      files: {
        'notes.yaml': 'a: 1\nlist:\n  - x\n',
        'README.md': '# readme\n\nbody\n',
        'tsconfig.json': '{\n  // comment\n  "compilerOptions": {}\n}\n',
        'run.js': 'console.log(1)\n',
        'big.json': null,
        'other.txt': 'other\n',
      },
      version: {},
      writes: [], snapshots: 0,
      // 'ok' | 'conflict' | 'mixed-eol' | 'denied' (each refusal once)
      writeMode: 'ok',
      writeDelay: 0,
    }
    for (const path of Object.keys(ctl.files)) ctl.version[path] = 1
    window.__ctl = ctl
    const editable = (path) => /\.(?:yaml|md|json|txt)$/.test(path)
    const content = (path) => {
      const body = ctl.files[path]
      if (body === null) return { kind: 'file-content', path, variant: 'text', tooLarge: true, size: 3 * 1024 * 1024, edit: { ok: false, reason: 'too-large' } }
      return {
        kind: 'file-content', path, variant: 'text', content: body, lines: body.split('\n').length - 1, size: body.length,
        ...(editable(path) ? { sha256: sha(ctl.version[path]), edit: { ok: true, eol: 'lf', bom: false } } : {}),
      }
    }
    const connection = { rpc: { call: async (_channel, endpoint, payload) => {
      const request = payload && payload.args && payload.args.request
      if (endpoint === 'gitPanel/snapshot') { ctl.snapshots++; return { ok: true, value: { ok: true, value: snap } } }
      if (endpoint === 'gitPanel/writeFile') {
        ctl.writes.push(request)
        if (ctl.writeDelay > 0) await new Promise((r) => setTimeout(r, ctl.writeDelay))
        if (ctl.writeMode === 'mixed-eol' || ctl.writeMode === 'denied') {
          const mode = ctl.writeMode
          ctl.writeMode = 'ok'
          return { ok: true, value: mode === 'denied'
            ? { ok: false, error: { code: 'write-denied', message: 'EACCES' } }
            : { ok: false, error: { code: 'not-editable', reason: 'mixed-eol' } } }
        }
        if (ctl.writeMode === 'conflict') {
          ctl.writeMode = 'ok'
          ctl.version[request.path] = 7
          return { ok: true, value: { ok: false, error: { code: 'file-changed', currentSha256: sha(7) } } }
        }
        if (request.baseSha256 !== sha(ctl.version[request.path])) {
          return { ok: true, value: { ok: false, error: { code: 'file-changed', currentSha256: sha(ctl.version[request.path]) } } }
        }
        ctl.files[request.path] = request.content
        ctl.version[request.path] += 1
        return { ok: true, value: { ok: true, value: content(request.path) } }
      }
      if (endpoint === 'gitPanel/query') {
        const q = request.query
        if (q.kind === 'dir-list') {
          const entries = q.path === '' ? Object.keys(ctl.files).map((name) => ({ name, dir: false, size: 10 })) : []
          return { ok: true, value: { ok: true, value: { kind: 'dir-list', path: q.path, truncated: false, entries } } }
        }
        if (q.kind === 'file-content') return { ok: true, value: { ok: true, value: content(q.path) } }
        if (q.kind === 'branches') return { ok: true, value: { ok: true, value: { kind: 'branches', current: 'main', defaultBranch: null, local: [{ name: 'main', shortHash: '44638f7' }], remote: [] } } }
        if (q.kind === 'tags') return { ok: true, value: { ok: true, value: { kind: 'tags', tags: [] } } }
        if (q.kind === 'authors') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
        if (q.kind === 'history') return { ok: true, value: { ok: true, value: { kind: 'history', total: 0, commits: [] } } }
        if (q.kind === 'repo-list') return { ok: true, value: { ok: true, value: { kind: 'repo-list', cwd: '/w', repos: [] } } }
        if (q.kind === 'last-commit-message') return { ok: true, value: { ok: true, value: { kind: 'last-commit-message', message: '' } } }
      }
      if (endpoint === 'gitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
      if (endpoint === 'gitPanel/version') return { ok: true, value: { current: '1.10.0', repositoryUrl: '', updateAvailable: false, checkedRemote: false } }
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
        bind: (ns) => (key, params) => {
          const text = dictionaries[ns]?.zh?.[key] ?? key
          return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
        },
      },
    }
    window.__getLoaded().apply(ctx)
    await new Promise((r) => setTimeout(r, 300))
    const host = document.getElementById('panel')
    host.style.width = width + 'px'
    host.style.height = height + 'px'
    window.ReactDOM.createRoot(host).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 500))
    ;[...document.querySelectorAll('.gp-tabbar [role="tab"]')].find((t) => (t.textContent || '').includes('文件'))?.click()
    await new Promise((r) => setTimeout(r, 400))
  }, { snap: { ...SNAP, ...(opts.snap ?? {}) }, width: opts.width ?? 960, height: opts.height ?? 640, chunkFailures: opts.chunkFailures ?? 0 })
}

const errors = []
const watch = (page) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
}

const pick = (page, name) => page.evaluate((n) => {
  const row = [...document.querySelectorAll('.gp-files__tree .gp-tree-row')].find((r) => (r.textContent || '').trim() === n)
  row?.click()
}, name).then(() => page.waitForTimeout(250))

const startEdit = async (page) => {
  await page.click('.gp-files__edit')
  await page.waitForSelector('.gp-files__editor .cm-content', { timeout: 10000 })
}

const editorText = (page) => page.evaluate(() => [...document.querySelectorAll('.gp-files__editor .cm-line')].map((l) => l.textContent).join('\n'))

// ── Button states, edit → save, Tab, undo, theme ──────────────────────────
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } })
watch(page)
await boot(page)

await pick(page, 'run.js')
assert.equal(await page.$('.gp-files__edit'), null, 'a file outside the allow-list has no edit button')
await pick(page, 'big.json')
const big = await page.evaluate(() => {
  const btn = document.querySelector('.gp-files__edit')
  return btn === null ? null : { disabled: btn.getAttribute('aria-disabled') }
})
assert.deepEqual(big, { disabled: 'true' }, 'an allow-listed file over the cap shows a disabled edit button')
await page.hover('.gp-files__edit')
await page.waitForTimeout(500)
const bigTip = await page.evaluate(() => document.body.textContent || '')
assert.ok(bigTip.includes('文件超过 2 MiB'), 'the disabled button names its reason in the tip')
await page.click('.gp-files__edit', { force: true })
await page.waitForTimeout(200)
assert.equal(await page.$('.gp-files__editor'), null, 'a disabled edit button does nothing')

await pick(page, 'notes.yaml')
await startEdit(page)
const editing = await page.evaluate(() => ({
  save: document.querySelector('.gp-files__edit-save')?.textContent,
  saveDisabled: document.querySelector('.gp-files__edit-save')?.disabled,
  cancel: document.querySelector('.gp-files__edit-cancel')?.textContent,
  focused: document.activeElement?.classList.contains('cm-content') ?? false,
  status: document.querySelector('.gp-files__editor-facts')?.textContent,
  bg: getComputedStyle(document.querySelector('.gp-files__editor .cm-editor')).backgroundColor,
  gutter: getComputedStyle(document.querySelector('.gp-files__editor .cm-gutters')).color,
}))
assert.equal(editing.save, '保存')
assert.equal(editing.cancel, '取消')
assert.equal(editing.saveDisabled, true, 'save is disabled until something changes')
assert.equal(editing.focused, true, 'entering edit mode focuses the editor')
assert.match(editing.status, /LF · UTF-8 · 第 1 行，第 1 列/)
assert.equal(editing.bg, 'rgb(255, 255, 255)', 'the editor background comes from --dsw-alias-bg-layer-1')
assert.equal(editing.gutter, 'rgb(129, 133, 140)', 'line numbers use --dsw-alias-label-tertiary')
await page.evaluate(() => {
  document.body.style.setProperty('--dsw-alias-bg-layer-1', '#101010')
})
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.gp-files__editor .cm-editor')).backgroundColor), 'rgb(16, 16, 16)', 'a theme switch repaints the editor')
await page.evaluate(() => { document.body.style.removeProperty('--dsw-alias-bg-layer-1') })

// Tab indents in place and keeps focus; undo takes it back.
await page.keyboard.press('Tab')
await page.waitForTimeout(100)
const afterTab = await page.evaluate(() => ({
  focused: document.activeElement?.classList.contains('cm-content') ?? false,
  first: document.querySelector('.gp-files__editor .cm-line')?.textContent,
  dirty: document.querySelector('.gp-files__edit-dirty') !== null,
}))
assert.equal(afterTab.focused, true, 'Tab keeps focus in the editor')
assert.equal(afterTab.first, '  a: 1', 'Tab inserts one indent unit (inferred: 2 spaces)')
assert.equal(afterTab.dirty, true, 'a change shows the modified marker')
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
await page.waitForTimeout(100)
assert.equal(await page.evaluate(() => document.querySelector('.gp-files__editor .cm-line')?.textContent), 'a: 1', 'undo reverts the indent')
assert.equal(await page.evaluate(() => document.querySelector('.gp-files__edit-dirty') !== null), false, 'back at the disk text the marker clears')

// A YAML duplicate key is reported before anything is written.
await page.keyboard.press('End')
await page.keyboard.press('Enter')
await page.keyboard.type('a: 2')
await page.click('.gp-files__edit-save')
await page.waitForTimeout(200)
const yamlNotice = await page.evaluate(() => ({
  text: document.querySelector('.gp-files__edit-notice')?.textContent ?? '',
  writes: window.__ctl.writes.length,
}))
assert.match(yamlNotice.text, /YAML 第 2 行第 1 列有语法错误/, 'the YAML check names the duplicate key position')
assert.equal(yamlNotice.writes, 0, 'nothing is written while the syntax notice stands')
await page.evaluate(() => [...document.querySelectorAll('.gp-files__edit-notice-btn')].find((b) => b.textContent === '仍然保存')?.click())
await page.waitForTimeout(300)
const saved = await page.evaluate(() => ({
  write: window.__ctl.writes.at(-1),
  editor: document.querySelector('.gp-files__editor') !== null,
  preview: document.querySelector('.gp-files__preview-content')?.textContent ?? '',
  snapshots: window.__ctl.snapshots,
}))
assert.equal(saved.write.path, 'notes.yaml')
assert.equal(saved.write.content, 'a: 1\na: 2\nlist:\n  - x\n', 'the request carries the LF buffer')
assert.equal(saved.write.baseSha256, '1'.repeat(64), 'the request carries the fingerprint the edit started from')
assert.equal(saved.editor, false, 'a successful save leaves edit mode')
assert.ok(saved.preview.includes('a: 2'), 'the preview shows the saved bytes')

// A save refreshes the shared snapshot (single source for the change list).
const beforeSnaps = saved.snapshots
await startEdit(page)
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
await page.keyboard.type('a: 1\n')
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s')
await page.waitForTimeout(400)
assert.equal(await page.evaluate(() => window.__ctl.writes.length), 2, 'Ctrl/Cmd+S saves')
assert.ok(await page.evaluate((n) => window.__ctl.snapshots > n, beforeSnaps), 'the save triggered a snapshot refresh')

// JSONC names skip the JSON check.
await pick(page, 'tsconfig.json')
await startEdit(page)
await page.keyboard.type(' ')
await page.click('.gp-files__edit-save')
await page.waitForTimeout(300)
assert.equal(await page.$('.gp-files__edit-notice'), null, 'tsconfig.json with comments saves without a JSON notice')
assert.equal(await page.evaluate(() => window.__ctl.writes.at(-1).path), 'tsconfig.json')

// Conflict: the notice offers copy / load latest / overwrite; overwrite is a
// confirmed compare-and-swap against the fingerprint the host reported.
await pick(page, 'other.txt')
await startEdit(page)
await page.keyboard.type('mine ')
await page.evaluate(() => { window.__ctl.writeMode = 'conflict' })
await page.click('.gp-files__edit-save')
await page.waitForTimeout(300)
const conflict = await page.evaluate(() => ({
  text: document.querySelector('.gp-files__edit-notice')?.textContent ?? '',
  buttons: [...document.querySelectorAll('.gp-files__edit-notice-btn')].map((b) => b.textContent),
  editor: document.querySelector('.gp-files__editor') !== null,
}))
assert.ok(conflict.text.includes('文件在你编辑期间被修改了'), 'the conflict is named')
assert.deepEqual(conflict.buttons, ['复制我的内容', '载入最新版本', '仍然覆盖'])
assert.equal(conflict.editor, true, 'the draft stays on screen')
await page.evaluate(() => [...document.querySelectorAll('.gp-files__edit-notice-btn')].find((b) => b.textContent === '仍然覆盖')?.click())
await page.waitForTimeout(200)
assert.ok(await page.evaluate(() => (document.querySelector('.gp-modal')?.textContent ?? '').includes('覆盖磁盘上的新版本')), 'overwrite asks first')
await page.evaluate(() => [...document.querySelectorAll('.gp-modal .gp-btn')].find((b) => b.textContent === '仍然覆盖')?.click())
await page.waitForTimeout(300)
const overwrite = await page.evaluate(() => window.__ctl.writes.at(-1))
assert.equal(overwrite.baseSha256, '7'.repeat(64), 'overwrite compares against the version the conflict reported')
assert.equal(await page.$('.gp-files__editor'), null, 'the overwrite saved and left edit mode')

// Guard: an unsaved draft asks before another file replaces it.
await pick(page, 'README.md')
await startEdit(page)
await page.keyboard.type('draft ')
await pick(page, 'other.txt')
assert.ok(await page.evaluate(() => (document.querySelector('.gp-modal')?.textContent ?? '').includes('放弃未保存的修改')), 'picking another file asks first')
await page.evaluate(() => [...document.querySelectorAll('.gp-modal .gp-btn')].find((b) => b.textContent === '取消')?.click())
await page.waitForTimeout(200)
assert.ok((await editorText(page)).startsWith('draft '), 'keeping the draft leaves the editor as it was')
assert.equal(await page.evaluate(() => document.querySelector('.gp-files__path-name')?.textContent), 'README.md')

// Markdown: the mode switch previews the draft, and editing resumes intact.
await page.evaluate(() => [...document.querySelectorAll('.gp-files__mode-seg [role="tab"], .gp-files__mode-seg button')].find((b) => b.textContent === '预览')?.click())
await page.waitForTimeout(300)
assert.ok(await page.evaluate(() => (document.querySelector('.gp-files__markdown')?.textContent ?? '').includes('draft')), 'the preview renders the draft')
await page.evaluate(() => [...document.querySelectorAll('.gp-files__mode-seg [role="tab"], .gp-files__mode-seg button')].find((b) => b.textContent === '编辑')?.click())
await page.waitForTimeout(200)
assert.ok((await editorText(page)).startsWith('draft '), 'back in the editor the draft is intact')

// Fullscreen reader: Tab indents inside the editor; Escape closes the search
// panel first, then the reader, and the draft survives both.
await page.click('.gp-files__bar button[aria-label="全屏查看文件"]')
await page.waitForSelector('.gp-files__preview--full')
await page.click('.gp-files__editor .cm-content')
await page.keyboard.press('Home')
await page.keyboard.press('Tab')
await page.waitForTimeout(100)
const fsTab = await page.evaluate(() => ({
  focused: document.activeElement?.classList.contains('cm-content') ?? false,
  reader: document.querySelector('.gp-files__preview--full') !== null,
}))
assert.deepEqual(fsTab, { focused: true, reader: true }, 'Tab indents inside the reader instead of moving focus')
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
await page.waitForSelector('.gp-files__editor .cm-search')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
const fsEsc = await page.evaluate(() => ({
  search: document.querySelector('.gp-files__editor .cm-search') !== null,
  reader: document.querySelector('.gp-files__preview--full') !== null,
}))
assert.deepEqual(fsEsc, { search: false, reader: true }, 'Escape closes the search panel only')
await page.click('.gp-files__editor .cm-content')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
assert.equal(await page.$('.gp-files__preview--full'), null, 'a second Escape closes the reader')
assert.ok((await editorText(page)).includes('draft '), 'the draft survives the reader')

// The reader hosts its own confirmations: the dialog renders inside the card
// (the only element shown in browser fullscreen), takes focus, and one Escape
// closes it alone.
await page.click('.gp-files__bar button[aria-label="全屏查看文件"]')
await page.waitForSelector('.gp-files__preview--full')
await page.click('.gp-files__preview--full .gp-files__edit-cancel')
await page.waitForTimeout(200)
const fsConfirm = await page.evaluate(() => ({
  inside: document.querySelector('.gp-files__preview--full .gp-modal') !== null,
  focusInModal: document.querySelector('.gp-modal')?.contains(document.activeElement) ?? false,
  readOnly: document.querySelector('.gp-files__editor .cm-content')?.getAttribute('aria-readonly'),
}))
assert.deepEqual(fsConfirm, { inside: true, focusInModal: true, readOnly: 'true' }, 'the confirmation is inside the reader, holds focus, and the editor is read-only under it')
await page.keyboard.press('Tab')
await page.keyboard.press('Tab')
assert.ok(await page.evaluate(() => document.querySelector('.gp-modal')?.contains(document.activeElement) ?? false), 'Tab cycles inside the confirmation')
await page.keyboard.press('Escape')
await page.waitForTimeout(150)
const fsAfterEsc = await page.evaluate(() => ({
  modal: document.querySelector('.gp-modal') !== null,
  reader: document.querySelector('.gp-files__preview--full') !== null,
}))
assert.deepEqual(fsAfterEsc, { modal: false, reader: true }, 'one Escape closes the confirmation, not the reader under it')
assert.ok((await editorText(page)).includes('draft '), 'the draft survives the dismissed confirmation')
await page.click('.gp-files__preview--full .gp-modal__close')
await page.waitForTimeout(150)

// Host refusals are worded: an edit rule names itself, a write error its errno.
await page.evaluate(() => { window.__ctl.writeMode = 'mixed-eol' })
await page.click('.gp-files__edit-save')
await page.waitForTimeout(250)
assert.match(await page.evaluate(() => document.querySelector('.gp-files__edit-notice')?.textContent ?? ''), /保存失败：文件混用了 LF 和 CRLF 换行/)
await page.evaluate(() => { window.__ctl.writeMode = 'denied' })
await page.click('.gp-files__edit-save')
await page.waitForTimeout(250)
assert.match(await page.evaluate(() => document.querySelector('.gp-files__edit-notice')?.textContent ?? ''), /系统拒绝写入（EACCES）/)
await page.evaluate(() => [...document.querySelectorAll('.gp-files__edit-notice-btn')].find((b) => b.textContent === '复制我的内容')?.click())
await page.waitForTimeout(300)
assert.ok(await page.evaluate(() => [...document.querySelectorAll('.gp-files__edit-notice-btn')].some((b) => b.textContent === '已复制' || b.textContent === '复制失败')), 'copying the draft reports its outcome')

// One write per save, however fast the keys come; a leave asked while it is in
// flight waits for the answer and then goes ahead without asking.
const writesBefore = await page.evaluate(() => { window.__ctl.writeDelay = 400; return window.__ctl.writes.length })
await page.click('.gp-files__editor .cm-content')
const saveKey = process.platform === 'darwin' ? 'Meta+s' : 'Control+s'
await page.keyboard.press(saveKey)
await page.keyboard.press(saveKey)
await page.click('.gp-files__edit-save', { force: true })
await pick(page, 'other.txt')
await page.waitForTimeout(150)
assert.equal(await page.$('.gp-modal'), null, 'a leave during the save does not ask yet')
await page.waitForTimeout(500)
const inFlight = await page.evaluate((n) => ({
  writes: window.__ctl.writes.length - n,
  modal: document.querySelector('.gp-modal') !== null,
  editor: document.querySelector('.gp-files__editor') !== null,
  path: document.querySelector('.gp-files__path-name')?.textContent,
}), writesBefore)
assert.deepEqual(inFlight, { writes: 1, modal: false, editor: false, path: 'other.txt' }, 'one write, then the deferred pick opened the other file')
await page.evaluate(() => { window.__ctl.writeDelay = 0 })

// A draft keeps the preview in front when the panel narrows into compact.
await pick(page, 'README.md')
await startEdit(page)
await page.keyboard.type('narrow ')
await page.evaluate(() => { document.getElementById('panel').style.width = '390px' })
await page.waitForTimeout(500)
const narrowed = await page.evaluate(() => ({
  compact: document.querySelector('.gp-files--compact') !== null,
  editor: document.querySelector('.gp-files__editor') !== null,
  dirty: document.querySelector('.gp-files__edit-dirty') !== null,
}))
assert.deepEqual(narrowed, { compact: true, editor: true, dirty: true }, 'the editor and its unsaved marker stay on screen in compact')
assert.ok((await editorText(page)).startsWith('narrow '), 'the draft text survives the tier switch')
await page.click('.gp-subhead__back')
await page.waitForTimeout(150)
assert.ok(await page.evaluate(() => (document.querySelector('.gp-modal')?.textContent ?? '').includes('放弃未保存的修改')), 'back asks before leaving the draft')
await page.evaluate(() => [...document.querySelectorAll('.gp-modal .gp-btn')].find((b) => b.textContent === '放弃修改')?.click())
await page.waitForTimeout(150)
assert.equal(await page.$('.gp-files__editor'), null, 'a confirmed discard leaves edit mode')
await page.close()

// ── The host's edit switch off: no edit entry ─────────────────────────────
const off = await browser.newPage({ viewport: { width: 1000, height: 720 } })
watch(off)
await boot(off, { snap: { allowFileEdit: false } })
await pick(off, 'notes.yaml')
assert.equal(await off.$('.gp-files__edit'), null, 'editing switched off in the config hides the edit button')
await off.close()

// ── Chunk load failure → retry ────────────────────────────────────────────
const failing = await browser.newPage({ viewport: { width: 1000, height: 720 } })
watch(failing)
await boot(failing, { chunkFailures: 1 })
await pick(failing, 'README.md')
await failing.click('.gp-files__edit')
await failing.waitForTimeout(300)
const failed = await failing.evaluate(() => ({
  text: document.querySelector('.gp-files__edit-notice')?.textContent ?? '',
  editor: document.querySelector('.gp-files__editor') !== null,
  preview: (document.querySelector('.gp-files__preview-content')?.textContent ?? '').includes('readme'),
}))
assert.ok(failed.text.includes('编辑器加载失败'), 'a chunk failure is reported')
assert.equal(failed.editor, false)
assert.equal(failed.preview, true, 'the read-only preview stays usable')
await failing.evaluate(() => [...document.querySelectorAll('.gp-files__edit-notice-btn')].find((b) => b.textContent === '重试')?.click())
await failing.waitForSelector('.gp-files__editor .cm-content', { timeout: 10000 })
await failing.close()

// ── Compact (phone) toolbar ───────────────────────────────────────────────
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
watch(phone)
await boot(phone, { width: 390, height: 780 })
await pick(phone, 'notes.yaml')
await phone.click('.gp-files__edit')
await phone.waitForSelector('.gp-files__editor .cm-content', { timeout: 10000 })
const compactBar = await phone.evaluate(() => {
  const bar = document.querySelector('.gp-files__bar--compact')
  const tops = [...bar.children].map((c) => Math.round(c.getBoundingClientRect().top))
  return {
    oneRow: new Set(tops).size === 1,
    save: document.querySelector('.gp-files__bar--compact .gp-files__edit-save')?.textContent,
    cancel: document.querySelector('.gp-files__bar--compact .gp-files__edit-cancel')?.textContent,
    overflow: bar.scrollWidth > bar.clientWidth + 1,
  }
})
assert.deepEqual(compactBar, { oneRow: true, save: '保存', cancel: '取消', overflow: false }, 'save / cancel are text buttons on the one compact row')
await phone.close()

assert.deepEqual(errors.filter((e) => !e.includes('chunk load failed')), [], 'no console or page errors')
await browser.close()
console.log('e2e files-edit.mjs: PASS')
