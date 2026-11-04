# ADR-0028：右键菜单采用自有目标族、平台动作借用与面板实例归属

- 状态：Accepted（2026-11-05）
- 相关：ADR-0002、ADR-0010、ADR-0026、`src/client/menu-*.ts`、`src/client/use-panel-menu.ts`、dsh `@deepseek-ai/dsh-client-ui-context-menu`

## Context

dsh 0.2.2 起，client 侧有了共享的右键菜单系统（`ui-context-menu`，0.2.2-alpha.3 进入发布线）：行组件通过注入的 `getTriggerProps` 绑定目标，贡献方按目标类别注册动作。Git 面板的文件浏览需要它：文件与目录行右键应提供「在浮窗打开」「在 Finder 中显示」「用默认应用打开」「复制路径」「下载 / 另存为」（图片另有「复制图片」），但不要「在侧栏打开」——文件浏览本身就是侧栏形态的替代入口。

平台的 `file` 目标族由 `ui-open-in-app` 提供，其中就包含「在侧栏打开」；插件无法从别人的贡献里删除一项。平台的 `image` 族则带出「在 Finder 中显示」，而 diff 弹窗两侧的图片是 data URL，不是工作区文件。同时，Git 面板在同一会话可以挂载两份（会话视图 + 右侧栏），右键动作必须回到发起手势的那一份面板，而不是另一份的状态。

平台动作的可见效果（应用图标、Finder 文案、桌面可用性、失败提示）依赖平台自己的探测与 remote 接口。在插件里重新实现一遍，等于复制 `ui-open-in-app` 与 `ui-file-actions` 的内部行为。

备选方案都被否掉：**直接绑定平台 `file` / `directory` / `image` 目标**——带出必须去掉的「在侧栏打开」与指向错误文件的「在 Finder 中显示」，且无法删项；**用 `ctx.remote.session.openWorkspacePath` 等接口自行重写平台动作**——要耦合更多平台内部类型并复制应用探测逻辑；**只做 Git 组、不借平台动作**——右键菜单里没有下载与另存为，与侧边栏官方行为不齐。

## Decision

三条规则：

**1. 自有目标族。** 插件注册自己的目标类别 `gitPanel.file` / `gitPanel.directory` / `gitPanel.image`（声明合并进平台的 `ContextMenuTargetMap`），不直接绑定平台的同名族。目标值只放可 JSON 序列化的身份：`sessionId`、面板实例 id（React `useId`）、仓库标签、相对路径 / 捕获时的 browse root / 忽略标记（树目标），或 data URL 与建议文件名（图片目标）。

**2. 平台动作按白名单借用。** `gitPanel.file` 等族各自的贡献在 resolve 时调用 `contextMenus.resolve(平台目标)` 取得一个嵌入式实例（不弹窗），从 `source` 读取平台已解析的动作，只保留白名单内的 view id（`open-in-app.file/float|reveal|open|copyPath`、`file-actions.file/copyImage|download|saveAs` 等），`run` 转发为对新实例的 `select(viewId)`（平台在 select 前会 dispose 旧实例，必须重新 resolve）。准备限时 800 ms，超出时返回已就绪的部分结果而非失败。白名单按动作 id 而非文件类型区分：普通文件与图片都保留下载 / 另存为，对齐 dsh 侧边栏的官方行为；`sidebar` 一项被白名单排除。「在侧栏打开」的 view id 或平台包缺失时，平台组整体不显示，Git 组不受影响。

**3. 动作回到发起面板。** 目标携带的面板实例 id 经模块级 owner 登记表（`menu-owners.ts`）解析回面板实例；resolve 时由该实例按最新快照生成动作。运行前复核：目标的 `sessionId` 与仓库标签必须等于面板当前值，树目标的 browse root 必须等于面板当前 root，否则该贡献解析为空（不做任何动作，也不报错）——菜单可以活得比它的表面更久，切仓库 / 换根后旧目标上的「在 Finder 中显示」绝不能指到新根下的同名路径。右键不改变选中、active 行与 row slider。

兼容门控沿用既有模式：`useContextMenu` 缺失（dsh < 0.2.2-alpha.3）时行绑定退化为 `NO_MENU`（保留浏览器原生菜单），`contextMenus` 服务缺失时不注册贡献，两者都经延迟注入等待，不阻塞插件其余部分。目标以 thunk 形式传给 `getTriggerProps`，身份在手势发生时构建，行渲染后的状态变化不会被读旧。

## Consequences

- 平台动作的行为、图标与失败提示与平台完全一致，零复制；代价是依赖平台 view id 的拼写（`<contribution>/<action>`，两端均 percent-encode）。单测与 e2e 桩双侧钉住这份清单；平台改名只会少显示几项，不会误执行。
- 同一会话的两份面板互不串台；面板卸载后其目标解析为空。
- 借用引入一次额外的嵌入式 resolve（每次菜单打开 + 每次点击），在 800 ms 预算内；平台超时与失败提示不会误伤 Git 组。
- 菜单不再绑定平台 `file` / `image` 族，平台未来对这些族的新动作不会自动出现在 Git 面板里；需要时扩充白名单即可。
- 后续 Git 组（与修订版本比较、显示 Git 历史）以快照中的 `capabilities` 声明门控（见 ADR-0026 的能力标记模式），旧 host 上不显示对应菜单项。
