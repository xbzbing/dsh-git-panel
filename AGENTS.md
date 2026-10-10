# AGENTS.md

本文件是 `dsh-git-panel` 仓库的 agent 工作指南。任何在此仓库工作的 AI agent 或贡献者，动手前先读完本文件，并遵守其中的架构边界、构建流程与代码约定。

## 项目定位

`dsh-git-panel` 是 DeepSeek Harness（dsh）的一个插件，在 Web GUI 里提供 Git 面板能力：

- 工作区新增常驻面板 tab「Git」，位于「对话」「轨迹」之后，内部含三个子 tab：
  - **Git 总览**：左=分支列表，中=提交历史图（支持 commit id 等字段搜索），右=提交详情 + comment。提交详情顶部有「提交操作」区：还原此提交（revert）、重置到此提交（reset：软 / 混合 / 硬，硬重置列出将丢失的改动并需额外勾选确认）、为该提交创建标签（轻量 / 附注），已有标签以可删除标签片呈现（创建 / 删除 / 还原 / 重置均走 modal + 二次确认，底部恒显「信任 AI」提示）。
  - **变更记录**：左=变更统计（文件数 / 增删行数 / 最近变更时间）+ 本地未提交变更列表（勾选、手动提交、Amend）+ 贮藏入口与贮藏列表（应用 / 弹出 / 丢弃），右=选中文件差异对比（图片走 `image-diff` 新旧双图对照）。
  - **文件浏览**：直接打开 Git tab 时，非 Git 目录默认进入此页、干净仓库默认 Git 总览、有未提交变更默认变更记录；输入框标记的显式跳转仍优先。非 Git 目录仅显示文件浏览，以 cwd 为根。系统未安装 git 时同样退化为文件浏览：在 git 目录（文件系统探测到 `.git`）会额外提示「未安装 Git」，非 git 目录则静默退化，两种情况输入框标记与状态圆点均不显示。左=按需加载目录树（`.git` 不可浏览，Git 忽略项半透明），右=文件预览（按类型显示 dsh 官方 `FileTypeIcon`，可复制相对路径；代码/文本用官方 `useCodeHighlighter` 语法高亮，Markdown 可切换官方 `MarkdownText` 渲染并默认渲染，HTML 可切换预览但默认源码、渲染走 `allow-scripts` 隔离源 iframe 不自动执行，图片内联，其余二进制占位）。Git 面板保留默认字号，可在顶部调节并记住选择。
- inputBar 一个 zsh 风格 Git 标记：`<仓库名> (<分支>)`，绿色=已同步、橙色=有待提交；hover 显示完整路径；点击跳转面板（有未提交→变更记录，已提交→Git 总览）。非 Git 目录不显示此标记或状态圆点；插件详情页可隐藏 Git 仓库的标记，隐藏时改为在「Git」标签旁显示同色状态圆点（`tab-dot.ts`），两者互斥。
- 插件详情页配置区：「显示输入框标记」开关 = host `static Config` volatile 字段 + client 注册 `plugins.bundle.config` 表单（`PillConfig.tsx`），经 `configForms` 热写；写入被接受后客户端立即 `resyncAll()`，不等轮询。

许可：MIT。

## 架构总览

插件分 host / client 两半，经 typert Remote 通信。

```
Client 半 (React bundle, lib/client.js)
  - conversation.view (order 30)  → Panel 主面板（内部子 tab 路由）
  - conversation.input.left       → GitPill（zsh 风格标记）
  - plugins.bundle.config         → PillConfig（详情页配置表单）
  - GitController                 → 每 session 轮询 snapshot，pill/变更页/统计共享
        │ RPC (typert)
        ▼
Host 半 (Cordis + typert, lib/host)
  - GitPanelService（命名空间 gitPanel）
        - snapshot / run / query / suggest / version 五个 @Remote 端点
        │ subprocess 服务（argv 数组、无 shell、cwd 锁仓库根、超时+输出上限）
        │ suggest 端点另经宿主 llm 服务（ctx.get 可选获取）一次性生成提交信息
        ▼
  git CLI
```

### Host（`src/host/`）

