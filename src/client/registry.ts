/**
 * Per-session controller registry + a React hook to subscribe to its view.
 * The registry is module-level so the pill and both panel tabs share one
 * controller (and therefore one snapshot) per session.
 */
import { useEffect, useState } from 'react'
import { GitController, type GitView } from './controller'
import { gitPanelRemoteOf, type ClientCtx, type GitPanelRemote } from './rpc'

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

function release(sessionId: string): void {
  const next = (refCounts.get(sessionId) ?? 1) - 1
  if (next > 0) { refCounts.set(sessionId, next); return }
  refCounts.delete(sessionId)
  const timer = setTimeout(() => {
    idleTimers.delete(sessionId)
    if ((refCounts.get(sessionId) ?? 0) > 0) return
    controllers.get(sessionId)?.dispose()
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
}

function failingRemote(): GitPanelRemote {
  const fail = async () => ({ ok: false as const, error: { code: 'git-unavailable' as const } })
  return { snapshot: fail as never, run: fail as never, query: fail as never, version: fail as never }
}

/** Subscribe a component to a session's git view; kicks the controller on mount. */
export function useGitView(sessionId: string | undefined): GitView {
  const [, forceRender] = useState(0)
  const controller = sessionId ? controllerFor(sessionId) : undefined
  useEffect(() => {
    if (controller === undefined || sessionId === undefined) return
    retain(sessionId)
    const unsub = controller.subscribe(() => forceRender((n) => n + 1))
    controller.ensure()
    return () => { unsub(); release(sessionId) }
  }, [controller, sessionId])
  return controller ? controller.getSnapshot() : { state: 'cold' }
}
