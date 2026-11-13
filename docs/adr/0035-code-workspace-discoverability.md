# ADR-0035：工作区文件的可发现性与 cwd 外 worktree 的可选性

- 状态：Accepted（2026-11-13）；认证判据、缓存语义与 `uncertified` 行由同日修订补齐（身份校验取代「记录即证据」）
- 相关：issue #125、PR #122、ADR-0030、`src/host/core.ts`（`listSessionRepos`、`certifiedCheckouts`、`buildCheckouts`）、`src/host/repos.ts`（`repoDirCertified`）、`src/host/code-workspace.ts`（`listWorkspaceFiles`）、`src/host/worktrees.ts`、`src/client/PillConfig.tsx`、`src/client/ReposSection.tsx`、`src/client/Panel.tsx`

## Context

issue #125 报告：`.code-workspace` 功能本身按设计工作，但**没有任何可发现的方式开启它**——面板的「存储库」区没有对应控件，client bundle 里连 `codeWorkspace` 这个字符串都没有，README 只说「开启后」却不说在哪开、可选什么值。默认值 `off` 是 ADR-0030 的有意设计（工作区文件是仓库内容，可被提交或被 agent 改写，不能让它单独扩大文件访问面），因此「全新安装看不到外部仓库」不是 bug，缺陷在于**沉默**：cwd 里明明有一个工作区文件，面板一个字都不说。

同期暴露出第二处不一致：`git worktree list` 报出的 checkout 中，位于 cwd 之外的那些被标记 `disabled: 'outside'`（列出但不可选），而同一个目录只要被工作区文件点名就可以选。两类路径都跨出 cwd，却有两套判据；而且被点名的那个目录会出现「行说不可选、门其实放行」的自相矛盾。

约束：

- 默认值不能改成 `auto`：那等于让克隆仓库里提交的工作区文件在会话打开时自动生效，把 ADR-0030 明确拒绝的被动授权重新打开。issue 作者本人在报告里也认同默认 `off`。
- 用户的目标是「读取自己配置的目录」，便利性应该体现在**开启的成本**，不是**默认替所有仓库打开**。
- `AGENTS.md` 的安全不变量：cwd 之外的门必须按 realpath 精确判定，新增出口要另加一道门并写 ADR。

## Decision

### 1. `off` 不再沉默：发现即提示，提示不等于生效

`repo-list` 在设置 `off` 时仍会读一次 cwd 顶层，把按 VS Code 同一规则识别到的工作区文件报为新状态 `codeWorkspace.state = 'available'`（`file` 为单个候选的绝对路径，`count` 为候选数）。该状态**不产出任何仓库行**，只让客户端渲染一行提示，用户点一下才把 `codeWorkspace` 写成 `auto`。

- 提示出现在两个位置，取决于会话有没有 Git 页：仓库切换器顶部（有 checkout 时），以及文件浏览通知条（cwd 不是仓库、面板只剩文件浏览时——这正是本功能的主场景）。
- 提示文案说明作用域：这是**插件级**设置，开启后对所有会话生效。
- 配置控件是「存储库」区的三态分段控件：`关闭` / `自动发现` / `指定文件`；第三态露出文件名输入框，形状校验（单段、`.code-workspace` 结尾）在提交前完成，host 仍做最终判定。
- 识别状态全部渲染：`applied` 通常不出声（行本身就是证据），但**一个根都没有解析出来**时说明一句——「文件已启用，但列出的目录都不是仓库」，否则「功能开了却没反应」还是同一种沉默；`missing` / `invalid` / `ambiguous` 以警告提示说明原因，文件名打错不再表现为「什么都没有发生」。
- `invalid` 带上**是哪一项检查拒绝了文件**（`codeWorkspace.reason`：`name` / `link` / `not-file` / `size` / `read` / `parse`），而不是六个成因共用一句话。这六种失败的修法各不相同（改设置、把文件移进 cwd、把同名目录换回文件、缩小文件、修权限、修 JSON），一条「名称不合法，或链接指向目录外」的旧文案只说明「有问题」，还把最常见的内容解析失败引向设置名和软链。旧 host 不发该字段，客户端此时回落通用文案而不是替它猜一项检查；旧 client 忽略未知字段。
- 写配置后客户端显式重取 `repo-list`（写的是插件级 setting，host 会重建服务，一次读取可能仍拿到旧值，因此安排两次读取）。

### 2. `repoDirCertified` 接受会话自己仓库的**每一个** checkout，但按身份判定

第三道门原先只认主工作树（一个目录），现在认该仓库的全部 checkout。**「记录存在」不等于「这个仓库拥有它」**：`git worktree list` 只是回放 `.git/worktrees/<id>/gitdir` 里写的路径，那是一份普通可写文件，不回链校验。两条实测过的路都证明不能直接信记录：手写一条 `gitdir` 指向另一个仓库的 `.git`，那个目录会被报成「本仓库的 worktree」；把一个带 worktree 的仓库整目录 `cp -R`（tar 解包、备份恢复同理），副本的记录仍写着原机绝对路径，副本就会声称别人的 checkout 是自己的。克隆确实带不出记录，但「只有 `git worktree add` 会产生记录」不成立。

