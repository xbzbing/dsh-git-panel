/**
 * Per-session repository selection.
 *
 * The panel can follow a nested repository below the workspace instead of the
 * repository the workspace lives in. A selection is that repository's path
 * relative to the session cwd — '' means "the repository the cwd belongs to",
 * which is the historical behavior. State is module-level so the pill, all
 * three tabs and every RPC share one choice per session.
 *
 * The module is the only reader and writer of the tab's pick record
 * (pick-store.ts): a session's record is read once, on its first lookup after
 * the module loads, and every deliberate pick writes it back. A repair either
 * stays in memory (the host could not confirm the pick this time; the next
 * module load tries it again) or forgets the record too (the host answered
 * that the selector is gone).
 */
import type { GitPanelRemote } from './rpc.js'
import { readPick, updatePicks, type FilesPick, type PickRecord } from './pick-store.js'

const selections = new Map<string, string>()

/** Sessions whose explicit pick was `''` (the cwd's own repository): `''`
 * resets the selection map, so intent has to live outside it or "never
 * picked" and "picked `''` on purpose" would be the same state. */
const rootPicks = new Set<string>()

/** Sessions whose stored record this module has already read. A record is read
 * once per module load: a repair that cleared memory must not be undone by the
 * next lookup reading the record back. */
const loaded = new Set<string>()

/** Sessions whose file-root pick came back from a record made under a follow
 * config no sample of this module has confirmed yet (see syncFilesFollowConfig). */
const unconfirmedFollow = new Map<string, boolean>()

/** Move a session's stored record into memory, once. No notification: a read
 * only fills in what the store already held before the module reloaded. */
function hydrate(sessionId: string): void {
  if (loaded.has(sessionId)) return
  loaded.add(sessionId)
  const record = readPick(sessionId)
  if (record === undefined) return
  if (record.repo !== undefined) selections.set(sessionId, record.repo)
  else if (record.rootPick === true) rootPicks.add(sessionId)
  if (record.files === undefined) return
  if (record.follow !== undefined && followConfig !== undefined && record.follow !== followConfig.value) {
    // The picks belong to a setting that is no longer in force.
    updatePicks([sessionId], withoutFiles)
    return
  }
  applyFilesPick(sessionId, record.files)
  if (record.follow !== undefined && followConfig === undefined) unconfirmedFollow.set(sessionId, record.follow)
}

function withoutFiles(record: PickRecord | undefined): Omit<PickRecord, 'at'> | undefined {
  if (record === undefined) return undefined
  const { files: _files, follow: _follow, at: _at, ...rest } = record
  return rest
}

/** Write the session's repository pick (memory is the source) into its record. */
function persistRepo(sessionId: string): void {
  updatePicks([sessionId], (record) => {
    const { repo: _repo, rootPick: _rootPick, at: _at, ...rest } = record ?? { at: 0 }
    const repo = selections.get(sessionId)
    return {
      ...rest,
      ...(repo !== undefined ? { repo } : rootPicks.has(sessionId) ? { rootPick: true as const } : {}),
    }
  })
}

/** The repository this session follows ('' = the cwd's own repository). */
export function selectedRepo(sessionId: string): string {
  hydrate(sessionId)
  return selections.get(sessionId) ?? ''
}

/** Whether this session ever chose a checkout — including a deliberate return
 * to the workspace root. A repair (dropRepo) is not a choice. */
export function hasRepoPick(sessionId: string): boolean {
  hydrate(sessionId)
  return selections.has(sessionId) || rootPicks.has(sessionId)
}

/** Point a session at another repository; '' records a deliberate pick of the
 * workspace root (the reset of the selection itself, but not of the intent). */
export function selectRepo(sessionId: string, repo: string): void {
  hydrate(sessionId)
  if (repo === '') {
    selections.delete(sessionId)
    rootPicks.add(sessionId)
  } else {
    rootPicks.delete(sessionId)
    selections.set(sessionId, repo)
  }
  persistRepo(sessionId)
  notifySelection()
}

