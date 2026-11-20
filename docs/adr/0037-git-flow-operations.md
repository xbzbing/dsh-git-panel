# ADR-0037：Git Flow 按分支名约定执行，写操作复用 run 端点

- 状态：Accepted（2026-11-17；2026-11-18 修订：release 与 hotfix 一样先合入主分支、打标签，再合并回 `develop`；2026-11-19 修订：start 默认推送新分支，finish feature 可链式开始 release、默认推送该 release，finish 一律先弹步骤确认，开始与完成在途时显示加载遮罩；2026-11-20 补充产品、交互、技术文档和当前实现差异）
- 相关：`src/host/flow-ops.ts`、`src/host/types.ts`（`flow-*` action、`capabilities.flow`、`flow-partial`）、`src/host/index.ts`（run 端点分流）、`src/client/flow.ts`、`src/client/flow-dialogs.tsx`、`src/client/OverviewTab.tsx`、ADR-0005、ADR-0006、ADR-0007

## Context

Git Flow 是分支名约定，不是一段可移植的 git 配置：`develop` 与 `main` / `master` 是长期分支，`feature/*`、`hotfix/*`、`release/*` 是短分支。面板已经按约定渲染了菜单与对话框（`flow.ts` 的纯决策），但“完成”此前只在对话框里提示“尚未接入”。

实现时常面对的约束：

- **不做 `git flow` CLI 依赖**：它要求 extra config（`gitflow.*`）与已安装的脚本；面板只读仓库里已有的分支名，行为要对同一仓库的终端用户可解释。
- **一次 finish 是多步写操作**：切分支 → 合并 / squash / rebase → 打标签 → 合并回 `develop` → 删远端 / 删本地 → 推送。`GitAction` 的 `planAction` 只表达“一条 argv 序列”，无法表达“先探测再决定、失败后回滚”。
- **不能给共享工作区留下中间状态**：同一个 checkout 可能被 dsh AI 或终端同时使用；冲突必须立刻中止，而不是把仓库留在 merge / rebase 中间态。
- **安全不变量必须延续**：argv 数组、名字先校验、push 不 force、`-D` 需明确勾选、cwd 锁仓库根。
- **旧 host 兼容**：新 client 不能向没有这些 action 的 host 发送 `flow-*`。

## Decision

### 1. 复用 `run` 端点，在 endpoint 内分流到 flow runner

不新增 RPC 端点：`GitAction` 增加 `flow-start` / `flow-finish` / `flow-integrate` 三个成员，`GitPanelService.run` 在 `isFlowAction(request.action)` 时调用 `runFlowAction`，否则仍走 `runAction`。这样 client 继续用同一个 `onAction`（成功回灌快照、失败本地化错误、面板自动刷新），不需要第二套写操作外壳。

`planAction` 对这三个成员直接返回错误：它们是“必须由 flow runner 执行的 action”，不能被别的调用方规划成一条裸 argv。

快照新增 `capabilities.flow`；client 只在为 true 时渲染分支列表的 `Git Flow` 按钮与行菜单项，旧 host 保持原样（不发送它没有的 action）。

### 2. start：feature 的首次启动顺带创建 develop

`flow-start` 校验 `flow` 与 `branch` 前缀一致（host 不信任这两个字段中的任何一个）、base 是已有本地分支、目标分支尚不存在。feature 且仓库没有 `develop` 时，先 `git branch develop <base>`，再从 `develop` 切出 `feature/*`；checkout 失败则删掉刚创建的 `develop`，不让失败的请求在仓库里留下改动。其余 flow 直接从 base 切出。最后 `git checkout -b <branch> <base> --` 切换到新分支。

`flow-start` 还带一个可选的 `pushRemote`：对话框默认勾选（仓库没有配置远端时禁用），host 在写之前确认该 remote 存在，checkout 后用 `git push -u <remote> refs/heads/<branch>:refs/heads/<branch>` 发布新分支并设置上游。push 失败时尝试删除本地新分支（以及本次创建的 `develop`）并回到发起前的 HEAD，再报告原始 push 错误。网络响应不确定时远端可能已经创建 branch，不能把本地回滚描述成远端完整回滚，应返回 partial 或 unknown 状态。

