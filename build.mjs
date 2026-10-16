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
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// ── Host half: tsc declarations + per-module esbuild transpile ────────────
// One output file per source module keeps lib/host/ aligned with src/host/:
// every relative `./x.js` import resolves inside the shipped tree, stack
// traces name the module that raised, and review stays per file. Platform
// packages (@deepseek-ai/*) stay bare imports for the DSH install to resolve,
// and nothing is bundled, so no externals list is needed. Never minified.
run('npx', ['tsc', '-p', 'tsconfig.build.json'])
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
