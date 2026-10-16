import { createHash } from 'node:crypto'
import type { GitSnapshot } from './types.js'

/** Hash the final wire state; sampling time and the digest itself are not state. */
export function snapshotFingerprint(snapshot: GitSnapshot): string {
  const { checkedAt: _checkedAt, stateFingerprint: _stateFingerprint, ...state } = snapshot
  const encoded = JSON.stringify(state, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  })
  return createHash('sha256').update(encoded).digest('hex')
}
