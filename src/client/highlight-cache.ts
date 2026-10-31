/**
 * Per-fragment cache around a code highlighter.
 *
 * A diff row re-renders whenever its window moves or an ancestor re-renders,
 * and the platform highlighter tokenizes a fragment on every call (shiki
 * `codeToTokens` with the JavaScript regex engine — measured 0.2–13 ms per
 * line, so a full-file diff costs hundreds of milliseconds). The same line text
 * must therefore never be tokenized twice.
 *
 * The cache is bound to one highlighter instance: callers memoize it on the
 * highlighter returned by `useCodeHighlighter`, which changes identity when the
 * grammar or language changes, so a stale cache cannot survive a language
 * switch or a late-loading grammar.
 */
import type { CodeHighlighter, HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'

/** Cached fragments before the cache is dropped wholesale. A diff can be huge;
 * this bounds memory without the bookkeeping of an LRU (the next render simply
 * re-tokenizes what it needs). */
export const HL_CACHE_MAX = 8000

/** Fragments longer than this are highlighted without being kept: the count
 * cap alone bounds the number of entries, not their size, and one minified line
 * can be hundreds of KB. */
export const HL_CACHE_MAX_CHARS = 5000

export function memoizeHighlighter(hl: CodeHighlighter): CodeHighlighter {
  const cache = new Map<string, HighlightSpan[][] | undefined>()
  return (code: string): HighlightSpan[][] | undefined => {
    if (cache.has(code)) return cache.get(code)
    const value = hl(code)
    if (code.length > HL_CACHE_MAX_CHARS) return value
    if (cache.size >= HL_CACHE_MAX) cache.clear()
    cache.set(code, value)
    return value
  }
}
