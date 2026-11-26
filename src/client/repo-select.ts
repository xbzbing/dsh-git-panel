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

/** Sessions whose current selection came from the automatic follow, not the
 * user. It is still a selection (the panel is pointed at that checkout), but it
 * must not read as intent: `hasRepoPick` ignores it, and a repair of a followed
 * row must not rewrite the tab record over the user's earlier manual pick. */
const autoSelections = new Set<string>()

/** Sessions whose explicit pick was `''` (the cwd's own repository): `''`
 * resets the selection map, so intent has to live outside it or "never
 * picked" and "picked `''` on purpose" would be the same state. */
const rootPicks = new Set<string>()

/** Sessions whose stored record this module has already read. A record is read
 * once per module load: a repair that cleared memory must not be undone by the
 * next lookup reading the record back. */
const loaded = new Set<string>()

/** How many deliberate picks this module has recorded. A value alone cannot
 * tell two picks of the same selector apart, so the follow logic compares this
 * number instead: a pick made after a directory move is new intent even when it
 * names the row the move released. Follows and repairs never advance it. */
let pickRevision = 0

/** The revision of the latest deliberate pick. */
export function repoPickRevision(): number {
  return pickRevision
}

/** Sessions whose file-root pick came back from a record made under a follow
 * config no sample of this module has confirmed yet (see syncFilesFollowConfig). */
const unconfirmedFollow = new Map<string, boolean>()

/** Sessions whose stored file-root pick carries no follow value: it was made
 * before any sample of this module read the config. The first sample stamps
 * it with the value in force, so a later flip can still retire it. */
const unstampedFollow = new Set<string>()

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
    updatePicks([sessionId], withoutFiles, { touch: false })
    return
  }
  applyFilesPick(sessionId, record.files)
  if (record.follow !== undefined) {
    if (followConfig === undefined) unconfirmedFollow.set(sessionId, record.follow)
  } else if (followConfig !== undefined) stampFollow([sessionId], followConfig.value)
  else unstampedFollow.add(sessionId)
}

/** Record the follow config a session's file-root pick now belongs to. */
function stampFollow(ids: readonly string[], follow: boolean): void {
  updatePicks(ids, (record) => {
    if (record === undefined) return undefined
    const { at: _at, ...rest } = record
    return rest.files === undefined ? rest : { ...rest, follow }
  }, { touch: false })
}

function withoutFiles(record: PickRecord | undefined): Omit<PickRecord, 'at'> | undefined {
  if (record === undefined) return undefined
  const { files: _files, follow: _follow, at: _at, ...rest } = record
  return rest
}

/** Write the session's repository pick (memory is the source) into its record. */
function persistRepo(sessionId: string): void {
  // An automatic follow never owns the record: a repair that runs while it is
  // selected must leave the user's earlier pick in the tab store untouched.
  if (autoSelections.has(sessionId)) return
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
  if (autoSelections.has(sessionId)) return false
  return selections.has(sessionId) || rootPicks.has(sessionId)
}

/** Point a session at another repository; '' records a deliberate pick of the
 * workspace root (the reset of the selection itself, but not of the intent).
 * `persist: false` keeps the pick in memory only: an automatic pick (the panel
 * choosing a session's first sub-repository) is not the user's intent, and
 * writing it would pin every later load to a choice nobody made.
 * `intent: false` says the same thing to the follow logic: the pick must not
 * release a follow the way a click does. */
export function selectRepo(sessionId: string, repo: string, options: { readonly persist?: boolean; readonly intent?: boolean } = {}): void {
  hydrate(sessionId)
  autoSelections.delete(sessionId)
  if (options.intent !== false) pickRevision += 1
  if (repo === '') {
    selections.delete(sessionId)
    rootPicks.add(sessionId)
  } else {
    rootPicks.delete(sessionId)
    selections.set(sessionId, repo)
  }
  if (options.persist !== false) persistRepo(sessionId)
  notifySelection()
}

