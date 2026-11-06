/**
 * Vocabulary shared by the diff renderer, the image comparer and the diff
 * query hooks.
 *
 * These two types used to live in `DiffView.tsx`, which made the renderer a
 * type hub: `ImageCompare` and `useImageDiff` both imported it, and it imported
 * both back, so the module graph carried two type-level cycles. Keeping the
 * vocabulary here lets every consumer depend on the types instead of on the
 * renderer; `DiffView` re-exports them so existing imports keep working.
 */

/** unified = single inline column; split = side-by-side; before/after show one
 * side's full content. */
export type DiffMode = 'unified' | 'split' | 'before' | 'after'

/** Diff base for the compared sides — selects the image panes and the source
 * the hidden-context expansion reads from. */
export type DiffBase = 'worktree' | 'staged' | 'commit' | 'rev'
