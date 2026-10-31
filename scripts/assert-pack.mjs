#!/usr/bin/env node
/**
 * Asserts an unpacked `npm pack` tree carries everything the plugin needs to
 * load, nothing more than the manifest's `files` allows, and nothing that would
 * run during install.
 *
 * The unit and e2e suites exercise `lib/` from the working tree, and both
 * rebuild before running — so neither can notice a `files` entry that dropped a
 * runtime artifact, a wildcard that swept local build output into the package,
 * or a lifecycle script that only exists to build one. This script checks the
 * artifact that actually ships (the tree the release workflow packs and the npm
 * tarball receives), so such a mistake fails the release instead of the user.
 *
 * Usage: node scripts/assert-pack.mjs <unpacked-package-dir>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

/** Files npm always ships, whatever `files` says. */
const ALWAYS = [/^package\.json$/, /^npm-shrinkwrap\.json$/, /^README(\..*)?$/i, /^LICEN[CS]E(\..*)?$/i, /^CHANGELOG(\..*)?$/i]

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
// Resolved against this script, not the caller's cwd: a release step running
// from another directory must not silently skip the module check.
const hostSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'host')
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

// Nothing outside the manifest's `files` may ship. A `files` entry that widens
// (or a stale one pointing at a directory that now holds build output) would
// otherwise be packed silently: `npm pack` never complains about extra paths.
const allowed = []
for (const entry of manifest.files ?? []) {
  const clean = String(entry).replace(/^\.\//, '').replace(/\/+$/, '')
  if (clean === '') continue
  // Only `*` inside one segment: enough for this manifest's shapes, and it
  // cannot be tricked into matching across directories.
  const pattern = new RegExp(`^${clean.split('*').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`)
  allowed.push({ dir: clean, pattern })
}
const extra = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { walk(full); continue }
    const rel = relative(root, full).split('\\').join('/')
    if (ALWAYS.some((re) => re.test(rel))) continue
    const covered = allowed.some((a) => a.pattern.test(rel) || rel.startsWith(`${a.dir}/`))
    if (!covered) extra.push(rel)
  }
}
walk(root)
if (extra.length > 0) {
  problems.push(`packed paths the manifest's files does not allow: ${extra.slice(0, 12).join(', ')}${extra.length > 12 ? ` (+${extra.length - 12} more)` : ''}`)
}

if (problems.length > 0) {
  console.error(`assert-pack: ${at('')} does not ship a loadable plugin:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}

console.log(`assert-pack: ${at('')} is loadable (${REQUIRED.length} required files + all host modules present)`)
