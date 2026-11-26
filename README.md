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
dsh plugin --profile web add https://github.com/xbzbing/dsh-git-panel/releases/download/<TAG>/xbzbing-dsh-git-panel-<VERSION>.tgz
```

通过 dsh 的插件更新机制可以直接更新到新版本，手动更新需要先卸载旧版本，再安装新版本。如果直接通过 add 安装新版本，可能需要重启 dsh 实例。

## 功能

- **Git 总览**：分支 / 标签列表、提交历史图与提交详情，点文件即看该提交里的差异。差异弹窗可切到只读的「文件」视图查看该版本的完整源码，点「复制变更后的文件内容」拿到该提交的整份内容（严格小于 10 MiB）。历史支持“消息 / 哈希”和“文件 / 路径”两种搜索，并叠加作者、日期、分支筛选。相对时间列按界面语言自适应宽度，面板变窄时先收起作者、再收起哈希。
- **变更记录**：逐文件或批量暂存 / 放弃，提交与 **Amend**，贮藏，增删行统计。列表可切平铺 / 树形，树形支持整目录暂存与放弃；勾选按行记「侧」，只勾暂存侧就按 index 现有内容提交。「已暂存的更改」与「更改」两组表头始终保留，空着时计数为 0，一眼能看出有没有暂存。提交按钮右侧的小箭头可把本会话的动作切成「提交并推送」（勾选范围与 Amend 和「提交」共用；选择记在本标签页，刷新与热重载保持，新标签页回到默认），<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> 始终执行「提交并推送」。推送失败不会撤销提交；落后 / 分叉、没有上游、游离 HEAD、空仓库或 amend 已推送时只提交，原因按提交后的状态判断，以中性通知显示在提交框上方（只有推送被拒才显示为错误）。
- **常用 Git 操作**：切换 / 新建 / 合并 / 删除分支，拣选提交，增删标签，还原 / 重置。破坏性操作二次确认；合并与拣选冲突会自动中止并恢复；除删除远程分支外不自动推送。没有上游但远端已有同名分支时，同步按钮提供「设置上游」（只写 tracking，不推送不联网），其余情况才提供「发布」。状态栏只用符号表示同步状态：`✓` 已同步、`↑n` 待推送、`↓n` 待拉取、`↓n ↑n` 已分叉、`HEAD` 游离，没有上游时是一个不带数字的 `↑`；完整句子留在悬停提示与读屏名称里。分叉时提供一次确认的「同步」：先把远程提交合并进当前分支，再普通推送（不 force，冲突自动中止）。
- **Git Flow**：分支列表支持 Feature、Release、Hotfix 的开始、整合和完成，覆盖 `develop`、`main` / `master` 与约定前缀分支；finish 会预览合并、tag、push 和删除步骤并要求确认。详细操作见 [Git Flow 使用帮助](docs/git-flow-user-guide.zh.md)，安全约束与实现边界见 [ADR-0037](docs/adr/0037-git-flow-operations.md)。
- **AI 生成提交信息**：参照仓库既有提交风格，模型默认跟随当前会话、可在详情页固定。**生成会把 diff 内容发送给所选模型的供应商。**
- **输入框 Git 标记**：zsh 风格的 `<仓库名> (<分支>)`，绿色为已同步、橙色为有未提交变更，点击跳转面板；开启跟随时，进入 / 退出本仓库的 worktree 会同步更新标记，无需先打开 Git 面板。空白对话尚未渲染视图标签栏时，点击改为打开右侧边栏的 Git 页。
- **多仓库切换**：自动识别 worktree 与子目录里的独立仓库，会话自己仓库的 worktree 建在工作区外也能直接切换；`.code-workspace` 里 `folders` 列出的目录（包括工作区之外的仓库）也能加入同一个列表，详见 [多仓库与工作区文件](#多仓库与工作区文件)。**存储库**区还能把列表上限设为 10–100（默认 50）：数量越多，扫描与渲染越慢。
- **文件浏览**：浏览工作区目录树，预览代码、Markdown（含 mermaid 图表）、HTML 与图片；配置与文档类文件可以直接编辑保存；Java/Kotlin 项目按路径约定折叠包路径。源码预览支持 <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>A</kbd> 全选；文件不超过 2000 行且不超过 1 MiB 时整篇已挂载，选中即全文，超过后预览转为虚拟窗口，Ctrl/⌘+A 只覆盖已加载行并给出提示，整份内容请用「复制文件内容」。Markdown 阅读时右上角默认只有一个「目录」按钮（不挡正文），点一下展开成悬浮目录：跟着阅读进度标出当前章节，点一下就跳过去；它只浮在文档之上（压在滚动中的代码块标题条之上）、不占阅读宽度，宽度只有原来卡片的六成左右，条目过长省略。目录可以收回按钮，也能整张关掉，关掉后不占任何位置，重新打开这个文件时按钮重新出现。全屏阅读器按屏幕大小伸缩（大屏更大，最大约 1600×1100）。
- **右键菜单**：文件、目录、图片、分支、提交、变更、贮藏、仓库行和输入框标记都能右键，破坏性操作仍需二次确认。需要 dsh ≥ 0.2.2-alpha.3，旧版本保留浏览器原生菜单。
- **差异与源码查看**：统一 / 对照 / 变更前 / 变更后四种视图；统一视图按连续变更块先展示删除、再展示新增，不逐行交错，增删底色覆盖行号；词级强调只突出局部编辑，跳过仅共享空白或两侧大部分内容都被替换的行（[ADR-0042](docs/adr/0042-unified-change-blocks.md)、[ADR-0043](docs/adr/0043-word-emphasis-heuristic.md)）。支持语法高亮、上下文按需展开、<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd> 就地查找；图片可缩放、拖拽与全屏。提交差异弹窗另有只读「文件」视图，复用文件浏览的两档渲染：不超过 2000 行且不超过 1 MiB 时全量挂载，超过转虚拟窗口；「复制变更后的文件内容」读取该版本的完整文本（严格小于 10 MiB），不受 diff 截断或隐藏上下文影响。
- **差异行内评论**：在任意文本差异里，鼠标停在某一行时行号旁会出现「+」，点它（或行号）选中这一行，Shift+点击扩展到同一段改动内（键盘：Tab 进入行号，上下方向键移动，Enter 选中、Shift+Enter 扩展），写下意见后点「添加到输入框」，评论连同仓库、文件、修改前 / 后、行号、对比对象和选中行前后各 3 行改动作为引用写进当前会话的输入框，不会自动发送；多条评论攒在草稿里一次发出。引用格式与 dsh 0.2.3 可选插件「变更请求与工作树」的「本地变更」页签一致，两边的评论连续编号；启用了该插件且看的是会话自己的仓库时，变更页差异工具栏还有「在「本地变更」中审阅」入口。文件右键菜单用平台的「添加到对话」（dsh ≥ 0.2.3）在输入框里插入 `@文件` 引用，替代本插件的「引用到输入框」；旧宿主仍是「引用到输入框」，目录行不变。设计见 [ADR-0039](docs/adr/0039-diff-review-quotes.md)。
- **窄面板 / 移动端**：按面板尺寸自动切换布局，侧栏和手机上都能用。
- **多语言**：界面跟随 DSH 系统语言，支持简体中文、English、日本語、Español、Français、Deutsch、Русский、Português，其他语言回落为英文。

## Git Flow

Git Flow 入口位于 Git 总览的分支列表，支持 Feature、Release、Hotfix 的开始、整合和完成；入口默认开启，可在「什么是 Git Flow」弹窗里关闭，并在插件设置中重新开启。它按 `develop`、`main` / `master` 以及 `feature/*`、`release/*`、`hotfix/*` 约定工作。完成操作会预览目标 branch、集成方式、tag、push 和删除步骤，并在写入前要求确认。

Git Flow 使用帮助包含基本概念、Mermaid 分支流程图、插件界面截图和从 Feature 到 Release / Hotfix 的完整案例。finish push 会包含 release / hotfix 的新 tag 和本次移动的长期 branch。多步操作失败可能返回 `flow-partial`，请先刷新并检查 branch、tag 和 remote，再按当前状态重试。release / hotfix 的 merge、tag 和 develop 回合并已完成时，host 可以识别状态并继续后续步骤。完整操作说明见 [Git Flow 使用帮助](docs/git-flow-user-guide.zh.md)，安全约束与实现边界见 [ADR-0037](docs/adr/0037-git-flow-operations.md)。

## 多仓库与工作区文件

切换器默认跟随会话工作目录所在的仓库，但可以同时列出三类：会话自己仓库的每一个 worktree（建在工作区外也一样）、工作区子目录里的独立仓库、以及 VS Code 的 `.code-workspace` 多根工作区文件里 `folders` 列出的目录——最后一类通常就在工作区之外，也是「枢纽目录」那种布局的写法。会话的实时工作目录在本仓库自己的检出之间移动时（平台的 `enter_worktree` / `exit_worktree`，或外部创建但已认证的 worktree），输入框标记与面板共用的仓库选择自动切换过去，无需先打开面板；同时打开对话页与侧栏面板也只维护一份仓库列表和跟随状态。无关的子仓库与 `.code-workspace` 外部根不会被自动跟随。自动切换只在目录真的变化时发生：手动选过某个检出后，刷新页面、热重载、列表重取或 worktree 探测失败期间都会保留这个选择，不会改回自动结果；把设置从关闭切到开启时，则对当前目录立即跟随一次。跟随不弹未保存编辑的确认，草稿会保留，并标注它属于哪个检出。这个跟随默认开启，可在插件设置的「存储库」区关闭。

选中的仓库和文件浏览根按会话记在当前标签页（`sessionStorage`）：刷新页面、或安装 / 卸载其他插件触发热重载后，面板回到原来的检出。新开的空白标签页和重开的浏览器仍从默认仓库开始；「复制标签页」或从本页打开的标签页会带着当时的选择起步，之后各记各的。面板只有在 host 明确答复「这个检出已经没了」时才删掉记录。git 一时没应答（例如 worktree 列表超时）时列表算不完整：记录不删，手动选择也继续生效，不会先回落到默认仓库；`.code-workspace` 文件正在编辑、暂时读不出来，或 host 只能给「未核实」的否决，只让本次先回到默认仓库，下次加载再试。

第三类必须显式开启：它读的是磁盘上的文件，而仓库里提交的工作区文件不该只因为会话打开就自动生效。**存储库**区的 `codeWorkspace` 有三档：

- **关闭**（默认）：不读任何工作区文件。
- **自动发现**：会话目录里有且只有一个 `*.code-workspace` 时用它；两个以上不猜，改为提示无法自动选择。
- **指定文件名**：只填文件名（如 `team.code-workspace`），不带路径；文件必须在会话目录里。

开启后：

- folder 的 `path` 可以相对工作区文件，也可以写绝对路径。它要经 realpath 落在会话目录之外，且 `git rev-parse --show-toplevel` 正好等于该目录，才会成为一行；子目录、普通目录、以及指回会话目录的 folder 都会被跳过（后者已经由扫描列出，不重复成行）。
- `folders[].name` 就是那一行的显示名；一次最多 50 个根，超出的忽略。
- 外部根只把 folder 自己当作一行，不展开它自己的 worktree。
- 会话目录里有工作区文件而设置仍是「关闭」时，仓库切换器顶部就地提示（工作目录不是仓库时，提示落在文件浏览的通知条），点一次即开启。这是插件级设置，开启后对所有会话生效；提示本身不改变任何行为。
- 文件用不了时会说清是哪一项检查拒绝的：名字不合法、软链指向目录外、同名目录占位、文件过大、读不出来，或内容不是工作区文件——最常见的是 `folders` 某项缺 `path`；JSONC 的注释与尾逗号是支持的。

## 权限与数据边界

面板以 DSH 进程的权限运行，安装前值得知道这些边界：

- **Git 命令**：经宿主的 `subprocess` 服务以 argv 数组执行，不拼接 shell 字符串，工作目录锁定在仓库根，带超时与输出上限。不使用强制推送或重置；删除本地分支默认走安全删除（`-d`），只在确认框中再次勾选后才用 `-D`（squash 场景），或 Git Flow 完成时 `-d` 因上游落后拒绝、宿主先证明分支 tip 已在 HEAD 祖先链上再补 `-D`；删除远端分支必须勾选确认。合并与拣选只走 git 默认行为，冲突时自动中止并恢复到操作前状态。除「设置上游」、你确认的「发布」（`git push -u`）和从远端分支创建本地分支（`--track`）写入 tracking 配置外，不改动 git 配置。
- **文件访问**：只读工作区内的文件（差异、文件浏览、AI 生成的输入），路径经校验并做 realpath 包含检查——软链指向仓库外一律拒绝，`.git` 不可浏览。走出工作区只有两种方式，都按 realpath 精确比对：会话自己仓库的 worktree 可以在任意位置直接切换，但要求该目录的 `.git` 回指本仓库的 `worktrees/` 记录（记录本身可被复制或手写，单凭 `git worktree list` 不算证据）；`.code-workspace` 列出的仓库则要先把 `codeWorkspace` 打开（默认关闭）。两类根都要先经 `git rev-parse --show-toplevel` 确认才成为切换器的一行，选中后文件浏览与编辑跟随到那个根，规则不变。
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
- **Client**（`lib/client.js`）：一个 React 包，注册 `conversation.view` 面板和 `conversation.input.left` 标记。每会话一个快照控制器（轮询 + turn 完成后刷新 + 连接重置重拉），标记、变更记录页和统计条共用同一份快照，避免重复 git 命令。另由每会话一个共享检出生命周期统一仓库列表、实时目录跟随和选择修复；多个标记 / 面板共用同一轮扫描，不各自发起 `repo-list` 或快照。

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
    queries.ts      history / diff / file-lines / file-version / image-diff / dir-list / file-content / show / branches / tags / worktree-stats
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
    DiffReviewBar.tsx 差异行内评论：选行状态与评论框
    review-quote.ts 评论引用的格式、编号与选区规则
    GitPill.tsx     输入框标记
    code-spans.ts   将语法高亮 token 按词级改动区间切分
    git-graph.ts    提交图车道布局
    file-tree.ts    路径折树
    diff.ts         unified diff → 并排行 + 统一行 + 统计
```

## 致谢

感谢 [@ivanant](https://github.com/ivanant) 持续的优化建议、迭代需求与代码贡献。移动端布局、变更记录的批量选择、AI 生成提交信息、提交图与图标的细节打磨、没有远程分支时的推送（publish）等改进，大多来自他反馈的真实使用场景；这些反馈把面板从「能用」推到了现在的形态。Git Flow 分支工作流（#133）也由他实现：分支列表里的开始 / 完成 / 整合入口、分支与标签按 flow 规则校验、完成时的步骤确认与链式 release，以及随动作变化的分支变更预览图；本版的完成流程加固、入口开关与使用文档都建立在这套实现之上。

感谢 [@QianYI-Yan](https://github.com/QianYI-Yan) 为工作区多仓库支持打下的基础（#83）：扫描工作区子目录里的独立仓库、RPC 请求带可选 `repo` 字段切换工作树、切换仓库时旧内容压暗等第一批实现都来自他的 PR（#85）；本版的 worktree 识别与文件浏览根都构建在这之上。

感谢 [@homily707](https://github.com/homily707) 为减少高频操作的打断所做的改进（#109）：快进拉取、快进推送和干净工作树下的切分支不再弹确认，直接执行；操作发起后才失败时，错误按发起时的仓库归属显示。PushModal 与 pull / push 的弹窗文案、预览查询也随之移除。

感谢 [@GandzyTM](https://github.com/GandzyTM) 让会话可以停在「枢纽」目录（#121）：他从多根工作区的真实用法出发提出并实现了 `.code-workspace` 支持（#122）——`codeWorkspace` 配置、JSONC 解析与 folder 认证、工作区外仓库的第三道门（ADR-0030），以及浏览与编辑跟随所选根；其后的扫描缓存 TTL、尝试上限与 `.code-workspace` 的编辑支持都建立在这套实现之上。

## 许可证

本项目采用 [MIT License](https://github.com/xbzbing/dsh-git-panel/blob/main/LICENSE)。
