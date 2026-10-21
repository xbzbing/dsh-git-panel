# 架构决策记录（ADR）

本目录记录 `dsh-git-panel` 已经做出的架构决策。

这些决策原先散落在 `AGENTS.md`、`README.md`、代码注释、测试断言与提交信息里：规则还在，**理由会丢**。提交信息里的论证（例如「为什么 host 绝不压缩」「为什么 e2e 不能用 `&&` 串联」）只有翻历史才看得到，而 ADR 把它固定在仓库里。本轮迁移自 2026-10-18 的代码与文档现状，不是新决策。

## 约定

- 一个 ADR 只记一个决策；文件名 `NNNN-短横线标题.md`，编号单调递增、**不复用**。
- 状态取值：`Accepted`（生效中）、`Superseded by ADR-XXXX`（被取代，正文保留）、`Deprecated`（不再适用）。
- 决策被推翻时**不改写历史**：新写一份 ADR，把旧的标为 Superseded 并互相链接，让人能看到完整的决策链。
- 结构固定为 Context（当时的约束与备选）→ Decision（我们做什么）→ Consequences（代价与后续），一到两页。
- **与 `AGENTS.md` 的分工**：`AGENTS.md` 是操作手册（怎么写代码、改哪里、跑什么门禁），ADR 解释这些规则**为什么存在**、当时放弃了什么。改规则时两处一起改，别只改一处。

## 索引

| 编号 | 决策 | 领域 |
| --- | --- | --- |
| [ADR-0001](0001-two-halves-and-rpc-boundary.md) | 双半架构与 typert RPC 边界 | 架构 |
| [ADR-0002](0002-wire-types-single-source.md) | wire 类型单源与向后兼容 | 契约 |
| [ADR-0003](0003-committed-artifacts-and-install-identity.md) | 安装端零构建、禁止安装期脚本与安装身份 | 分发 |
| [ADR-0004](0004-build-shape.md) | 构建形态：host 逐模块不压缩 + client 单 bundle + 懒加载 chunk | 构建 |
| [ADR-0005](0005-git-execution-contract.md) | git 执行契约：argv、无 shell、锁仓库根、有界输出 | 安全 |
| [ADR-0006](0006-trust-boundary-validation.md) | 信任边界单点校验与 `--end-of-options` | 安全 |
| [ADR-0007](0007-write-operations-stay-in-bounds.md) | 写操作不越权：push / pull / publish / 检出 | 安全 |
| [ADR-0008](0008-untracked-discard-boundary.md) | 未跟踪条目删除的边界 | 安全 |
| [ADR-0009](0009-snapshot-single-source.md) | 快照单一来源与业务/刷新分离 | 数据流 |
| [ADR-0010](0010-visibility-gating-and-on-demand-queries.md) | 可见性门控与按需查询 | 数据流 |
| [ADR-0011](0011-merge-commits-first-parent.md) | 合并提交按 first-parent 三处同源 | 正确性 |
| [ADR-0012](0012-large-repository-limits.md) | 大仓库限流与有界展开 | 性能 |
| [ADR-0013](0013-incomplete-data-is-never-silent.md) | 不完整数据不静默 | 正确性 |
| [ADR-0014](0014-suggest-language-and-budget.md) | AI 生成提交信息的语言与预算 | AI |
| [ADR-0015](0015-rendering-security-boundary.md) | 渲染安全边界：HTML / Markdown 图片 / mermaid | 安全 |
| [ADR-0016](0016-client-rendering-performance.md) | 客户端渲染性能约定 | 性能 |
| [ADR-0017](0017-test-and-gate-strategy.md) | 测试与门禁策略 | 工程 |
| [ADR-0018](0018-distribution-channels.md) | 分发渠道与产物来源（正式版 npm + Release 附件；预发布只走 GitHub） | 分发 |
| [ADR-0019](0019-release-process.md) | 发布流程与发布说明 | 分发 |
| [ADR-0020](0020-html-preview-asset-packing.md) | HTML 预览：`blob:` 独立进程的交互预览 + 相对资源以 data: 内联（静态可选） | 安全 |
| [ADR-0021](0021-release-notes-record-stable-only.md) | 发布正文归档只收正式版（rc 页面照写但不归档） | 分发 |
| [ADR-0022](0022-panel-placement-and-sidebar.md) | Git 面板的入口位置配置与右侧边栏接入 | UI |
| [ADR-0023](0023-sidebar-three-mode-layout.md) | 侧边栏三模式布局（wide / stacked / compact） | UI |

## 有效期

ADR 记录的是**决策与它的有效期**，不是当前实现的快照。当实现按计划演进时，旧 ADR 不删除、不重写，而是标注新状态并链接取代者：

- **ADR-0003** 的稳定不变量（安装端零构建、禁止安装期脚本、安装身份三处一致、产物新鲜度门禁）持续有效；其中「`lib/` 入库」已退出，由 **ADR-0018** 取代（`lib/` 已移出 main）。
- **ADR-0018** 已生效：`lib/` 不再提交到 main，GitHub 安装走 Release 附件 tgz。

## 新增一份 ADR

复制下面的骨架到 `NNNN-标题.md`（编号取索引里最大的 +1），然后在上表补一行：

```markdown
# ADR-000N：一句话说清的决定

- 状态：Accepted（YYYY-MM-DD）
- 相关：issue / PR / 代码位置

## Context

当时面对什么约束、有哪些备选、为什么它们不够好。写事实，不写立场。

## Decision

我们做什么。用完整句子、主动语态；能被后来的人照着判断「这个改动违不违反它」。

## Consequences

正面、负面、中性后果都要写：代价是什么、后续必须跟着做什么、什么情况下该回来重新评估。
```
