/**
 * Review capture: the version-bar "check for updates" pill. The refresh glyph and
 * the label must share one horizontal centre line. Run setup.mjs first.
 */
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(DIR, '../../docs/local/review')
const harness = 'file://' + resolve(DIR, 'harness.html')
const THEME = `body{margin:0;font:13px system-ui,sans-serif;
--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#fff;
--dsw-alias-bg-layer-3:#fff;--dsw-alias-bg-module-platform:#e9eaec;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;
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
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 500 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
await page.goto(harness)
await page.addStyleTag({ content: THEME })
await page.addScriptTag({ path: resolve(DIR, 'client.js') })

await page.evaluate(async (snap) => {
  const entry = window.__getLoaded()
  const connection = {
    rpc: {
      call: async (_c, endpoint) => {
        if (endpoint === 'dbGitPanel/snapshot') return { ok: true, value: { ok: true, value: snap } }
        if (endpoint === 'dbGitPanel/query') return { ok: true, value: { ok: true, value: { kind: 'authors', authors: [] } } }
        if (endpoint === 'dbGitPanel/run') return { ok: true, value: { ok: true, snapshot: snap } }
        if (endpoint === 'dbGitPanel/version') return { ok: true, value: { current: '1.6.0', repositoryUrl: 'https://github.com/xbzbing/dsh-git-panel', updateAvailable: false, checkedRemote: true } }
        return { ok: false, error: { code: 'git-error', message: 'unhandled ' + endpoint } }
      },
    },
  }
  const registered = {}
  const dictionaries = {}
  // Minimal configForms so the wide font stepper mounts (it is hidden without
  // the settings write face).
  const ctx = {
    get: (k) => k === 'connection' ? connection : k === 'configForms' ? {
      describe: () => ({
        getSnapshot: () => ({ status: 'ready', view: { namespaces: [{ ns: 'gitPanel', schema: { dict: { showInputPill: {} } } }] }, revision: 0, writable: true }),
        subscribe: () => () => {},
        ensure: async () => {},
      }),
      get: () => ({
        getSnapshot: () => ({ status: 'ready', value: { fontDelta: 0, showInputPill: true }, revision: 0, writable: true }),
        subscribe: () => () => {},
        set: async () => true,
      }),
    } : undefined,
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_d, cb) => cb(ctx),
    slots: { inject: (_n, p) => p(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
    locale: {
      register: (ns, dict) => { dictionaries[ns] = dict },
      bind: (ns) => (key, params) => {
        const text = dictionaries[ns]?.zh?.[key] ?? key
        return params === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      },
    },
  }
  entry.apply(ctx)
  await new Promise((r) => setTimeout(r, 500))
  window.ReactDOM.createRoot(document.getElementById('panel')).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
  await new Promise((r) => setTimeout(r, 700))
  window.__measureVer = () => {
    const btn = document.querySelector('.gp-verbar__btn')
    if (btn === null) return { error: 'no version button' }
    const box = (n) => { const b = n.getBoundingClientRect(); return { top: Math.round(b.top * 10) / 10, bottom: Math.round(b.bottom * 10) / 10, h: Math.round(b.height * 10) / 10, cy: Math.round((b.top + b.height / 2) * 10) / 10 } }
    const iconSpan = btn.querySelector('.gp-tab__icon')
    const svg = btn.querySelector('svg')
    // Text node rect: the label is the button's last child text node.
    const textNode = [...btn.childNodes].find((n) => n.nodeType === 3 && (n.textContent || '').trim() !== '')
    let textBox = null
    if (textNode) {
      const range = document.createRange()
      range.selectNodeContents(textNode)
      const r = range.getBoundingClientRect()
      textBox = { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, cy: Math.round((r.top + r.height / 2) * 10) / 10 }
    }
    return { btn: box(btn), iconSpan: box(iconSpan), svg: box(svg), text: textBox }
  }
}, SNAP)

const report = await page.evaluate(() => window.__measureVer())
await page.locator('.gp-verbar__btn').screenshot({ path: resolve(OUT, 'version-bar-btn.png') })
await page.locator('.gp-font').screenshot({ path: resolve(OUT, 'font-stepper.png') })
console.log(JSON.stringify(report, null, 2))
if (report.text && report.svg) {
  console.log('icon center - text center =', Math.round((report.svg.cy - report.text.cy) * 10) / 10, 'px')
}
if (errors.length) console.log('CONSOLE ERRORS:', errors)
await browser.close()