因此认证改由身份决定（`isOwnCheckout` / `checkoutGitDir`，不额外起进程）：

- 主工作树的 `.git` 解析出的 git dir 必须等于 `git rev-parse --git-common-dir` 的 realpath；
- 链接工作树的 `.git` 必须是文件，其 `gitdir:` 指向 `<common-dir>/worktrees/` 下的一条记录；
- 不合格的记录不进入认证集合，选择器因此被拒；`repo-list` 里对应的行标 `disabled: 'uncertified'`（行与门同源，见下）。
- 判定其余部分不变：向外选择器、`../` 形态、realpath 与集合成员精确相等、非 `.git`、拒绝绝对路径；另外拒绝带 `:` 的选择器——`C:..\..\x` 是盘符相对路径，`isAbsolute` 抓不到而 `resolve` 会把它重定基到进程当前盘，真实路径与选择器指的不是同一个目录。
- **缓存存身份而非路径**：条目是 `{root, gitdir, primary}` 加上 `commonDir`，每次命中重新校验一遍（一次 `stat` + 一次 `readFile`，不起进程），所以「同一路径在 15 秒窗口内被换成另一个仓库」会被当场丢弃并重扫，而不是因为字符串相同就放行。TTL 15 秒（`WORKTREE_CERT_CACHE_MS`），条目上限 32 个 cwd（`WORKTREE_CERT_CACHE_MAX`，超出整表清空，与 `.code-workspace` 扫描缓存一致）。
- **失败不缓存**：`git worktree list` 被取消/超时与「仓库没有 worktree」必须区分——前者返回 `null`、不写缓存、也不写负缓存。一次被打断的请求（切仓库、关面板）不该让这一类行在整个窗口内都点不动。
- **未命中重读一次**：集合拒绝某选择器时，先丢掉缓存按新记录再算一次，仍拒绝才报 `invalid-repo` 并写 15 秒负缓存。否则 `git worktree add` 之后的第一次点击会撞上「行已经出现、门还拿着旧集合」。
- 认证集合上限 64 条（`WORKTREE_CERT_MAX`），bare 记录、目录已不存在的记录不进入集合；**列表的行也按同一集合决定可选性**（`worktreeCheckouts` 接收该集合），所以第 65 条及之后的行显示为 `uncertified` 而不是「可选但点了报错」。
- `worktrees.ts` 只对**没有相对选择器**的 checkout 保留 `disabled: 'outside'`：Windows 上跨盘符的 worktree 在 `relative` 之后仍是绝对路径，三道门都会拒绝，行留下并说明原因。

### 3. 外部根保持扁平

由工作区文件引入的仓库各占一行，**不**展开它自己的 worktree。ADR-0030 原先写的「外部仓库的 worktree 家族在选中该仓库之后才可见」与实现不符，也不再实施：`repo-list` 是 cwd 作用域的，展开所有外部根的家族会是每个外部根一次 `git worktree list`（上限 20 个根、30 秒一次轮询），而需要它的用户已经把要用的根写进了 `folders[]`。ADR-0030 的相应段落已按此修正。

## Consequences

- 正面：issue #125 的两条诉求（可发现、有控件）都在默认 `off` 下满足；用户从「知道配置键」变成「点一下」。cwd 外的工作树不再出现在列表里却不可选，行与门的判据只剩一条：`realpath ∈ cwd ∪ 已验证归属的 checkout 集合 ∪ 工作区文件的 allow-list`，且这个集合同时决定行的可选性。
- 代价：`off` 时只要 cwd 里有工作区文件就会显示一行提示，用户即使是有意关闭也会看到它——提示不可关闭，这是有意的（它就是本 ADR 要修的那个沉默）。若要更强的「别再提示我」，需要一个新的显式状态，本期不做。
- 行为变更：已有用户（`detectCheckouts` 默认开）会突然多出若干**可选**的 cwd 外 worktree 行。这是 ADR 之内的放宽，但对外是可见变化，发布说明必须写明。
- 写入面随之扩大：选中 cwd 外 worktree 后，文件编辑落在那里。编辑边界（白名单后缀、2 MiB、UTF-8 往返、`baseSha256` 比对、原子替换）不变，只有「选中的根」变了。
- 一次拒绝会触发重读，因此刚 `git worktree add` 出来的 checkout 在第一次点击时就能用；代价是一次被拒的选择器可能多跑一次 `git worktree list`（负缓存随后封住 15 秒）。
- 身份校验让「换掉同一路径」立即失效，但也意味着指向上层的合法记录（例如移动过目录的 worktree）在 `git worktree prune` 之前会被判为 `stale` 而不是可进入——这是 `git` 自己的判定，插件不替它猜。
- `disabled` 因此有三种：`outside`（跨盘符，没有相对选择器）、`uncertified`（本仓库不拥有，或超出认证上限）、`stale`（目录已不在）。
- 提示行在「存储库」块之外（折叠区外）渲染：块默认是收起的，把提示放进折叠体等于把可发现性又藏回去。
- `codeWorkspace` 仍是插件级设置；会话级差异只来自各自的 cwd。以后若要按会话记忆「已拒绝的提示」，必须另立状态并写 ADR。
