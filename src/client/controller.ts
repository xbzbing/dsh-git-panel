/**
 * Per-session snapshot controller (React-free observable).
 *
 * Single-flight refresh, polling while the page is visible, resync on
 * connection reset, dispose on teardown. The pill,
 * changes page, and stats bar all subscribe to one controller per session so
 * a single git snapshot serves everyone.
 */
import type { GitPanelRemote } from './rpc.js'
import type { GitSnapshot } from './types.js'
import { pageVisibility, type VisibilitySource } from './visibility.js'
import { selectedRepo } from './repo-select.js'

export type GitView =
  | { readonly state: 'cold' }
  | { readonly state: 'loading' }
  | { readonly state: 'no-cwd' }
  | { readonly state: 'ready'; readonly snapshot: GitSnapshot }
  | { readonly state: 'error'; readonly error: { readonly code: string; readonly detail?: string; readonly cwd?: string; readonly showInputPill?: boolean; readonly isGitRepo?: boolean } }

export interface GitQuerySignal {
  readonly tick: number
  readonly sampledAt: number
  readonly ready: boolean
  readonly root: string | null
}

const TERMINAL_CODES: ReadonlySet<string> = new Set(['cwd-unavailable'])
const DEFAULT_POLL_MS = 30_000
const NO_CWD_POLL_MS = 60_000
// Last sample kept per checkout. Switching back republishes it at once, so the
// wait is one round trip at most. Eight is deliberately small: a sample holds
// the whole change list of its checkout, and a workspace that wanders across
// more repositories than this is better off paying one read than pinning every
// list it ever saw.
const SAMPLE_CACHE_LIMIT = 8

export class GitController {
  private view: GitView = { state: 'cold' }
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<void> | undefined
  // The sample in flight may belong to a checkout the user already left; the
  // sequence lets a superseded sample settle without touching the slot.
  private abort: AbortController | undefined
  private inflightSeq = 0
  // Checkout tag ('' = the cwd's own) → the last sample read for it, stamped
  // with this client's clock on arrival (the host's checkedAt is another
  // machine's clock when the GUI is reached remotely).
  private readonly samples = new Map<string, { readonly snapshot: GitSnapshot; readonly receivedAt: number }>()
  // The checkout the published view was read from.
  private viewRepo: string | null = null
  private pendingRefresh = false
  private disposed = false
  private pollMs = DEFAULT_POLL_MS
  private readonly unsubscribeVisibility: () => void
  private visibilityGeneration = 0
  private requestGeneration = 0
  private querySignal: GitQuerySignal = { tick: 0, sampledAt: 0, ready: false, root: null }
  private readonly queryListeners = new Set<() => void>()
  // "Expand all" mode: while set, every snapshot request asks the host to lift
  // the maxChanges slice, so the polled list stays complete (a one-shot expand
  // would be re-truncated by the next poll and the selection pruned away).
  private fullChanges = false
  // Which repository this controller samples: '' is the repository the session
  // cwd belongs to (walk-up behavior), anything else is a nested repository's
  // path relative to that cwd. Rides every snapshot request; the tabs get it
  // through the remote face the panel hands them.
  private repo: string

