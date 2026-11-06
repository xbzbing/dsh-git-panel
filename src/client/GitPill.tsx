/**
 * inputBar Git marker, zsh-theme style: `<repo> (<branch>)`.
 * repo = cyan, (branch) = green when synced / orange when dirty.
 * Hover shows a rounded tooltip panel with the full repository path; click
 * toggles the Git panel — jumps to it (changes tab when dirty, overview when
 * clean), and returns to the conversation view when the Git tab is already
 * active. When the panel lives in the right sidebar instead, the same click
 * opens it; if the sidebar is expanded with this page as its only tab, the
 * click collapses the column. */
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { useGitView } from './registry.js'
import { hasSession } from './rpc.js'
import { activateGitTab, isGitTabActive, requestSubTab, returnToConversation } from './jump.js'
import { setGitTabDot, clearGitTabDot, type GitTabDotStatus } from './tab-dot.js'
import { effectivePlacement } from './placement-state.js'
import { closeSidebarIfOnlyGit, openSidebarTab, sidebarController, sidebarOnlyGitOpen, sidebarRegistry } from './sidebar.js'
import { usePillMenu, type PillSample } from './use-pill-menu.js'
import type { ClientCtx } from './rpc.js'
import type { GitKey } from './locales.js'
import type { UseContextMenu } from './menu-types.js'

interface PillProps {
  readonly ctx: ClientCtx
  readonly sessionId?: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  /** The platform's injected menu factory; absent on hosts without the
   * context-menu package, where the pill keeps its native menu only. */
  readonly useContextMenu?: UseContextMenu
}

function basename(path: string): string {
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || path
}

/** The shell phase of the conversation around `from`; `hero` is the blank,
 * pre-first-message state whose view-tab row is not rendered. The main pane
 * carries `data-phase`; the right sidebar's embedded chat carries the phase
 * on its content body instead. */
function isHeroPane(from: Element | null): boolean {
  const phase = from?.closest('[data-phase]')?.getAttribute('data-phase')
  if (phase !== undefined) return phase === 'hero'
  const chat = from?.closest('[data-sidebar-chat]') ?? null
  if (chat === null) return false
  return from?.closest('[data-conversation-content]')?.getAttribute('data-content-phase') === 'hero'
}

/** Whether a click can reach the sidebar's Git page type: the placement keeps
 * the sidebar mount and the host offers both sidebar services. The service
 * check is the real availability signal — `mountState('all')` still asks for a
 * sidebar on a host that has none. */
function sidebarRoute(ctx: ClientCtx): boolean {
  return effectivePlacement() !== 'tab'
    && sidebarRegistry(ctx) !== undefined
    && sidebarController(ctx) !== undefined
}

/** How long a click-failure notice stays on screen. */
const NOTICE_MS = 3000

/**
 * Rounded tooltip panel anchored above the pill (openviking-manager style).
 * Hover lines come from `getLines` at open time, so a hint that depends on the
 * conversation phase (blank vs. active) is current even when the pill itself
 * has not re-rendered. `show` puts a short-lived notice in the same panel for a
 * click that has nowhere to go; the notice outlives the press that raised it
 * because it is set after the document-level pointerdown listener ran.
 */
