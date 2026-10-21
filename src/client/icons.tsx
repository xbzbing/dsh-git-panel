/** Minimal inline SVG icons (currentColor). */
import { createElement as h } from 'react'
import type { JSX } from 'react'

/** Glyph props. `className` lets a host (e.g. the sidebar guide card) apply
 * its own alignment or theme classes; dropping it would break that styling. */
interface IconProps { readonly size?: number; readonly className?: string }
export type SyncDirection = 'ahead' | 'behind'

/** Shared glyphs: the tag outline and the star, reused by the branch-row icons. */
const TAG_PATH = 'M2 7V3h4l8 8-4 4z'
const STAR_PATH = 'M8 1.8l1.76 3.57 3.94.57-2.85 2.78.67 3.92L8 10.78l-3.52 1.85.67-3.92L2.3 5.94l3.94-.57z'

/** `hidden` marks a purely decorative glyph: its label lives on the wrapper. */
function svg(path: JSX.Element | JSX.Element[], size = 15, hidden = false, className?: string): JSX.Element {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
    ...(hidden ? { 'aria-hidden': true } : {}),
    ...(className !== undefined ? { className } : {}),
  }, path)
}

export function CommitIcon({ size, className }: IconProps): JSX.Element {
  return svg([h('circle', { key: 'c', cx: 8, cy: 8, r: 2.4 }), h('line', { key: 'l1', x1: 8, y1: 1.5, x2: 8, y2: 5.6 }), h('line', { key: 'l2', x1: 8, y1: 10.4, x2: 8, y2: 14.5 })], size, false, className)
}

export function DiffIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M4 2v8' }), h('path', { key: 'b', d: 'M2 4h4' }), h('circle', { key: 'c', cx: 4, cy: 12, r: 1.6 }), h('circle', { key: 'd', cx: 12, cy: 4, r: 1.6 }), h('path', { key: 'e', d: 'M12 6v4' }), h('path', { key: 'f', d: 'M10 12h4' })], size)
}

export function BranchIcon({ size }: IconProps): JSX.Element {
  return svg([h('circle', { key: 'a', cx: 4, cy: 3, r: 1.6 }), h('circle', { key: 'b', cx: 4, cy: 13, r: 1.6 }), h('circle', { key: 'c', cx: 12, cy: 5, r: 1.6 }), h('path', { key: 'd', d: 'M4 4.6v6.8' }), h('path', { key: 'e', d: 'M12 6.6c0 3-4 2.4-8 4' })], size)
}

function tagGlyph(size: number | undefined, hidden = false): JSX.Element {
  return svg([h('path', { key: 'a', d: TAG_PATH }), h('circle', { key: 'b', cx: 4.5, cy: 5.5, r: 0.8, fill: 'currentColor' })], size, hidden)
}

export function TagIcon({ size }: IconProps): JSX.Element {
  return tagGlyph(size)
}

export function ChevronIcon({ size, open }: IconProps & { open?: boolean }): JSX.Element {
  return svg([h('path', { key: 'a', d: open ? 'M3 6l5 5 5-5' : 'M6 3l5 5-5 5' })], size)
}

export function CloseIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M4 4l8 8M12 4l-8 8' })], size)
}

/** Success mark for the copy confirmation — decorative: the wrapper button
 * carries the label. */
export function CheckIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M3 8.4l3.3 3.3L13 4.8' })], size, true)
}

/** Expand-to-fullscreen glyph: four corner brackets. */
export function FullscreenIcon({ size }: IconProps): JSX.Element {
  return svg([
    h('path', { key: 'a', d: 'M2 6V2h4' }),
    h('path', { key: 'b', d: 'M10 2h4v4' }),
    h('path', { key: 'c', d: 'M14 10v4h-4' }),
    h('path', { key: 'd', d: 'M6 14H2v-4' }),
  ], size)
}