### 3. finish：先要求干净工作区，冲突只回滚第一次集成

finish 的本地前置条件在第一次写之前判定：flow / 分支前缀一致、target 存在且符合约定（feature 落到 `develop`，release 与 hotfix 落到解析出的主分支 `main` / `master` / 远端 HEAD）、`develop` 存在（release / hotfix 要合并回来）、标签未占用、上游（如需删远端）已解析、push 目标 remote 在 `git remote` 里、工作区干净（`status --porcelain` 为空，含未跟踪）。远端 tracking ref 可能过期，检查后也可能发生并发变化，因此远端 push 和删除还需要真实 OID 与 lease/CAS 保护。

- 当前不在该 flow 分支时先切过去；finish 的语义是“完成这个分支”，行菜单可以从别的 checkout 发起。
- 集成方式：`merge` = `git merge --no-ff -m <message>`；`squash` = `git merge --squash` + `git commit -m <message>`；`rebase` = 在 flow 分支 `git rebase <target>`，再切到 target `git merge --ff-only`。
- 第一次集成失败（冲突 / 空提交 / checkout 被拒）：`merge --abort` 或 `rebase --abort`，必要时把 target `reset --hard` 回捕获的 tip，再切回发起时的分支并核对 HEAD 仍是捕获的 SHA；核不上就报 `merge-stuck`。冲突报 `merge-conflict`。
- 第一次集成之后仍有步骤：release / hotfix 在主分支的合并提交上打标签，再把主分支 `--no-ff` 合并回 `develop`（release 因此 `develop` 也包含标签提交），结束时检出 `develop`；目标设计应先同步长期 branch 和 tag，再按 expected OID 删除远端、删除本地 branch，最后处理链式 release。当前实现仍是先删远端、删本地再推送，且 finish push 未包含本次 tag。这些步骤失败返回 `flow-partial`，因为此时 target 分支已经前进，“什么都没发生”是假话。客户端把失败步骤（git 原文）放进本地化提示里。
- 标签为 annotated tag（`git tag -a -m "<flow> <tag>"`），指向主分支上的合并提交；打标签在 tag 未占用时才会进入序列（前置检查）。完成对话框同时显示 `目标分支`（主分支）与 `合并回`（`develop`），推送选项覆盖两者且默认勾选；远端缺少某个长期分支并不禁用该选项，推送会创建它，预览把该远端分支标为新增。取消勾选则只做本地完成。
- 完成 feature 时可以链式开始 release：对话框新增一个默认不勾选的选项，勾选后显示 release 名称，默认值由 `nextFlowVersion('release', tags)` 从标签推出（与单独开始 release 同一规则），并同样做前缀 / 安全名 / 本地占用校验。host 在第一次写之前确认该 `release/…` 分支不存在；feature 合入 `develop`、清理旧分支后，用 `git checkout -b <release> develop --` 从更新后的 `develop` 切出新 release 并检出。链式 release 分支有自己独立的推送选项，默认勾选（与单独开始 release 一致；没有配置远端时禁用），勾选后用 `git push -u <releasePushRemote> refs/heads/<release>:refs/heads/<release>` 发布并设置上游；finish 的 `pushRemote` 仍只推送本次移动的长期分支，不包含新 release，`releasePushRemote` 也只允许与 `startRelease` 同时出现。失败与其余 finish 后置步骤一样报 `flow-partial`。该选项只对 feature 生效，release / hotfix 携带时在写之前以 `invalid-name` 拒绝。
- 完成是多步且不可整体撤销的序列（移动长期分支、打标签、删除、推送），因此点击「完成」只打开一次步骤确认：确认正文重述本次将执行的集成方式、标签、合并回、删除本地 / 远端分支、推送与链式 release，确认按钮才真正提交。确认层同时承担原「远端删除二次确认」的职责：勾选删除远端时，确认框额外显示服务器删除警告与必须勾选的确认项。确认框在写入期间显示加载遮罩并锁定 Escape / backdrop，失败时错误留在确认框里；关闭确认只回到完成表单并保留填写内容。开始对话框没有破坏性步骤，不额外确认，但写入期间同样显示加载遮罩。

