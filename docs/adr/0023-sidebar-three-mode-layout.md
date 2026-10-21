# ADR-0023：侧边栏三模式布局（wide / stacked / compact）

- 状态：Accepted（2026-10-21）
- 相关：issue #62、`src/client/panel-fit.ts`、`src/client/layout.ts`、`src/client/resizable.ts`、`src/client/Panel.tsx`、ADR-0022

## Context

ADR-0022 把面板接进了右侧边栏，但布局判据只有两档：宽 >620 是 wide（IDE 三栏，列本身要 ~600+ 才排得开），≤620 是 compact（手机式单栏钻取）。侧栏的典型形态是**窄而高**（300–500px 宽、高度与会话区相当），两档都不适配：

- 硬塞 wide：三栏互相挤压，工具栏与统计被裁；
- 落 compact：钻取是为「矮屏、点选进出」设计的，把侧栏的全部高度浪费成一栏列表，看 diff 要反复进出。

备选也被否掉：**继续 wide**（截断如上）；**复用 compact**（交互降级，浪费高度）；**按视口断点**（面板宽度来自容器——侧栏可开可关、宽度可调，视口量不到它；本仓库既有铁律就是「判据都在容器上量」）。

需要的是第三档：**容器窄而高时的 PC 密度布局**。

## Decision

### 判据 = 几何 × 宿主，测量与策略分离

- `layout.ts` 只测量：ResizeObserver 量面板容器得 `PanelLayout { compact, short, width }`（`width` 在首帧测量前为 0）。
- `panel-fit.ts` 纯函数 `panelMode(layout, host)` 出三档之一：
  - **sidebar 宿主**：宽 ≤620 **且矮**（≤520，与 `isCramped` 同源的谓词）→ compact 钻取；宽 ≤620 而高 → **stacked**；621–760 → **stacked，含矮**（该档宽度已不是钻取所针对的「窄栏」，两 band 按共享比吃高度，矮窗口是边缘场景，不为它切换交互模型）；宽 >760（`SIDEBAR_WIDE_BP`）→ 恢复 wide。
  - **conversation 宿主**：判据完全不变（≤620 compact，否则 wide），会话区零影响。
- `data-layout` = `wide | stacked | compact`。stacked 是独立一档，不是 compact 的变体：密度跟 wide 不跟 compact（完整工具栏、两行历史行、全量统计）。
- 首帧 `width = 0` 判 stacked：宁可先降级再按实测升 wide，也不让宽屏三栏在窄栏里闪一帧。

### stacked 的形态

三个子页签统一为上下两 band、中间一条可拖拽行分割线（`.gp-resizer--row`）：

- 总览：上 = 分支列（`clamp(120px, 38%, 180px)`）| 提交历史；下 = 提交详情（sticky 状态栏 + 文件树 + 提交信息）。
- 变更：上 = 提交框 + 变更列表；下 = diff。
- 文件：上 = 目录树；下 = 预览（全屏阅读器仍是原地换样式，不重挂）。

拖拽比**一个值服务三面**（`gp.stacked.split`，初值 55、夹紧 30–75，模块级监听器同步）：分栏习惯是面板级的，改一处三面同动是有意行为。

### STACKED_TIGHT_BP = 380：窄栏的手机同等待遇

stacked 且宽 ≤380 时套用与手机**同一分支**（短标签 `Git/变更/文件`、隐藏字体步进），但**不**触发钻取。380 是拟合常量：全标签+步进实测需 ~360px 行宽，而 flex 压缩不产生 overflow 信号、没有可测的临界点；取值高于侧栏可用最小宽（~300–340）、低于默认 420。若侧栏最小宽低于 300，须重估。

### 同一批交互按同一渲染层定稿

- sticky 状态栏钉在滚动口顶：sticky 钉的是 **margin box**——`.gp-detail__files` 的 padding 与状态栏 margin 的**组合必须让边框盒贴住滚动口顶**（契约由 `stacked-detail-sticky` 的 gap=0 断言钉住，不单独依赖某一条边距声明）；组合一旦错位，滚动时行会从状态栏上方的缝隙漏出、静息时与分栏线留缝。
- diff 头文件名即复制控件：确认走「✓ + 染色 + `aria-label`/反馈期 `title`/视觉隐藏 live 区」，**不替换可见文本**——窄工具栏里裸文本节点会折行撑高整行。
- 行分割线的每个状态声明完整盒子（基础竖条规则按属性级联会漏进来，只写部分属性会塌成残根）。
- 变更页 diff 弹窗 = 行内 `.gp-diff` 原地换样式（`gp-diff--card` + 兄弟遮罩），DiffView 零重挂（ADR-0016 同款手法）。

## Consequences

- 侧栏窄而高 → stacked；拉宽过 760 自动升 wide；窄且矮（≤620 × ≤520）回退钻取。会话区**布局判据**零变化，单测矩阵（`panelMode` 全宿主 × 断点）钉住（本批另含会话区共享的工具栏 / 复制 / sticky 样式改动，见 PR）。
- ADR-0022 里「侧栏 <620 自然进 compact」那条后果由本 ADR 修订：0022 仍管**挂载**，布局判据以本 ADR 为准。
- 一个拖拽比三面共用：单独调某一面的分栏比例做不到，要改就是三面一起变。
- `STACKED_TIGHT_BP` 是无 overflow 信号可测的拟合值；侧栏最小宽、标签文案长度变化都要回来重估。
- 首帧 stacked 意味着宽侧栏（>760）可能有一次 stacked → wide 的升档重排——接受它，拒绝反向的 wide → stacked 降级闪现。
- sticky 状态栏与复制确认的行为被 e2e 钉住（`stacked-detail-sticky` 断言 gap=0、`run` 断言 wide 下 `position:sticky`、`changes-diff-modal` 断言工具栏高度不变），改样式先看这几条。
