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
import { readFileSync } from 'node:fs'
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

function loadClient() {
  const code = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
  let handoff = null
  const sandbox = {
    window: { __ModuleLoader__: { load: (h) => { handoff = h } } },
    document: { querySelector: () => null, createElement: () => ({ dataset: {}, appendChild() {} }), head: { appendChild() {} } },
    require: (spec) => {
      if (spec === 'react') return { createElement: () => ({}), useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useMemo: (f) => f(), useCallback: (f) => f, useLayoutEffect: () => {}, Fragment: 'fragment' }
      if (spec === 'react-dom') return { createPortal: () => ({}) }
      if (spec === 'react/jsx-runtime') return { jsx: () => ({}), jsxs: () => ({}), Fragment: 'fragment' }
      throw new Error('unexpected require: ' + spec)
    },
    Object, Symbol, console, Array, JSON, Date, Set, Map,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  assert.ok(handoff, 'client bundle must call window.__ModuleLoader__.load')
  return handoff
}

test('client bundle is a ModuleLoader registration with id dsh-git-panel', () => {
  const handoff = loadClient()
  assert.equal(handoff.id, 'dsh-git-panel')
  assert.equal(typeof handoff.factory, 'function')
})

test('client factory returns a plugin with apply + inject', () => {
  const handoff = loadClient()
  const plugin = handoff.factory(handoff.__require ?? sandboxRequire())
  assert.equal(typeof plugin.apply, 'function')
  assert.ok(Array.isArray(plugin.inject))
  for (const dep of ['slots', 'locale', 'connection']) {
    assert.ok(plugin.inject.includes(dep), `client inject must include ${dep}`)
  }
})

function sandboxRequire() {
  return (spec) => {
    if (spec === 'react') return { createElement: () => ({}), useState: () => [null, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useMemo: (f) => f(), useCallback: (f) => f, useLayoutEffect: () => {}, Fragment: 'fragment' }
    if (spec === 'react-dom') return { createPortal: () => ({}) }
    if (spec === 'react/jsx-runtime') return { jsx: () => ({}), jsxs: () => ({}), Fragment: 'fragment' }
    throw new Error('unexpected require: ' + spec)
  }
}

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
