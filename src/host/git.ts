/**
 * Git command execution over the host subprocess service.
 *
 * Only a tiny slice of the subprocess contract is needed; it is declared
 * structurally here so the plugin builds standalone while staying wire
 * compatible with the host `subprocess` service.
 */
import { readFile } from 'node:fs/promises'

interface CollectDisposition {
  readonly collect: {
    readonly maxBytes: number
    readonly spill?: { readonly maxBytes: number }
  }
}

interface SpawnSpec {
  readonly argv: readonly string[]
  readonly cwd: string
  readonly stdio: {
    readonly stdin: 'ignore'
    readonly stdout: CollectDisposition
    readonly stderr: CollectDisposition
  }
  readonly graceMs: number
  readonly signal?: AbortSignal
}

interface OutputRead {
  readonly text: string
  readonly lossy: boolean
  readonly spillPath?: string
}

interface SpawnHandle {
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>
  readonly collected: {
    readonly stdout?: { readFrom(fromByte: number): OutputRead }
    readonly stderr?: { readFrom(fromByte: number): OutputRead }
  }
}

/** Minimal subprocess service face the adapter consumes. */
export interface SubprocessLike {
  spawn(spec: SpawnSpec): SpawnHandle
}

export interface GitRunResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly stdoutLossy: boolean
}

export interface GitRunner {
  run(argv: readonly string[], opts: { readonly cwd: string; readonly signal?: AbortSignal }): Promise<GitRunResult>
}

/**
 * Adapt the subprocess service into a `GitRunner` with a per-command timeout.
 * A timed-out run resolves (never rejects) with `timedOut: true`; only
 * spawn-level failures (e.g. git not installed) reject.
 */
export function createGitRunner(subprocess: SubprocessLike, timeoutMs: number, maxBytes: number): GitRunner {
  const spillMaxBytes = maxBytes * 16
  return {
    async run(argv, opts) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const signal = opts.signal === undefined
          ? controller.signal
          : AbortSignal.any([controller.signal, opts.signal])
        const handle = subprocess.spawn({
          argv,
          cwd: opts.cwd,
          stdio: {
            stdin: 'ignore',
            stdout: { collect: { maxBytes, spill: { maxBytes: spillMaxBytes } } },
            stderr: { collect: { maxBytes, spill: { maxBytes: spillMaxBytes } } },
          },
          graceMs: 200,
          signal,
        })
        let outcome: Awaited<SpawnHandle['done']>
        try {
          outcome = await handle.done
        } catch (error) {
          if (controller.signal.aborted || opts.signal?.aborted === true) {
            return { exitCode: null, stdout: '', stderr: '', timedOut: true, stdoutLossy: false }
          }
          throw error
        }
        const stdout = handle.collected.stdout?.readFrom(0)
        const stderr = handle.collected.stderr?.readFrom(0)
        const resolved = await resolveStdout(stdout)
        return {
          exitCode: outcome.exitCode,
          stdout: resolved.text,
          stderr: stderr?.text ?? '',
          timedOut: controller.signal.aborted || opts.signal?.aborted === true,
          stdoutLossy: resolved.lossy,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** Resolve stdout: the in-memory tail, or the spill file when the read was lossy. */
async function resolveStdout(read: OutputRead | undefined): Promise<{ text: string; lossy: boolean }> {
  if (read === undefined) return { text: '', lossy: false }
  if (!read.lossy || read.spillPath === undefined) return { text: read.text, lossy: read.lossy }
  try {
    return { text: await readFile(read.spillPath, 'utf8'), lossy: false }
  } catch {
    return { text: read.text, lossy: true }
  }
}
