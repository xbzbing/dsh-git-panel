/**
 * Per-session snapshot controller (React-free observable).
 *
 * Single-flight refresh, polling at the interval the host snapshot carries
 * (0 disables), resync on connection reset, dispose on teardown. The pill,
 * changes page, and stats bar all subscribe to one controller per session so
 * a single git snapshot serves everyone.
 */
import type { GitPanelRemote } from './rpc'
import type { GitSnapshot } from './types'

export type GitView =
  | { readonly state: 'cold' }
  | { readonly state: 'loading' }
  | { readonly state: 'no-cwd' }
  | { readonly state: 'ready'; readonly snapshot: GitSnapshot }
  | { readonly state: 'error'; readonly error: { readonly code: string; readonly detail?: string; readonly cwd?: string; readonly showInputPill?: boolean } }

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

  constructor(
    private readonly remote: GitPanelRemote,
    private readonly sessionId: string,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot(): GitView {
    return this.view
  }

  ensure(): void {
    if (this.view.state !== 'cold' && this.view.state !== 'no-cwd') return
    void this.refresh()
  }

  refresh(): Promise<void> {
    if (this.inflight !== undefined) { this.pendingRefresh = true; return this.inflight }
    if (this.disposed) return Promise.resolve()
    if (this.view.state === 'cold') this.setView({ state: 'loading' })
    this.inflight = this.remote.snapshot({ sessionId: this.sessionId })
      .then((result) => {
        if (this.disposed) return
        if (result.ok) {
          this.pollMs = result.value.refreshIntervalMs || DEFAULT_POLL_MS
          this.setView({ state: 'ready', snapshot: result.value })
        } else if (result.error.code === 'cancelled') {
          // A caller-driven abort (navigation/reset) is not an error state:
          // keep the current view; the next refresh replaces it.
        } else if (TERMINAL_CODES.has(result.error.code)) {
          this.pollMs = NO_CWD_POLL_MS
          this.setView({ state: 'no-cwd' })
        } else if (result.error.code === 'not-a-git-repo') {
          const e = result.error as { cwd?: string; showInputPill?: boolean }
          this.setView({ state: 'error', error: { code: 'not-a-git-repo', ...(e.cwd ? { cwd: e.cwd } : {}), ...(e.showInputPill !== undefined ? { showInputPill: e.showInputPill } : {}) } })
        } else {
          this.setView({ state: 'error', error: { code: result.error.code, ...('detail' in result.error ? { detail: (result.error as { detail?: string }).detail } : {}) } })
        }
      })
      .catch((error: unknown) => {
        if (this.disposed) return
        this.setView({ state: 'error', error: { code: 'git-unavailable', detail: error instanceof Error ? error.message : String(error) } })
      })
      .finally(() => {
        this.inflight = undefined
        // A resync arriving mid-flight is coalesced into one trailing refresh
        // so the view can't be stale for a whole poll period.
        if (this.pendingRefresh && !this.disposed) {
          this.pendingRefresh = false
          void this.refresh()
        } else {
          this.schedulePoll()
        }
      })
    return this.inflight
  }

  resync(): void {
    if (this.disposed) return
    void this.refresh()
  }

  /** Publish a snapshot the caller already has (e.g. an action's fresh
   * snapshot), avoiding a redundant git round-trip; the poll timer restarts. */
  accept(snapshot: GitSnapshot): void {
    if (this.disposed) return
    this.pollMs = snapshot.refreshIntervalMs || DEFAULT_POLL_MS
    this.setView({ state: 'ready', snapshot })
    this.schedulePoll()
  }

  private schedulePoll(): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.pollMs <= 0) return
    this.timer = setTimeout(() => { void this.refresh() }, this.pollMs)
  }

  private setView(view: GitView): void {
    this.view = view
    for (const listener of this.listeners) listener()
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.listeners.clear()
  }
}