  constructor(
    private readonly remote: GitPanelRemote,
    private readonly sessionId: string,
    private readonly visibility: VisibilitySource = pageVisibility,
    repo?: string,
  ) {
    this.repo = repo ?? selectedRepo(sessionId)
    this.unsubscribeVisibility = visibility.subscribe(() => {
      if (this.disposed) return
      this.visibilityGeneration += 1
      this.publish(this.view, this.unreadySignal())
      if (visibility.isVisible()) void this.refresh()
      else this.clearPoll()
    })
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot(): GitView {
    return this.view
  }

  subscribeQueries(listener: () => void): () => void {
    this.queryListeners.add(listener)
    return () => { this.queryListeners.delete(listener) }
  }

  getQuerySignal(): GitQuerySignal {
    return this.querySignal
  }

  ensure(): void {
    if (this.inflight !== undefined || (this.view.state !== 'cold' && this.view.state !== 'no-cwd')) return
    void this.refresh()
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (!this.visibility.isVisible()) {
      this.pendingRefresh = true
      this.clearPoll()
      return Promise.resolve()
    }
    if (this.inflight !== undefined) {
      this.pendingRefresh = true
      // Await the catch-up started in finally, so manual refresh stays busy
      // until its requested sample (rather than the older poll) completes.
      return this.inflight.then(() => this.inflight)
    }
    this.pendingRefresh = false
    this.clearPoll()
    const generation = this.visibilityGeneration
    const requestGeneration = this.requestGeneration
    const seq = ++this.inflightSeq
    if (this.view.state === 'cold') this.setView({ state: 'loading' })
    // A switch aborts the sample of the checkout whose answer is now moot, so
    // the new read does not queue behind it.
    const abort = new AbortController()
    this.abort = abort
    this.inflight = this.remote.snapshot({
      sessionId: this.sessionId,
      ...(this.fullChanges ? { fullChanges: true } : {}),
      ...(this.repo !== '' ? { repo: this.repo } : {}),
    }, abort.signal)
      .then((result) => {
        if (this.disposed || requestGeneration !== this.requestGeneration) return
        if (result.ok) {
          this.remember(result.value)
          this.publishSnapshot(result.value, generation, false)
        } else if (result.error.code === 'cancelled') {
          // A caller-driven abort (navigation/reset) is not an error state:
          // keep the current view; the next refresh replaces it.
        } else if (TERMINAL_CODES.has(result.error.code)) {
          this.pollMs = NO_CWD_POLL_MS
          this.setView({ state: 'no-cwd' })
        } else if (result.error.code === 'not-a-git-repo') {
          const e = result.error as { cwd?: string; showInputPill?: boolean }
          this.setView({ state: 'error', error: { code: 'not-a-git-repo', ...(e.cwd ? { cwd: e.cwd } : {}), ...(e.showInputPill !== undefined ? { showInputPill: e.showInputPill } : {}) } })
        } else if (result.error.code === 'git-unavailable') {
          // git not installed → file-browser-only degrade; `isGitRepo` decides
          // whether the panel surfaces the "git not installed" notice.
          const e = result.error as { detail?: string; cwd?: string; isGitRepo?: boolean }
          this.setView({ state: 'error', error: { code: 'git-unavailable', ...(e.detail ? { detail: e.detail } : {}), ...(e.cwd ? { cwd: e.cwd } : {}), ...(e.isGitRepo !== undefined ? { isGitRepo: e.isGitRepo } : {}) } })
        } else {
          this.setView({ state: 'error', error: { code: result.error.code, ...('detail' in result.error ? { detail: (result.error as { detail?: string }).detail } : {}) } })
        }
      })
      .catch((error: unknown) => {
        if (this.disposed || requestGeneration !== this.requestGeneration) return
        this.setView({ state: 'error', error: { code: 'git-unavailable', detail: error instanceof Error ? error.message : String(error) } })
      })
      .finally(() => {
        // A switch may already own the slot with a newer sample: it schedules
        // the poll once its own answer lands.
        if (seq !== this.inflightSeq) return
        this.inflight = undefined
        if (this.abort === abort) this.abort = undefined
        // A resync arriving mid-flight is coalesced into one trailing refresh
        // so the view can't be stale for a whole poll period.
        if (this.disposed || !this.visibility.isVisible()) return
        if (this.pendingRefresh) void this.refresh()
        else this.schedulePoll()
      })
    return this.inflight
  }

  resync(): void {
    if (this.disposed) return
    // A resync follows a config write or a reconnect: every remembered sample
    // may carry host-wide fields (font step, browser follow, checkout probing)
    // that no longer hold, so none of them may be replayed.
    this.samples.clear()
    this.requestGeneration += 1
    void this.refresh()
  }

  /** Toggle "expand all" mode and immediately re-sample. The mode sticks for
   * this controller's lifetime (per session): a one-shot expand would be
   * re-truncated by the next poll and the selection pruned away. Disposal
   * (panel release) drops it with the controller. */
  setFullChanges(full: boolean): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.fullChanges = full
    this.requestGeneration += 1
    return this.refresh()
  }

  /** The repository this controller follows ('' = the cwd's own). */
  getRepo(): string {
    return this.repo
  }

  /** The remembered sample of this checkout, if it is still worth publishing:
   * received one poll interval ago at most. Older than that and the next
   * refresh would contradict it on arrival, so a switch pays the read instead
   * of flashing a change list that is no longer true. */
  private fresh(repo: string): GitSnapshot | undefined {
    if (this.disposed) return undefined
    const cached = this.samples.get(repo)
    if (cached === undefined) return undefined
    return Date.now() - cached.receivedAt <= this.pollMs ? cached.snapshot : undefined
  }

