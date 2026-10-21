# AGENTS.md

本文件是 `dsh-git-panel` 仓库的 agent 工作指南。任何在此仓库工作的 AI agent 或贡献者，动手前先读完本文件，并遵守其中的架构边界、构建流程与工程约定。功能与交互细节以代码和测试为准；这里只记录不读代码难以发现、违反就会出错的约定。

## 项目定位

`dsh-git-panel` 是 DeepSeek Harness（dsh）的插件，在 Web GUI 里提供 Git 面板（许可：MIT）：

- 工作区常驻面板 tab「Git」（位于「对话」「轨迹」之后），含三个子 tab：
  - **Git 总览**：分支树 / 提交历史图（搜索、作者、时间、分支筛选）/ 提交详情；提交操作（revert、reset、标签）、分支切换与远程同步（fetch / pull-ff / push / publish）。
  - **变更记录**：未提交变更（暂存、放弃、提交、Amend、AI 生成提交信息）、贮藏、文件差异（统一 / 并排、图片对照）。
  - **文件浏览**：工作区目录树 + 文件预览（语法高亮、Markdown/HTML 渲染、图片缩放、属性）。非 Git 目录或系统未安装 git 时只显示此页，以 cwd 为根。
- 输入框左侧 zsh 风格标记 `<仓库名> (<分支>)`：绿=已同步、橙=有待提交，点击跳转面板。插件详情页可隐藏标记，隐藏时改在「Git」标签旁显示同色状态圆点（`tab-dot.ts`），两者互斥。
- 插件详情页配置表单（`PillConfig.tsx`）：标记开关、diff 默认视图、提交图线条样式、AI 生成提交信息（开关、语言、模型级联 provider→model→推理强度、输入预算 / 输出上限 / 超时）。写入被接受后立即 `resyncAll()`。
- 面板布局判据都在容器上量，不看视口（`layout.ts` 测量 + `panel-fit.ts` 的纯策略），出三档之一 `wide | stacked | compact`（`panelMode(layout, host)` 按宿主分支）：**会话区**宽度 ≤620px（`COMPACT_BP`）→ compact 单栏「钻取」，否则 wide；**右侧边栏**窄且矮（≤620 × ≤520）→ 钻取，其余 ≤760 → **stacked**（窄而高时的两 band PC 密度布局，含 621–760 且矮），>760（`SIDEBAR_WIDE_BP`）→ 恢复 wide，首帧未测量（width=0）按 stacked 防 wide 闪现；stacked 且宽 ≤380（`STACKED_TIGHT_BP`）套手机同等待遇（短标签、藏字体步进）。高度 ≤520px（`SHORT_BP`）记为矮。**藏东西只发生在「窄且矮」（`isCramped` = compact 且 short）**——提交编辑器折叠成单行条、统计条丢弃变更/提交时间，都只认这个组合判据（stacked 不藏东西，密度跟 wide）。打开右侧边栏把面板压窄、或大屏手机上，只要高度够就保留完整编辑器与时间；折叠条上带「AI」入口（图标 + `AI` 两个字母，点击展开编辑器并立即生成）。

## 架构总览

插件分 host / client 两半，经 typert Remote 通信。

```
Client 半 (React bundle, lib/client.js)
  - conversation.view (order 30)  → Panel 主面板（内部子 tab 路由）
  - conversation.input.left       → GitPill（zsh 风格标记）
  - plugins.bundle.config         → PillConfig（详情页配置表单）
  - GitController                 → 每 session 页面可见时轮询 snapshot，pill/变更页/统计共享
        │ RPC (typert)
        ▼
Host 半 (Cordis + typert, lib/host)
  - GitPanelService（命名空间 gitPanel）
        - snapshot / run / query / suggest / version 五个 @Remote 端点
        │ subprocess 服务（argv 数组、无 shell、cwd 锁仓库根、超时+输出上限）
        │ suggest 端点另经宿主 llm 服务一次性生成提交信息
        ▼
  git CLI
```

### Host（`src/host/`）

