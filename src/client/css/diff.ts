/**
 * diff 视图：工具栏 / 路径复制 / 滚动区 / seg / 展开 / 换行。
 *
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的，同一模块内越靠后的规则越优先。要让新规则赢过某条既有规则，
 * 就写在它所在的模块之后。颜色一律走 --dsw-alias-* 变量，深浅色主题才一致。
 */
export const CSS = `
/* diff view */
.gp-diff{flex:1;min-height:0;display:flex;flex-direction:column}
.gp-diff__toolbar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
/* Compact diff pane: controls (expand-all + mode seg) live on their own
 * second row — one row cannot fit them at phone widths without the seg
 * buttons wrapping into a squeezed stack. */
.gp-diff__toolbar--compact{flex-wrap:wrap;row-gap:6px}
.gp-diff__toolbar-row{display:flex;align-items:center;gap:8px;min-width:0}
.gp-diff__toolbar-row:first-child{flex:1 1 100%}
.gp-diff__toolbar-row--controls{flex:1 1 100%;flex-wrap:wrap}
.gp-diff__toolbar-row--controls .gp-diff__expand{flex:none}
/* Seg labels never break: the track keeps at least its content width and may
 * wrap below the expand toggle on an ultra-narrow panel instead of squeezing
 * "变更前 / 变更后" into two lines. Buttons stay equal-width while they fit. */
.gp-diff__toolbar-row--controls .gp-seg{flex:1 1 auto;min-width:max-content}
.gp-diff__toolbar-row--controls .gp-seg .gp-seg__btn{flex:1 1 0;min-width:max-content}
/* The filename stays whole: the directory part shrinks first (flex-shrink
 * only applies to it), eliding from its LEFT — a right-to-left run keeps the
 * tail ("…client/OverviewTab.tsx") — and the full relative path rides on the
 * title tooltip. Mirrors what the file-diff modal shows. */
/* The header path IS the copy control: a bare button (reset) whose click
 * writes the relative path to the clipboard. The confirmation never replaces
 * the visible text (a bare text node wraps when the toolbar squeezes the
 * button below the phrase's width): success swaps the directory slot for a
 * check mark and tints the name, failure only tints it. The hover underline
 * is the affordance. Font shorthand first so font-size can re-pin after. */
.gp-diff__path{position:relative;display:flex;align-items:baseline;min-width:0;overflow:hidden;background:none;border:0;padding:0;margin:0;font:inherit;font-size:12px;color:inherit;text-align:left;cursor:pointer;border-radius:4px}
.gp-diff__path:hover .gp-diff__path-name{text-decoration:underline}
.gp-diff__path:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-diff__path--copied{color:var(--dsw-alias-state-success-primary)}
.gp-diff__path--copied svg{margin-right:2px}
.gp-diff__path--copied .gp-diff__path-name{color:var(--dsw-alias-state-success-primary)}
.gp-diff__path--error{color:var(--dsw-alias-state-error-primary)}
.gp-diff__path--error .gp-diff__path-name{color:var(--dsw-alias-state-error-primary)}
/* Visually-hidden live region: the copy confirmation is announced to screen
 * readers without entering the toolbar's layout at all. */
.gp-copy-live{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.gp-diff__path-dir{direction:rtl;unicode-bidi:isolate;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}
.gp-diff__path-sep{flex:none;color:var(--dsw-alias-label-tertiary)}
.gp-diff__path-name{flex:none;color:var(--dsw-alias-label-primary);font-weight:600}
/* Bordered pill only in the segmented context (the overview modal's text
 * button); the toolbar's icon-ified expand is a plain gp-icon-btn like its
 * neighbours, so the two toolbar icons stay visually identical. */
.gp-seg__btn.gp-diff__expand{border:1px solid var(--dsw-alias-border-l2);border-radius:7px}
.gp-diff__expand:disabled{opacity:.45;cursor:not-allowed}
/* The diff enlarged IN PLACE: the same inline .gp-diff node restyled into the
 * card (the fullscreen reader's trick — ADR-0016), so the DiffView never
 * remounts: no second highlight/image pass, no state loss. Geometry mirrors
 * .gp-modal; the backdrop sits at 999, the card at 1000, both portaled-free
 * (fixed positioning escapes the pane — no transform ancestor in the panel). */
.gp-diff--card{position:fixed;inset:0;margin:auto;z-index:1000;width:min(920px,86vw);height:min(680px,82vh);min-width:0;max-height:100vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:14px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.32),0 4px 12px rgba(0,0,0,.18);animation:gp-modal-in .18s cubic-bezier(.16,1,.3,1)}
/* The card's toolbar reads as a modal bar (same padding + surface). */
.gp-diff--card .gp-diff__toolbar{padding:11px 12px 11px 14px;background:var(--dsw-alias-bg-layer-2)}
.gp-diff-backdrop{position:fixed;inset:0;z-index:999;background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 62%,transparent);animation:gp-fade-in .12s ease}
.gp-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.gp-seg__btn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;white-space:nowrap;padding:5px 10px;cursor:pointer;transition:background .12s ease,color .12s ease}
.gp-seg__btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-seg__btn--active{background:var(--dsw-alias-state-business-primary);color:#fff}
.gp-seg__btn--active:hover{background:var(--dsw-alias-state-business-primary)}
.gp-diff__scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;font-family:var(--dsw-font-mono,monospace);font-size:12px}
/* DiffView owns its scroller (the wrap fills the pane, the Find bar sits above
 * the scrolling body) so the row window knows its viewport height on the first
 * paint. */
.gp-diff__wrap{flex:1;min-height:0;display:flex;flex-direction:column}
.gp-diff__wrap .gp-find{flex:none}
/* Height band reserving the rows outside the mounted window; spans every grid
 * column, so it takes a grid row of its own. */
.gp-diff__spacer{pointer-events:none}
.gp-diff__side{display:grid;grid-template-columns:38px 1fr 38px 1fr}
/* unified (inline) layout: old|new line-number gutters + a sign column + one
 * shared code column; add/del tint the whole code cell, not one side. */
.gp-diff__unified{display:grid;grid-template-columns:38px 38px 18px 1fr}
/* before/after single column: one line-number gutter + code */
.gp-diff__single{display:grid;grid-template-columns:38px 1fr}
.gp-diff-uni__sign{text-align:center;user-select:none;font-size:11px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.gp-diff-uni__sign.gp-diff-row--add{color:var(--dsw-alias-state-success-primary)}
.gp-diff-uni__sign.gp-diff-row--del{color:var(--dsw-alias-state-error-primary)}
.gp-diff-uni__code{box-shadow:none}
.gp-diff-cell{padding:0 4px;white-space:pre-wrap;word-break:break-all;line-height:20px}
.gp-diff-no{color:var(--dsw-alias-label-tertiary);text-align:right;padding:0 5px;user-select:none;font-size:11px;line-height:20px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);border-right:1px solid var(--dsw-alias-border-l2)}
.gp-diff-row--add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 15%,transparent);box-shadow:inset 2px 0 0 color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,transparent)}
.gp-diff-row--del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 15%,transparent);box-shadow:inset 2px 0 0 color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}
.gp-diff-row--hunk{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent);color:var(--dsw-alias-state-business-primary);padding:3px 8px;font-size:11px;font-weight:600;border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2)}
/* collapsed-context band with expand controls (spans both sides). A gap is
 * always immediately followed by a hunk header (or the file end), so it omits
 * its own bottom border and lets the hunk's top border be the single divider —
 * otherwise the two 1px borders stack into a fat 2px line. */
.gp-diff-row--gap{display:flex;align-items:center;justify-content:center;gap:6px;padding:2px 10px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent);border-top:1px solid var(--dsw-alias-border-l2)}
.gp-gap__btn{display:inline-flex;align-items:center;height:20px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-business-primary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;transition:background .12s ease}
.gp-gap__btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-gap__btn:disabled{opacity:.55;cursor:default}
/* word-level intra-line change emphasis: a deeper add/del tint over the row
 * background so the exact changed tokens stand out. */
.gp-diff-word{border-radius:3px;padding:0 1px}
.gp-diff-word--add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 38%,transparent)}
.gp-diff-word--del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,transparent)}
/* image comparison: old/new panes (split) or one pane (before/after) */
.gp-imgcmp{display:grid;grid-template-columns:1fr 1fr;gap:1px;height:100%;background:var(--dsw-alias-border-l2)}
.gp-imgcmp--single{grid-template-columns:1fr}
.gp-imgcmp__pane{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dsw-alias-bg-layer-2)}
.gp-imgcmp__head{flex:none;padding:4px 10px;font-size:11px;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-imgcmp__img{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;align-items:flex-start;justify-content:flex-start;padding:10px;background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(45deg,color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent) 25%,transparent 25%,transparent 50%,color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent) 50%,color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent) 75%,transparent 75%);background-size:16px 16px}
.gp-imgcmp__img img{max-width:100%;max-height:100%;object-fit:contain;image-rendering:auto}
.gp-imgcmp__missing{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:12px;background:var(--dsw-alias-bg-layer-1)}
/* SVG diff: render/source toggle bar above the rendered comparison or source diff */
.gp-svgdiff{display:flex;flex-direction:column;height:100%;min-height:0}
.gp-svgdiff__bar{flex:none;display:flex;justify-content:flex-end;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-svgdiff__body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.gp-feedback{padding:6px 10px;font-size:12px;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);display:flex;align-items:center;gap:8px}
/* Dismissible error banner: the message line is centred on a one-line banner;
 * when the message wraps, the close control drops to the bottom-right corner. */
.gp-feedback--dismissible .gp-feedback__close{align-self:flex-end}
.gp-feedback__text{flex:1 1 auto;min-width:0}
.gp-feedback__close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;opacity:.75}
.gp-feedback__close:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover)}
.gp-feedback__close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-notice{padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);display:flex;align-items:center;gap:8px}
/* Dismissible banner: the text takes the free width, the close button pins right. */
.gp-notice__text{flex:1 1 auto;min-width:0}
.gp-notice__close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:-2px -4px -2px 0;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.gp-notice__close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gp-notice__close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
`