- `types.ts` 是 wire 数据模型的**唯一权威源**，client 侧的 RPC 类型直接从它复用。
- `index.ts`：`GitPanelService extends TypertRemoteService`，`inject = ['subprocess','sessions','sessionPersistence']`，仅做端点委托与生命周期接线。
- `git.ts`：把 `subprocess` 服务适配成带超时的 `GitRunner`；对每条命令注入 `GIT_TERMINAL_PROMPT=0`，使 fetch/pull 等网络命令遇到凭据/主机密钥交互时快速失败而非挂到超时（stdin 已 ignore）。
- `remote.ts`：把 `git remote -v` 的 fetch URL 解析成可浏览的 `https://<host>/<path>` 页面链接 + 主机分类（`github`/`gitlab`/`gitee`/`bitbucket`/`other`），覆盖 scp（`git@host:owner/repo.git`）/ssh://​/https://​/git:// 各形态，并剥除内嵌凭据（`user:token@`）以免 token 泄进 href；`parsePrimaryRemote`（在 `core.ts`）优先取 `origin`、否则第一个远程。
- `core.ts`：workspace（cwd→仓库根 realpath）解析 + `snapshotForSession`（含远程 `remote` 与是否跟踪上游 `hasUpstream`——由 `@{upstream}...HEAD` 的 rev-list 退出码判定，`ahead`/`behind` 仅在有上游时有意义）；文件浏览使用 `resolveBrowseRoot`，非 Git 目录回退到 cwd realpath。统计用的两个逐文件 fan-out（未跟踪文件行数的 `git diff --no-index` 每文件一进程、最近变更 mtime 的每文件一次 `stat`）在变更数超过 `STATS_FANOUT_LIMIT`（200）时整体跳过，`stats.partial` 置真、`insertions` 不计未跟踪行、`lastChangeAt` 为 null（issue #16：数千变更时这两处会在每次轮询刷出几百个 git 进程拖死面板）；计数（fileCount/staged/modified/untracked）与已跟踪增删行始终精确。
- `actions.ts`：`GitAction` → git 命令序列构造（含 `commit --amend`、按路径提交的两步 `add + commit`；标签 `tag-create`（`-a -m` 为附注，否则轻量）/ `tag-delete`；贮藏 `stash-push`（可带 `-m`）/ `stash-apply` / `stash-pop` / `stash-drop`（`stash@{N}` 由校验过的整数 index 拼成）；回撤 `revert`（`--no-edit`）/ `reset`（`--soft|--mixed|--hard`，mode 另在此校验）；同步 `fetch`（`--all --prune`）/ `pull-ff`（`git pull --ff-only`，仅能快进、分叉时拒绝不动工作区））。错误映射分级：先判冲突（`CONFLICT`，贮藏/还原条目保留）、`index.lock` 繁忙（自动重试一次后报 `index-busy`）、`not-found`（含 `Could not parse object` 等坏 ref）、`not-ff`（`--ff-only` 遇分叉的洁净拒绝），再落通用 `git-error`。
- `queries.ts`：`history / diff / file-lines / image-diff / dir-list / file-content / show / branches / tags / stash-list / authors / last-commit-message / worktree-stats / pull-preview`。`file-lines` 按新侧行号取文件切片（worktree/staged 读工作区文件、commit 读 `<commit>:<path>`），供 diff 视图按需展开块间隐藏上下文。`pull-preview` 给拉取确认框预览「将引入的快进范围」：`rev-list --count HEAD..@{upstream}`（提交数）+ `git diff --numstat HEAD @{upstream}`（文件数 + 增删行），全本地（`behind>0` 时对象已 fetch）、无网络、`@{upstream}` 为固定字面量；无上游时 `hasUpstream:false` 且计数清零。`dir-list` 列单个工作区目录（懒加载、跳过 `.git`、条目上限）、`file-content` 读单个工作区文件（文本切片 / 图片 data URL / 二进制标记，超上限降级）；两者的 path 经 `isSafePath` + realpath 逃逸守卫（软链指仓库外一律拒），是插件唯一直接读 git 未跟踪文件的信任边界。`stash-list` 走 `git stash list -z --format` 经 `parseStashList` 解析；贮藏列表按需查询、不进常驻快照。
- `validate.ts`：host 信任边界的输入校验（`isSafePath` / `isSafeRev` / `isSafeBranchName`）。经 RPC 到来的 path/ref/分支名/标签名是唯一不可信 argv 素材；凡会把它们放进选项位的 git 命令都在此拦截，并额外用 `--end-of-options` 殿后（拒 `-` 开头的 `--output=<file>` 任意写向量）。贮藏 index 另在 `actions.ts` 校验为非负整数。
- `suggest.ts`：AI 生成提交信息端点——`git status -z` 文件清单 + `git diff HEAD`（unborn 退化为 `--cached` + worktree，`paths` 全过 `isSafePath`），untracked 新文件再按 `git diff --no-index` 折入 diff（`suggestMaxBytes` 预算内、`UNTRACKED_FILE_CAP` 封顶），JSON framing 组 prompt；经 `llm` 面（`ctx.llm.stream`）一次性生成，手写 deadline 超时、finish→错误映射（读真实 chunk 的 `reason` 信封）、`suggestEnabled=false` 入口兜底为 `suggest-disabled`。`llm`/`agentDefaultModel` 走 `getLlm`/`getAgentDefaultModel` **按请求解析**（不构造期冻结、**不进 `static inject`**）；模型路由为 config 覆盖对（provider/model 必须成对）优先，否则 `agentDefaultModel.currentSelection()`；`llm-face.ts` 用 `@deepseek-ai/dsh-llm` 的 type-only 官方类型钉住 wire 契约（零运行时依赖）。
- `parser.ts`：`git status --porcelain` / `--numstat` / `log` 输出解析为结构化数据。
- `version.ts`：读本包 `package.json` 版本 + 查 GitHub release 做更新检查，失败降级。

