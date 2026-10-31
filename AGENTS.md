# AGENTS.md

本文件是 `dsh-git-panel` 仓库的 agent 工作指南。任何在此仓库工作的 AI agent 或贡献者，动手前先读完本文件，并遵守其中的架构边界、构建流程与工程约定。功能与交互细节以代码和测试为准；**理由与背景以 ADR（`docs/adr/`）为准**，本文件只记操作规则与「违反就会出错」的坑——所以这里不复制 ADR、README 与发布模板已有的内容，指针即入口。

## 项目定位

`dsh-git-panel` 是 DeepSeek Harness（dsh）的插件，在 Web GUI 里提供 Git 面板（许可：MIT）：工作区常驻面板 tab「Git」，各档都是三个子 tab——**Git 总览**（分支树 / 提交历史图 / 提交详情与操作、分支切换与远程同步）、**变更记录**（暂存 / 放弃 / 提交 / 贮藏 / 文件差异）、**文件浏览**（目录树 + 预览，目录树列顶部一行状态栏显示浏览根的绝对路径与刷新按钮：候选根多于一个时点击开候选根下拉（跟随项 + 项目根 + 各仓库根 + 复制路径），否则点击复制）；仓库列表挂在分支树所在那一面的顶部（宽档 Git 总览左栏、stacked 上 band 左栏 / 紧档抽屉、compact 按分支筛选的抽屉（手机）或底部弹层）与变更记录列顶（compact 不挂，只留总览一处），**不另开页签**，默认收起、标题行显示当前选中的存储库，两处共享一个收起状态（**点击行切换仓库后区块默认保持展开**，连续切换只需一次点击，收展由标题行（整行是按钮）的显式点击控制；配置 `collapseReposOnPick` 开启时切换后立即收起；选中的那份决定三个页签作用于哪个工作树）。切换不清空视图也不白等：切回一个轮询周期内读过的仓库立刻换回它上一次的快照（不压暗、不 inert）再校准，离开发起时的在途请求被中断而不是排队；新鲜度按客户端收到样本的时间算（`checkedAt` 是 host 的时钟），`resync()`（配置写入、重连）清空回放缓存，否则旧样本会把旧的宿主级配置（字号、filesFollow、detectCheckouts）短暂放回界面。文件浏览的根由配置 `filesFollowRepo` 定**各会话的默认值**（默认关 = 项目根 = cwd 所属工作树，开 = 随选中仓库换根），状态栏地址在候选根多于一个时**恒为下拉**（跟随项 + 项目根 + 各仓库根），每个会话都能当场覆盖默认（选「跟随 Git 切换」即跟随、选根即钉住），覆盖粘住直到改选或改配置——改配置把所有会话重置回新默认。**联动是单向的**：Git 跟随每一次目录切换——下拉里选中的根本身是可选仓库（含 cwd 自身是仓库时的项目根）时，Git 总览与变更记录同步切到它、文件页留在前台（`gitRepoForFilesRoot`）；反过来 Git 切换仓库时文件浏览是否换根只由上面的默认值 / 覆盖决定，「跟随 Git 切换」项只动文件侧。cwd 不是 git 仓库时文件浏览页**不铺横向卡片条**：该会话从未选过仓库时面板自动进入扫描到的第一个子仓库（之后总览照常有列表，只列真实检出、没有工作区根行），扫描不到仓库即纯文件浏览。切换仓库不清空视图：旧快照留在原位并整体压暗、标签栏显示「正在切换…」，新快照到达后一次性替换；**切换在途时 `.gp-body` 必须 inert**（旧快照上的行仍在屏，但请求已带新仓库的 `repo` 标签，点暂存 / 放弃会落到新工作树）。功能细节见 README「功能」；系统未装 git 时只显示文件浏览，以 cwd 为根。

