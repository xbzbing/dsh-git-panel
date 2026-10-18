/**
 * Model cascade invariants (issue #54 follow-up review): which selection
 * survives a provider / model switch. The one hard error these guard is an
 * effort a model does not advertise reaching `GenerateOptions.reasoningEffort`,
 * so every step drops stale halves the same way.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelForProvider, effortForModel } from '../../lib/testkit.mjs'

/** Two providers sharing the same model id with disjoint effort sets, plus a
 * provider whose copy of the model exposes no efforts at all. */
const catalog = [
  {
    id: 'a', name: 'A', models: [
      { id: 'shared', name: 'Shared' },
      { id: 'asonly', name: 'A-Only', reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }] } },
    ],
  },
  {
    id: 'b', name: 'B', models: [
      { id: 'shared', name: 'Shared', reasoning: { efforts: [{ id: 'minimal', name: 'minimal' }, { id: 'medium', name: 'medium' }] } },
    ],
  },
  { id: 'bare', name: 'Bare', models: [{ id: 'plain', name: 'Plain' }] },
]

test('modelForProvider keeps a model the new provider also advertises', () => {
  assert.equal(modelForProvider(catalog, 'b', 'shared'), 'shared')
})

test('modelForProvider drops a model unknown to the new provider', () => {
  assert.equal(modelForProvider(catalog, 'b', 'asonly'), '')
})

test('modelForProvider clears with the session-default (empty) provider', () => {
  assert.equal(modelForProvider(catalog, '', 'shared'), '')
})

test('modelForProvider handles an unknown provider defensively', () => {
  assert.equal(modelForProvider(catalog, 'missing', 'shared'), '')
})

test('effortForModel keeps an effort the model still advertises', () => {
  assert.equal(effortForModel(catalog, 'a', 'asonly', 'high'), 'high')
})

test('effortForModel drops an effort the new model does not advertise (same model id, other provider)', () => {
  // Provider A's 'high' must not ride along when the shared model lands on B.
  assert.equal(effortForModel(catalog, 'b', 'shared', 'high'), '')
  assert.equal(effortForModel(catalog, 'a', 'asonly', 'minimal'), '')
})

test('effortForModel drops any effort on a model without efforts entry', () => {
  assert.equal(effortForModel(catalog, 'bare', 'plain', 'high'), '')
})

test('effortForModel clears without a model', () => {
  assert.equal(effortForModel(catalog, 'a', '', 'high'), '')
  assert.equal(effortForModel(catalog, 'missing', 'asonly', 'high'), '')
})
