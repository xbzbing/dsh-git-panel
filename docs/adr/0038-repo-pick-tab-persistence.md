# ADR-0038：仓库选择按标签页持久化，只在确定的否决时删除

- 状态：Accepted（2026-11-24）
- 相关：ADR-0009、ADR-0030、ADR-0035、`src/client/pick-store.ts`、`src/client/repo-select.ts`、`src/client/repo-list.ts`（`listVerdict` / `sampleVerdict`）、`src/client/Panel.tsx`、`src/host/core.ts`（`resolveWorkspace` / `listSessionRepos`）、`test/e2e/repo-pick-persist.mjs`

## Context

仓库选择和文件浏览根的选择都放在 `repo-select.ts` 的模块级 `Map` / `Set` 里。平台的 HMR 在安装或卸载**任意**插件时会在页面内重新执行本插件的 bundle，模块状态随之清空，面板回到会话工作目录所在的仓库（多仓库布局下通常是主检出）。刷新页面同样如此。

此外，选择会经两条修复路径被清掉，但这两条路径都分不清「检出确实没了」和「这一次没答上来」：

- `repo-list` 里缺了对应的行。worktree 探测（`git worktree list`）出任何错误时都返回空行集，行就跟着消失；列表上限截掉的子仓库也会表现为缺行。
- 快照返回 `invalid-repo`。host 在 git 读不出 worktree 记录时已经不写负缓存，但仍返回同一个 `invalid-repo`。

HMR 往往发生在 host 正在 reconcile、负载偏高的时候，所以只做客户端持久化不够：刚恢复的选择会被一次超时的探测立刻清掉。

备选方案：

- **localStorage**：新标签页、重开浏览器也能恢复，但会把几天前的选择带进一个新标签页。用户以为面板在主检出上，提交、推送、丢弃却落进某个 worktree，而面板上没有任何提示。这样还得补 TTL，并处理多个标签页之间的覆盖。
- **host 侧按会话持久化**：可以跨浏览器，但要新增写端点，而且这个状态只关系到页面展示。等真有跨设备需求再考虑。
- **挂在 `globalThis` 上**：能扛住 HMR，扛不住刷新。
- **连续两次否决才删除**：是对「答复含糊」的补救。host 能把两种情况分开报之后，这个计数就没必要了，而且计数本身也会随 HMR 丢失。

## Decision

**记录写在 `sessionStorage`，只记意图，事实以 host 为准。**

- 单键 `${NS}.picks`，值为 `{ v: 1, sessions: { [sessionId]: { repo?, rootPick?, files?, follow?, at } } }`。版本不符或格式不对就当作没有记录；最多保留 50 个会话，按 `at` 淘汰最旧的；读写抛错时退回纯内存。`at` 只在记录内容变化时更新，修复和配置翻转这类批量改写保留原值，所以淘汰顺序跟的是用户最近一次选择。
- 存的是选择器（cwd 相对 POSIX 路径，外部根和 cwd 外的 worktree 带 `../`），不存 root。每次请求仍经 host 的三道门按 realpath 判定，存储里的值从不当作事实使用。会话 cwd 固定取 `header.cwd`，同一个 sessionId 下选择器指向的位置不变，所以不另做 root 校验。
- 记录只经 `repo-select.ts` 读写，存储层是它独占的 `pick-store.ts`；组件不碰 `sessionStorage`。每个会话在本次模块加载后第一次被读取时，从记录装入一次；之后的修复只改内存，不会被再次装入覆盖。`GitController` 新建时读的就是 `selectedRepo`，恢复后的首帧直接带上原来的仓库标签。
- `selectRepo`、`pickFilesRoot`、`resumeFilesRootFollow` 是用户的显式选择，会写回记录，并且每次写都先重读记录再合并。`rootPick`（明确选回工作区仓库）也要记，否则重载后 files-only 模式的自动选择会替用户挑第一个子仓库。反向同理：面板为 files-only 会话自动挑的第一个子仓库只是便利（`persist: false`），不写记录——否则一次没人做过的选择会被记成意图，之后的加载不再重新挑选。文件浏览根同时记下当时的 follow 配置；恢复后第一份快照的配置值与之不同，就丢弃这部分，与配置切换会清掉所有覆盖的语义一致。选择时还没有任何快照（files-only 会话拿不到 ready 样本）的记录先不带 follow，由本次模块加载看到的第一份快照补上；在那之前它不受配置翻转约束。
- 文件浏览根的变化（选择、修复、配置翻转）和仓库选择一样经 `subscribeRepoSelection` 广播，同一会话的两个挂载点（会话页签和侧栏）同时重渲染，不依赖调用方自己刷新。
- 面板的仓库列表记着它属于哪个会话。同一个面板实例切换会话时，修复和 files-only 自动选库都要等新会话自己的列表到达，不会拿上一个会话的列表去判定新会话恢复出来的选择。

