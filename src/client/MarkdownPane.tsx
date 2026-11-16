/**
 * Rendered-Markdown pane: the platform's document plus the reader's floating
 * outline.
 *
 * The outline is read off the rendered document rather than parsed out of the
 * source text. `MarkdownText` owns the heading markup and mermaid segments are
 * handed to a different renderer, so the only list guaranteed to line up with
 * what the reader can actually scroll to is the one the DOM shows. It floats
 * over the document (the reading column keeps its full width).
 *
 * Dismissing it removes it: nothing is left behind in its corner, so the page
 * the reader wanted to read bare really is bare. That is only acceptable
 * because opening the document brings it back, and "open" is the tab's call —
 * `hidden` is owned by FilesTab and keyed to the open it belongs to, so
 * re-opening the file (or another one) restores the outline while a re-render,
 * a refresh or a source/render switch does not. The text is deliberately not a
 * reset signal: a live draft preview changes it on every keystroke.
 */
import { createElement as h, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import type { GitKey } from './locales.js'
import { ChevronIcon, CloseIcon } from './icons.js'
import { activeTocIndex, tocEntries, tocIndent, tocScrollTarget, type TocEntry } from './markdown-toc.js'

type Translate = (key: GitKey, params?: Record<string, string | number>) => string

/** The scroll box's own ceiling, for the outline's end-of-document rule. */
function maxScrollTopOf(box: HTMLElement): number {
  return Math.max(0, box.scrollHeight - box.clientHeight)
}

/** A document with fewer sections than this gets no outline: two rows are not
 * worth the chrome, and the reader already sees both. */
const TOC_MIN_ENTRIES = 2

const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6'

/**
 * Read the outline off the live document.
 *
 * Headings inside an embedded SVG (a diagram's own text) are skipped: they are
 * picture content, not sections of the file. `offsetTop` is measured against
 * the offset parent, which the scroll box establishes — the CSS keeps it
 * `position: relative` for exactly this.
 */
function readOutline(box: HTMLElement): TocEntry[] {
  const rows: TocEntry[] = []
  for (const node of box.querySelectorAll<HTMLElement>(HEADING_SELECTOR)) {
    if (node.closest('svg') !== null) continue
    rows.push({ level: Number(node.tagName.slice(1)), text: node.textContent ?? '', top: node.offsetTop })
  }
  return tocEntries(rows)
}

export function MarkdownPane(props: {
  /** The rendered document (`MarkdownText` per segment, in document order). */
  readonly body: ReactNode
  /** The document's own text — the outline's identity. A new file, or an edit
   * that changed what a heading says, re-reads it; React compares the string
   * by value, so an unrelated re-render does not. */
  readonly source: string
  /** Bumped by the tab every time a file is opened, including the same path
   * again: opening a document restores an outline the reader dismissed. */
  readonly openToken: number
  /** The outline is off the page (the reader closed it for this open). Owned
   * by the tab so a remount — the source/render switch unmounts this pane —
   * cannot bring it back. */
  readonly hidden: boolean
  readonly onDismiss: () => void
  /** The compact tier is one narrow column that *is* the document, so its
   * outline starts folded to its header instead of covering the text. Open is
   * the default everywhere else. */
  readonly startsFolded: boolean
  readonly t: Translate
}): JSX.Element {
  const { body, source, openToken, hidden, onDismiss, startsFolded, t } = props
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLElement | null>(null)
  const [entries, setEntries] = useState<readonly TocEntry[]>([])
  const [active, setActive] = useState(-1)
  // The card's own fold: rows hidden, header (and both header controls) kept.
  // Per reading, so it resets on a new open and survives a remount only as
  // far as this pane instance does.
  const [listOpen, setListOpen] = useState(!startsFolded)
  const listId = useId()
  const refocusDoc = useRef(false)

  // A new document re-reads its headings and starts unfolded (the compact tier
  // starts folded). Keyed on the open token, not on the text — an edit must
  // update the rows, never reopen a card the reader closed.
  useEffect(() => {
    setListOpen(!startsFolded)
    setActive(-1)
  }, [openToken, startsFolded])

  const measure = useCallback(() => {
    const box = scrollRef.current
    if (box === null) return
    const next = readOutline(box)
    setEntries((prev) => (sameOutline(prev, next) ? prev : next))
    setActive(activeTocIndex(next.map((e) => e.top), box.scrollTop, undefined, maxScrollTopOf(box)))
  }, [])

  // Re-read after every document change, and again whenever the content
  // resizes: an image finishing its load, a font swap or a diagram drawing all
  // move the headings below them, and stale offsets would scroll to the wrong
  // place.
  useEffect(() => {
    measure()
    const target = bodyRef.current
    if (target === null || typeof ResizeObserver !== 'function') return undefined
    const observer = new ResizeObserver(() => measure())
    observer.observe(target)
    return () => observer.disconnect()
  }, [measure, source])

  // Current section follows the scroll position. rAF-throttled: one measurement
  // per frame instead of one per scroll event.
  useEffect(() => {
    const box = scrollRef.current
    if (box === null) return undefined
    let frame = 0
    const onScroll = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setActive(activeTocIndex(entries.map((e) => e.top), box.scrollTop, undefined, maxScrollTopOf(box)))
      })
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      box.removeEventListener('scroll', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [entries])

  // Dismissing unmounts the control the keyboard was on, so the focus goes to
  // the document itself (a tabIndex -1 region, reachable by script but not by
  // Tab): the reader keeps scrolling instead of landing back on <body>.
  useEffect(() => {
    if (!refocusDoc.current) return
    refocusDoc.current = false
    scrollRef.current?.focus({ preventScroll: true })
  }, [hidden])

  const dismiss = useCallback(() => {
    refocusDoc.current = true
    onDismiss()
  }, [onDismiss])

  // Keep the current row inside the card: an outline longer than the card is
  // scrollable, and a highlight nobody can see reads as a frozen list. Runs on
  // the row's position inside the list, so the document never scrolls.
  useEffect(() => {
    const list = listRef.current
    const row = active < 0 ? null : list?.querySelector<HTMLElement>('[aria-current="true"]')
    if (list === null || row === null || row === undefined) return
    const top = row.offsetTop - list.offsetTop
    const bottom = top + row.offsetHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
  }, [active])

  const tops = useMemo(() => entries.map((e) => e.top), [entries])
  const goTo = useCallback((index: number) => {
    const box = scrollRef.current
    if (box === null) return
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    box.scrollTo({
      top: tocScrollTarget(tops, index, maxScrollTopOf(box)),
      behavior: reduced ? 'auto' : 'smooth',
    })
  }, [tops])

  const showOutline = !hidden && entries.length >= TOC_MIN_ENTRIES
  return h('div', { className: 'gp-files__mdwrap' }, [
    h('div', {
      key: 'doc', ref: scrollRef, className: 'gp-files__markdown',
      // Focus target for a dismissal; -1 keeps it out of the tab order.
      tabIndex: -1,
    }, h('div', {
      key: 'body', ref: bodyRef, className: 'gp-files__markdown-body',
    }, body)),
    showOutline
      ? h(TocPanel, {
        key: 'toc', entries, active, listOpen, listId, t, listRef,
        onClose: dismiss,
        onToggleList: () => setListOpen((open) => !open),
        onGoTo: goTo,
      })
      : null,
  ])
}

/** True when both outlines name the same headings in the same places, so a
 * resize observer tick that changed nothing does not re-render the list. */
function sameOutline(a: readonly TocEntry[], b: readonly TocEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].level !== b[i].level || a[i].top !== b[i].top || a[i].text !== b[i].text) return false
  }
  return true
}

