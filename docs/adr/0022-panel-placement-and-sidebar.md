# ADR-0022：Git 面板的入口位置配置与右侧边栏接入

- 状态：Accepted（2026-10-21）
- 相关：issue #62、`src/client/placement.ts`、`src/client/sidebar.ts`、`src/client/placement-state.ts`、`src/client/placement-config.ts`、`src/host/core.ts`

## Context

Git 面板此前只有一个入口：对话区顶部的「Git」视图标签（`conversation.view`，order 30，与「对话」「轨迹」并列）。dsh 的 Web 壳另有一条右侧边栏，能与对话区并排——但插件没有接进去。

这个形态挡住了 issue #62 的目标场景：「打开对话的同时看到 git 的变化」。并排看 diff 与看对话同时进行，在宽屏上是刚需，而窄侧栏加宽对话区是另一条路。

入口位置的诉求是双向的：有人只想占一个位置（屏幕窄、或不想让标签栏变长），有人两个都要。于是需要一个配置。

接右侧边栏不是「加一个按钮」：dsh 的右侧边栏有一套正式的扩展协议（页签类型注册 + 两个 keyed 座位），插件必须按协议接，否则要么不出现、要么出现一个打不开的页签。

## Decision

### 配置模型

新增 host config 字段 `placement`（`.volatile()`，与既有偏好同源）：`'all' | 'tab' | 'sidebar'`，默认 `'all'`。

**不**放进 git 快照：快照是仓库状态（root / branch / changes），入口位置是 UI 挂载偏好；且挂载决策恰恰发生在挂载之前（要先知道位置才能决定挂不挂），放进快照是鸡生蛋。**不**放 localStorage：多 profile / 多浏览器会各自隔离，且与详情页配置表单割裂。

### 两个挂载点，两个独立的注册

「都显示」= 同一个 `Panel` 的两个实例并存（对话区视图标签 + 右侧边栏页签），各自按 `sessionId` 复用同一个 `GitController`（既有 `registry.ts` 的行为，零改动），因此仍是**快照单一来源**。

切换位置 = 释放 + 重建对应注册，不是重载。`slots.inject` 的 disposer 释放这次注入装上的全部注册，所以「摘」是调 disposer、「挂」是再调一次 `slots.inject`。

### 侧边栏按官方三段式协议接入

官方 `dsh-client-ui-sidebar-right` 的页签类型注册分三段，三者用**同一个 `id`** 关联：

