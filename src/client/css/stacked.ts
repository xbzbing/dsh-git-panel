/**
 * 侧栏 stacked：tabbar / 行分隔条 / 上下两 band 三页签。
 *
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的，同一模块内越靠后的规则越优先。要让新规则赢过某条既有规则，
 * 就写在它所在的模块之后。颜色一律走 --dsw-alias-* 变量，深浅色主题才一致。
 */
export const CSS = `
/* ===================================================================
 * Stacked (tall narrow right-sidebar) layout
 * The panel root carries data-layout="stacked" when mounted in the right
 * sidebar and the box is narrow (panel-fit.ts: compact below COMPACT_BP,
 * or up to SIDEBAR_WIDE_BP where three columns would still be cramped)
 * and not SHORT. The top band keeps the wide layout's first two columns
 * (branch list | history); the third pane spans the width below it, so
 * nothing drills. All three stacked surfaces share one drag-adjustable
 * top/bottom ratio (useStackedSplit, default 55%). Controls are all
 * visible at pointer density — this is a PC surface, not a touch one.
 * Portaled surfaces (modal, sheet) are unchanged and stay keyed off
 * their own classes.
 * =================================================================== */

/* Tab bar: stacked is narrow like compact, so it shares the tightened
 * track rules (the primitive's indicator is a DIRECT span child with an
 * inline calc width — same platform DOM contract as compact above).
 * The trailing font stepper stays; the version cluster has no room
 * (Panel.tsx drops it). */
.gp-panel[data-layout="stacked"] .gp-tabbar__tabs{flex:1 1 auto;padding:2px;border-radius:8px}
.gp-panel[data-layout="stacked"] .gp-tabbar__tabs--single{flex:0 0 auto}
.gp-panel[data-layout="stacked"] .gp-tabbar__tabs>span[aria-hidden="true"]{inset:2px auto 2px 2px;width:calc((100% - 4px) / 3) !important}
.gp-panel[data-layout="stacked"] .gp-tabbar__tabs--single>span[aria-hidden="true"]{width:calc(100% - 4px) !important}
.gp-panel[data-layout="stacked"] .gp-tabbar__tabs>[role="tab"]{height:30px;padding:0 8px;font-size:12px}
.gp-panel[data-layout="stacked"] .gp-tabbar__trailing{display:flex;flex:none;align-items:center;margin-left:auto}

/* The shared top/bottom drag divider. The inline flex basis from
 * useStackedSplit overrides the 55% CSS defaults below; 55% here is the
 * pre-first-drag fallback and matches the hook's initial value. */
.gp-resizer--row{flex:0 0 5px;position:relative;cursor:row-resize;touch-action:none;user-select:none}
/* Every state declares the WHOLE box: the vertical divider's rules are more
 * specific in hover (left:1px;width:3px) and would otherwise collapse this
 * line to a stub at one end — same cascade trap as width:auto above. */
.gp-resizer--row::before{content:"";position:absolute;left:0;right:0;width:auto;top:2px;bottom:auto;height:1px;background:var(--dsw-alias-border-l2)}
.gp-resizer--row:hover::before,.gp-resizer--row:active::before{left:0;right:0;width:auto;bottom:auto;top:1px;height:3px;background:var(--dsw-alias-state-business-primary)}
/* Icon-only diff toolbar buttons carry state through aria-pressed (the
 * expand-all toggle); tint it like the zoom bar's pressed buttons. */
.gp-diff__toolbar .gp-icon-btn[aria-pressed="true"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}

/* Overview: top band (branch list | history) over the full-width detail.
 * The band's flex bases are HEIGHT here (the band is a column child of the
 * stacked root); the left column's clamp inside the band is WIDTH. */
.gp-overview--stacked{flex-direction:column}
.gp-overview__top{display:flex;flex:0 0 55%;min-height:0}
.gp-overview--stacked .gp-col--left{flex:0 0 clamp(120px,38%,180px);min-width:0;border-right:1px solid var(--dsw-alias-border-l2)}
.gp-overview--stacked>.gp-detail{height:auto;flex:1 1 45%;min-height:0}

/* Stacked history toolbar: search takes the first row; the author / since
 * dropdowns and the refresh button share the second, all visible (no more
 * chevron). */
.gp-toolbar--stacked{gap:6px}
.gp-toolbar--stacked .gp-search{flex:1 1 100%}
.gp-toolbar--stacked .gp-select-trigger{flex:1 1 0;min-width:0}
.gp-toolbar--stacked .gp-icon-btn{flex:none}

/* Changes: commit editor + change-list band over the diff pane. Two rows
 * for the commit message — stacked already spends less of the band on the
 * editor, and the list wants the room. */
.gp-changes--stacked{flex-direction:column}
.gp-changes--stacked .gp-changes__left{flex:0 0 55%;min-height:0;min-width:0;width:100%}
.gp-changes--stacked .gp-changes__right{flex:1 1 0;min-height:0;min-width:0;width:100%}
.gp-panel[data-layout="stacked"] .gp-commitbox__msg{min-height:48px}

/* Files: tree band over the preview pane. The :not() is load-bearing: the
 * fullscreen reader is the SAME element with an extra --full class, and this
 * rule is later in the sheet — without the guard its width:100% would beat
 * the reader's fixed min(920px,86vw) card and blow it up to fill the box. */
.gp-files--stacked{flex-direction:column}
.gp-files--stacked .gp-files__tree-wrap{flex:0 0 55%;min-height:120px;min-width:0;width:100%}
.gp-files--stacked .gp-files__preview:not(.gp-files__preview--full){flex:1 1 0;min-height:0;min-width:0;width:100%}
`
