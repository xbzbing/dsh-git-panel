# ADR-0036：分叉状态的合并式同步

- 状态：Accepted（2026-11-19）
- 相关：issue #141、ADR-0007、`src/client/push-policy.ts`、`src/client/sync-flow.ts`、`src/client/overview-statusbar.tsx`、`src/client/ChangesToolbar.tsx`、`src/host/actions.ts`

## Context

ADR-0007 刻意让分叉（ahead > 0 且 behind > 0）没有上传入口：普通 push 会被远程拒绝，`pull --ff-only` 也会拒绝，面板不给「赌一把」的按钮。代价写在当时：用户必须去终端。

issue #141 证明这个代价过高：界面只显示 `↓2 ↑2`，刷新按钮只做 fetch，用户只能展开「远程 → origin」、右键远程分支「合并到当前分支」，合并完再推送。这条绕道用的就是已有的 `branch-merge`，说明底层能力（合并、冲突 `git merge --abort`、`merge-conflict` / `merge-stuck` 上报）早就存在，缺的是策略与入口。

issue 同时提出了三种诉求：分叉时给 pull / push 按钮、pull 可选 merge / rebase、以及提供「强制推送（带租约）」的二次确认。前两个需要拆开判断，第三个必须拒绝：

- `push --force-with-lease` 只断言「remote-tracking ref 和我上次 fetch 的一致」。同步流程本来就要 fetch，fetch 完 lease 必然通过，照样覆盖别人刚推的提交；它防的是「没看见」，不是「决定丢弃」。远端 reflog 未必可及，面板也没有撤销入口。
- 把 rebase 做成设置里的默认值会让以后每次同步都静默改写本地提交，且逐提交冲突、签名失效；「未推到这个 upstream」不等于「没共享给别人」。

## Decision

**新增独立的 `pull-merge` 动作，只做加法；普通 push 保持原样。** 分叉时 UI 只给一个「同步」入口：host 执行 `fetch` + `merge` 上游，客户端随后调用现有 `push`。

