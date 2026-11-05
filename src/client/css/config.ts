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
.gp-pill{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:12px;line-height:16px;cursor:pointer;white-space:nowrap;max-width:280px;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-weight:600}
.gp-pill:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-pill__dot{display:none;flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.gp-pill__repo{color:var(--dsw-alias-state-business-primary,#5ac8fa);flex:none;overflow:hidden;text-overflow:ellipsis}
/* Spacing between the repo name and the branch group comes from the pill's own
 * flex gap — an extra margin here would double it. The gap is a tight single
 * interval, not a full character, so the two labels read as one marker. */
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

/* plugin detail config form (plugins.bundle.config slot body) — three tiers:
 * 16px/600 section titles, 14px/500 field titles over 14px labels, 13px hints.
 * The form carries no card of its own: it sits on the detail page like the
 * host's own sections, separated only by the host's hairline divider. */
.gp-cfg{display:flex;flex-direction:column;gap:0}
.gp-cfg__title{margin:0;font-size:14px;font-weight:500;color:var(--dsw-alias-label-primary)}
/* Collapsible sections: a header button collapses its body (aria-controls stays
 * resolvable, so the body is hidden, not unmounted); only the first boots open.
 * The header fills only on hover — bg-layer-1/2 both resolve to the page's own
 * white in the light theme, so a layer token would leave the hover invisible;
 * the solid interactive surface is the one fill that reads there. The -8px
 * bleed lets the hover pill overhang the text column on both sides. */
.gp-cfg__section{display:flex;flex-direction:column;gap:10px;padding:14px 0}
.gp-cfg__section:first-child{padding-top:0}
.gp-cfg__section:last-child{padding-bottom:0}
.gp-cfg__section+.gp-cfg__section{border-top:.5px solid var(--dsw-alias-border-l2)}
.gp-cfg__section-hd{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:0 -8px;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:16px;font-weight:600;text-align:left;cursor:pointer}
.gp-cfg__section-hd:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-state-business-primary)}
.gp-cfg__section-hd:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-cfg__section-hd svg{flex:none;color:var(--dsw-alias-label-tertiary)}
/* Section mark chip: identity at a glance while the body is collapsed. The
 * glyph carries its own colour — the header's svg rule above would pin it.
 * The chip fill is the solid interactive surface: bg-layer-1 resolves to the
 * page's own white in the light theme, which would make the neutral chip
 * disappear. */
.gp-cfg__section-left{display:flex;align-items:center;gap:8px;min-width:0}
.gp-cfg__section-ic{display:flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover-solid)}
.gp-cfg__section-ic svg{color:var(--dsw-alias-label-secondary)}
/* Three semantic hues keep each menu row recognisable at a glance; the repos
 * section stays neutral so its colour cannot read as a warning. Tints too. */
.gp-cfg__section-ic--business{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}
.gp-cfg__section-ic--business svg{color:var(--dsw-alias-state-business-primary)}
.gp-cfg__section-ic--success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.gp-cfg__section-ic--success svg{color:var(--dsw-alias-state-success-primary)}
.gp-cfg__section-ic--warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
.gp-cfg__section-ic--warn svg{color:var(--dsw-alias-state-warn-primary)}
/* The open body hangs off a 2px guide rule centred under the 24px chip (the
 * header's -8px bleed puts the chip at x=0), tinted with the section's tone, so
 * every field reads as belonging to the title above it. Fields sit 20px apart,
 * their own title / control / hint 8px apart. */
.gp-cfg__section-body{display:flex;flex-direction:column;gap:20px;margin-left:11px;padding:4px 0 4px 20px;border-left:2px solid var(--gp-cfg-tone)}
.gp-cfg__section--business{--gp-cfg-tone:color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent)}
.gp-cfg__section--success{--gp-cfg-tone:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent)}
.gp-cfg__section--warn{--gp-cfg-tone:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,transparent)}
.gp-cfg__section--neutral{--gp-cfg-tone:var(--dsw-alias-border-l2)}
.gp-cfg__field{display:flex;flex-direction:column;gap:8px;min-width:0}
/* An author display rule beats the UA's [hidden]{display:none} — restate it. */
.gp-cfg__section-body[hidden]{display:none}
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
.gp-cfg__rangehint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
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
.gp-tip{position:fixed;z-index:60;width:max-content;box-sizing:border-box;max-width:520px;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:12px;background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2));box-shadow:0 6px 24px rgba(0,0,0,.18),0 1px 3px rgba(0,0,0,.12);font-size:12px;line-height:1.5;white-space:pre-line;pointer-events:none}
.gp-tip__path{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-mono,ui-monospace,monospace);word-break:break-all}
.gp-tip__note{margin-top:4px;color:var(--dsw-alias-label-tertiary)}
.gp-tip--sb{color:var(--dsw-alias-label-secondary);line-height:1.45}
/* Compact panels put the control's centre in the left offset and shift by half
 * the bubble's own width, so it reads as centred on the row icon it explains. */
.gp-tip--center{transform:translateX(-50%)}
/* Structured tip content (repository rows): one icon-led line per detail with a
 * hairline above the path, so the branch reads apart from the location. The
 * icon rides the first line box while a long path wraps below it, hence top
 * alignment plus the half-line offset. */
.gp-tip__lines{display:flex;flex-direction:column}
.gp-tip__line{display:flex;gap:6px;align-items:flex-start;min-width:0}
.gp-tip__ic{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary);margin-top:2.5px}
.gp-tip__text{min-width:0}
.gp-tip__line--path .gp-tip__text{word-break:break-all}
.gp-tip__sep{height:1px;background:var(--dsw-alias-border-l2);margin:6px 0}
`
