export type VersionFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export interface VersionInfo {
    /** Version declared in this plugin's package.json. */
    readonly current: string;
    /** Browsable GitHub repository URL, or undefined when it cannot be derived. */
    readonly repositoryUrl?: string;
    /** Latest release tag reported by GitHub, without the leading "v". */
    readonly latest?: string;
    /** True only when a strictly newer release than {@link current} exists. */
    readonly updateAvailable: boolean;
    /** Browsable URL of the latest release, or undefined when unknown. */
    readonly releaseUrl?: string;
    /** True when the remote registry was queried (false for the local-only view). */
    readonly checkedRemote: boolean;
    /** Present when the remote check could not complete. */
    readonly error?: string;
}
/** Extract "git+https://…/owner/repo.git", "github:owner/repo", or "owner/repo" into { owner, repo }. */
export declare function parseRepository(repository: unknown): {
    owner: string;
    repo: string;
} | undefined;
/**
 * Compare dotted numeric versions with basic prerelease handling; returns 1
 * when a > b, -1 when a < b, 0 when equal. A release outranks a prerelease
 * sharing the same core (e.g. 0.2.0 > 0.2.0-beta.1).
 */
export declare function compareVersions(a: string, b: string): number;
/** Local-only view: current version + repository URL, no network access. */
export declare function readVersionInfo(options?: {
    manifestPath?: string;
}): Promise<VersionInfo>;
/**
 * Query the GitHub releases API for the latest tag and compare it to the
 * bundled version. Failures are reported through `error` instead of throwing.
 */
export declare function checkLatestVersion(options?: {
    manifestPath?: string;
    fetchFn?: VersionFetch;
}): Promise<VersionInfo>;
