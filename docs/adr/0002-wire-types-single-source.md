# ADR-0002：wire 类型单源与向后兼容

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/host/types.ts`、`src/client/types.ts`、`test/unit/plugin-contract.test.mjs`

## Context

host 与 client 之间传的是结构化数据（快照、查询结果、动作请求）。这类契约最常见的坏结局是**两份定义**：host 一份、client 一份，靠人肉同步；某次只改了一边，运行时不报错，只是字段悄悄变成 `undefined`。

另一个压力来自分发方式：host 与 client 可以不同版本共存。用户装了新版 host、浏览器里还跑着缓存的旧 client bundle（或反过来，`lib/` 入库导致 GitHub 安装拿到的是某次提交的快照）。

## Decision

- `src/host/types.ts` 是 wire 数据模型的**唯一权威源**；client 不重新定义，经 `src/client/types.ts` 这一个文件复用（它只做 re-export，并派生视图用的投影类型如 `GitDiffPayload`）。
- 常量范围同样单源：`SUGGEST_LIMITS`、`DIFF_EXPAND_CONTEXT`、`FILE_COPY_MAX_BYTES` 等由 host 定义、client 直接引用，UI 的输入范围与 host 的校验从同一处派生。
- 新增 wire 字段必须**向后兼容**：新字段可选，旧 client 忽略它；client 遇到旧 host 缺字段要降级（用默认值或隐藏对应 UI），而不是崩。
- 新增 query kind 也按同一条规则降级：旧 host 没有该分支时 `runQuery` 落到 `undefined`，client 的 `queryAs` 得到空值并显示「读取失败」，而不是把别的版本当成这个版本（`file-version` 即按此上线）。
- 数据模型改动从 `types.ts` 起，再往下游改；不存在第二份需要手工同步的定义。

## Consequences

- 改一个字段只有一处要改，TypeScript 会把所有受影响的调用点报出来。
- 兼容规则让 wire 类型只能加字段、很难删字段；删除需要先经历「标记弃用 → 等旧 client 退出 → 再删」。
- client bundle 里带的是**编译期**的类型，所以类型单源并不防止运行期版本错配——真正兜住的是「新字段可选 + 缺失降级」这条规则，以及 `lib/` 与 `src/` 同提交的门禁（ADR-0003）。
