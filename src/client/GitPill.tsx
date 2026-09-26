/**
 * inputBar Git marker, zsh-theme style: `<repo> (<branch>)`.
 * repo = cyan, (branch) = green when synced / orange when dirty.
 * Hover shows a rounded tooltip panel with the full repository path; click
 * jumps to the Git panel (changes tab when dirty, overview when clean).
 */
import { createElement as h, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { useGitView } from './registry'
import { hasSession } from './rpc'
import { activateGitTab, requestSubTab } from './jump'
import { setGitTabDot, clearGitTabDot, type GitTabDotStatus } from './tab-dot'
import type { GitKey } from './locales'

interface PillProps {
  readonly sessionId?: string
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
}

function basename(path: string): string {
  const parts = path.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || path
}

/** Rounded tooltip panel anchored above the pill (openviking-manager style). */
function useTooltip(): {
  bind: { onMouseEnter: () => void; onMouseLeave: () => void; ref: (el: HTMLElement | null) => void }
  render: (lines: readonly string[]) => JSX.Element | null
} {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const anchor = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (!open || anchor.current === null) { setPos(null); return }
    const r = anchor.current.getBoundingClientRect()
    setPos({ left: r.left, bottom: window.innerHeight - r.top + 8 })
  }, [open])

  const bind = {
    ref: (el: HTMLElement | null) => { anchor.current = el },
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
  }

  const render = (lines: readonly string[]): JSX.Element | null => {
    if (!open || pos === null || typeof document === 'undefined') return null
    return createPortal(
      h('div', { className: 'gp-tip', style: { left: pos.left, bottom: pos.bottom } },
        lines.map((line, i) => h('div', { key: i, className: i === 0 ? 'gp-tip__path' : 'gp-tip__note' }, line))),
      document.body,
    )
  }
  return { bind, render }
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

export function GitPill({ sessionId, t }: PillProps): JSX.Element | null {
  const view = useGitView(sessionId)
  const tip = useTooltip()
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
  useEffect(() => {
    setGitTabDot(dotOwner.current, label, dotStatus)
    const owner = dotOwner.current
    return () => { clearGitTabDot(owner) }
  }, [label, dotStatus])

  if (view.state === 'cold' || view.state === 'loading' || view.state === 'no-cwd') return null
  if (view.state === 'error') {
    // Not a git repo: hide the input-bar marker entirely (the Git tab still
    // opens straight into the file browser). Other errors → a dim label unless
    // the marker is turned off by preference.
    if (view.error.code === 'not-a-git-repo') return null
    if (view.error.showInputPill === false) return null
    return h('span', { className: 'gp-pill gp-pill--degraded', title: view.error.detail ?? t('pill.unavailable') }, t('pill.unavailable'))
  }

  const snap = view.snapshot
  if (snap.showInputPill === false) return null
  const repo = basename(snap.root)
  const branch = snap.branch ?? `(${t('pill.detached')})`
  const dirty = snap.dirty
  const gitClass = dirty ? 'gp-pill--dirty' : 'gp-pill--synced'

  const onClick = (): void => {
    if (hasSession(sessionId)) {
      requestSubTab(sessionId, dirty ? 'changes' : 'overview')
    }
    activateGitTab(t('panel.tab'))
  }

  return h('span', { className: 'gp-pill-wrap', ref: setWrap }, [
    h('button', {
      key: 'btn', type: 'button', className: `gp-pill ${gitClass}${compact ? ' gp-pill--compact' : ''}`, onClick,
      ref: tip.bind.ref, onMouseEnter: tip.bind.onMouseEnter, onMouseLeave: tip.bind.onMouseLeave,
    }, [
      h('span', { key: 'dot', className: 'gp-pill__dot', 'aria-hidden': 'true' }),
      h('span', { key: 'repo', className: 'gp-pill__repo' }, repo),
      h('span', { key: 'git', className: 'gp-pill__git' }, [
        '(',
        h('span', { key: 'b', className: 'gp-pill__branch' }, branch),
        ')',
      ]),
    ]),
    tip.render([snap.root, dirty ? t('pill.dirty') : t('pill.synced')]),
  ])
}
