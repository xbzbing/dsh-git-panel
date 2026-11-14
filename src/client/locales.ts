/**
 * `dbGitPanel` namespace dictionaries.
 *
 * The dictionaries live side by side in `./locales/`; `zh.ts` is the key-set
 * source of truth and owns `GitKey`, the type every other dictionary is
 * declared against. This module is the surface the rest of the client imports:
 * the key type plus the two baseline dictionaries the platform registers.
 */
export { zh } from './locales/zh.js'
export { en } from './locales/en.js'
export type { GitKey } from './locales/zh.js'
