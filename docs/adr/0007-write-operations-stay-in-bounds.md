# ADR-0007：写操作不越权：push / pull / publish / 检出

- 状态：Accepted（2026-10-18，迁移自现有实现；2026-10-19 补充 publish 的可用条件与双入口，issue #63；2026-11-04 变更页入口收敛为工具栏上传图标；2026-11-09 增加 set-upstream，多远端时由用户选择）
- 相关：`src/client/push-policy.ts`、`src/host/actions.ts`、`src/client/overview-statusbar.tsx`、`src/client/ChangesToolbar.tsx`、`src/client/PublishModal.tsx`

## Context

面板能对远程仓库动手，而这些操作**不可逆或难以回滚**：`push --force` 会覆盖别人的提交，`pull` 的默认合并会产生意料之外的 merge commit，直接检出远程引用会留下游离 HEAD 让用户以为「我的分支没了」。

这些是 git 本身提供的灵活性，不是 bug；问题在于 GUI 上的一次误点就能触发。用户预期面板是「安全的日常操作入口」，危险动作应该留在终端里。

## Decision

- **push 绝不 `--force`**，且只在当前分支**严格领先**（ahead > 0 且 behind = 0）时提供；分叉（ahead > 0 且 behind > 0）时 push 与 pull 都不提供，UI 不给「赌一把」的入口。
- **pull 只走 `--ff-only`**：本地与远程分叉时直接拒绝，绝不产生 merge commit 或 rebase。
- **绝不直接检出远程引用**：`branch-checkout` 带 `createFrom`（如 `origin/x`）时落为同名本地分支并设置跟踪（`git checkout -b x --track origin/x`），避免游离 HEAD。
- **publish 的 `HEAD`、pull-preview 的 `@{upstream}` 是固定字面量**，不接受来自 RPC 的拼接；remote 名来自 client 已持有的 primary remote，host 侧再校验一次。
- 这些策略在 client 与 host 两侧都有实现：`push-policy.ts` 的 `pushIntent`（`canPush` / `canPublish` 二选一，绝不并存）决定每个上传按钮的意图与可用性，被总览状态栏与变更页工具栏共用；host 侧不依赖 UI 的自律——请求不合规时照样拒绝。
- **publish 的可用条件**（issue #63）：当前分支**只存在于本地**（无上游、HEAD 在分支上、至少有一个提交、存在远程）即提供 publish——在远程创建同名分支不可能覆盖任何东西，无需领先/落后对账；两个入口——总览状态栏按钮、变更页工具栏的上传图标——共用同一个 `PublishModal` 二次确认。游离 HEAD 或尚无提交时 git 无法从 `HEAD` 推出远程目标名，host 以 `no-branch` 拒绝而不是把 git 的 refspec 提示漏给用户；`canPublish` 也让这两个状态在 UI 上根本不出现该入口。
- **set-upstream 的可用条件**（2026-11-09）：当前分支无上游，但**至少一个远端已有同名分支且指向 HEAD** 时，上传控件改为「设置上游」——此时 publish 只会做一次 no-op push，真正缺的只是本地跟踪配置。客户端把该动作对应的远端候选（`remoteCandidates`，按 `git remote -v` 顺序）列成单选对话框，**即使只有一个候选也弹框**，默认勾选 origin（不在候选中则选第一个），用户确认后才执行 `git branch --set-upstream-to=refs/remotes/<remote>/<name>`：不 push、不联网，只写 `.git/config`。host 在写配置前重新探测：已有上游则 `has-upstream` 拒绝（不覆盖别处刚设好的配置），所选远端未配置或同名远端分支消失则 `upstream-missing` 拒绝（客户端快照已过期）。`pushIntent` 因此是三态且互斥：push（严格领先）、set-upstream（无上游且至少一个远端同名分支在 HEAD）、publish（无上游且没有任何远端有该分支）。旧 host 只返回 `remoteBranchAtHead` 时，客户端降级为该主远端单候选。
- 破坏性本地操作（discard、reset、stash-drop、删除标签、带贮藏的分支切换）必须二次确认；硬重置还要列出将丢失的改动并额外勾选。

## Consequences

- 面板永远不会「吃掉」远程历史，也不需要用户理解 force-push 的语义。
- set-upstream 是面板新增的一处 git 配置写入（加上既有的 `--track` 检出，二者都只写分支的 tracking 配置），且只在用户点击时发生；README 的「不改动 git 配置」表述必须随这两个例外一起更新。
- 代价：分叉状态下面板帮不上忙，用户必须去终端——这是刻意的，分叉意味着需要人来判断。
- 二次确认增加了日常操作的点击成本；「放弃更改」只作用于工作区侧，暂存侧的改动必须先取消暂存，避免一次点击同时丢两边。
- 任何「顺手放开一点」的改动（例如为了便利加上 force、或让 pull 允许合并）都违反本 ADR，需要新写一份 ADR 说明理由。
