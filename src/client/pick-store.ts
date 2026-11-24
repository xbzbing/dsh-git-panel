/**
 * The tab-scoped record of a session's picks: which checkout the panel follows
 * and where the file browser is rooted. It lets a module reload (the platform's
 * hot reload re-evaluates this bundle when another plugin is installed or
 * removed) and a page refresh come back to the same checkout.
 *
 * The record is intent, not fact: every value is a selector the host resolves
 * again on the next request through its own doors, so nothing read back here
 * is trusted as a path. `sessionStorage` keeps it to the tab that made the
 * pick: a blank new tab or a restarted browser starts from the default
 * checkout, so a write cannot land in a checkout the user no longer expects (a
 * duplicated tab, or one opened from this one, starts from a copy and then
 * writes its own). Any storage
 * failure (blocked, full, absent in tests) degrades to memory only.
 */
import { NS } from './namespace.js'

export const PICKS_KEY = `${NS}.picks`
export const PICKS_VERSION = 1
/** Sessions one tab remembers; the oldest picks go first. */
export const PICKS_MAX = 50
/** Bounds on what a record may hold; anything larger is not a selector. */
const KEY_MAX = 256
const PATH_MAX = 4096

/** The file browser's source: the project root, a pinned checkout, or the
 * follow opt-in. */
export type FilesPick =
  | { readonly mode: 'root' }
  | { readonly mode: 'follow' }
  | { readonly mode: 'pin'; readonly path: string }

export interface PickRecord {
  /** A checkout selector; absent = none picked. */
  readonly repo?: string
  /** The cwd's own repository was chosen on purpose. */
  readonly rootPick?: true
  readonly files?: FilesPick
  /** The follow config in force when `files` was picked; absent = unknown. */
  readonly follow?: boolean
  /** Epoch ms of the last write, for the eviction order. */
  readonly at: number
}

function isSelector(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= PATH_MAX && !value.includes('\0')
}

function parseFiles(value: unknown): FilesPick | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const mode = (value as { mode?: unknown }).mode
  if (mode === 'root' || mode === 'follow') return { mode }
  const path = (value as { path?: unknown }).path
  if (mode === 'pin' && isSelector(path)) return { mode, path }
  return undefined
}

function parseRecord(value: unknown): PickRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return undefined
  const repo = isSelector(raw.repo) ? raw.repo : undefined
  const files = parseFiles(raw.files)
  const record: PickRecord = {
    ...(repo !== undefined ? { repo } : raw.rootPick === true ? { rootPick: true as const } : {}),
    ...(files !== undefined ? { files } : {}),
    ...(files !== undefined && typeof raw.follow === 'boolean' ? { follow: raw.follow } : {}),
    at: raw.at,
  }
  return record.repo === undefined && record.rootPick === undefined && record.files === undefined ? undefined : record
}

/** Decode a stored value; anything malformed, or of another version, reads as
 * "nothing remembered" rather than failing the panel. */
export function parsePicks(raw: string | null): Map<string, PickRecord> {
  const out = new Map<string, PickRecord>()
  if (raw === null) return out
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return out
  }
  if (typeof data !== 'object' || data === null) return out
  const { v, sessions } = data as { v?: unknown; sessions?: unknown }
  if (v !== PICKS_VERSION || typeof sessions !== 'object' || sessions === null) return out
  for (const [key, value] of Object.entries(sessions)) {
    if (key === '' || key.length > KEY_MAX) continue
    const record = parseRecord(value)
    if (record !== undefined) out.set(key, record)
  }
  return out
}

/** Encode, keeping the `PICKS_MAX` most recently written sessions. */
export function serializePicks(picks: ReadonlyMap<string, PickRecord>): string {
  const kept = [...picks].sort((a, b) => b[1].at - a[1].at).slice(0, PICKS_MAX)
  return JSON.stringify({ v: PICKS_VERSION, sessions: Object.fromEntries(kept) })
}

function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    // Reading the property itself throws where storage is blocked.
    return undefined
  }
}

/** The record for one session, if the tab holds one. */
export function readPick(sessionId: string): PickRecord | undefined {
  const store = storage()
  if (store === undefined) return undefined
  try {
    return parsePicks(store.getItem(PICKS_KEY)).get(sessionId)
  } catch {
    return undefined
  }
}

function sameRecord(a: PickRecord, b: Omit<PickRecord, 'at'>): boolean {
  const fa = a.files
  const fb = b.files
  const sameFiles = fa === undefined || fb === undefined
    ? fa === fb
    : fa.mode === fb.mode && (fa.mode !== 'pin' || (fb.mode === 'pin' && fa.path === fb.path))
  return a.repo === b.repo && a.rootPick === b.rootPick && a.follow === b.follow && sameFiles
}

/**
 * Rewrite the records `update` touches. The stored value is read again on every
 * write rather than cached, so two panels of the tab (or a reloaded module)
 * never write back a stale copy of each other's sessions. `update` returns the
 * next record, or undefined to delete it.
 *
 * `at` orders eviction by the user's last pick, so only a record that changed
 * takes the current time, and `touch: false` keeps it even then: a repair or
 * a config flip rewriting every record is not a pick in any of them.
 */
export function updatePicks(
  sessionIds: readonly string[] | 'all',
  update: (record: PickRecord | undefined) => Omit<PickRecord, 'at'> | undefined,
  options: { readonly touch?: boolean } = {},
): void {
  const store = storage()
  if (store === undefined) return
  try {
    const picks = parsePicks(store.getItem(PICKS_KEY))
    const ids = sessionIds === 'all' ? [...picks.keys()] : sessionIds
    const now = Date.now()
    for (const id of ids) {
      const prev = picks.get(id)
      const next = update(prev)
      if (next === undefined || (next.repo === undefined && next.rootPick === undefined && next.files === undefined)) picks.delete(id)
      else if (prev === undefined || !sameRecord(prev, next)) {
        picks.set(id, { ...next, at: prev !== undefined && options.touch === false ? prev.at : now })
      }
    }
    if (picks.size === 0) store.removeItem(PICKS_KEY)
    else store.setItem(PICKS_KEY, serializePicks(picks))
  } catch {
    // Quota or a blocked store: the pick still holds in memory.
  }
}