- `types.ts`：wire 数据模型的**唯一权威源**，client 侧 RPC 类型直接复用。
- `index.ts`：`GitPanelService`，只做端点委托与生命周期接线。
- `git.ts`：把 `subprocess` 适配成带超时的 `GitRunner`；每条命令注入 `GIT_TERMINAL_PROMPT=0`，网络命令遇凭据 / 主机密钥交互时快速失败而非挂到超时。
- `fs-deps.ts`：`SnapshotDeps` fs 面的唯一来源（`createFsDeps()`），host 服务与 `host-integration` 单测共用，不得另写一份，否则测试不再是对生产的断言。
- `core.ts`：仓库根解析（realpath）+ `snapshotForSession`；`resolveBrowseRoot` 在非 Git 目录回退到 cwd。
- `snapshot-fingerprint.ts`：快照的 `stateFingerprint`（键排序后 SHA-256，排除 `checkedAt`）。
- `actions.ts`：`GitAction` → git 命令序列，以及 git 输出 → 错误码映射（冲突、`index-busy`、`not-found`、`auth-failed`、`push-rejected`、`not-ff` 等，兜底 `git-error`）。
- `queries.ts`：`query` 端点的各类按需查询（history / diff / file-lines / image-diff / dir-list / file-content / show / branches / tags / stash-list / authors / pull-preview / push-preview / model-catalog 等）。
- `history-topology.ts`：筛选后的历史页追加一次有界无过滤父链（10000 节点 / 2 MiB），失败只退化祖先数据，不丢列表。
- `validate.ts`：信任边界输入校验。
- `suggest.ts` / `llm-face.ts`：AI 生成提交信息；`llm-face.ts` 用 `@deepseek-ai/dsh-llm` type-only 类型钉住 wire 契约。
- `remote.ts` / `parser.ts` / `version.ts`：远程 URL → 浏览链接、git 输出解析、版本与更新检查。

### Client（`src/client/`）

- 入口与通信：`index.ts`（注册三个 slot + i18n）、`rpc.ts`（`gitPanel/<method>` 的 client 面，异常降级为类型化 failure）。
- 快照与刷新：`controller.ts`（`GitController`）、`registry.ts`（per-session 复用池，最后一份引用释放后 60s 回收）、`visibility.ts` / `use-page-visibility.ts`、`use-git-query-signal.ts`、`use-visible-request.ts`、`query-key.ts`。
- 页面：`Panel.tsx`（子 tab 路由、字号、版本条）、`OverviewTab.tsx` + `overview-hooks.ts` / `overview-statusbar.tsx` / `overview-modals.tsx`、`ChangesTab.tsx` + `changes-hooks.ts` / `ChangesToolbar.tsx` / `ChangeStats.tsx` / `ChangesDiffPane.tsx`（diff 工具栏 + 原地卡片，含卡片的对话框契约）、`DiffView.tsx` + `image-diff-hook.ts` / `ImageCompare.tsx`、`FilesTab.tsx` + `files-preview.tsx`（源码视图 / 图片分支 / 查找 / `FileState`）、`GitPill.tsx`、`PillConfig.tsx`。
- 纯算法（有单测）：`branch-tree.ts`、`git-graph.ts`、`filtered-graph.ts`、`file-tree.ts`、`diff.ts`、`code-spans.ts`、`virtual-list.ts`、`zoom.ts`、`selection-keys.ts`、`branch-options.ts`、`push-policy.ts`、`panel-fit.ts`（面板三档判据 `panelMode` 与 `isCramped` 组合判据——测量在 `layout.ts`，策略纯函数，故可单测）、`path-images.ts`（Markdown 本地图片 → `api/file` 路由，镜像官方解析）、`mermaid-blocks.ts`（mermaid 围栏分段 + `<kbd>`→行内代码——MarkdownText 刻意转义内联 HTML，kbd 只能在送入前文本替换，围栏与行内代码内不替换）、`html-pack.ts`（HTML 预览文档：交互模式把相对 css/js 内联为 `data:` URL、页面脚本默认执行；静态模式插 CSP 且不执行脚本——引用过滤、文档相对路径解析、全有或全无的限额读取，ADR-0020）。
- 样式表：`styles.ts` 只是装配入口（`ensureStyles` + `CSS_PARTS` 拼接），规则在 `css/` 下按功能域九个模块（base / overview / changes / diff / modal / actions / config / layout / stacked）。**`CSS_PARTS` 的数组顺序即层叠顺序**，写在后面的模块覆盖前面的——所以「写进对应功能域模块」还不够：要让一条新规则赢过某条既有规则，它必须落在**那条规则所在模块之后**（同模块内则在其后），否则会被静默覆盖；跨档覆盖（compact、触摸媒体查询）进 `layout.ts`，侧栏 stacked 覆盖进 `stacked.ts`。不要重排既有模块或改动 `CSS_PARTS` 的顺序，`test/unit/stylesheet.test.mjs` 会拦。
- 共享 UI 原语：`ops-modals.tsx`（弹窗外壳 / 确认框 / 错误码文案）、`dialog-focus.ts`（模态焦点生命周期）、`tip.tsx`（悬浮提示）、`notice.tsx`（可关闭提示条）、`use-viewport.ts`、`highlight-cache.ts`、`ImageZoom.tsx`、`MermaidFigure.tsx`（经 `require.async` 懒加载 `client.mermaid.js` chunk 渲染 mermaid，失败回退代码块）。
- 测试入口：`testkit.ts` / `hookkit.ts`（见「构建」）。

