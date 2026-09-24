/**
 * inputBar Git marker, zsh-theme style: `<repo> (<branch>)`.
 * repo = cyan, (branch) = green when synced / orange when dirty.
 * Hover shows a rounded tooltip panel with the full repository path; click
 * jumps to the Git panel (changes tab when dirty, overview when clean).
 */
import { createElement as h, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { useGitView } from './registry'
import { activateGitTab, requestSubTab } from './jump'
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

export function GitPill({ sessionId, t }: PillProps): JSX.Element | null {
  const view = useGitView(sessionId)
  const tip = useTooltip()

  if (view.state === 'cold' || view.state === 'loading' || view.state === 'no-cwd') return null
  if (view.state === 'error') {
    // Not a git repo: show only the directory name (no "not a git repo" text);
    // full path in the tooltip. Other errors: a dim degraded label.
    if (view.error.code === 'not-a-git-repo') {
      const cwd = view.error.cwd
      if (cwd === undefined || cwd === '') return null
      return h('span', { className: 'gp-pill-wrap' }, [
        h('span', { key: 'p', className: 'gp-pill gp-pill--plain', ref: tip.bind.ref, onMouseEnter: tip.bind.onMouseEnter, onMouseLeave: tip.bind.onMouseLeave },
          h('span', { className: 'gp-pill__repo' }, basename(cwd))),
        tip.render([cwd]),
      ])
    }
    return h('span', { className: 'gp-pill gp-pill--degraded', title: view.error.detail ?? t('pill.unavailable') }, t('pill.unavailable'))
  }

  const snap = view.snapshot
  const repo = basename(snap.root)
  const branch = snap.branch ?? `(${t('pill.detached')})`
  const dirty = snap.dirty
  const gitClass = dirty ? 'gp-pill__git--dirty' : 'gp-pill__git--synced'

  const onClick = (): void => {
    if (sessionId !== undefined && sessionId !== '') {
      requestSubTab(sessionId, dirty ? 'changes' : 'overview')
    }
    activateGitTab(t('panel.tab'))
  }

  return h('span', { className: 'gp-pill-wrap' }, [
    h('button', {
      key: 'btn', type: 'button', className: 'gp-pill', onClick,
      ref: tip.bind.ref, onMouseEnter: tip.bind.onMouseEnter, onMouseLeave: tip.bind.onMouseLeave,
    }, [
      h('span', { key: 'repo', className: 'gp-pill__repo' }, repo),
      h('span', { key: 'git', className: `gp-pill__git ${gitClass}` }, [
        '(',
        h('span', { key: 'b', className: 'gp-pill__branch' }, branch),
        ')',
      ]),
    ]),
    tip.render([snap.root, dirty ? t('pill.dirty') : t('pill.synced')]),
  ])
}
