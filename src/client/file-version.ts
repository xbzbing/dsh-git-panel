/**
 * The commit dialog's version read: the complete post-change body at the
 * diff's base, shared by the read-only file view and the "copy post-change
 * content" action.
 *
 * This half is pure state: the target key, the wire→view mapping, and the
 * one-target read pipeline (in-flight join, last-answer cache, and a generation
 * that drops replies the view has moved past). The React hook lives in
 * `use-file-version.ts`, so the pipeline can be tested without a renderer or
 * the host's clipboard primitives.
 */
import type { GitQuery, GitQueryResult } from './types.js'
import type { CopyFeedback } from './copy-feedback.js'
import type { GitKey } from './locales.js'

/** The version a diff's new side compares against. `rev` is the caller's
 * problem: a revision comparison's new side is the work tree. */
export interface FileVersionTarget {
  readonly path: string
  readonly base: 'worktree' | 'staged' | 'commit'
  readonly commit?: string
}

export type FileVersionState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly content: string; readonly size: number }
  | { readonly kind: 'tooLarge'; readonly size?: number }
  | { readonly kind: 'binary'; readonly size?: number }
  | { readonly kind: 'absent' }
  | { readonly kind: 'error' }

export interface FileVersionControl {
  readonly state: FileVersionState
  /** Start (or retry) the read; the file view calls this when it opens. */
  readonly load: () => void
  /** Read if needed, then write the complete body to the clipboard. */
  readonly copy: () => void
  /** Copy request in flight (the view's own loading state is separate). */
  readonly busy: boolean
  readonly feedback: CopyFeedback
  /** Why the copy could not happen (a version state, not a clipboard error). */
  readonly failure: GitKey | null
}

/** Every input of one read, as the cache/derivation key. */
export function fileVersionKey(target: FileVersionTarget | null): string | null {
  if (target === null) return null
  return `${target.base}\u0000${target.commit ?? ''}\u0000${target.path}`
}

/** The wire request for one target. */
export function fileVersionQuery(target: FileVersionTarget): GitQuery {
  return target.base === 'commit'
    ? { kind: 'file-version', path: target.path, base: 'commit', commit: target.commit ?? '' }
    : { kind: 'file-version', path: target.path, base: target.base }
}

/** Map a reply onto the view state. A text reply with no body is not an empty
 * file: keep it an error so the view can neither render nor copy a silently
 * truncated answer. */
export function fileVersionStateOf(value: Extract<GitQueryResult, { kind: 'file-version' }>): FileVersionState {
  switch (value.variant) {
    case 'text':
      return value.content === undefined
        ? { kind: 'error' }
        : { kind: 'ready', content: value.content, size: value.size ?? 0 }
    case 'tooLarge':
      return { kind: 'tooLarge', ...(value.size !== undefined ? { size: value.size } : {}) }
    case 'binary':
      return { kind: 'binary', ...(value.size !== undefined ? { size: value.size } : {}) }
    case 'absent':
      return { kind: 'absent' }
  }
}

export const FILE_VERSION_IDLE: FileVersionState = { kind: 'idle' }

export interface VersionReads {
  /** The cached answer for this key, if the pipeline still holds one. */
  peek(key: string): FileVersionState | null
  /**
   * Answer for `key`: the cached state, the in-flight request for the same key,
   * or a fresh `load()`. `publish` runs only for answers that are still current
   * — a target the caller moved past neither paints nor enters the cache, and
   * an error is never cached so the next press retries the read.
   */
  read(key: string, load: () => Promise<FileVersionState>, publish: (state: FileVersionState) => void): Promise<FileVersionState>
  /** Drop the cached body and the in-flight entry, and invalidate open replies. */
  invalidate(): void
}

/** One-target read pipeline; see `VersionReads`. */
export function createVersionReads(): VersionReads {
  let generation = 0
  let cached: { readonly key: string; readonly state: FileVersionState } | null = null
  let inflight: { readonly key: string; readonly promise: Promise<FileVersionState> } | null = null
  return {
    peek(key) {
      return cached !== null && cached.key === key ? cached.state : null
    },
    read(key, load, publish) {
      const hit = cached
      if (hit !== null && hit.key === key) return Promise.resolve(hit.state)
      const running = inflight
      if (running !== null && running.key === key) return running.promise
      const my = generation
      const promise = load().then((state) => {
        if (my === generation) {
          if (state.kind !== 'error') cached = { key, state }
          publish(state)
        }
        return state
      }).finally(() => {
        // Identity, not just the key: a close/reopen of the same target can have
        // installed a newer in-flight entry by the time this one settles.
        if (inflight !== null && inflight.promise === promise) inflight = null
      })
      inflight = { key, promise }
      return promise
    },
    invalidate() {
      generation += 1
      cached = null
      inflight = null
    },
  }
}