## 安全与信任边界

- git 命令一律用 argv 数组经 subprocess 执行，禁止拼接 shell 字符串；cwd 锁仓库根，带超时与输出上限。
- 经 RPC 到来的 path / ref / 分支名 / 标签名 / remote 名是唯一不可信的 argv 素材，必须先过 `validate.ts`（`isSafePath` / `isSafeRev` / `isSafeBranchName` / `isSafeRemoteName`）；子命令支持时再用 `--end-of-options` 殿后。`checkout` / `reset` 不认该选项（旧 git 会直接失败），只靠校验兜底。贮藏 index 在 `actions.ts` 校验为非负整数。
- `dir-list` / `file-content` / 未跟踪文件删除是插件唯一直接触碰未跟踪文件的入口：`isSafePath` + realpath 包含检查，软链指向仓库外一律拒，`.git` 不可浏览。
- 远程链接（`remote.ts`）必须剥除 URL 内嵌凭据，避免 token 泄进 href。
- 写操作不越权：push 绝不 `--force` 且仅在严格领先时提供；pull 只走 `--ff-only`；分叉时 push / pull 都不提供；绝不直接检出远程引用（落为同名跟踪分支，避免游离 HEAD）；publish 的 `HEAD`、pull-preview 的 `@{upstream}` 为固定字面量。
- 放弃未跟踪条目由 host 直接删盘（`git restore` 摸不到）：任何删除失败都汇总成错误返回，绝不静默；条目本身是仓库（嵌套仓库 / 子模块 / bare 布局）时整批拒绝（`nested-repo`），删除循环内逐条复检（竞态命中报 `nested-repo-partial`）；只「包含」仓库的普通目录仍整体删除——这条边界是刻意的（issue #46），单测同时锁住两者。
- 破坏性操作（discard、reset、stash-drop、删除标签、带贮藏的分支切换等）UI 必须二次确认，硬重置需列出将丢失的改动并额外勾选；「放弃更改」只作用于工作区侧，暂存侧需先取消暂存。
- 全屏阅读器（`files.fullscreen`）是面板里那份预览换样式成弹窗，**不能**在弹窗里重新渲染文件：重建 iframe 会重跑页面脚本（同一份报告再等约 12 s），代码视图也会丢滚动与查找。它也不能搬进 portal——搬动 DOM 就会重载 iframe（ADR-0016）。
- HTML 预览在渲染期间覆盖一层遮罩（`.gp-files__html-mask`），`ready` 由页面自己回报（`withReadyPing`：`load` 后再过两帧 `postMessage`），父侧 `load` + 超时只作兜底；遮罩退出后保持挂载但透明且 `pointer-events:none`。
- **等待不得装成死机**：遮罩 4 s 后进入 slow 态——放行指针（`pointer-events:none`，只留停止按钮可点）、显示已等待秒数、给出「停止渲染」（卸载 frame 并回到源码视图）。页面自己的脚本跑在 frame 进程里，等待时长不可缩短，只能让它可退出（ADR-0020）。
- **重页面先问再渲染**：内联脚本 ≥ 512 KiB 的文档在挂 frame 前用 **modal** 确认（不是提示条）：取消（保持源码）/ 仍然渲染 / 本地实例上的「在系统浏览器中打开」。取消不算批准，切回渲染视图会再问一次。
- **本地打开是一次 host 动作**：`openFile` 端点用 argv 数组调用系统打开器（`open` / `rundll32` / `xdg-open`，绝不过 shell），路径先 `isSafePath` 再 `isInsideRoot`（realpath 仍在根内）——与读取端点同一条包含检查。只有 `location.hostname` 是回环时才提供该出口；远程实例说明文件在远端、只能内嵌渲染（等待期间可停止），打开失败要显示错误而非静默。
- **页面自身能冻住整个应用，遮罩救不了**：2D canvas 大幅绘制的页面会打满全应用唯一的 GPU 进程，壳与面板同时出不了帧（JS 仍 1–2 ms）。实测同一份 report.html：默认 GPU 98–99%、截图挂死；`--disable-accelerated-2d-canvas` 下 GPU 3–7%、零挂死。所以遮罩/确认只负责「可预期、可退出」，真正的修复在壳侧或不内嵌渲染（ADR-0020）。
- HTML 交互预览的 iframe 必须用 `blob:` URL（`URL.createObjectURL`），**不能用 `srcdoc`**：带自身 URL 的沙箱 iframe 在 Chromium 里走独立渲染进程，页面脚本再重也不冻结面板；`srcdoc` 与面板同进程，实测同一份报告 12 s 全冻结。iframe 始终不带 `allow-same-origin`；工具栏 `JS` 开关切到静态模式时改用 `srcdoc` + `sandbox=""` + `default-src 'none'` 的 CSP。交互模式把相对 css/js 经 `file-content` 端点读出、以 `data:` URL 内联（≥2 MiB 跳过打包），任何失败回落原始字节（`html-pack.ts`，ADR-0020）。

