/**
 * Old/new image panes for a binary image diff. Side-by-side in split mode,
 * single pane in before/after mode; a side that does not exist (added,
 * untracked, deleted) shows a placeholder instead of an image.
 *
 * Each pane carries a right-click menu of the platform's image actions (copy,
 * download, save as). The target is a data URL with no workspace path: the old
 * side is not a file in the work tree, and attaching a path would make the
 * platform's "reveal" point at the wrong (or a missing) file. The download name
 * of the old side carries the revision it was read from, so saving both panes
 * does not overwrite one with the other.
 */
import { createElement as h, useContext } from 'react'
import type { JSX } from 'react'
import type { DiffMode } from './views/diff/diff-types.js'
import type { GitKey } from './locales.js'
import { ZoomableImage } from './ImageZoom.js'
import { PanelMenuContext } from './menu-context.js'
import { revisionName } from './menu-paths.js'
import type { ImageMenuBinder } from './menu-bindings.js'
import type { MenuTriggerHandlers } from './menu-types.js'

interface ImageCompareProps {
  readonly oldUrl?: string
  readonly newUrl?: string
  readonly mode: DiffMode
  readonly t: (key: GitKey, params?: Record<string, string | number>) => string
  /** The file the two panes show; names the downloads. */
  readonly path?: string
  /** Label of the old side (short hash, `HEAD`, `staged`); omitted when unknown. */
  readonly oldLabel?: string
}

/** Bound props for one pane, or undefined when the panel offers no menus. */
function menuFor(
  binder: ImageMenuBinder | undefined, side: 'before' | 'after', url: string | undefined,
  path: string | undefined, oldLabel: string | undefined,
): MenuTriggerHandlers | undefined {
  if (binder === undefined || url === undefined) return undefined
  const name = path === undefined
    ? undefined
    : side === 'before' && oldLabel !== undefined ? revisionName(path, oldLabel) : path.slice(path.lastIndexOf('/') + 1)
  return binder({ url, ...(name === undefined ? {} : { name }) }, { tabIndex: -1 })
}

function pane(
  side: 'before' | 'after', url: string | undefined, t: ImageCompareProps['t'],
  menuProps: MenuTriggerHandlers | undefined,
): JSX.Element {
  const label = t(`diff.${side}` as GitKey)
  return h('div', { className: `gp-imgcmp__pane gp-imgcmp__pane--${side}` }, [
    h('div', { key: 'head', className: 'gp-imgcmp__head' }, label),
    url === undefined
      ? h('div', { key: 'missing', className: 'gp-imgcmp__missing' }, t('diff.imageMissing'))
      : h(ZoomableImage, { key: 'img', src: url, alt: label, t, viewportClass: 'gp-imgcmp__img', menuProps }),
  ])
}

export function ImageCompare({ oldUrl, newUrl, mode, t, path, oldLabel }: ImageCompareProps): JSX.Element {
  const binder = useContext(PanelMenuContext)?.image
  const oldProps = menuFor(binder, 'before', oldUrl, path, oldLabel)
  const newProps = menuFor(binder, 'after', newUrl, path, oldLabel)
  if (mode === 'before') return h('div', { className: 'gp-imgcmp gp-imgcmp--single' }, pane('before', oldUrl, t, oldProps))
  if (mode === 'after') return h('div', { className: 'gp-imgcmp gp-imgcmp--single' }, pane('after', newUrl, t, newProps))
  return h('div', { className: 'gp-imgcmp' }, [pane('before', oldUrl, t, oldProps), pane('after', newUrl, t, newProps)])
}
