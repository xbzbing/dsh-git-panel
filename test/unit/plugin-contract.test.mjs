/**
 * Plugin contract tests: the built host and client bundles honor the dsh
 * loader contracts.
 *
 *  - host: default export is a class named after the service; declares the
 *    subprocess/sessions/sessionPersistence injects; carries @Remote markers.
 *  - client: the bundle is a window.__ModuleLoader__.load({ id, factory })
 *    registration whose factory returns { apply, inject }, inject declares
 *    only the services apply() uses, and apply() registers both the
 *    conversation.view panel and the conversation.input.left marker.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as host from '../../lib/host/index.js'

test('host bundle exports the GitPanelService + endpoints', () => {
  const Service = host.default ?? host.GitPanelService
  assert.equal(typeof Service, 'function', 'default export is a class')
  assert.equal(Service.name, 'GitPanelService')
  assert.ok(Array.isArray(Service.inject), 'static inject is declared')
  for (const dep of ['subprocess', 'sessions', 'sessionPersistence']) {
    assert.ok(Service.inject.includes(dep), `inject must include ${dep}`)
  }
  // Pure endpoint functions are re-exported for standalone use / testing.
  assert.equal(typeof host.runAction, 'function')
  assert.equal(typeof host.runQuery, 'function')
  assert.equal(typeof host.snapshotForSession, 'function')
  assert.equal(typeof host.readVersionInfo, 'function')
  assert.equal(typeof host.checkLatestVersion, 'function')
  assert.equal(typeof host.compareVersions, 'function')
})

// The shipped host tree is a plain ESM package: one js per src/host module plus
// its declaration. Every relative import it carries must therefore resolve to a
// file that is actually shipped — a missing sibling breaks the runtime import
// and the published type declarations at the same time.
test('shipped host tree resolves every relative import', () => {
  const dir = new URL('../../lib/host/', import.meta.url)
  const files = readdirSync(dir).filter((file) => file.endsWith('.js') || file.endsWith('.d.ts'))
  const present = new Set(files)
  const specifier = /(?:from\s*|import\s*\(\s*)['"](\.[^'"]+)['"]/g
  const missing = []
  for (const file of files) {
    const source = readFileSync(new URL(file, dir), 'utf8')
    for (const match of source.matchAll(specifier)) {
      const target = match[1].split(/[?#]/, 1)[0].replace(/^\.\//, '')
      const candidates = [target, `${target}.js`, `${target}.d.ts`]
      if (!candidates.some((candidate) => present.has(candidate))) missing.push(`${file} -> ${match[1]}`)
    }
  }
  assert.deepEqual(missing, [], 'every relative import must point at a shipped file')
})

// N15: the config values hard-coded in cordis.patch.yml must match the host's
// DEFAULT_CONFIG, or a default change silently drifts from the shipped row.
test('cordis.patch.yml config matches DEFAULT_CONFIG', () => {
  const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
  const num = (key) => Number(new RegExp(`${key}:\\s*(\\d+)`).exec(patch)?.[1])
  for (const key of ['timeoutMs', 'maxBytes', 'maxChanges', 'refreshIntervalMs']) {
    assert.equal(num(key), host.DEFAULT_CONFIG[key], `${key} in patch must equal DEFAULT_CONFIG`)
  }
})

/** One React/react-dom stub, shared by every client-factory test. */
function sandboxRequire() {
  return (spec) => {
    if (spec === 'react') return { createElement: () => ({}), useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useMemo: (f) => f(), useCallback: (f) => f, useLayoutEffect: () => {}, memo: (c) => c, Fragment: 'fragment' }
    if (spec === 'react-dom') return { createPortal: () => ({}) }
    if (spec === 'react/jsx-runtime') return { jsx: () => ({}), jsxs: () => ({}), Fragment: 'fragment' }
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: () => ({}) }
    throw new Error('unexpected require: ' + spec)
  }
}

