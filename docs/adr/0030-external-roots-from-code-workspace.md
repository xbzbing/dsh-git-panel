# ADR-0030：由 `.code-workspace` 文件认证工作区外的仓库根

- 状态：Accepted（2026-11-10）
- 相关：issue #121、ADR-0006、ADR-0024、`src/host/code-workspace.ts`、`src/host/repos.ts`、`src/host/core.ts`、`src/host/queries.ts`

## Context

会话 cwd 常常是一个「枢纽」目录：它本身不是仓库，真正干活的仓库是它的兄弟目录；这类排布在编辑器里的模型就是多根 `.code-workspace` 文件。面板原先只能提供宿主能从 cwd 认证的仓库——`scanRepos` 向下扫描（深度 3），`git worktree list` 报告的工作树（`repoDirCertified`）。兄弟检出只能靠「把会话开在共同父目录」来看到，那等于放弃枢纽作为会话目录。

约束来自既有的不变量：**只有当宿主能从可信本地来源认证该目录时，cwd 外的目录才可选。** `repoDirFor` 按设计拒绝 `..`；`repoDirCertified` 只接受一个目录——从 `git worktree list` 读到的主工作树——按 realpath 精确相等判定。`isSafePath` 保持不变：它同时守 diff 路径、`dir-list` 与写入目标，放宽它会一次放宽四个面。

备选方案：

- 插件配置里的 `externalRepos` 绝对路径列表：配置是插件级、cwd 是会话级，为某个项目填的路径会静默作用于所有会话。不采用。
- 运行时的「添加仓库」对话框：同样是任意绝对路径越权，且没有任何可审阅、可 diff 的产物。不采用。
- 放宽 `isSafePath` 接受 `../…`：所有接收路径的端点一起被放宽。不采用。

## Decision

