/**
 * Putting a reference into the session's composer.
 *
 * "Reference this" is the one menu outcome that does not belong to this plugin:
 * the text lands in the conversation's draft, where the agent can act on it.
 * The face belongs to `@deepseek-ai/dsh-client-ui-conversation`, whose layout is
 * not ours to import — so the path is declared structurally and probed at use
 * time, the way `sidebar-types.ts` treats the right sidebar:
 *
 *   ctx.sessions.scope(sessionId)?.get('conversation')?.input.for(scope).insertQuote(text)
 *
 * Every hop is optional (an older host, a session that is not retained, a
 * composer that never mounted), and the platform's resolver throws when the
 * scope is not retained. So the probe reports whether it landed, and the caller
 * falls back to the clipboard instead of offering an entry that does nothing.
 */
import type { ClientCtx } from './rpc.js'

/** The session-scope face this module reads (a Cordis scope's `get`). */
interface SessionScopeFace {
  get(key: string): unknown
}

/** The composer's quote entry point, as far as this plugin uses it. */
interface InputQuoteFace {
  readonly insertQuote: (text: string) => boolean
  readonly focus: () => void
}

/** The conversation service's input registry. */
interface ConversationFace {
  readonly input?: { for(scope: unknown): InputQuoteFace }
}

/** The `sessions` client service. */
interface SessionsFace {
  scope(sessionId: string): SessionScopeFace | undefined
}

function isQuoteFace(value: unknown): value is InputQuoteFace {
  if (typeof value !== 'object' || value === null) return false
  const face = value as { insertQuote?: unknown; focus?: unknown }
  return typeof face.insertQuote === 'function' && typeof face.focus === 'function'
}

/**
 * Insert one quote into a session's composer.
 * @param ctx - client context (the services are read per call; they may arrive
 *   after this plugin).
 * @param sessionId - the session whose composer should take the text.
 * @param text - non-blank quote text.
 * @returns whether the composer accepted it — false means "nothing was
 *   written", never "maybe".
 */
export function insertSessionQuote(ctx: ClientCtx, sessionId: string | undefined, text: string): boolean {
  if (sessionId === undefined || sessionId === '' || text.trim() === '') return false
  const sessions = ctx.get('sessions') as SessionsFace | undefined
  if (sessions === undefined || typeof sessions.scope !== 'function') return false
  try {
    const scope = sessions.scope(sessionId)
    if (scope === undefined || typeof scope.get !== 'function') return false
    const conversation = scope.get('conversation') as ConversationFace | undefined
    const resolver = conversation?.input
    if (resolver === undefined || typeof resolver.for !== 'function') return false
    const input = resolver.for(scope)
    if (!isQuoteFace(input)) return false
    if (!input.insertQuote(text)) return false
    // The quote lands in the draft; handing the keyboard back is what makes it
    // editable instead of a silent write behind a menu.
    input.focus()
    return true
  } catch {
    // An unretained session scope throws by contract; there is nothing to
    // report beyond "the composer is not there".
    return false
  }
}

/**
 * Whether a session has a composer to quote into. Probed before the entries are
 * offered, so a menu never shows "reference this" on a host (or a session) that
 * would drop the text.
 * @param ctx - client context.
 * @param sessionId - the session to ask about.
 */
export function quoteAvailable(ctx: ClientCtx, sessionId: string | undefined): boolean {
  if (sessionId === undefined || sessionId === '') return false
  const sessions = ctx.get('sessions') as SessionsFace | undefined
  if (sessions === undefined || typeof sessions.scope !== 'function') return false
  try {
    const scope = sessions.scope(sessionId)
    if (scope === undefined || typeof scope.get !== 'function') return false
    const conversation = scope.get('conversation') as ConversationFace | undefined
    return conversation?.input !== undefined && typeof conversation.input.for === 'function'
  } catch {
    return false
  }
}

/** What a commit row quotes: its short hash followed by the subject, so the
 * agent can find the commit from the text alone. */
export function commitQuote(shortHash: string, subject: string): string {
  const text = subject.trim()
  return text === '' ? shortHash : `${shortHash} ${text}`
}

/** What a file row quotes: its path as the browser shows it (relative to the
 * browse root), which is what git commands and diffs use. */
export function pathQuote(path: string): string {
  return path
}
