import type { HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'

/** Partition complete-line syntax runs at a changed word's UTF-16 offsets. */
export function splitHighlightSpans(
  spans: readonly HighlightSpan[], range: readonly [number, number],
): [HighlightSpan[], HighlightSpan[], HighlightSpan[]] {
  const parts: [HighlightSpan[], HighlightSpan[], HighlightSpan[]] = [[], [], []]
  let offset = 0
  for (const span of spans) {
    const end = offset + span.text.length
    const cuts = [offset, Math.max(offset, Math.min(end, range[0])), Math.max(offset, Math.min(end, range[1])), end]
    for (let i = 0; i < 3; i++) {
      const text = span.text.slice(cuts[i] - offset, cuts[i + 1] - offset)
      if (text !== '') parts[i].push({ text, style: span.style })
    }
    offset = end
  }
  return parts
}
