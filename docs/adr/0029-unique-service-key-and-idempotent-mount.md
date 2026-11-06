# ADR-0029：host 服务键与 RPC / locale 命名空间改用 `dbGitPanel`，重复挂载保持惰性

- 状态：Accepted（2026-11-06）
- 相关：ADR-0001、`src/host/index.ts`、`src/client/rpc.ts`、`src/client/locales.ts`、`test/unit/mount-idempotency.test.mjs`

## Context

插件的 host 半以 Cordis 服务的形式提供能力。服务键在**整棵插件树里全局唯一**：`Service` 构造时调用 `ctx.reflect.provide(name, …)`，同一个键第二次注册会直接抛 `service "…" has been registered`，错误沿着 fiber 冒泡，最终表现为整棵插件树激活失败——安装步骤仍然成功，面板与 RPC 却全部不可用。这个失败模式与具体环境无关，只看树里有没有第二个同名注册。

同一个键还会成为 typert 的 wire 命名空间（`bindTypertRemote` 默认 `namespace = serviceKey`），client 经共享 `/api` 通道调用 `<namespace>/<method>`；locale 字典也按命名空间字符串注册，后注册者会覆盖或合并同名键。三处名字一旦撞车，轻则设置项串台，重则两端都拿不到数据。

服务键取 `gitPanel` 这种按领域命名的通用词时，只要树里出现任何同名注册就会冲突。现在的插件树由多个来源的包组合而成（npm、GitHub、本地路径），通用名不再天然独占；同时 profile 也可能把同一个包组合两次（诊断用的探针行与正式行并列），第二次激活不应把整棵树带下去。

约束有三条：typert 的命名空间段只接受 `[A-Za-z0-9_$.-]+`，npm scope 的 `@` 与 `/` 不能直接进 wire 名；wire 名是 host 与 client 之间的内部约定，不对外承诺，但两半必须同版本；服务实例属于应用它的 fiber，配置变更走的是「dispose 旧 fiber → 重新 apply」，因此任何防重复的守卫都不能比 fiber 活得更久。

## Decision

**1. 三处名字统一为 `dbGitPanel`。** `SERVICE_KEY = 'dbGitPanel'` 同时用于 Cordis 服务键、typert 命名空间、client `rpc.ts` 的 `NS` 与 `locales.ts` 的 locale 命名空间。host 导出该常量，契约测试与重复挂载测试直接引用，避免四处字符串各写一份。

**2. host 默认导出改成对象插件，`apply` 承担幂等守卫。** 默认导出从类改为 `{ name, inject, Config, apply }`：`apply` 先 `ctx.get(SERVICE_KEY)`，已存在时记一条 warn 并返回，否则构造 `GitPanelService`。守卫读的是**当前树里已注册的服务**，不是模块级标志，因此：

- 同一个模块挂两次、同一份代码的两个模块实例各挂一次，都会命中守卫；
- fiber 卸载时服务随 `ctx.provide` 的 disposer 注销，配置变更后的重新 apply 看到的是空位，会正常注册新实例。

**3. 右键菜单的目标族保留 `gitPanel.*`。** 它们是平台的菜单目标类别（`ContextMenuTargetMap` 的键），不是服务键或 wire 命名空间；改它们只会让目标值与贡献 id 无谓漂移，不解决服务注册冲突。

**4. 不保留旧键别名。** 旧 client 调 `gitPanel/*` 会得到端点不存在，表现为一条可识别的传输层失败，而不是静默绑到别的命名空间。升级要求 host 与 client 同版本，并硬刷新浏览器以丢弃旧 bundle；这一点写进发布说明。

## Consequences

- 服务键不再是一个领域通用词，整棵树里可以与本插件共存任意名称的其他包；wire 名与 locale 命名空间也随之独占。
- 重复组合的 profile 不再让树激活失败：第二条目保持惰性，只在日志里留一行说明。代价是若第一条目先卸载、第二条目仍在，面板会消失到下一次重新挂载为止——这只会发生在本来就重复的组合里，且日志已经说明。
- 旧版本的 client bundle 与新 host 不兼容（反之亦然）。失败是显式的传输层错误，面板降级为不可用而不会误绑；发布说明要求同版本 + 硬刷新。
- 配置命名空间不受影响：插件配置仍按 profile 条目落在 `cordis.patch.yml` 的 `id` 下，重命名只动服务键、wire 名与 locale 名。
- ADR-0001 中「`gitPanel` 命名空间上的五个端点」这个名称由本 ADR 取代，双半边界与端点语义不变；端点数量本身也已扩展到七个（新增 `openFile` / `writeFile`），不在本 ADR 的范围。
