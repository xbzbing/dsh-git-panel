# ADR-0031：提交历史的列宽按 locale 与列宽实测决定

- 状态：Accepted（2026-11-12）
- 相关：`src/client/time-column.ts`、`src/client/use-time-column.ts`、`src/client/commit-columns.ts`、`src/client/use-element-width.ts`、`src/client/OverviewTab.tsx`、`src/client/overview-rows.tsx`、`src/client/css/overview.ts`、ADR-0023

## Context

wide 档的提交行是五列网格：`graph | 标题 | 哈希 72px | 作者 120px | 相对时间`。最后两处宽度是常量，各自出了问题：

- **相对时间列固定 96px**。这一列的文案由 locale 决定，长度差异极大：中文「刚刚 / 9999 天前」实测 53px，俄文「9999 дн. назад」83px。96px 对中文留下约 40px 空带（用户最初问的「最右侧那段空白」就是它），对俄文又刚好贴边。按语言写一张宽度表也不行：`ctx.locale` 只暴露 `register` / `bind`，不暴露当前 locale id，未来还会加语言，且字号档会缩放。
- **五列的最小宽度大于历史列的最小宽度**。`.gp-col--mid` 的 `min-width:150px`，左右栏与分隔条再吃掉固定宽度，于是面板 621–900px 时历史列只有 150–350px，而五列最小需要 ~436px。网格因此溢出自己的行：最右的日期列探出行右缘（在选中底色和 hover 底色之外），同时列表获得横向滚动能力——`overflow-y:auto` 让 `overflow-x` 的计算值变成 `auto`。选中底色是滚动口 padding box 的绝对定位子元素，不随内容滚动，任何 `scrollLeft ≠ 0` 都会把它和行错位，用户看到的正是「底色到日期中间就断了」。

备选被否掉：**按 locale id 查表**（拿不到 id、新增语言要改代码）；**继续用固定 96px 只调小**（俄文会被裁）；**把五列改成两行**（wide 档的信息密度是有意的，stacked/compact 已经把两行式用掉了）；**允许横向滚动兜底**（正是错位的原因）。

## Decision

### 日期列：量当前 locale 的实际输出

`time-column.ts` 是纯策略：四个样本按键取各单位的最大形态（`time.justNow`、59 分钟、23 小时、9999 天——四位数覆盖任何真实提交），取最宽者 `ceil(px) + 4`，夹在 `[56, 96]`。`use-time-column.ts` 用 canvas 按 `11px + 继承字体族` 量：canvas 返回未缩放的 CSS px，与 grid 轨道同单位；DOM 探针返回的是面板 zoom 后的像素，需要再除回去。语言切换靠「渲染出来的标签串」触发重算（`t()` 的引用是稳定的，看不出语言变化）。

无法测量（无 canvas、字体字符串被 canvas 拒绝、标签为空）时回落到 96px：宁可宽一点，也不要一个塌掉的轨道。

### 列集：按列表实测宽度决定丢哪一列

`commit-columns.ts` 是纯策略，`use-element-width.ts` 只用 ResizeObserver 量列表自身宽度。三档：

| 档位 | 模板 | 何时使用 |
| --- | --- | --- |
| 五列 | `graph 标题 哈希 作者 日期` | 列表宽 ≥ graph + 100 + 72 + 120 + 日期 + 52 |
| 四列 | 丢作者 | ≥ graph + 100 + 72 + 日期 + 44 |
| 三列 | 丢哈希 | 其余 |

- 先丢作者、再丢哈希：两者在提交详情页和 hover 卡片里都还有，标题与日期没有替代入口。
- 阈值是**舒适线**（标题至少 100px），不是 fit 判定：真正保证不溢出的是下面两条轨道约束。
- 图轨与标题轨都可收缩：图轨 `minmax(0, graphW)`，标题轨 `minmax(0,1fr)`；`.gp-graph-cell` 加 `overflow:hidden` 把 SVG 裁到实际宽度。`graphW = lanes × 14` 没有上界（首页常见 5–15 条并发 lane），固定图轨是最初修好「日期探出行外」后仍然溢出的原因。
- 首帧 `available = 0` 保留五列：所有宽度都从它降级，避免窄栏先闪一帧降级布局。
- `.gp-history__list` 的 `overflow-x:hidden` 是**兜底**，不承担拟合：轨道约束保证行不出框，禁止横向滚动保证底色不会与行错位。

## Consequences

- 中文的日期列从 96px 收到 58px，那 38px 还给标题；俄文 88px 仍不裁切。没有 locale 触顶 96。
- 窄历史列（面板 621–900）会丢掉作者列，更窄时再丢哈希列——这是可见的信息损失，但比日期被裁或底色错位好；hover 卡片与详情页仍有这两项。
- 图轨在窄档会被裁（多 lane 仓库只看得到左侧部分 lane），且在 150px 下界叠加宽图时，定长轨会先吃掉自由空间，标题轨可能被压到 0——CSS 的轨道分配对非 `fr` 轨优先。这是有意取舍：行不出框、日期不丢优先。
- 极端窄（低于 `.gp-col--mid` 的 150px 下界）无处可让，日期会被 `overflow:hidden` 裁掉；这个宽度布局自身已不可用，未再为它设兜底档。
- 新增的常量与 CSS 是双源：`test/unit/commit-columns.test.mjs` 钉 `gap` / 横向 padding，`test/unit/time-column.test.mjs` 钉 `.gp-commit-date` 的 `font-size`。改 CSS 必须同步常量，否则所有阈值一起偏。
- `test/e2e/history-time-column.mjs` 是这条契约的浏览器侧钉子：语言切换（zh↔de）、字号放大档、七个面板宽度（含 621 这个 150px 下界）下的「不溢出 / 日期在行内 / 底色与列表同宽 / 无横向滚动」。窄档用俄文（88px 日期轨）跑，保证回归能真的红。
- 字号档（`data-font-delta` 的 `zoom`）不参与测量：canvas 与 grid 轨道都在未缩放坐标系，缩放同时作用于文字和轨道。
- 未来若日期单位增加（例如「刚刚」之外的秒级、或带年份的绝对日期），必须同步 `time-column.ts` 的样本表，否则列会被量窄。
