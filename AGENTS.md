# AGENTS.md

本文件是 `dsh-git-panel` 仓库的 agent 工作指南。任何在此仓库工作的 AI agent 或贡献者，动手前先读完本文件，并遵守其中的架构边界、构建流程与代码约定。

## 项目定位

`dsh-git-panel` 是 DeepSeek Harness（dsh）的一个插件，在 Web GUI 里提供 Git 面板能力：

- 工作区新增常驻面板 tab「Git」，位于「对话」「轨迹」之后，内部含两个子 tab：
  - **Git 总览**：左=分支列表，中=提交历史图（支持 commit id 等字段搜索），右=提交详情 + comment。
  - **变更记录**：左=变更统计（文件数 / 增删行数 / 最近变更时间）+ 本地未提交变更列表（勾选、手动提交、Amend），右=选中文件差异对比（图片走 `image-diff` 新旧双图对照）。
- inputBar 一个 zsh 风格 Git 标记：`<仓库名> (<分支>)`，绿色=已同步、橙色=有待提交；hover 显示完整路径；点击跳转面板（有未提交→变更记录，已提交→Git 总览）。插件详情页可隐藏该标记；隐藏时改为在「Git」标签旁显示同色状态圆点（`tab-dot.ts`），两者互斥。
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
        - snapshot / run / query / version 四个 @Remote 端点
        │ subprocess 服务（argv 数组、无 shell、cwd 锁仓库根、超时+输出上限）
        ▼
  git CLI
```

### Host（`src/host/`）

- `types.ts` 是 wire 数据模型的**唯一权威源**，client 侧的 RPC 类型直接从它复用。
- `index.ts`：`GitPanelService extends TypertRemoteService`，`inject = ['subprocess','sessions','sessionPersistence']`，仅做端点委托与生命周期接线。
- `git.ts`：把 `subprocess` 服务适配成带超时的 `GitRunner`。
- `core.ts`：workspace（cwd→仓库根 realpath）解析 + `snapshotForSession`。
- `actions.ts`：`GitAction` → git 命令序列构造（含 `commit --amend`、按路径提交的两步 `add + commit`）。
- `queries.ts`：`history / diff / image-diff / show / branches / tags / authors / last-commit-message / worktree-stats`。
- `parser.ts`：`git status --porcelain` / `--numstat` / `log` 输出解析为结构化数据。
- `version.ts`：读本包 `package.json` 版本 + 查 GitHub release 做更新检查，失败降级。

### Client（`src/client/`）

- `rpc.ts`：`gitPanel` @Remote 端点的 client 面，走 `/api` 通道调 `gitPanel/<method>`；逐读加守卫，连接缺失或异常降级为类型化 failure。
- `controller.ts`：`GitController`，每 session 的快照控制器（单航刷新 + `refreshIntervalMs` 轮询 + turn 完成边沿刷新 + `connection/reset` 重拉）。
- `registry.ts`：per-session `GitController` 复用池 + 组件订阅入口。
- `index.ts`：Cordis `apply` —— 挂 RPC 面、注册三个 slot（`conversation.view` / `conversation.input.left` / `plugins.bundle.config`）、注册 i18n。
- `Panel.tsx`：主面板壳，内部子 tab 路由 + 焦点消费 + 版本条。
- `OverviewTab.tsx`：Git 总览三栏（分支列表 / 提交历史图 / 提交详情 + comment），含 hover 卡片。
- `ChangesTab.tsx` / `ChangeStats.tsx` / `DiffView.tsx`：变更记录页、统计条、并排差异视图。
- `GitPill.tsx`：inputBar 标记 + 跳转。
- `PillConfig.tsx`：插件详情页配置表单（`configForms` 读写 + 写后即时 resync）。
- `tab-dot.ts`：Git 标签状态圆点（pill 隐藏时注入 / 恢复标记时清除）。
- `ImageCompare.tsx`：图片新旧双栏对照（渲染 `image-diff` 查询结果）。
- `jump.ts`：面板/子 tab 一次性焦点中继（模块级 per-session Map）。
- `git-graph.ts` / `file-tree.ts` / `diff.ts`：自研纯算法（提交图车道布局、路径折树、unified diff 拆行）。
- `locales.ts` / `icons.tsx` / `time.ts` / `types.ts`：中英文案、图标、时间格式化、client 侧类型别名。

## 数据流铁律

- **快照单一来源**：pill、变更记录页、统计条共用同一 `GitController` 快照，禁止各自发起独立 snapshot，避免重复 git 命令。
- **按需查询**：总览页 history/branches/show、图片 image-diff 走 `query` 端点，带分页、首页缓存、分代防竞态（新过滤请求接管、旧响应按代丢弃）。
- **双层信封**：RPC 返回 `{ ok, value }` 是传输层结果，业务结果 `{ ok, value|error }` 在 `value` 内，两层都要判。
- **选择集随快照修剪**：变更列表勾选的路径，若在新快照中消失必须移除，否则提交序列会中止。

## 依赖策略

MIT 协议下**优先用成熟开源实现，不重造轮子**：

| 依赖 | 用途 |
|---|---|
| `highlight.js` | diff 视图语法高亮（core + 精选语言，动态 `import()` 懒加载） |

- 平台模块（`react` / `react-dom` / `@deepseek-ai/*`）一律 external，由宿主提供，不打包。
- 只有 dsh 平台专有逻辑（slot / typert 契约、提交图车道布局、路径折树、diff 拆行）才自研。
- `highlight.js` 体积大，只在首次查看 diff 时经 `highlight.ts` → 动态 `import('./highlight-impl')` 拉起，语言集在 `highlight-impl.ts` 里注册。
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

## 验证

- host 改动：`tsc --noEmit` 通过 + 端点逻辑单测。
- client 改动：`node build.mjs` 产出 `lib/client.js` 成功，然后**刷新** `http://127.0.0.1:3082` 验证（当前无 dev:web watcher，client 改动不会热重载，必须重建 + 刷新页面）。
- 测试放在 `test/` 下：`test/unit/*.test.mjs`（`node --test`，纯算法 + host 端点），`test/e2e/*.mjs`（隔离的 file:// 无头浏览器，绝不碰运行中的实例）。命令：`npm run test:unit` / `npm run test:e2e` / `npm test`。
- 提交前跑一次完整 `node build.mjs`，确保 host 与 client 均无错。

## 代码约定

- TypeScript 严格模式，无隐式 any。
- 数据模型改动从 `host/types.ts` 起，client 侧的 RPC 类型直接从它复用——单一权威源，不存在需要手工同步的第二份定义。
- 注释精简，只写最终实现意图，不写演进历史。
- git 命令一律用 argv 数组经 subprocess 执行，禁止拼接 shell 字符串（注入防护 + cwd 锁定）。
- 面向未提交变更的操作（commit / discard / stage）属破坏性或写操作，UI 需二次确认或明确入口，host 侧校验路径安全（拒绝仓库外路径、`..` 穿越）。
- 样式用 dsh 主题 CSS 变量（`--dsw-alias-*`），不硬编码颜色，保证深浅色主题一致。

## 目录与提交

- `docs/local/` 是本地设计稿目录，已在 `.gitignore` 忽略，**不提交**。
- `lib/` **提交入库**：这样 `dsh plugin add github:xbzbing/dsh-git-panel` 能直接安装已构建的树，无需在安装端跑构建。只有测试期生成的 `lib/testkit.mjs` 忽略（`npm run test:unit` 会重建）。`node_modules/` 不提交。
- 只在用户明确要求时创建 commit；优先暂存具体文件而非 `git add .`。
