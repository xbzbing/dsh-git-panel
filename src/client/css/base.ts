/**
 * 骨架 / tabbar / body / 版本条 / 字号步进 / 通用按钮 / 空态 / tip 包裹。
 *
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的，同一模块内越靠后的规则越优先。要让新规则赢过某条既有规则，
 * 就写在它所在的模块之后。颜色一律走 --dsw-alias-* 变量，深浅色主题才一致。
 */
export const CSS = `
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
/* The sidebar has no composer floating over it, so the reserved height would
   be dead space at the bottom of every view. */
.gp-panel[data-gp-host="sidebar"] .gp-body{padding-bottom:0}
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
/* Icon-only variant (stacked): the check glyph in a pill circle plus the
 * update dot; text rides title/aria instead of a visible row. */
.gp-verbar--icon{gap:6px}
.gp-verbar__btn--icon{width:24px;padding:0;justify-content:center}
.gp-verbar__dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--dsw-alias-state-business-primary)}
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
/* Tip shell: carries the hover handlers so a disabled child still explains
 * itself. Hit-testing must reach the wrapper — a disabled control swallows
 * pointer events in browsers — and the shell itself is a tight flex box so the
 * child's geometry (and the tip anchor) is unchanged. */
.gp-tip-wrap{display:inline-flex;align-items:center;flex:none;min-width:0}
.gp-tip-wrap>.gp-icon-btn:disabled,.gp-tip-wrap>.gp-btn:disabled{pointer-events:none}
`