/** Drop any pick without recording intent: the repair path (a pick the host
 * can no longer resolve) must not read as "the user chose the root". By
 * default only this module load falls back; `forget` also deletes the stored
 * pick, for a refusal the host gave as definitive. */
export function clearRepoPick(sessionId: string, options: { readonly forget?: boolean } = {}): void {
  hydrate(sessionId)
  selections.delete(sessionId)
  rootPicks.delete(sessionId)
  if (options.forget === true) persistRepo(sessionId)
  notifySelection()
}

/**
 * Selection changes are broadcast, not polled: one session can have two panels
 * mounted at once (the conversation tab and the sidebar keepMounted copy), and
 * each renders the same chosen checkout while the snapshot behind them is one
 * shared controller. A per-instance copy of the pick would let one panel show
 * repository A while the other tags its writes with B.
 */
const selectionListeners = new Set<() => void>()

/** Subscribe to any selection change; returns the unsubscribe function. */
export function subscribeRepoSelection(listener: () => void): () => void {
  selectionListeners.add(listener)
  return () => { selectionListeners.delete(listener) }
}

function notifySelection(): void {
  for (const listener of [...selectionListeners]) listener()
}

/** Manual file-browser root picks, independent of the followed repository: a
 * pick sticks across repository switches until resumed or reset. */
const filesPicks = new Map<string, string>()
/** Sessions whose file-root pick was `''` (the project root): '' deletes from
 * the map, so the deliberate pick needs the same side-set as `rootPicks`. */
const filesRootPicks = new Set<string>()
/** Sessions that chose the follow row: the browser tracks the switched
 * repository whatever the config default says. */
const filesFollowPicks = new Set<string>()

function applyFilesPick(sessionId: string, pick: FilesPick): void {
  if (pick.mode === 'pin') filesPicks.set(sessionId, pick.path)
  else if (pick.mode === 'root') filesRootPicks.add(sessionId)
  else filesFollowPicks.add(sessionId)
}

/** Write the session's file-root pick (memory is the source) into its record,
 * with the follow config it was made under. */
function persistFiles(sessionId: string): void {
  unconfirmedFollow.delete(sessionId)
  const pin = filesPicks.get(sessionId)
  const files: FilesPick | undefined = pin !== undefined
    ? { mode: 'pin', path: pin }
    : filesRootPicks.has(sessionId)
      ? { mode: 'root' }
      : filesFollowPicks.has(sessionId) ? { mode: 'follow' } : undefined
  const follow = followConfig?.value
  updatePicks([sessionId], (record) => {
    const rest = withoutFiles(record) ?? {}
    return files === undefined ? rest : { ...rest, files, ...(follow !== undefined ? { follow } : {}) }
  })
}

/** The selector file-browser requests run under: an explicit choice first (a
 * root pick, then the follow opt-in), else the config default — off parks at
 * the project root, on follows the repository the panel follows. */
export function filesRootSelector(sessionId: string, follow: boolean): string {
  hydrate(sessionId)
  const pick = filesPicks.get(sessionId)
  if (pick !== undefined) return pick
  if (filesRootPicks.has(sessionId)) return ''
  if (filesFollowPicks.has(sessionId)) return selectedRepo(sessionId)
  return follow ? selectedRepo(sessionId) : ''
}

/** The dropdown's source mark: '' = the project root, a path = that checkout,
 * null = following (the follow row highlights then). An unchosen session
 * reads its source off the config default: on → follow, off → project root. */
export function filesRootPick(sessionId: string, follow: boolean): string | null {
  hydrate(sessionId)
  if (filesRootPicks.has(sessionId)) return ''
  const pick = filesPicks.get(sessionId)
  if (pick !== undefined) return pick
  if (filesFollowPicks.has(sessionId)) return null
  return follow ? null : ''
}

/** Root the browser at a candidate ('' = the project root); picking a root
 * ends any follow opt-in. */
export function pickFilesRoot(sessionId: string, path: string): void {
  hydrate(sessionId)
  filesFollowPicks.delete(sessionId)
  if (path === '') {
    filesPicks.delete(sessionId)
    filesRootPicks.add(sessionId)
  } else {
    filesRootPicks.delete(sessionId)
    filesPicks.set(sessionId, path)
  }
  persistFiles(sessionId)
}

