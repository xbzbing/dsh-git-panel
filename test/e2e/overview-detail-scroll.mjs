/**
 * The commit detail's message pane must not scroll when there is nothing to
 * reach: a commit with no body renders subject/meta/ops plus a placeholder, and
 * a placeholder claiming a full pane height stacks on top of the header — the
 * pane then scrolls by exactly that header with no content below it. A long
 * body must still scroll (the placeholder rule may not turn the pane into a
 * clip).
 *
 * The mock serves an empty body to the first commit it is asked about and a
 * 60-line body to the second, so both cases come from one mounted panel.
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
  truncated: false, refreshIntervalMs: 0, showInputPill: true,
  defaultDiffView: 'unified', checkedAt: Date.now(),
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.goto(harness)
  await page.addStyleTag({ content: THEME })
  await page.addScriptTag({ path: resolve(E2E, 'mock-rpc.mjs') })
  await page.addScriptTag({ path: resolve(E2E, 'client.js') })

  await page.evaluate(async (snap) => {
    const { connection } = window.createGitPanelMock(snap)
    const inner = connection.rpc.call.bind(connection.rpc)
    const bodies = new Map()
    // First commit asked about: no body. Second: a body long enough to overflow
    // the pane by a wide margin in any viewport the runner might run in.
    const LONG = Array.from({ length: 60 }, (_, i) => `body line ${i + 1}`).join('\n')
    connection.rpc.call = async (channel, endpoint, payload) => {
      const request = payload && payload.args && payload.args.request
      if (endpoint === 'dbGitPanel/query' && request?.query?.kind === 'show') {
        const q = request.query
        if (!bodies.has(q.ref)) bodies.set(q.ref, bodies.size === 0 ? '' : LONG)
        return { ok: true, value: { ok: true, value: {
          kind: 'show',
          ref: q.ref,
          commit: { hash: q.ref, shortHash: q.ref.slice(0, 7), subject: 'chore: release v1.8.2', author: 'xbzbing', dateIso: new Date().toISOString() },
          body: bodies.get(q.ref),
          stats: ['docs/releases/v1.8.2.md', 'package-lock.json', 'package.json'].map((path) => ({ path, status: 'modified' })),
          insertions: 50,
          deletions: 3,
        } } }
      }
      return inner(channel, endpoint, payload)
    }

    const registered = {}
    const dictionaries = {}
    const ctx = {
      get: (key) => key === 'connection' ? connection : undefined,
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
    await new Promise((r) => setTimeout(r, 400))
    window.ReactDOM.createRoot(document.getElementById('panel')).render(registered['conversation.view'].component({ sessionId: 'sess-1' }))
    await new Promise((r) => setTimeout(r, 900))
  }, SNAP)

  const openCommit = async (index) => {
    await page.evaluate((i) => { document.querySelectorAll('.gp-commit-row')[i]?.click() }, index)
    await page.waitForTimeout(600)
  }

  /** Pane geometry: the message pane and whatever occupies its last slot. */
  const probe = () => page.evaluate(() => {
    const msg = document.querySelector('.gp-detail__msg')
    if (msg === null) return null
    const empty = msg.querySelector('.gp-empty')
    const body = msg.querySelector('.gp-detail__body')
    const rect = (el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) } }
    return {
      layout: document.querySelector('.gp-panel')?.getAttribute('data-layout'),
      clientH: msg.clientHeight,
      scrollH: msg.scrollHeight,
      placeholder: empty === null ? null : { text: (empty.textContent ?? '').trim(), ...rect(empty) },
      body: body === null ? null : { lines: (body.textContent ?? '').split('\n').length, ...rect(body) },
      pane: rect(msg),
    }
  })

  const out = {}
  // A wide three-column overview is where the report came from: branches,
  // history, then the detail column.
  out.layout = await page.evaluate(() => document.querySelector('.gp-panel')?.getAttribute('data-layout'))
  assert.equal(out.layout, 'wide', 'the runner mounts the wide overview')

  // 1. No body: the placeholder takes the leftover space and the pane ends there.
  await openCommit(0)
  out.empty = await probe()
  assert.ok(out.empty !== null, 'the commit detail renders')
  assert.equal(out.empty.body, null, 'a commit without a body renders no body block')
  assert.ok(out.empty.placeholder !== null, 'the no-message placeholder renders')
  assert.equal(out.empty.placeholder.text, '（无提交正文）', 'the placeholder explains the empty body')
  assert.ok(
    out.empty.scrollH <= out.empty.clientH + 1,
    `the message pane does not scroll with nothing to reach (content ${out.empty.scrollH}px vs pane ${out.empty.clientH}px)`,
  )
  assert.ok(
    Math.abs(out.empty.placeholder.bottom - out.empty.pane.bottom) <= 12,
    `the placeholder fills the row down to the pane's padding (placeholder ends at ${out.empty.placeholder.bottom}, pane at ${out.empty.pane.bottom})`,
  )

  // 2. Long body: still a real scrollport — the placeholder rule may not clip it.
  await openCommit(1)
  out.long = await probe()
  assert.ok(out.long !== null, 'the second commit detail renders')
  assert.ok(out.long.body !== null, 'a commit with a body renders the body block')
  assert.equal(out.long.body.lines, 60, `the whole body is rendered (${out.long.body.lines} lines)`)
  assert.ok(
    out.long.scrollH > out.long.clientH + 20,
    `a long body still overflows into a scrollport (content ${out.long.scrollH}px vs pane ${out.long.clientH}px)`,
  )

  assert.deepEqual(errors, [], 'no console errors')
  console.log('e2e/overview-detail-scroll: all assertions passed', JSON.stringify(out))
} finally {
  await browser.close()
}
