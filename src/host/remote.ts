/**
 * Parse a git remote URL into a browsable https page URL + host classification.
 *
 * Git remotes come in several shapes — scp-like ssh (`git@host:owner/repo.git`),
 * ssh:// , https:// , git:// — all of which must collapse to a single
 * `https://<host>/<path>` page link and a known-host kind for the status-bar
 * icon. Credentials in the URL (`https://user:token@host/…`) are stripped so a
 * token can never leak into an href the browser renders.
 */
import type { GitRemote, RemoteHostKind } from './types.ts'

/** Map a hostname to a known-host kind (self-hosted / unknown → 'other'). */
export function classifyHost(host: string): RemoteHostKind {
  const h = host.toLowerCase()
  if (h === 'github.com' || h.endsWith('.github.com')) return 'github'
  if (h === 'gitlab.com' || h.endsWith('.gitlab.com')) return 'gitlab'
  if (h === 'gitee.com' || h.endsWith('.gitee.com')) return 'gitee'
  if (h === 'bitbucket.org' || h.endsWith('.bitbucket.org')) return 'bitbucket'
  return 'other'
}

/** Strip a trailing `.git` and any surrounding slashes from a repo path. */
function normalizePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '')
}

/**
 * Extract `{ host, path }` from a remote URL, or null when it is not a
 * recognizable network URL (e.g. a bare local path `/srv/repo.git`). Any
 * userinfo (`user` / `user:token`) is dropped.
 */
function splitHostPath(raw: string): { host: string; path: string } | null {
  const url = raw.trim()
  if (url === '') return null
  // scp-like syntax: [user@]host:path (no scheme, no slash before the colon).
  const scp = url.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/)
  if (scp !== null && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const host = scp[1]!
    const path = normalizePath(scp[2]!)
    return host !== '' && path !== '' ? { host, path } : null
  }
  // scheme://[user[:pass]@]host[:port]/path  (ssh, https, http, git, ssh+git…).
  const scheme = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)\/(.+)$/i)
  if (scheme !== null) {
    let authority = scheme[1]!
    const at = authority.lastIndexOf('@')
    if (at >= 0) authority = authority.slice(at + 1)
    const host = authority.replace(/:\d+$/, '')
    const path = normalizePath(scheme[2]!)
    return host !== '' && path !== '' ? { host, path } : null
  }
  return null
}

/** Build a {@link GitRemote} from a remote name + its configured URL. */
export function parseRemote(name: string, url: string): GitRemote {
  const parsed = splitHostPath(url)
  if (parsed === null) {
    return { name, url, webUrl: null, host: null, hostKind: 'other' }
  }
  return {
    name,
    url,
    webUrl: `https://${parsed.host}/${parsed.path}`,
    host: parsed.host,
    hostKind: classifyHost(parsed.host),
  }
}