- **host 解析一切引用。** `pull-merge` 在 host 侧用 `symbolic-ref` 取当前分支、用 `rev-parse --symbolic-full-name @{upstream}` 取上游完整 ref（`@{upstream}` 是固定字面量，ADR-0007）；RPC 不携带任何 ref、remote 或路径。
- **先拒绝外来操作。** 进入前探测 `MERGE_HEAD` / `CHERRY_PICK_HEAD` / `REVERT_HEAD` 与 `.git/rebase-merge` / `rebase-apply`；命中即 `operation-in-progress`，不启动任何命令。这样「本次 merge 之后出现的 `MERGE_HEAD`」必定属于本次操作，`git merge --abort` 不会误伤别人。
- **只 fetch 上游所属的 remote**（`git fetch --prune <remote>`），remote 名按配置列表最长前缀解析；上游是本地分支（`branch.<name>.remote = .`）时跳过 fetch。不走 `git pull`，避免 `pull.rebase` / `pull.ff` / autostash 让行为随用户配置漂移。
- **合并命令固定为** `git merge --ff --no-edit --no-autostash --end-of-options <完整 ref>`：只产生一个合并提交，不改写双方历史；`--ff` 显式覆盖用户配置的 `merge.ff=only`（分叉时那会让合并直接失败），同时保留 behind-only 时的快进行为；`--no-autostash` 让脏工作区走 git 自己的拒绝（`local-changes-block`），不引入面板没有 UI 的 stash-pop 冲突路径。
- **冲突立即 abort，但只 abort 自己的 merge。** abort 前校验 `HEAD` 仍等于操作前的 HEAD、`MERGE_HEAD` 等于本次解析出的 upstream tip；预检之后、merge 之前隔着一次网络 fetch，别的 actor 可能在这段窗口里留下自己的冲突现场。归属不成立时保持现场不动并报 `operation-in-progress`；`index-busy` 也绝不 abort。成功报 `merge-conflict`，abort 失败报 `merge-stuck`。取消/超时同样先做归属校验与清理（清理不使用已取消的 signal），避免被杀的 merge 留下 `MERGE_HEAD` 让后续同步全部被预检挡住。
- **push 只在合并后严格领先时发。** 客户端用合并回复里的新快照判断 `ahead > 0 && behind === 0`，再走现有 `push`（永不 force）。远程在此期间前进时，普通 push 被非快进拒绝，不覆盖任何提交；本地合并结果保留，可重试。push 半段失败是一类独立结局：合并已落地、`behind` 已为 0，再点同步只会重复合并，因此确认框关闭并改用专用文案（提示可能是线性历史限制，指引终端 rebase），不留下一个点了没反应的确认按钮。
- **两段式上报，不用一个 action 包办。** `GitActionResult` 的失败态不带快照；如果 host 在 merge 后直接 push，push 失败时状态栏会拿着合并前的 `2/2` 显示错误。拆开后，第一段成功返回合并后的计数（如 `↑3`），第二段失败就是一个正常的推送失败。
- **能力门控。** snapshot 增加 `capabilities.syncMerge`；没有该位的旧 host 不显示同步入口，避免升级窗口期发送未知 action。`pushIntent` 仍是一个来源、四态互斥：`sync`（分叉且有 host 支持）→ `push` → `set-upstream` → `publish`。
- **确认一次，且绑定打开时的 checkout。** 状态栏与变更页工具栏共用同一个 `SyncConfirmModal`；它捕获打开时的 `[root, branch, head]`，任一变化就丢弃确认（不重定向到新分支），正文写明分支名、领先 / 落后数量、会创建合并提交并推送。
- **明确没有放宽的边界：**
  - `pull-ff` 仍然是 `git pull --ff-only`，分叉时拒绝，语义不变；
  - 任何形式的 force（含 `--force-with-lease`、`--force-if-includes`）仍然不提供；
  - rebase 不是默认值，也不在本次范围内；需要线性历史时仍去终端；
  - publish / set-upstream 的条件与动作不变；
  - `↑2` / `↓2` 数字仍不是按钮（整行点击已用于筛选，再叠两个意图会让命中区和键盘操作歧义）。

## Consequences

- **历史里会出现合并提交。** 这是本次的明确取舍：换取了「不改写任何一方历史」的安全性。不喜欢 merge commit、或远程开启 Require linear history 的仓库会在 push 阶段被拒（`push-rejected`），只能去终端 rebase；错误文案应说明这一点，不能顺势提供 force。
- **冲突仍然解决不了。** 面板没有冲突 UI，同步会 abort 回原状。用户仍需终端处理冲突，但至少不再「完全没入口」，且状态是明确恢复过的。
- **非原子。** fetch / merge / push 三步之间远程可能变化，靠远程自身的非快进拒绝兜底；本地不会丢提交。
- **升级窗口。** 新 client + 旧 host 时 `capabilities.syncMerge` 缺失，入口不出现；旧 client + 新 host 保持原来的分叉无入口行为。
- **UI 宽度预算要重测。** 分叉状态此前没有动作按钮，sync 填入的是空槽；但 200px 档已贴着预算，状态栏沿用与 pull/push 相同的动作按钮（宽档带文字，`data-dense` 起只留图标），130 / 200 两档都要按 `test/e2e/statusbar-compact.mjs` 的口径验证 `scrollWidth <= clientWidth`。
- **文案与测试。** 八份 locale 增加 `status.sync*`、`sync.*`（含 push 半段失败文案）、`error.noUpstream`、`error.operationInProgress`；`push-policy` / `actions` / `host-integration` 单测与两个 e2e runner 增加分叉同步用例（含成功链路、确认框作用域、130 / 200 两档宽度）。
- **git 版本。** `--end-of-options`（2.24）、`--no-autostash`（2.27）之外，既有 `--diff-merges=first-parent` 已要求 2.31；新命令不提高实际下限。
- **重新评估的条件：** 如果合并提交在真实使用中造成明显噪音，或大量仓库因线性历史被拒，再单独写 ADR 讨论「显式 rebase 模式」；不要把它偷偷变成默认值。
