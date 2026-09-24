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
  return { snapshot: fail as never, run: fail as never, query: fail as never }
}

/** Subscribe a component to a session's git view; kicks the controller on mount. */
export function useGitView(sessionId: string | undefined): GitView {
  const [, forceRender] = useState(0)
  const controller = sessionId ? controllerFor(sessionId) : undefined
  useEffect(() => {
    if (controller === undefined) return
    const unsub = controller.subscribe(() => forceRender((n) => n + 1))
    controller.ensure()
    return unsub
  }, [controller])
  return controller ? controller.getSnapshot() : { state: 'cold' }
}
