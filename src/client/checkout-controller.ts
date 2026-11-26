/**
 * Per-session checkout discovery and follow coordinator, shared by every pill
 * and panel. It owns no snapshot: the existing GitController supplies the view
 * and samples the selection. Reads need a visible surface, not an open panel.
 */
import type { GitController } from './controller.js'
import { planFollow, type FollowPlanState } from './follow-checkout.js'
import { listVerdict, sampleVerdict } from './repo-list.js'
import { clearRepoPick, followRepo, hasRepoPick, selectedRepo, subscribeRepoSelection } from './repo-select.js'
import { queryAs, type GitPanelRemote } from './rpc.js'
import { REPO_LIMITS, type GitRepoList } from './types.js'

interface Observer {
  readonly active: boolean
  readonly directory: string | null
  readonly discover: boolean
}

export interface CheckoutState {
  readonly list: GitRepoList | null
  /** Only the current successful read is evidence; cached rows stay visible. */
  readonly ready: boolean
}

interface CheckoutConfig {
  readonly at: number
  readonly detect: boolean
  readonly limit: number
  readonly follow: boolean
}

// Configuration is host-wide. A hidden session or checkout replay must not
// restore an older value after another session confirmed a newer setting.
let latestConfig: CheckoutConfig | undefined
const liveCheckouts = new Set<CheckoutController>()

export class CheckoutController {
  private snapshot: CheckoutState = { list: null, ready: false }
  private readonly listeners = new Set<() => void>()
  private readonly observers = new Map<symbol, Observer>()
  private active = false
  private directory: string | null = null
  private detect = true
  private limit: number = REPO_LIMITS.default
  private follow = false
  private known = false
  private configAt = -Infinity
  private configTick: number | null = null
  private state: FollowPlanState = { enabled: false, known: false, cwd: null, pending: null, refetched: null, force: false, manual: null, released: null }
  private abort: AbortController | undefined
  private generation = 0
  private reading = false
  private readQueued = false
  private disposed = false
  private reconciling = false
  private readonly stopView: () => void
  private readonly stopQueries: () => void
  private readonly stopSelection: () => void

  constructor(
    private readonly remote: GitPanelRemote,
    private readonly sessionId: string,
    private readonly git: GitController,
  ) {
    liveCheckouts.add(this)
    if (latestConfig !== undefined) this.applyConfig(latestConfig)
    this.stopView = git.subscribe(() => this.updateObservers(this.readConfig()))
    // A same-fingerprint sample advances query ticks without publishing a new
    // business view; resync must still release the configuration fence.
    this.stopQueries = git.subscribeQueries(() => this.updateObservers(this.readConfig()))
    this.stopSelection = subscribeRepoSelection(() => this.reconcile())
  }

  getSnapshot = (): CheckoutState => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(list: GitRepoList | null, ready: boolean): void {
    this.snapshot = { list, ready }
    for (const listener of [...this.listeners]) listener()
  }

  /** Inactive keepMounted copies cannot overwrite a visible surface's directory. */
  observe(owner: symbol, active: boolean, directory: string | null, discover = true): void {
    if (this.disposed) return
    const old = this.observers.get(owner)
    this.observers.set(owner, { active, directory, discover })
    if (active && directory !== null && (old === undefined || !old.active || old.directory !== directory)) this.directory = directory
    const reopened = old !== undefined && discover && active && !old.active
    this.updateObservers(this.readConfig() || reopened)
  }

  release(owner: symbol): void {
    this.observers.delete(owner)
    this.updateObservers()
  }

  private updateObservers(configChanged = false): void {
    if (this.disposed) return
    const visible = [...this.observers.values()].filter((item) => item.active)
    const wasActive = this.active
    // A pill with no projection, an old host, or follow disabled needs no scan.
    // A visible panel still needs discovery for its repository selector.
    this.active = visible.some((item) => item.discover || (this.configTick === null && this.follow && this.known && item.directory !== null))
    if (!this.active) {
      this.cancelRead()
      this.reconcile()
      return
    }
    if (!wasActive || configChanged) this.refetch()
    this.reconcile()
  }

  private readConfig(): boolean {
    const signal = this.git.getQuerySignal()
    if (!signal.ready || (this.configTick !== null && signal.tick <= this.configTick)) return false
    this.configTick = null
    const view = this.git.getSnapshot()
    if (view.state !== 'ready' || view.stale === true) return false
    if (latestConfig === undefined || view.snapshot.checkedAt >= latestConfig.at) {
      latestConfig = { at: view.snapshot.checkedAt, detect: view.snapshot.detectCheckouts ?? true,
        limit: view.snapshot.repoLimit ?? REPO_LIMITS.default, follow: view.snapshot.followSessionCheckout === true }
      for (const other of liveCheckouts) {
        if (other !== this) other.updateObservers(other.applyConfig(latestConfig))
      }
    }
    return this.applyConfig(latestConfig)
  }

