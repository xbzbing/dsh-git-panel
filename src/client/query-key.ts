/** Structured request identities are serialized once, at the request boundary. */
export type QueryKeyPart = string | number | boolean | null | undefined
export type QueryKey = readonly [QueryKeyPart, ...QueryKeyPart[]]
