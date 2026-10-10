/**
 * Test kit barrel: re-exports the pure client algorithms so `node --test`
 * can import them from a built ESM bundle (lib/testkit.mjs) without a
 * TypeScript loader. Not part of the plugin runtime.
 */
export { parseStatus, parseGraphLog, parseBranches, parseNameStatus, parseTags, parseStashList, sumNumstat, parseRefs } from '../host/parser.ts'
export { parseRemote, classifyHost } from '../host/remote.ts'
export { parsePrimaryRemote } from '../host/core.ts'
export { isSafePath, isSafeRev, isSafeBranchName } from '../host/validate.ts'
export { planAction, classifyActionFailure } from '../host/actions.ts'
export { buildSideBySide, summarize, isBinaryDiff, isAddOnlyDiff, isDeleteOnlyDiff, extractAddedContent, extractDeletedContent, isImagePath, isSvgPath, intraLineDiff, spliceGap, contextRowsFromLines, flattenToUnified, GAP_STEP } from './diff.ts'
export { buildFileTree } from './file-tree.ts'
export { layoutGraph, graphWidth } from './git-graph.ts'
export { gitPanelRemoteOf, queryAs, hasSession } from './rpc.ts'
export { splitHighlightSpans } from './code-spans.ts'
export { buildTops, lowerBound, windowRange } from './virtual-list.ts'
export { activateGitTab, isGitTabActive, returnToConversation, stashSubTab, recentSubTab } from './jump.ts'
