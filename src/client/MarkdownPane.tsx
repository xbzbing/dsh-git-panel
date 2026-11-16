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
 * It starts collapsed into a button in that corner: the reader opened a
 * document to read it, and the outline is a detour they have to ask for. The
 * button opens the card over the same corner; the card folds back into the
 * button, or closes outright. Closing removes it — nothing is left behind, so
 * the page a reader wanted bare really is bare. That is only acceptable because
 * opening the document brings the button back, and "open" is the tab's call:
 * `hidden` is owned by FilesTab and keyed to the open it belongs to, so
 * re-opening the file (or another one) restores the outline while a re-render,
 * a refresh or a source/render switch does not. The text is deliberately not a
 * reset signal: a live draft preview changes it on every keystroke.
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import type { GitKey } from './locales.js'
import { ChevronIcon, CloseIcon, ListIcon } from './icons.js'
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
  readonly t: Translate
}): JSX.Element {
  const { body, source, openToken, hidden, onDismiss, t } = props
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLElement | null>(null)
  const openRef = useRef<HTMLButtonElement | null>(null)
  const foldRef = useRef<HTMLButtonElement | null>(null)
  // Set by a dismissal, read once the outline has left the page.
  const refocusDoc = useRef(false)
  // The button and the card take each other's place, so the control the reader
  // was on is unmounted by their own click: the focus it should land on only
  // exists after the next render.
  const focusAfterSwap = useRef<'open' | 'fold' | null>(null)
  const [entries, setEntries] = useState<readonly TocEntry[]>([])
  const [active, setActive] = useState(-1)
  // Collapsed to the corner button. Per reading: the reader's choice here is
  // about this document, and a new open starts over.
  const [expanded, setExpanded] = useState(false)

  // A new open starts over: collapsed, with no section carried over from the
  // document that was on screen before. The open token is the only signal for
  // that — the text is not one (a refresh re-reads the same file, a draft
  // preview changes it on every keystroke) and neither is a re-render.
  useEffect(() => {
    setExpanded(false)
    setActive(-1)
  }, [openToken])

  useEffect(() => {
    const target = focusAfterSwap.current
    if (target === null) return
    focusAfterSwap.current = null
    ;(target === 'fold' ? foldRef : openRef).current?.focus({ preventScroll: true })
  }, [expanded])

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

  const expand = useCallback(() => {
    focusAfterSwap.current = 'fold'
    setExpanded(true)
  }, [])

  const fold = useCallback(() => {
    focusAfterSwap.current = 'open'
    setExpanded(false)
  }, [])

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
      ? (expanded
        ? h(TocCard, {
          key: 'toc', entries, active, t, listRef, foldRef,
          onFold: fold,
          onClose: dismiss,
          onGoTo: goTo,
        })
        : h('button', {
          key: 'toc',
          ref: openRef,
          type: 'button',
          className: 'gp-files__toc-open',
          // The visible text is the panel's name; the label says what the click
          // does, and names the same thing, so it still reads true when spoken.
          title: t('files.tocExpand'),
          'aria-label': t('files.tocExpand'),
          onClick: expand,
        }, [h(ListIcon, { key: 'i', size: 12 }), t('files.toc')]))
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
 * shrinks the card back into the corner button, the close takes it off the page
 * entirely and leaves nothing behind.
 */
function TocCard(props: {
  readonly entries: readonly TocEntry[]
  readonly active: number
  readonly t: Translate
  readonly listRef: RefObject<HTMLElement | null>
  /** The fold control, so a collapse can hand the keyboard back to the button. */
  readonly foldRef: RefObject<HTMLButtonElement | null>
  readonly onFold: () => void
  readonly onClose: () => void
  readonly onGoTo: (index: number) => void
}): JSX.Element {
  const { entries, active, t, listRef, foldRef, onFold, onClose, onGoTo } = props
  const label = t('files.toc')
  return h('div', { className: 'gp-files__toc' }, [
    h('div', { key: 'hd', className: 'gp-files__toc-head' }, [
      h('span', { key: 't', className: 'gp-files__toc-title' }, label),
      h('button', {
        key: 'f', ref: foldRef, type: 'button', className: 'gp-files__toc-fold',
        title: t('files.tocCollapse'), 'aria-label': t('files.tocCollapse'),
        onClick: onFold,
      }, h(ChevronIcon, { size: 12, open: true })),
      h('button', {
        key: 'x', type: 'button', className: 'gp-files__toc-close',
        title: t('files.tocHide'), 'aria-label': t('files.tocHide'),
        onClick: onClose,
      }, h(CloseIcon, { size: 13 })),
    ]),
    h('nav', { key: 'list', ref: listRef, className: 'gp-files__toc-list', 'aria-label': label },
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