**修复分三档：保留、只清内存（`drop`）、连同记录一起删除（`forget`）。**

| 依据 | 判定 |
| --- | --- |
| 快照 `invalid-repo`，不带 `unverified`（包括 cwd 不属于任何仓库、第三道门无记录可读的情况） | forget |
| 快照 `invalid-repo` 带 `unverified`，或 `git-unavailable` | drop |
| 快照其他失败（超时、取消、传输） | 保留 |
| `repo-list` 的 `worktrees: 'failed'` | 保留，不做任何修剪 |
| 行存在且可选 | 保留 |
| 行带 `disabled: 'stale'` | forget（见下文关于这一判定的前提） |
| 缺行，或带其他 `disabled` | drop（缺行也可能是被列表上限截掉的，交给快照判定） |

**host 新增两个可选字段，用来把含糊的答复报出来。**

- `invalid-repo.unverified?: true`：只在「本来可能放行这个选择器的门没答上来」时带上，且不写负缓存。判定集中在 host 的 `refusalKind`，按顺序问：
  1. 选择器解析不到目录，或解析回 cwd 之内（`repoDirFor` 已经拒绝）：cwd 外的两道门都只放行 cwd 外真实存在的目录，所以无论它们读到什么都是确定否决。删掉的嵌套子仓库属于这一类。
  2. `.code-workspace` 的 allow-list 没能建起来——设置为 `auto` 时出现多个候选（`ambiguous`），或指定的文件缺失 / 读不出 / 解析失败（`missing` / `invalid`）——而选择器是 `../` 形式：认证门只收这种选择器，它没答上来。allow-list 建好了而文件里没有这个 folder，算确定否决；把 `codeWorkspace` 关掉也照旧算确定否决——那是用户改设置，不是我们读不出来。
  3. 第三道门复读 worktree 记录后 git 仍未应答，且 cwd 属于某个仓库（先查默认仓库的解析缓存，缓存没有才跑一次 `rev-parse`）。cwd 不属于任何仓库时这道门无记录可读，沉默就是答复。
- run / query 端点的错误不带 `unverified`：只有快照的失败会被当作对记录的判定。
- `GitRepoList.worktrees?: 'ok' | 'failed'`：worktree 探测或 cwd 外检出的认证未得到 git 应答时为 `failed`；开着探测而工作目录本身没解析出来（超时、取消、git 缺失）也是 `failed`。工作目录不是仓库、或关闭了探测，都算 `ok`。

旧 client 会忽略这两个字段；旧 host 不带这两个字段时，client 按 `forget` / 列表完整处理，也就是之前的行为。所以不要求 host 和 client 同版本。

## Consequences

- 刷新页面、HMR 之后，面板回到原来的检出和文件根。新开的空白标签页从默认仓库开始，这是有意为之；但按浏览器规范，带 opener 打开的页面和「复制标签页」会以原标签页 sessionStorage 的副本起步，所以会带着原来的选择。复制之后两边各写各的，不会互相覆盖。
- 一个暂时核实不了的选择会在每次加载时重试一次：首帧带着旧标签，被否决后回落。代价是这一次多出的请求。
- `stale` 行的 `forget` 依赖「这一行解析不到目录即视为已消失」。host 标 `stale` 有两种来源：git 自己报 `prunable`（确实没了），以及 `realpath` 失败（还可能是权限、临时卸载的外置卷）。把它降级为 `drop` 并不能真正保住记录：同一路径的快照也会因为解析不到目录而返回确定的 `invalid-repo`，下一次采样照样会删。要让「目录存在但读不了」保留记录，需要修改 host 对「否决」的判定，而不只是列表分档；在那之前，误删的恢复方式是重新选一次。
- 行带 `disabled` 的情况，以前要等快照拒绝才回落，现在列表到达就回落。
- 子页签、列表折叠状态、FilesTab 的浏览缓存仍只放在内存里，HMR 后照旧复位；要持久化它们需要另行决定。
- 若要跨标签页恢复，可以把存储换成 localStorage 并补上 TTL，记录格式通过 `v` 升级。届时要重新评估上文提到的「写操作落进意外检出」的风险。