/** The checkout a session's browser is pinned to, when it picked one. */
export function pinnedFilesRoot(sessionId: string): string | undefined {
  hydrate(sessionId)
  return filesPicks.get(sessionId)
}

/** Drop a session's checkout pin without recording intent: the repair path
 * when the pinned checkout left the list — the session returns to the config
 * default, exactly like a session that never picked. `forget` also deletes the
 * stored pin, as for clearRepoPick. */
export function clearFilesRootPin(sessionId: string, options: { readonly forget?: boolean } = {}): void {
  hydrate(sessionId)
  filesPicks.delete(sessionId)
  if (options.forget === true) persistFiles(sessionId)
}

/** Choose the follow row: the browser tracks the switched repository again —
 * an opt-in that holds whatever the config default says. */
export function resumeFilesRootFollow(sessionId: string): void {
  hydrate(sessionId)
  filesPicks.delete(sessionId)
  filesRootPicks.delete(sessionId)
  filesFollowPicks.add(sessionId)
  persistFiles(sessionId)
}

/** Drop every session's override: flipping the follow config re-arms the
 * default for all of them. */
export function resetFilesRootPicks(): void {
  filesPicks.clear()
  filesRootPicks.clear()
  filesFollowPicks.clear()
  unconfirmedFollow.clear()
  updatePicks('all', withoutFiles)
}

/** Drop one session's file-root override, in memory and in its record. */
function dropFilesPick(sessionId: string): void {
  filesPicks.delete(sessionId)
  filesRootPicks.delete(sessionId)
  filesFollowPicks.delete(sessionId)
  updatePicks([sessionId], withoutFiles)
}

/** The follow config as last read off a ready sample, with that sample's
 * `checkedAt`. The config is host-wide, so one record serves every panel
 * instance and session; undefined = no sample read yet. */
let followConfig: { readonly value: boolean; readonly at: number } | undefined

/** The follow config the newest ready sample carried, if any. */
export function knownFilesFollowConfig(): boolean | undefined {
  return followConfig?.value
}

/**
 * Feed the follow config from a ready sample. Only a change seen on a sample
 * newer than the last one read re-arms the default (every override dropped):
 * the first sighting is a mount, not a flip, and an older sample — a hidden
 * session's cached view — must not flip it back. A pick restored from a record
 * made under another value than this sample carries is dropped the same way:
 * the setting flipped while no module was there to see it.
 *
 * @returns Whether any override was dropped.
 */
export function syncFilesFollowConfig(value: boolean, checkedAt: number): boolean {
  if (followConfig !== undefined && checkedAt <= followConfig.at) return false
  const flipped = followConfig !== undefined && followConfig.value !== value
  followConfig = { value, at: checkedAt }
  if (flipped) {
    resetFilesRootPicks()
    return true
  }
  let dropped = false
  for (const [sessionId, recorded] of unconfirmedFollow) {
    if (recorded === value) continue
    dropFilesPick(sessionId)
    dropped = true
  }
  unconfirmedFollow.clear()
  return dropped
}

/**
 * A remote face that tags every repository-scoped request with `repo`. The tabs
 * and their hooks stay unaware of the selection: they keep calling
 * `remote.query({ sessionId, query })` and this wrapper fills the field in.
 */
export function withRepo(remote: GitPanelRemote, repo: string): GitPanelRemote {
  if (repo === '') return remote
  const tag = <T extends { readonly sessionId: string }>(request: T): T => ({ ...request, repo }) as T
  return {
    snapshot: (request, signal) => remote.snapshot(tag(request), signal),
    run: (request, signal) => remote.run(tag(request), signal),
    query: (request, signal) => remote.query(tag(request), signal),
    suggest: (request, signal) => remote.suggest(tag(request), signal),
    // Version lookup is host-scoped, never repository-scoped.
    version: (request, signal) => remote.version(request, signal),
    openFile: (request, signal) => remote.openFile(tag(request), signal),
    writeFile: (request, signal) => remote.writeFile(tag(request), signal),
  }
}
