/**
 * The platform's local-changes review tab, as this plugin reaches it.
 *
 * The optional "Change requests & worktrees" bundle
 * (`@deepseek-ai/dsh-experimental-forge-bundle`, dsh 0.2.3+) draws a "Local
 * changes" tab in the right sidebar where a reader comments on diff lines and
 * adds each comment to the composer. Its client half provides a `forgeChanges`
 * face; this module declares the one method it calls structurally (the package
 * is optional, so nothing is imported from it) and probes for it at use time,
 * the way `quote.ts` treats the composer.
 *
 * That tab reads the session's own checkout and nothing else, so the entry is
 * offered only for the panel's default repository (the one holding the session
 * cwd). A nested checkout, a worktree or an external root keeps this plugin's
 * own diff comments instead (ADR-0039).
 */
import type { ClientCtx } from './rpc.js'

/** Service key the forge client half provides. */
const SERVICE = 'forgeChanges'

/** What the local-changes tab shows: the session checkout's changes. */
interface ForgeChangesTarget {
  readonly sessionId: string
  readonly source: { readonly kind: 'local' }
}

/** The face this plugin calls: open (or reveal) the tab, scrolled to a file. */
interface ForgeChangesFace {
  open(target: ForgeChangesTarget, params?: { readonly path?: string }): void
}

function faceOf(ctx: ClientCtx): ForgeChangesFace | undefined {
  let value: unknown
  try {
    value = ctx.get(SERVICE)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  return typeof (value as { open?: unknown }).open === 'function' ? value as ForgeChangesFace : undefined
}

/**
 * Whether the local-changes tab can show a file of this panel.
 * @param ctx - client context (read per call: the bundle may load after us).
 * @param sessionId - the panel's session.
 * @param repo - the panel's repository tag; `''` is the session checkout.
 */
export function reviewViewAvailable(ctx: ClientCtx, sessionId: string | undefined, repo: string): boolean {
  if (sessionId === undefined || sessionId === '' || repo !== '') return false
  return faceOf(ctx) !== undefined
}

/**
 * Open the local-changes tab of a session at one file.
 * @param ctx - client context.
 * @param sessionId - the session whose sidebar shows the tab.
 * @param path - repository-relative path to scroll to.
 * @returns whether the tab was asked to open — false when the face is gone or
 *   refused (it throws for a session the sidebar does not show).
 */
export function openReviewView(ctx: ClientCtx, sessionId: string, path: string): boolean {
  const face = faceOf(ctx)
  if (face === undefined) return false
  try {
    face.open({ sessionId, source: { kind: 'local' } }, path === '' ? undefined : { path })
    return true
  } catch {
    return false
  }
}
