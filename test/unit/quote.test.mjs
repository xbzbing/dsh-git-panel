/**
 * Quoting into the session's composer: the probe, the insert, and the two
 * failure shapes (a host without the conversation package, a session whose
 * scope is not retained). The composer surface is declared structurally, so
 * these fixtures stand in for it exactly — a shape change upstream has to break
 * a test here rather than a user's menu.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { insertSessionQuote, quoteAvailable, commitQuote } from '../../lib/testkit.mjs'

/** A client ctx exposing one `sessions` service (or none). */
function ctxWith(service) {
  return { get: (key) => (key === 'sessions' ? service : undefined) }
}

/** A sessions service whose scope answers a conversation with one input face. */
function fakeSessions({ insert = () => true, throwOnScope = false, withConversation = true } = {}) {
  const calls = { inserted: [], focused: 0 }
  const input = {
    insertQuote: (text) => { calls.inserted.push(text); return insert(text) },
    focus: () => { calls.focused += 1 },
  }
  const scope = {
    get: (key) => (withConversation && key === 'conversation' ? { input: { for: () => input } } : undefined),
  }
  return {
    calls,
    service: {
      scope: () => {
        if (throwOnScope) throw new Error('not retained')
        return scope
      },
    },
  }
}

test('a quote lands in the composer and hands the keyboard back', () => {
  const { service, calls } = fakeSessions()
  assert.equal(insertSessionQuote(ctxWith(service), 's', 'README.md'), true)
  assert.deepEqual(calls.inserted, ['README.md'])
  assert.equal(calls.focused, 1, 'the draft is editable right away')
})

test('a composer that refuses the quote reports false and takes no focus', () => {
  const { service, calls } = fakeSessions({ insert: () => false })
  assert.equal(insertSessionQuote(ctxWith(service), 's', 'x'), false)
  assert.equal(calls.focused, 0)
})

test('an absent sessions service, scope or conversation resolves to false', () => {
  assert.equal(insertSessionQuote(ctxWith(undefined), 's', 'x'), false)
  assert.equal(insertSessionQuote(ctxWith(fakeSessions({ throwOnScope: true }).service), 's', 'x'), false)
  assert.equal(insertSessionQuote(ctxWith(fakeSessions({ withConversation: false }).service), 's', 'x'), false)
  assert.equal(insertSessionQuote({ get: () => undefined }, 's', 'x'), false)
})

test('blank text and a missing session never reach the composer', () => {
  const { service, calls } = fakeSessions()
  assert.equal(insertSessionQuote(ctxWith(service), undefined, 'x'), false)
  assert.equal(insertSessionQuote(ctxWith(service), '', 'x'), false)
  assert.equal(insertSessionQuote(ctxWith(service), 's', '   '), false)
  assert.deepEqual(calls.inserted, [])
})

test('the probe answers whether the menu may offer the entry at all', () => {
  assert.equal(quoteAvailable(ctxWith(fakeSessions().service), 's'), true)
  assert.equal(quoteAvailable(ctxWith(fakeSessions({ throwOnScope: true }).service), 's'), false)
  assert.equal(quoteAvailable(ctxWith(fakeSessions({ withConversation: false }).service), 's'), false)
  assert.equal(quoteAvailable(ctxWith(undefined), 's'), false)
  assert.equal(quoteAvailable(ctxWith(fakeSessions().service), undefined), false)
})

test('a commit quotes its short hash and subject', () => {
  assert.equal(commitQuote('a1b2c3d', 'fix: the thing'), 'a1b2c3d fix: the thing')
  assert.equal(commitQuote('a1b2c3d', '  '), 'a1b2c3d', 'an empty subject leaves only the hash')
})