- 输入框左侧 zsh 风格标记 `<仓库名> (<分支>)`（绿=已同步、橙=有待提交，点击跳转面板）；插件详情页可隐藏标记，隐藏时改在「Git」标签旁显示同色状态圆点（`tab-dot.ts`），**两者互斥**。详情页配置表单是 `PillConfig.tsx`，按功能分四区（基础配置 / 界面显示 / AI 提交信息 / 存储库，仅基础配置默认展开，其余点击展开），写入被接受后立即 `resyncAll()`。「探测 worktree 和子仓库」= `detectCheckouts`（默认开）：关闭时 `listSessionRepos` 两个探测点（`git worktree list`、目录扫描）都不跑；该开关随快照下发并参与 `stateFingerprint`，`Panel` 的 repo-list effect 依赖它，翻转即重新拉取列表。「文件浏览跟随 Git 切换」= `filesFollowRepo`（默认关）：同样随快照下发（旧 host 缺失按关读），`Panel` 用它作为文件侧选择器的默认输入推导 `repo` 标签（`filesRemote`，与 Git 选中仓库解耦——会话有覆盖时覆盖优先，配置只在无覆盖时生效），并在翻转时清除所有会话覆盖（手动根选择与跟随 opt-in，回到新默认）。「切换存储库后收起列表」= `collapseReposOnPick`（默认关）：随快照下发（旧 host 缺失按关读），`Panel` 的 `chooseRepo` 在切换成功后据它收起共享的列表区块；重复点选当前仓库不算切换，不收起。
- 面板布局判据都在容器上量：`layout.ts` 测量、`panel-fit.ts` 出纯策略（`panelMode` → `wide | stacked | compact`，按宿主分支）。所有断点、档位与抽屉规则以 **ADR-0023** 和 `panel-fit.ts` 单测为准，本文件只记两条踩过的坑：**判手机必须同时要求 `(pointer: coarse)`**（`screen` 报 CSS px，1366×768@125% 的短边只有 614，只看屏宽会把缩放桌面读成手机）；**提交字段持有光标时不折叠编辑器**（手机输入法会把面板压进矮档，折叠=卸载正在输入的字段并连带关掉键盘），折叠只由显式操作触发且先 blur。**藏东西只认 `isCramped`（窄且矮）组合**，stacked 不藏。

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
- `core.ts`：仓库根解析（realpath）+ `snapshotForSession`；`resolveBrowseRoot` 在非 Git 目录回退到 cwd。多仓库：`resolveWorkspace(deps, sessionId, repo)` 按 (cwd, repo) 缓存，子目录仓库必须自己的 toplevel 恰好等于所选目录（否则 `invalid-repo`），`listSessionRepos` 汇总工作区主仓库与扫描结果。
- `repos.ts`：工作区内嵌套仓库扫描（BFS 最多 3 层、跳过 `.git` 与 `node_modules`、命中 `.git` 即不再下钻），以及 `repoDirFor` 把相对仓库路径解析回受信任目录（`isSafePath` + realpath 包含检查、排除 cwd 与 `.git`）。
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
- 页面：`Panel.tsx`（子 tab 路由、字号、版本条）+ `OverviewTab`（分支树所在那一面顶部内嵌 `ReposSection` 仓库列表）/ `ChangesTab` / `FilesTab`（含目录树列顶部的浏览根状态栏）三个页签及其 `*-hooks`、工具栏与弹窗伴星文件——单个文件的职责看目录与文件头注释即可。
- 纯算法（有单测，新增纯逻辑放这里、别塞进组件）：`repo-select`（每会话记住所选仓库与文件浏览根选择器 + 给仓库相关请求打 `repo` 标签）/ `repo-list`（仓库列表的行模型与标签规则、浏览根下拉行模型）/ `branch-tree` / `git-graph` / `filtered-graph` / `file-tree` / `diff` / `code-spans` / `virtual-list` / `zoom` / `selection-keys` / `branch-options` / `push-policy` / `panel-fit`（三档判据，测量与策略分离才可单测）/ `path-images` / `mermaid-blocks`（kbd 只能在送入 MarkdownText **之前**文本替换，围栏与行内代码内不替换）/ `html-pack`（HTML 预览文档变换，ADR-0020）。
- 样式表：`styles.ts` 只是装配入口（`ensureStyles` + `CSS_PARTS` 拼接），规则在 `css/` 下按功能域十个模块（base / overview / changes / diff / modal / actions / config / layout / repos / stacked）。**`CSS_PARTS` 的数组顺序即层叠顺序**，写在后面的模块覆盖前面的——所以「写进对应功能域模块」还不够：要让一条新规则赢过某条既有规则，它必须落在**那条规则所在模块之后**（同模块内则在其后），否则会被静默覆盖；跨档覆盖（compact、触摸媒体查询）进 `layout.ts`，侧栏 stacked 覆盖进 `stacked.ts`。不要重排既有模块或改动 `CSS_PARTS` 的顺序，`test/unit/stylesheet.test.mjs` 会拦。
- 共享 UI 原语：`ops-modals.tsx`（弹窗外壳 / 确认框 / 错误码文案）、`dialog-focus.ts`（模态焦点生命周期）、`tip.tsx`、`notice.tsx`、`use-viewport.ts`、`highlight-cache.ts`、`ImageZoom.tsx`、`MermaidFigure.tsx`（懒加载 mermaid chunk 的唯一引用点，见「依赖策略」）。
- 测试入口：`testkit.ts` / `hookkit.ts`（见「构建」）。

