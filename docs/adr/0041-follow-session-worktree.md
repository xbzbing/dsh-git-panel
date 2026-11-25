# ADR-0041：跟随会话的实时工作目录，只在同一仓库的检出之间切换

- 状态：Accepted（2026-11-26）
- 相关：PR #100（已回退）、ADR-0035、ADR-0038、`src/client/follow-checkout.ts`、`src/client/Panel.tsx`、`src/client/repo-select.ts`、`src/host/core.ts`、`src/host/index.ts`

## Context

平台会把会话的实时工作目录投影成 `workingDirectory`，`enter_worktree` / `exit_worktree` 会原地改写它；而会话的 `header.cwd` 是创建时的元数据，永远不变。Git 面板此前只认 `header.cwd`：用户进入本仓库的 worktree 后，面板仍停在主检出，必须去仓库列表手动点一次。

PR #100 曾经让面板跟随 `working_directory`，随后被回退。回退的理由不是「不该跟随」，而是那次跟随没有边界：它把「会话搬到了另一个目录」直接等同于「Git 上下文换一个根」，会把面板带进无关的嵌套仓库或 `.code-workspace` 认证的外部根，等于悄悄推翻了 ADR-0030 / ADR-0035 的「一个请求一个根、外部根只在选中后生效」。另外，自动选择如果写进标签页的 pick 记录，会变成用户从未做过的意图（ADR-0038）。

这次只解决一个具体场景：会话在本仓库自己的检出之间移动（主工作树 ↔ `.agents/worktrees/<branch>` 等 `git worktree` 检出），面板跟着走，其它目录变化一律不跟。

## Decision

1. **客户端跟随，host 不改 RPC 行为**。面板从槽位拿到平台的 `useProjection`，读 `workingDirectory`；宿主不提供这个 prop 时按「不跟随」处理，保持原来的手动切换。新增的 host 侧只有配置：`followSessionCheckout` 默认 `true`、`.volatile()`，随快照下发；旧 host 的快照没有该字段时客户端按关闭处理。
2. **只跟随本仓库的检出**。目录先按「最长根」归属到唯一一行，再由这一行决定能不能跟：工作区行（`path: ''`）直接可信（它的根就是会话自己的检出，会话本身在 linked worktree 里时也由它承载），其余行必须是 `role: 'main' | 'linked'`。`disabled`（cwd 外未认证、stale）和 `role: 'repo'`（扫描到的嵌套仓库、`.code-workspace` 外部根）一律返回「不跟」，且**不回退到祖先行**——宁可不动，也不把面板带到一个不是会话当前所在的检出。
3. **进入和退出都跟；手动选择优先到下一次目录变化**。自动切换走 `followRepo`：只改内存里的选择，不写 `sessionStorage`、不记 `rootPick`，因为它不是用户的意图。自动切换后用户手动点的那一行仍然通过 `selectRepo` 持久化，并保持到下一次 `workingDirectory` 变化；页面刷新后会按当前目录重新跟随。开关从关闭切到开启时，对当前目录立即跟随一次，不等下一次目录变化。
4. **列表里还没有这一行时，只重取一次**。新建的 worktree 是主检出下的一个新目录，上一次扫描不可能知道它；如果直接按包含关系跟随，只会得到主检出（错误）。所以「目录落在某个可信行之下、但不是任何行的根」时先触发一次 `repo-list`，重取后再判定：新行出现就跟过去；仍然没有，则按最具体的覆盖行跟随（会话创建工作区子目录的常见情况），但 worktree 探测失败时按「列表不完整」处理，不跟随父行。
5. **路径比较按宿主机形状归一化**：反斜杠转正斜杠、去尾部隔符；Windows 盘符 / UNC 路径大小写不敏感，POSIX 区分大小写。不做 realpath 解析——客户端拿不到 realpath，词法路径与 host 的 realpath 不一致时降级为不跟随，而不是猜一个根。
6. **跟随不改变当前页签**，切换沿用既有的「旧样本保留 + 变暗 + switching 标记」；已缓存的样本直接切换，不闪。

## Consequences

- 平台 `enter_worktree` / `exit_worktree` 之后无需手动点仓库列表；`.agents/worktrees` 池、外部创建但经认证的 worktree 都覆盖。外部根、无关嵌套仓库和任意的 `working_directory` 改动仍然需要手动选择，ADR-0030 / ADR-0035 的边界不变。
- 自动选择不写标签页记录：刷新、热重载不会把自动结果当成用户偏好；用户手动选择后照常持久化。
- 目录不是任何行的根（例如会话创建工作区子目录、或列表缺行）时会多发一次 `repo-list`；这是为「新 worktree 不在旧列表里」付出的固定代价，每次目录变化最多一次。列表探测失败时不跟随父行，可能让用户在探测恢复前停留在原处。
- 词法路径与 realpath 不一致（符号链接工作区）时跟随会静默失效；这是已知降级，平台若改为下发规范化路径应重新评估匹配。
- 旧 host 缺少投影 prop 或快照字段时完全退回手动切换，不报错、不写配置。
- 与 PR #100 的区别：这次只跟随「本仓库自己的检出」，且只由投影驱动；不把 `working_directory` 当作 Git 根的通用来源，也不改变「一个请求一个根」。
