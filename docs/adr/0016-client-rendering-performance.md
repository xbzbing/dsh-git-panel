# ADR-0016：客户端渲染性能约定

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/client/virtual-list.ts`、`src/client/use-viewport.ts`、`src/client/highlight-cache.ts`、`src/client/ImageZoom.tsx`

## Context

这个面板要渲染的是「可能很大」的数据：几千行的文件、几千个变更、上百个提交、高分辨率图片。同时 React 的浅比较与浏览器的事件模型有几个**反直觉的坑**，踩了以后性能或交互会静默变差。

具体三类问题：

1. **挂载量**：长列表如果全量挂载，DOM 节点数与语法高亮开销都随文件大小线性增长（ADR-0012 的实测：8456 个节点）。
2. **memo 失效**：`memo` 组件如果 props 里出现渲染期新建的对象字面量，浅比较永远不等，整套高亮白缓存。
3. **图片缩放的 CSS/事件陷阱**：`.gp-zoom__img` 不加 `flex:none` 时，放大超过 100% 不生效（flex 收缩把图压回去）；拖拽用 `setPointerCapture` 会改写 click 的目标，导致「拖完松手」被当成点击。

## Decision

- **长列表虚拟化**：变更列表、源码视图、DiffView 一律用 `virtual-list.ts` + `use-viewport.ts`；查找跳转到窗口外命中时**窗口吸附到命中邻域**，不挂载中间的连续区间。
- **文件差异弹窗的「文件」视图是源码视图的另一种入口**：复用 `CodePreview` 的 wrap/nowrap 两档（挂载上限见 ADR-0012，不得为全选放大）；Ctrl/⌘+A 仅在全部行已挂载时是完整选区，虚拟档必须提示并只选已挂载行。
- **`memo` 组件的 props 传普通值**，不在渲染中新建对象字面量。
- **逐行高亮经 `highlight-cache.ts` 缓存**，按行文本复用。
- **图片缩放**：`.gp-zoom__img` 必须 `flex:none`；拖拽的 pointer 事件**挂 window 且不 `setPointerCapture`**。
- **全屏阅读器复用同一预览节点**：`.gp-files__preview--full` 只是把面板里那份预览换成弹窗样式（外加一条标题栏），**不在弹窗里重新渲染文件**。重新渲染会让 HTML 预览重建 iframe、重跑页面脚本（同一份报告实测再等约 12 s），代码视图丢掉滚动与查找状态，Markdown 重解析一遍。任何「换个位置展示同一内容」的需求都要先问：能不能只换样式。
- **HTML 预览的加载遮罩以页面自己的「已绘制」为准**：`blob:` iframe 走独立渲染进程，页面脚本再重也不冻结面板，但面板会在空帧上停留。`load` 事件不可靠——页面的 `load` 回调可以在事件之后继续阻塞自己的渲染几秒；因此 `withReadyPing` 在文档末尾追加一小段脚本，页面在 `load` 后再过两帧 `postMessage` 回报，遮罩据此消失，`load` + 超时仅作兜底（页面 CSP 禁脚本时）。遮罩在 `ready` 后保持挂载但 `opacity:0`、`pointer-events:none`，退出靠淡出，不闪白。
- 固定行高（`VROW_H` / `EST_CODE_H` 等）让窗口数学精确；换行导致的行高变化靠挂载行实测回填。

## Consequences

- 大文件与长列表的挂载量被视口限制，主线程不再被高亮阻塞。
- 代价：虚拟化引入「估算行高 → 实测回填」的复杂度；行高常量与 CSS 必须保持一致，改一边要改另一边。
- 全屏阅读器不重建预览，因此打开/关闭不产生第二份文档内存，也不丢滚动位置；代价是它必须始终是面板里那一个节点，不能为了弹窗布局把它搬进 portal（搬动 DOM 会重载 iframe，实测 `performance.timeOrigin` 变化）。
- 阅读器卡片是 `position:fixed` 且**不 portal**，因此它要求面板的任何祖先都不创建包含块（`transform` / `filter` / `contain: paint` / `perspective`）：一旦宿主加上其中之一，卡片会相对那个祖先定位并被裁剪。宿主侧无法从本仓库保证这一点，这条约束写进了 `styles.ts` 的注释；届时唯一出路是改阅读器的设计，而不是把节点搬进 portal。
- 遮罩与阅读器的开销都被限制在「一次少量节点」：幕布是独立的 `position:fixed` 层而不是 `100vmax` 的 box-shadow 投影（后者会常驻一张视口大小的渲染层），遮罩转 `ready` 后停止 spinner 动画。面板的字体档位用 `zoom` 缩放，阅读器卡片随之等比缩放（尺寸按缩放后的 CSS 像素计算）。
- 这些约定属于「不读代码看不出来、违反就会静默变差」的类型，因此同时写在 `AGENTS.md` 的 UI 约定里。
