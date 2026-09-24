# AGENTS.md

本文件是 `dsh-git-panel` 仓库的 agent 工作指南。任何在此仓库工作的 AI agent 或贡献者，动手前先读完本文件，并遵守其中的架构边界、构建流程与代码约定。

## 项目定位

`dsh-git-panel` 是 DeepSeek Harness（dsh）的一个插件，在 Web GUI 里提供 Git 面板能力：

- 工作区新增常驻面板 tab「Git」，位于「对话」「轨迹」之后，内部含两个子 tab：
  - **Git 总览**：左=分支列表，中=提交历史图（支持 commit id 等字段搜索），右=提交详情 + comment。
  - **变更记录**：左=变更统计（文件数 / 增删行数 / 最近变更时间）+ 本地未提交变更列表（勾选、手动提交、Amend），右=选中文件差异对比。
- inputBar 一个 zsh 风格 Git 标记：`<仓库名> git:(<分支>)`，绿色=已同步、橙色=有待提交；hover 显示完整路径；点击跳转面板（有未提交→变更记录，已提交→Git 总览）。

许可：MIT。

## 架构总览

插件分 host / client 两半，经 typert Remote 通信。

```
Client 半 (React bundle, lib/client.js)
  - conversation.view (order 30)  → Panel 主面板（内部子 tab 路由）
  - conversation.input.left       → GitPill（zsh 风格标记）
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

- `types.ts` 是 wire 数据模型的**唯一权威源**。client 侧的 zod schema 必须与之保持一致。
- `index.ts`：`GitPanelService extends TypertRemoteService`，`inject = ['subprocess','sessions','sessionPersistence']`，仅做端点委托与生命周期接线。
- `git.ts`：把 `subprocess` 服务适配成带超时的 `GitRunner`。
- `core.ts`：workspace（cwd→仓库根 realpath）解析 + `snapshotForSession`。
- `actions.ts`：`GitAction` → git 命令序列构造（含 `commit --amend`、按路径提交的两步 `add + commit`）。
- `queries.ts`：`history / branches / tags / show / diff / last-commit-message / worktree-stats`。
- `parser.ts`：`git status --porcelain` / `--numstat` / `log` 输出解析为结构化数据。

### Client（`src/client/`）

- `remote.ts`：typert Remote 贡献 + zod strict codec，逐字镜像 `host/types.ts`。
- `controller.ts`：每 session 的快照控制器（单航刷新 + `refreshIntervalMs` 轮询 + turn 完成边沿刷新 + `connection/reset` 重拉）。
- `index.ts`：Cordis `apply` —— 挂 Remote、注册两个 slot、注册 i18n。
- `Panel.tsx`：主面板壳，内部 tab 路由 + 焦点消费。
- `overview/`：Git 总览三栏（`BranchList` / `CommitGraph` / `CommitDetail`）。
- `changes/`：变更记录（`ChangeList` / `ChangeStats` / `CommitBox` / `DiffView`）。
- `pill/GitPill.tsx`：inputBar 标记 + 跳转。
- `jump.ts`：面板/子 tab 一次性焦点中继（模块级 per-session Map）。
- `git-graph.ts` / `file-tree.ts` / `diff.ts`：自研纯算法（提交图车道布局、路径折树、unified diff 拆行）。

## 数据流铁律

- **快照单一来源**：pill、变更记录页、统计条共用同一 `GitController` 快照，禁止各自发起独立 snapshot，避免重复 git 命令。
- **按需查询**：总览页 history/branches/show 走 `query` 端点，带分页、首页缓存、分代防竞态（新过滤请求接管、旧响应按代丢弃）。
- **双层信封**：RPC 返回 `{ ok, value }` 是传输层结果，业务结果 `{ ok, value|error }` 在 `value` 内，两层都要判。
- **选择集随快照修剪**：变更列表勾选的路径，若在新快照中消失必须移除，否则提交序列会中止。

## 依赖策略

MIT 协议下**优先用成熟开源实现，不重造轮子**：

| 依赖 | 用途 |
|---|---|
| `zod` | wire 契约 strict 校验 |
| `shiki` | diff / 代码语法高亮（懒加载语言） |
| `markdown-it` | .md 渲染视图、提交正文富文本 |
| `mermaid` | markdown 中 mermaid 代码块（动态 import 懒加载） |

- 平台模块（`react` / `react-dom` / `@deepseek-ai/*`）一律 external，由宿主提供，不打包。
- `shiki` / `mermaid` 体积大，仅在实际查看 diff / 图时动态 `import()`。
- 只有 dsh 平台专有逻辑（slot / typert 契约、提交图车道布局、路径折树、diff 拆行）才自研。
- 新增依赖 pin 精确版本，写入 `package.json` `dependencies`。

## 构建

`build.mjs` 两步：

1. `tsc -p tsconfig.build.json` 出 `lib/host/`（ESM + d.ts，**绝不压缩**——typert SRC 靠方法参数名反射校验参数，重命名会破坏 wire 契约）。
2. esbuild 打 `src/client/index.ts` → `lib/client.js`（cjs + banner/footer 包成 `window.__ModuleLoader__.load({id,factory})`；`react`/`@deepseek-ai/*` external；client 可 minify）。

命令：

```bash
node build.mjs        # 全量构建 host + client
npx tsc --noEmit      # 类型检查
```

## 验证

- host 改动：`tsc --noEmit` 通过 + 端点逻辑单测。
- client 改动：`node build.mjs` 产出 `lib/client.js` 成功，然后**刷新** `http://127.0.0.1:3082` 验证（当前无 dev:web watcher，client 改动不会热重载，必须重建 + 刷新页面）。
- 测试放在 `test/` 下：`test/unit/*.test.mjs`（`node --test`，纯算法 + host 端点），`test/e2e/*.mjs`（隔离的 file:// 无头浏览器，绝不碰运行中的实例）。命令：`npm run test:unit` / `npm run test:e2e` / `npm test`。
- 提交前跑一次完整 `node build.mjs`，确保 host 与 client 均无错。

## 代码约定

- TypeScript 严格模式，无隐式 any。
- 数据模型改动从 `host/types.ts` 起，再同步 `client/remote.ts` 的 zod schema——两者不一致会在 wire 边界被 strict 解码拒绝。
- 注释精简，只写最终实现意图，不写演进历史。
- git 命令一律用 argv 数组经 subprocess 执行，禁止拼接 shell 字符串（注入防护 + cwd 锁定）。
- 面向未提交变更的操作（commit / discard / stage）属破坏性或写操作，UI 需二次确认或明确入口，host 侧校验路径安全（拒绝仓库外路径、`..` 穿越）。
- 样式用 dsh 主题 CSS 变量（`--dsw-alias-*`），不硬编码颜色，保证深浅色主题一致。

## 目录与提交

- `docs/local/` 是本地设计稿目录，已在 `.gitignore` 忽略，**不提交**。
- `lib/` **提交入库**：这样 `dsh plugin add github:xbzbing/dsh-git-panel` 能直接安装已构建的树，无需在安装端跑构建。只有测试期生成的 `lib/testkit.mjs` 忽略（`npm run test:unit` 会重建）。`node_modules/` 不提交。
- 只在用户明确要求时创建 commit；优先暂存具体文件而非 `git add .`。