function useTooltip(getLines: () => readonly string[]): {
  bind: {
    onPointerEnter: (e: { pointerType: string }) => void
    onPointerLeave: () => void
    ref: (el: HTMLElement | null) => void
  }
  render: () => JSX.Element | null
  show: (lines: readonly string[]) => void
} {
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<readonly string[] | null>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const active = open || notice !== null

  useLayoutEffect(() => {
    if (!active || anchor.current === null) { setPos(null); return }
    const r = anchor.current.getBoundingClientRect()
    setPos({ left: r.left, bottom: window.innerHeight - r.top + 8 })
  }, [active])

  // Any press closes the panel. A tap synthesises no leave (the virtual cursor
  // stays where the finger was), so without this the panel a tap left behind
  // would sit over the conversation view.
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined
    const onDown = (): void => { setOpen(false); setNotice(null) }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [active])

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
  }, [])

  const show = (lines: readonly string[]): void => {
    if (typeof window === 'undefined') return
    setNotice(lines)
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      setNotice(null)
    }, NOTICE_MS)
  }

  const bind = {
    ref: (el: HTMLElement | null) => { anchor.current = el },
    // Pointer events carry the pointer kind: only a mouse entering the pill
    // counts as hovering it.
    onPointerEnter: (e: { pointerType: string }) => { if (e.pointerType === 'mouse') setOpen(true) },
    onPointerLeave: () => setOpen(false),
  }

  const render = (): JSX.Element | null => {
    const lines = notice ?? (open ? getLines() : null)
    if (lines === null || pos === null || typeof document === 'undefined') return null
    return createPortal(
      h('div', { className: 'gp-tip', style: { left: pos.left, bottom: pos.bottom } },
        lines.map((line, i) => h('div', {
          key: i,
          className: notice !== null || i > 0 ? 'gp-tip__note' : 'gp-tip__path',
        }, line))),
      document.body,
    )
  }
  return { bind, render, show }
}

/**
 * Observe the conversation workspace width and report whether the input-bar
 * marker should collapse to a dot. Width-driven (not sidebar open/close state),
 * so the pill expands again as soon as the workspace widens. Falls back to the
 * viewport width when the region element is not found.
 */
function useCompactMarker(anchor: HTMLElement | null): boolean {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    if (anchor === null || typeof ResizeObserver === 'undefined') return
    const region = anchor.closest<HTMLElement>('[data-conversation-region]')
    const target = region ?? document.body
    const measure = (): void => setCompact(target.clientWidth > 0 && target.clientWidth < COMPACT_WIDTH)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(target)
    return () => ro.disconnect()
  }, [anchor])
  return compact
}

/** Workspace width (px) below which the marker collapses to a status dot. */
const COMPACT_WIDTH = 620

