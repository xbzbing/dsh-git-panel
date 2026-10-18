/**
 * model-catalog query (issue #54): aggregates ctx.llm providers / models /
 * reasoning metadata for the plugin config form. Every failure is isolated —
 * one broken adapter must never blank the whole catalog.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runQuery, DEFAULT_CONFIG } from '../../lib/host/index.js'

/** SnapshotDeps slice for a pure host-level query (no git, no workspace). */
function depsWithLlm(llm) {
  return {
    run: { run: async () => { throw new Error('git must not run for model-catalog') } },
    fs: {},
    sessions: { liveCwd: () => undefined, persistedMeta: async () => undefined },
    getLlm: () => llm,
  }
}

function catalogQuery() {
  return { sessionId: '', query: { kind: 'model-catalog' } }
}

test('no llm service yields an empty catalog, not an error', async () => {
  const res = await runQuery({ ...depsWithLlm(undefined), getLlm: () => undefined }, DEFAULT_CONFIG, catalogQuery())
  assert.equal(res.ok, true)
  assert.equal(res.value.kind, 'model-catalog')
  assert.deepEqual(res.value.groups, [])
  assert.deepEqual(res.value.failures, [])
})

test('aggregates providers, models and reasoning efforts', async () => {
  const llm = {
    listProviders: () => [
      { id: 'p1', name: 'Provider One' },
      { id: 'p2', name: 'Provider Two' },
    ],
    async listModels(provider) {
      if (provider === 'p1') return [{ id: 'm1', name: 'Model One' }, { id: 'm2', name: 'Model Two' }]
      return [{ id: 'm3', name: 'Model Three' }]
    },
    async resolveModelInfo(provider, model) {
      if (provider === 'p1' && model === 'm2') {
        return { reasoning: { efforts: [{ id: 'low', name: 'low' }, { id: 'high', name: 'high' }], defaultEffort: 'low' } }
      }
      return {}
    },
  }
  const res = await runQuery(depsWithLlm(llm), DEFAULT_CONFIG, catalogQuery())
  assert.equal(res.ok, true)
  assert.equal(res.value.groups.length, 2)
  const p1 = res.value.groups.find((g) => g.id === 'p1')
  assert.equal(p1.name, 'Provider One')
  assert.equal(p1.models.length, 2)
  const m2 = p1.models.find((m) => m.id === 'm2')
  assert.deepEqual(m2.reasoning.efforts.map((e) => e.id), ['low', 'high'])
  // The adapter's defaultEffort is not propagated: the wire type carries only
  // the effort ids the form renders.
  assert.equal(m2.reasoning.defaultEffort, undefined)
  // A model without metadata has no reasoning key.
  const m1 = p1.models.find((m) => m.id === 'm1')
  assert.equal(m1.reasoning, undefined)
})

test('parallel aggregation keeps provider input order regardless of completion order', async () => {
  const llm = {
    listProviders: () => [{ id: 'slow' }, { id: 'fast' }],
    async listModels(provider) {
      // 'slow' resolves last: output order must follow the input, not completion.
      if (provider === 'slow') await new Promise((resolve) => setTimeout(resolve, 30))
      return [{ id: 'm', name: 'M' }]
    },
    resolveModelInfo: async () => ({}),
  }
  const res = await runQuery(depsWithLlm(llm), DEFAULT_CONFIG, catalogQuery())
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.groups.map((g) => g.id), ['slow', 'fast'])
})

test('a failing provider is isolated into failures; others still load', async () => {
  const llm = {
    listProviders: () => [{ id: 'bad' }, { id: 'good' }],
    async listModels(provider) {
      if (provider === 'bad') throw new Error('adapter offline')
      return [{ id: 'm', name: 'M' }]
    },
    resolveModelInfo: async () => ({}),
  }
  const res = await runQuery(depsWithLlm(llm), DEFAULT_CONFIG, catalogQuery())
  assert.equal(res.ok, true)
  assert.equal(res.value.groups.length, 1)
  assert.equal(res.value.groups[0].id, 'good')
  assert.equal(res.value.failures.length, 1)
  assert.equal(res.value.failures[0].id, 'bad')
  assert.match(res.value.failures[0].message, /adapter offline/)
})

test('a provider that lists zero models is dropped from groups', async () => {
  const llm = {
    listProviders: () => [{ id: 'empty' }, { id: 'full' }],
    async listModels(provider) {
      return provider === 'empty' ? [] : [{ id: 'm', name: 'M' }]
    },
    resolveModelInfo: async () => ({}),
  }
  const res = await runQuery(depsWithLlm(llm), DEFAULT_CONFIG, catalogQuery())
  assert.equal(res.value.groups.length, 1)
  assert.equal(res.value.groups[0].id, 'full')
  assert.equal(res.value.failures.length, 0)
})

test('a resolveModelInfo failure keeps the model without efforts', async () => {
  const llm = {
    listProviders: () => [{ id: 'p' }],
    async listModels() { return [{ id: 'm', name: 'M' }] },
    async resolveModelInfo() { throw new Error('metadata unavailable') },
  }
  const res = await runQuery(depsWithLlm(llm), DEFAULT_CONFIG, catalogQuery())
  assert.equal(res.ok, true)
  assert.equal(res.value.groups[0].models[0].id, 'm')
  assert.equal(res.value.groups[0].models[0].reasoning, undefined)
  assert.equal(res.value.failures.length, 0)
})

test('without listModels the catalog is empty (not an error)', async () => {
  const llm = { listProviders: () => [{ id: 'p', name: 'P' }] }
  const res = await runQuery(depsWithLlm(llm), DEFAULT_CONFIG, catalogQuery())
  assert.equal(res.ok, true)
  assert.deepEqual(res.value.groups, [])
})

// Host LlmRuntime implements listModels / resolveModelInfo with
// this.registration(...). Detaching those methods before the call would lose
// the receiver and blank every provider — lock the call-site binding shape.
test('catalog methods keep their receiver (this-dependent LlmRuntime shape)', async () => {
  const llm = {
    listProviders() { return [{ id: 'p', name: 'P' }] },
    async listModels(provider) {
      if (!this.listProviders().some((row) => row.id === provider)) throw new Error('unknown provider')
      return [{ id: 'm', name: 'M' }]
    },
    async resolveModelInfo(provider, model) {
      await this.listModels(provider)
      if (model !== 'm') throw new Error('unknown model')
      return { reasoning: { efforts: [{ id: 'low', name: 'low' }] } }
    },
  }
  const res = await runQuery(depsWithLlm(llm), DEFAULT_CONFIG, catalogQuery())
  assert.equal(res.ok, true)
  assert.equal(res.value.groups.length, 1)
  assert.equal(res.value.groups[0].models[0].reasoning.efforts[0].id, 'low')
  assert.deepEqual(res.value.failures, [])
})
