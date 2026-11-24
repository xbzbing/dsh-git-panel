/**
 * Diff line comments (issue #123, ADR-0038): the picking state behind the
 * gutters and the comment bar under the diff.
 *
 * The bar sits below the scroller, not between rows: the diff body is a
 * windowed grid whose row heights are measured per index, and an inline form
 * would be one more row of unknown height inside that window. Below the
 * scroller it never moves the rows, survives scrolling the range out of view,
 * and keeps the composer in sight — the reader writes here and sends there.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { SideRow } from './diff.js'
import type { GitKey } from './locales.js'
import { KEYS_OWNER_ATTR } from './dialog-focus.js'
import {
  formatReviewQuote, parseReviewHunks, pickReviewLine, reviewQuoteSummary,
  reviewRangeLabel, reviewSnippet, reviewSnippetState,
  type ReviewHunk, type ReviewLineRange, type ReviewQuoteSummary, type ReviewSide, type ReviewSnippet, type ReviewSource,
  type ReviewSnippetState,
} from './review-quote.js'

/** What a diff surface hands the renderer to accept comments. Build it once
 * (memoized): DiffView is a memo component. */
export interface DiffReview {
  /** Which diff this is, written into every quote. */
  readonly source: ReviewSource
  /** Absolute repository root, written as `Repository:`. */
  readonly repository?: string
  /** Put one quote into the composer; false when the composer did not take it. */
  readonly add: (text: string, summary: ReviewQuoteSummary) => boolean
  /** The number the next comment takes (see `nextReviewIndex`). */
  readonly nextIndex: () => number
}

/** The panel's half of a {@link DiffReview}: everything but which diff it is.
 * Each diff surface adds its own `source`. */
export type ReviewHost = Omit<DiffReview, 'source'>

/** Join the panel's half and a surface's source; undefined when the panel
 * offers no composer. Call inside `useMemo` keyed on the source's fields. */
export function diffReviewOf(host: ReviewHost | undefined, source: ReviewSource | null): DiffReview | undefined {
  return host === undefined || source === null ? undefined : { ...host, source }
}

/** The renderer's view of the picking state. */
export interface ReviewPicking {
  /** The range to tint; null while nothing is picked or the pick went stale. */
  readonly range: ReviewLineRange | null
  /** Pick a line, or grow the range to it with Shift. */
  readonly pick: (side: ReviewSide, line: number, extend: boolean) => void
}

const NO_HUNKS: readonly ReviewHunk[] = []

interface Draft {
  readonly range: ReviewLineRange
  readonly snippet: ReviewSnippet
}

/** Text of one line of one side, read from the rendered rows. */
function rowText(rows: readonly SideRow[]): (side: ReviewSide, line: number) => string | undefined {
  return (side, line) => {
    for (const row of rows) {
      if (side === 'L' ? row.leftNo === line : row.rightNo === line) {
        const text = side === 'L' ? row.leftText : row.rightText
        return text ?? undefined
      }
    }
    return undefined
  }
}

/**
 * The picking state of one DiffView.
 * @param review - the surface's comment target; undefined disables picking.
 * @param text - the diff text (hunks come from it).
 * @param rows - the rendered rows (revealed context lines come from them).
 * @param path - the file; a new file drops the pick.
 */
export function useDiffReview(review: DiffReview | undefined, text: string, rows: readonly SideRow[], path: string | undefined): {
  readonly picking: ReviewPicking | null
  readonly draft: Draft | null
  /** Why the frozen snippet no longer matches the screen, or null while it does. */
  readonly stale: Exclude<ReviewSnippetState, 'current'> | null
  readonly clear: () => void
} {
  // Without a comment target no gutter picks, so the hunks are never read.
  const hunks = useMemo(() => (review === undefined ? NO_HUNKS : parseReviewHunks(text)), [review, text])
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  draftRef.current = draft
  const lineText = useMemo(() => rowText(rows), [rows])
  // Another file, or another source for the same file (a different commit, the
  // other side of the index, another checkout), is another comment target:
  // nothing carries over.
  useEffect(() => { setDraft(null) }, [path, review])
  const clear = useCallback(() => { setDraft(null) }, [])
  const pick = useCallback((side: ReviewSide, line: number, extend: boolean) => {
    const range = pickReviewLine(draftRef.current?.range ?? null, hunks, side, line, extend)
    const snippet = reviewSnippet(hunks, range, lineText)
    if (snippet !== null) setDraft({ range, snippet })
  }, [hunks, lineText])
  // A refreshed diff may have moved the code under the picked numbers, or a
  // narrower context may no longer render them. The comment keeps the snippet
  // the reader saw and says which, rather than tinting whatever those numbers
  // hold now.
  const stale = useMemo(() => {
    if (draft === null) return null
    const state = reviewSnippetState(draft.snippet, hunks, draft.range, lineText)
    return state === 'current' ? null : state
  }, [draft, hunks, lineText])
  const picking = review === undefined ? null : { range: draft === null || stale !== null ? null : draft.range, pick }
  return { picking, draft: review === undefined ? null : draft, stale, clear }
}

