# AGENTS.md

`dsh-git-panel` 的操作指南。动手前阅读本文件。

- 功能与用户行为以 `README.md` / `README.en.md`、源码和测试为准。
- 决策背景以 [`docs/adr/README.md`](docs/adr/README.md) 及对应 ADR 为准；本文件只保留操作规则和容易踩错的约束。
- host/client 的职责见 [`README.md`](README.md)「架构」和 [`docs/adr/0001-two-halves-and-rpc-boundary.md`](docs/adr/0001-two-halves-and-rpc-boundary.md)。

## 工作约定

- 先检查分支和工作树；只在用户明确要求时创建 commit、tag 或发布。
- 不使用 `git add .`；暂存具体文件。禁止 force push、手工发版和手工打 tag。
- `lib/` 是本地构建产物，`node_modules/` 与 `docs/local/` 不提交。
- host 改动通过卸载重装插件生效；也可重启 dsh。client 改动更新 bundle 后直接刷新即可，无需重装或重启。

## 架构边界

- `src/host/types.ts` 是 wire 类型和范围常量的唯一来源，client 直接复用；不要维护第二份模型。
- `src/host/index.ts` 只负责服务接线和端点委托；文件系统依赖统一来自 `src/host/fs-deps.ts`。
- Git 会话工作目录使用会话创建时的 `header.cwd`；不跟随 `working_directory` 投影。worktree、子仓库和 `.code-workspace` 认证的外部根仍通过仓库选择器手动切换；外部根只在选中后生效，不改变「一个请求一个根」的模型。
- host 的 Git 命令经 `git.ts` 调宿主 subprocess；client 的 RPC 统一经 `rpc.ts`，页面数据统一由每 session 一个 `GitController` 提供。
- 新增纯逻辑放 `src/client/` 的纯函数模块并配单测，不塞进 React 组件；样式规则放对应 `css/` 模块。
- `CSS_PARTS` 的顺序是层叠契约，不重排。跨布局覆盖放 `layout.ts`，stacked 覆盖放 `stacked.ts`。
- 服务键、typert wire 命名空间统一为 `dbGitPanel`（host 的 `SERVICE_KEY`）；client 只有 `namespace.ts` 一个 `NS`，locale 与 RPC 都从它取，契约测试钉住两半一致。不再使用领域通用名；host 默认导出是对象插件，`apply` 对已注册的同名服务保持惰性，守卫必须随 fiber 失效，否则配置变更后服务不会重建。见 ADR-0029。

## 安全不变量

- Git 命令必须使用 argv 数组，禁止 shell 字符串；cwd 锁定在已解析仓库根，带超时、输出上限和 `GIT_TERMINAL_PROMPT=0`。
- RPC 传入的 path、ref、分支、标签、remote 名称先过 `src/host/validate.ts`；可用时追加 `--end-of-options`。`checkout` / `reset` 不支持该参数，只依赖校验。
- `dir-list`、`file-content`、`writeFile` 和未跟踪删除是直接触碰工作区的入口：必须做安全路径校验、realpath 包含检查，拒绝越界软链和 `.git`。
- cwd 之外只有三道门，且都按 realpath 精确判定：`repoDirFor`（cwd 内嵌套）、`repoDirExternal`（`.code-workspace` 认证的 allow-list 成员，ADR-0030）、`repoDirCertified`（`git worktree list` 的主工作树）。放宽 `isSafePath` 会同时放宽 diff 路径与写入目标，禁止；新增出口必须另加一道门并写 ADR。
- 编辑规则单源在 `types.ts`：白名单、`.env` / `.env.*`、2 MiB、UTF-8 往返、只读检查、`baseSha256` 比对写；写入使用同目录 `wx` 临时文件再 rename，失败清理临时文件。详见 ADR-0024。
- push 不得 force，且只在严格领先时提供；pull 只允许 `--ff-only`；不直接检出远程引用；远程链接必须去除内嵌凭据。删远端分支只经配置的 remote 解析（远端名可含 `/`），目标固定为 `refs/heads/<branch>`，不得按短名或同名标签猜测。
- discard、reset、stash-drop、删标签、删本地分支（未合并时的强制 `-D` 需在确认框里再次勾选）、删远端分支（必须勾选确认）、合并分支、拣选提交和带贮藏的切换必须二次确认。合并 / 拣选冲突由 host 自动 `git merge --abort` / `git cherry-pick --abort` 恢复操作前状态，中止失败分别报 `merge-stuck` / `pick-stuck`（空拣选取消为 `pick-empty`）。未跟踪条目若本身是嵌套仓库或子模块必须拒绝，并报告批量删除中的部分失败。
- HTML 预览遵守 ADR-0015、ADR-0020：交互预览使用 `blob:` iframe，不用 `srcdoc`，不授予 `allow-same-origin`；静态模式才使用受限 `srcdoc`。大内联脚本先确认，等待可停止。

