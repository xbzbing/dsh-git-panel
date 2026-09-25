/**
 * Plugin version + update-check support for the `gitPanel/version` endpoint.
 *
 * The local view reads this package's own package.json; the remote check
 * queries the GitHub releases API and compares tags. Network or parse
 * failures degrade to `error` so the current version still renders.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type VersionFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

export interface VersionInfo {
  /** Version declared in this plugin's package.json. */
  readonly current: string
  /** Browsable GitHub repository URL, or undefined when it cannot be derived. */
  readonly repositoryUrl?: string
  /** Latest release tag reported by GitHub, without the leading "v". */
  readonly latest?: string
  /** True only when a strictly newer release than {@link current} exists. */
  readonly updateAvailable: boolean
  /** Browsable URL of the latest release, or undefined when unknown. */
  readonly releaseUrl?: string
  /** True when the remote registry was queried (false for the local-only view). */
  readonly checkedRemote: boolean
  /** Present when the remote check could not complete. */
  readonly error?: string
}

interface PackageManifest {
  version?: unknown
  repository?: unknown
}

/** Resolve package.json relative to the compiled module (lib/host/version.js → ../../package.json). */
function manifestPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Extract "git+https://…/owner/repo.git", "github:owner/repo", or "owner/repo" into { owner, repo }. */
export function parseRepository(repository: unknown): { owner: string; repo: string } | undefined {
  const raw =
    typeof repository === 'string'
      ? repository
      : typeof repository === 'object' && repository !== null
        ? stringField((repository as { url?: unknown }).url)
        : undefined
  if (raw === undefined) return undefined
  const fromHost = raw.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:$|[/#?])/i)
  if (fromHost !== null) return { owner: fromHost[1]!, repo: fromHost[2]! }
  const shorthand = raw.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i)
  if (shorthand !== null) return { owner: shorthand[1]!, repo: shorthand[2]! }
  return undefined
}

/**
 * Compare dotted versions with prerelease handling; returns 1 when a > b, -1
 * when a < b, 0 when equal. A release outranks a prerelease sharing the same
 * core (0.2.0 > 0.2.0-beta.1); prerelease identifiers compare dot-segment by
 * segment, numeric parts numerically (beta.2 > beta.1, 0.2.0-rc.10 > rc.2).
 */
export function compareVersions(a: string, b: string): number {
  const split = (value: string): { core: number[]; pre: string[] } => {
    const trimmed = value.trim().replace(/^v/i, '')
    const [core, ...rest] = trimmed.split('-')
    const preRaw = rest.join('-')
    return {
      core: core!
        .split('.')
        .map((part) => Number.parseInt(part, 10))
        .filter((part) => Number.isFinite(part)),
      pre: preRaw === '' ? [] : preRaw.split('.'),
    }
  }
  const left = split(a)
  const right = split(b)
  const length = Math.max(left.core.length, right.core.length)
  for (let index = 0; index < length; index += 1) {
    const l = left.core[index] ?? 0
    const r = right.core[index] ?? 0
    if (l > r) return 1
    if (l < r) return -1
  }
  // Equal core: a version with no prerelease outranks one that has it.
  if (left.pre.length === 0 && right.pre.length === 0) return 0
  if (left.pre.length === 0) return 1
  if (right.pre.length === 0) return -1
  const preLen = Math.max(left.pre.length, right.pre.length)
  for (let i = 0; i < preLen; i += 1) {
    const lp = left.pre[i]
    const rp = right.pre[i]
    if (lp === undefined) return -1
    if (rp === undefined) return 1
    const ln = Number.parseInt(lp, 10)
    const rn = Number.parseInt(rp, 10)
    const lNum = Number.isFinite(ln) && String(ln) === lp
    const rNum = Number.isFinite(rn) && String(rn) === rp
    if (lNum && rNum) { if (ln !== rn) return ln > rn ? 1 : -1 }
    else if (lp !== rp) return lp > rp ? 1 : -1
  }
  return 0
}

let manifestCache: PackageManifest | undefined
async function readManifest(path: string): Promise<PackageManifest> {
  const raw = await readFile(path, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('package.json is not an object')
  return parsed as PackageManifest
}

/** Read (and memoize) the default manifest once; a custom path skips the cache. */
async function loadManifest(path: string | undefined): Promise<PackageManifest> {
  if (path !== undefined) return readManifest(path)
  if (manifestCache === undefined) manifestCache = await readManifest(manifestPath())
  return manifestCache
}

/** Local-only view: current version + repository URL, no network access. */
export async function readVersionInfo(options: { manifestPath?: string } = {}): Promise<VersionInfo> {
  const manifest = await loadManifest(options.manifestPath)
  const current = stringField(manifest.version) ?? '0.0.0'
  const repo = parseRepository(manifest.repository)
  const repositoryUrl = repo === undefined ? undefined : `https://github.com/${repo.owner}/${repo.repo}`
  return {
    current,
    ...(repositoryUrl ? { repositoryUrl } : {}),
    updateAvailable: false,
    checkedRemote: false,
  }
}

/** GitHub release URLs only — the remote html_url goes straight into an href. */
function safeReleaseUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  return /^https:\/\/github\.com\//i.test(url) ? url : undefined
}

/** Remote-check freshness: avoid hammering the anonymous 60/h GitHub limit. */
const REMOTE_CACHE_MS = 10 * 60 * 1000
let remoteCache: { at: number; info: VersionInfo } | undefined

/**
 * Query the GitHub releases API for the latest tag and compare it to the
 * bundled version. Failures are reported through `error` instead of throwing;
 * a 5s timeout bounds the call and a 10-minute memo bounds the request rate.
 */
export async function checkLatestVersion(
  options: { manifestPath?: string; fetchFn?: VersionFetch } = {},
): Promise<VersionInfo> {
  if (options.manifestPath === undefined && options.fetchFn === undefined && remoteCache !== undefined && Date.now() - remoteCache.at < REMOTE_CACHE_MS) {
    return remoteCache.info
  }
  const base = await readVersionInfo({ manifestPath: options.manifestPath })
  const repo = parseRepository((await loadManifest(options.manifestPath)).repository)
  if (repo === undefined) {
    return { ...base, checkedRemote: false, error: 'repository is not configured' }
  }
  const fetchFn = options.fetchFn ?? fetch
  try {
    const response = await fetchFn(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-git-panel' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      return { ...base, checkedRemote: true, error: `GitHub responded with ${response.status}` }
    }
    const body: unknown = await response.json()
    const tag = typeof body === 'object' && body !== null ? stringField((body as { tag_name?: unknown }).tag_name) : undefined
    const htmlUrl = typeof body === 'object' && body !== null ? stringField((body as { html_url?: unknown }).html_url) : undefined
    if (tag === undefined) {
      return { ...base, checkedRemote: true, error: 'GitHub response did not include a release tag' }
    }
    const latest = tag.replace(/^v/i, '')
    const info: VersionInfo = {
      ...base,
      checkedRemote: true,
      latest,
      updateAvailable: compareVersions(latest, base.current) > 0,
      releaseUrl: safeReleaseUrl(htmlUrl) ?? (base.repositoryUrl !== undefined ? `${base.repositoryUrl}/releases/latest` : undefined),
    }
    if (options.manifestPath === undefined && options.fetchFn === undefined) remoteCache = { at: Date.now(), info }
    return info
  } catch (error) {
    return { ...base, checkedRemote: true, error: error instanceof Error ? error.message : 'Unable to reach GitHub' }
  }
}
