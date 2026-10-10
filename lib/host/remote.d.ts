/**
 * Parse a git remote URL into a browsable https page URL + host classification.
 *
 * Git remotes come in several shapes — scp-like ssh (`git@host:owner/repo.git`),
 * ssh:// , https:// , git:// — all of which must collapse to a single
 * `https://<host>/<path>` page link and a known-host kind for the status-bar
 * icon. Credentials in the URL (`https://user:token@host/…`) are stripped so a
 * token can never leak into an href the browser renders.
 */
import type { GitRemote, RemoteHostKind } from './types.ts';
/** Map a hostname to a known-host kind (self-hosted / unknown → 'other'). */
export declare function classifyHost(host: string): RemoteHostKind;
/** Build a {@link GitRemote} from a remote name + its configured URL. */
export declare function parseRemote(name: string, url: string): GitRemote;