  /** Whether the published view was read from this checkout — after setRepo(),
   * true exactly when the switch replayed a remembered sample. */
  showsRepo(repo: string): boolean {
    return this.view.state === 'ready' && this.viewRepo === repo
  }

  /** Follow another repository and re-sample. The previous snapshot now
   * describes a different work tree, but it stays published while the new
   * sample is in flight: blanking the view here collapses the panel to a
   * placeholder, so the tabs, the repository list and the branch tree all
   * disappear and come back. The panel dims its body and shows a switching
   * badge instead, and the new snapshot replaces the old one in one step.
   * A checkout read before republishes its own last sample immediately, and the
   * refresh that follows proves it still describes the work tree. The replay
   * does not advance the query tick: the sub-queries (history, branches, diff)
   * run once, on the calibrating sample. */
  setRepo(repo: string): Promise<void> {
    if (this.disposed || repo === this.repo) return Promise.resolve()
    this.repo = repo
    this.requestGeneration += 1
    // Drop the sample of the checkout being left instead of queueing behind it:
    // its answer is already unusable, and waiting for it would add a whole round
    // trip to the switch.
    this.abort?.abort()
    this.abort = undefined
    this.inflight = undefined
    this.inflightSeq += 1
    this.pendingRefresh = false
    // A checkout read before opens on its own last sample, so going back is a
    // page turn; the refresh below calibrates it with the current state.
    const cached = this.fresh(repo)
    if (cached !== undefined) {
      this.viewRepo = repo
      this.publish({ state: 'ready', snapshot: cached }, this.unreadySignal())
    }
    return this.refresh()
  }

  /** Publish a snapshot the caller already has (e.g. an action's fresh
   * snapshot), avoiding a redundant git round-trip; the poll timer restarts. */
  accept(snapshot: GitSnapshot): void {
    if (this.disposed) return
    this.requestGeneration += 1
    this.pendingRefresh = false
    this.remember(snapshot)
    this.publishSnapshot(snapshot, this.visibilityGeneration, true)
    this.schedulePoll()
  }

  /** Remember this checkout's sample for the next switch back to it. */
  private remember(snapshot: GitSnapshot): void {
    this.samples.delete(this.repo)
    this.samples.set(this.repo, { snapshot, receivedAt: Date.now() })
    while (this.samples.size > SAMPLE_CACHE_LIMIT) {
      const oldest = this.samples.keys().next()
      if (oldest.done === true) break
      this.samples.delete(oldest.value)
    }
  }

  private publishSnapshot(snapshot: GitSnapshot, generation: number, force: boolean): void {
    this.pollMs = snapshot.refreshIntervalMs || DEFAULT_POLL_MS
    this.viewRepo = this.repo
    const previous = this.view.state === 'ready' ? this.view.snapshot : null
    const same = !force && previous !== null && snapshot.root === previous.root
      && snapshot.stateFingerprint !== undefined && snapshot.stateFingerprint === previous.stateFingerprint
    const nextSignal: GitQuerySignal = {
      tick: this.querySignal.tick + 1,
      sampledAt: snapshot.checkedAt,
      ready: this.visibility.isVisible() && generation === this.visibilityGeneration,
      root: snapshot.root,
    }
    this.publish(same ? this.view : { state: 'ready', snapshot }, nextSignal)
  }

  private unreadySignal(): GitQuerySignal {
    return this.querySignal.ready ? { ...this.querySignal, ready: false } : this.querySignal
  }

  private clearPoll(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedulePoll(): void {
    this.clearPoll()
    if (this.disposed || !this.visibility.isVisible() || this.inflight !== undefined || this.pollMs <= 0) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.refresh()
    }, this.pollMs)
  }

  private setView(view: Exclude<GitView, { state: 'ready' }>): void {
    this.publish(view, this.unreadySignal())
  }

  private publish(view: GitView, signal: GitQuerySignal): void {
    const viewChanged = view !== this.view
    const signalChanged = signal !== this.querySignal
    // Both stores must be current before either class of subscriber runs.
    this.view = view
    this.querySignal = signal
    if (viewChanged) for (const listener of this.listeners) listener()
    if (signalChanged) for (const listener of this.queryListeners) listener()
  }

  dispose(): void {
    this.disposed = true
    this.clearPoll()
    this.abort?.abort()
    this.samples.clear()
    this.unsubscribeVisibility()
    this.pendingRefresh = false
    this.listeners.clear()
    this.queryListeners.clear()
  }
}
