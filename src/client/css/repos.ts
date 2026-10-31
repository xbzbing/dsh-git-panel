/**
 * 存储库：列表挂在分支树所在那一面的顶部——宽屏是 Git 总览左栏，上下分档
 * 是上 band 左栏（紧档退成抽屉），手机 / 窄档是按分支筛选的抽屉或底部弹层——
 * 另在变更记录列顶各挂一份。行式紧凑，切换仓库时分支、提交列表、存储库列表
 * 同屏可见。当前目录不是 git 仓库时面板
 * 不显示任何存储库入口（直接进入首个子仓库，根目录视图是纯文件浏览）。
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的。颜色一律走 --dsw-alias-*。
 */
export const CSS = `
/* The overview's left column, upper block: a header and one row per checkout.
 * It caps its own height so a workspace with many checkouts still leaves the
 * branch tree most of the column; the list itself scrolls. */
.gp-repolist{flex:0 0 auto;display:flex;flex-direction:column;min-height:0;max-height:38%;padding:6px 0 4px;border-bottom:1px solid var(--dsw-alias-border-l2)}
/* The head line toggles the block: the whole line is the target, not the 18px
 * chevron (a touch panel cannot hit that reliably). Collapsing stays explicit —
 * a pick never folds the list the user is switching in. */
.gp-repolist__head{display:flex;align-items:center;justify-content:space-between;gap:6px;flex:none;margin:0 4px;padding:2px 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:1.4;text-align:left;cursor:pointer}
.gp-repolist__head:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.gp-repolist__head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
/* A head that is not a toggle (the docked copy without a collapse control). */
.gp-repolist__head--static{cursor:default}
.gp-repolist__head--static:hover{background:transparent;color:var(--dsw-alias-label-tertiary)}
.gp-repolist__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Collapsed head: the label is a repository mark, not text — the selected
 * chip takes the width the words used to hold. */
.gp-repolist__label--ic{display:flex;align-items:center}
.gp-repolist__badge{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);font-size:10px;line-height:16px;text-align:center;box-sizing:border-box}
/* The scroll container also anchors the travelling fill, so the slider scrolls
 * with the rows instead of floating over them. */
.gp-repolist__list{position:relative;flex:1 1 auto;list-style:none;margin:0;padding:0;min-height:0;overflow:auto}
/* The block folds by animating its track size, not by hiding the rows: a
 * [hidden] toggle snapped the height in one frame, and every remount (each
 * pane renders its own copy of the block) replayed the fold-in, which read as
 * the list blinking whenever the user changed tabs. Unfolding grows downwards
 * and folding shrinks upwards, because the track always clips at its bottom.
 * The rows stay mounted while folded — the transition needs their real height
 * — so the folded body also leaves the tab order and the accessibility tree. */
.gp-repolist__body{display:grid;grid-template-rows:1fr;min-height:0;transition:grid-template-rows .2s ease,visibility 0s}
.gp-repolist__body[data-collapsed="true"]{grid-template-rows:0fr;visibility:hidden;transition:grid-template-rows .2s ease,visibility 0s linear .2s}
/* The fold clips the track; the list inside it owns the scrollbar. A grid item
 * does not shrink its children on its own, so the fold lays out as a column and
 * the list takes the leftover height — without this the list grew to its
 * content size, the fold clipped it, and no scrollbar was ever reachable. */
.gp-repolist__fold{display:flex;flex-direction:column;min-height:0;overflow:hidden}
.gp-repolist__row{margin:0;min-width:0}
.gp-repolist__item{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:5px 10px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.gp-repolist__item:hover:not(.gp-repolist__item--active){background:var(--dsw-alias-interactive-bg-hover)}
.gp-repolist__item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
/* The checked row is the one a click does nothing on. Its fill is the
 * travelling .gp-rowslider behind the rows (it cannot be a row background:
 * then a switch would repaint two rows instead of moving one block). */
.gp-repolist__item--active{background:transparent;box-shadow:none;cursor:default}
.gp-repolist__icon{display:inline-flex;align-items:center;flex:none;color:var(--dsw-alias-label-tertiary)}
.gp-repolist__item--active .gp-repolist__icon{color:var(--dsw-alias-state-business-primary)}
.gp-repolist__text{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-width:0}
.gp-repolist__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repolist__meta{display:flex;align-items:center;gap:6px;min-width:0;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.gp-repolist__branch{display:inline-flex;align-items:center;gap:3px;flex:none;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repolist__branch--detached{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
.gp-repolist__path{font-family:var(--dsw-font-mono,ui-monospace,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repolist__count{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-state-business-primary);color:#fff;font-size:10px;line-height:16px;text-align:center;box-sizing:border-box}
/* Stacked: the left column is a band above the history, so the list may take a
 * little more of it before the branch tree starts scrolling. */
.gp-panel[data-layout="stacked"] .gp-repolist{max-height:34%}
/* A switch keeps the previous sample on screen: dim the body so the stale panes
 * read as "being replaced" rather than as the new checkout's state (the fade
 * itself is the body's own transition, in base). */
.gp-panel[data-repo-switching="true"] .gp-body{opacity:.55}
/* Row line 1: name, then the row's own branch chip and change count. The name
 * takes what is left and ellipsizes; the chips never squeeze it to "dsh-…". */
.gp-repolist__line{display:flex;align-items:center;gap:6px;min-width:0}
.gp-repolist__line .gp-repolist__name{flex:1 1 auto;min-width:0}
/* Badges and the checkout path share line 2. */
.gp-repolist__tag{flex:none;max-width:50%;padding:0 5px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:10px;line-height:15px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box}
/* A row the host marked unchoosable: readable (the reason stays in the row and
 * in the tooltip) but not focusable or clickable — the button's disabled state
 * gives both behaviours for free. */
.gp-repolist__item--disabled{opacity:.55;cursor:default}
.gp-repolist__item--disabled:hover:not(.gp-repolist__item--active){background:transparent}
/* Group headers appear only when both families are present; one line each, so
 * they stay cheap inside the block's height budget. */
.gp-repolist__groups{display:flex;flex-direction:column;min-width:0}
.gp-repolist__group{display:flex;flex-direction:column;min-width:0}
.gp-repolist__grouphd{display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 10px 2px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.gp-repolist__grouptitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-repolist__groupcount{flex:none;min-width:16px;height:15px;padding:0 4px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);font-size:10px;line-height:15px;text-align:center;box-sizing:border-box}
.gp-repolist__rows{list-style:none;margin:0;padding:0;min-width:0}
/* The block's path line: the absolute root of the checkout the panes act on,
 * monospace, ellipsized, click-to-copy (the hover tip carries the whole
 * path). Sits between the head line and the rows. */
.gp-repolist__root{display:flex;align-items:center;gap:6px;flex:none;width:100%;min-width:0;padding:2px 10px 5px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;text-align:left;cursor:pointer;border-radius:6px}
/* An author display rule beats the UA's [hidden]{display:none} — restate it. */
.gp-repolist__root[hidden]{display:none}
.gp-repolist__root:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gp-repolist__root:hover .gp-repolist__root-code{text-decoration:underline}
.gp-repolist__root:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-repolist__root--copied{color:var(--dsw-alias-state-success-primary)}
.gp-repolist__root--copied .gp-repolist__root-code{text-decoration:none}
.gp-repolist__root svg{flex:none}
.gp-repolist__root-code{flex:1 1 auto;min-width:0;display:flex;font-family:var(--dsw-font-mono,ui-monospace,monospace)}
/* direction:rtl makes the ellipsis eat from the left, so the tail of the path
 * stays on screen; the invisible LRM the text is prefixed with anchors the
 * leading '/', which the ellipsis then swallows with the rest of the head. */
.gp-repolist__root-body{flex:0 1 auto;min-width:0;direction:rtl;unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Head line while collapsed: the checkout the panes act on. */
.gp-repolist__selected{flex:1 1 auto;min-width:0;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);text-align:right}
/* Head collapse indicator: a chevron inside the head button, with no hit area
 * or focus ring of its own. */
.gp-repolist__collapse{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;color:var(--dsw-alias-label-tertiary)}
`;