## 安全与信任边界

- git 命令一律用 argv 数组经 subprocess 执行，禁止拼接 shell 字符串；cwd 锁仓库根，带超时与输出上限。
- 经 RPC 到来的 path / ref / 分支名 / 标签名 / remote 名是唯一不可信的 argv 素材，必须先过 `validate.ts`（`isSafePath` / `isSafeRev` / `isSafeBranchName` / `isSafeRemoteName`）；子命令支持时再用 `--end-of-options` 殿后。`checkout` / `reset` 不认该选项（旧 git 会直接失败），只靠校验兜底。贮藏 index 在 `actions.ts` 校验为非负整数。
- `dir-list` / `file-content` / 未跟踪文件删除是插件唯一直接触碰未跟踪文件的入口：`isSafePath` + realpath 包含检查，软链指向仓库外一律拒，`.git` 不可浏览。
- 远程链接（`remote.ts`）必须剥除 URL 内嵌凭据，避免 token 泄进 href。
- 写操作不越权：push 绝不 `--force` 且仅在严格领先时提供；pull 只走 `--ff-only`；分叉时 push / pull 都不提供；绝不直接检出远程引用（落为同名跟踪分支，避免游离 HEAD）；publish 的 `HEAD`、pull-preview 的 `@{upstream}` 为固定字面量。
- 放弃未跟踪条目由 host 直接删盘（`git restore` 摸不到）：任何删除失败都汇总成错误返回，绝不静默；条目本身是仓库（嵌套仓库 / 子模块 / bare 布局）时整批拒绝（`nested-repo`），删除循环内逐条复检（竞态命中报 `nested-repo-partial`）；只「包含」仓库的普通目录仍整体删除——这条边界是刻意的（issue #46），单测同时锁住两者。
- 破坏性操作（discard、reset、stash-drop、删除标签、带贮藏的分支切换等）UI 必须二次确认，硬重置需列出将丢失的改动并额外勾选；「放弃更改」只作用于工作区侧，暂存侧需先取消暂存。
- 全屏阅读器（`files.fullscreen`）是面板里那份预览换样式成弹窗，**不能**在弹窗里重新渲染文件，也**不能**搬进 portal：重建 iframe 会重跑页面脚本、搬动 DOM 会重载（ADR-0016）。
- HTML 预览的等待必须可预期、可退出：遮罩由页面回报 `ready`（`withReadyPing`），4 s 后进 slow 态——放行指针、显示已等待秒数、给「停止渲染」；**重页面（内联脚本 ≥ 512 KiB）挂 frame 前用 modal 二次确认**，取消不算批准；`openFile` 本地打开是一次 host 动作（argv 调系统打开器、同一套 realpath 包含检查、仅回环主机提供）。机制与实测见 ADR-0020。
- **页面自身能冻住整个应用，遮罩救不了**（2D canvas 打满全应用唯一 GPU 进程）：确认与遮罩只负责「可预期、可退出」，真正的修复是不内嵌渲染或壳侧处理——实测数据与取舍见 ADR-0020。
- HTML 交互预览的 iframe **必须 `blob:` URL、禁用 `srcdoc`**（`srcdoc` 与面板同进程，页面脚本会冻结面板；机理见 ADR-0020），始终不带 `allow-same-origin`；`JS` 开关切到静态模式才用 `srcdoc` + `sandbox=""` + `default-src 'none'` CSP。相对 css/js 经 `file-content` 内联为 `data:` URL（≥2 MiB 跳过打包，任何失败回落原始字节，`html-pack.ts`）。

