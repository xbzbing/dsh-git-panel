/**
 * Architecture guardrails.
 *
 * The layering rules AGENTS.md states are asserted here, not just written in
 * prose: a violating import (or a new import cycle) fails `npm run test:unit`
 * instead of being caught in review. The rules are deliberately few and each
 * one has a concrete failure it prevents.
 *
 *  - host is a Node service: no React, no client half, no platform client module.
 *  - client ships to the browser: no Node built-ins.
 *  - the wire types are the only door between the halves, and only through the
 *    two barrels that are allowed to reach host (`types.ts` at runtime,
 *    `testkit.ts` in tests).
 *  - the module graph stays acyclic (type-only imports included: a type cycle
 *    still makes one module the hub every consumer must import).
 *  - the pure algorithms stay pure: no React, no RPC, no platform imports, so
 *    `node --test` can exercise them from the ESM bundle.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../../src/', import.meta.url))

/** Every TypeScript module under `src/`, as forward-slash paths relative to it. */
function sourceFiles(dir = SRC) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name)) found.push(full)
  }
  return found
}

/**
 * Drop comments while keeping string literals intact, so a specifier written
 * inside prose (e.g. a doc comment showing `import('./chunk.js')`) is not read
 * as a real edge. Regex literals containing `\/\/` are not modelled and can eat
 * the rest of their line; that only ever hides an import, never invents one.
 */
function stripComments(source) {
  let out = ''
  let index = 0
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index++
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index++
      index += 2
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      out += char
      index++
      while (index < source.length) {
        if (source[index] === '\\') { out += source[index] + (source[index + 1] ?? ''); index += 2; continue }
        out += source[index]
        const closed = source[index] === char
        index++
        if (closed) break
      }
      continue
    }
    out += char
    index++
  }
  return out
}

/** Import specifiers of one module: side-effect, static `from '…'`, `import('…')`. */
function specifiersOf(source) {
  const found = []
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) found.push(match[1])
  for (const match of source.matchAll(/(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g)) found.push(match[1])
  for (const match of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1])
  return found
}

/**
 * True when the `from '…'` at `fromIndex` belongs to a type-only statement
 * (`import type …` / `export type …`), which the build erases: such an import
 * costs nothing at runtime, so the browser/purity rules must not flag it.
 */
function isTypeOnly(source, fromIndex) {
  const head = source.slice(0, fromIndex)
  const start = Math.max(head.lastIndexOf('import'), head.lastIndexOf('export'))
  if (start === -1) return false
  return /^(?:import|export)\s+type\b/.test(source.slice(start, fromIndex))
}

/** Specifiers whose statement survives into the bundle (values, side effects). */
function valueSpecifiersOf(source) {
  const found = []
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) {
    if (!isTypeOnly(source, match.index)) found.push(match[1])
  }
  for (const match of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1])
  return found
}

/** Id of one module relative to `src/`, `/`-separated on every platform. */
function idOf(absolute) {
  return relative(SRC, absolute).split(sep).join('/')
}

/**
 * Resolve a relative specifier to the file it lands on, trying the extensions
 * the build accepts (`./x.js` is written in source and means `x.ts`/`x.tsx`).
 * @returns the absolute path, or undefined when nothing matches.
 */
function resolveRelative(fromFile, specifier) {
  const base = resolve(join(fromFile, '..'), specifier)
  const candidates = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), `${base}.d.ts`]
  return candidates.find((candidate) => existsSync(candidate) && !candidate.endsWith(sep))
}

const FILES = sourceFiles()
const MODULES = FILES.map((file) => {
  const source = stripComments(readFileSync(file, 'utf8'))
  const specifiers = specifiersOf(source)
  return {
    id: idOf(file),
    file,
    specifiers,
    values: valueSpecifiersOf(source),
    relative: specifiers
      .filter((specifier) => specifier.startsWith('.'))
      .map((specifier) => ({ specifier, target: resolveRelative(file, specifier) })),
    bare: specifiers.filter((specifier) => !specifier.startsWith('.')),
  }
})

const byId = new Map(MODULES.map((module) => [module.id, module]))

// ── rules ────────────────────────────────────────────────────────────────────

/** Server built-ins a client module must never reach. */
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'crypto', 'events', 'fs', 'fs/promises', 'http', 'https',
  'module', 'net', 'os', 'path', 'process', 'stream', 'tls', 'url', 'util', 'worker_threads', 'zlib',
])

