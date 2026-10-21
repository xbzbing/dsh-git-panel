/**
 * 总览三列 / 分栏条 / 分支树 / 状态栏 / 历史 / 提交详情 / 文件树。
 *
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的，同一模块内越靠后的规则越优先。要让新规则赢过某条既有规则，
 * 就写在它所在的模块之后。颜色一律走 --dsw-alias-* 变量，深浅色主题才一致。
 */
export const CSS = `
/* three-column overview — side columns shrink (with a min floor) instead of
 * staying fixed, and the middle keeps a guaranteed min so it never collapses to
 * blank when a right sidebar narrows the panel. */
.gp-overview{display:flex;width:100%;min-height:0}
.gp-col{display:flex;flex-direction:column;min-height:0;min-width:0}
.gp-col--left{flex:0 1 200px;min-width:130px;overflow:hidden}
.gp-col-left__scroll{flex:1;min-height:0;overflow-y:auto}
.gp-col--mid{flex:1 1 0;min-width:150px}
.gp-col--right{flex:0 1 340px;min-width:190px;display:flex;flex-direction:column;min-height:0}
/* drag handle between two columns: a thin hit area with a hairline center that
 * thickens to the accent colour on hover / drag. */
.gp-resizer{flex:0 0 5px;align-self:stretch;cursor:col-resize;position:relative;background:transparent;touch-action:none;user-select:none}
.gp-resizer::before{content:"";position:absolute;top:0;bottom:0;left:2px;width:1px;background:var(--dsw-alias-border-l2)}
.gp-resizer:hover::before,.gp-resizer:active::before{left:1px;width:3px;background:var(--dsw-alias-state-business-primary)}

/* branch list */
.gp-branch-group{padding:2px 0}
.gp-branch-group__head{display:flex;align-items:center;gap:6px;padding:4px 10px;font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer;user-select:none}
/* Left corners stay square so the row highlight (and its inset accent bar)
 * sits flush against the panel edge; only the right end is rounded. */
.gp-branch-row{display:flex;align-items:center;gap:6px;padding:4px 10px 4px 22px;cursor:pointer;border-radius:0 6px 6px 0;font-size:12px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gp-branch-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-branch-row--active,.gp-branch-row--active:hover{color:var(--dsw-alias-state-business-primary);background:var(--gp-select-bg);box-shadow:var(--gp-select-bar)}
.gp-branch-row--current .gp-tree-name{font-weight:600}
.gp-branch-row__ic--current,.gp-branch-row__ic--primary{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-business-primary))}
.gp-branch-row__track{display:inline-flex;align-items:center;gap:7px;flex:none;margin-left:auto;font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-business-primary)}
.gp-branch-row__sync{display:inline-flex;align-items:center;gap:2px;white-space:nowrap}
.gp-branch-row__sync-icon{flex:none}
.gp-branch-row__switch{display:none;flex:none;margin:-2px 0 -2px auto;padding:0 7px;height:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gp-branch-row__track+.gp-branch-row__switch{margin-left:0}
.gp-branch-row:hover .gp-branch-row__switch{display:inline-block}
.gp-branch-row__switch:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.gp-branch-row__switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
/* Refs sharing a '/'-prefix fold into a collapsible directory row: the chevron
 * keeps its own column and the folder glyph shares the 14px icon box, so a dir
 * label lines up with the leaf labels of the same level. */
.gp-branch-row__chev{display:inline-flex;flex:none;width:11px;align-items:center;justify-content:center}
.gp-branch-row__ic{display:inline-flex;flex:none;width:14px;align-items:center;justify-content:center}
.gp-branch-row--dir{color:var(--dsw-alias-label-secondary)}
.gp-branch-row--dir .gp-tree-name{font-weight:600}

/* left-column footer status bar: repo icon (left) + branch sync (right) */
.gp-statusbar{flex:none;display:flex;align-items:center;gap:8px;min-height:30px;padding:4px 8px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);font-size:11px}
.gp-statusbar__repo{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-secondary);text-decoration:none;border-radius:6px;padding:3px 5px}
a.gp-statusbar__repo:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-business-primary)}
.gp-statusbar__repo--none{color:var(--dsw-alias-label-tertiary)}
.gp-statusbar__ic{flex:none;display:inline-flex;align-items:center}
.gp-statusbar__sync{display:flex;align-items:center;gap:6px;margin-left:auto;min-width:0}
.gp-statusbar__state{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}
.gp-statusbar__state--ok{color:var(--dsw-alias-state-success-primary)}
.gp-statusbar__state--warn{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-business-primary))}
.gp-statusbar__btn{flex:none;width:24px;height:24px;border-radius:50%}
.gp-statusbar--busy .gp-statusbar__btn{animation:gp-spin 1s linear infinite}
.gp-statusbar__pull{flex:none;height:24px;padding:0 8px;font-size:11px}
@keyframes gp-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}

/* history */
.gp-history{display:flex;flex-direction:column;height:100%;min-height:0}
/* overscroll-behavior:contain keeps a wheel gesture that reaches the top/bottom
 * of the commit list from bubbling out and scrolling the whole conversation. */
.gp-history__list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.gp-commit-row{display:grid;align-items:center;gap:8px;height:30px;padding:0 10px;cursor:pointer;box-sizing:border-box}
.gp-commit-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-commit-row--active,.gp-commit-row--active:hover{background:var(--gp-select-bg);box-shadow:var(--gp-select-bar)}
.gp-commit-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-commit-hash{font-family:var(--dsw-font-mono,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gp-commit-author{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-commit-date{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.gp-ref-chip{display:inline-block;padding:0 6px;margin-right:4px;border-radius:8px;font-size:10px;line-height:16px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2)}
.gp-ref-chip--remote{color:var(--dsw-alias-label-secondary)}
.gp-ref-chip--tag{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
/* --head last so the current-branch fill always wins if a ref carries two kinds */
.gp-ref-chip--head{background:var(--dsw-alias-state-business-primary);color:#fff;border-color:transparent;font-weight:700;font-size:11px}
.gp-graph-cell{position:relative}
.gp-graph-svg{display:block}
.gp-graph-edge,.gp-graph-boundary{vector-effect:non-scaling-stroke}
.gp-graph-boundary{opacity:.8}
.gp-search{flex:1;min-width:60px;height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 10px;box-sizing:border-box}
.gp-search:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
/* Filter dropdowns are the platform Menu: the wrapper is the Menu's own anchor
 * span (inline-flex, so it still lays out as a toolbar item), and the trigger
 * uses the same module background as the shell's settings selectors. */
.gp-filter{display:inline-flex;align-items:center;min-width:0;max-width:100%}
.gp-select-trigger{display:inline-flex;align-items:center;gap:4px;min-height:28px;max-width:180px;padding:0 8px;border:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;cursor:pointer}
.gp-select-trigger:not(:disabled):hover,.gp-select-trigger[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.gp-select-trigger:disabled{cursor:default;color:var(--dsw-alias-label-quaternary)}
.gp-select-trigger:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-select-trigger__label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-select-trigger__chevron{flex:none;color:var(--dsw-alias-label-caption)}

/* commit detail (right pane): the changed-file tree and the commit message
 * split the column in half, each scrolling on its own. Equal halves keep the
 * comment visible instead of the file tree pushing it below the fold. */
.gp-detail{display:flex;flex-direction:column;min-height:0;height:100%}
.gp-detail__files{flex:1 1 50%;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 0 6px;border-bottom:1px solid var(--dsw-alias-border-l2)}
/* The summary pins to the top of the scrolling file tree beneath it: scrolling
 * a 20-file commit must not carry the "N files +A −B" bar out of view. Sticky
 * pins the MARGIN box, so the bar carries NO negative top margin — its border
 * box sits flush at the scrollport top (no 6px leak strip of rows above it)
 * both at rest and while stuck, i.e. tight against the split edge. The 6px
 * breathing room is the bar's own padding-top (text inset, box flush); the
 * background is opaque so rows pass behind it, not through it. */
.gp-detail__summary{position:sticky;top:0;z-index:1;display:flex;align-items:baseline;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);padding:6px 10px 7px;margin:0 0 6px;background:var(--dsw-alias-bg-base);border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-detail__summary-sep{color:var(--dsw-alias-label-tertiary);opacity:.6}
.gp-detail__msg{flex:1 1 50%;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:10px}
.gp-detail__subject{font-weight:600;margin-bottom:6px}
.gp-detail__meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:8px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.gp-detail__body{white-space:pre-wrap;font-size:12px;color:var(--dsw-alias-label-secondary);margin:0;font-family:inherit}

/* file tree — 13px to match the middle history list (was 12px, felt cramped) */
.gp-tree-row{display:flex;align-items:center;gap:6px;padding:3px 10px;cursor:pointer;font-size:13px;border-radius:4px}
.gp-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-tree-row--active{background:var(--dsw-alias-bg-layer-2)}
.gp-tree-row--muted{color:var(--dsw-alias-label-tertiary);cursor:default}
.gp-tree-row--muted:hover{background:transparent}
.gp-tree-ic{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-secondary)}
.gp-tree-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.gp-tree-row--dir .gp-tree-name{font-weight:600}
.gp-files__entry{width:100%;border:0;background:transparent;color:inherit;text-align:left;font:inherit}
/* Official file lists render directory names at the same weight as files; the
 * open/closed folder glyph carries the expansion state. */
.gp-files__tree .gp-files__entry--dir .gp-tree-name{font-weight:500}
.gp-files__entry:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-files__entry.gp-tree-row--active,.gp-files__entry.gp-tree-row--active:hover{background:var(--gp-select-bg);box-shadow:var(--gp-select-bar)}
.gp-files__entry.gp-tree-row--active .gp-tree-name{font-weight:600}
.gp-tree-row--ignored{opacity:.5}
.gp-tree-row--ignored:hover,.gp-tree-row--ignored:focus-visible{opacity:.85}
.gp-status-badge{flex:none;width:14px;text-align:center;font-size:11px;font-weight:600}
.gp-status--added{color:var(--dsw-alias-state-success-primary)}
.gp-status--modified{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-business-primary))}
.gp-status--deleted{color:var(--dsw-alias-state-error-primary)}
.gp-status--untracked{color:var(--dsw-alias-label-tertiary)}
.gp-status--renamed{color:var(--dsw-alias-state-business-primary)}
`
