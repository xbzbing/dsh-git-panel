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
/* Same divisor restatement as compact: stacked carries three panes or one. */
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
 * stacked root); the left column's clamp inside the band is WIDTH. The band
 * is positioned: it is the containing block for the tight drawer and its
 * backdrop that overlay it. */
.gp-overview--stacked{flex-direction:column}
.gp-overview__top{display:flex;flex:0 0 55%;min-height:0;position:relative}
.gp-overview--stacked .gp-col--left{flex:0 0 clamp(120px,38%,180px);min-width:0;border-right:1px solid var(--dsw-alias-border-l2)}
.gp-overview--stacked>.gp-detail{height:auto;flex:1 1 45%;min-height:0}

/* Stacked history toolbar: search takes the first row; the author / since
 * dropdowns and the refresh button share the second, all visible (no more
 * chevron). */
.gp-toolbar--stacked{gap:6px}
.gp-toolbar--stacked .gp-history-search{flex:1 1 100%}
.gp-toolbar--stacked .gp-select-trigger{flex:1 1 0;min-width:0}
/* Undo the shared .gp-select-trigger flex:1 1 0 above for the scope trigger: it
 * belongs to the search row, and stretching it there would squeeze the input it
 * pairs with. */
.gp-toolbar--stacked .gp-search-scope__trigger{flex:none}
.gp-toolbar--stacked .gp-icon-btn{flex:none}

/* The branch-list drawer. Tight stacked (≤ STACKED_TIGHT_BP): the band's left
 * column is a drawer over the history, retracted a full width to the left
 * (clipped by .gp-body) and inert until data-open slides it in above the
 * backdrop. The backdrop dims just this band, so the detail below stays live.
 * The toolbar toggle drives it (aria-expanded → aria-controls) and shares a
 * nowrap row with the search, whose width comes from the layout rather than a
 * reserved px budget — the touch media query grows icon buttons to 34px.
 *
 * A phone's compact overview (device screen ≤ PHONE_SCREEN_BP) mounts the same
 * drawer over the whole compact root: the root is the containing block
 * (position:relative in layout.ts), and its .gp-col width:100% rule needs the
 * equally-specific override below. The scroll area carries touch containment
 * so a list fling does not scroll the page behind the drawer. */
.gp-drawer-backdrop{position:absolute;inset:0;z-index:4;background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 50%,transparent);animation:gp-fade-in .12s ease}
.gp-drawer{position:absolute;left:0;top:0;bottom:0;width:clamp(180px,72%,260px);z-index:5;overflow:hidden;background:var(--dsw-alias-bg-layer-2);transform:translateX(-100%);transition:transform .18s cubic-bezier(.16,1,.3,1)}
.gp-overview--compact .gp-drawer{width:clamp(180px,72%,260px)}
.gp-drawer .gp-col-left__scroll{overscroll-behavior:contain}
.gp-drawer[data-open="true"]{transform:none}
.gp-drawer__bar{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.gp-drawer__title{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-toolbar--drawer .gp-toolbar__row{display:flex;align-items:center;gap:6px;flex:1 1 100%;min-width:0}
.gp-toolbar--drawer .gp-toolbar__row .gp-history-search{flex:1 1 auto;min-width:min-content}
@media (prefers-reduced-motion:reduce){
  .gp-drawer{transition:none}
  .gp-drawer-backdrop{animation:none}
}

/* Changes: commit editor + change-list band over the diff pane. The commit
 * message keeps the wide layout's editor height (the base rule in changes.ts):
 * stacked is a PC surface that spends the sidebar's full height, and a
 * one-line-tall field is unreadable. Only the phone's compact layout
 * compresses it (layout.ts). */
.gp-changes--stacked{flex-direction:column}
.gp-changes--stacked .gp-changes__left{flex:0 0 55%;min-height:0;min-width:0;width:100%}
.gp-changes--stacked .gp-changes__right{flex:1 1 0;min-height:0;min-width:0;width:100%}

/* Files: tree band over the preview pane. The :not() is load-bearing: the
 * fullscreen reader is the SAME element with an extra --full class, and this
 * rule is later in the sheet — without the guard its width:100% would beat
 * the reader's fixed min(920px,86vw) card and blow it up to fill the box. */
.gp-files--stacked{flex-direction:column}
.gp-files--stacked .gp-files__tree-wrap{flex:0 0 55%;min-height:120px;min-width:0;width:100%}
.gp-files--stacked .gp-files__preview:not(.gp-files__preview--full){flex:1 1 0;min-height:0;min-width:0;width:100%}

/* Checkout bar above the history search (stacked overview only): the root
 * path is click-to-copy and elides from the left (direction:rtl text + LRM),
 * the current branch rides beside it as a chip. Height mirrors the collapsed
 * repository block (.gp-repolist: 6px/4px padding + 22px head row) so the two
 * stacked information bars read as one row height — padding matches the list's
 * and the row floor matches the head's content height + its 4px tail. */
.gp-repobar{display:flex;align-items:center;gap:8px;flex:none;min-width:0;padding:6px 8px 4px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-repobar__path{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;box-sizing:border-box;min-height:22px;margin:0 0 0 -6px;padding:2px 6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer;border-radius:6px}
.gp-repobar__path:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gp-repobar__path:hover .gp-repobar__code{text-decoration:underline}
.gp-repobar__path:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-repobar__path--copied{color:var(--dsw-alias-state-success-primary)}
.gp-repobar__path--copied .gp-repobar__code{text-decoration:none}
.gp-repobar__path svg{flex:none}
.gp-repobar__code{flex:1 1 auto;min-width:0;display:flex;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px}
.gp-repobar__text{flex:0 1 auto;min-width:0;direction:rtl;unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repobar__branch{display:inline-flex;align-items:center;gap:3px;flex:none;max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gp-repobar__branch svg{flex:none}
.gp-repobar__branch--detached{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
`
