/**
 * Global stylesheet, injected once into a plugin-owned <style data-plugin> tag.
 * All colors use dsh theme CSS variables so light/dark themes stay consistent.
 */

const CSS = `
.gp-panel{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;position:relative;
  /* One selection language across the three list panes (Overview commits,
   * Changes rows, Files tree): primary-tinted fill + a 3px inset left bar. */
  --gp-select-bg:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);
  --gp-select-bar:inset 3px 0 0 var(--dsw-alias-state-business-primary)}
.gp-panel[data-font-delta="1"]{zoom:1.08;font-size:14px}
.gp-panel[data-font-delta="-1"]{zoom:.92;font-size:12px}
.gp-tabbar{display:flex;align-items:center;gap:4px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none;flex-wrap:nowrap;min-width:0}
/* The shell floats the input composer over the view's bottom (composer-overlay
 * mode). Reserve that height as bottom padding so the panel's own bottom rows
 * (commit box / commit comment) stay above it instead of being covered. */
.gp-body{flex:1;min-height:0;display:flex;overflow:hidden;padding-bottom:calc(var(--dsh-composer-height,140px) + 12px)}
/* version + update-check cluster, pushed to the tab bar's trailing edge */
.gp-verbar{margin-left:auto;display:inline-flex;align-items:center;gap:8px}
.gp-verbar__tag{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-mono,ui-monospace,monospace)}
.gp-verbar__btn{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.gp-verbar__btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-verbar__btn:disabled{opacity:.6;cursor:default}
.gp-verbar__status{font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-verbar__status--ok{color:var(--dsw-alias-state-success-primary)}
.gp-verbar__status--new{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-business-primary))}
.gp-verbar__status--err{color:var(--dsw-alias-state-error-primary)}
.gp-verbar__link{color:var(--dsw-alias-state-business-primary);font-size:11px;text-decoration:none;white-space:nowrap}
.gp-verbar__link:hover{text-decoration:underline}
.gp-verbar__gh{color:var(--dsw-alias-label-secondary);text-decoration:none}
.gp-verbar__gh:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
/* star link: hollow by default, fills to a gold star on hover */
.gp-verbar__gh--starred:hover{color:var(--dsw-alias-state-warn-primary,#e3b341)}
.gp-verbar__gh--starred:hover svg{fill:currentColor}
/* The sub-tab switcher is the platform SegmentedTabs primitive (official track,
 * pill and sliding indicator). We only place the tab list in our flex bar and
 * supply the icon/label spans inside each tab's label. */
.gp-tabbar__tabs{flex:0 1 auto;min-width:0}
.gp-tab__icon{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;flex:none}
.gp-tab__label{white-space:nowrap}
/* Trailing cluster (font stepper + version bar). display:contents makes it
 * transparent to the tab-bar flex in the wide layout — font sits after the
 * tabs, version bar floats right via its own margin-left:auto — identical to a
 * flat layout. The compact layout re-materializes it as a single trailing item. */
.gp-tabbar__trailing{display:contents}
.gp-font{margin-left:4px;display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;overflow:hidden}
.gp-font button{border:0;border-left:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:22px;width:24px;height:24px;padding:0;cursor:pointer}
.gp-font button:first-child{border-left:0}
.gp-font button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* The current step is stored as aria-pressed, so the selected cell needs no
 * parallel class: it keeps the filled background even while hovered. */
.gp-font button[aria-pressed="true"]{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font-weight:600}
.gp-font button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;color:var(--dsw-alias-label-tertiary);font-size:12px;padding:24px;text-align:center}
.gp-files-wrap{display:flex;flex-direction:column;width:100%;height:100%;min-height:0}
.gp-files-wrap>.gp-files{flex:1;min-height:0;height:auto}
.gp-notice{flex:none;padding:8px 14px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.gp-changes__toolbar{flex-wrap:nowrap;gap:4px;overflow-x:auto}
.gp-changes__toolbar .gp-icon-btn{flex:none}
/* Compact history toolbar: one control height across the branch pill, the
 * search input, the select triggers and the icon buttons (the touch media query
 * used to leave only .gp-btn at 36px, so the branch pill towered over its row).
 * The author / since / refresh group starts collapsed behind a chevron. */
.gp-panel[data-layout="compact"] .gp-history .gp-toolbar .gp-btn,
.gp-panel[data-layout="compact"] .gp-history .gp-toolbar .gp-search,
.gp-panel[data-layout="compact"] .gp-history .gp-toolbar .gp-select-trigger{height:30px}
.gp-panel[data-layout="compact"] .gp-history .gp-toolbar .gp-select-trigger{min-height:30px}
.gp-panel[data-layout="compact"] .gp-history .gp-toolbar .gp-icon-btn{width:30px;height:30px}
.gp-panel[data-layout="compact"] .gp-history .gp-toolbar .gp-btn{flex:none;max-width:55%;min-width:0;gap:5px}
.gp-btn__label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Square 30px chevron button: the scoped selector keeps the 30px box and zero
 * padding ahead of the later, equally specific gp-btn base rule. */
.gp-toolbar .gp-toolbar__more-toggle{flex:none;width:30px;box-sizing:border-box;padding:0;justify-content:center}
.gp-toolbar__chev{display:inline-flex;transition:transform .12s ease}
.gp-toolbar__chev--up{transform:rotate(180deg)}
.gp-toolbar__more{flex:1 1 100%;display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}
.gp-panel[data-layout="compact"] .gp-history .gp-toolbar .gp-toolbar__more .gp-filter{flex:1 1 0;min-width:0;max-width:calc(50% - 23px)}
.gp-changes__toolbar .gp-icon-btn:disabled{opacity:.4;cursor:default}
.gp-changes__toolbar .gp-icon-btn:hover:disabled{background:transparent}
.gp-changes__toolbar .gp-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-changes__toolbar .gp-icon-btn>span{display:inline-flex}
.gp-changes__refresh--busy svg{animation:gp-spin 1s linear infinite}
.gp-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
.gp-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gp-btn:disabled{opacity:.5;cursor:default}
.gp-btn--primary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}
.gp-btn--primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 85%,#000);color:#fff}
.gp-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gp-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}

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
.gp-detail__files{flex:1 1 50%;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-detail__summary{display:flex;align-items:baseline;gap:6px;font-size:11px;color:var(--dsw-alias-label-tertiary);padding:0 10px 7px;margin-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l2)}
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

/* changes page — height:100% bounds the row to the panel so the right diff
 * scrolls inside its own pane instead of growing and pushing the left commit
 * box below the fold. */
.gp-changes{display:flex;width:100%;height:100%;min-height:0}
.gp-changes__left{flex:0 1 380px;min-width:220px;display:flex;flex-direction:column;min-height:0}
.gp-changes__right{flex:1 1 0;min-width:180px;display:flex;flex-direction:column;min-height:0}
/* files browser: resizable tree column + preview pane */
.gp-files{display:flex;width:100%;height:100%;min-height:0}
.gp-files__tree{flex:0 0 300px;min-width:180px;display:flex;flex-direction:column;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 0}
.gp-files__preview{flex:1 1 0;min-width:180px;display:flex;flex-direction:column;min-height:0}
.gp-files__preview-content{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.gp-files__bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-files__path{flex:1 1 120px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font:inherit}
.gp-files__copy-path{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px}
.gp-files__copy-path:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* The path/content copy actions read as one joined button group: the shared
 * border collapses (1px overlap) and only the outer corners stay rounded. */
.gp-files__copy-group{flex:none;display:flex;align-items:center}
.gp-files__copy-group .gp-files__copy-path{border-radius:0;margin-left:-1px}
.gp-files__copy-group .gp-files__copy-path:first-child{border-radius:6px 0 0 6px;margin-left:0}
.gp-files__copy-group .gp-files__copy-path:last-child{border-radius:0 6px 6px 0}
.gp-files__copy-group .gp-files__copy-path:only-child{border-radius:6px}
.gp-files__copy-group .gp-files__copy-path:hover,.gp-files__copy-group .gp-files__copy-path:focus-visible{position:relative;z-index:1}
.gp-files__copy-path:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-files__copy-path--error{color:var(--dsw-alias-state-error-primary)}
/* Icon-only properties entry at the toolbar's far right. The path's flex-grow
 * already pins the trailing cluster to the right edge; a margin-left:auto here
 * would steal that free space and collapse the path to its 120px basis. */
.gp-files__props{flex:none;display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
.gp-files__props:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gp-files__props:disabled{opacity:0.5;cursor:default}
.gp-files__props:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-files__props[aria-pressed="true"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent)}
.gp-files__mode-seg{flex:none}
/* Compact preview toolbar: the relative path and the two copy buttons are gone
 * (they forced three wrapped rows on a phone). Back + the official source/render
 * control + fullscreen + properties share one row; longer locales wrap instead
 * of squeezing the mode labels. */
.gp-files__bar--compact{padding:6px 8px}
.gp-files__bar--compact .gp-files__mode-seg{flex:1 1 auto;min-width:max-content}
.gp-files__bar--compact .gp-files__bar-end{flex:none;margin-left:auto;display:flex;align-items:center;gap:6px}
/* Trailing icon buttons match the 30px back button / mode control instead of
 * their 24px inline size (4px padding + 14px glyph). */
.gp-panel[data-layout="compact"] .gp-files__bar-end .gp-files__props{height:30px;box-sizing:border-box;padding:0 6px}
.gp-files__bar--compact .gp-files__mode-seg button{padding:0 10px;font-size:12px}
.gp-files__markdown{overflow:auto;overscroll-behavior:contain;padding:16px 24px;color:var(--dsw-alias-label-primary)}
/* Mermaid figures: the SVG centers and never overflows the pane width; a
 * parse/load failure falls back to the source as a plain code block. */
.gp-mermaid{overflow-x:auto;padding:4px 0}
.gp-mermaid svg{display:block;max-width:100%;height:auto;margin:0 auto}
.gp-mermaid--loading{min-height:64px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-skeleton);color:var(--dsw-alias-label-tertiary)}
.gp-mermaid__loading-text{font-size:12px;line-height:20px}
.gp-mermaid__fallback{overflow:auto;background:var(--dsw-alias-markdown-code-block);border-radius:6px;padding:10px 12px;font-family:var(--dsw-font-mono,monospace);font-size:12px;margin:8px 0}
.gp-files__html{flex:1;min-height:0;width:100%;border:0;background:#fff}
.gp-files__code{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;font-family:var(--dsw-font-mono,monospace);font-size:12px;position:relative}
/* Both sticky axes: the header must also stay put under horizontal scroll
 * (reachable only in nowrap mode), or the find bar slides out of view. */
.gp-files__header{position:sticky;top:0;left:0;z-index:2}
.gp-files__note{padding:5px 12px;font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-find{display:flex;align-items:center;gap:4px;padding:5px 8px;background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-find__input{flex:1;min-width:60px;height:26px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 8px;box-sizing:border-box}
.gp-find__input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-find__count{flex:none;min-width:44px;text-align:center;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gp-find__btn{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:14px;line-height:1}
.gp-find__btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gp-find__btn:disabled{color:var(--dsw-alias-label-quaternary);cursor:default}
.gp-find__btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-find__case{width:auto;padding:0 6px;font-size:11px;font-weight:600}
.gp-find__case--active{background:var(--dsw-alias-state-business-primary);color:#fff}
.gp-find__case--active:hover{background:var(--dsw-alias-state-business-primary);color:#fff}
.gp-find-hit{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);color:inherit;border-radius:2px}
.gp-find-hit--active{background:var(--dsw-alias-state-warn-primary);color:var(--dsw-static-neutral-1000,#000)}
.gp-files__trunc{color:var(--dsw-alias-label-tertiary);font-style:italic}
.gp-files__single{display:grid;grid-template-columns:44px 1fr}
/* Virtualized source view: the outer box is a fixed-height spacer that owns the
 * scrollbar; each mounted row is absolutely positioned at its line offset and
 * lays its line-number gutter + code cell on one fixed-height row. */
.gp-files__single--virt{display:block;position:relative;width:100%}
.gp-files__row{position:absolute;left:0;right:0;display:grid;grid-template-columns:44px 1fr;height:20px}
/* Fixed row height needs non-wrapping cells; a long line scrolls horizontally
 * on the container instead of growing the row past ROW_HEIGHT. */
.gp-files__row .gp-diff-cell{white-space:pre;overflow:hidden;text-overflow:clip}
/* No-wrap: rows size to the longest line (min-width keeps short files full-bleed)
 * so the container's overflow:auto exposes a real horizontal scrollbar. */
.gp-files__code--nowrap .gp-files__single--virt{width:max-content;min-width:100%}
.gp-files__code--nowrap .gp-files__row{right:auto;width:max-content;min-width:100%}
.gp-files__code--nowrap .gp-files__row .gp-diff-cell{overflow:visible}
/* Wrap: flow layout (not the fixed-height virtual grid) so a line can grow the
 * row; the gutter stays one column beside the wrapping cell. */
.gp-files__code--wrap .gp-files__single--virt{position:static;width:auto;height:auto!important}
.gp-files__code--wrap .gp-files__row{position:static;height:auto;min-height:20px}
.gp-files__code--wrap .gp-files__row .gp-diff-cell{white-space:pre-wrap;overflow-wrap:anywhere;overflow:visible}
.gp-files__image{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;align-items:flex-start;justify-content:flex-start;padding:16px;background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(45deg,color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent) 25%,transparent 25%,transparent 50%,color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent) 50%,color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent) 75%,transparent 75%);background-size:16px 16px}
.gp-files__image img{max-width:100%;max-height:100%;object-fit:contain}
.gp-changes__list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 0}
/* Virtualized change list: a fixed-height relative spacer owns the scrollbar;
 * each mounted row/head is absolutely positioned at its offset and pinned to
 * the fixed height the window math assumes (VROW_H / VHEAD_H). */
.gp-changes__vlist{position:relative;width:100%}
.gp-changes__vrow{position:absolute;left:0;right:0;box-sizing:border-box}
.gp-changes__vrow>.gp-file-row,.gp-changes__vrow>.gp-group-head{height:100%;box-sizing:border-box}
.gp-check{width:14px;height:14px;flex:none;cursor:pointer}
.gp-group-head{display:flex;align-items:center;gap:6px;padding:5px 10px;font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer;user-select:none}
/* A group kept only for its count has nothing to collapse: no chevron, no hand. */
.gp-group-head--static{cursor:default}
.gp-group-head__chev-spacer{display:inline-block;width:12px;flex:none}
.gp-file-row{display:flex;align-items:center;gap:8px;padding:4px 10px 4px 20px;cursor:pointer;font-size:12px;border-radius:4px}
.gp-file-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Selected change row: identical accent to the Git overview commit list
 * (business-primary 16% tint + a 3px inset left bar), for one selection
 * language across panes. */
.gp-file-row--active,.gp-file-row--active:hover{background:var(--gp-select-bg);box-shadow:var(--gp-select-bar)}
/* Actions occupy a fixed lane at all times (visibility toggle, not display)
 * so hovering never changes the row's width — no wobble. */
.gp-file-row__actions{margin-left:auto;display:flex;gap:4px;flex:none;visibility:hidden}
.gp-file-row:hover .gp-file-row__actions{visibility:visible}

/* stats bar */
.gp-stats{display:flex;align-items:center;gap:14px;padding:8px 12px;min-height:33px;box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-secondary);flex:none;flex-wrap:wrap}
.gp-stats__item{display:inline-flex;align-items:center;gap:5px}
/* The two timestamps wrap as one unit and never split across lines. */
.gp-stats__times{display:inline-flex;align-items:center;gap:14px;flex-wrap:nowrap}
.gp-stats__add{color:var(--dsw-alias-state-success-primary)}
.gp-stats__del{color:var(--dsw-alias-state-error-primary)}
/* "simplified" marker on a huge change set: muted + help cursor + dotted hint. */
.gp-stats__partial{color:var(--dsw-alias-label-tertiary);cursor:help;text-decoration:underline dotted;text-underline-offset:2px}
/* Compact stats bar: the counts on one clipped, never-wrapping line. The
 * timestamps are not rendered at all at this width (ChangeStats) — the bar must
 * not cost a second row above the change list on a phone. */
.gp-stats--compact{padding:6px 8px 6px 12px;gap:4px 8px;align-items:center}
.gp-stats--compact .gp-stats__main{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:14px;overflow:hidden;white-space:nowrap}
.gp-stats--compact .gp-stats__main>.gp-stats__item{flex:none}

/* commit box */
.gp-commitbox{flex:none;border-top:1px solid var(--dsw-alias-border-l2);padding:8px 10px;display:flex;flex-direction:column;gap:8px}
.gp-commitbox__msg{width:100%;min-height:72px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:8px;box-sizing:border-box}
.gp-commitbox__msg-wrap{position:relative;display:block}
.gp-commitbox__msg-wrap--busy .gp-commitbox__msg{padding-right:28px}
/* Loading indicator inside the disabled field (AI suggest in flight). */
.gp-commitbox__spin{position:absolute;top:8px;right:8px;width:13px;height:13px;box-sizing:border-box;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary);animation:gp-spin .7s linear infinite;pointer-events:none}
.gp-commitbox__msg[readonly]{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2);cursor:progress}
.gp-commitbox__msg:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-commitbox__row{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.gp-commitbox__amend{display:inline-flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;color:var(--dsw-alias-label-secondary);cursor:pointer}
/* Compact commit bar: stands in for the whole editor until tapped, so the
 * change list keeps the panel's scarce height on a phone. */
.gp-commitbar{flex:none;border-top:1px solid var(--dsw-alias-border-l2);padding:4px 8px;display:flex;align-items:center;gap:6px}
.gp-commitbar__open{flex:1 1 auto;min-width:0;display:flex;align-items:center;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:text}
.gp-commitbar__open:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-commitbar__ph,.gp-commitbar__draft{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-commitbar__ph{color:var(--dsw-alias-label-tertiary)}
.gp-panel[data-layout="compact"] .gp-commitbar .gp-btn{height:30px}
/* Compact commit row: AI suggest / Commit / fold all share the 30px height, so
 * the fold button lines up with its neighbours and the row loses vertical padding. */
.gp-panel[data-layout="compact"] .gp-commitbox .gp-btn{height:30px}
/* Compact fold control: a real button (tinted fill, border, press feedback) so
 * collapsing the editor reads as an action next to AI suggest / Commit. */
.gp-panel[data-layout="compact"] .gp-commitbox__fold{width:30px;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);transition:background .12s ease,color .12s ease,transform .08s ease}
.gp-panel[data-layout="compact"] .gp-commitbox__fold:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gp-panel[data-layout="compact"] .gp-commitbox__fold:active:not(:disabled){transform:scale(.94)}
.gp-panel[data-layout="compact"] .gp-commitbox__fold:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-commitbox__fold:disabled{opacity:.5;cursor:default}
.gp-commitbox__actions{margin-left:auto;display:flex;flex-wrap:nowrap;gap:6px}

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
.gp-diff__path{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-diff__expand{border:1px solid var(--dsw-alias-border-l2);border-radius:7px}
.gp-diff__expand:disabled{opacity:.45;cursor:not-allowed}
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
.gp-notice{padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-secondary) 10%,transparent);display:flex;align-items:center;gap:8px}
/* Dismissible banner: the text takes the free width, the close button pins right. */
.gp-notice__text{flex:1 1 auto;min-width:0}
.gp-notice__close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:-2px -4px -2px 0;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.gp-notice__close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gp-notice__close:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}

/* commit file-diff modal (overview → click a file): a centered dialog over a
 * dimmed backdrop, closed by Esc / backdrop click / the close button. */
.gp-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:40px;background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 62%,transparent);backdrop-filter:blur(2px);animation:gp-fade-in .12s ease}
@keyframes gp-fade-in{from{opacity:0}to{opacity:1}}
.gp-modal{display:flex;flex-direction:column;position:relative;width:min(920px,86vw);height:min(680px,82vh);border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:14px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 24px 64px rgba(0,0,0,.32),0 4px 12px rgba(0,0,0,.18);overflow:hidden;animation:gp-modal-in .18s cubic-bezier(.16,1,.3,1)}
@keyframes gp-modal-in{from{transform:translateY(12px) scale(.97);opacity:0}to{transform:none;opacity:1}}
.gp-modal__bar{display:flex;align-items:center;gap:10px;padding:11px 12px 11px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex:none}
.gp-modal__fileicon{display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary);flex:none}
.gp-modal__path{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.gp-modal__dir{color:var(--dsw-alias-label-tertiary)}
.gp-modal__name{color:var(--dsw-alias-label-primary);font-weight:600}
.gp-modal__hash{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);padding:2px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));flex:none}
.gp-modal__sum{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-family:var(--dsw-font-mono,ui-monospace,monospace);flex:none}
.gp-modal__close{flex:none}
/* Compact modal bar: two rows (header / mode seg + close), mirroring the
 * changes-pane toolbar. The seg stretches evenly and the bordered close
 * button pins to the row's far right. */
.gp-modal__bar-row{display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 100%}
.gp-modal__bar-row--controls{flex-wrap:wrap}
.gp-modal__bar-row--controls .gp-seg{flex:1 1 auto;min-width:max-content}
.gp-modal__bar-row--controls .gp-seg .gp-seg__btn{flex:1 1 0;min-width:max-content}
.gp-modal__bar-row--controls .gp-modal__close{margin-left:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:7px}
.gp-modal__scroll{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;font-family:var(--dsw-font-mono,monospace);font-size:12px;background:var(--dsw-alias-bg-layer-2)}

/* small dialog (tag create/delete, stash push/drop): auto-height form modal */
.gp-modal--sm{width:min(460px,92vw);height:auto;max-height:min(560px,86vh)}
.gp-modal__form{flex:1;min-height:0;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.gp-modal__confirmtext{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word}
/* pull-scope line: highlighted + bold summary of the incoming fast-forward */
.gp-pullscope{margin-top:10px;padding:8px 12px;font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 9%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 22%,transparent);border-radius:8px}
.gp-pullscope--loading{font-weight:400;color:var(--dsw-alias-label-tertiary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);border-color:var(--dsw-alias-border-l2)}
.gp-pullscope__add{color:var(--dsw-alias-state-success-primary)}
.gp-pullscope__del{color:var(--dsw-alias-state-error-primary)}
/* busy overlay (e.g. pull in flight): a scrim + spinner + indeterminate bar */
.gp-modal__overlay{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 82%,transparent);backdrop-filter:blur(1.5px);border-radius:inherit;animation:gp-fade-in .12s ease}
.gp-modal__overlay-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
@keyframes gp-fade-in{from{opacity:0}to{opacity:1}}
.gp-spinner{width:26px;height:26px;border-radius:50%;border:2.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary);animation:gp-spin .7s linear infinite}
.gp-modal__check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}
.gp-input{width:100%;box-sizing:border-box;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.gp-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.gp-input--area{height:auto;min-height:60px;padding:8px 10px;resize:vertical;line-height:1.5}
.gp-modal__footer{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l2)}
.gp-modal__hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.gp-btn--sm{height:24px;padding:0 8px;font-size:11px}
.gp-btn--danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:#fff}
.gp-btn--danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,#000);color:#fff}

/* file properties dialog: grouped label/value rows. Emphasis comes from
 * weight/color (bold name & numbers, tinted Git chips), not from layout.
 * Groups after the first are separated by a hairline so the section titles
 * read as dividers instead of floating among the rows. */
.gp-props__group{display:flex;flex-direction:column;gap:2px}
.gp-props__group + .gp-props__group{border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px;margin-top:2px}
.gp-props__group-title{font-size:12px;font-weight:650;letter-spacing:0.01em;color:var(--dsw-alias-label-primary);margin-bottom:5px}
.gp-props__row{display:flex;align-items:baseline;gap:12px;min-height:22px}
.gp-props__label{flex:none;width:84px;color:var(--dsw-alias-label-secondary);font-size:12px}
.gp-props__value{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:flex-end;gap:6px;color:var(--dsw-alias-label-primary);font-size:12px;text-align:right;overflow-wrap:anywhere}
.gp-props__strong{font-weight:650;font-variant-numeric:tabular-nums}
.gp-props__sub{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.gp-props__mono{font-family:var(--dsw-font-mono,monospace);font-size:11px;user-select:all}
/* Path values are copy targets (hover shows the affordance). */
.gp-props__copy{border:0;background:transparent;padding:2px 4px;margin:-2px 0;font:inherit;color:inherit;text-align:right;cursor:pointer;border-radius:5px;min-width:0}
.gp-props__copy:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-props__copy:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.gp-props__copy .gp-props__mono{font-size:11px}
/* Footer status bar: Git chips pinned left, copy feedback right, both
 * vertically centered; always rendered (fixed height) so feedback never
 * resizes the dialog. */
.gp-props__statusbar{min-height:34px;padding:6px 14px;justify-content:space-between;align-items:center;border-top:1px solid var(--dsw-alias-border-l2)}
.gp-props__footer-chips{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
/* Copy feedback: info blue at reduced presence — success green would clash
 * with the green "tracked" chip on the same bar. */
.gp-props__copied{font-size:12px;font-weight:600;color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 60%,transparent);white-space:nowrap}
.gp-props__copied--err{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 75%,transparent)}
/* Git chips: status colors arrive via gp-status--* (currentColor-based),
 * painted as a soft tinted pill so states pop without shouting. */
.gp-props__badge{display:inline-block;padding:1.5px 9px;border-radius:999px;font-size:11px;font-weight:600;line-height:1.5;border:1px solid color-mix(in srgb,currentColor 30%,transparent);background:color-mix(in srgb,currentColor 12%,transparent);white-space:nowrap}
.gp-props__badge--ok{color:var(--dsw-alias-state-success-primary)}
.gp-props__badge--muted{color:var(--dsw-alias-label-tertiary)}

/* reset dialog: mode radios + hard-mode lost-files warning */
.gp-reset__modes{display:flex;flex-direction:column;gap:6px}
.gp-reset__mode{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer}
.gp-reset__mode--on{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-2)}
.gp-reset__mode--danger.gp-reset__mode--on{border-color:var(--dsw-alias-state-error-primary)}
.gp-reset__mode .gp-check{margin-top:2px;flex:none}
.gp-reset__modetext{display:flex;flex-direction:column;gap:2px;min-width:0}
.gp-reset__modelabel{font-size:12px;color:var(--dsw-alias-label-primary)}
.gp-reset__mode--danger .gp-reset__modelabel{color:var(--dsw-alias-state-error-primary);font-weight:600}
.gp-reset__modehint{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}
.gp-reset__lost{border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;padding:8px 10px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.gp-reset__warn{font-size:12px;font-weight:600;color:var(--dsw-alias-state-error-primary);margin-bottom:4px}
.gp-reset__lostlist{margin:0;padding-left:16px;max-height:120px;overflow-y:auto;font-size:11px;font-family:var(--dsw-font-mono,ui-monospace,monospace);color:var(--dsw-alias-label-secondary)}
.gp-reset__lostlist li{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-reset__lostmore{font-family:inherit;color:var(--dsw-alias-label-tertiary);list-style:none;margin-left:-16px}
.gp-reset__ack{color:var(--dsw-alias-state-error-primary)}
.gp-reset__dirtywarn{font-size:11px;line-height:1.5;color:var(--dsw-alias-state-warn-primary,#e0982e)}

/* branch-switch confirm: tracking note + dirty-work-tree warning + the switch mode radios */
.gp-bpick__extra{display:flex;flex-direction:column;gap:8px}
.gp-bpick__note{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.gp-bpick__warn{font-size:11px;line-height:1.5;color:var(--dsw-alias-state-warn-primary,#e0982e)}
.gp-bpick__modes{display:flex;flex-direction:column;gap:6px}
.gp-bpick__mode{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer}
.gp-bpick__mode--on{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-2)}
.gp-bpick__mode .gp-check{margin-top:2px;flex:none}
.gp-bpick__modetext{display:flex;flex-direction:column;gap:2px;min-width:0}
.gp-bpick__modelabel{font-size:12px;color:var(--dsw-alias-label-primary)}
.gp-bpick__modehint{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary)}

/* commit detail action area: tag chips on their own wrapping row (shown only
 * when tags exist), action buttons on a second row below */
.gp-detail__ops{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-bottom:10px}
.gp-detail__tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.gp-detail__tagname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px}
.gp-detail__actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
/* Compact commit-detail ops: the touch rule lifts every .gp-btn to 36px, which
 * makes revert / reset / create-tag tall for such low-frequency actions. Keep
 * them at the compact control height (30px) instead. */
.gp-panel[data-layout="compact"] .gp-detail__actions .gp-btn{height:30px}
.gp-ref-chip--del{display:inline-flex;align-items:center;gap:4px;max-width:100%}
.gp-ref-chip__x{display:inline-flex;align-items:center;padding:0;margin-left:2px;border:none;background:none;color:inherit;cursor:pointer;opacity:.7}
.gp-ref-chip__x:hover{opacity:1;color:var(--dsw-alias-state-error-primary)}

/* stash list (changes page, below the change list) */
.gp-stash{flex:none;border-top:1px solid var(--dsw-alias-border-l2)}
.gp-stash-row{display:flex;align-items:center;gap:8px;padding:5px 10px;font-size:12px}
.gp-stash-row__info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.gp-stash-row__msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}
.gp-stash-row__meta{display:flex;gap:8px;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.gp-stash-row__actions{flex:none;display:flex;align-items:center;gap:4px}

/* commit hover card (middle column): pointer-anchored, lists changed files */
.gp-hovercard{position:fixed;z-index:70;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:10px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));box-shadow:0 8px 28px rgba(0,0,0,.2),0 1px 3px rgba(0,0,0,.12);font-size:12px;pointer-events:none;max-height:60vh;overflow:hidden;display:flex;flex-direction:column}
.gp-hovercard__subject{font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:4px;white-space:normal;word-break:break-word;overflow-wrap:anywhere}
.gp-hovercard__meta{display:flex;align-items:baseline;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:8px;flex-wrap:wrap}
.gp-hovercard__loading{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gp-hovercard__body{margin:0;font-family:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;overflow-y:auto;min-height:0}

/* input-bar pill (zsh style) — repo cyan, (branch) green when synced /
 * orange when dirty. Fully-rounded (999px) to match the dsh-openviking-manager
 * input-bar toggle pill. */
.gp-pill-wrap{display:inline-flex}
.gp-pill{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:12px;line-height:16px;cursor:pointer;white-space:nowrap;max-width:280px;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-weight:600}
.gp-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-pill__dot{display:none;flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.gp-pill__repo{color:var(--dsw-alias-state-business-primary,#5ac8fa);flex:none;overflow:hidden;text-overflow:ellipsis}
/* Spacing between the repo name and the branch group comes from the pill's own
 * flex gap — an extra margin here would double it (12px rendered). */
.gp-pill__git{display:inline-flex;align-items:center;min-width:0}
.gp-pill--synced .gp-pill__git{color:var(--dsw-alias-state-success-primary,#3fb950)}
.gp-pill--dirty .gp-pill__git{color:var(--dsw-alias-state-warn-primary,#e0982e)}
.gp-pill--synced .gp-pill__dot{background:var(--dsw-alias-state-success-primary,#3fb950)}
.gp-pill--dirty .gp-pill__dot{background:var(--dsw-alias-state-warn-primary,#e0982e)}
.gp-pill__branch{color:inherit;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-pill--plain{cursor:default;font-weight:500}
.gp-pill--plain .gp-pill__repo{color:var(--dsw-alias-label-secondary)}
.gp-pill--degraded{color:var(--dsw-alias-label-tertiary);cursor:default;font-weight:500}
/* When the workspace is narrow (a sidebar opens), collapse the pill to a single
 * status dot — width-driven, so it expands back as the workspace widens. The
 * git status color is preserved via .gp-pill__dot. */
.gp-pill--compact{gap:0;padding:0;width:28px;min-width:28px;height:28px;justify-content:center;border-radius:999px}
.gp-pill--compact .gp-pill__dot{display:block}
.gp-pill--compact .gp-pill__repo,.gp-pill--compact .gp-pill__git{display:none}

/* plugin detail config form (plugins.bundle.config slot body) — font sizes
 * follow the shell settings page: 15px section titles, 14px labels, 13px hints. */
.gp-cfg{display:flex;flex-direction:column;gap:12px;padding:16px 20px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.gp-cfg__title{margin:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.gp-cfg__row{display:inline-flex;align-items:center;gap:10px;cursor:pointer;user-select:none}
/* 开关清零 border/padding：::after 按 padding box 定位，UA 默认 1px 边框会把定位框上下各缩 1px，滑块上缘就多出 1px 空隙。 */
.gp-cfg__switch{appearance:none;-webkit-appearance:none;flex:none;width:36px;height:20px;margin:0;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-border-l2);position:relative;transition:background .15s ease;cursor:pointer}
.gp-cfg__switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s ease}
.gp-cfg__switch:checked{background:var(--dsw-alias-state-business-primary)}
.gp-cfg__switch:checked::after{transform:translateX(16px)}
.gp-cfg__switch:disabled{opacity:.5;cursor:default}
.gp-cfg__switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-cfg__text{font-size:14px;color:var(--dsw-alias-label-primary)}
.gp-cfg__seg{align-self:flex-start}
.gp-cfg__seglabel{margin:0;font-size:14px;color:var(--dsw-alias-label-primary)}
.gp-cfg__hint{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.gp-cfg__err{margin:0;font-size:13px;color:var(--dsw-alias-state-error-primary)}
.gp-cfg__numrow{display:flex;align-items:center;gap:8px}
.gp-cfg__numlabel{flex:1;min-width:0;font-size:14px;color:var(--dsw-alias-label-primary)}
.gp-cfg__numinput{flex:none;width:80px;height:30px;padding:0 8px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:right}
.gp-cfg__numinput:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.gp-cfg__numinput:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}
.gp-cfg__numinput:disabled{opacity:.5;cursor:default}
.gp-cfg__numunit{flex:none;width:44px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.gp-cfg__rangehint{margin:-4px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
/* Cascading model selects use the platform Menu; the row is label + trigger. */
.gp-cfg__menur{display:flex;align-items:center;gap:8px}
.gp-cfg__menulabel{flex:1;min-width:0;font-size:14px;color:var(--dsw-alias-label-primary)}
.gp-cfg__select-trigger{max-width:240px;min-height:30px;font-size:13px}
.gp-cfg__menu{display:inline-flex;align-items:center;min-width:0}
.gp-cfg__retry{margin-left:6px;padding:0 8px;height:24px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.gp-cfg__retry:hover{background:var(--dsw-alias-interactive-bg-hover)}

/* status dot appended to the shell's Git view-tab button — shown only when the
 * input-bar marker is hidden; colour mirrors the pill branch (synced/dirty). */
.gp-tab-dot{display:inline-block;width:7px;height:7px;margin-left:6px;border-radius:999px;vertical-align:middle;flex:none}
.gp-tab-dot--synced{background:var(--dsw-alias-state-success-primary,#3fb950)}
.gp-tab-dot--dirty{background:var(--dsw-alias-state-warn-primary,#e0982e)}

/* pill wrapper + rounded hover tooltip panel (openviking-manager style):
 * soft radius, layered shadow, subtle border, portaled above the pill.
 * width:max-content is load-bearing: a fixed box with only left set would
 * shrink to the room on its right (a phone row icon left a 36px column). */
.gp-tip{position:fixed;z-index:60;width:max-content;box-sizing:border-box;max-width:520px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:12px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));box-shadow:0 6px 24px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.12);font-size:12px;line-height:1.5;pointer-events:none}
.gp-tip__path{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,monospace);word-break:break-all}
.gp-tip__note{margin-top:4px;color:var(--dsw-alias-label-tertiary)}
.gp-tip--sb{color:var(--dsw-alias-label-secondary);line-height:1.45}
/* Compact panels put the control's centre in the left offset and shift by half
 * the bubble's own width, so it reads as centred on the row icon it explains. */
.gp-tip--center{transform:translateX(-50%)}

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

/* Tab bar: one row. The switcher drops its labels to icon-only and takes the
 * remaining width (the three icon cells stay equal and touch-sized), while the
 * font stepper rides the same row at the trailing edge. The version bar is not
 * mounted at all in compact (Panel.tsx), so the bar keeps a single row.
 * The label stays in the DOM — clipped, not display:none — so the tab keeps its
 * accessible name for screen readers. */
.gp-panel[data-layout="compact"] .gp-tabbar__tabs{flex:1 1 auto}
.gp-panel[data-layout="compact"] .gp-tabbar__tabs--single{flex:0 0 auto}
.gp-panel[data-layout="compact"] .gp-tabbar__trailing{display:flex;flex:none;align-items:center;margin-left:auto}
.gp-panel[data-layout="compact"] .gp-tab__label{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}

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
.gp-files--compact .gp-files__tree,
.gp-files--compact .gp-files__preview{flex:1 1 100%;min-width:0;width:100%}

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
  .gp-sheet,.gp-sheet-backdrop,.gp-modal,.gp-modal-backdrop,.gp-zl-mask{animation:none}
}
`

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