## 数据流铁律

- **快照单一来源**：pill、变更记录页、统计条共用同一 `GitController` 快照，禁止各自发起独立 snapshot。
- **业务与刷新分离**：业务摘要（`stateFingerprint`）相同只抑制业务 view 通知，不抑制查询 tick；子查询的刷新键是结构化的 `[root, tick, 本地失效]`，不得把业务 `checkedAt` 或 snapshot 对象引用当作 effect 触发器。一次 action 或采样只补一批查询；切仓库时的缓存回放不是采样，只换 view、不推进查询 tick（信号置为未就绪），子查询等校准样本到达再补一批。`stateFingerprint` 不代表 refs / stash 未变，总览仍按 tick 刷新。
- **按需查询**：history / branches / show / diff / image-diff 等走 `query` 端点，带分页、缓存与分代防竞态（新请求接管、旧响应按代丢弃）；请求等待或失败时保留上一份完整数据。
- **可见性门控**：页面后台不启动新 snapshot；隐藏的子页签不启动新的自动查询、分页或二阶段请求。在途响应可完成但不得派生后续查询；恢复时先补新快照，再只为当前活动页签补查一次。
- **写操作回灌**：动工作区的操作经 `onAction` 由 controller 接受新快照驱动刷新；标签操作不动工作区，以本地 `opBump` 刷新。分支切换成功后广播工作区世代（失效文件浏览缓存）并静默执行一次检查同步。
- **双层信封**：RPC 返回 `{ ok, value }` 是传输层结果，业务结果 `{ ok, value|error }` 在 `value` 内，两层都要判。
- **选择集随快照修剪**：勾选的路径在新快照中消失必须移除，否则提交序列会中止。
- **选择键单一权威**：变更列表的选择键（`path:s` index 侧 / `path:w` 工作区侧）只能经 `src/client/selection-keys.ts` 的 `changeKey` / `sideOf` / `pathOfKey` 构造与解析，调用点不得内联拼接或就地正则剥离。
- **合并提交按 first-parent**：提交详情的文件列表、`+/-` 统计与单文件 diff 必须同用 `FIRST_PARENT_DIFF`，与 image-diff 的 `<commit>^1` 一致——git 对 merge 的 `--name-status` 默认走 combined diff、`--numstat` 却走 first-parent，混用会拼出「文件数与增删行数来自两种口径」的一份 diff，点开文件只剩提交头、+0 −0（机理见 ADR-0011）。
- **不完整数据不静默**：快照截断（`truncated` + `truncatedReason`）、未跟踪回落折叠（`untrackedCollapsed`）、统计降级（`stats.partial`）、diff 输出截断（`truncated`）、suggest 输入截断都要带标记并在 UI 用 `NoticeBar` 提示。`newLines` 为 0 表示新侧行数不可信，视图不得渲染尾部展开控件。
- **大仓库限流**（issue #16）：逐文件 fan-out 有上限（`STATS_FANOUT_LIMIT`、`UNTRACKED_NUMSTAT_LIMIT`），超限降级统计而不是每轮轮询刷出几百个 git 进程；「展开全部」上下文是有界的 `DIFF_EXPAND_CONTEXT`，不要放大到整文件。

