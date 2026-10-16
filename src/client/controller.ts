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

export class GitController {
  private view: GitView = { state: 'cold' }
  private readonly listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private inflight: Promise<void> | undefined
  private pendingRefresh = false
  private disposed = false
  private pollMs = DEFAULT_POLL_MS
  private readonly unsubscribeVisibility: () => void
  private visibilityGeneration = 0
  private requestGeneration = 0
  private querySignal: GitQuerySignal = { tick: 0, sampledAt: 0, ready: false, root: null }
  private readonly queryListeners = new Set<() => void>()

  constructor(
    private readonly remote: GitPanelRemote,
    private readonly sessionId: string,
    private readonly visibility: VisibilitySource = pageVisibility,
  ) {
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
    if (this.inflight !== undefined) { this.pendingRefresh = true; return this.inflight }
    this.pendingRefresh = false
    this.clearPoll()
    const generation = this.visibilityGeneration
    const requestGeneration = this.requestGeneration
    if (this.view.state === 'cold') this.setView({ state: 'loading' })
    this.inflight = this.remote.snapshot({ sessionId: this.sessionId })
      .then((result) => {
        if (this.disposed || requestGeneration !== this.requestGeneration) return
        if (result.ok) {
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
        this.inflight = undefined
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
    this.requestGeneration += 1
    void this.refresh()
  }

  /** Publish a snapshot the caller already has (e.g. an action's fresh
   * snapshot), avoiding a redundant git round-trip; the poll timer restarts. */
  accept(snapshot: GitSnapshot): void {
    if (this.disposed) return
    this.requestGeneration += 1
    this.pendingRefresh = false
    this.publishSnapshot(snapshot, this.visibilityGeneration, true)
    this.schedulePoll()
  }

  private publishSnapshot(snapshot: GitSnapshot, generation: number, force: boolean): void {
    this.pollMs = snapshot.refreshIntervalMs || DEFAULT_POLL_MS
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
    this.unsubscribeVisibility()
    this.pendingRefresh = false
    this.listeners.clear()
    this.queryListeners.clear()
  }
}
