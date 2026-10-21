/**
 * 弹窗：文件 diff 弹窗 / 小对话框 / 文件属性面板。
 *
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的，同一模块内越靠后的规则越优先。要让新规则赢过某条既有规则，
 * 就写在它所在的模块之后。颜色一律走 --dsw-alias-* 变量，深浅色主题才一致。
 */
export const CSS = `
/* commit file-diff modal (overview → click a file): a centered dialog over a
 * dimmed backdrop, closed by Esc / backdrop click / the close button. */
.gp-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:40px;background:color-mix(in srgb,var(--dsw-alias-bg-base,#000) 62%,transparent);backdrop-filter:blur(2px);animation:gp-fade-in .12s ease}
@keyframes gp-fade-in{from{opacity:0}to{opacity:1}}
.gp-modal{display:flex;flex-direction:column;position:relative;width:min(920px,86vw);height:min(680px,82vh);border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:14px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 24px 64px rgba(0,0,0,.32),0 4px 12px rgba(0,0,0,.18);overflow:hidden;animation:gp-modal-in .18s cubic-bezier(.16,1,.3,1)}
@keyframes gp-modal-in{from{transform:translateY(12px) scale(.97);opacity:0}to{transform:none;opacity:1}}
.gp-modal__bar{display:flex;align-items:center;gap:10px;padding:11px 12px 11px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);flex:none}
.gp-modal__fileicon{display:inline-flex;align-items:center;color:var(--dsw-alias-label-tertiary);flex:none}
.gp-modal__path{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
/* Copy-enabled variant of the header path (file-diff modal): button reset +
 * affordance + inline confirmation tint. Kept in a modifier so plain modal
 * titles sharing .gp-modal__path never pick up a pointer cursor. */
.gp-modal__path--copy{position:relative;background:none;border:0;padding:0;margin:0;font:inherit;font-size:13px;color:inherit;text-align:left;cursor:pointer;border-radius:4px}
.gp-modal__path--copy:hover .gp-modal__name{text-decoration:underline}
.gp-modal__path--copy:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-modal__path--copied{color:var(--dsw-alias-state-success-primary);text-overflow:clip}
.gp-modal__path--copied svg{margin-right:2px}
.gp-modal__path--copied .gp-modal__name{color:var(--dsw-alias-state-success-primary)}
.gp-modal__path--error{color:var(--dsw-alias-state-error-primary);text-overflow:clip}
.gp-modal__path--error .gp-modal__name{color:var(--dsw-alias-state-error-primary)}
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
`