## AI 生成提交信息

- `llm` / `agentDefaultModel` / 会话模型投影按请求解析（`getLlm` / `getSessionModel` / `getAgentDefaultModel`），不在构造期冻结、不进 `static inject`；路由优先级：config 固定覆盖（provider/model 成对）→ 当前会话的 `modelSelection.next` → `agentDefaultModel.currentSelection()`。
- 生成语言（默认 `auto`、**不跟随界面语言**）、system+user 双写、diff 折叠等全部规则以 **ADR-0014** 为准；本文件只强调：**请求构造单测不代表模型遵循率，必须经官方适配器 + 真实模型验证**，不能用手工重组的 HTTP 请求替代。

## UI 约定

- 样式用 dsh 主题 CSS 变量（`--dsw-alias-*`），不硬编码颜色，保证深浅色主题一致。
- compact 样式统一挂在 `.gp-panel[data-layout="compact"]` 下；portaled 的 modal / bottom sheet 在 `.gp-panel` 之外，用自身 class 或 viewport media query 适配。
- stacked 档（`[data-layout="stacked"]`）：三个子页签统一为上/下两 band + `.gp-resizer--row` 行分割线；拖拽比**一个值服务三面**（`gp.stacked.split`，模块级监听同步，改一处三面同动）。分隔条的每个状态必须声明完整盒子（`left/right/width/bottom` + `top/height/background`）——基础竖条的属性会按级联漏进 row 变体，只写一部分会塌成残根。
- 弹窗复用 `ops-modals.tsx`（`renderModalShell` / `renderConfirmModal` / `renderModalFooter`）与 `dialog-focus.ts`（`useDialogFocus`），关闭与焦点契约单处收口，不各写一份；在途操作用 `confirmBusy` 禁用并抑制 Escape / backdrop。**每个浮层都要声明自己的叠层身份**：`useDialogFocus` 自动在根节点打 `data-gp-overlay`、`renderModalShell` 的 backdrop 自带——新增浮层漏了这一步，一次 Escape 会同时关掉上下两层。
- 带 `aria-controls` 的 tab / segmented 控件必须渲染对应的 `role=tabpanel` 节点，保证引用恒可解析。
- **切换存储库在途时（`repoSwitching`），页签的自动夹取与 files-only 回落都必须让路**：新仓库可能是仓库，夹取会把刚选中的「Git 总览」打回「文件浏览」（`src/client/Panel.tsx` 两处 effect 都判这个标志）。选中的页签同时要计入 `visited`，否则新总览判定为「从未打开」、只挂占位符，左栏的存储库列表跟着消失。
- 长列表（变更列表、源码视图、DiffView）用 `virtual-list.ts` + `use-viewport.ts` 虚拟化；查找跳转到窗口外命中时窗口吸附到命中邻域，不挂载中间的连续区间。
- `memo` 组件的 props 传普通值，不在渲染中新建对象字面量（会让浅比较失效、重跑整套高亮）；逐行高亮经 `highlight-cache.ts` 缓存。
- **列表选中底色只画一次**：`row-slider.tsx` 的 `useRowSlider` 在滚动容器里放一个绝对定位块表示「当前选中行」，行自己的 `--active` 类**只许改文字色、不许再上底**（`background:transparent`，不再写 `--gp-select-bg` / `--gp-select-bar`），否则滑块与行底色叠成双倍浓度。滚动容器必须 `position:relative`；虚拟列表要把挂载窗口（`first`/`last`）放进 hook 的 `deps`，否则窗口滑动后不重测。列表已有自己的 ref 时传 `host` 或调用 `attach`，别让一个节点挂两个 ref。分支树的滑块跟历史筛选行（`--active`），没有筛选时不画；检出分支（`--current`）自带标记（橙色标签图标 + 行尾绿色 `HEAD` 胶囊），两种选中不共用一个视觉信号。量测要除以宿主的有效 `zoom`（字号档是 `.gp-panel` 上的 CSS `zoom`：rect 是视觉像素，写回的 px 会再被缩放一次，误差随行号累积）；选中行离开 DOM（折叠、虚拟窗口滑出）时保留上次位置只隐藏，重新出现的那一帧不带过渡。`test/e2e/row-slider.mjs` 在 0 / ±1 三个字号档逐个点选六处宿主并量测填充与选中行的几何（缺一处 `position:relative` 就锚到面板、漏了 zoom 换算靠下的行就错位，断言都会变红）；所有列表共用同一个填充形状（与滚动容器左右齐平、左侧直角右侧 6px，左侧蓝条恒为垂直直线），不按列表各设内缩或圆角。
- **折叠容器里的滚动列表必须自己收高度**：用 grid 轨道（`grid-template-rows: 1fr ↔ 0fr`）做展开 / 收起动画时，折叠层要是 `display:flex;flex-direction:column`、列表 `flex:1 1 auto;min-height:0`。grid item 默认不压缩子项，列表会按内容高度长满、再被折叠层的 `overflow:hidden` 裁掉，`overflow:auto` 永远不触发——滚动条消失、只剩可视区那几行可见且无法滚动。
- 图片缩放：`.gp-zoom__img` 必须 `flex:none`（否则放大超过 100% 不生效）；拖拽的 pointer 事件挂 window 且不 `setPointerCapture`（会改写 click 目标）。
- **加载指示一律用平台 `StateDot`（`state="ongoing"`，尺寸按场景传 `size`）**，不自绘边框圈：`border` + `border-top-color` 拼出来的圆环在 13–26px 下看着不是正圆，且与平台的加载标记不同源，会随改版漂移。动画由平台样式表提供，所以遮罩进 ready 后要显式让透明层上的动画停下（`.gp-files__html-mask-spin *{animation:none}`）。
- **悬停提示只认 hover 与键盘焦点，不认触摸**（`tip.tsx` 的 `tipProps` 与 `GitPill` 的提示面板两条实现都要守）：tap 合成 `mouseenter` 却永远没有 `mouseleave`，按下时升起的提示牌会永久挂在界面上（机理注释在 `tip.tsx`）。按下来自手指一律不升起提示；按下驱动的确认（两步放弃的 `showTipNow`）不受影响，鼠标 / 键盘按下会把焦点这一半重新放开。