## 数据流铁律

- **快照单一来源**：pill、变更记录页、统计条共用同一 `GitController` 快照，禁止各自发起独立 snapshot。
- **业务与刷新分离**：业务摘要（`stateFingerprint`）相同只抑制业务 view 通知，不抑制查询 tick；子查询的刷新键是结构化的 `[root, tick, 本地失效]`，不得把业务 `checkedAt` 或 snapshot 对象引用当作 effect 触发器。一次 action 或采样只补一批查询。`stateFingerprint` 不代表 refs / stash 未变，总览仍按 tick 刷新。
- **按需查询**：history / branches / show / diff / image-diff 等走 `query` 端点，带分页、缓存与分代防竞态（新请求接管、旧响应按代丢弃）；请求等待或失败时保留上一份完整数据。
- **可见性门控**：页面后台不启动新 snapshot；隐藏的子页签不启动新的自动查询、分页或二阶段请求。在途响应可完成但不得派生后续查询；恢复时先补新快照，再只为当前活动页签补查一次。
- **写操作回灌**：动工作区的操作经 `onAction` 由 controller 接受新快照驱动刷新；标签操作不动工作区，以本地 `opBump` 刷新。分支切换成功后广播工作区世代（失效文件浏览缓存）并静默执行一次检查同步。
- **双层信封**：RPC 返回 `{ ok, value }` 是传输层结果，业务结果 `{ ok, value|error }` 在 `value` 内，两层都要判。
- **选择集随快照修剪**：勾选的路径在新快照中消失必须移除，否则提交序列会中止。
- **选择键单一权威**：变更列表的选择键（`path:s` index 侧 / `path:w` 工作区侧）只能经 `src/client/selection-keys.ts` 的 `changeKey` / `sideOf` / `pathOfKey` 构造与解析，调用点不得内联拼接或就地正则剥离。
- **合并提交按 first-parent**：提交详情的文件列表、`+/-` 统计与单文件 diff 必须同用 `FIRST_PARENT_DIFF`（`--diff-merges=first-parent`），与 image-diff 的 `<commit>^1` 一致。git 对 merge 的 `--name-status` 默认走 combined diff（只列与所有父提交都不同的文件，补丁还可能整体为空），`--numstat` 却走 first-parent；混用会把一份 diff 的文件数和另一份的增删行数拼在一起，点开文件只剩提交头、显示 +0 −0。
- **不完整数据不静默**：快照截断（`truncated` + `truncatedReason`）、未跟踪回落折叠（`untrackedCollapsed`）、统计降级（`stats.partial`）、diff 输出截断（`truncated`）、suggest 输入截断都要带标记并在 UI 用 `NoticeBar` 提示。`newLines` 为 0 表示新侧行数不可信，视图不得渲染尾部展开控件。
- **大仓库限流**（issue #16）：逐文件 fan-out 有上限（`STATS_FANOUT_LIMIT`、`UNTRACKED_NUMSTAT_LIMIT`），超限降级统计而不是每轮轮询刷出几百个 git 进程；「展开全部」上下文是有界的 `DIFF_EXPAND_CONTEXT`，不要放大到整文件。

