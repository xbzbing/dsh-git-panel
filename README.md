# dsh-git-panel

[English](https://github.com/xbzbing/dsh-git-panel/blob/main/README.en.md) | 简体中文

![dsh-git-panel](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/banner-zh.png)

`dsh-git-panel` 是一个 DSH Web GUI 插件，在对话工作区里提供 IDE 风格的 Git 面板。它把分支列表、提交历史图、未提交变更的提交与 amend、语法高亮的差异对照集中到一个常驻标签页，并在输入框左侧放一个 zsh 风格的分支标记，让你在对话过程中随手查看仓库状态、提交改动，不必切到终端或另开 IDE。

面板只读取当前会话工作目录所在的 Git 仓库，所有 git 命令都以 argv 数组经宿主的 subprocess 服务执行，不拼接 shell 字符串，工作目录锁定在仓库根，并带超时与输出上限。插件不改动 git 配置，写操作（提交、amend、暂存、丢弃）都有明确入口。

## 安装

```bash
# 正式版（npm）
dsh plugin --profile web add @xbzbing/dsh-git-panel@latest

# 预发布（GitHub Release 附件，不发 npm）
dsh plugin --profile web add https://github.com/xbzbing/dsh-git-panel/releases/download/v1.8.0-rc.1/xbzbing-dsh-git-panel-1.8.0-rc.1.tgz
```

预发布版本号带 `-`（如 `1.8.0-rc.1`），只发 GitHub Release、不发 npm，也不会触发面板里的「有新版本」提示。仓库不提交 `lib/`，所以不能用 `dsh plugin add github:…` 安装。

首次安装后，工作区标签栏会直接出现 **Git** 面板，无需重启或刷新页面。更新时，只改了 client 端的版本立即生效；含 host 端改动的版本需重启 dsh。详情页的配置改动即时生效。

> **兼容性**：已在 `dsh@0.2.1-rc.2` 与 `dsh@0.2.2-alpha.2` 上实测，安装、Git 面板、输入框标记、host RPC 与插件详情页均可正常使用。

## 功能

- **Git 总览**：分支 / 标签列表、可搜索的提交历史图、提交详情，点文件即看该提交里的差异。
- **变更记录**：逐文件或批量暂存、放弃，提交与 **Amend**，贮藏，增删行统计。
- **常用 Git 操作**：切换分支、增删标签、还原 / 重置提交；破坏性操作需二次确认，只改本地仓库、不自动推送。
- **AI 生成提交信息**：参照仓库既有提交风格生成，模型默认跟随当前会话，可在详情页固定。**生成会把 diff 内容发送给所选模型的供应商。**
- **输入框 Git 标记**：zsh 风格的 `<仓库名> (<分支>)`，绿色为已同步、橙色为有未提交变更，点击跳转面板。
- **多仓库切换**：自动识别 worktree 与子目录里的独立仓库，切换后总览、变更记录和输入框标记都作用于所选仓库；点行切换后列表保持展开，连续换仓库不用再点一次，切回读过的仓库直接换回它上一次的内容。
- **文件浏览**：浏览工作区目录树，预览代码、Markdown（含 mermaid 图表）、HTML 与图片；默认以项目根为根，也可随 Git 切换换根；非 Git 目录同样可用。
- **差异与源码查看**：统一 / 对照 / 变更前 / 变更后四种视图，语法高亮、词级强调、上下文按需展开、<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd> 就地查找；图片可缩放、拖拽与全屏。
- **窄面板 / 移动端**：按面板尺寸自动切换布局，侧栏和手机上都能用。
- **多语言**：界面跟随 DSH 系统语言，支持简体中文、English、日本語、Español、Français、Deutsch、Русский、Português，其他语言回落为英文。

## 权限与数据边界

面板以 DSH 进程的权限运行，安装前值得知道这些边界：

- **Git 命令**：所有 git 命令都经宿主的 `subprocess` 服务执行——argv 数组、不拼接 shell 字符串、工作目录锁定在仓库根，每条命令带超时与输出上限；不使用 `--force`，也不改动 git 配置。
- **文件访问**：只读工作区内的文件（差异、文件浏览、AI 生成的输入），路径经校验并做 realpath 包含检查——软链指向仓库外一律拒绝，`.git` 不可浏览。**唯一的写盘动作**是「放弃未跟踪条目」：按你的确认直接删除工作区文件，条目本身是 Git 仓库时整批拒绝。
- **网络**：插件自身只发起一个请求——`GET https://api.github.com/repos/<owner>/<repo>/releases/latest`，用于版本条上的「有新版本」提示（5 秒超时，结果带进程内缓存）。`fetch` / `pull` / `push` / `publish` 只在你点击后经 git 命令联网，凭据始终由 git 处理；插件不读取、不存储、不返回任何令牌或凭据。
- **外部服务**：只有「AI 生成提交信息」会把 diff 内容发送给你在 DSH 中配置的模型供应商；模型调用由宿主完成，插件不持有凭据。
- **系统依赖**：需要 `git` CLI；未安装 git 或目录不是 Git 仓库时只显示文件浏览，以当前工作目录为根。

客户端 bundle（`lib/client.js`）不发起网络请求，只与宿主走同源 RPC；插件不采集遥测。面板字号、分栏宽度这类界面偏好只存在浏览器 localStorage，不含仓库内容。除 git 命令与被确认的删除外，插件代码不在工作区之外读写文件；详情页的配置项由宿主写进 profile 配置。

## 界面

| Git 总览 | 文件差异 modal |
| :---: | :---: |
| ![Git 总览：分支、提交历史图、提交详情与 hover 卡片](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/1-git-panel-overview.png) | ![文件差异 modal：语法高亮的统一 / 并排对照、块间按需展开与词级高亮](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/2-overview-tab.png) |
| 变更记录 | 文件浏览 |
| ![变更记录：统计条、未提交变更列表、提交框与差异对照](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/3-changes.png) | ![文件浏览：懒加载目录树、官方类型图标、忽略项半透明与文件预览](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/4-files.png) |
| 窄面板 / 移动端 | 插件配置 |
| ![窄面板 / 移动端：≤620px 单栏钻取布局，统计条、变更列表与提交框纵向排列](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/5-mobile-panel.png) | ![插件配置：输入框标记开关、差异默认视图、提交图样式与 AI 生成设置](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/6-plugin-config.png) |

## 架构

插件分 host / client 两半，通过 typert Remote 网关通信。

- **Host**（`lib/host/`）：`gitPanel` 命名空间上的 Cordis + typert `GitPanelService`，暴露 `snapshot` / `run` / `query` / `suggest` / `version` 五个端点，仅做端点委托与生命周期接线；git 命令经宿主 `subprocess` 服务执行（argv 数组、无 shell、cwd 锁仓库根、超时 + 输出上限）；`suggest` 端点经宿主 `llm` 服务用你已配置的模型一次性生成提交信息。
- **Client**（`lib/client.js`）：一个 React 包，注册 `conversation.view` 面板和 `conversation.input.left` 标记。每会话一个快照控制器（轮询 + turn 完成后刷新 + 连接重置重拉），标记、变更记录页和统计条共用同一份快照，避免重复 git 命令。

## 开发

```bash
node build.mjs      # tsc（host d.ts）+ esbuild（host 逐模块 js + client bundle + testkit）
npm run typecheck   # 类型检查
npm run test:unit   # 纯算法与 host 端点单测（node --test）
npm run test:e2e    # 隔离的 file:// 无头浏览器 e2e（不碰任何运行中的实例）
npm test            # 单测 + e2e
```

host 产物按 `src/host/` 逐模块输出（一个源文件一个 js，堆栈直接落在出问题的模块），且不做压缩：typert 网关靠方法参数名做参数校验，压缩会改名并破坏 wire 契约。client 改动有热重载：重新构建 `lib/client.js` 后，运行中的 dsh 秒级检测到文件变化并推给浏览器原地热替换，无需刷新页面；host 半改动仍需重启（已加载的旧代码跑到重启为止）。`lib/` 是本地构建产物、不入库；本地联调：把插件加入 dsh web profile 的 `dsh.profile.bundles`，用 `file:` 依赖指向本目录，`node build.mjs` 后即生效。

## 项目结构

```text
src/
  host/
    types.ts        wire 数据模型的唯一权威源（client 直接复用）
    index.ts        GitPanelService：端点委托与生命周期接线
    git.ts          subprocess → 带超时的 GitRunner
    core.ts         workspace 解析 + snapshotForSession
    actions.ts      GitAction → git 命令序列（commit / amend / stage 等）
    queries.ts      history / diff / file-lines / image-diff / dir-list / file-content / show / branches / tags / worktree-stats
    suggest.ts      AI 生成提交信息（diff 收集 + 提交语言推断 + ctx.llm 一次性调用）
    parser.ts       git 输出解析为结构化数据
    version.ts      本包版本 + GitHub release 更新检查
  client/
    rpc.ts          gitPanel 端点的 client 面
    controller.ts   每会话快照控制器
    Panel.tsx       主面板壳：子 tab 路由 + 版本条
    OverviewTab.tsx Git 总览三栏 + hover 卡片
    ChangesTab.tsx  变更记录页
    FilesTab.tsx    文件浏览（懒加载目录树 + 文件预览）
    DiffView.tsx    差异视图（统一 / 并排 / 变更前 / 变更后）
    GitPill.tsx     输入框标记
    code-spans.ts   将语法高亮 token 按词级改动区间切分
    git-graph.ts    提交图车道布局
    file-tree.ts    路径折树
    diff.ts         unified diff → 并排行 + 统一行 + 统计
```

## 致谢

感谢 [@ivanant](https://github.com/ivanant) 为项目提出的各种优化建议和迭代需求。移动端布局、变更记录的批量选择、AI 生成提交信息、提交图与图标的细节打磨、没有远程分支时的推送（publish）等改进，大多来自他持续反馈的真实使用场景；这些反馈把面板从「能用」推到了现在的形态。

感谢 [@QianYI-Yan](https://github.com/QianYI-Yan) 为工作区多仓库支持打下的基础（#83）：扫描工作区子目录里的独立仓库、RPC 请求带可选 `repo` 字段切换工作树、切换仓库时旧内容压暗等第一批实现都来自他的 PR（#85）；本版的 worktree 识别与文件浏览根都构建在这之上。

## 许可证

本项目采用 [MIT License](https://github.com/xbzbing/dsh-git-panel/blob/main/LICENSE)。