## 依赖策略

MIT 协议下优先复用 dsh 官方能力，不为相同功能重复打包依赖。

- 平台模块（`react` / `react-dom` / `@deepseek-ai/*`）一律 external，由宿主提供，不打包。
- 优先用 `@deepseek-ai/dsh-client-ui-primitives` 的现成组件：代码高亮 `languageForPath` / `useCodeHighlighter`（语法色走宿主 `--shiki-*` 变量）、`MarkdownText`、`Menu`（`onSelect` 需自行关闭）、`SegmentedControl`、`SegmentedTabs`、`FileTypeIcon` 等。不额外引入 marked / dompurify 之类的同类库。
- 新用到的平台组件必须同步加进 e2e 平台桩 `test/e2e/harness.html`，否则面板在 e2e 中直接崩溃。
- 只有 dsh 平台专有逻辑（slot / typert 契约、提交图车道布局、路径折树、diff 拆行等）才自研。
- 引入新依赖前先确认宿主未提供；确需引入时 pin 精确版本写入 `package.json`。`mermaid` 是目前唯一的非平台运行时依赖：pin 在 devDependencies，构建期打进懒加载 chunk `lib/client.mermaid.js`，**绝不进主 bundle**——主 bundle 里只允许 `require.async('./client.mermaid.js')` 这一个引用点（`MermaidFigure.tsx`）。
- `@deepseek-ai/dsh` 标为 **optional peer**（`peerDependenciesMeta`）：`src/` 不 import 它，宿主运行时提供；其余 5 个 peer 保持必需（`src/` 要用它们的类型）。标 optional 不削弱兼容门禁：`evaluatePluginCompatibility` 只读 `peerDependencies`。

