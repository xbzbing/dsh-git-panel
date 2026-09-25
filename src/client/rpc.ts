/**
 * Thin client-side RPC wrapper over the harness generic Connection RPC.
 *
 * The host `gitPanel` @Remote methods are served by the typert Gateway on the
 * shared `/api` channel as `gitPanel/<method>`; the payload is `{ args: {
 * request } }` (args keyed by the method's parameter names). Every read is
 * guarded, so a hostile or absent connection degrades to a typed failure
 * instead of throwing.
 */
import type {
  GitActionRequest, GitActionResult, GitQueryRequest, GitQueryResponse,
  GitSnapshotRequest, GitSnapshotResult, GitVersionInfo, GitVersionRequest,
} from './types'

const API_CHANNEL = '/api'
const NS = 'gitPanel'

interface ConnectionFace {
  rpc?: {
    call?(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown>
  }
}

/** Minimal Cordis context face the client half consumes. */
export interface ClientCtx {
  get(key: string): unknown
  effect(cb: () => void | (() => void), label?: string): void
  on(event: string, listener: (...args: never[]) => void): (() => void) | void
  inject(deps: readonly string[], cb: (c: ClientCtx) => void): void
  slots: {
    inject(name: string, provider: () => unknown): unknown
    register(registration: Record<string, unknown>, component: unknown): unknown
  }
  locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): (() => void) | void
    bind(ns: string): (key: string, params?: Record<string, string | number>) => string
  }
}

/** Structural faces of the settings `configForms` service (detail-page config form). */
export interface ConfigFormSnapshot {
  readonly status: string
  readonly value?: Record<string, unknown>
  readonly revision: number
  readonly writable: boolean
}

export interface ConfigFormFace {
  getSnapshot(): ConfigFormSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}

export interface SettingsNamespaceView {
  readonly ns: string
  readonly schema: unknown
}

export interface ConfigDescribeFace {
  getSnapshot(): { readonly status?: string; readonly view?: { readonly namespaces: readonly SettingsNamespaceView[] } }
  subscribe(listener: () => void): () => void
  ensure(): Promise<void>
}

export interface ConfigFormsFace {
  describe(): ConfigDescribeFace
  get(entryId: string): ConfigFormFace
}

function callerOf(ctx: ClientCtx): ((endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown>) | undefined {
  try {
    const rpc = (ctx.get('connection') as ConnectionFace | undefined)?.rpc
    const fn = rpc?.call
    if (rpc !== undefined && typeof fn === 'function') {
      return (endpoint, payload, signal) => (fn as (c: string, e: string, p: unknown, s?: AbortSignal) => Promise<unknown>).call(rpc, API_CHANNEL, endpoint, payload, signal)
    }
  } catch { /* absent or hostile */ }
  return undefined
}

/** Unwrap the RPC transport envelope { ok, value } → the inner business value. */
function unwrap<T>(result: unknown): T | { ok: false; error: { code: string; message?: string } } {
  const r = result as { ok?: unknown; value?: unknown; error?: unknown } | null
  if (r === null || typeof r !== 'object') return { ok: false, error: { code: 'git-unavailable', message: 'malformed rpc result' } }
  if (r.ok !== true) {
    const err = r.error as { code?: unknown; message?: unknown } | undefined
    return { ok: false, error: { code: typeof err?.code === 'string' ? err.code : 'git-unavailable', message: typeof err?.message === 'string' ? err.message : undefined } }
  }
  // A transport-ok envelope with no inner value is malformed: return a typed
  // failure rather than `undefined`, which would trip `result.ok` downstream.
  if (r.value === undefined) return { ok: false, error: { code: 'git-unavailable', message: 'missing value' } }
  return r.value as T
}

/** The bound gitPanel remote face used by the client controller and views. */
export interface GitPanelRemote {
  snapshot(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult>
  run(request: GitActionRequest, signal?: AbortSignal): Promise<GitActionResult>
  query(request: GitQueryRequest, signal?: AbortSignal): Promise<GitQueryResponse>
  version(request: GitVersionRequest, signal?: AbortSignal): Promise<GitVersionInfo | { ok: false; error: { code: string; message?: string } }>
}

/**
 * One remote facade per context: a stable identity so React effect deps don't
 * refire every render, while each call re-resolves the connection (it may
 * appear after first use).
 */
const remoteCache = new WeakMap<ClientCtx, GitPanelRemote>()

/** Build (or reuse) the remote face; a missing connection yields typed failures. */
export function gitPanelRemoteOf(ctx: ClientCtx): GitPanelRemote {
  const cached = remoteCache.get(ctx)
  if (cached !== undefined) return cached
  const invoke = async <T>(method: string, request: unknown, signal?: AbortSignal): Promise<T | { ok: false; error: { code: string; message?: string } }> => {
    const caller = callerOf(ctx)
    if (caller === undefined) return { ok: false, error: { code: 'git-unavailable', message: 'no connection' } }
    try {
      const result = await caller(`${NS}/${method}`, { args: { request } }, signal)
      return unwrap<T>(result)
    } catch (error) {
      return { ok: false, error: { code: 'git-unavailable', message: error instanceof Error ? error.message : String(error) } }
    }
  }
  const remote: GitPanelRemote = {
    snapshot: (request, signal) => invoke<GitSnapshotResult>('snapshot', request, signal) as Promise<GitSnapshotResult>,
    run: (request, signal) => invoke<GitActionResult>('run', request, signal) as Promise<GitActionResult>,
    query: (request, signal) => invoke<GitQueryResponse>('query', request, signal) as Promise<GitQueryResponse>,
    version: (request, signal) => invoke<GitVersionInfo>('version', request, signal),
  }
  remoteCache.set(ctx, remote)
  return remote
}