## AI 生成提交信息

- `llm` / `agentDefaultModel` / 会话模型投影按请求解析（`getLlm` / `getSessionModel` / `getAgentDefaultModel`），不在构造期冻结、不进 `static inject`。路由优先级：config 固定覆盖（provider/model 成对）→ **当前会话的 `modelSelection.next`**（含会话自己的 effort）→ `agentDefaultModel.currentSelection()`。config 固定路由可带 `suggestReasoningEffort`（成对时才保留）；effort 留空则 `GenerateOptions` 不出现该键，用模型默认。
- 生成语言默认 `auto`：按仓库自身近期提交推断，先滤掉机械提交（release / merge / revert / fixup! / squash!，否则自动生成的英文提交会把结论翻成 `en`），本人提交足够时只看本人；**不跟随界面语言**。
- 语言要求必须同时写进 system 和 user 消息末尾的独立 text block（位于 diff 截断预算之外）；只在 system 强调仍会输出错误语言。请求构造单测不代表模型遵循率，需经官方适配器 + 真实模型验证，不能用手工重组的 HTTP 请求替代。
- diff 进预算前先折叠超长行（压缩产物会吃光预算），但结构性行（`@@`、`diff --git`、`---`/`+++` 等）一律不折；折叠不算截断。

## UI 约定

- 样式用 dsh 主题 CSS 变量（`--dsw-alias-*`），不硬编码颜色，保证深浅色主题一致。
- compact 样式统一挂在 `.gp-panel[data-layout="compact"]` 下；portaled 的 modal / bottom sheet 在 `.gp-panel` 之外，用自身 class 或 viewport media query 适配。
- stacked 档（`[data-layout="stacked"]`）：三个子页签统一为上/下两 band + `.gp-resizer--row` 行分割线；拖拽比**一个值服务三面**（`gp.stacked.split`，模块级监听同步，改一处三面同动）。分隔条的每个状态必须声明完整盒子（`left/right/width/bottom` + `top/height/background`）——基础竖条的属性会按级联漏进 row 变体，只写一部分会塌成残根。
- 弹窗复用 `ops-modals.tsx`（`renderModalShell` / `renderConfirmModal` / `renderModalFooter`）与 `dialog-focus.ts`（`useDialogFocus`），关闭与焦点契约单处收口，不各写一份；在途操作用 `confirmBusy` 禁用并抑制 Escape / backdrop。
- 带 `aria-controls` 的 tab / segmented 控件必须渲染对应的 `role=tabpanel` 节点，保证引用恒可解析。
- 长列表（变更列表、源码视图、DiffView）用 `virtual-list.ts` + `use-viewport.ts` 虚拟化；查找跳转到窗口外命中时窗口吸附到命中邻域，不挂载中间的连续区间。
- `memo` 组件的 props 传普通值，不在渲染中新建对象字面量（会让浅比较失效、重跑整套高亮）；逐行高亮经 `highlight-cache.ts` 缓存。
- 图片缩放：`.gp-zoom__img` 必须 `flex:none`（否则放大超过 100% 不生效）；拖拽的 pointer 事件挂 window 且不 `setPointerCapture`（会改写 click 目标）。
- **加载指示一律用平台 `StateDot`（`state="ongoing"`，尺寸按场景传 `size`）**，不自绘边框圈：`border` + `border-top-color` 拼出来的圆环在 13–26px 下看着不是正圆，且与会话行/侧栏的加载标记不同源，会随平台改版漂移。动画由平台样式表提供，所以遮罩进 ready 后要显式让透明层上的动画停下（`.gp-files__html-mask-spin *{animation:none}`）。