- **配置** `codeWorkspace`：`off`（默认）| `auto` | `<cwd 内文件名>`。显式值必须是单段（无 `/`、`\`、`..`），且按 VS Code 的同一规则被识别为工作区文件——`extname(name) === '.code-workspace'`，精确比较、不折叠大小写。因此 `X.CODE-WORKSPACE` 不是工作区文件，名为 `.code-workspace` 的文件也不是（`extname` 为空）——识别口径与编辑器一致，避免「面板列了外部仓库，双击文件却只是纯文本 JSON」。文件还必须在 realpath 后位于 cwd 内且是常规文件，软链不能把设置带出工作区。不接受绝对路径：设置是插件级、cwd 是会话级，绝对路径会成为跨会话的陷阱。按会话 cwd 校验，所以 cwd 是链接工作树、basename 与文件名不一致时同样适用。
- **发现**（`auto`）：cwd 内必须恰好有一个按上述规则识别的工作区文件；多于一个 → `ambiguous`，一个都不选——包括其中一个恰好与 cwd basename 同名的情况。猜测会展示用户没选的项目模型，比空列表更糟。
- **解析**：手写 JSONC 读取（不新增依赖）：BOM、CRLF、行注释与块注释（含字符串内的注释符）、尾逗号。只读 `folders[].path`（字符串）与 `folders[].name`（显示名）；`settings`、`launch`、`tasks`、`extensions` 等段不进入数据模型。结构任何一处不合法（非对象根、缺 `folders`、某条缺字符串 `path`）→ 整个文件作废，不做部分理解。
- **解析每个 folder**：相对路径以文件所在目录为基准，绝对路径也接受；realpath 后必须满足：不在 cwd 内（cwd 内由扫描负责，避免重复行）、basename 不是 `.git`、目录内有 `.git` 条目、`git rev-parse --show-toplevel` 等于该目录本身——因此指向仓库子目录的条目被自动拒绝。按 realpath 去重（Windows 不区分大小写）、上限 20、按路径排序。`"/"` 在 realpath 之后的 `.git` 探针就被丢掉（根目录没有 `.git` 条目），根本走不到 `git rev-parse` 那一步。Windows 上跨盘符的 folder 在 `relative` 之后仍是绝对路径，三道门都会拒绝，所以在扫描阶段就不产出这一行。
- **第三道门** `repoDirExternal(fs, cwd, rel, allowList)`：`rel` 必须是向外选择器（`..` 或 `../…`），realpath 必须精确等于**该请求**构建的 allow-list 成员。allow-list 只来自会话 cwd 内的 workspace 文件，所以 wire 值既不能指向任意父目录，也不能指向文件未列出的兄弟目录。`isSafePath` 不动：diff 路径与写入目标上的 `../x` 仍被拒绝，出 cwd 只有这一道门放行，且它只认 allow-list 成员。
- **缓存**：`rootCache` 没有 TTL 且在验证前命中，向外选择器（`isOutwardSelector`）因此跳过正向缓存，也不再往里写（写了没人读，只会在无 TTL 的 map 里堆积死条目）；15 秒的负缓存保留。`.code-workspace` 扫描结果的键是 `(realpath(cwd), file, mtimeMs, size)`：根列表本身依赖 cwd（cwd 内的条目会被丢掉，`path` 也相对 cwd 计算），而 `file` 是 realpath，父会话与子会话可能共享同一个文件却需要不同答案，所以 cwd 必须进键。条目带扫描时刻，60 秒（`CODE_WORKSPACE_CACHE_TTL_MS`）后过期，过期即整次重扫——这既给「先写文件、后克隆仓库」的 folder 一个必然的重试窗口（否则首轮未解析的结果会被缓存到文件被编辑为止，行永远不出现），也把「同长度改写 + mtime 精度不足导致 stamp 不变」的旧答案限制在 60 秒内。命中期内对每个根做一次 `realpath` 复核（最多 20 次系统调用、不起进程），目录被删或被移动到别处的根当场丢弃——否则文件没变，删掉的外部仓库会一直以幽灵行的形式存在；路径上重新出现的不是工作树顶的目录（例如同名普通目录），由过期后的重扫按完整认证规则剔除。这两个取舍都有测试显式钉住。代价：到期重扫落在请求路径上（`repo-list` 与 allow-list 构建都调它），但每键每 60 秒至多一次，工作量受下面两条上限约束——最坏 200 次 realpath/stat、至多 200 次串行 `rev-parse`，常见 20 个根的一次重扫是几百毫秒量级的一次性开销。
- **单一根概念**：`dir-list`、`file-content`、`openFile`、`writeFile` 都经 `resolveBrowseRoot` → `resolveWorkspace(repo)`，选择外部根就把浏览与编辑一起移过去，不新增端点级开关，也不出现「Git 宽了、文件浏览还是窄的」这种自相矛盾的界面。ADR-0024 的编辑边界按「解析出的那个根」生效：白名单、`.env`、2 MiB、UTF-8 往返、`baseSha256`、原子替换都不变，只是范围表述从「工作区」修正为「选中的根」。
- **wire**：`GitRepoEntry.kind` 增加 `'external'`，同时带 `role: 'repo'` 与可选 `label`（来自 `folders[].name`；`../service-a` 在窄侧栏里不是好标签，而旧客户端会忽略未知字段）。客户端只改 `repo-list.ts`：`'external'` 归入既有的 foreign 分组，`repoLabel` 优先使用 label，不新增界面元素。
- **识别状态**：`GitRepoList.codeWorkspace?: { state: 'applied' | 'missing' | 'invalid' | 'ambiguous'; file?: string }`。`applied` 表示文件被解析、文件夹已解析（即使一个 checkout 都没有）；`missing` 是显式名字找不到文件（最常见的手误），`invalid` 是名字形状不合法、软链逃出 cwd、超过 1 MiB 或解析失败，`ambiguous` 是 `auto` 命中多个候选。只在两种情况保持沉默：`off`，以及 `auto` 在 cwd 里根本没有候选文件——那是「没有配置」，不是失败。状态放在 `repo-list` 而不是配置：配置是插件级、无 cwd，回答不了「这个会话里文件在不在」。切换器把状态渲染为一行不可选提示；本 PR 只负责在 host 侧计算并下发，提示行的 UI 作为后续改动。

## Consequences

- 正面：枢纽目录得以保留为会话 cwd；外部根与工作区内仓库走同一套 realpath 认证；浏览、编辑、提交、差异、AI 生成都在同一个根下工作，切换仓库的既有语义不变。
- 代价：workspace 文件成为第二个认证来源，而它是 cwd 内的一个普通文件。两种来源都成立：agent 可以改写它；cwd 通常是刚克隆下来的仓库，因此**提交在仓库里的 `*.code-workspace` 也能做到这件事**——`folders: [{ "path": "../.." }]` 或更上几层，就能把任何一个上层 git 检出拉进列表，行看起来和别的仓库行没有区别，而 `allowFileEdit` 默认是开的，点一下就能按编辑白名单写进那个目录。控制点仍然是：功能默认关闭（不跟随 `detectCheckouts`）、行标记为 external、每个根必须通过 `git rev-parse --show-toplevel`。这是显式接受的取舍，也是默认 `off` 而非跟随 `detectCheckouts` 的原因。曾考虑但本期不做的加固：`auto` 只接受 git 未跟踪的文件（显式命名仍然放行）、只接受 cwd 的兄弟目录、在行内提示里同时显示来源文件——都留作后续。
- 一次扫描最多**尝试**前 `CODE_WORKSPACE_MAX_ATTEMPTS`（200）个 folder 条目并最多**产出** `CODE_WORKSPACE_MAX_ROOTS`（20）个根：产出上限只数成功者，若不给尝试设上限，一个 1 MiB 的文件里上万个条目会各付一次 realpath 与 `.git` 预探针，其中带着 `.git` 条目的还会各起一次 `git rev-parse`。`repo-list` 缓存未命中（含 60 秒 TTL 到期后的重扫）都受这两条上限约束；`.git` 文件系统预探针（ADR-0005 的「锁仓库根、有界输出」不变，只是不启进程）让「folder 指向普通目录」的常见情况零进程。
- 列表因此有两个互不相关的上限：文件系统扫描受 `REPO_RESULT_LIMIT`（50）约束，workspace 文件在它之上再加最多 `CODE_WORKSPACE_MAX_ROOTS`（20）个已认证的根——这些根不经过扫描、不该占扫描的名额。代价是一次 `repo-list` 最多 70 行。
- 外部仓库的 worktree 家族要在选中该仓库之后才可见：`git worktree list` 按选中的根运行。与工作区内今天的行为一致，README 需写明。
- 刻意不复刻 VS Code 的「缺失文件夹仍保留为带警告的行」：这个列表是仓库列表，不是文件树，不是 checkout 的文件夹没有行可放。识别状态已经说明文件是否可用，不需要为此新增行类型。
- 只读端点之外没有任何新写入面：`writeFile` 仍是唯一写文件的端点，其 realpath 包含检查现在以选中的根为准。
- 需要同 PR 更新的文档：`README.md` / `README.en.md` 的权限与边界一节（「不在工作区外读文件」的措辞）、配置项说明、`AGENTS.md` 的安全不变量（两道门变三道门）。ADR-0024 不被取代，只修正适用范围。