## 数据流约束

- pill、总览、变更记录和统计条共用同一个 controller 快照；组件不得各自发起 snapshot。
- 业务摘要和刷新信号分离：`stateFingerprint` 相同也不能阻止 query tick；查询 key 使用结构化 tuple，只在请求入口序列化，不以 snapshot 对象引用或 `checkedAt` 触发 effect。
- 查询按需、可见性门控且防竞态；旧数据保留到新数据成功，隐藏页签不启动自动查询或后续分页。
- RPC 有传输层 `{ ok, value }` 和业务层 `{ ok, value|error }` 两层信封，必须分别判断。
- 写操作经 `onAction` 回灌快照；标签操作用本地失效信号。切换仓库时旧视图可回放，请求必须带新仓库标签，`.gp-body` 在途时 inert。
- 新快照到达后修剪已消失的选择项；选择键只能经 `selection-keys.ts` 构造和解析。
- merge 提交的文件列表、统计和 diff 统一使用 first-parent。截断、降级和未跟踪折叠必须保留标记并显示提示；大仓库遵守 `STATS_FANOUT_LIMIT`、`UNTRACKED_NUMSTAT_LIMIT` 和有界 diff 上下文。

## UI 约束

- 使用 dsh 主题变量，不硬编码颜色；布局判定、断点和三档规则以 ADR-0023 与 `panel-fit.ts` 为准。手机判定必须同时满足 `(pointer: coarse)`；只有 `isCramped` 才隐藏内容。
- `repoSwitching` 时不要自动夹取页签或回落到 files-only；选中页签同时加入 `visited`。带 `aria-controls` 的控件必须渲染对应 `role="tabpanel"`。
- 弹窗统一复用 `ops-modals.tsx` 和 `dialog-focus.ts`；每个浮层声明 `data-gp-overlay`，在途操作禁用 Escape / backdrop。
- 长列表使用 `virtual-list.ts` + `use-viewport.ts`；memo props 不在 render 中新建对象；高亮使用 `highlight-cache.ts`。
- row slider 是唯一选中底色：宿主滚动容器必须 `position: relative`，行的 active 状态只改文字色；虚拟窗口和字号 zoom 必须纳入量测。详见 `test/e2e/row-slider.mjs`。
- 右键菜单的目标值在手势时捕获（thunk），owner 解析前必须复核 sessionId / repo / browse root（仓库行自带检出，只要求 root 非空）；菜单项不改选中与 row slider；破坏性项只打开既有确认框；菜单打开期间不显示指针锚定的浮层（提交 hover 卡片先收起，再由 `contextMenus.active` 门控）。详见 ADR-0028。
- 折叠滚动区用 `grid 1fr/0fr` 时，折叠层为 flex 列，列表 `flex: 1 1 auto; min-height: 0`。
- 加载指示使用平台 `StateDot(state="ongoing")`；图片放大图必须 `flex: none`，拖拽监听 window 且不 `setPointerCapture`。
- hover 提示只对 hover / 键盘焦点显示，触摸不显示；文件工具栏尾部按钮放入一个 `.gp-files__bar-end`，整组换行。

