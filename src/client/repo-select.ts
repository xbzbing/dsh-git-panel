/**
 * Per-session repository selection.
 *
 * The panel can follow a nested repository below the workspace instead of the
 * repository the workspace lives in. A selection is that repository's path
 * relative to the session cwd — '' means "the repository the cwd belongs to",
 * which is the historical behavior. State is module-level so the pill, all
 * three tabs and every RPC share one choice per session.
 */
import type { GitPanelRemote } from './rpc.js'

const selections = new Map<string, string>()

/** Sessions whose explicit pick was `''` (the cwd's own repository): `''`
 * resets the selection map, so intent has to live outside it or "never
 * picked" and "picked `''` on purpose" would be the same state. */
const rootPicks = new Set<string>()

/** The repository this session follows ('' = the cwd's own repository). */
export function selectedRepo(sessionId: string): string {
  return selections.get(sessionId) ?? ''
}

/** Whether this session ever chose a checkout — including a deliberate return
 * to the workspace root. A repair (dropRepo) is not a choice. */
export function hasRepoPick(sessionId: string): boolean {
  return selections.has(sessionId) || rootPicks.has(sessionId)
}

/** Point a session at another repository; '' records a deliberate pick of the
 * workspace root (the reset of the selection itself, but not of the intent). */
export function selectRepo(sessionId: string, repo: string): void {
  if (repo === '') {
    selections.delete(sessionId)
    rootPicks.add(sessionId)
  } else {
    rootPicks.delete(sessionId)
    selections.set(sessionId, repo)
  }
  notifySelection()
}

/** Forget any pick without recording intent: the repair path (a pick the host
 * can no longer resolve) must not read as "the user chose the root". */
export function clearRepoPick(sessionId: string): void {
  selections.delete(sessionId)
  rootPicks.delete(sessionId)
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

/** The selector file-browser requests run under: an explicit choice first (a
 * root pick, then the follow opt-in), else the config default — off parks at
 * the project root, on follows the repository the panel follows. */
export function filesRootSelector(sessionId: string, follow: boolean): string {
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
  if (filesRootPicks.has(sessionId)) return ''
  const pick = filesPicks.get(sessionId)
  if (pick !== undefined) return pick
  if (filesFollowPicks.has(sessionId)) return null
  return follow ? null : ''
}

/** Root the browser at a candidate ('' = the project root); picking a root
 * ends any follow opt-in. */
export function pickFilesRoot(sessionId: string, path: string): void {
  filesFollowPicks.delete(sessionId)
  if (path === '') {
    filesPicks.delete(sessionId)
    filesRootPicks.add(sessionId)
  } else {
    filesRootPicks.delete(sessionId)
    filesPicks.set(sessionId, path)
  }
}

/** The checkout a session's browser is pinned to, when it picked one. */
export function pinnedFilesRoot(sessionId: string): string | undefined {
  return filesPicks.get(sessionId)
}

/** Drop a session's checkout pin without recording intent: the repair path
 * when the pinned checkout left the list — the session returns to the config
 * default, exactly like a session that never picked. */
export function clearFilesRootPin(sessionId: string): void {
  filesPicks.delete(sessionId)
}

/** Choose the follow row: the browser tracks the switched repository again —
 * an opt-in that holds whatever the config default says. */
export function resumeFilesRootFollow(sessionId: string): void {
  filesPicks.delete(sessionId)
  filesRootPicks.delete(sessionId)
  filesFollowPicks.add(sessionId)
}

/** Drop every session's override: flipping the follow config re-arms the
 * default for all of them. */
export function resetFilesRootPicks(): void {
  filesPicks.clear()
  filesRootPicks.clear()
  filesFollowPicks.clear()
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
 * session's cached view — must not flip it back.
 *
 * @returns Whether the overrides were reset.
 */
export function syncFilesFollowConfig(value: boolean, checkedAt: number): boolean {
  if (followConfig !== undefined && checkedAt <= followConfig.at) return false
  const flipped = followConfig !== undefined && followConfig.value !== value
  followConfig = { value, at: checkedAt }
  if (flipped) resetFilesRootPicks()
  return flipped
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
  }
}
