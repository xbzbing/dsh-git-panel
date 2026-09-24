/**
 * Global stylesheet, injected once into a plugin-owned <style data-plugin> tag.
 * All colors use dsh theme CSS variables so light/dark themes stay consistent.
 */

const CSS = `
.gp-panel{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;position:relative}
.gp-tabbar{display:flex;align-items:center;gap:4px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.gp-tab{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;cursor:pointer;transition:background .12s ease,color .12s ease}
.gp-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Active tab: primary-tinted fill + primary text + medium weight + a soft ring.
 * Clear enough to spot at a glance, restrained enough not to shout. */
.gp-tab--active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);font-weight:600;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 32%,transparent)}
.gp-tab__icon{display:inline-flex;width:15px;height:15px}
.gp-body{flex:1;min-height:0;display:flex;overflow:hidden}
.gp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;color:var(--dsw-alias-label-tertiary);font-size:12px;padding:24px;text-align:center}
.gp-toolbar{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.gp-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.gp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-btn:disabled{opacity:.5;cursor:default}
.gp-btn--primary{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}
.gp-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.gp-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}

/* three-column overview */
.gp-overview{display:flex;width:100%;min-height:0}
.gp-col{display:flex;flex-direction:column;min-height:0;min-width:0}
.gp-col--left{width:200px;flex:none;border-right:1px solid var(--dsw-alias-border-l2);overflow-y:auto}
.gp-col--mid{flex:1;min-width:0}
.gp-col--right{width:340px;flex:none;border-left:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;min-height:0}
.gp-splitter{flex:none;width:5px;cursor:col-resize;background:transparent}
.gp-splitter:hover{background:var(--dsw-alias-state-business-primary)}
.gp-splitter--row{width:auto;height:5px;cursor:row-resize}

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
.gp-history__list{flex:1;min-height:0;overflow-y:auto}
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

/* commit detail (right pane) */
.gp-detail{display:flex;flex-direction:column;min-height:0;height:100%}
.gp-detail__files{flex:1;min-height:0;overflow-y:auto;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-detail__msg{flex:none;max-height:45%;overflow-y:auto;padding:10px}
.gp-detail__subject{font-weight:600;margin-bottom:6px}
.gp-detail__meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:8px;display:flex;gap:8px;flex-wrap:wrap}
.gp-detail__body{white-space:pre-wrap;font-size:12px;color:var(--dsw-alias-label-secondary);margin:0;font-family:inherit}

/* file tree */
.gp-tree-row{display:flex;align-items:center;gap:6px;padding:3px 10px;cursor:pointer;font-size:12px;border-radius:4px}
.gp-tree-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-tree-row--active{background:var(--dsw-alias-bg-layer-2)}
.gp-tree-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.gp-status-badge{flex:none;width:14px;text-align:center;font-size:11px;font-weight:600}
.gp-status--added{color:var(--dsw-alias-state-success-primary)}
.gp-status--modified{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-business-primary))}
.gp-status--deleted{color:var(--dsw-alias-state-error-primary)}
.gp-status--untracked{color:var(--dsw-alias-label-tertiary)}
.gp-status--renamed{color:var(--dsw-alias-state-business-primary)}

/* changes page */
.gp-changes{display:flex;width:100%;min-height:0}
.gp-changes__left{width:380px;flex:none;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dsw-alias-border-l2)}
.gp-changes__right{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.gp-changes__list{flex:1;min-height:0;overflow-y:auto;padding:4px 0}
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
.gp-stats{display:flex;align-items:center;gap:14px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-secondary);flex:none;flex-wrap:wrap}
.gp-stats__item{display:inline-flex;align-items:center;gap:5px}
.gp-stats__add{color:var(--dsw-alias-state-success-primary)}
.gp-stats__del{color:var(--dsw-alias-state-error-primary)}
.gp-stats__dot{width:6px;height:6px;border-radius:99px;background:var(--dsw-alias-label-tertiary)}

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
.gp-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;overflow:hidden}
.gp-seg__btn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:4px 8px;cursor:pointer}
.gp-seg__btn--active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.gp-diff__scroll{flex:1;min-height:0;overflow:auto;font-family:var(--dsw-font-mono,monospace);font-size:12px}
.gp-diff__table{width:100%;border-collapse:collapse}
.gp-diff__side{display:grid;grid-template-columns:44px 1fr 44px 1fr}
.gp-diff-cell{padding:0 8px;white-space:pre-wrap;word-break:break-all;line-height:18px}
.gp-diff-no{color:var(--dsw-alias-label-tertiary);text-align:right;padding:0 6px;user-select:none;font-size:11px;line-height:18px}
.gp-diff-row--add{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.gp-diff-row--del{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent)}
.gp-diff-row--hunk{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary)}
.gp-feedback{padding:6px 10px;font-size:12px;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);display:flex;align-items:center;gap:8px}

/* commit file-diff overlay (overview → click a file): full-width panel over
 * the graph + detail columns, slid in from the right. */
.gp-overlay{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);animation:gp-slide-in .16s ease}
@keyframes gp-slide-in{from{transform:translateX(2%);opacity:.4}to{transform:translateX(0);opacity:1}}
.gp-overlay__bar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
.gp-overlay__hash{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none}
.gp-overlay__path{font-size:12px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}

/* input-bar pill (zsh style) — repo cyan, (branch) green when synced /
 * orange when dirty. Radius 7px to match dsh-openviking-manager controls. */
.gp-pill{display:inline-flex;align-items:center;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:12px;line-height:16px;cursor:pointer;white-space:nowrap;max-width:280px;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-weight:600}
.gp-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-pill__repo{color:var(--dsw-alias-state-business-primary,#5ac8fa);overflow:hidden;text-overflow:ellipsis}
.gp-pill__git{margin-left:6px}
.gp-pill__git--synced{color:var(--dsw-alias-state-success-primary,#3fb950)}
.gp-pill__git--dirty{color:var(--dsw-alias-state-warn-primary,#e0982e)}
.gp-pill__branch{color:inherit}
.gp-pill--plain{cursor:default;font-weight:500}
.gp-pill--plain .gp-pill__repo{color:var(--dsw-alias-label-secondary)}
.gp-pill--degraded{color:var(--dsw-alias-label-tertiary);cursor:default;font-weight:500}

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
  tag.dataset.plugin = 'dsh-git-panel'
  tag.dataset.pluginCss = id
  tag.textContent = CSS
  document.head.appendChild(tag)
  injected = true
}
