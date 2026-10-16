import type { GitSnapshot } from './types.js';
/** Hash the final wire state; sampling time and the digest itself are not state. */
export declare function snapshotFingerprint(snapshot: GitSnapshot): string;
