/**
 * Mounting the host half twice must not fail an entry.
 *
 * A profile can compose the same package under two entries (a diagnostic row
 * beside the real one, or a copied row). Cordis service keys are global, so the
 * second activation would throw "service ... has been registered" and leave that
 * entry's fiber failed (the rest of the tree, and the first entry, keep running).
 * The guard in the plugin object keeps the second mount inert and says so once.
 *
 * The guard is deliberately not a module-level flag: the service belongs to the
 * applying fiber, so disposal followed by a config-driven remount must register
 * a fresh instance. These tests pin both halves — including the two windows
 * where the provider is not yet active — with a real Cordis context.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import plugin, { SERVICE_KEY, normalizeConfig } from '../../lib/host/index.js'

/** Minimal live services the plugin injects; mounting must not touch them. */
const STUBS = {
  subprocess: {
    spawn() {
      throw new Error('mount must not spawn a process')
    },
  },
  sessions: { get: () => undefined },
  sessionPersistence: { stat: async () => undefined },
}

function createRoot() {
  const ctx = new Context()
  for (const [name, value] of Object.entries(STUBS)) ctx.provide(name, value)
  return ctx
}

/**
 * Collect every structured log message the context emits. The default logger
 * level hides `warn`, so this exporter raises its own threshold to `debug`
 * (cordis levels: error 0 / info 1 / warn 2 / debug 3).
 */
function capture(ctx) {
  const messages = []
  ctx.logger.exporter({ levels: { default: 3 }, export: (message) => { messages.push(message) } })
  return messages
}

function errorsOf(messages) {
  return messages.filter((m) => m.type === 'error').map((m) => String(m.args[0]))
}

/**
 * The mount's resolved config, read back through the service instance.
 *
 * `rawConfig` is a TS-private field on purpose: the runtime value is the only
 * observable config source, and the test is checking what the plugin resolved,
 * not the schema. Reading it here is a test-only affordance.
 */
function configOf(ctx) {
  const service = ctx.get(SERVICE_KEY)
  return service === undefined ? undefined : normalizeConfig(service.rawConfig)
}

test('a second mount of the same module leaves the first service in place', async () => {
  const ctx = createRoot()
  const messages = capture(ctx)

  const first = ctx.plugin(plugin, { showInputPill: true })
  await first
  assert.equal(configOf(ctx).showInputPill, true, 'the first mount registers the service')
  assert.equal(ctx.get(SERVICE_KEY).typertRemote.namespace, SERVICE_KEY, 'the wire namespace follows the service key')

  const second = ctx.plugin(plugin, { showInputPill: false })
  await second

  assert.equal(configOf(ctx).showInputPill, true, 'the second mount does not replace the instance')
  assert.deepEqual(errorsOf(messages), [], 'no activation error reaches the tree')
  const warns = messages.filter((m) => m.type === 'warn')
  assert.equal(warns.length, 1, 'the skipped mount is reported once')
  assert.match(String(warns[0].args[0]), /already registered/)
  assert.ok(warns[0].args.includes(SERVICE_KEY), 'the report names the service key')
})

test('a second copy of the module is guarded too', async () => {
  // Two entry rows can resolve to two module instances; their apply functions
  // differ, so the plugin registry does not deduplicate them for us.
  const copy = { ...plugin, apply: (ctx, config) => plugin.apply(ctx, config) }
  const ctx = createRoot()
  const messages = capture(ctx)

  const first = ctx.plugin(plugin, { showInputPill: true })
  await first

  const second = ctx.plugin(copy, { showInputPill: false })
  await second

  assert.equal(configOf(ctx).showInputPill, true)
  assert.deepEqual(errorsOf(messages), [])
  assert.equal(messages.filter((m) => m.type === 'warn').length, 1)
})

test('a config edit restarts the same fiber and re-registers the service', async () => {
  // A non-volatile config change restarts the fiber: the running service is
  // disposed and the plugin re-applies in place. The guard must not mistake
  // that transient absence for another owner. (Volatile fields skip the
  // restart in the loader; this pins the cordis restart path itself.)
  const ctx = createRoot()
  const fiber = ctx.plugin(plugin, { showInputPill: true })
  await fiber
  fiber.update({ showInputPill: false })
  await fiber.await()
  assert.equal(configOf(ctx).showInputPill, false)
})

test('the guard does not outlive the fiber: a remount registers a fresh service', async () => {
  const ctx = createRoot()

  const fiber = ctx.plugin(plugin, { showInputPill: true })
  await fiber
  assert.ok(ctx.get(SERVICE_KEY))

  await fiber.dispose()
  assert.equal(ctx.get(SERVICE_KEY), undefined, 'disposal unregisters the service')

  const again = ctx.plugin(plugin, { showInputPill: false })
  await again
  assert.equal(configOf(ctx).showInputPill, false, 'a config-driven remount is not mistaken for a duplicate')

  await again.dispose()
})

test('mounts issued before either settles do not race the registration', async () => {
  // The loader mounts entries concurrently: both fibers activate in adjacent
  // microtasks, and the first registrant is still state 1 while the second
  // applies. A strict lookup would miss the taken key and the second provide
  // would throw "already registered".
  const ctx = createRoot()
  const messages = capture(ctx)

  const first = ctx.plugin(plugin, { showInputPill: true })
  const second = ctx.plugin(plugin, { showInputPill: false })
  await Promise.allSettled([first, second])

  assert.ok(ctx.get(SERVICE_KEY), 'one mount owns the service')
  assert.deepEqual(errorsOf(messages), [], 'neither mount fails')
  assert.equal(messages.filter((m) => m.type === 'warn').length, 1, 'the loser reports once')

  await Promise.allSettled([first.dispose(), second.dispose()])
})

test('a provider restart reloads both mounts without an error', async () => {
  // Every dependent reloads in one batch when an injected provider restarts.
  // Both mounts re-apply; the guard must let exactly one through.
  const ctx = new Context()
  const messages = capture(ctx)
  const deps = {
    name: 'test-deps',
    apply(c) {
      for (const [name, value] of Object.entries(STUBS)) c.provide(name, value)
    },
  }
  const depsFiber = ctx.plugin(deps)
  await depsFiber

  const first = ctx.plugin(plugin, { showInputPill: true })
  await first
  const second = ctx.plugin(plugin, { showInputPill: false })
  await second
  messages.length = 0

  depsFiber.update({})
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.ok(ctx.get(SERVICE_KEY), 'the service survives the provider restart')
  assert.deepEqual(errorsOf(messages), [], 'no duplicate-registration error')
  assert.equal(messages.filter((m) => m.type === 'warn').length, 1, 'the inert mount reports once')

  await Promise.allSettled([first.dispose(), second.dispose(), depsFiber.dispose()])
})
