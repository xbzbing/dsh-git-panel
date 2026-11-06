/**
 * The client half's one namespace: locale dictionaries and the RPC endpoint
 * prefix both use it.
 *
 * It must equal the host's `SERVICE_KEY` — the typert Gateway serves
 * `<namespace>/<method>` and registers locale dictionaries under the same name.
 * The plugin-contract test pins the client namespace to the host key, so a
 * rename cannot land on one half only.
 */
export const NS = 'dbGitPanel'
