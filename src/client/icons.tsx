/** Minimal inline SVG icons (currentColor). */
import { createElement as h } from 'react'
import type { JSX } from 'react'

interface IconProps { readonly size?: number }

function svg(path: JSX.Element | JSX.Element[], size = 15): JSX.Element {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }, path)
}

export function CommitIcon({ size }: IconProps): JSX.Element {
  return svg([h('circle', { key: 'c', cx: 8, cy: 8, r: 2.4 }), h('line', { key: 'l1', x1: 8, y1: 1.5, x2: 8, y2: 5.6 }), h('line', { key: 'l2', x1: 8, y1: 10.4, x2: 8, y2: 14.5 })], size)
}

export function DiffIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M4 2v8' }), h('path', { key: 'b', d: 'M2 4h4' }), h('circle', { key: 'c', cx: 4, cy: 12, r: 1.6 }), h('circle', { key: 'd', cx: 12, cy: 4, r: 1.6 }), h('path', { key: 'e', d: 'M12 6v4' }), h('path', { key: 'f', d: 'M10 12h4' })], size)
}

export function BranchIcon({ size }: IconProps): JSX.Element {
  return svg([h('circle', { key: 'a', cx: 4, cy: 3, r: 1.6 }), h('circle', { key: 'b', cx: 4, cy: 13, r: 1.6 }), h('circle', { key: 'c', cx: 12, cy: 5, r: 1.6 }), h('path', { key: 'd', d: 'M4 4.6v6.8' }), h('path', { key: 'e', d: 'M12 6.6c0 3-4 2.4-8 4' })], size)
}

export function TagIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M2 7V3h4l8 8-4 4z' }), h('circle', { key: 'b', cx: 4.5, cy: 5.5, r: 0.8, fill: 'currentColor' })], size)
}

export function ChevronIcon({ size, open }: IconProps & { open?: boolean }): JSX.Element {
  return svg([h('path', { key: 'a', d: open ? 'M3 6l5 5 5-5' : 'M6 3l5 5-5 5' })], size)
}

export function CloseIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M4 4l8 8M12 4l-8 8' })], size)
}

export function RefreshIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.5-3.5' }), h('path', { key: 'b', d: 'M13 2v3h-3' })], size)
}

export function FileIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M4 2h5l3 3v9H4z' }), h('path', { key: 'b', d: 'M9 2v3h3' })], size)
}

export function FolderIcon({ size, open }: IconProps & { open?: boolean }): JSX.Element {
  return open
    ? svg([h('path', { key: 'a', d: 'M2 4.5h4l1.4 1.5H14v1H2z' }), h('path', { key: 'b', d: 'M2 7h12l-1.2 6.5H3.2z' })], size)
    : svg([h('path', { key: 'a', d: 'M2 4.5h4l1.4 1.5H14v7H2z' })], size)
}

export function FilesIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M5 2.5h4l2.5 2.5v7.5h-6.5z' }), h('path', { key: 'b', d: 'M9 2.5V5h2.5' }), h('path', { key: 'c', d: 'M11 12.5v1.5h-6.5V6' })], size)
}

/** GitHub mark (filled, currentColor). */
export function GitHubIcon({ size = 15 }: IconProps): JSX.Element {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor' },
    h('path', {
      'fill-rule': 'evenodd',
      d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z',
    }),
  )
}
