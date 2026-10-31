/**
 * Lazy mermaid chunk: the only place mermaid exists in the shipped tree. The
 * main client bundle loads it through `require.async('./client.mermaid.js')`
 * the first time a rendered document actually contains a mermaid fence, so
 * the panel's steady-state download stays mermaid-free.
 *
 * Entry choice: `import mermaid from 'mermaid'` resolves to `mermaid.core.mjs`
 * (typed ESM). Its per-diagram lazy `import("./chunks/…")` calls are
 * string-literal relative imports, which esbuild inlines when bundling to
 * CommonJS — one self-contained file, the only shape the plugin route's
 * one-file chunk model can serve. The prebuilt `dist/mermaid.min.js` is NOT
 * usable here: it assigns `globalThis.__esbuild_esm_mermaid_nm` from a
 * top-level `var`, which stops reaching globalThis once the chunk runs inside
 * the ModuleLoader factory closure (it threw `TypeError` on load).
 * `securityLevel: 'strict'` keeps diagram sources from carrying scripts or
 * click handlers into the SVG.
 */
import mermaid from 'mermaid'

let sequence = 0

/** Render one mermaid source to SVG markup under the given built-in theme. */
export async function renderMermaid(source: string, theme: 'default' | 'dark'): Promise<string> {
  const id = `gp-mermaid-${String(++sequence)}`
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    // Deterministic ids seeded per figure: identical sources in one document
    // still derive distinct internal SVG ids (no colliding defs/marker
    // references), while each figure's own render stays reproducible.
    deterministicIds: true,
    deterministicIDSeed: id,
  })
  // Without a container mermaid draws into an in-flow div appended to <body>.
  // The shell's #root fills the viewport, so that div overflows the document
  // for the length of the draw: the page grows a styled (space-taking)
  // scrollbar and the whole app reflows a few px narrower, then back. A fixed,
  // off-screen, hidden host keeps the draw measurable (getBBox needs layout)
  // without adding scrollable overflow.
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;visibility:hidden;pointer-events:none'
  document.body.appendChild(host)
  try {
    const { svg } = await mermaid.render(id, source, host)
    return svg
  } finally {
    host.remove()
  }
}
