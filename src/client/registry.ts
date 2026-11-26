/**
 * Per-session controller registry + a React hook to subscribe to its view.
 * The registry is module-level so the pill and both panel tabs share one
 * controller (and therefore one snapshot) per session.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CheckoutController, type CheckoutState } from './checkout-controller.js'
import { GitController, type GitView } from './controller.js'
import { useControllerQueryGate, type GitQueryGate } from './use-git-query-signal.js'
import { gitPanelRemoteOf, type ClientCtx, type GitPanelRemote } from './rpc.js'

const controllers = new Map<string, GitController>()
const checkouts = new Map<string, CheckoutController>()
let sharedRemote: GitPanelRemote | undefined
let sharedCtx: ClientCtx | undefined

/** Bind the client context once (called from apply). */
export function bindContext(ctx: ClientCtx): void {
  sharedCtx = ctx
  sharedRemote = gitPanelRemoteOf(ctx)
}

/** Get (or create) the controller for a session. */
export function controllerFor(sessionId: string): GitController {
  let controller = controllers.get(sessionId)
  if (controller === undefined) {
    const remote = sharedRemote ?? (sharedCtx ? gitPanelRemoteOf(sharedCtx) : undefined)
    controller = new GitController(remote ?? failingRemote(), sessionId)
    controllers.set(sessionId, controller)
  }
  return controller
}

const IDLE_DISPOSE_MS = 60_000
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Reference-count a controller's live subscribers; dispose after an idle grace
 * period at zero so per-session controllers don't accumulate unbounded (each
 * one owns a polling timer). */
function retain(sessionId: string): void {
  const timer = idleTimers.get(sessionId)
  if (timer !== undefined) { clearTimeout(timer); idleTimers.delete(sessionId) }
  refCounts.set(sessionId, (refCounts.get(sessionId) ?? 0) + 1)
}

function release(sessionId: string, controller: GitController): void {
  if (controllers.get(sessionId) !== controller) return
  const next = (refCounts.get(sessionId) ?? 1) - 1
  if (next > 0) { refCounts.set(sessionId, next); return }
  refCounts.delete(sessionId)
  const timer = setTimeout(() => {
    if (controllers.get(sessionId) !== controller) return
    idleTimers.delete(sessionId)
    if ((refCounts.get(sessionId) ?? 0) > 0) return
    checkouts.get(sessionId)?.dispose()
    checkouts.delete(sessionId)
    controller.dispose()
    controllers.delete(sessionId)
  }, IDLE_DISPOSE_MS)
  idleTimers.set(sessionId, timer)
}

const refCounts = new Map<string, number>()

/** Refresh every live controller (connection reset). */
export function resyncAll(): void {
  for (const c of checkouts.values()) c.invalidate()
  for (const c of controllers.values()) c.resync()
}

/** Dispose every controller (plugin teardown). */
export function disposeAll(): void {
  for (const c of checkouts.values()) c.dispose()
  checkouts.clear()
  for (const c of controllers.values()) c.dispose()
  controllers.clear()
  for (const timer of idleTimers.values()) clearTimeout(timer)
  idleTimers.clear()
  refCounts.clear()
}

/** Remote for a surface whose context is not bound yet: the call never reached
 * the host, so it fails at the transport layer. Reporting `git-unavailable`
 * here would claim git is missing and degrade a healthy panel to file-only
 * mode with a false notice. */
function failingRemote(): GitPanelRemote {
  const fail = async () => ({ ok: false as const, error: { code: 'transport' as const } })
  return { snapshot: fail as never, run: fail as never, query: fail as never, suggest: fail as never, version: fail as never, openFile: fail as never, writeFile: fail as never }
}

const EMPTY_CHECKOUT: CheckoutState = { list: null, ready: false }
const NO_LIST = (): CheckoutState => EMPTY_CHECKOUT
const NO_SUBSCRIPTION = (): (() => void) => () => {}
const NO_REFETCH = (): void => {}

/** Shared discovery/follow lifetime. Updating a directory does not release and
 * reacquire the observer: that would turn each move into another initial scan.
 * The instance is created in an effect, never during render: a render that is
 * thrown away must not leave a registry entry and three store subscriptions
 * behind for the rest of the plugin's life. */
export function useCheckouts(sessionId: string | undefined, active: boolean, directory: string | null, discover: boolean): CheckoutState & {
  readonly refetch: () => void
} {
  const owner = useRef(Symbol('gp-checkout-observer'))
  const git = sessionId ? controllerFor(sessionId) : undefined
  // One pair per surface: the instance this hook is subscribed to, and the
  // session it belongs to (a session switch must not read the previous one).
  const [owned, setOwned] = useState<{ sessionId: string; controller: CheckoutController } | null>(() => {
    const existing = sessionId === undefined ? undefined : checkouts.get(sessionId)
    return sessionId === undefined || existing === undefined ? null : { sessionId, controller: existing }
  })
  useEffect(() => {
    if (sessionId === undefined || git === undefined) return
    const existing = checkouts.get(sessionId)
    const instance = existing ?? new CheckoutController(sharedRemote ?? failingRemote(), sessionId, git)
    if (existing === undefined) checkouts.set(sessionId, instance)
    // The updater keeps the pair identical when it already is: React bails out
    // instead of re-rendering, so a repeat effect run is free.
    setOwned((current) => (current !== null && current.sessionId === sessionId && current.controller === instance ? current : { sessionId, controller: instance }))
    retain(sessionId)
    const token = owner.current
    return () => { instance.release(token); release(sessionId, git) }
  }, [sessionId, git])
  const checkout = owned !== null && owned.sessionId === sessionId ? owned.controller : undefined
  const state = useSyncExternalStore(checkout?.subscribe ?? NO_SUBSCRIPTION, checkout?.getSnapshot ?? NO_LIST)
  useEffect(() => {
    checkout?.observe(owner.current, active, directory, discover)
  }, [checkout, active, directory, discover])
  return { ...state, refetch: checkout?.refetch ?? NO_REFETCH }
}

/** Query ticks rerender only visible leaf surfaces, never the Panel or pill. */
export function useGitQuerySignal(sessionId: string | undefined, active: boolean, expectedRoot: string): GitQueryGate {
  // Hidden leaves may observe an existing store but must not create an unretained one.
  const controller = sessionId ? active ? controllerFor(sessionId) : controllers.get(sessionId) : undefined
  const gate = useControllerQueryGate(controller, active, expectedRoot)
  useEffect(() => {
    if (!active || controller === undefined || sessionId === undefined) return
    retain(sessionId)
    controller.ensure()
    return () => release(sessionId, controller)
  }, [controller, sessionId, active])
  return gate
}

/** Subscribe a component to a session's git view; kicks the controller on mount. */
export function useGitView(sessionId: string | undefined): GitView {
  const [, forceRender] = useState(0)
  const controller = sessionId ? controllerFor(sessionId) : undefined
  const view: GitView = controller ? controller.getSnapshot() : { state: 'cold' }
  useEffect(() => {
    if (controller === undefined || sessionId === undefined) return
    retain(sessionId)
    const unsub = controller.subscribe(() => forceRender((n) => n + 1))
    // A snapshot may publish between render and effect subscription.
    // `view` is the render-time baseline of that race check, not a data
    // source: depending on it would tear down and rebuild the subscription on
    // every view change; later publishes already reach the live subscription.
    if (controller.getSnapshot() !== view) forceRender((n) => n + 1)
    controller.ensure()
    return () => { unsub(); release(sessionId, controller) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, sessionId])
  return view
}
