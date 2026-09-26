/**
 * dsh-git-panel build script (self-contained; also runs as `prepare`).
 *
 * 1. Host half: tsc emits only the `lib/host/*.d.ts` declarations
 *    (emitDeclarationOnly); the ESM `lib/host/index.js` is the esbuild bundle
 *    below. Never minified — typert reflects on method parameter names.
 * 2. Client half: esbuild bundles `src/client/index.ts` into one file
 *    `lib/client.js` wrapped in the `window.__ModuleLoader__.load({id,factory})`
 *    closure the web shell materializes. Platform modules (react, @deepseek-ai/*)
 *    stay external and resolve through the loader-provided `require`.
 */
import { spawnSync } from 'node:child_process'
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

/** Host externals: dsh installation provides @deepseek-ai/*; node builtins auto-external. */
const HOST_EXTERNALS = ['@deepseek-ai/*']

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// ── Host half: tsc + esbuild bundle (never minified) ─────────────────────
run('npx', ['tsc', '-p', 'tsconfig.build.json'])
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/host/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  external: HOST_EXTERNALS,
  minify: false,
  sourcemap: false,
  outfile: resolve(ROOT, 'lib/host/index.js'),
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

// ── Hook kit: the OverviewTab data hooks as an ESM bundle with react external,
//    so hook unit tests drive them under react-test-renderer with the installed
//    React. Gitignored like testkit; rebuilt by `npm run test:unit`.
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/client/overview-hooks.ts')],
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
