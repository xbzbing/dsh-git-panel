/**
 * Test kit barrel: re-exports the pure client algorithms so `node --test`
 * can import them from a built ESM bundle (lib/testkit.mjs) without a
 * TypeScript loader. Not part of the plugin runtime.
 */
export { parseStatus, parseGraphLog, parseBranches, parseNameStatus, parseTags, parseStashList, sumNumstat, parseRefs } from '../host/parser.js'
export { parseRemote, classifyHost } from '../host/remote.js'
export { parsePrimaryRemote } from '../host/core.js'
export { isSafePath, isSafeRev, isSafeBranchName, isSafeRemoteName } from '../host/validate.js'
export { planAction, classifyActionFailure } from '../host/actions.js'
export { buildSideBySide, retargetTrailingGap, summarize, isBinaryDiff, extractAddedContent, extractDeletedContent, isImagePath, isSvgPath, intraLineDiff, spliceGap, contextRowsFromLines, flattenToUnified, GAP_STEP } from './diff.js'
export { buildFileTree } from './file-tree.js'
export { layoutGraph, graphWidth } from './git-graph.js'
export { gitPanelRemoteOf, queryAs, hasSession } from './rpc.js'
export { splitHighlightSpans } from './code-spans.js'
export { memoizeHighlighter, HL_CACHE_MAX } from './highlight-cache.js'
export { buildTops, lowerBound, windowRange, findWindowRange } from './virtual-list.js'
export { normalizeWheel, wheelZoomFactor, clampScale, anchoredScroll, isDragGesture, panScroll, SCALE_MIN, SCALE_MAX, ZOOM_STEP, DELTA_CLAMP, DRAG_THRESHOLD } from './zoom.js'
export { activateGitTab, isGitTabActive, returnToConversation, stashSubTab, recentSubTab } from './jump.js'
export { splitRemoteRef, buildBranchOptions, isSelectable } from './branch-options.js'
export { formatBytes } from './bytes.js'
export { langLabel } from './lang-label.js'
export { isUntrackedPath } from './status.js'
export { GitController } from './controller.js'
export { createVisibilitySource } from './visibility.js'