/**
 * Point a session at a checkout the panel followed automatically (the session's
 * working directory moved into another checkout of its own repository). The
 * selection changes in memory only and records no intent: `selectRepo` records
 * even a `persist: false` pick of `''` as a deliberate root pick, which would
 * make a later mount mistake an automatic return for the user's choice. A
 * manual pick still wins and is persisted through `selectRepo`.
 */
export function followRepo(sessionId: string, repo: string): void {
  hydrate(sessionId)
  autoSelections.add(sessionId)
  // The followed checkout replaces any in-memory root intent too: the panel is
  // on that checkout now, and `hasRepoPick` must not call it the user's choice.
  rootPicks.delete(sessionId)
  if (repo === '') selections.delete(sessionId)
  else selections.set(sessionId, repo)
  notifySelection()
}

/** Drop any pick without recording intent: the repair path (a pick the host
 * can no longer resolve) must not read as "the user chose the root". By
 * default only this module load falls back; `forget` also deletes the stored
 * pick, for a refusal the host gave as definitive. */
export function clearRepoPick(sessionId: string, options: { readonly forget?: boolean } = {}): void {
  hydrate(sessionId)
  const followed = autoSelections.has(sessionId)
  autoSelections.delete(sessionId)
  selections.delete(sessionId)
  rootPicks.delete(sessionId)
  // A followed selection never owned the record: clearing it must not rewrite
  // the user's earlier manual pick out of the tab store.
  if (options.forget === true && !followed) persistRepo(sessionId)
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
  unstampedFollow.delete(sessionId)
  const pin = filesPicks.get(sessionId)
  const files: FilesPick | undefined = pin !== undefined
    ? { mode: 'pin', path: pin }
    : filesRootPicks.has(sessionId)
      ? { mode: 'root' }
      : filesFollowPicks.has(sessionId) ? { mode: 'follow' } : undefined
  const follow = followConfig?.value
  if (files !== undefined && follow === undefined) unstampedFollow.add(sessionId)
  updatePicks([sessionId], (record) => {
    const rest = withoutFiles(record) ?? {}
    return files === undefined ? rest : { ...rest, files, ...(follow !== undefined ? { follow } : {}) }
  })
}

/** Bumped on every file-root change the store makes on its own (a repair, a
 * config flip) or on a panel's behalf, so every mounted copy re-renders. */
let filesVersion = 0

/** The file-root state's version, for `useSyncExternalStore`. */
export function filesRootVersion(): number {
  return filesVersion
}

function notifyFiles(): void {
  filesVersion += 1
  notifySelection()
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
  notifyFiles()
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
  notifyFiles()
}

/** Choose the follow row: the browser tracks the switched repository again —
 * an opt-in that holds whatever the config default says. */
export function resumeFilesRootFollow(sessionId: string): void {
  hydrate(sessionId)
  filesPicks.delete(sessionId)
  filesRootPicks.delete(sessionId)
  filesFollowPicks.add(sessionId)
  persistFiles(sessionId)
  notifyFiles()
}

/** Drop every session's override: flipping the follow config re-arms the
 * default for all of them. */
export function resetFilesRootPicks(): void {
  filesPicks.clear()
  filesRootPicks.clear()
  filesFollowPicks.clear()
  unconfirmedFollow.clear()
  unstampedFollow.clear()
  updatePicks('all', withoutFiles, { touch: false })
  notifyFiles()
}

/** Drop one session's file-root override, in memory and in its record. */
function dropFilesPick(sessionId: string): void {
  filesPicks.delete(sessionId)
  filesRootPicks.delete(sessionId)
  filesFollowPicks.delete(sessionId)
  unstampedFollow.delete(sessionId)
  updatePicks([sessionId], withoutFiles, { touch: false })
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
  if (unstampedFollow.size > 0) {
    stampFollow([...unstampedFollow], value)
    unstampedFollow.clear()
  }
  let dropped = false
  for (const [sessionId, recorded] of unconfirmedFollow) {
    if (recorded === value) continue
    dropFilesPick(sessionId)
    dropped = true
  }
  unconfirmedFollow.clear()
  if (dropped) notifyFiles()
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
