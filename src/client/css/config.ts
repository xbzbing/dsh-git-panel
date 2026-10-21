/**
 * 输入栏 pill / 插件配置表单 / tab 状态圆点 / 悬浮提示面板。
 *
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的，同一模块内越靠后的规则越优先。要让新规则赢过某条既有规则，
 * 就写在它所在的模块之后。颜色一律走 --dsw-alias-* 变量，深浅色主题才一致。
 */
export const CSS = `
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
`