## 依赖策略

MIT 协议下优先复用 dsh 官方能力，不为相同功能重复打包依赖。

- 平台模块（`react` / `react-dom` / `@deepseek-ai/*`）一律 external，由宿主提供，不打包。
- 优先用 `@deepseek-ai/dsh-client-ui-primitives` 的现成组件：代码高亮 `languageForPath` / `useCodeHighlighter`（语法色走宿主 `--shiki-*` 变量）、`MarkdownText`、`Menu`（`onSelect` 需自行关闭）、`SegmentedControl`、`SegmentedTabs`、`FileTypeIcon` 等。不额外引入 marked / dompurify 之类的同类库。
- 新用到的平台组件必须同步加进 e2e 平台桩 `test/e2e/harness.html`，否则面板在 e2e 中直接崩溃。
- 只有 dsh 平台专有逻辑（slot / typert 契约、提交图车道布局、路径折树、diff 拆行等）才自研。
- 引入新依赖前先确认宿主未提供；确需引入时 pin 精确版本写入 `package.json`。`mermaid` 是目前唯一的非平台运行时依赖（宿主不提供、平台组件也无 mermaid 钩子）：pin 在 devDependencies，构建期打进懒加载 chunk `lib/client.mermaid.js`，**绝不进主 bundle**——主 bundle 里只允许 `require.async('./client.mermaid.js')` 这一个引用点（`MermaidFigure.tsx`）。
- `@deepseek-ai/dsh` 标为 **optional peer**（`peerDependenciesMeta`）：`src/` 不 import 它，宿主在运行时提供，标可选后 `npm ci` 不再拉整棵 harness 依赖树。其余 5 个 peer 保持必需——`src/` 要用它们的类型（`@deepseek-ai/dsh-llm` 本身不在 peer 里，经 `@deepseek-ai/dsh-session` 传递装上）。标 optional 不削弱兼容门禁：`evaluatePluginCompatibility` 只读 `peerDependencies`。

## 构建

`build.mjs` 用 esbuild 出产物 + tsc 出类型声明：

1. `tsc -p tsconfig.build.json` 仅出 `lib/host/*.d.ts`。
2. esbuild 把 `src/host/*.ts` **逐文件**转译成 `lib/host/*.js`（`bundle: false`，与 `src/host/` 一一对应；`@deepseek-ai/*` 不打包）。host **绝不压缩**：typert 靠方法参数名反射校验参数，重命名会破坏 wire 契约。
3. esbuild 把 `src/client/index.ts` 打成 `lib/client.js`（cjs，包成 `window.__ModuleLoader__.load({id,factory})`，平台模块 external，可 minify）。
4. esbuild 把 `src/client/mermaid-chunk.ts` 打成 `lib/client.mermaid.js`（同款包装但注册 `chunk: "client.mermaid.js"`）：包内懒加载 chunk，由 `/plugins` 路由按需下发（`require.async`），文件名必须匹配平台的 `client.<name>.js` 规则；e2e 里由 harness 桩的 `require.async` 代替。

`lib/testkit.mjs` / `lib/hookkit.mjs` 是测试专用 bundle（随整个 `lib/` 一并 gitignore，`npm run test:unit` 会重建）。集成测试中的 controller 与 hooks 必须从同一个 bundle（hookkit）导入，否则 `pageVisibility` 单例会分裂。