## 构建

`build.mjs` 用 esbuild 出产物 + tsc 出类型声明，三个产物：

1. `tsc -p tsconfig.build.json` 仅出 `lib/host/*.d.ts`；esbuild 把 `src/host/*.ts` **逐文件**转译（`bundle: false`，`@deepseek-ai/*` 不打包）。host **绝不压缩**：typert 靠方法参数名反射校验参数，重命名会破坏 wire 契约。
2. `src/client/index.ts` → `lib/client.js`（cjs，包成 `window.__ModuleLoader__.load({id,factory})`，平台 external，可 minify）。
3. `src/client/mermaid-chunk.ts` → `lib/client.mermaid.js`（同款包装但注册 `chunk: "client.mermaid.js"`，文件名必须匹配平台 `client.<name>.js` 规则，由 `/plugins` 按需下发；e2e 里由 harness 桩的 `require.async` 代替）。

`lib/testkit.mjs` / `lib/hookkit.mjs` 是测试专用 bundle（随整个 `lib/` 一并 gitignore，`npm run test:unit` 会重建）。集成测试中的 controller 与 hooks 必须从同一个 bundle（hookkit）导入，否则 `pageVisibility` 单例会分裂。

```bash
node build.mjs        # 全量构建 host + client + testkit/hookkit
npm run typecheck     # 类型检查
```

构建只作为显式脚本手动执行，**不挂 `prepare` 等安装期生命周期钩子**：`lib/` 不入库（ADR-0018），DSH STORE 上架契约会拦截安装期执行脚本的插件（`plugin-contract.test.mjs` 守住）。改动 `src/` 后本地 `node build.mjs` 供开发与测试；出厂产物把关交给 `scripts/assert-pack.mjs`。

## 验证

- host 改动：类型检查通过 + 端点逻辑单测。
- client 改动：`node build.mjs` 成功后，用隔离浏览器 / 隔离 DSH 实例加载重建后的产物验证；无 dev:web watcher 时必须重建 + 刷新。访问正在运行的 GUI 须遵守用户当次授权。
- 测试位于 `test/`：`test/unit/*.test.mjs`（`node --test`，纯算法 + host 端点）、`test/e2e/*.mjs`（隔离的 file:// 无头浏览器，绝不碰运行中的实例）。命令：`npm run test:unit` / `npm run test:e2e` / `npm test`。**零断言的截图 / 度量脚本不进 RUNNERS**（作为目检工具手动跑，别让永远绿的探针混进门禁计数）。`test:e2e` 经 `test/e2e/all.mjs` 跑完全部 runner 再汇总失败——**不要改回 `&&` 串联**：首个红 runner 会吞掉后面所有 runner（曾因此让 9 个 runner 长期不执行）。
- 一键门禁 `npm run check`：lint + 类型检查 + 全部测试。提交前必须通过。
- `test:unit` **刻意不传 `--test-force-exit`，别加回来**：并行文件下它会静默丢掉正在执行的用例及其后同文件用例，而报告仍是 `fail 0`——门禁绿着少跑测试（实测数据见 ADR-0017）。
- CI（`.github/workflows/ci.yml`）：push 到 main / PR / 手动触发，node `22.x` 与 `24.x` 矩阵，门禁与本地 `npm run check` 等价；e2e 用 `file://` 夹具自带 chromium，不需要 GUI、不需要 dsh 实例。
- `package-lock.json` 入库且必须与 `package.json` 同步，CI 的 `npm ci` 发现不一致会直接拒绝运行；发版用 `npm version <v> --no-git-tag-version`（同时更新两处），漂移由 `test/unit/lock-sync.test.mjs` 守住。