### 4. 清理动作沿用既有安全策略

- 删远端分支：解析该分支的**上游**（`%(upstream)` + 配置的 remote 名，最长前缀匹配，与 `branch-delete-remote` 同一规则），删除目标固定为 `refs/heads/<upstream-branch>`；没有上游时 host 拒绝（`upstream-missing`）。完成对话框在有上游时默认勾选（预览同时画出远端删除，取消勾选即保留），没有上游时该项禁用并说明原因。勾选时点击「完成」不会直接提交，而是在步骤确认里增加「删除远端分支」一行、服务器删除不可撤销的警告与必须勾选的确认项；确认项的勾选是按钮唯一解锁方式，关闭确认（Escape / 取消）只回到完成表单并保留已填内容。这与行菜单 `RemoteBranchDeleteConfirm` 的「ack 是唯一解锁方式」是同一契约，因此「删除远端分支必须勾选确认」的不变量在 Git Flow 路径上仍然成立；默认值可以保持勾选，因为它只是意图，不是授权。
- 删本地分支：默认 `git branch -d`。squash 集成后分支不在 target 的祖先链上，`-d` 必然失败，因此目标行为是 `-D` 只在该策略被选中**且**对话框里额外勾选强制删除后才会发送。当前 host 仍需补充 wire action 校验，拒绝 merge / rebase 携带 `forceDelete: true`。
- 推送：目标行为是一次推送本次移动的长期分支和 release / hotfix 的本次 tag（feature 只有 `develop`，release / hotfix 是主分支、`develop` 与 tag），从不 force；远端缺少的分支由这次推送创建，预览将其标为新增。remote 名必须出现在 `git remote` 里。当前实现的 refspec 仍未包含 tag。链式 release 的推送是另一条命令（`git push -u`），默认勾选，取消勾选即只在本地创建。
- `flow-integrate`（整合开发）只允许在 `feature/*` 上，`git merge develop` 冲突时 `merge --abort`，与 `branch-merge` 同一契约。

### 5. 主分支解析

目标设计要求 hotfix 与 release 的主线由 host 统一解析，并将结果提供给 client：`main` → `master` → remote default branch → 配置化主线。当前 host 的 `mainlineCandidates()` 只读取 `refs/remotes/origin/HEAD`，client 还支持 snapshot 的 `defaultBranch`，自定义 remote 或自定义主线时可能出现 UI 可选但 host 拒绝的差异。

## Consequences

- 正面：Git Flow 的入口、菜单与对话框现在真的执行；成功后面板复用 `onAction` 的快照刷新，无需额外 RPC 或轮询。失败在写之前拒绝，冲突回滚到发起 checkout。
- 正面：`flow` 能力位让新旧 host / client 可以混跑：旧 host 不显示入口，新 host 对未知 action 不会收到请求。
- 代价：finish 要求干净工作区（比 `branch-merge` 严格）。这是有意的：多步序列里只要出现未提交变更，回滚就无法精确到“发起时的样子”。
- 代价：release / hotfix 的部分失败会留下“target 已前进、后续步骤未完成”的状态，`flow-partial` 只能如实报告并要求用户刷新检查；当前远端删除顺序、远端 OID 竞态和网络未知结果仍可能让远端恢复点不可用，不能把该流程描述成原子或完整可回滚。
- 代价：squash 的本地删除需要二次勾选；如果用户不勾选，分支会被保留（可手动删除或再 finish 一次，第二次会因 `nothing-to-commit` 失败）。
- 目标行为是 release / hotfix 标签一律 annotated，消息为 `<flow> <tag>`（`release v1.2.0` / `hotfix v1.2.1`）；当前 host 仍允许空 tag，且需要补充 tag push。需要自定义消息时仍可在终端操作，面板不提供。
- 删远端不再隐含 fetch：按钮文案已改为“删除远端分支”，与实际命令一致；网络错误照旧分类为 `auth-failed` / `push-rejected`。
- 该实现只覆盖 feature / hotfix / release；`bugfix/*` 与 `support/*` 仍是约定外的分支，菜单不提供入口。
