# dsh-git-panel

[English](https://github.com/xbzbing/dsh-git-panel/blob/main/README.en.md) | 简体中文

![dsh-git-panel](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/banner-zh.png)

`dsh-git-panel` 是一个 DSH Web GUI 插件，在对话工作区里提供 IDE 风格的 Git 面板。它把分支列表、提交历史图、未提交变更的提交与 amend、语法高亮的差异对照集中到一个常驻标签页，并在输入框左侧放一个 zsh 风格的分支标记，让你在对话过程中随手查看仓库状态、提交改动，不必切到终端或另开 IDE。

面板只读取当前会话工作目录所在的 Git 仓库：git 命令以 argv 数组经宿主的 subprocess 服务执行，不拼接 shell 字符串，工作目录锁定在仓库根，并带超时与输出上限。插件默认不改动 git 配置，写操作（提交、amend、暂存、丢弃）都有明确入口。更细的边界见下面的「权限与数据边界」。

## 安装

```bash
# 正式版（npm）
dsh plugin --profile web add @xbzbing/dsh-git-panel@latest

# 预发布（GitHub Release 附件，不发 npm）
dsh plugin --profile web add https://github.com/xbzbing/dsh-git-panel/releases/download/v1.8.0-rc.1/xbzbing-dsh-git-panel-1.8.0-rc.1.tgz
```

预发布版本号带 `-`（如 `1.8.0-rc.1`），只发 GitHub Release、不发 npm，也不会触发面板里的「有新版本」提示。仓库不提交 `lib/`，所以不能用 `dsh plugin add github:…` 安装。

首次安装后，工作区标签栏会直接出现 **Git** 面板，无需重启或刷新页面。更新时，只改了 client 端的版本立即生效；含 host 端改动的版本需重启 dsh。详情页的配置改动即时生效。

> **兼容性**：已在 `dsh@0.2.1-rc.2` 与 `dsh@0.2.2-rc.1` 上实测，安装、Git 面板、输入框标记、host RPC 与插件详情页均可正常使用。

## 功能

- **Git 总览**：分支 / 标签列表、提交历史图与提交详情，点文件即看该提交里的差异。历史支持“消息 / 哈希”和“文件 / 路径”两种搜索，并叠加作者、日期、分支筛选。相对时间列按界面语言自适应宽度，面板变窄时先收起作者、再收起哈希。
- **变更记录**：逐文件或批量暂存 / 放弃，提交与 **Amend**，贮藏，增删行统计。列表可切平铺 / 树形，树形支持整目录暂存与放弃；勾选按行记「侧」，只勾暂存侧就按 index 现有内容提交。
- **常用 Git 操作**：切换 / 新建 / 合并 / 删除分支，拣选提交，增删标签，还原 / 重置。破坏性操作二次确认；合并与拣选冲突会自动中止并恢复；除删除远程分支外不自动推送。没有上游但远端已有同名分支时，同步按钮提供「设置上游」（只写 tracking，不推送不联网），其余情况才提供「发布」。
- **AI 生成提交信息**：参照仓库既有提交风格，模型默认跟随当前会话、可在详情页固定。**生成会把 diff 内容发送给所选模型的供应商。**
- **输入框 Git 标记**：zsh 风格的 `<仓库名> (<分支>)`，绿色为已同步、橙色为有未提交变更，点击跳转面板；空白对话尚未渲染视图标签栏时，改为打开右侧边栏的 Git 页。
- **多仓库切换**：自动识别 worktree 与子目录里的独立仓库；开启 `codeWorkspace` 后，`.code-workspace` 列出的目录（包括工作区之外的仓库）也进入切换器。
- **文件浏览**：浏览工作区目录树，预览代码、Markdown（含 mermaid 图表）、HTML 与图片；配置与文档类文件可以直接编辑保存；Java/Kotlin 项目按路径约定折叠包路径。
- **右键菜单**：文件、目录、图片、分支、提交、变更、贮藏、仓库行和输入框标记都能右键，破坏性操作仍需二次确认。需要 dsh ≥ 0.2.2-alpha.3，旧版本保留浏览器原生菜单。
- **差异与源码查看**：统一 / 对照 / 变更前 / 变更后四种视图，语法高亮、词级强调、上下文按需展开、<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd> 就地查找；图片可缩放、拖拽与全屏。
- **窄面板 / 移动端**：按面板尺寸自动切换布局，侧栏和手机上都能用。
- **多语言**：界面跟随 DSH 系统语言，支持简体中文、English、日本語、Español、Français、Deutsch、Русский、Português，其他语言回落为英文。

## 权限与数据边界

面板以 DSH 进程的权限运行，安装前值得知道这些边界：

- **Git 命令**：经宿主的 `subprocess` 服务以 argv 数组执行，不拼接 shell 字符串，工作目录锁定在仓库根，带超时与输出上限。不使用强制推送或重置；删除本地分支默认走安全删除（`-d`），只在确认框中再次勾选后才用 `-D`；删除远端分支必须勾选确认。合并与拣选只走 git 默认行为，冲突时自动中止并恢复到操作前状态。除「设置上游」、你确认的「发布」（`git push -u`）和从远端分支创建本地分支（`--track`）写入 tracking 配置外，不改动 git 配置。
- **文件访问**：只读工作区内的文件（差异、文件浏览、AI 生成的输入），路径经校验并做 realpath 包含检查——软链指向仓库外一律拒绝，`.git` 不可浏览。唯一例外是开启 `codeWorkspace`（默认关闭）后，由 `.code-workspace` 列出的仓库：每个都要先经 `git rev-parse --show-toplevel` 确认才成为切换器的一行，选中后文件浏览与编辑跟随到那个根，规则不变。
- **写盘只有两处**：「放弃未跟踪条目」按确认删除工作区文件，条目本身是 Git 仓库时整批拒绝；文件浏览里编辑已有文件，限白名单后缀、单个不超过 2 MiB 且为 UTF-8，保存前比对版本、经临时文件原子替换，`.env` 等含密钥的变体也可编辑，可在配置里关闭。
- **网络**：插件自身只发一个请求——`GET https://api.github.com/repos/<owner>/<repo>/releases/latest`，用于版本条上的「有新版本」提示（5 秒超时、进程内缓存）。`fetch` / `pull` / `push` / `publish` / `push --delete` 只在你点击后经 git 联网；「设置上游」不联网。凭据始终由 git 处理，插件不读取、不存储、不返回任何令牌。
- **外部服务**：只有「AI 生成提交信息」会把 diff 内容发送给你在 DSH 中配置的模型供应商；模型调用由宿主完成，插件不持有凭据。
- **系统依赖**：需要 `git` CLI；未安装 git 或目录不是 Git 仓库时只显示文件浏览。

客户端 bundle（`lib/client.js`）不发网络请求，只与宿主走同源 RPC；插件不采集遥测。面板字号、分栏宽度这类界面偏好只存在浏览器 localStorage，不含仓库内容。

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

- **Host**（`lib/host/`）：`dbGitPanel` 命名空间上的 Cordis + typert `GitPanelService`（服务键全局唯一；重复挂载的条目保持惰性，不再激活失败），暴露 `snapshot` / `run` / `query` / `suggest` / `version` / `openFile` / `writeFile` 七个端点，仅做端点委托与生命周期接线；git 命令经宿主 `subprocess` 服务执行（argv 数组、无 shell、cwd 锁仓库根、超时 + 输出上限）；`suggest` 端点经宿主 `llm` 服务用你已配置的模型一次性生成提交信息。
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
    package-tree.ts 源码根识别、包链折叠与 src 投影（文件浏览的 Java/Kotlin 视图）
    suggest.ts      AI 生成提交信息（diff 收集 + 提交语言推断 + ctx.llm 一次性调用）
    parser.ts       git 输出解析为结构化数据
    version.ts      本包版本 + GitHub release 更新检查
  client/
    rpc.ts          dbGitPanel 端点的 client 面
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

感谢 [@homily707](https://github.com/homily707) 为减少高频操作的打断所做的改进（#109）：快进拉取、快进推送和干净工作树下的切分支不再弹确认，直接执行；操作发起后才失败时，错误按发起时的仓库归属显示。PushModal 与 pull / push 的弹窗文案、预览查询也随之移除。

感谢 [@GandzyTM](https://github.com/GandzyTM) 让会话可以停在「枢纽」目录（#121）：他从多根工作区的真实用法出发提出并实现了 `.code-workspace` 支持（#122）——`codeWorkspace` 配置、JSONC 解析与 folder 认证、工作区外仓库的第三道门（ADR-0030），以及浏览与编辑跟随所选根；其后的扫描缓存 TTL、尝试上限与 `.code-workspace` 的编辑支持都建立在这套实现之上。

## 许可证

本项目采用 [MIT License](https://github.com/xbzbing/dsh-git-panel/blob/main/LICENSE)。
