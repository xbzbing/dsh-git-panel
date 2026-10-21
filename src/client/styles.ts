/**
 * Global stylesheet, injected once into a plugin-owned <style data-plugin> tag.
 * All colors use dsh theme CSS variables so light/dark themes stay consistent.
 *
 * The rules live in ./css/, one module per feature area. CSS_PARTS is the
 * cascade: modules are concatenated in that array's order, so a later module
 * overrides an earlier one, and a rule that must win belongs in a module after
 * the one it overrides. `stylesheet.test.mjs` pins the parts, their order and
 * the join, because none of that is visible in the rendered result until two
 * rules collide.
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

/**
 * The sheet's modules in cascade order. Exported (and re-exported through the
 * test barrel) so `test/unit/stylesheet.test.mjs` can assert that the assembled
 * sheet is exactly these pieces in this order — dropping one, reordering them
 * or swapping the separator changes which rule wins, silently.
 */
export const CSS_PARTS: ReadonlyArray<readonly [string, string]> = [
  ['base', BASE], ['overview', OVERVIEW], ['changes', CHANGES], ['diff', DIFF],
  ['modal', MODAL], ['actions', ACTIONS], ['config', CONFIG], ['layout', LAYOUT],
  ['stacked', STACKED],
]

/**
 * The assembled sheet. Exported (through the test barrel) so a test can pin the
 * assembly itself: the parts, their order and the join must be the only inputs.
 */
export const STYLESHEET = CSS_PARTS.map(([, part]) => part).join('')

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
  tag.textContent = STYLESHEET
  document.head.appendChild(tag)
  injected = true
}
