# ADR-0001：双半架构与 typert RPC 边界

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`src/host/index.ts`、`src/client/index.ts`、`AGENTS.md`「架构总览」

## Context

面板要同时做两件性质不同的事：执行 git 命令、读写文件（只有 Node 能做），以及渲染三栏界面、注册进 Web GUI 的 slot（只有浏览器能做）。两条路都试过等价方案：

- 全放 host，client 只做壳：不行，界面要轮询快照、要虚拟化长列表，跨进程传整棵渲染树比传数据贵得多。
- 全放 client，靠浏览器的能力直接调 git：不可行，浏览器没有进程与文件系统。

所以插件天然是两半。真正要定的是**两半之间放什么**：放一个通用 RPC（client 传任意命令、host 执行），还是放一组语义化的端点。

## Decision

插件分 host / client 两半，边界是 `gitPanel` 命名空间上的**五个语义化端点**：`snapshot` / `run` / `query` / `suggest` / `version`。

> 命名空间名与端点数量已由 ADR-0029 与实现更新（现为 `dbGitPanel` 上的七个端点）；双半边界与端点语义不变。

- host 是 Cordis 服务（`GitPanelService`），只做端点委托与生命周期接线；它不 import React、不 import `@deepseek-ai/dsh-client-*`、不 import client 的任何模块。
- client 是 React bundle，只经 RPC 取数据；它不 import `node:*`、不自己拼 git 命令、不各自发快照。
- `snapshot` 是全量状态，`query` 是按需读取（历史、diff、文件内容…），`run` 是写操作，`suggest` 经宿主 llm 服务生成提交信息，`version` 是版本与更新检查。**语义化端点而非通用 RPC**：每个端点有自己的校验、超时与错误码，host 因此能拒绝它看不懂的请求。

这条边界由 `test/unit/architecture.test.mjs` 守住（host 不得引 client/React，client 不得引 Node 内置，只有 `client/types.ts` 与 `client/testkit.ts` 能 import host）。

## Consequences

- host 的输入是唯一不可信面，安全校验有单点位置（见 ADR-0006）；client 里不存在「拼命令」的地方。
- 新增能力要同时在两半落地：host 加端点或查询类型，client 加调用与视图。这是刻意付出的成本，换来的是边界可测试。
- client 无法绕过 host 直接读文件，文件浏览（含 `.git` 屏蔽、软链拒绝）只有一份实现。
- 端点是 wire 契约的一部分，改名或改参数会破坏已发布的 client——由 ADR-0002 的兼容规则兜住。
