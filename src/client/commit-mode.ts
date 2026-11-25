/**
 * The commit action chosen for a session's split commit button.
 *
 * This is a workflow preference, not repository data: it lives in this tab's
 * `sessionStorage`, keyed by the DSH session id, so a page refresh and the
 * platform's module reload (installing or removing another plugin re-evaluates
 * the bundle) come back to the same choice. It is deliberately *not* written to
 * the plugin config: a value that outlived the conversation would silently turn
 * the primary button into a network write weeks later. A new tab starts from
 * `commit` again; only an explicit duplicate of this tab copies its choices.
 *
 * Only the non-default choice is stored; `commit` is the absence of an entry.
 * Any storage failure (blocked, full, absent in tests) degrades to memory.
 */
import { NS } from './namespace.js'

export const COMMIT_MODE_KEY = `${NS}.commit-mode`
export const COMMIT_MODE_VERSION = 1
/** Sessions one tab remembers; the oldest choice goes first. */
export const COMMIT_MODE_MAX = 50
/** Bounds on what may be a session id; anything larger is not one. */
const KEY_MAX = 256

/** `commit` = the primary button only records; `commit-push` = commit, then push. */
export type CommitMode = 'commit' | 'commit-push'

/** Decode a stored value; anything malformed, of another version, or naming an
 * unknown action reads as "nothing remembered" rather than failing the panel. */
export function parseCommitModes(raw: string | null): Map<string, CommitMode> {
  const out = new Map<string, CommitMode>()
  if (raw === null) return out
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return out
  }
  if (typeof data !== 'object' || data === null) return out
  const { v, sessions } = data as { v?: unknown; sessions?: unknown }
  if (v !== COMMIT_MODE_VERSION || typeof sessions !== 'object' || sessions === null) return out
  for (const [key, value] of Object.entries(sessions)) {
    if (key === '' || key.length > KEY_MAX) continue
    if (value === 'commit-push') out.set(key, value)
  }
  return out
}

/** Encode, keeping the `COMMIT_MODE_MAX` most recently written sessions. */
export function serializeCommitModes(modes: ReadonlyMap<string, CommitMode>): string {
  const kept = [...modes].slice(-COMMIT_MODE_MAX)
  return JSON.stringify({ v: COMMIT_MODE_VERSION, sessions: Object.fromEntries(kept) })
}

function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    // Reading the property itself throws where storage is blocked.
    return undefined
  }
}

function readStored(): Map<string, CommitMode> {
  const store = storage()
  if (store === undefined) return new Map()
  try {
    return parseCommitModes(store.getItem(COMMIT_MODE_KEY))
  } catch {
    return new Map()
  }
}

const modes = new Map<string, CommitMode>()
let loaded = false

/** Read the tab's choices in once per module load; the map is the live copy a
 * reloaded module replaces with a fresh read. */
function load(): void {
  if (loaded) return
  loaded = true
  for (const [id, mode] of readStored()) modes.set(id, mode)
}

function persist(): void {
  const store = storage()
  if (store === undefined) return
  try {
    if (modes.size === 0) store.removeItem(COMMIT_MODE_KEY)
    else store.setItem(COMMIT_MODE_KEY, serializeCommitModes(modes))
  } catch {
    // Quota or a blocked store: the choice still holds for this module load.
  }
}

/** The mode this session remembered; `commit` until changed. */
export function commitModeFor(sessionId: string): CommitMode {
  load()
  return modes.get(sessionId) ?? 'commit'
}

/** Remember the chosen mode for the session; `commit` drops the entry instead
 * of storing the default. Re-inserting moves the session to the newest slot. */
export function rememberCommitMode(sessionId: string, mode: CommitMode): void {
  load()
  modes.delete(sessionId)
  if (mode !== 'commit') modes.set(sessionId, mode)
  persist()
}
