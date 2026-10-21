/**
 * compact 与共享布局：紧凑 tabbar / 返回条 / 单栏 / 阅读器 / 抽屉 / 触摸 / 缩放。
 *
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的，同一模块内越靠后的规则越优先。要让新规则赢过某条既有规则，
 * 就写在它所在的模块之后。颜色一律走 --dsw-alias-* 变量，深浅色主题才一致。
 */
export const CSS = `
/* ===================================================================
 * Compact (mobile / narrow-split) layout
 * The panel root carries data-layout="compact" at or below COMPACT_BP
 * (layout.ts). The three-column tabs collapse to a single column that
 * drills from a list into a detail/diff/preview with a back button; the
 * branch filter moves into a bottom sheet. All rules below hang off the
 * attribute, so the wide layout is byte-for-byte unchanged. Portaled
 * surfaces (modal, sheet) sit outside .gp-panel and are keyed off their
 * own classes / viewport media queries instead.
 * =================================================================== */

/* Tab bar: one row. Compact shows the short tab labels (Git / 变更 / 文件)
 * and drops the font stepper + version cluster entirely (the font step lives
 * on the plugin config page). The long labels are swapped for short ones in
 * Panel.tsx; nothing is clipped.
 * Keep the platform track's grey module background and sliding indicator (the
 * animation is transform on the indicator); only tighten the paddings so the
 * short labels get more of the row width. */
.gp-panel[data-layout="compact"] .gp-tabbar__tabs{flex:1 1 auto;padding:2px;border-radius:8px}
.gp-panel[data-layout="compact"] .gp-tabbar__tabs--single{flex:0 0 auto}
/* Indicator width is an inline calc((100% - 8px) / n) from the primitive.
 * Platform DOM contract pinned here: the indicator is a DIRECT span child with
 * aria-hidden and that inline width — if the primitive wraps it or changes the
 * width formula, compact indicator geometry breaks silently (watch the e2e). */
.gp-panel[data-layout="compact"] .gp-tabbar__tabs>span[aria-hidden="true"]{inset:2px auto 2px 2px;width:calc((100% - 4px) / 3) !important}
.gp-panel[data-layout="compact"] .gp-tabbar__tabs--single>span[aria-hidden="true"]{width:calc(100% - 4px) !important}
/* Slightly shorter cells + less side padding so "Overview" fits on a phone. */
.gp-panel[data-layout="compact"] .gp-tabbar__tabs>[role="tab"]{height:30px;padding:0 8px;font-size:12px}
.gp-panel[data-layout="compact"] .gp-tabbar__trailing{display:flex;flex:none;align-items:center;margin-left:auto}

/* Shared drill-in back bar (overview detail / files preview). The Changes
 * diff and Files bar reuse just the .gp-subhead__back button inline. */
.gp-subhead{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.gp-subhead__back{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;flex:none;white-space:nowrap}
.gp-subhead__back:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-subhead__back:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
/* Compact drill-in back buttons (返回列表 / 返回文件树 / 返回变更列表) match the
 * 30px control height of the history toolbar's branch-filter pill. */
.gp-panel[data-layout="compact"] .gp-subhead__back{height:30px}
/* The compact commit-detail header carries the change summary on the back
 * button's row: the summary drops its own hairline/padding and takes the
 * trailing edge, clipped (never wrapped) when the counts run long. */
.gp-panel[data-layout="compact"] .gp-detail__summary--inline{margin:0 0 0 auto;padding:0;border-bottom:0;min-width:0;overflow:hidden}
.gp-panel[data-layout="compact"] .gp-detail__summary--inline>span{white-space:nowrap}

/* Overview: single column, each pane fills width + height. */
.gp-overview--compact{flex-direction:column}
.gp-overview--compact .gp-col{width:100%}
/* The drill pane grows; the footer status bar keeps its own height below it. */
.gp-overview--compact>.gp-col{flex:1 1 auto;min-height:0;height:auto}
/* Two-line commit rows: subject on top, hash·author·time below; the graph
 * cell stretches to the taller row so lane edges still connect. */
.gp-commit-row--compact{align-items:stretch}
.gp-commit-lines{display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0}
.gp-commit-row--compact .gp-commit-subject{font-size:13px}
.gp-commit-sub{display:flex;align-items:center;gap:8px;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gp-commit-row--compact .gp-commit-author{min-width:0;overflow:hidden;text-overflow:ellipsis}
.gp-commit-row--compact .gp-commit-date{flex:none}

/* Changes / Files: the single visible pane takes the full width. */
.gp-changes--compact .gp-changes__left,
.gp-changes--compact .gp-changes__right{flex:1 1 100%;min-width:0;width:100%}
.gp-files--compact .gp-files__tree-wrap,
.gp-files--compact .gp-files__preview{flex:1 1 100%;min-width:0;width:100%}

/* Fullscreen reader: the tab's live preview restyled in place — nothing is
 * re-rendered, so a rendered HTML document keeps its frame and a code view
 * keeps its scroll position. The card is fixed rather than portaled (moving
 * the node would reload the frame), so it depends on no ancestor creating a
 * containing block (transform, filter, contain: paint) and on the backdrop
 * sitting below it in document order. */
.gp-files .gp-files__preview--full{position:fixed;inset:0;margin:auto;z-index:1000;width:min(920px,86vw);height:min(680px,82vh);min-width:0;max-height:100vh;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:14px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.32),0 4px 12px rgba(0,0,0,.18);animation:gp-modal-in .18s cubic-bezier(.16,1,.3,1)}
.gp-files__fs-backdrop{position:fixed;inset:0;z-index:999;background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 62%,transparent);animation:gp-fade-in .12s ease}
.gp-files__fs-screen{flex:none}


/* Image compare stacks vertically in compact: two ~195px columns are unusable
 * on a phone. The single-image before/after mode keeps its full-height row.
 * The portaled diff modal lives outside .gp-panel, so it keeps side-by-side
 * (near-fullscreen at small viewports, where two columns still fit). */
.gp-panel[data-layout="compact"] .gp-imgcmp:not(.gp-imgcmp--single){grid-template-columns:1fr;grid-template-rows:1fr 1fr}

/* Bottom sheet (compact branch/ref filter): slides up from the bottom edge,
 * portaled over the panel. Honors the home-indicator safe area. */
.gp-sheet-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:flex-end;background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 50%,transparent);animation:gp-fade-in .12s ease}
.gp-sheet{display:flex;flex-direction:column;width:100%;max-height:72vh;background:var(--dsw-alias-bg-layer-2);border-radius:16px 16px 0 0;box-shadow:0 -12px 40px rgba(0,0,0,.3);animation:gp-sheet-up .22s cubic-bezier(.16,1,.3,1);padding-bottom:env(safe-area-inset-bottom)}
@keyframes gp-sheet-up{from{transform:translateY(100%)}to{transform:none}}
.gp-sheet__bar{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.gp-sheet__title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.gp-sheet__close{margin-left:auto;flex:none}
.gp-sheet__body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px 0}
.gp-sheet__body .gp-branch-row{padding-top:8px;padding-bottom:8px}

/* Touch devices (independent of width — e.g. a tablet in landscape): no hover
 * means row actions must stay visible, and hit targets grow. */
@media (hover:none){
  .gp-file-row__actions{visibility:visible}
  .gp-icon-btn{width:34px;height:34px}
  .gp-btn{height:36px}
  .gp-tree-row{padding-top:7px;padding-bottom:7px}
  .gp-branch-row{padding-top:8px;padding-bottom:8px}
  .gp-branch-row__switch{display:inline-block;height:26px;line-height:24px;padding:0 10px;margin-block:-4px}
}

/* Diff modal on a small viewport (it is portaled outside .gp-panel, so this is
 * keyed on the viewport, not the panel attribute): near-fullscreen, wrapping
 * toolbar. The base rule already uses vw/vh, so this only tightens the fit.
 * The tall height applies to the full-size diff modal only — small confirm
 * dialogs (.gp-modal--sm) stay content-sized, and the vertical inset leaves a
 * tappable backdrop strip above/below the diff modal. The --sm override states
 * height only: its base max-height:min(560px,86vh) already fits inside
 * viewport-48px at every phone height, and re-declaring it here would raise the
 * content cap to 100dvh-48px (~796px at 390×844). */
@media (max-width:640px){
  .gp-modal-backdrop{padding:24px 12px}
  .gp-modal{width:96vw;height:min(90dvh,calc(100dvh - 48px));border-radius:12px}
  .gp-modal--sm{height:auto}
  .gp-modal__bar{flex-wrap:wrap;row-gap:6px}
  .gp-diff--card{width:96vw;height:min(90dvh,calc(100dvh - 48px));border-radius:12px}
}

/* Image zoom: relative wrapper + native-scroll viewport (the viewport class
 * supplies background/padding) + a floating zoom bar. Centering runs through
 * margin:auto — justify-content:center would make the overflow side of an
 * oversized image unreachable. */
.gp-zoom{position:relative;display:flex;flex:1;min-width:0;min-height:0}
.gp-zoom__scroll{flex:1;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex}
/* flex:none is load-bearing: as a flex item a replaced element's automatic
 * minimum size is its natural size, so without it flex-shrink pins the rendered
 * image at max(natural, viewport) and zooming past 100% silently does nothing. */
.gp-zoom__img{display:block;flex:none;margin:auto;max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-in}
/* Zoomed content is draggable with the mouse (see ImageZoom's drag-to-pan); the
 * grab cursor replaces the zoom-in hint once a drag can actually pan. */
.gp-zoom[data-zoomed="true"] .gp-zoom__scroll,.gp-zoom[data-zoomed="true"] .gp-zoom__img{cursor:grab}
.gp-zoom[data-dragging="true"] .gp-zoom__scroll,.gp-zoom[data-dragging="true"] .gp-zoom__img{cursor:grabbing;user-select:none}
.gp-zoom__bar{position:absolute;right:10px;bottom:10px;display:flex;align-items:center;gap:2px;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 4px 14px rgba(0,0,0,.18)}
.gp-zoom__btn{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:24px;padding:0 7px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer}
.gp-zoom__btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gp-zoom__btn--text{font-size:11px;padding:0 9px;white-space:nowrap}
.gp-zoom__btn[aria-pressed="true"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}
.gp-zoom__pct{min-width:50px;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;font-variant-numeric:tabular-nums}
/* Fullscreen zoom lightbox; mirrors the platform ImageLightbox contract. */
.gp-zl-backdrop{position:fixed;inset:0;z-index:1000}
.gp-zl-stage{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;display:flex;align-items:center;justify-content:center;padding:40px}
.gp-zl-mask{position:absolute;inset:0;background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 62%,transparent);backdrop-filter:blur(2px);animation:gp-fade-in .12s ease}
.gp-zl-frame{position:relative;flex:1;height:100%;max-width:min(100%,1600px);min-width:0;display:flex}
/* The viewport carries .gp-zoom__scroll too, so only the img frame styling lives here. */
.gp-zl-viewport img{border-radius:var(--dsw-radius-lg);box-shadow:0 8px 40px rgba(0,0,0,.5)}
.gp-zl-close{position:absolute;top:20px;right:20px;z-index:1;display:grid;place-items:center;width:36px;height:36px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.gp-zl-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-zl-close:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:3px}
@media (prefers-reduced-motion:reduce){
  .gp-sheet,.gp-sheet-backdrop,.gp-modal,.gp-modal-backdrop,.gp-zl-mask,.gp-files__html-mask,.gp-files__fs-backdrop,.gp-files__preview--full,.gp-diff--card,.gp-diff-backdrop{animation:none;transition:none}
}
`