/**
 * The floating outline card: a header (title plus its two controls) over the
 * row list. The controls are deliberately different magnitudes — the fold
 * shrinks the card to its header, the close takes it off the page entirely and
 * leaves nothing behind.
 */
function TocPanel(props: {
  readonly entries: readonly TocEntry[]
  readonly active: number
  readonly listOpen: boolean
  /** Id of the row list, so the fold control names what it shows and hides. */
  readonly listId: string
  readonly t: Translate
  readonly listRef: RefObject<HTMLElement | null>
  readonly onClose: () => void
  readonly onToggleList: () => void
  readonly onGoTo: (index: number) => void
}): JSX.Element {
  const { entries, active, listOpen, listId, t, listRef, onClose, onToggleList, onGoTo } = props
  const label = t('files.toc')
  const foldLabel = t(listOpen ? 'files.tocCollapse' : 'files.tocExpand')
  return h('div', { className: `gp-files__toc${listOpen ? '' : ' gp-files__toc--folded'}` }, [
    h('div', { key: 'hd', className: 'gp-files__toc-head' }, [
      h('span', { key: 't', className: 'gp-files__toc-title' }, label),
      h('button', {
        key: 'c', type: 'button', className: 'gp-files__toc-fold',
        title: foldLabel, 'aria-label': foldLabel,
        'aria-expanded': listOpen, 'aria-controls': listId,
        onClick: onToggleList,
      }, h(ChevronIcon, { size: 12, open: listOpen })),
      h('button', {
        key: 'x', type: 'button', className: 'gp-files__toc-close',
        title: t('files.tocHide'), 'aria-label': t('files.tocHide'),
        onClick: onClose,
      }, h(CloseIcon, { size: 13 })),
    ]),
    h('nav', { key: 'list', id: listId, ref: listRef, className: 'gp-files__toc-list', 'aria-label': label },
      entries.map((entry, index) => h('button', {
        // Index only: positions move when an image or a diagram finishes
        // loading, and a keyed-on-offset row would remount (dropping the focus
        // the reader put there) on every re-measure.
        key: index,
        type: 'button',
        className: `gp-files__toc-item${index === active ? ' gp-files__toc-item--active' : ''}`,
        // The outline is a jump list, not a set of tabs: `aria-current` is how
        // the current section is announced while the reader scrolls.
        ...(index === active ? { 'aria-current': 'true' as const } : {}),
        style: { paddingLeft: `${8 + tocIndent(entry.level) * 10}px` },
        title: entry.text,
        onClick: () => onGoTo(index),
      }, entry.text))),
  ])
}
