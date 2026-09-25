/**
 * A minimal synchronous React-hooks runtime for unit-testing the OverviewTab
 * data hooks without a full renderer (react-test-renderer + node:test hangs on
 * the scheduler). Supports useState / useRef / useMemo / useCallback / useEffect
 * with dependency arrays, a manual `rerender`, and `flushEffects`. Deterministic
 * and exits cleanly — enough to drive fetch timing, generation guards, and the
 * detail LRU. Not React; a stand-in scoped to these hooks' hook surface.
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const React = require('react')

function shallowEqualDeps(a, b) {
  if (a === undefined || b === undefined) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false
  return true
}

/** Mount `hook` (a zero-arg thunk closing over props) and return a driver. */
export function mount(hook) {
  const slots = []
  let index = 0
  const pendingEffects = []

  const dispatcher = {
    useState(initial) {
      const i = index++
      if (slots[i] === undefined) {
        const setter = (next) => {
          const cur = slots[i].value
          const val = typeof next === 'function' ? next(cur) : next
          if (!Object.is(val, cur)) { slots[i].value = val }
        }
        slots[i] = { value: typeof initial === 'function' ? initial() : initial, setter }
      }
      return [slots[i].value, slots[i].setter]
    },
    useRef(initial) {
      const i = index++
      if (slots[i] === undefined) slots[i] = { current: initial }
      return slots[i]
    },
    useMemo(factory, deps) {
      const i = index++
      if (slots[i] === undefined || !shallowEqualDeps(slots[i].deps, deps)) {
        slots[i] = { value: factory(), deps }
      }
      return slots[i].value
    },
    useCallback(fn, deps) {
      return dispatcher.useMemo(() => fn, deps)
    },
    useEffect(effect, deps) {
      const i = index++
      const prev = slots[i]
      if (prev === undefined || !shallowEqualDeps(prev.deps, deps)) {
        pendingEffects.push({ i, effect, deps })
      }
      if (prev === undefined) slots[i] = { deps, cleanup: undefined }
      else slots[i] = { ...prev, deps }
    },
  }

  let lastValue
  function render() {
    index = 0
    const secret = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
    const prevDispatcher = secret.ReactCurrentDispatcher.current
    secret.ReactCurrentDispatcher.current = dispatcher
    try { lastValue = hook() } finally { secret.ReactCurrentDispatcher.current = prevDispatcher }
    return lastValue
  }

  function runEffects() {
    const batch = pendingEffects.splice(0)
    for (const { i, effect } of batch) {
      const slot = slots[i]
      if (slot.cleanup !== undefined) { try { slot.cleanup() } catch { /* ignore */ } }
      const cleanup = effect()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  render()
  runEffects()

  return {
    get value() { return lastValue },
    /** Re-render (props may have changed externally), then run new effects. */
    rerender() { render(); runEffects() },
    /** Await queued async work (scripted remote), then re-render + effects. */
    async settle() {
      await new Promise((r) => setTimeout(r, 0))
      for (let i = 0; i < 8; i++) { render(); runEffects(); await Promise.resolve() }
    },
    unmount() { for (const s of slots) if (s && typeof s.cleanup === 'function') { try { s.cleanup() } catch { /* ignore */ } } },
  }
}
