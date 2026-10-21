/**
 * 提交动作：重置 / 分支切换确认 / 标签 chips / 贮藏 / 发布条 / 悬停卡。
 *
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的，同一模块内越靠后的规则越优先。要让新规则赢过某条既有规则，
 * 就写在它所在的模块之后。颜色一律走 --dsw-alias-* 变量，深浅色主题才一致。
 */
export const CSS = `
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

/* Publish strip above the commit editor: shown only while the branch exists
 * solely on the local side, so a fresh local branch still has a visible way
 * onto the remote (issue #63). Mirrors VSCode's "Publish Branch" affordance —
 * a full-width primary action directly above the commit message field. */
.gp-publishbar{flex:none;border-top:1px solid var(--dsw-alias-border-l2);padding:8px 10px}
.gp-publishbar__btn{width:100%;justify-content:center}
.gp-panel[data-layout="compact"] .gp-publishbar__btn{height:30px}

/* commit hover card (middle column): pointer-anchored, lists changed files */
.gp-hovercard{position:fixed;z-index:70;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:10px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));box-shadow:0 8px 28px rgba(0,0,0,.2),0 1px 3px rgba(0,0,0,.12);font-size:12px;pointer-events:none;max-height:60vh;overflow:hidden;display:flex;flex-direction:column}
.gp-hovercard__subject{font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:4px;white-space:normal;word-break:break-word;overflow-wrap:anywhere}
.gp-hovercard__meta{display:flex;align-items:baseline;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:8px;flex-wrap:wrap}
.gp-hovercard__loading{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gp-hovercard__body{margin:0;font-family:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;overflow-y:auto;min-height:0}
`