function loadClient() {
  const code = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
  let handoff = null
  const sandbox = {
    window: { __ModuleLoader__: { load: (h) => { handoff = h } } },
    document: { querySelector: () => null, createElement: () => ({ dataset: {}, appendChild() {} }), head: { appendChild() {} } },
    require: sandboxRequire(),
    Object, Symbol, console, Array, JSON, Date, Set, Map,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  assert.ok(handoff, 'client bundle must call window.__ModuleLoader__.load')
  return handoff
}

test('client bundle is a ModuleLoader registration with id dsh-git-panel', () => {
  const handoff = loadClient()
  assert.equal(handoff.id, '@xbzbing/dsh-git-panel')
  assert.equal(typeof handoff.factory, 'function')
})

// The three install-identity strings must stay equal, or the composed tree
// skips the row (name mismatch) or the client registration misses its graph
// row — either way the panel disappears (the 0.1.0 npm-install regression).
test('install identity is consistent across manifest, patch row, bundle id', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
  const handoff = loadClient()
  const rowName = /name:\s*['"]?([^\s'"]+)/.exec(patch)?.[1]
  assert.equal(pkg.name, '@xbzbing/dsh-git-panel')
  assert.equal(rowName, pkg.name, 'cordis.patch.yml row name must equal package name')
  assert.equal(handoff.id, pkg.name, 'ModuleLoader registration id must equal package name')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'), 'MarkdownText must come from the dsh platform seed')
})

test('client factory returns a plugin with apply + inject', () => {
  const handoff = loadClient()
  const plugin = handoff.factory(sandboxRequire())
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(Array.isArray(plugin.inject))
  // inject declares exactly the services apply() consumes — no more, no less.
  assert.deepEqual([...plugin.inject].sort(), ['connection', 'locale', 'slots'])
})

test('apply registers the conversation.view panel and input.left marker', () => {
  const handoff = loadClient()
  const plugin = handoff.factory(sandboxRequire())
  const registered = []
  const ctx = {
    get: () => undefined,
    effect: (cb) => { try { cb() } catch { /* ignore */ } },
    on: () => () => {},
    inject: (_deps, cb) => cb(ctx),
    slots: {
      inject: (_name, provider) => provider(),
      register: (reg) => { registered.push(reg.name); return () => {} },
    },
    locale: { register: () => () => {}, bind: () => (k) => k },
  }
  plugin.apply(ctx)
  assert.ok(registered.includes('conversation.view'), 'panel slot registered')
  assert.ok(registered.includes('conversation.input.left'), 'marker slot registered')
})

// DSH STORE's catalog automation blocks install when an install-time lifecycle
// script is present: the shipped tree (npm pack output, not the git repo)
// carries a prebuilt lib/, so no build must run during `npm install` / git
// install. Keep build under an explicit script the author runs by hand; the
// release workflow packs lib/ and scripts/assert-pack.mjs checks the tarball.
test('no install-time lifecycle scripts are declared', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const installHooks = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack']
  for (const hook of installHooks) {
    assert.equal(pkg.scripts?.[hook], undefined, `${hook} must not run during install; build lib/ by hand before release`)
  }
  // The build entry stays available as an explicit, author-invoked script.
  assert.equal(pkg.scripts.build, 'node build.mjs', 'build remains an explicit script')
})

test('package metadata ships every UI language and names its detail document', async () => {
  const { DICTIONARIES } = await import('../../lib/testkit.mjs')
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const files = new Set(pkg.files)
  for (const id of Object.keys(DICTIONARIES)) {
    const meta = JSON.parse(readFileSync(new URL(`../../locale/${id}.json`, import.meta.url), 'utf8')).meta
    assert.ok(typeof meta.title === 'string' && meta.title !== '', `${id}: title`)
    assert.ok(typeof meta.description === 'string' && meta.description !== '', `${id}: description`)
    if (meta.detail === undefined) continue
    // The plugin page reads meta.detail along the language chain; the file
    // must ship in the tarball and be a package-relative Markdown path.
    assert.match(meta.detail, /^[^/\\:][^\\:]*\.md$/, `${id}: detail is a package-relative Markdown path`)
    assert.ok(files.has(meta.detail), `${id}: ${meta.detail} ships in package.json files`)
    assert.ok(existsSync(new URL(`../../${meta.detail}`, import.meta.url)), `${id}: ${meta.detail} exists`)
  }
  // DSH resolves every locale file through the package exports map; one that
  // is not exported fails the whole metadata read on the plugin page.
  const shipped = readdirSync(new URL('../../locale/', import.meta.url)).filter((f) => f.endsWith('.json'))
  for (const f of shipped) assert.equal(pkg.exports[`./locale/${f}`], `./locale/${f}`, `locale/${f} is exported`)
  assert.deepEqual(shipped.map((f) => f.slice(0, -5)).sort(), Object.keys(DICTIONARIES).sort(), 'one locale file per UI language')
  // Every UI language names its own detail document.
  for (const id of Object.keys(DICTIONARIES)) {
    const meta = JSON.parse(readFileSync(new URL(`../../locale/${id}.json`, import.meta.url), 'utf8')).meta
    assert.equal(meta.detail, `docs/details/DETAIL.${id}.md`, `${id} names its own detail document`)
  }
})

test('the detail documents load their images from absolute URLs', () => {
  // The plugin page renders README images from inside the package or from an
  // http(s) URL only; docs/ assets do not ship, so a relative image never loads.
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const details = readdirSync(new URL('../../docs/details/', import.meta.url)).filter((f) => f.endsWith('.md'))
  for (const doc of ['README.md', 'README.en.md', ...details.map((f) => `docs/details/${f}`)]) {
    const text = readFileSync(new URL(`../../${doc}`, import.meta.url), 'utf8')
    const images = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1])
    assert.ok(images.length > 0, `${doc} has images`)
    for (const src of images) {
      const shipped = pkg.files.some((entry) => src === entry || src.startsWith(entry.replace(/\/?$/, '/')))
      assert.ok(/^https:\/\//.test(src) || shipped, `${doc}: ${src} must be an https URL or a shipped file`)
    }
  }
})
