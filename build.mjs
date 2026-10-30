/**
 * dsh-git-panel build script (self-contained; run by hand before release, not
 * as an install-time lifecycle hook — the committed lib/ is the shipped tree).
 *
 * 1. Host half: tsc emits the `lib/host/*.d.ts` declarations (emitDeclarationOnly)
 *    and esbuild transpiles `src/host/*.ts` one file per module into
 *    `lib/host/*.js`, so the shipped tree is a plain ESM package whose relative
 *    `./x.js` imports all resolve inside it (readable per-module output, same
 *    layout as `src/host/`). Never minified — typert reflects on method
 *    parameter names.
 * 2. Client half: esbuild bundles `src/client/index.ts` into one file
 *    `lib/client.js` wrapped in the `window.__ModuleLoader__.load({id,factory})`
 *    closure the web shell materializes. Platform modules (react, @deepseek-ai/*)
 *    stay external and resolve through the loader-provided `require`.
 * 3. Lazy chunks: `lib/client.mermaid.js` (mermaid) and `lib/client.editor.js`
 *    (CodeMirror + yaml), each loaded on first use through `require.async`.
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)))

/** Platform modules the browser loader provides; must stay external. The whole
 * `@deepseek-ai/*` scope is host-provided, matching AGENTS.md's external rule. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/*',
]

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' })
  // A spawn failure (ENOENT / EPERM) leaves status null; report it instead of
  // exiting silently, so a broken toolchain does not look like a clean build.
  if (result.error !== undefined) {
    console.error(`build: cannot run ${cmd}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// ── Host half: tsc declarations + per-module esbuild transpile ────────────
// One output file per source module keeps lib/host/ aligned with src/host/:
// every relative `./x.js` import resolves inside the shipped tree, stack
// traces name the module that raised, and review stays per file. Platform
// packages (@deepseek-ai/*) stay bare imports for the DSH install to resolve,
// and nothing is bundled, so no externals list is needed. Never minified.
// tsc through its JS entry rather than `npx`: npx is a shell script (a .cmd
// shim on Windows) and cannot be spawned as a child process there.
run(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'])
const hostEntries = readdirSync(resolve(ROOT, 'src/host'))
  .filter((file) => file.endsWith('.ts'))
  .map((file) => resolve(ROOT, 'src/host', file))
await esbuild.build({
  entryPoints: hostEntries,
  bundle: false,
  outdir: resolve(ROOT, 'lib/host'),
  outbase: resolve(ROOT, 'src/host'),
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
})

// ── Client half: single-file ModuleLoader bundle ─────────────────────────
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/client/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  minify: true,
  sourcemap: false,
  // The banner deliberately assigns `module.exports` in an ESM entry; silence
  // the expected commonjs-variable-in-esm warning so the build log stays clean.
  logOverride: { 'commonjs-variable-in-esm': 'silent' },
  outfile: resolve(ROOT, 'lib/client.js'),
  logLevel: 'info',
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "@xbzbing/dsh-git-panel", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports;\n} });',
  },
})

// ── Mermaid chunk: lazy package-local bundle ──────────────────────────────
// Loaded only when a rendered Markdown document actually contains a mermaid
// fence (`require.async('./client.mermaid.js')` → /plugins route serves this
// file). Keeps ~1–2MB of mermaid out of the main client bundle; the chunk
// registration mirrors the official document preview's lazy chunks.
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/client/mermaid-chunk.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  logOverride: { 'commonjs-variable-in-esm': 'silent' },
  outfile: resolve(ROOT, 'lib/client.mermaid.js'),
  logLevel: 'info',
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "@xbzbing/dsh-git-panel", chunk: "client.mermaid.js", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports;\n} });',
  },
})

// ── Editor chunk: lazy package-local bundle ───────────────────────────────
// CodeMirror 6 plus the `yaml` parser, loaded only when the user first presses
// "edit" in the file browser (`require.async('./client.editor.js')`). Same
// wrapper as the mermaid chunk; nothing of it enters lib/client.js.
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/client/editor-chunk.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  logOverride: { 'commonjs-variable-in-esm': 'silent' },
  outfile: resolve(ROOT, 'lib/client.editor.js'),
  logLevel: 'info',
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "@xbzbing/dsh-git-panel", chunk: "client.editor.js", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports;\n} });',
  },
})

// ── Test kit: pure algorithms as a plain ESM bundle for `node --test` ─────
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/client/testkit.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  minify: false,
  sourcemap: false,
  outfile: resolve(ROOT, 'lib/testkit.mjs'),
  logLevel: 'info',
  // A bundled CommonJS dependency (yaml's node build) calls `require` for Node
  // built-ins; an ESM bundle has none, so give it one.
  banner: { js: "import { createRequire as __gpCreateRequire } from 'node:module'; const require = __gpCreateRequire(import.meta.url);" },
})

// ── Hook kit: data hooks with React external for the unit-test hook harness.
//    Gitignored like testkit; rebuilt by `npm run test:unit`.
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/client/hookkit.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['react', 'react-dom'],
  minify: false,
  sourcemap: false,
  outfile: resolve(ROOT, 'lib/hookkit.mjs'),
  logLevel: 'info',
})