/** Leave-fullscreen glyph: the same brackets turned inward. */
export function ExitFullscreenIcon({ size }: IconProps): JSX.Element {
  return svg([
    h('path', { key: 'a', d: 'M6 2v4H2' }),
    h('path', { key: 'b', d: 'M14 6h-4V2' }),
    h('path', { key: 'c', d: 'M10 14v-4h4' }),
    h('path', { key: 'd', d: 'M2 10h4v4' }),
  ], size)
}

/** Unfold-all glyph: chevrons opening up and down — expand the diff context. */
export function ExpandAllIcon({ size }: IconProps): JSX.Element {
  return svg([
    h('path', { key: 'u', d: 'M4.5 6.5L8 3l3.5 3.5' }),
    h('path', { key: 'd', d: 'M4.5 9.5L8 13l3.5-3.5' }),
  ], size)
}

/** Soft-return arrow: three text lines wrapping onto a fourth. */
export function WrapIcon({ size }: IconProps): JSX.Element {
  return svg([
    h('path', { key: 'a', d: 'M2 3.5h12' }),
    h('path', { key: 'b', d: 'M2 7.5h12' }),
    h('path', { key: 'c', d: 'M2 11.5h7' }),
    h('path', { key: 'd', d: 'M2 11.5c0 2 1.5 3 3.5 3H10' }),
  ], size)
}

/** Left-pointing arrow for the compact drill-in back button. */
export function ArrowLeftIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M10 3L5 8l5 5' }), h('path', { key: 'b', d: 'M5 8h8' })], size)
}

/** Funnel glyph for the compact branch/ref filter trigger. */
export function FilterIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M2 3h12l-4.5 5.5V13L6.5 11V8.5z' })], size)
}

/** A stack of changes with a plus/minus for staging or unstaging all files. */
export function StageAllIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'stack', d: 'M2 3h8M2 6h6M2 9h4' }), h('path', { key: 'plus', d: 'M11 8v6M8 11h6' })], size, true)
}

export function UnstageAllIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'stack', d: 'M2 3h8M2 6h6M2 9h4' }), h('path', { key: 'minus', d: 'M8 11h6' })], size, true)
}

export function RefreshIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M13 8a5 5 0 1 1-1.5-3.5' }), h('path', { key: 'b', d: 'M13 2v3h-3' })], size)
}

/** Four-point sparkle (the AI-suggest action). */
export function SparkleIcon({ size }: IconProps): JSX.Element {
  return svg([
    h('path', { key: 'a', d: 'M8 2.6l1.4 4 4 1.4-4 1.4-1.4 4-1.4-4-4-1.4 4-1.4z' }),
    h('path', { key: 'b', d: 'M13 11.6v2.8M11.6 13h2.8' }),
  ], size)
}

export function FileIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M4 2h5l3 3v9H4z' }), h('path', { key: 'b', d: 'M9 2v3h3' })], size)
}

/** Folder glyph marking a ref directory row (a group of refs, not a file). */
export function FolderIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M2 12.5V3.5h4l1.5 2H14v7z' })], size)
}

/** Archive box glyph for the stash action. */
export function StashIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M2 5.5h12V13H2z' }), h('path', { key: 'b', d: 'M1.5 3h13v2.5h-13z' }), h('path', { key: 'c', d: 'M6.5 8.5h3' })], size)
}

/** Trash glyph for destructive delete (tag / stash drop). */
export function TrashIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M3 4.5h10' }), h('path', { key: 'b', d: 'M5.5 4.5V3h5v1.5' }), h('path', { key: 'c', d: 'M4.5 4.5l.7 9h5.6l.7-9' })], size)
}

/** Trash glyph with motion lines: "discard every change" (toolbar bulk entry). */
export function TrashAllIcon({ size }: IconProps): JSX.Element {
  return svg([
    h('path', { key: 'a', d: 'M3 4.5h10' }),
    h('path', { key: 'b', d: 'M5.5 4.5V3h5v1.5' }),
    h('path', { key: 'c', d: 'M4.5 4.5l.7 9h5.6l.7-9' }),
    h('path', { key: 'd', d: 'M1.5 6.5h1.2' }),
    h('path', { key: 'e', d: 'M13.3 6.5h1.2' }),
  ], size)
}

