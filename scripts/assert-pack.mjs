#!/usr/bin/env node
/**
 * Asserts an unpacked `npm pack` tree carries everything the plugin needs to
 * load, and nothing that would run during install.
 *
 * The unit and e2e suites exercise `lib/` from the working tree, and both
 * rebuild before running — so neither can notice a `files` entry that dropped a
 * runtime artifact, or a lifecycle script that only exists to build one. This
 * script checks the artifact that actually ships (the same tree the `dist`
 * branch and the npm tarball receive), so such a mistake fails the release
 * instead of the user.
 *
 * Usage: node scripts/assert-pack.mjs <unpacked-package-dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** Lifecycle hooks that must never be present: DSH STORE and this project
 * refuse install-time scripts (see docs/adr/0003). */
const INSTALL_HOOKS = [
  'preinstall', 'install', 'postinstall', 'prepare',
  'prepublish', 'prepublishOnly', 'prepack', 'postpack',
]

/** Artifacts every install needs, whatever else is in the package. */
const REQUIRED = [
  'package.json',
  'cordis.patch.yml',
  'lib/client.js',
  'lib/client.mermaid.js',
  'lib/client.editor.js',
  'lib/host/index.js',
  'lib/host/index.d.ts',
  'locale/zh.json',
  'locale/en.json',
  'locale/ja.json',
  'locale/es.json',
  'locale/fr.json',
  'locale/de.json',
  'locale/ru.json',
  'locale/pt.json',
  'icon.svg',
  'LICENSE',
]

const root = resolve(process.argv[2] ?? '')
if (root === '' || !existsSync(root)) {
  console.error(`assert-pack: package directory not found: ${process.argv[2] ?? '(missing argument)'}`)
  process.exit(2)
}

const problems = []
const at = (file) => `${relative(process.cwd(), root)}/${file}`

for (const file of REQUIRED) {
  if (!existsSync(join(root, file))) problems.push(`missing required file: ${file}`)
}

// Every host source module must ship as a .js sibling. The build is one-file-per-
// module (docs/adr/0004), so a missing sibling is a real import failure, not a
// cosmetic gap.
const hostSrc = resolve('src/host')
if (existsSync(hostSrc)) {
  for (const name of readdirSync(hostSrc).filter((f) => f.endsWith('.ts'))) {
    const shipped = name.replace(/\.ts$/, '.js')
    if (!existsSync(join(root, 'lib/host', shipped))) {
      problems.push(`host module has no shipped build: src/host/${name} -> lib/host/${shipped}`)
    }
  }
}

// The plugin page fails the detail read when a locale's meta.detail names a
// file the package does not carry, and npm pack skips a missing `files` entry
// without an error.
for (const name of existsSync(join(root, 'locale')) ? readdirSync(join(root, 'locale')).filter((f) => f.endsWith('.json')) : []) {
  const detail = JSON.parse(readFileSync(join(root, 'locale', name), 'utf8')).meta?.detail
  if (typeof detail === 'string' && !existsSync(join(root, detail))) {
    problems.push(`locale/${name} meta.detail names a file the package does not carry: ${detail}`)
  }
}

// The manifest itself must stay free of install-time hooks; the working-tree
// copy is asserted by plugin-contract.test.mjs, and this is the same check
// applied to what is actually published.
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
for (const hook of INSTALL_HOOKS) {
  if (manifest.scripts?.[hook] !== undefined) {
    problems.push(`install-time lifecycle script declared: scripts.${hook} — see docs/adr/0003`)
  }
}

// The editor chunk must stay a chunk: the main bundle reaches it through one
// `require.async('./client.editor.js')` and carries none of CodeMirror or yaml.
// Each marker is a string literal that survives minification, one per
// package group: `cm-content` (a class @codemirror/view writes),
// `Invalid change range` (@codemirror/state), `No parse at` (@lezer/lr, the
// parser under every language package) and `TAB_AS_INDENT` (a yaml error code).
const mainBundle = join(root, 'lib/client.js')
if (existsSync(mainBundle)) {
  const text = readFileSync(mainBundle, 'utf8')
  const refs = text.split('./client.editor.js').length - 1
  if (refs !== 1) problems.push(`lib/client.js must reference ./client.editor.js exactly once (found ${refs})`)
  for (const marker of ['cm-content', 'Invalid change range', 'No parse at', 'TAB_AS_INDENT']) {
    if (text.includes(marker)) problems.push(`lib/client.js contains editor-chunk code (${marker}) — see docs/adr/0025`)
  }
}

if (problems.length > 0) {
  console.error(`assert-pack: ${at('')} does not ship a loadable plugin:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}

console.log(`assert-pack: ${at('')} is loadable (${REQUIRED.length} required files + all host modules present)`)
