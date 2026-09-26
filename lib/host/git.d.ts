interface CollectDisposition {
    readonly collect: {
        readonly maxBytes: number;
        readonly spill?: {
            readonly maxBytes: number;
        };
    };
}
interface SpawnSpec {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly stdio: {
        readonly stdin: 'ignore' | {
            readonly data: string;
        };
        readonly stdout: CollectDisposition;
        readonly stderr: CollectDisposition;
    };
    readonly graceMs: number;
    readonly signal?: AbortSignal;
}
interface OutputRead {
    readonly text: string;
    readonly lossy: boolean;
    readonly spillPath?: string;
}
interface SpawnHandle {
    readonly done: Promise<{
        readonly exitCode: number | null;
        readonly signal: NodeJS.Signals | null;
    }>;
    readonly collected: {
        readonly stdout?: {
            readFrom(fromByte: number): OutputRead;
        };
        readonly stderr?: {
            readFrom(fromByte: number): OutputRead;
        };
    };
}
/** Minimal subprocess service face the adapter consumes. */
export interface SubprocessLike {
    spawn(spec: SpawnSpec): SpawnHandle;
}
export interface GitRunResult {
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
    /** The caller's own signal aborted the run (navigation/reset), not our timeout. */
    readonly cancelled: boolean;
    readonly stdoutLossy: boolean;
}
export interface GitRunner {
    run(argv: readonly string[], opts: {
        readonly cwd: string;
        readonly signal?: AbortSignal;
        readonly stdinData?: string;
    }): Promise<GitRunResult>;
}
/**
 * Adapt the subprocess service into a `GitRunner` with a per-command timeout.
 * A timed-out run resolves (never rejects) with `timedOut: true`; only
 * spawn-level failures (e.g. git not installed) reject.
 */
export declare function createGitRunner(subprocess: SubprocessLike, timeoutMs: number, maxBytes: number): GitRunner;
export {};