/** Bare specifiers the host half may not use (it runs in the DSH Node process). */
function hostForbidden(specifier) {
  return specifier === 'react' || specifier === 'react-dom' || specifier === 'react/jsx-runtime'
    || specifier.startsWith('@deepseek-ai/dsh-client-')
}

/** Client modules allowed to import the host half: the wire bridge and the
 * test-only barrel (`hookkit.ts` imports client modules only). */
const HOST_IMPORT_ALLOWED = new Set(['client/types.ts', 'client/testkit.ts'])

/** Pure algorithms: no React, no RPC, no platform — importable from `node --test`. */
const PURE_ALGORITHMS = [
  'branch-options.ts', 'branch-tree.ts', 'bytes.ts', 'code-spans.ts', 'copy-content.ts', 'diff.ts',
  'file-tree.ts', 'filtered-graph.ts', 'git-graph.ts', 'lang-label.ts', 'mermaid-blocks.ts',
  'model-route.ts', 'path-images.ts', 'push-policy.ts', 'selection-keys.ts', 'status.ts', 'time.ts',
  'virtual-list.ts', 'zoom.ts',
]

test('every source module resolves its relative imports', () => {
  const unresolved = []
  for (const module of MODULES) {
    for (const { specifier, target } of module.relative) {
      if (target === undefined) unresolved.push(`${module.id} -> ${specifier}`)
    }
  }
  assert.deepEqual(unresolved, [], 'each relative import must resolve to a file under src/')
})

test('host never imports the client half, React, or a platform client module', () => {
  const violations = []
  for (const module of MODULES) {
    if (!module.id.startsWith('host/')) continue
    for (const { specifier, target } of module.relative) {
      if (target !== undefined && idOf(target).startsWith('client/')) {
        violations.push(`${module.id} -> ${specifier} (reaches the client half)`)
      }
    }
    for (const specifier of module.bare) {
      if (hostForbidden(specifier)) violations.push(`${module.id} -> ${specifier}`)
    }
  }
  assert.deepEqual(violations, [], 'the host half is a plain Node service')
})

test('client never imports a Node built-in', () => {
  const violations = []
  for (const module of MODULES) {
    if (!module.id.startsWith('client/')) continue
    for (const specifier of module.values) {
      const name = specifier.replace(/^node:/, '')
      if (specifier.startsWith('node:') || NODE_BUILTINS.has(name)) {
        violations.push(`${module.id} -> ${specifier}`)
      }
    }
  }
  assert.deepEqual(violations, [], 'the client bundle runs in the browser')
})

test('only the wire bridge and the test barrel reach into host', () => {
  const violations = []
  for (const module of MODULES) {
    if (!module.id.startsWith('client/')) continue
    if (HOST_IMPORT_ALLOWED.has(module.id)) continue
    for (const { specifier, target } of module.relative) {
      if (target !== undefined && idOf(target).startsWith('host/')) {
        violations.push(`${module.id} -> ${specifier}`)
      }
    }
  }
  assert.deepEqual(violations, [], 'client modules import the wire types from ./types.js')
})

test('pure algorithms stay free of React, RPC and platform imports', () => {
  const violations = []
  for (const name of PURE_ALGORITHMS) {
    const module = byId.get(`client/${name}`)
    assert.ok(module, `client/${name} must exist (update PURE_ALGORITHMS when a module is renamed)`)
    for (const specifier of module.values) {
      if (specifier === 'react' || specifier === 'react-dom' || specifier.startsWith('@deepseek-ai/')
        || specifier === './rpc.js' || specifier === './registry.js') {
        violations.push(`client/${name} -> ${specifier}`)
      }
    }
  }
  assert.deepEqual(violations, [], 'pure algorithms must stay importable without a platform')
})

test('the relative import graph has no cycles', () => {
  const state = new Map()
  const stack = []
  const cycles = []
  const visit = (id) => {
    state.set(id, 'open')
    stack.push(id)
    for (const { target } of byId.get(id)?.relative ?? []) {
      if (target === undefined) continue
      const next = idOf(target)
      if (!byId.has(next)) continue
      if (state.get(next) === 'open') cycles.push([...stack.slice(stack.indexOf(next)), next].join(' -> '))
      else if (state.get(next) === undefined) visit(next)
    }
    stack.pop()
    state.set(id, 'done')
  }
  for (const module of MODULES) if (state.get(module.id) === undefined) visit(module.id)
  assert.deepEqual(cycles, [], 'a cycle makes one module the hub every consumer must import')
})