## 依赖与构建

- React、React DOM 和 `@deepseek-ai/*` 由宿主提供并 external；优先复用 `dsh-client-ui-primitives`，不要重复引入同类库。
- 新平台组件同步加入 `test/e2e/harness.html`。新增依赖前先确认宿主没有，必须 pin 精确版本。
- 非平台运行时依赖只能进入懒加载 chunk：mermaid 只能由 `MermaidFigure.tsx` 引入 `lib/client.mermaid.js`；CodeMirror / yaml 只能由编辑器链引入 `lib/client.editor.js`，不得进入主 bundle。
- host 逐文件输出、绝不压缩（typert 依赖参数名）；client 输出主 bundle；testkit / hookkit 必须来自同一构建。
- 构建只显式执行，不添加 `prepare` 等安装期脚本；产物契约见 ADR-0003、ADR-0004、ADR-0018。

```bash
node build.mjs        # 全量构建
npm run typecheck     # 类型检查
npm run test:unit     # 构建 + 单测
npm run test:e2e      # 构建 + 隔离 file:// e2e
npm run check         # lint + typecheck + 单测 + e2e
```

## 验证与测试

- host 改动至少跑 typecheck 和相关端点单测；client 改动构建后用隔离浏览器或隔离 DSH 验证，不直接把运行中的 GUI 当 e2e。
- `test:e2e` 必须经 `test/e2e/all.mjs` 汇总所有 runner，禁止改回 `&&` 串联；runner 由并发池执行（`E2E_CONCURRENCY`，默认 3，按 CPU 上限收口；`E2E_TIMEOUT_MS` 默认 240 秒），日志按 runner 成块输出，新 runner 必须自带隔离（file:// 夹具、不共享固定端口或输出路径）。合并进其他 runner 的场景模块命名为 `*-scenario.mjs`：不是 runner，不进 `RUNNERS`，直跑会显式失败。零断言截图 / 度量脚本不加入门禁。
- `test:unit` 不加 `--test-force-exit`；该参数会静默丢失并行测试。
- 建 git 临时夹具时导入 `test/unit/_tmp-ceiling.mjs`；符号链接用 `linkOrSkip`；跨平台路径比较使用 `realpathSync.native`。
- `package-lock.json` 必须与 `package.json` 同步；版本只用 `npm version <v> --no-git-tag-version`，由 lock-sync 测试守住。

## 契约与文案

- TypeScript 严格模式；相对导入带 `.js`；wire 新字段保持旧 client 可忽略、旧 host 缺字段时 client 降级。
- 注释写当前行为和不可见约束，不写演进过程；理由写 ADR，功能变化同步 README。
- `src/client/locales.ts` 的 zh 是键集源；en、ja、es、fr、de、ru、pt 必须同步，locale 测试校验键和占位符。
- 八份 `locale/*.json` 必须同时出现在 `package.json.exports`；八份详情页必须出现在 `package.json.files`。详情页只放简介、功能和仓库地址。
- 安装身份必须一致：`package.json.name`、`cordis.patch.yml` 的 row name、构建产物 ModuleLoader id 都是 `@xbzbing/dsh-git-panel`。

## 发布

- 发布只由 `.github/workflows/release.yml` 完成；正文格式看 `.github/RELEASE_TEMPLATE.md`，预发布看 `.github/PRERELEASE_BODY.md`。
- workflow 负责完整门禁、`npm pack`、tag、npm 和 GitHub Release；不要本地手工 publish/tag。正式版正文入 `docs/releases/`，rc/alpha 不归档；验证数字必须取当次门禁结果。
- 服务键 / wire 命名空间变更属于不兼容升级：发布说明必须写清 host 与 client 同版本、升级后硬刷新，并链接对应 ADR。
- 相关背景：ADR-0018、ADR-0019、ADR-0021、ADR-0029。
