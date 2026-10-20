/**
 * The panel's mount: the user's preference, the mounts it asks for, and the
 * reduction to what the host can actually serve.
 *
 * The capability cases matter most: a `sidebar`-only preference on a host
 * without the right sidebar would leave the panel with no entry point at all,
 * so it degrades to `all` rather than to nothing — and the degradation is
 * temporary, because the sidebar may arrive later.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizePlacement, mountState, resolvePlacement, PLACEMENTS, findNamespace } from '../../lib/testkit.mjs'

test('a known placement is kept as it is', () => {
  for (const value of PLACEMENTS) {
    assert.equal(normalizePlacement(value), value)
  }
})

test('an unknown or malformed placement falls back to the default', () => {
  assert.equal(normalizePlacement('nowhere'), 'all')
  assert.equal(normalizePlacement(undefined), 'all')
  assert.equal(normalizePlacement(null), 'all')
  assert.equal(normalizePlacement(42), 'all')
  assert.equal(normalizePlacement({ placement: 'tab' }), 'all')
})

test('the fallback is the caller\'s choice, not always the default', () => {
  assert.equal(normalizePlacement('nowhere', 'tab'), 'tab')
  assert.equal(normalizePlacement('nowhere', 'sidebar'), 'sidebar')
})

test('each placement asks for its own mount points', () => {
  assert.deepEqual(mountState('all'), { tab: true, sidebar: true })
  assert.deepEqual(mountState('tab'), { tab: true, sidebar: false })
  assert.deepEqual(mountState('sidebar'), { tab: false, sidebar: true })
})

test('a sidebar-only preference degrades to both mounts when the sidebar is absent', () => {
  // Without this, the conversation tab is gone AND the sidebar page type is
  // gone: the panel would have no entry point at all.
  assert.equal(resolvePlacement('sidebar', false), 'all')
})

test('a sidebar-only preference stands where the sidebar is available', () => {
  assert.equal(resolvePlacement('sidebar', true), 'sidebar')
})

test('the other placements are unaffected by the sidebar being absent', () => {
  assert.equal(resolvePlacement('tab', false), 'tab')
  assert.equal(resolvePlacement('tab', true), 'tab')
  assert.equal(resolvePlacement('all', false), 'all')
  assert.equal(resolvePlacement('all', true), 'all')
})

test('the namespace is found by any of our own fields', () => {
  const ns = (fields) => [{ ns: 'gitPanel', schema: { dict: fields } }]
  assert.equal(findNamespace(ns({ showInputPill: {} })), 'gitPanel')
  assert.equal(findNamespace(ns({ placement: {} })), 'gitPanel')
  assert.equal(findNamespace(ns({ showInputPill: {}, placement: {} })), 'gitPanel')
  assert.equal(findNamespace(ns({ somethingElse: {} })), undefined)
  assert.equal(findNamespace([]), undefined)
})

test('the namespace is found when the schema is not in dict form', () => {
  // The serialized path may only match the unique field name. Our own schema
  // always declares `showInputPill`, so it is the reliable marker there.
  const rows = [{ ns: 'gitPanel', schema: { type: 'object', properties: { showInputPill: {}, placement: {} } } }]
  assert.equal(findNamespace(rows), 'gitPanel')
})

test('a foreign schema that merely mentions placement is not mistaken for ours', () => {
  // `placement` is a common settings word: a substring match on it would bind
  // this form to another plugin's namespace, then read its values and write
  // ours into it. Only the unique field name may match on the serialized path.
  const rows = [
    { ns: 'other-plugin', schema: { type: 'object', dict: { position: {} }, title: 'Cursor placement for the widget' } },
    { ns: 'gitPanel', schema: { dict: { showInputPill: {}, placement: {} } } },
  ]
  assert.equal(findNamespace(rows), 'gitPanel')
})