```bash
node build.mjs        # 全量构建 host + client + testkit/hookkit
npm run typecheck     # 类型检查
```

构建只作为显式脚本手动执行，**不挂 `prepare` 等安装期生命周期钩子**：`lib/` 不入库（ADR-0018），发布产物由 workflow 的 `npm pack` 在门禁后生成；DSH STORE 上架契约会拦截安装期执行脚本的插件（`plugin-contract.test.mjs` 守住）。改动 `src/` 后本地 `node build.mjs` 供开发与测试；出厂产物把关交给 `scripts/assert-pack.mjs`。

## 验证

- host 改动：类型检查通过 + 端点逻辑单测。
- client 改动：`node build.mjs` 成功后，用隔离浏览器 / 隔离 DSH 实例加载重建后的产物验证；无 dev:web watcher 时必须重建 + 刷新。访问正在运行的 GUI 须遵守用户当次授权。
- 测试位于 `test/`：`test/unit/*.test.mjs`（`node --test`，纯算法 + host 端点）、`test/e2e/*.mjs`（隔离的 file:// 无头浏览器，绝不碰运行中的实例）。命令：`npm run test:unit` / `npm run test:e2e` / `npm test`。`test:e2e` 经 `test/e2e/all.mjs` 跑完全部 runner 再汇总失败——不要改回 `&&` 串联：首个红 runner 会吞掉后面所有 runner（曾因此让 9 个 runner 长期不执行）。
- 一键门禁 `npm run check`：lint + 类型检查 + 全部测试。提交前必须通过。
- `test:unit` **刻意不传 `--test-force-exit`**：它在文件并行下会把仍在跑的文件整个拆掉，丢掉正在执行的用例及其后同文件的全部用例，而 `fail 0`、`skipped 0`——门禁绿着少跑测试。实测（容器内 node 22，默认并发）带该 flag 17 次里 8 次少跑（489→483/482/481），去掉后 17 次全部正常，耗时同为 ~18s。它本就冗余：2026-09-25 评审实测删掉后 52/52 正常退出无挂起。别再加回来。
- CI（`.github/workflows/ci.yml`）：push 到 main / PR / 手动触发，node `22.x` 与 `24.x` 矩阵；`npm ci` → `npx playwright-core install --with-deps chromium` → lint → typecheck → 单测 → e2e，与本地 `npm run check` 等价。e2e 用 `file://` 夹具自带 chromium，不需要 GUI、不需要 dsh 实例。
- `package-lock.json` 入库且必须与 `package.json` 同步：CI 的 `npm ci` 一旦发现两者不一致就直接拒绝运行（lock 曾停在 0.3.0 跨越七次发版，因为发版只改 manifest）。发版用 `npm version <v> --no-git-tag-version`——它同时更新 manifest 与 lock 的两处 version；漂移由 `test/unit/lock-sync.test.mjs` 守住。

## 发布

发布由 `.github/workflows/release.yml` 在「version bump 合入 main」时执行：跑完整门禁 → 打 tag →（仅正式版）发 npm → `docs/releases/v<版本>.md` 建 GitHub Release 并附上 `npm pack` 产物。版本号含 `-`（如 `1.8.0-rc.1`）是**预发布**：只建 GitHub prerelease Release、**不发 npm**，**也不归档正文**——页面先用 `.github/PRERELEASE_BODY.md` 的固定说明建好，完整的变更记录随后用 `gh release edit` 写上去，不进仓库。正式版才走 npm + 稳定 Release。没有 `dist` 分支，GitHub 安装路径是 Release 附件 tgz URL。决策与背景见 `docs/adr/0018`（分发渠道）、`docs/adr/0019`（发布流程）与 `docs/adr/0021`（正文归档范围）。

