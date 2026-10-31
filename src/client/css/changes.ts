/**
 * 变更页 / 虚拟列表 / 分组 / 行 / 统计条 / 提交编辑器与提交条。
 *
 * 层叠顺序即本文件的挂载顺序（见 styles.ts 的 CSS_PARTS）：写在后面的模块
 * 覆盖前面的，同一模块内越靠后的规则越优先。要让新规则赢过某条既有规则，
 * 就写在它所在的模块之后。颜色一律走 --dsw-alias-* 变量，深浅色主题才一致。
 */
export const CSS = `
/* changes page — height:100% bounds the row to the panel so the right diff
 * scrolls inside its own pane instead of growing and pushing the left commit
 * box below the fold. */
.gp-changes{display:flex;width:100%;height:100%;min-height:0}
.gp-changes__left{flex:0 1 380px;min-width:220px;display:flex;flex-direction:column;min-height:0}
.gp-changes__right{flex:1 1 0;min-width:180px;display:flex;flex-direction:column;min-height:0}
/* files browser: resizable tree column + preview pane */
.gp-files{display:flex;width:100%;height:100%;min-height:0}
/* The tree column keeps the entries in a scrolling child, so long listings
 * stay inside the column instead of growing the pane. */
.gp-files__tree-wrap{flex:0 0 300px;min-width:180px;display:flex;flex-direction:column;min-height:0}
.gp-files__tree{position:relative;flex:1 1 auto;min-width:0;display:flex;flex-direction:column;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 0}
/* The tree column's header row: the absolute browse root (left, elided from
 * the left) and the refresh control (right), above the scrolling entries — it
 * belongs to the tree column (not a full-width row on top of the page) and
 * stays put while the entries scroll under it. */
.gp-files__statusbar{position:relative;flex:none;display:flex;align-items:center;gap:6px;min-width:0;padding:4px 5px 4px 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.gp-files__status-path{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;padding:2px 6px;margin-left:-6px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;text-align:left;cursor:pointer;border-radius:6px}
.gp-files__status-path:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gp-files__status-path:hover .gp-files__status-code{text-decoration:underline}
.gp-files__status-path:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-files__status-path--copied{color:var(--dsw-alias-state-success-primary)}
.gp-files__status-path--copied .gp-files__status-code{text-decoration:none}
/* The dropdown trigger keeps its open state painted after the pointer leaves. */
.gp-files__status-path--open{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gp-files__status-path svg{flex:none}
/* Browse-root dropdown (follow mode): anchored under the status bar, own
 * scroll when the column is short; z-index keeps it over the tree rows. */
.gp-files__rootmenu{position:absolute;top:calc(100% + 2px);left:6px;right:5px;z-index:40;display:flex;flex-direction:column;gap:1px;max-height:min(260px,70vh);overflow-y:auto;overscroll-behavior:contain;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);box-shadow:0 8px 24px rgba(0,0,0,.18)}
.gp-files__rootmenu__item{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-width:0;padding:5px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
.gp-files__rootmenu__item:hover:not(.gp-files__rootmenu__item--active){background:var(--dsw-alias-interactive-bg-hover)}
.gp-files__rootmenu__item:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
/* The active row keeps its fill while hovered; it is also the row a click
 * leaves unchanged. */
.gp-files__rootmenu__item--active{background:var(--gp-select-bg);box-shadow:var(--gp-select-bar);cursor:default}
.gp-files__rootmenu__item--disabled{opacity:.55;cursor:default}
.gp-files__rootmenu__item--disabled:hover:not(.gp-files__rootmenu__item--active){background:transparent}
.gp-files__rootmenu__icon{display:inline-flex;align-items:center;flex:none;color:var(--dsw-alias-label-tertiary)}
.gp-files__rootmenu__item--active .gp-files__rootmenu__icon{color:var(--dsw-alias-state-business-primary)}
.gp-files__rootmenu__text{display:flex;flex-direction:column;gap:1px;flex:1 1 auto;min-width:0}
.gp-files__rootmenu__name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-files__rootmenu__path{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Absolute roots elide from the left (same trick as the status body): the
 * invisible LRM anchors the leading '/', which the ellipsis then swallows. */
.gp-files__rootmenu__path--abs{direction:rtl;unicode-bidi:isolate}
.gp-files__rootmenu__copy{margin-top:3px;padding-top:7px;border-top:1px solid var(--dsw-alias-border-l2);border-radius:0;color:var(--dsw-alias-label-secondary)}
.gp-files__status-code{flex:1 1 auto;min-width:0;display:flex;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px}
/* direction:rtl makes the ellipsis eat from the left, so the tail of the path
 * stays on screen; the invisible LRM the text is prefixed with anchors the
 * leading '/', which the ellipsis then swallows with the rest of the head. */
.gp-files__status-body{flex:0 1 auto;min-width:0;direction:rtl;unicode-bidi:isolate;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-files__refresh{flex:none;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
.gp-files__refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gp-files__refresh:disabled{opacity:.55;cursor:default}
.gp-files__refresh:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-files__refresh--busy svg{animation:gp-spin 1s linear infinite}
.gp-panel[data-layout="compact"] .gp-files__refresh{width:30px;height:30px}
.gp-files__preview{flex:1 1 0;min-width:180px;display:flex;flex-direction:column;min-height:0}
.gp-files__preview-content{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.gp-files__bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}
/* The filename is the copy control: the directory elides from its left (tail
 * kept), the name stays whole, and clicking copies the relative path. */
.gp-files__path{flex:1 1 120px;min-width:0;display:flex;align-items:baseline;overflow:hidden;background:none;border:0;padding:0;margin:0;font:inherit;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;border-radius:4px}
.gp-files__path:hover .gp-files__path-name{text-decoration:underline}
.gp-files__path:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-files__path:disabled{cursor:default}
.gp-files__path--copied{color:var(--dsw-alias-state-success-primary)}
.gp-files__path--copied svg{margin-right:2px;flex:none}
.gp-files__path--error{color:var(--dsw-alias-state-error-primary)}
.gp-files__path-dir{direction:rtl;unicode-bidi:isolate;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}
.gp-files__path-sep{flex:none;color:var(--dsw-alias-label-tertiary)}
.gp-files__path-name{flex:none;color:var(--dsw-alias-label-primary);font-weight:600}
/* No directory before the name: it is the only thing that can shrink, so it
 * takes the space and elides instead of being clipped by the button. */
.gp-files__path-name--root{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-files__copy-path{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px}
.gp-files__copy-path:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-files__copy-path:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-files__copy-path--copied{color:var(--dsw-alias-state-success-primary)}
.gp-files__copy-path--error{color:var(--dsw-alias-state-error-primary)}
/* Icon-only copy control: same box as the neighbouring toolbar glyph buttons
 * (.gp-files__props), so the row keeps one height. */
.gp-files__copy-path.gp-files__copy-icon{display:inline-flex;align-items:center;padding:4px 6px}
/* Icon-only properties entry at the toolbar's far right. The path's flex-grow
 * already pins the trailing cluster to the right edge; a margin-left:auto here
 * would steal that free space and collapse the path to its 120px basis. */
.gp-files__props{flex:none;display:inline-flex;align-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer}
.gp-files__props:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gp-files__props:disabled{opacity:0.5;cursor:default}
.gp-files__props:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.gp-files__props[aria-pressed="true"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent)}
.gp-files__scripts{font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0.02em;padding:5px 6px}
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
/* Copy-content matches the 30px neighbours instead of its 4px/6px icon padding. */
.gp-panel[data-layout="compact"] .gp-files__bar-end .gp-files__copy-icon{height:30px;box-sizing:border-box;padding:0 6px}
.gp-files__bar--compact .gp-files__mode-seg button{padding:0 10px;font-size:12px}
/* Two boxes on purpose: the outer one scrolls, the inner one carries the inset.
 * A sticky child (the platform's code-block banner) sticks to the scrollport's
 * CONTENT edge, so padding on the scroll container would leave a band above the
 * stuck banner that scrolling code shows through. */
.gp-files__markdown{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}
.gp-files__markdown-body{padding:16px 24px;color:var(--dsw-alias-label-primary)}
/* Mermaid figures: the SVG centers and never overflows the pane width; a
 * parse/load failure falls back to the source as a plain code block. */
.gp-mermaid{overflow-x:auto;padding:4px 0}
.gp-mermaid svg{display:block;max-width:100%;height:auto;margin:0 auto}
.gp-mermaid--loading{min-height:64px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-skeleton);color:var(--dsw-alias-label-tertiary)}
.gp-mermaid__loading-text{font-size:12px;line-height:20px}
.gp-mermaid__fallback{overflow:auto;background:var(--dsw-alias-markdown-code-block);border-radius:6px;padding:10px 12px;font-family:var(--dsw-font-mono,monospace);font-size:12px;margin:8px 0}
.gp-files__html-wrap{flex:1;min-height:0;display:flex;flex-direction:column}
.gp-files__html-note{flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
.gp-files__html-note-run{flex:none;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12px}
.gp-files__html-note-run:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-files__html-stage{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.gp-files__html{flex:1;min-height:0;width:100%;border:0;background:#fff}
/* Covers the frame until its load event: a blob: document is drawn by another
 * renderer process, so the panel shows an empty frame in the meantime. */
.gp-files__html-mask{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;transition:opacity .18s ease}
.gp-files__html-mask[data-state="ready"]{opacity:0;pointer-events:none}
/* A page that is merely slow must not look like a dead panel: the mask keeps
 * showing but stops taking clicks, so the tree, the toolbar and the reader
 * stay usable while the page finishes. */
.gp-files__html-mask[data-state="slow"]{pointer-events:none;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 72%,transparent)}
.gp-files__html-mask[data-state="slow"] .gp-files__html-mask-stop{pointer-events:auto}
.gp-files__html-mask-elapsed{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}
.gp-files__html-mask-stop{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px}
.gp-files__html-mask-stop:hover{background:var(--dsw-alias-interactive-bg-hover)}
.gp-files__html-mask-stop:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
/* The platform loader owns its own animation; a transparent mask must not keep
 * it running behind the finished page. */
.gp-files__html-mask-spin{flex:none;display:inline-flex}
.gp-files__html-mask[data-state="ready"] .gp-files__html-mask-spin *{animation:none}
.gp-files__html-mask-label{max-width:80%;text-align:center;line-height:1.5}
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
/* Same gutter contract as the diff view: three digits by default (see
 * gutterWidth in diff.ts), widened by the container when a file is longer. */
.gp-files__single{display:grid;grid-template-columns:var(--gp-gutter-w,calc(3ch + 10px)) 1fr}
/* Virtualized source view: the outer box is a fixed-height spacer that owns the
 * scrollbar; each mounted row is absolutely positioned at its line offset and
 * lays its line-number gutter + code cell on one fixed-height row. */
.gp-files__single--virt{display:block;position:relative;width:100%}
.gp-files__row{position:absolute;left:0;right:0;display:grid;grid-template-columns:var(--gp-gutter-w,calc(3ch + 10px)) 1fr;height:20px}
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
.gp-changes__list{position:relative;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 0}
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
/* Group select-all checkbox (issue #60): sits between the chevron and the
 * label; a padded wrapper keeps the tap target ≥24px without changing the
 * 14px box itself. */
.gp-group-head__pick{margin:0 2px;padding:6px;box-sizing:content-box;display:inline-flex;align-items:center;flex:none;cursor:pointer}
.gp-group-head__pick .gp-check{margin:0}
/* Truncation bar under the change list: expand lifts the host list cap,
 * collapse returns to the capped poll. Sits between list and stash section. */
.gp-changes__expandbar{display:flex;align-items:center;gap:8px;padding:6px 12px;font-size:11px;color:var(--dsw-alias-label-tertiary);border-top:1px solid var(--dsw-alias-border-l2)}
.gp-changes__expandbar__text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gp-file-row{display:flex;align-items:center;gap:8px;padding:4px 10px 4px 20px;cursor:pointer;font-size:12px;border-radius:4px}
.gp-file-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Selected change row: identical accent to the Git overview commit list
 * (business-primary 16% tint + a 3px inset left bar), for one selection
 * language across panes. */
.gp-file-row--active,.gp-file-row--active:hover{background:transparent}
/* Actions occupy a fixed lane at all times (visibility toggle, not display)
 * so hovering never changes the row's width — no wobble. */
.gp-file-row__actions{margin-left:auto;display:flex;gap:4px;flex:none;visibility:hidden}
.gp-file-row:hover .gp-file-row__actions{visibility:visible}
/* The trash glyph sits in an aria-hidden span; without flex the span is a
 * baseline inline box and the SVG rides above the "+" text's centre line. */
.gp-file-row__actions .gp-icon-btn>span{display:inline-flex;align-items:center;justify-content:center}

/* stats bar */
.gp-stats{display:flex;align-items:center;gap:6px;padding:8px 12px;min-height:33px;box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-secondary);flex:none;flex-wrap:wrap}
.gp-stats__item{display:inline-flex;align-items:center;gap:5px}
.gp-stats__item--staged{color:var(--dsw-alias-state-business-primary)}
.gp-stats__item--modified{color:var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-business-primary))}
.gp-stats__item--untracked{color:var(--dsw-alias-label-secondary)}
/* The two timestamps wrap as one unit and never split across lines. */
.gp-stats__times{display:inline-flex;align-items:center;gap:14px;flex-wrap:nowrap}
.gp-stats__add{color:var(--dsw-alias-state-success-primary)}
.gp-stats__del{color:var(--dsw-alias-state-error-primary)}
/* "simplified" marker on a huge change set: muted + help cursor + dotted hint. */
.gp-stats__partial{color:var(--dsw-alias-label-tertiary);cursor:help;text-decoration:underline dotted;text-underline-offset:2px}
/* Compact stats bar: the counts on one clipped, never-wrapping line. A cramped
 * panel (narrow and short) drops the timestamps entirely so the bar never costs
 * a second row above the change list; a narrow-but-tall panel keeps them and
 * spends that row, since it has the height to spare. */
.gp-stats--compact{padding:6px 8px 6px 12px;gap:4px 8px;align-items:center}
.gp-stats--compact .gp-stats__main{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;overflow:hidden;white-space:nowrap}
.gp-stats--compact .gp-stats__main>.gp-stats__item{flex:none}
/* Timed compact: the timestamps take a full row of their own under the counts. */
.gp-stats--timed{flex-wrap:wrap}
.gp-stats--timed>.gp-stats__main{flex:1 1 100%}
.gp-stats--timed>.gp-stats__times{flex:1 1 100%;padding-top:2px}
/* Chips: every count is its own pill, so the bar reads as discrete facts instead
 * of one run-on line. Staged and modified tint their background with their
 * status colour; the plain ones (file count, lines, untracked) sit on the shared
 * hover surface — untracked is the file tree's muted state, not an alert.
 * color-mix() keeps one declaration per state, in both themes — the tint is the
 * status colour, not a hard-coded hex. */
.gp-stats__chip{padding:1px 8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);line-height:18px;white-space:nowrap}
.gp-stats__chip--quiet{background:transparent;padding-left:0}
.gp-stats__item--staged.gp-stats__chip{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}
.gp-stats__item--modified.gp-stats__chip{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,var(--dsw-alias-state-business-primary)) 14%,transparent)}

/* commit box */
.gp-commitbox{flex:none;border-top:1px solid var(--dsw-alias-border-l2);padding:8px 10px;display:flex;flex-direction:column;gap:8px}
.gp-commitbox__msg{width:100%;min-height:72px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:8px;box-sizing:border-box}
.gp-commitbox__msg-wrap{position:relative;display:block}
.gp-commitbox__msg-wrap--busy .gp-commitbox__msg{padding-right:28px}
/* Loading indicator inside the disabled field (AI suggest in flight): a
 * positioning box around the platform loader. */
.gp-commitbox__spin{position:absolute;top:8px;right:8px;display:inline-flex;pointer-events:none}
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
/* Generation entry in the folded bar: the icon plus the two letters only, so it
 * fits beside Commit on a phone (its accessible name keeps the full wording). */
.gp-commitbar__ai{flex:none;padding:0 8px;gap:5px}
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
`
