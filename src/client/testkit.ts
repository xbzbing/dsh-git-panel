/**
 * Test kit barrel: re-exports the pure client algorithms so `node --test`
 * can import them from a built ESM bundle (lib/testkit.mjs) without a
 * TypeScript loader. Not part of the plugin runtime.
 */
export { parseStatus, parseGraphLog, parseBranches, parseNameStatus, sumNumstat, parseRefs } from '../host/parser.ts'
export { isSafePath, planAction } from '../host/actions.ts'
export { buildSideBySide, summarize, isBinaryDiff, isAddOnlyDiff, isDeleteOnlyDiff, extractAddedContent, extractDeletedContent, isImagePath } from './diff.ts'
export { buildFileTree } from './file-tree.ts'
export { layoutGraph, graphWidth } from './git-graph.ts'
