/**
 * Per-session controller registry + a React hook to subscribe to its view.
 * The registry is module-level so the pill and both panel tabs share one
 * controller (and therefore one snapshot) per session.
 */
import { useEffect, useState } from 'react'
import { GitController, type GitView } from './controller.js'
import { useControllerQueryGate, type GitQueryGate } from './use-git-query-signal.js'
import { gitPanelRemoteOf, type ClientCtx, type GitPanelRemote } from './rpc.js'

const controllers = new Map<string, GitController>()
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
    controller.dispose()
    controllers.delete(sessionId)
  }, IDLE_DISPOSE_MS)
  idleTimers.set(sessionId, timer)
}

const refCounts = new Map<string, number>()

/** Refresh every live controller (connection reset). */
export function resyncAll(): void {
  for (const c of controllers.values()) c.resync()
}

/** Dispose every controller (plugin teardown). */
export function disposeAll(): void {
  for (const c of controllers.values()) c.dispose()
  controllers.clear()
  for (const timer of idleTimers.values()) clearTimeout(timer)
  idleTimers.clear()
  refCounts.clear()
}

function failingRemote(): GitPanelRemote {
  const fail = async () => ({ ok: false as const, error: { code: 'git-unavailable' as const } })
  return { snapshot: fail as never, run: fail as never, query: fail as never, suggest: fail as never, version: fail as never }
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
    if (controller.getSnapshot() !== view) forceRender((n) => n + 1)
    controller.ensure()
    return () => { unsub(); release(sessionId, controller) }
  }, [controller, sessionId])
  return view
}