export function GitPill({ ctx, sessionId, t, useContextMenu }: PillProps): JSX.Element | null {
  const view = useGitView(sessionId)
  // The hover lines are read when the panel opens, not captured at render:
  // the conversation can turn from hero to active without the pill re-rendering.
  const tipLines = useRef<() => readonly string[]>(() => [])
  const tip = useTooltip(() => tipLines.current())
  const [wrap, setWrap] = useState<HTMLElement | null>(null)
  const compact = useCompactMarker(wrap)
  // Stable owner token for this pill instance (multi-pane shells run several).
  const dotOwner = useRef(Symbol('gp-tab-dot'))

  // The tab-status dot mirrors the pill's inverse: it appears only when the
  // input-bar marker is hidden, coloured like the pill's branch (green synced
  // / orange dirty). Computed before any early return so the hook order holds.
  const dotStatus: GitTabDotStatus =
    view.state === 'ready' && view.snapshot.showInputPill === false
      ? (view.snapshot.dirty ? 'dirty' : 'synced')
      : null
  const label = t('panel.tab')
  // Placement is read once per render; the click and the menu's page opener
  // both branch on it.
  const sidebarOnly = effectivePlacement() === 'sidebar'
  // The menu reads the same sample the marker shows; it must be computed before
  // the early returns so the hook order holds in every state.
  const sample: PillSample | null = view.state === 'ready'
    ? { root: view.snapshot.root, branch: view.snapshot.branch, remote: view.snapshot.remote !== null }
    : null
  // One page opener for the menu entries. The click's own toggle (collapse, or
  // return to the conversation) is not what a menu entry means, so this only
  // ever opens: the sub-tab is requested first — the sidebar panel subscribes
  // to the same session request — then the in-panel tab or the sidebar is
  // opened, with the click's blank-pane fallback and its notice.
  const openTab = (tab: 'overview' | 'changes' | 'files'): void => {
    if (hasSession(sessionId)) requestSubTab(sessionId, tab)
    if (!sidebarOnly && activateGitTab(label, wrap)) return
    const route = sidebarOnly || sidebarRoute(ctx)
    if (route && openSidebarTab(ctx)) return
    tip.show([route ? t('pill.openFailed') : t('pill.blankUnavailable')])
  }
  const menuProps = usePillMenu({ ctx, t, sessionId, useContextMenu, sample, openTab })
  useEffect(() => {
    setGitTabDot(dotOwner.current, label, dotStatus)
    const owner = dotOwner.current
    return () => { clearGitTabDot(owner) }
  }, [label, dotStatus])

  if (view.state === 'cold' || view.state === 'loading' || view.state === 'no-cwd') return null
  if (view.state === 'error') {
    // Not a git repo, or git not installed: hide the input-bar marker entirely
    // (the Git tab still opens straight into the file browser). Other errors →
    // a dim label unless the marker is turned off by preference.
    if (view.error.code === 'not-a-git-repo' || view.error.code === 'git-unavailable') return null
    if (view.error.showInputPill === false) return null
    return h('span', { className: 'gp-pill gp-pill--degraded', title: view.error.detail ?? t('pill.unavailable') }, t('pill.unavailable'))
  }

  const snap = view.snapshot
  if (snap.showInputPill === false) return null
  const repo = basename(snap.root)
  const branch = snap.branch ?? t('pill.detached')
  const dirty = snap.dirty
  const gitClass = dirty ? 'gp-pill--dirty' : 'gp-pill--synced'

  // Toggle: a click opens the Git panel; a click while the Git tab is already
  // active returns to the conversation view. When the panel is mounted in the
  // right sidebar instead, a click opens that page type — unless the sidebar is
  // already expanded with this page as its only tab, in which case the same
  // click collapses the column. A sidebar holding another page keeps the
  // navigation meaning: closing it would hide that page too. In a blank session
  // the shell renders no Git view tab at all, so the tab path falls through to
  // the sidebar; when neither exists the click says why instead of doing
  // nothing.
  const onClick = (): void => {
    if (sidebarOnly) {
      if (closeSidebarIfOnlyGit(ctx, sessionId)) return
      if (!openSidebarTab(ctx)) tip.show([t('pill.openFailed')])
      return
    }
    if (isGitTabActive(label, wrap)) { returnToConversation(label, wrap); return }
    if (hasSession(sessionId)) {
      requestSubTab(sessionId, dirty ? 'changes' : 'overview')
    }
    if (activateGitTab(label, wrap)) return
    const route = sidebarRoute(ctx)
    if (route && closeSidebarIfOnlyGit(ctx, sessionId)) return
    if (route && openSidebarTab(ctx)) return
    tip.show([route ? t('pill.openFailed') : t('pill.blankUnavailable')])
  }

  // The pill reads as a status marker, so a click that opens or closes the
  // sidebar rather than the tab needs saying — otherwise the click looks like
  // it did nothing. A blank pane is the other case: its tab row does not exist,
  // so the sidebar is the only target. The close hint is chosen at open time
  // because the sidebar can gain another page without the pill re-rendering.
  tipLines.current = () => {
    const lines = [snap.root, dirty ? t('pill.dirty') : t('pill.synced')]
    if (sidebarOnly || (isHeroPane(wrap) && sidebarRoute(ctx))) {
      lines.push(sidebarOnlyGitOpen(ctx, sessionId) ? t('pill.closesSidebar') : t('pill.opensSidebar'))
    }
    return lines
  }

  return h('span', { className: 'gp-pill-wrap', ref: setWrap }, [
    h('button', {
      key: 'btn', type: 'button', className: `gp-pill ${gitClass}${compact ? ' gp-pill--compact' : ''}`, onClick,
      ref: tip.bind.ref, onPointerEnter: tip.bind.onPointerEnter, onPointerLeave: tip.bind.onPointerLeave,
      ...menuProps,
    }, [
      h('span', { key: 'dot', className: 'gp-pill__dot', 'aria-hidden': 'true' }),
      h('span', { key: 'repo', className: 'gp-pill__repo' }, repo),
      h('span', { key: 'git', className: 'gp-pill__git' }, [
        '(',
        h('span', { key: 'b', className: 'gp-pill__branch' }, branch),
        ')',
      ]),
    ]),
    tip.render(),
  ])
}