## 发布

发布由 `.github/workflows/release.yml` 在「version bump 合入 main」时自动执行：完整门禁 → 打 tag →（仅正式版）发 npm → 建 GitHub Release 并附 `npm pack` 产物；**不要手工打 tag 或 publish**。操作细节不在此复制，看三个来源：

- **正文格式与流程命令**：`.github/RELEASE_TEMPLATE.md`（唯一格式来源，照它写，不要翻历史 release 反推）；预发布页面用 `.github/PRERELEASE_BODY.md` 固定说明。
- **决策背景**：ADR-0018（分发渠道）、ADR-0019（发布流程）、ADR-0021（正文归档范围）。
- **硬规则**：版本号只用 `npm version <v> --no-git-tag-version`；正式版正文 `docs/releases/v<v>.md` 随发版提交入库（rc / alpha 不归档、不发 npm、不进 `docs/releases/`），预发布正文用 `gh release edit --notes-file` 写线上、不进仓库；「验证」段的单测 / e2e 数字取自**当次** `npm run check`，不得沿用上一版；四项格式校验由 `test/unit/release-notes.test.mjs` 把关，出厂 tarball 的唯一把关是 `scripts/assert-pack.mjs`。
- 预发布不触发版本条「有新版本」（GitHub `releases/latest` 服务端排除 prerelease，`version.ts` 零改动），用于自测与隔离 profile 验证。

## 代码约定

- TypeScript 严格模式，无隐式 any。
- 相对导入一律写 `./x.js` 后缀：同一份源码要同时产出可运行的 `lib/host/*.js` 和能解析的 `lib/host/*.d.ts`。
- 数据模型改动从 `host/types.ts` 起，client 直接复用，不存在第二份需手工同步的定义；常量范围（如 `SUGGEST_LIMITS`）同样单源，UI 与 host 校验从同一处派生。
- 新增 wire 字段保持向后兼容：旧 client 可忽略新字段，client 对旧 host 缺失字段要降级而非崩溃。
- **注释只写代码行为**：描述这段代码现在做什么、约束是什么；除非有大坑（不写就会踩），否则不写演进过程、不写「曾经怎样 / 为何改过来」。演进与决策放 ADR / PR / 提交信息，不放注释。issue 号不必写进注释——PR 描述里关联即可。
- 界面文案：`zh`（`src/client/locales.ts`）是键集权威源，新增 / 改动键必须同步 `en` 与 `src/client/locales/` 下 ja / es / fr / de / ru / pt 六份（`locale-dicts.ts` 汇总注册，`locales.test.mjs` 校验键集与 `{占位符}`）；其它语言由平台语言链落英文。包元信息 `locale/<lang>.json` 同样八份，**每份都必须进 `package.json` 的 `exports`**——dsh 经 exports 逐个解析目录里的 locale 文件，漏一份整包报「包元信息错误」、详情页打不开（`plugin-contract.test.mjs` 守住）；README 图片必须用绝对 https 地址（`docs/` 不随包发布，详情页加载不到相对路径）。
- 安装身份三处必须一致且等于包名 `@xbzbing/dsh-git-panel`：`package.json.name`、`cordis.patch.yml` 的 row `name`、`build.mjs` 产出的 ModuleLoader 注册 `id`。任一不一致，面板会整个消失（`plugin-contract.test.mjs` 守住）。

## 目录与提交

- `docs/local/` 是本地设计稿目录，已 gitignore，**不提交**。
- `lib/` **不提交**（本地构建产物，整个目录 gitignore）；发布产物由 release workflow 的 `npm pack` 生成并附到 GitHub Release。`node_modules/` 不提交。
- 只在用户明确要求时创建 commit；优先暂存具体文件而非 `git add .`。