### Client（`src/client/`）

- `rpc.ts`：`gitPanel` @Remote 端点的 client 面，走 `/api` 通道调 `gitPanel/<method>`；逐读加守卫，连接缺失或异常降级为类型化 failure。
- `controller.ts`：`GitController`，每 session 的快照控制器（单航刷新 + `refreshIntervalMs` 轮询 + turn 完成边沿刷新 + `connection/reset` 重拉）。
- `registry.ts`：per-session `GitController` 复用池 + 组件订阅入口。
- `index.ts`：Cordis `apply` —— 挂 RPC 面、注册三个 slot（`conversation.view` / `conversation.input.left` / `plugins.bundle.config`）、注册 i18n。
- `Panel.tsx`：主面板壳，内部子 tab 路由 + 焦点消费 + 版本条；用 `layout.ts` 的 `usePanelLayout` 观测面板宽度，≤620px 时在根节点标 `data-layout="compact"` 并把 `compact` 下发给三个子 tab，触发单栏「钻取」布局。
- `layout.ts`：`usePanelLayout`——ResizeObserver 观测面板宽（`COMPACT_BP=620`，与 GitPill 的 `COMPACT_WIDTH` 同值），返回是否进入 compact 单栏布局。compact 的所有样式挂在 `.gp-panel[data-layout="compact"]` 下，宽布局行为不变（e2e 断言覆盖）；portaled 的 modal / bottom sheet 在 `.gp-panel` 之外，分别用自身 class / viewport media query 适配。
- `OverviewTab.tsx`：Git 总览三栏（分支列表 / 提交历史图 / 提交详情 + comment）的组合层，含 hover 卡；取数状态拆进 `overview-hooks.ts`。提交详情顶部「提交操作」区：还原（`revert`）/ 重置（`ResetModal`，软 / 混合 / 硬 + 硬重置丢失清单与额外确认）走 `onAction`（经控制器喂回新快照 → refreshKey 前进 → 历史图刷新），创建标签（`TagCreateModal`）/ 删除标签（标签片 ×）走 `run` 的 `tag-create` / `tag-delete`、以本地 `opBump` 刷新历史图与分支/标签列表（标签不动工作区，不会 bump 快照）。compact 时折叠为单栏：历史列表 ↔ 提交详情按 `pane` 钻取（带返回条），分支筛选走 bottom sheet，提交行两行式、graph svg 高度随行高拉伸以保证连线，禁用 hover 卡。左列底部有固定状态栏（`renderStatusBar`，wide 下在滚动分支列表 `gp-col-left__scroll` 之下、compact 下在总览底部）：左=远程仓库链接（仅 GitHub 项目显示：`remote.hostKind==='github'` 时用 GitHub 标，非 GitHub 远程不显示链接；`webUrl` 新标签页打开、仓库路径与「打开」提示在 hover title，无 webUrl 的本地路径远程只显图标、URL 进 title），右=分支同步态（已同步 / 领先 / 落后 / 分叉 / 无上游）+「检查同步」（`fetch` 经 `onAction` 回灌新快照刷新 ahead/behind）+ 仅在「严格落后（behind>0 且 ahead===0）」时出现的「拉取同步」（`pull-ff`，走 confirm modal + 「信任 AI」提示）。`snapshot.remote`/`hasUpstream` 缺失（旧快照）时降级为「无远程/无上游」而非崩溃。
- `overview-hooks.ts`：`useBranchTree` / `useHistory`（分页 + 分代守卫 + `total:-1`）/ `useCommitDetail`（`show` LRU 缓存 + 文件 diff overlay + hover）三个数据 hook，`OverviewTab` 只做组合与渲染。
- `ChangesTab.tsx` / `ChangeStats.tsx` / `DiffView.tsx`：变更记录页、统计条（读快照上的 `stats`，不再单发查询；`stats.partial` 为真时追加「统计已简化」提示）、差异视图（`DiffView` 已 `memo`；支持统一（`unified`，单栏行内）/ 并排（`split`，左右分栏）两种布局，默认视图由快照上的 `defaultDiffView` 决定，可在工具栏临时切换）。未提交变更列表按行虚拟化（分组头 + 文件行扁平成一个列表，前缀和算偏移，只挂视口窗口内的行，固定行高 `VROW_H`/`VHEAD_H` 由样式钉死；issue #16 数千变更不再一次性铺 DOM）。虚拟化窗口数学抽在纯模块 `virtual-list.ts`（`buildTops`/`lowerBound`/`windowRange`，有单测），视口跟踪抽在 `use-viewport.ts` 的 `useViewportTracker`（callback-ref + 滚动/ResizeObserver，重挂自动重连、同尺寸不重渲染）；二者同时被文件浏览源码视图（`FilesTab.tsx`）复用。变更页还含贮藏：工具栏「贮藏」按钮（`StashPushModal`）、`stash-list` 查询出的可折叠贮藏列表（应用 / 弹出 / 丢弃，丢弃走确认 modal），操作经 `onAction`（失败也 `resync` 以反映冲突后的工作区）。
- `ops-modals.tsx`：写操作共享的 portaled 弹窗原语——`renderModalShell`（小弹窗统一外壳：backdrop 点击外部关闭 + Escape + `createPortal` + `.gp-modal--sm` 框 + bar(图标/标题/短哈希/关闭)，确认框 / 标签 / 贮藏 / 重置四类对话框都只提供 body+footer 经它渲染，关闭契约单处收口）、`renderConfirmModal`（纯文本确认框）、`renderModalFooter`（取消/确认按钮，`confirmBusy` 可在途禁用）、`renderAiHint`（底部恒显 `ops.aiHint`）、`opErrorText`（错误码→文案）。
- `PillConfig.tsx`：插件详情页配置表单（`configForms` 读写 + 写后即时 resync）——「显示输入框标记」开关 + 「差异对比默认视图」统一/并排切换 + 「提交历史图线条样式」平行线（VSCode）/ 紧凑（git log）切换 + 「提交框显示 AI 生成」开关。
- `tab-dot.ts`：Git 标签状态圆点（pill 隐藏时注入 / 恢复标记时清除）。
- `ImageCompare.tsx`：图片新旧双栏对照（渲染 `image-diff` 查询结果）。
- `jump.ts`：面板/子 tab 一次性焦点中继（模块级 per-session Map）。
- `git-graph.ts` / `file-tree.ts` / `diff.ts`：自研纯算法（提交图车道布局、路径折树、unified diff 拆行 → 并排行 + 块间隐藏上下文折叠为可展开 gap + 改动行前缀/后缀词级 diff）。提交图按车道（而非逐 commit）配色——一条连续线单色；车道续接跟随第一父，使主线钉在最左。线条样式由快照上的 `graphStyle` 决定：`parallel`（默认，VSCode 风格——合并的第一父各占一列，共享祖先以并行线表示、仅在祖先节点汇聚）/ `compact`（git log 风格——共享祖先提前合并为一列）。
- `locales.ts` / `icons.tsx` / `time.ts` / `types.ts`：中英文案、图标、时间格式化、client 侧类型别名。

