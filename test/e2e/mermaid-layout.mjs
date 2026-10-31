/**
 * The mermaid chunk must render without disturbing the page layout.
 *
 * The shell's `html, body, #root` fill the viewport and its theme styles the
 * scrollbar (a styled scrollbar takes layout width even on macOS). Anything
 * the draw puts into the document flow overflows the page, adds a scrollbar
 * and reflows the whole app a few px narrower until the draw ends — the input
 * composer visibly jitters on every mermaid figure. This runner loads the real
 * built chunk (`lib/client.mermaid.js`, not the harness stub) into a page with
 * the shell's page geometry and real scrollbars, samples every frame of two
 * renders, and asserts the document never grows and the page never narrows.
 */
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// The shell's page-level rules (dsh-web-frontend + ui-theme scrollbar.css).
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body,#root{height:100%;margin:0}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-thumb{background:#999;border-radius:999px}
#root{display:flex;flex-direction:column}
#root>main{flex:1}
#composer{height:120px;width:min(712px,100%);margin:0 auto;border:1px solid #888;box-sizing:border-box}
</style></head><body><div id="root"><main></main><div id="composer"></div></div></body></html>`

const SOURCE = `graph LR
  subgraph Loop[agent loop]
    Pre[pre-step] --> Gate{danger gate}
    Gate -->|allow| Tool[tool call]
    Gate -->|deny| Stop[stop]
    Tool --> Post[post-step]
  end
  Post --> Review[self check]
  Review --> Report[report]
  Report --> Pre`

// Headless Chromium hides scrollbars by default, which would hide the bug.
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message))
  await page.setContent(PAGE)
  await page.evaluate(() => {
    window.__ModuleLoader__ = { load: ({ factory }) => { window.__mermaidChunk = factory(() => ({})) } }
  })
  await page.addScriptTag({ path: resolve(ROOT, 'lib/client.mermaid.js') })

  const result = await page.evaluate(async (source) => {
    const composer = document.getElementById('composer')
    const root = document.getElementById('root')
    const base = { docH: document.documentElement.scrollHeight, width: root.clientWidth, left: composer.getBoundingClientRect().left }
    const frames = []
    let stop = false
    const tick = () => {
      frames.push({ docH: document.documentElement.scrollHeight, width: root.clientWidth, left: composer.getBoundingClientRect().left })
      if (!stop) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    const children = document.body.children.length
    const svgs = []
    for (const theme of ['default', 'dark']) svgs.push(await window.__mermaidChunk.renderMermaid(source, theme))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    stop = true
    return { base, frames, svgs: svgs.map((s) => s.slice(0, 4)), leftover: document.body.children.length - children }
  }, SOURCE)

  assert.ok(result.frames.length > 0, 'frames were sampled during the draw')
  assert.deepEqual(result.svgs, ['<svg', '<svg'], 'both renders return SVG markup')
  const grew = result.frames.filter((f) => f.docH !== result.base.docH)
  assert.equal(grew.length, 0, `the document never grows during a draw (saw ${JSON.stringify(grew[0])}, base ${result.base.docH})`)
  const narrowed = result.frames.filter((f) => f.width !== result.base.width || f.left !== result.base.left)
  assert.equal(narrowed.length, 0, `the page and the composer never move during a draw (saw ${JSON.stringify(narrowed[0])})`)
  assert.equal(result.leftover, 0, 'the off-screen render host is removed after each draw')
  assert.deepEqual(errors, [])
  console.log(`mermaid-layout: PASS (${result.frames.length} frames, page ${result.base.width}px stable)`)
} finally {
  await browser.close()
}
