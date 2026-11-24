/**
 * Quoting into the session's composer: the probe, the insert, and the two
 * failure shapes (a host without the conversation package, a session whose
 * scope is not retained). The composer surface is declared structurally, so
 * these fixtures stand in for it exactly — a shape change upstream has to break
 * a test here rather than a user's menu.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { insertSessionQuote, quoteAvailable, commitQuote, sessionDraft, reviewViewAvailable, openReviewView } from '../../lib/testkit.mjs'

/** A client ctx exposing one `sessions` service (or none). */
function ctxWith(service) {
  return { get: (key) => (key === 'sessions' ? service : undefined) }
}

/** A sessions service whose scope answers a conversation with one input face. */
function fakeSessions({ insert = () => true, throwOnScope = false, withConversation = true, draft } = {}) {
  const calls = { inserted: [], summaries: [], focused: 0 }
  const input = {
    insertQuote: (text, ...rest) => { calls.inserted.push(text); calls.summaries.push(rest); return insert(text) },
    focus: () => { calls.focused += 1 },
    ...(draft === undefined ? {} : { state: { getSnapshot: () => ({ draft }) } }),
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

test('a review quote passes its composer display; a plain quote passes none', () => {
  const { service, calls } = fakeSessions()
  const summary = { label: 'a.ts R2', title: 'src/a.ts', detail: 'R2', body: 'x' }
  assert.equal(insertSessionQuote(ctxWith(service), 's', '## User Comment 1', summary), true)
  assert.equal(insertSessionQuote(ctxWith(service), 's', 'README.md'), true)
  assert.deepEqual(calls.summaries, [[summary], []], 'an older composer never sees an undefined second argument')
})

test('the draft is read for numbering, and an unreadable one is undefined', () => {
  assert.equal(sessionDraft(ctxWith(fakeSessions({ draft: '> ## User Comment 2' }).service), 's'), '> ## User Comment 2')
  assert.equal(sessionDraft(ctxWith(fakeSessions().service), 's'), undefined, 'a composer without a store')
  assert.equal(sessionDraft(ctxWith(fakeSessions({ throwOnScope: true }).service), 's'), undefined)
  assert.equal(sessionDraft(ctxWith(fakeSessions({ draft: 'x' }).service), undefined), undefined)
})

/** A ctx whose `forgeChanges` face records opens (or throws). */
function forgeCtx({ face = true, throws = false } = {}) {
  const opened = []
  const forge = { open: (target, params) => { if (throws) throw new Error('not shown'); opened.push([target, params]) } }
  return { opened, ctx: { get: (key) => (key === 'forgeChanges' && face ? forge : undefined) } }
}

test('the local-changes tab is offered only for the session checkout and only when installed', () => {
  assert.equal(reviewViewAvailable(forgeCtx().ctx, 's', ''), true)
  assert.equal(reviewViewAvailable(forgeCtx().ctx, 's', 'packages/sub'), false, 'another checkout')
  assert.equal(reviewViewAvailable(forgeCtx({ face: false }).ctx, 's', ''), false, 'bundle not enabled')
  assert.equal(reviewViewAvailable(forgeCtx().ctx, undefined, ''), false)
  assert.equal(reviewViewAvailable({ get: () => { throw new Error('no') } }, 's', ''), false)
})

test('opening names the session\'s local changes and the file, and reports a refusal', () => {
  const { ctx, opened } = forgeCtx()
  assert.equal(openReviewView(ctx, 's', 'src/a.ts'), true)
  assert.deepEqual(opened, [[{ sessionId: 's', source: { kind: 'local' } }, { path: 'src/a.ts' }]])
  assert.equal(openReviewView(forgeCtx({ throws: true }).ctx, 's', 'a'), false)
  assert.equal(openReviewView(forgeCtx({ face: false }).ctx, 's', 'a'), false)
})