interface ReviewBarProps {
  readonly review: DiffReview
  readonly path: string
  readonly draft: Draft
  readonly stale: Exclude<ReviewSnippetState, 'current'> | null
  readonly onDone: () => void
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

/** The comment form for the picked range. */
export function ReviewBar({ review, path, draft, stale, onDone, t }: ReviewBarProps): JSX.Element {
  const [body, setBody] = useState('')
  const [failed, setFailed] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  // A new range keeps what was typed (the reader often widens the range after
  // starting) but focuses the field again.
  useEffect(() => { inputRef.current?.focus() }, [draft.range.side, draft.range.start, draft.range.end])
  const range = reviewRangeLabel(draft.range)
  const empty = body.trim() === ''
  const add = (): void => {
    if (empty) return
    const index = review.nextIndex()
    const text = formatReviewQuote({
      ...(review.repository === undefined ? {} : { repository: review.repository }),
      path, range: draft.range, source: review.source, snippet: draft.snippet, body,
    }, index)
    if (review.add(text, reviewQuoteSummary(path, draft.range, body))) {
      setBody('')
      setFailed(false)
      onDone()
    } else {
      // The text stays: a composer that is not there must not cost the comment.
      setFailed(true)
    }
  }
  // Keys owner: the enlarged diff card closes on a capture-phase Escape, which
  // must yield to the form — the comment is the innermost thing open. The form
  // handles Escape wherever its focus is (the field or a button): an owned key
  // nobody handles would fall through to the card's bubble listener.
  const onKeyDown = (e: { key: string; defaultPrevented: boolean; preventDefault: () => void; stopPropagation: () => void; nativeEvent?: { isComposing?: boolean } }): void => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    // Escape during IME composition cancels the candidate list, not the form:
    // the keystroke that ends a Chinese or Japanese input would otherwise throw
    // the comment away (compare-flow's filter guards the same way). It still
    // stops here, unprevented so the input method keeps it: the enlarged card
    // and the commit / compare dialogs close on any Escape that reaches them.
    if (e.nativeEvent?.isComposing === true) { e.stopPropagation(); return }
    e.preventDefault()
    e.stopPropagation()
    onDone()
  }
  return h('section', { className: 'gp-review', [KEYS_OWNER_ATTR]: '', 'aria-label': t('diff.reviewTitle', { range }), onKeyDown }, [
    h('div', { key: 'head', className: 'gp-review__head' }, [
      h('span', { key: 'title', className: 'gp-review__title' }, t('diff.reviewTitle', { range })),
      h('span', { key: 'hint', className: 'gp-review__hint' }, t('diff.reviewHint')),
    ]),
    stale === null ? null : h('div', { key: 'stale', className: 'gp-review__stale', role: 'status' }, t(stale === 'changed' ? 'diff.reviewStale' : 'diff.reviewHidden')),
    h('textarea', {
      key: 'input', ref: inputRef, className: 'gp-review__input', rows: 3, value: body,
      placeholder: t('diff.reviewPlaceholder'), 'aria-label': t('diff.reviewPlaceholder'),
      onChange: (e: { target: { value: string } }) => { setBody(e.target.value); if (failed) setFailed(false) },
      onKeyDown: (e: { key: string; metaKey: boolean; ctrlKey: boolean; preventDefault: () => void }) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add() }
      },
    }),
    failed ? h('div', { key: 'err', className: 'gp-review__error', role: 'alert' }, t('diff.reviewFailed')) : null,
    h('div', { key: 'actions', className: 'gp-review__actions' }, [
      h('button', { key: 'cancel', type: 'button', className: 'gp-btn gp-btn--sm', onClick: onDone }, t('common.cancel')),
      h('button', {
        key: 'add', type: 'button', className: 'gp-btn gp-btn--sm gp-btn--primary', disabled: empty, onClick: add,
      }, t('diff.reviewAdd')),
    ]),
  ])
}