- **正文归档只收正式版**：`docs/releases/` 里只有正式版的 `v<版本>.md`，rc / alpha 不写、也不留存（文件名不带 `-`，测试据此把关）。格式以 **`.github/RELEASE_TEMPLATE.md`** 为唯一来源——照它写，**不要再去翻历史 release 反推格式**（格式漂过多次，v1.6.1 起才固定为四段双语 + 对比链接）。workflow 用 `--notes-file` 读正文，**不用 `--generate-notes`**。
- 正文中英双语：`## 主要变更` / `## 安装` / `## 验证`，`---` 分隔后接 `## English` / `## Install` / `## Verification`；两段都以 `<PREV>...<TAG>` 的 compare 链接收尾。不保留 GitHub 自动生成的 `## What's Changed`。
- **安装段给两条**：npm（`@xbzbing/dsh-git-panel@latest`）+ 同版本 Release 附件；预发布不发 npm，它只给附件命令。
- **compare 的 `<PREV>` 是上一个正式版 tag**（跳过 rc / alpha，`v1.8.0` 配 `v1.7.0`），保证「完整变更记录」覆盖上一次稳定版之后的全部内容——rc 期间的变化因此不会漏记。
- **预发布页面照常写完整变更记录，但不归档**：workflow 先用 `.github/PRERELEASE_BODY.md` 的固定说明把页面建好，随后用 `gh release edit --notes-file` 写入正文（本地文件，如 `docs/local/releases/v<v>.md`，不进仓库）；重跑 workflow 不会覆盖已写好的预发布正文。安装渠道、对比基线、归档范围、固定说明这四项由 `test/unit/release-notes.test.mjs` 校验。
- 「验证」里的单测数 / e2e runner 数与产物一致性结论取自**当次** `npm run check` 的真实输出，不得沿用上一版。`test/unit/release-notes.test.mjs` 在本地与 CI 把关格式。
- 版本号用 `npm version <v> --no-git-tag-version`（同时改 manifest 与 lock）；`lib/` 不入库，发布产物由 workflow 的 `npm pack` 生成。
- **tag 由 workflow 打在触发发布的 main 提交上**，不要手工在 main 上打；发布前 workflow 会校验门禁与正文（正式版缺正文在打包前失败），npm 上已有该版本、远端已有 tag、已有 Release 时相应步骤自动跳过（Release 改为更新正文），失败后可直接重跑。
- `scripts/assert-pack.mjs` 对**真正发布的 tarball**断言产物齐全且无安装期脚本——这是出厂产物的唯一把关（`plugin-contract.test.mjs` 校验的是本地构建，不是入库树）。
- 预发布不触发版本条「有新版本」：GitHub 的 `releases/latest` 服务端排除 prerelease，`version.ts` 零改动。预发布用于自测与隔离 profile 验证，安装用 Release 附件 URL。

## 代码约定

- TypeScript 严格模式，无隐式 any。
- 相对导入一律写 `./x.js` 后缀：同一份源码要同时产出可运行的 `lib/host/*.js` 和能解析的 `lib/host/*.d.ts`。
- 数据模型改动从 `host/types.ts` 起，client 直接复用，不存在第二份需手工同步的定义；常量范围（如 `SUGGEST_LIMITS`）同样单源，UI 与 host 校验从同一处派生。
- 新增 wire 字段保持向后兼容：旧 client 可忽略新字段，client 对旧 host 缺失字段要降级而非崩溃。
- **注释只写代码行为**：描述这段代码现在做什么、约束是什么；除非有大坑（不写就会踩），否则不写演进过程、不写「曾经怎样 / 为何改过来」。演进与决策放 ADR / PR / 提交信息，不放注释。issue 号不必写进注释——PR 描述里关联即可。
- 安装身份三处必须一致且等于包名 `@xbzbing/dsh-git-panel`：`package.json.name`、`cordis.patch.yml` 的 row `name`、`build.mjs` 产出的 ModuleLoader 注册 `id`。任一不一致，面板会整个消失（`plugin-contract.test.mjs` 守住）。

## 目录与提交

- `docs/local/` 是本地设计稿目录，已 gitignore，**不提交**。
- `lib/` **不提交**（本地构建产物，整个目录 gitignore）；发布产物由 release workflow 的 `npm pack` 生成并附到 GitHub Release。`node_modules/` 不提交。
- 只在用户明确要求时创建 commit；优先暂存具体文件而非 `git add .`。