## 数据流铁律

- **快照单一来源**：pill、变更记录页、统计条共用同一 `GitController` 快照，禁止各自发起独立 snapshot，避免重复 git 命令。
- **按需查询**：总览页 history/branches/show、图片 image-diff 走 `query` 端点，带分页、首页缓存、分代防竞态（新过滤请求接管、旧响应按代丢弃）。
- **双层信封**：RPC 返回 `{ ok, value }` 是传输层结果，业务结果 `{ ok, value|error }` 在 `value` 内，两层都要判。
- **选择集随快照修剪**：变更列表勾选的路径，若在新快照中消失必须移除，否则提交序列会中止。

## 依赖策略

MIT 协议下优先复用 dsh 官方能力，不为相同功能重复打包依赖。

- 代码/差异高亮调用平台 `@deepseek-ai/dsh-client-ui-primitives` 的 `languageForPath` 与 `useCodeHighlighter`；返回逐行 `HighlightSpan`，语法色采用宿主 `--shiki-*` 主题变量。语法资源由宿主按需加载；加载期间展示纯文本。词级高亮用 `code-spans.ts` 把完整代码行的 token 按改动区间切开，保留 token 样式。
- Markdown 渲染使用同一平台模块的 `MarkdownText`，不额外引入 marked/dompurify。
- 平台模块（`react` / `react-dom` / `@deepseek-ai/*`）一律 external，由宿主提供，不打包。只有 dsh 平台专有逻辑（slot / typert 契约、提交图车道布局、路径折树、diff 拆行）才自研。
- 引入新依赖前先确认宿主未提供；确需引入时 pin 精确版本写入 `package.json`。

