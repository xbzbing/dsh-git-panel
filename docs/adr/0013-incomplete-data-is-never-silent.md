# ADR-0013：不完整数据不静默

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/client/notice.tsx`、`src/host/types.ts`、`src/host/queries.ts`

## Context

这个插件里有多条「因为上限而拿不到全部数据」的路径：快照截断、未跟踪回落折叠、统计降级、diff 输出截断、suggest 输入截断。

危险的不是截断本身（上限是必要的，见 ADR-0012），而是**截断后的数据看起来是完整的**。最典型的例子：diff 被 runner 输出上限截断后，如果照常返回，行号和 `+/-` 统计在截断点之后全是错的——用户会拿着错误行号去改代码。

同类问题还有 `newLines`：它为 0 时表示「新侧行数不可信」，此时渲染尾部展开控件就是骗人（点了没反应）。

## Decision

- 每一条降级路径都带**显式标记**并在 UI 用 `NoticeBar` 提示：快照截断（`truncated` + `truncatedReason`）、未跟踪回落折叠（`untrackedCollapsed`）、统计降级（`stats.partial`）、diff 输出截断（`truncated`）、suggest 输入截断。
- `newLines === 0` 表示新侧行数不可信，**视图不得渲染尾部展开控件**。
- 「文件较大，其余保持折叠」这类提示必须由**实际剩下的隐藏行**判定，而不是按估算——否则在「改动贴着文件一端」与「相邻改动把 hunk 合并」两种情况下会分别漏报与误报。
- `file-version` 的 `tooLarge` / `binary` / `absent` 必须显式返回，并在文件视图与复制入口说明，不得把缺失版本或超限内容当作空文件。
- 宁可多一个提示条，也不让降级数据冒充完整数据。

## Consequences

- 用户能区分「就是这些」与「只显示了这些」，行号与统计可信。
- 代价：UI 状态变多，每个降级路径都要渲染提示；`NoticeBar` 因此成了共享原语而不是某个页面的局部实现。
- e2e 断言了 `truncatedNotice`、`incompleteNotices`、`changes.untrackedCollapsed`、`changes.truncatedLossy` 等具体文案键——提示是契约的一部分。
