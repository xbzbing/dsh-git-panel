/**
 * Global stylesheet, injected once into a plugin-owned <style data-plugin> tag.
 * All colors use dsh theme CSS variables so light/dark themes stay consistent.
 */

const CSS = `
.gp-panel{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;position:relative}
.gp-tabbar{display:flex;align-items:center;gap:4px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
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
.gp-tab{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;transition:background .12s ease,color .12s ease}
.gp-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Active tab: primary-tinted fill + primary text + medium weight + a soft ring.
 * Clear enough to spot at a glance, restrained enough not to shout. */
.gp-tab--active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);font-weight:600;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 32%,transparent)}
.gp-tab__icon{display:inline-flex;width:15px;height:15px}
.gp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;color:var(--dsw-alias-label-tertiary);font-size:12px;padding:24px;text-align:center}
.gp-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.gp-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.gp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-btn:disabled{opacity:.5;cursor:default}
.gp-btn--primary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}
.gp-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gp-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}

/* three-column overview — side columns shrink (with a min floor) instead of
 * staying fixed, and the middle keeps a guaranteed min so it never collapses to
 * blank when a right sidebar narrows the panel. */
.gp-overview{display:flex;width:100%;min-height:0}
.gp-col{display:flex;flex-direction:column;min-height:0;min-width:0}
.gp-col--left{flex:0 1 200px;min-width:130px;border-right:1px solid var(--dsw-alias-border-l2);overflow-y:auto}
.gp-col--mid{flex:1 1 0;min-width:150px}
.gp-col--right{flex:0 1 340px;min-width:190px;border-left:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;min-height:0}

/* branch list */
.gp-branch-group{padding:2px 0}
.gp-branch-group__head{display:flex;align-items:center;gap:6px;padding:4px 10px;font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer;user-select:none}
.gp-branch-row{display:flex;align-items:center;gap:6px;padding:4px 10px 4px 22px;cursor:pointer;border-radius:6px;font-size:12px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gp-branch-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-branch-row--active{color:var(--dsw-alias-state-business-primary)}
.gp-branch-row--current{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-business-primary))}
.gp-branch-row__track{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary)}

/* history */
.gp-history{display:flex;flex-direction:column;height:100%;min-height:0}
/* overscroll-behavior:contain keeps a wheel gesture that reaches the top/bottom
 * of the commit list from bubbling out and scrolling the whole conversation. */
.gp-history__list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.gp-commit-row{display:grid;align-items:center;gap:8px;height:30px;padding:0 10px;cursor:pointer;border-bottom:1px solid transparent}
.gp-commit-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-commit-row--active{background:var(--dsw-alias-bg-layer-2)}
.gp-commit-subject{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-commit-hash{font-family:var(--dsw-font-mono,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gp-commit-author{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-commit-date{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.gp-ref-chip{display:inline-block;padding:0 6px;margin-right:4px;border-radius:8px;font-size:10px;line-height:16px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2)}
.gp-ref-chip--head{background:var(--dsw-alias-state-business-primary);color:#fff;border-color:transparent}
.gp-ref-chip--remote{color:var(--dsw-alias-label-tertiary)}
.gp-ref-chip--tag{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-label-secondary))}
.gp-graph-cell{position:relative}
.gp-graph-svg{display:block}
.gp-search{flex:1;height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 10px;box-sizing:border-box}
.gp-search:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-select{height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:0 6px}

/* commit detail (right pane): the changed-file tree and the commit message
 * split the column in half, each scrolling on its own. Equal halves keep the
 * comment visible instead of the file tree pushing it below the fold. */
.gp-detail{display:flex;flex-direction:column;min-height:0;height:100%}
.gp-detail__files{flex:1 1 50%;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-detail__msg{flex:1 1 50%;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:10px}
.gp-detail__subject{font-weight:600;margin-bottom:6px}
.gp-detail__meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap}
.gp-detail__body{white-space:pre-wrap;font-size:12px;color:var(--dsw-alias-label-secondary);margin:0;font-family:inherit}

/* file tree — 13px to match the middle history list (was 12px, felt cramped) */
.gp-tree-row{display:flex;align-items:center;gap:6px;padding:3px 10px;cursor:pointer;font-size:13px;border-radius:4px}
.gp-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-tree-row--active{background:var(--dsw-alias-bg-layer-2)}
.gp-tree-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
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
.gp-changes__left{flex:0 1 380px;min-width:220px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l2)}
.gp-changes__right{flex:1 1 0;min-width:180px;display:flex;flex-direction:column;min-height:0}
.gp-changes__list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 0}
.gp-check{width:14px;height:14px;flex:none;cursor:pointer}
.gp-group-head{display:flex;align-items:center;gap:6px;padding:5px 10px;font-size:11px;color:var(--dsw-alias-label-tertiary);cursor:pointer;user-select:none}
.gp-file-row{display:flex;align-items:center;gap:8px;padding:4px 10px 4px 20px;cursor:pointer;font-size:12px;border-radius:4px}
.gp-file-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-file-row--active{background:var(--dsw-alias-bg-layer-2)}
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

/* commit box */
.gp-commitbox{flex:none;border-top:1px solid var(--dsw-alias-border-l2);padding:8px 10px;display:flex;flex-direction:column;gap:8px}
.gp-commitbox__msg{width:100%;min-height:72px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:8px;box-sizing:border-box}
.gp-commitbox__msg:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
.gp-commitbox__row{display:flex;align-items:center;gap:10px}
.gp-commitbox__amend{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gp-commitbox__actions{margin-left:auto;display:flex;gap:6px}

/* diff view */
.gp-diff{flex:1;min-height:0;display:flex;flex-direction:column}
.gp-diff__toolbar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.gp-diff__path{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-diff__expand{border:1px solid var(--dsw-alias-border-l2);border-radius:7px}
.gp-diff__expand:disabled{opacity:.45;cursor:not-allowed}
.gp-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.gp-seg__btn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:5px 10px;cursor:pointer;transition:background .12s ease,color .12s ease}
.gp-seg__btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-seg__btn--active{background:var(--dsw-alias-state-business-primary);color:#fff}
.gp-seg__btn--active:hover{background:var(--dsw-alias-state-business-primary)}
.gp-diff__scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;font-family:var(--dsw-font-mono,monospace);font-size:12px}
.gp-diff__side{display:grid;grid-template-columns:48px 1fr 48px 1fr}
.gp-diff-cell{padding:0 4px;white-space:pre-wrap;word-break:break-all;line-height:20px}
.gp-diff-no{color:var(--dsw-alias-label-tertiary);text-align:right;padding:0 6px;user-select:none;font-size:11px;line-height:20px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 4%,transparent);border-right:1px solid var(--dsw-alias-border-l2)}
.gp-diff-row--add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 15%,transparent);box-shadow:inset 2px 0 0 color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,transparent)}
.gp-diff-row--del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 15%,transparent);box-shadow:inset 2px 0 0 color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,transparent)}
.gp-diff-row--hunk{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);padding:3px 8px;font-size:11px;font-weight:600;border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2)}
/* collapsed-context band with expand controls (spans both sides) */
.gp-diff-row--gap{display:flex;align-items:center;justify-content:center;gap:6px;padding:2px 10px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent);border-top:1px solid var(--dsw-alias-border-l2);border-bottom:1px solid var(--dsw-alias-border-l2)}
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
.gp-imgcmp__img{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;align-items:center;justify-content:center;padding:10px;background-color:var(--dsw-alias-bg-layer-1);background-image:linear-gradient(45deg,color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent) 25%,transparent 25%,transparent 50%,color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent) 50%,color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent) 75%,transparent 75%);background-size:16px 16px}
.gp-imgcmp__img img{max-width:100%;max-height:100%;object-fit:contain;image-rendering:auto}
.gp-imgcmp__missing{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:12px;background:var(--dsw-alias-bg-layer-1)}
/* syntax highlighting (highlight.js token classes mapped to dsh theme vars) */
.gp-hljs .hljs-comment,.gp-hljs .hljs-quote{color:var(--dsw-alias-label-tertiary);font-style:italic}
.gp-hljs .hljs-keyword,.gp-hljs .hljs-selector-tag,.gp-hljs .hljs-literal,.gp-hljs .hljs-doctag,.gp-hljs .hljs-type,.gp-hljs .hljs-name,.gp-hljs .hljs-strong{color:var(--dsw-alias-state-business-primary)}
.gp-hljs .hljs-string,.gp-hljs .hljs-regexp,.gp-hljs .hljs-addition,.gp-hljs .hljs-meta-string{color:var(--dsw-alias-state-success-primary)}
.gp-hljs .hljs-number,.gp-hljs .hljs-symbol,.gp-hljs .hljs-bullet,.gp-hljs .hljs-link,.gp-hljs .hljs-deletion{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-error-primary))}
.gp-hljs .hljs-title,.gp-hljs .hljs-title.function_,.gp-hljs .hljs-section,.gp-hljs .hljs-selector-id,.gp-hljs .hljs-selector-class{color:var(--dsw-alias-label-primary-bluish,var(--dsw-alias-state-business-primary))}
.gp-hljs .hljs-attr,.gp-hljs .hljs-attribute,.gp-hljs .hljs-variable,.gp-hljs .hljs-template-variable,.gp-hljs .hljs-property,.gp-hljs .hljs-params{color:var(--dsw-alias-label-primary)}
.gp-hljs .hljs-built_in,.gp-hljs .hljs-class .hljs-title,.gp-hljs .hljs-tag{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-business-primary))}
.gp-hljs .hljs-meta{color:var(--dsw-alias-label-tertiary)}
.gp-hljs .hljs-emphasis{font-style:italic}
.gp-feedback{padding:6px 10px;font-size:12px;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);display:flex;align-items:center;gap:8px}

/* commit file-diff modal (overview → click a file): a centered dialog over a
 * dimmed backdrop, closed by Esc / backdrop click / the close button. */
.gp-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:40px;background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 62%,transparent);backdrop-filter:blur(2px);animation:gp-fade-in .12s ease}
@keyframes gp-fade-in{from{opacity:0}to{opacity:1}}
.gp-modal{display:flex;flex-direction:column;width:min(920px,86vw);height:min(680px,82vh);border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:14px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 24px 64px rgba(0,0,0,.32),0 4px 12px rgba(0,0,0,.18);overflow:hidden;animation:gp-modal-in .18s cubic-bezier(.16,1,.3,1)}
@keyframes gp-modal-in{from{transform:translateY(12px) scale(.97);opacity:0}to{transform:none;opacity:1}}
.gp-modal__bar{display:flex;align-items:center;gap:10px;padding:11px 12px 11px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex:none}
.gp-modal__fileicon{display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary);flex:none}
.gp-modal__path{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.gp-modal__dir{color:var(--dsw-alias-label-tertiary)}
.gp-modal__name{color:var(--dsw-alias-label-primary);font-weight:600}
.gp-modal__hash{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);padding:2px 7px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-1));flex:none}
.gp-modal__sum{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-family:var(--dsw-font-mono,ui-monospace,monospace);flex:none}
.gp-modal__close{flex:none}
.gp-modal__scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;font-family:var(--dsw-font-mono,monospace);font-size:12px;background:var(--dsw-alias-bg-layer-2)}

/* commit hover card (middle column): pointer-anchored, lists changed files */
.gp-hovercard{position:fixed;z-index:70;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:10px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));box-shadow:0 8px 28px rgba(0,0,0,.2),0 1px 3px rgba(0,0,0,.12);font-size:12px;pointer-events:none;max-height:60vh;overflow:hidden;display:flex;flex-direction:column}
.gp-hovercard__subject{font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-hovercard__meta{display:flex;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:8px}
.gp-hovercard__loading{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gp-hovercard__body{margin:0;font-family:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;overflow-y:auto;min-height:0}

/* input-bar pill (zsh style) — repo cyan, (branch) green when synced /
 * orange when dirty. Fully-rounded (999px) to match the dsh-openviking-manager
 * input-bar toggle pill. */
.gp-pill{display:inline-flex;align-items:center;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:12px;line-height:16px;cursor:pointer;white-space:nowrap;max-width:280px;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-weight:600}
.gp-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-pill__repo{color:var(--dsw-alias-state-business-primary,#5ac8fa);overflow:hidden;text-overflow:ellipsis}
.gp-pill__git{margin-left:6px}
.gp-pill__git--synced{color:var(--dsw-alias-state-success-primary,#3fb950)}
.gp-pill__git--dirty{color:var(--dsw-alias-state-warn-primary,#e0982e)}
.gp-pill__branch{color:inherit}
.gp-pill--plain{cursor:default;font-weight:500}
.gp-pill--plain .gp-pill__repo{color:var(--dsw-alias-label-secondary)}
.gp-pill--degraded{color:var(--dsw-alias-label-tertiary);cursor:default;font-weight:500}

/* plugin detail config form (plugins.bundle.config slot body) */
.gp-cfg{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.gp-cfg__title{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.gp-cfg__row{display:inline-flex;align-items:center;gap:10px;cursor:pointer;user-select:none}
/* 开关清零 border/padding：::after 按 padding box 定位，UA 默认 1px 边框会把定位框上下各缩 1px，滑块上缘就多出 1px 空隙。 */
.gp-cfg__switch{appearance:none;-webkit-appearance:none;flex:none;width:32px;height:18px;margin:0;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-border-l2);position:relative;transition:background .15s ease;cursor:pointer}
.gp-cfg__switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:999px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s ease}
.gp-cfg__switch:checked{background:var(--dsw-alias-state-business-primary)}
.gp-cfg__switch:checked::after{transform:translateX(14px)}
.gp-cfg__switch:disabled{opacity:.5;cursor:default}
.gp-cfg__switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-cfg__text{font-size:13px;color:var(--dsw-alias-label-primary)}
.gp-cfg__hint{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}
.gp-cfg__err{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}

/* status dot appended to the shell's Git view-tab button — shown only when the
 * input-bar marker is hidden; colour mirrors the pill branch (synced/dirty). */
.gp-tab-dot{display:inline-block;width:7px;height:7px;margin-left:6px;border-radius:999px;vertical-align:middle;flex:none}
.gp-tab-dot--synced{background:var(--dsw-alias-state-success-primary,#3fb950)}
.gp-tab-dot--dirty{background:var(--dsw-alias-state-warn-primary,#e0982e)}

/* pill wrapper + rounded hover tooltip panel (openviking-manager style):
 * soft radius, layered shadow, subtle border, portaled above the pill. */
.gp-pill-wrap{display:inline-flex}
.gp-tip{position:fixed;z-index:60;max-width:520px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:12px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));box-shadow:0 6px 24px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.12);font-size:12px;line-height:1.5;pointer-events:none}
.gp-tip__path{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,monospace);word-break:break-all}
.gp-tip__note{margin-top:4px;color:var(--dsw-alias-label-tertiary)}
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