## 构建

`build.mjs` 用 esbuild 出三个产物 + tsc 出类型声明：

1. `tsc -p tsconfig.build.json` 仅出 `lib/host/*.d.ts`（`emitDeclarationOnly`）。
2. esbuild 把 `src/host/index.ts` 打成单文件 `lib/host/index.js`（ESM，`react`/`@deepseek-ai/*` external，**绝不压缩**——typert 靠方法参数名反射校验参数，重命名会破坏 wire 契约）。
3. esbuild 把 `src/client/index.ts` 打成 `lib/client.js`（cjs + banner/footer 包成 `window.__ModuleLoader__.load({id,factory})`；平台模块 external；client 可 minify）。

`lib/testkit.mjs` 由 esbuild 从 `src/client/testkit.ts` 单独打出，供单测消费；已 gitignore，`npm run test:unit` 会重建。

命令：

```bash
node build.mjs        # 全量构建 host + client + testkit
npx tsc --noEmit      # 类型检查
```

构建只作为显式脚本手动执行，**不挂 `prepare` 等安装期生命周期钩子**：`lib/` 已提交入库即为发布产物，DSH STORE 上架契约会拦截「安装期执行 install lifecycle script」的插件（`plugin-contract.test.mjs` 有回归测试守住这条不变量）。改动 `src/` 后手动 `node build.mjs` 并把 `lib/` 一起提交。

## 验证

- host 改动：`tsc --noEmit` 通过 + 端点逻辑单测。
- client 改动：`node build.mjs` 产出 `lib/client.js` 成功，然后**刷新** `http://127.0.0.1:3082` 验证（当前无 dev:web watcher，client 改动不会热重载，必须重建 + 刷新页面）。
- 测试放在 `test/` 下：`test/unit/*.test.mjs`（`node --test`，纯算法 + host 端点），`test/e2e/*.mjs`（隔离的 file:// 无头浏览器，绝不碰运行中的实例）。命令：`npm run test:unit` / `npm run test:e2e` / `npm test`。
- 提交前跑一次完整 `node build.mjs`，确保 host 与 client 均无错。
- 一键门禁 `npm run check`（`typecheck` + `test` + `git diff --exit-code -- lib/`）：类型、单测/e2e、以及「`lib/` 与 `src/` 一致（构建产物已提交且新鲜）」三道一起过。

## 代码约定

- TypeScript 严格模式，无隐式 any。
- 数据模型改动从 `host/types.ts` 起，client 侧的 RPC 类型直接从它复用——单一权威源，不存在需要手工同步的第二份定义。
- 注释精简，只写最终实现意图，不写演进历史。
- git 命令一律用 argv 数组经 subprocess 执行，禁止拼接 shell 字符串（注入防护 + cwd 锁定）。
- 面向未提交变更的操作（commit / discard / stage）属破坏性或写操作，UI 需二次确认或明确入口，host 侧校验路径安全（拒绝仓库外路径、`..` 穿越）。
- 样式用 dsh 主题 CSS 变量（`--dsw-alias-*`），不硬编码颜色，保证深浅色主题一致。
- 安装身份三处必须一致且等于实际安装的包名 `@xbzbing/dsh-git-panel`：`package.json.name`、`cordis.patch.yml` 的 row `name`、`build.mjs` 产出的 ModuleLoader 注册 `id`。任一不一致，DSH 会以 `patch: name mismatch ... skipping` 跳过该行，或浏览器端注册 id 对不上 graph 行，两者都表现为面板整个消失（`plugin-contract.test.mjs` 有回归测试）。

## 目录与提交

- `docs/local/` 是本地设计稿目录，已在 `.gitignore` 忽略，**不提交**。
- `lib/` **提交入库**：这样 `dsh plugin add github:xbzbing/dsh-git-panel` 能直接安装已构建的树，无需在安装端跑构建。只有测试期生成的 `lib/testkit.mjs` 忽略（`npm run test:unit` 会重建）。`node_modules/` 不提交。
- 只在用户明确要求时创建 commit；优先暂存具体文件而非 `git add .`。
