/**
 * Global stylesheet, injected once into a plugin-owned <style data-plugin> tag.
 * All colors use dsh theme CSS variables so light/dark themes stay consistent.
 *
 * The rules live in ./css/, one module per feature area, in cascade order: the
 * pieces are concatenated exactly as they were written, because later rules
 * deliberately win over earlier ones (see the compact / stacked overrides in
 * layout.ts and stacked.ts). Each module's literal carries its own leading and
 * trailing newline, so a plain join reproduces the original sheet byte for byte.
 */
import { CSS as BASE } from './css/base.js'
import { CSS as OVERVIEW } from './css/overview.js'
import { CSS as CHANGES } from './css/changes.js'
import { CSS as DIFF } from './css/diff.js'
import { CSS as MODAL } from './css/modal.js'
import { CSS as ACTIONS } from './css/actions.js'
import { CSS as CONFIG } from './css/config.js'
import { CSS as LAYOUT } from './css/layout.js'
import { CSS as STACKED } from './css/stacked.js'

const CSS = [
  BASE, OVERVIEW, CHANGES, DIFF, MODAL, ACTIONS, CONFIG, LAYOUT, STACKED,
].join('')

let injected = false

/** Inject the plugin stylesheet once (idempotent, browser-only). */
export function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return
  const id = 'dsh-git-panel/client.css'
  if (document.querySelector(`style[data-plugin-css="${id}"]`) !== null) { injected = true; return }
  const tag = document.createElement('style')
  // data-plugin 必须等于 loader row id（安装的包名），平台侧样式回收按它定位。
  tag.dataset.plugin = '@xbzbing/dsh-git-panel'
  tag.dataset.pluginCss = id
  tag.textContent = CSS
  document.head.appendChild(tag)
  injected = true
}