  private applyConfig(config: CheckoutConfig): boolean {
    const changed = this.detect !== config.detect || this.limit !== config.limit
    if (config.at > this.configAt) this.configTick = null
    this.configAt = config.at
    this.detect = config.detect
    this.limit = config.limit
    this.follow = config.follow
    this.known = this.configTick === null
    return changed
  }

  /** Connection/config resync fences the published cached sample until a new
   * query tick proves a calibrating snapshot arrived. */
  invalidate(): void {
    this.configTick = this.git.getQuerySignal().tick
    this.known = false
    // Non-git sessions may never produce a ready Git sample. A visible panel
    // can still discover roots from current host config; only follow is fenced.
    this.updateObservers(true)
  }

  /** Explicit invalidation also serves the workspace-file enable action. */
  refetch = (): void => {
    if (this.disposed || !this.active) return
    this.cancelRead()
    this.reading = true
    if (this.readQueued) return
    this.readQueued = true
    // Multiple surfaces invalidating in one commit share one request.
    void Promise.resolve().then(() => {
      this.readQueued = false
      if (this.disposed || !this.active) return
      const generation = this.generation
      const abort = new AbortController()
      this.abort = abort
      this.reading = true
      void this.remote.query({ sessionId: this.sessionId, query: { kind: 'repo-list' } }, abort.signal)
        .then((result) => {
          if (this.disposed || generation !== this.generation || !this.active) return
          const listed = queryAs(result, 'repo-list')
          if (listed === null) return
          this.publish({
            repos: Array.isArray(listed.repos) ? listed.repos : [],
            cwd: typeof listed.cwd === 'string' ? listed.cwd : '',
            codeWorkspace: listed.codeWorkspace,
            worktrees: listed.worktrees,
          }, true)
        })
        .catch(() => { /* A failed read is not evidence against a remembered pick. */ })
        .finally(() => {
          if (this.disposed || generation !== this.generation) return
          this.abort = undefined
          this.reading = false
          this.reconcile()
        })
    })
  }

  private cancelRead(): void {
    this.generation += 1
    this.abort?.abort()
    this.abort = undefined
    this.reading = false
    if (this.snapshot.ready) this.publish(this.snapshot.list, false)
  }

  private reconcile(): void {
    if (this.disposed || this.reconciling || ![...this.observers.values()].some((item) => item.active)) return
    this.reconciling = true
    try {
      let repo = selectedRepo(this.sessionId)
      const view = this.git.getSnapshot()
      const rejected = view.state === 'error' ? sampleVerdict(view.error) : 'keep'
      // A stale error belongs to the previous selection while the next sample
      // is in flight. Only the sample's own selector can be repaired by it.
      const verdict = repo !== '' && rejected !== 'keep' && this.git.sampledRepo() === repo
        ? rejected
        : repo !== '' && this.active && this.snapshot.ready && !this.reading && this.snapshot.list !== null && this.snapshot.list.worktrees !== 'failed'
          ? listVerdict(this.snapshot.list.repos, repo) : 'keep'
      if (verdict !== 'keep') {
        clearRepoPick(this.sessionId, { forget: verdict === 'forget' })
        repo = selectedRepo(this.sessionId)
      }
      // Never decide from the old rows while the one extra scan is in flight.
      {
        const plan = planFollow({
          sessionDirectory: this.directory, repos: this.snapshot.list?.repos ?? [], repo,
          followSession: this.follow, followSessionKnown: this.known,
          hasRepoPick: hasRepoPick(this.sessionId), repoListReady: this.active && this.snapshot.ready && !this.reading,
          repoProbeFailed: this.snapshot.list?.worktrees === 'failed', state: this.state,
        })
        this.state = plan.state
        if (plan.action.kind === 'refetch') this.refetch()
        else if (plan.action.kind === 'follow') {
          followRepo(this.sessionId, plan.action.path)
          repo = plan.action.path
        }
      }
      if (this.git.getRepo() !== repo) void this.git.setRepo(repo)
    } finally {
      this.reconciling = false
    }
  }

  dispose(): void {
    this.disposed = true
    this.cancelRead()
    this.stopView()
    this.stopQueries()
    this.stopSelection()
    this.observers.clear()
    this.listeners.clear()
    liveCheckouts.delete(this)
    if (liveCheckouts.size === 0) latestConfig = undefined
  }
}