1. `ctx.sidebarRightTabs.register(definition)` —— 类型是什么（`id` / `kind` / `priority` / `keepMounted` / `guide`）；
2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: <id> }, Body)` —— 页签主体；
3. `ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: <id> }, Title)` —— 页签标题。

`id` 取包名 `@xbzbing/dsh-git-panel`（实现身份，全局唯一，重复注册会抛）；`kind` 取 `dsh-git-panel`（类型判别式，`openTab` 按它寻址，同 band 冲突会抛，故命名空间化）。

三段**分阶段回滚**：类型注册成功而主体注册失败时，主体缺席会留下一个打开后是空面板的页签类型，且 `id` 会被永久占用。

`keepMounted: true`：提交框里正在写的提交信息是**未保存的编辑**，切走页签不能丢。代价是侧边栏常驻一个 React 树（`Panel` 壳 + 当前子页签，子页签首次访问才挂载），换来草稿不丢，收益大于成本。

### 侧边栏服务是可选的，且可能迟到

`ctx.sidebarRightTabs` 并非每个 dsh 版本都有。所以：

- **不**写进 `module.exports.inject`——那是 cordis 的硬服务等待，缺了就永久 PENDING，整个插件（含标签页）会一起消失。侧边栏一律走**延迟注入**（`ctx.inject(['sidebarRightTabs'], cb)`），等的是**服务**、不是座位声明。
- 服务迟到时，「仅侧边栏」的偏好在那之前**回退为「都显示」**（保标签页），服务到达后再收敛到用户选的形态。

### 能力回退：宁多一入口，不要零入口

选了「仅侧边栏」但宿主**没有**右侧边栏时，若照偏好执行，标签页被摘掉、侧边栏页签又无处可挂——**Git 面板完全不可达，且用户无从恢复**（配置页还在插件详情页里，但用户不会想到去那里）。

因此把 placement 拆成两层：

- `chosen`：用户选的（配置页显示它）；
- `effective`：实际挂载的（**pill 的行为与文案跟它**）。

`effective = resolvePlacement(chosen, sidebarAvailable)`：仅当 `chosen='sidebar'` 且侧边栏缺席时降为 `'all'`，其余情况原样。副作用是回退时 pill 不会谎称「点击在右侧边栏打开」——文案与行为始终一致。

### 面板在侧边栏里的两处适配

- **不设** `data-conversation-composer-overlay`：那是会话视图的「输入框浮在视图上」模式，侧边栏下面没有输入框，设了会留一段空白，并让 `.gp-body` 白白预留 composer 高度（`padding-bottom` 在侧边栏模式归零）。
- **可见性门控**：侧边栏页签可能未展开或未选中。主体读 `useTabInfo().tab.visible` 传给 `Panel`，被隐藏的页签不启动新的自动查询（既有铁律）。`useTabInfo` 在页签记录尚未提交时**会抛**，主体读它时兜住——`Panel` 把「没有可见性」当作可见。

### pill 的行为与文案随 effective 走

pill 视觉上是状态标记（`<仓库> (分支)`），在「仅侧边栏」下点击却变成打开右侧边栏——行为与视觉预期不一致，不说明就像「点了没反应」。因此该模式下 tooltip 增加一行「点击在右侧边栏打开 Git 面板」（复用 pill 既有的自带 tooltip，`.gp-tip__note` 的第二行槽位，无需改 CSS）。

pill 读的是**模块级**的 `effective`（`placement-state.ts`），不是 React state：它在组件渲染之外决定点击去向。位置变化后由既有的 `resyncAll()` 触发快照更新 → pill 重渲染 → 文案跟上，不新增机制。

### 配置页文案

入口位置控件放在配置页**最前**（它决定面板本体挂哪，是最外层的位置性设置），沿用既有分段控件形态。说明段落要点明三件事：两个入口各是什么（给方位锚点）、切换后对话区的 Git 标签页会消失（给事实）、切回即可恢复（给出路）。用户拍板「文案写清楚即可」。

### 平台包依赖

`@deepseek-ai/dsh-client-ui-sidebar-right` 加进 `dsh.client.inject`（浏览器半依赖哪些 platform seed 包），**不加** `peerDependencies`（插件不 import 它的任何值，只用本地类型声明镜像最小面，与 `primitives.d.ts` 同策略）。已核实：boot graph 里缺失的包被 `arriveGraphRow` 静默跳过，所以老版本上不会合成失败。

## Consequences

- 插件在「仅侧边栏」时不再占用对话区标签栏的一个位置；「都显示」是默认，行为与此前一致。
- 宿主没有右侧边栏时，「仅侧边栏」退化为「都显示」而不是消失。用户看到的是标签页还在，配置页显示的仍是他选的「仅侧边栏」——这是有意的：配置页反映**意图**，挂载反映**现实**。
- 首次加载时若配置尚未到达，挂载按 `all` 处理，配置到达后收敛。会看到一次标签页的出现/消失（而不是数量从 0 跳到 1）——**宁可内容闪一下，也不要标签页数量跳变**。
- 侧边栏页签常驻一个 `Panel` 实例（`keepMounted`），大仓库下多一份内存。
- 侧边栏宽度通常 < 620px——面板在其中的布局（compact / stacked / wide 三档判据）由 ADR-0023 决定：窄而高进 stacked，窄且矮才进 compact。本 ADR 只管挂载位置，不管布局档位。
- 官方 dsh 侧栏是 0.2.x 才有的能力；本插件不提升 `dsh` 兼容下限（老版本上仅少一个挂载点，标签页照常）。
- 延迟 inject 的回调只在 `sidebarRightTabs` 服务**出现**时触发；若运行时被禁用（服务消失），不重新探测、不把 effective 降级回 `'tab'`。此时 pill 的 `openTab` 静默失败（try/catch 返回 false），面板入口暂时丢失，等服务重新出现时 inject 回调再次触发并恢复。这是有意取舍：服务消失路径回切会造成布局跳动，且禁用后通常伴随重启。