/** Curved undo arrow for revert (append a reverse commit). */
export function RevertIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M3 7a5 5 0 1 1 1.3 3.4' }), h('path', { key: 'b', d: 'M3 3.5V7h3.5' })], size)
}

/** Rewind-to-marker glyph for reset (move HEAD back to a commit). */
export function ResetIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M13 3v10' }), h('path', { key: 'b', d: 'M10.5 8L3 3.5v9z', fill: 'currentColor' })], size)
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

/** Download / pull glyph (fetch remote commits down into the branch). */
export function DownloadIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M8 2.5v7' }), h('path', { key: 'b', d: 'M4.5 7L8 10.5 11.5 7' }), h('path', { key: 'c', d: 'M3 13h10' })], size)
}

/** Upward arrow over a baseline — the push/publish (upload) action. */
export function UploadIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M8 10.5v-7' }), h('path', { key: 'b', d: 'M4.5 6L8 2.5 11.5 6' }), h('path', { key: 'c', d: 'M3 13h10' })], size)
}

/** Two-arrow sync glyph for the status-check action. */
export function SyncIcon({ size }: IconProps): JSX.Element {
  return svg([h('path', { key: 'a', d: 'M12.5 7a4.5 4.5 0 0 0-8-2.3' }), h('path', { key: 'b', d: 'M3.5 9a4.5 4.5 0 0 0 8 2.3' }), h('path', { key: 'c', d: 'M4.3 2.2v2.5h2.5' }), h('path', { key: 'd', d: 'M11.7 13.8v-2.5H9.2' })], size)
}

/** Circled "i" — the file-properties entry in the preview toolbar. */
export function InfoIcon({ size }: IconProps): JSX.Element {
  return svg([h('circle', { key: 'a', cx: 8, cy: 8, r: 6 }), h('path', { key: 'b', d: 'M8 7.2v3.6' }), h('circle', { key: 'c', cx: 8, cy: 5.2, r: 0.5, fill: 'currentColor', stroke: 'none' })], size)
}

/** Five-point star glyph. `filled` paints it solid (the "starred" state). */
export function StarIcon({ size = 15, filled }: IconProps & { filled?: boolean }): JSX.Element {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16',
    fill: filled ? 'currentColor' : 'none', stroke: 'currentColor',
    strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
  }, h('path', { d: STAR_PATH }))
}

/** Tag outline for the checked-out branch row (the tag glyph, named for the row). */
export function BranchCurrentIcon({ size }: IconProps): JSX.Element {
  return tagGlyph(size, true)
}

/** Filled star for the repository's primary branch row. */
export function BranchPrimaryIcon({ size = 15 }: IconProps): JSX.Element {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16',
    fill: 'currentColor', stroke: 'currentColor',
    strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true,
  }, h('path', { d: STAR_PATH }))
}

/**
 * Diagonal sync arrow: `ahead` points up-right, `behind` down-left. The row's
 * wrapper carries the label and the track colour, so the glyph itself only
 * exposes the direction (for styling and tests).
 */
export function BranchSyncIcon({ size, direction }: IconProps & { readonly direction: SyncDirection }): JSX.Element {
  const s = size ?? 15
  const shaft = direction === 'ahead' ? 'M4.5 11.5L11.5 4.5' : 'M11.5 4.5L4.5 11.5'
  const head = direction === 'ahead' ? 'M6.5 4.5h5v5' : 'M9.5 11.5h-5v-5'
  return h('svg', {
    className: 'gp-branch-row__sync-icon', 'data-direction': direction,
    width: s, height: s, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true,
  }, [h('path', { key: 'a', d: shaft }), h('path', { key: 'b', d: head })])
}
