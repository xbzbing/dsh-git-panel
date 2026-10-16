import { useEffect, useState } from 'react'
import type { GitController, GitQuerySignal } from './controller.js'
import type { QueryKey } from './query-key.js'

const COLD: GitQuerySignal = { tick: 0, sampledAt: 0, ready: false, root: null }

export interface GitQueryGate {
  readonly signal: GitQuerySignal
  readonly queryVisible: boolean
  readonly queryKey: QueryKey
}

/** Subscribe only while an active query surface is visible. */
export function useControllerQuerySignal(controller: GitController | undefined, visible: boolean): GitQuerySignal {
  const [signal, setSignal] = useState<GitQuerySignal>(() => controller?.getQuerySignal() ?? COLD)
  useEffect(() => {
    if (controller === undefined) { setSignal(COLD); return }
    const sync = (): void => setSignal(controller.getQuerySignal())
    if (!visible) { sync(); return }
    const unsubscribe = controller.subscribeQueries(sync)
    sync()
    return unsubscribe
  }, [controller, visible])
  // Read synchronously on activation so an old hidden key cannot query before
  // the subscription effect catches up to the current controller state.
  return visible ? controller?.getQuerySignal() ?? COLD : signal
}

/** Keep subscription demand separate from readiness so restoration can unlock. */
export function useControllerQueryGate(controller: GitController | undefined, active: boolean, expectedRoot: string): GitQueryGate {
  const signal = useControllerQuerySignal(controller, active)
  return {
    signal,
    // Store notifications can render a leaf before its parent supplies new props.
    // Root equality prevents that transient old-props/new-store query pairing.
    queryVisible: active && signal.ready && signal.root === expectedRoot,
    queryKey: [signal.root, signal.tick],
  }
}
