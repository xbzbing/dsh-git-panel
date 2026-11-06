# ADR-0029：host 服务键与 RPC / locale 命名空间改用 `dbGitPanel`，重复挂载保持惰性

- 状态：Accepted（2026-11-06）
- 相关：ADR-0001、`src/host/index.ts`、`src/client/namespace.ts`、`src/client/rpc.ts`、`test/unit/mount-idempotency.test.mjs`

## Context

插件的 host 半以 Cordis 服务的形式提供能力。服务键在**整棵插件树里全局唯一**：`Service` 构造时调用 `ctx.reflect.provide(name, …)`，同一个键第二次注册会直接抛 `service "…" has been registered`。cordis 在 `Fiber._reload()` 里接住这个错误并把该 fiber 标为 failed，不向外冒泡；dsh 的启动审计只对必需条目（agent-loop / webserver 等）抛 `StartupError`，本插件不在其中。实测代价是：**重复的那一行激活失败、启动日志多一条 warning，先激活的条目照常提供面板与 RPC**——安装步骤成功，但 profile 里会留下一个永远失败的条目，排查时容易被误读。这个失败模式与具体环境无关，只看树里有没有第二个同名注册。

同一个键还会成为 typert 的 wire 命名空间（`bindTypertRemote` 默认 `namespace = serviceKey`），client 经共享 `/api` 通道调用 `<namespace>/<method>`；locale 字典也按命名空间字符串注册，后注册者会覆盖或合并同名键。三处名字一旦撞车，轻则设置项串台，重则两端都拿不到数据。

服务键取 `gitPanel` 这种按领域命名的通用词时，只要树里出现任何同名注册就会冲突。现在的插件树由多个来源的包组合而成（npm、GitHub、本地路径），通用名不再天然独占；同时 profile 也可能把同一个包组合两次（诊断用的探针行与正式行并列），第二次激活不应留下一个失败的条目。

约束有三条：typert 的命名空间段只接受 `[A-Za-z0-9_$.-]+`，npm scope 的 `@` 与 `/` 不能直接进 wire 名；wire 名是 host 与 client 之间的内部约定，不对外承诺，但两半必须同版本；服务实例属于应用它的 fiber，配置变更走的是「dispose 旧 fiber → 重新 apply」，因此任何防重复的守卫都不能比 fiber 活得更久。

## Decision

**1. 三处名字统一为 `dbGitPanel`。** `SERVICE_KEY = 'dbGitPanel'` 同时用于 Cordis 服务键与 typert 命名空间；client 侧只有 `namespace.ts` 一个 `NS` 常量，locale 注册与 RPC 端点前缀都从它取。契约测试把 client 的注册命名空间与 host 的 `SERVICE_KEY` 钉在一起，避免任一半单独改名。

**2. host 默认导出改成对象插件，`apply` 承担幂等守卫。** 默认导出从类改为 `{ name, inject, Config, apply }`：`apply` 先 `ctx.get(SERVICE_KEY, false)`（非严格：只看键是否被占用，不看提供者是否 active），已存在时记一条 warn 并返回，否则构造 `GitPanelService`。守卫读的是**当前树里已注册的服务**，不是模块级标志，因此：

- 同一个模块挂两次、同一份代码的两个模块实例各挂一次，都会命中守卫；
- 两条 fiber 同批激活（loader 并发挂载）或共享依赖提供者重启导致的同批 reload，也一样——先注册者的 fiber 此刻还停在 state 1（loading），严格查找会误判为空位，非严格查找才看得到它；
- fiber 卸载时服务随 `ctx.provide` 的 disposer 注销，配置变更后的重新 apply 看到的是空位，会正常注册新实例。

**3. 右键菜单的目标族保留 `gitPanel.*`。** 它们是平台的菜单目标类别（`ContextMenuTargetMap` 的键），不是服务键或 wire 命名空间；改它们只会让目标值与贡献 id 无谓漂移，不解决服务注册冲突。

**4. 不保留旧键别名。** 旧 client 调 `gitPanel/*` 会得到端点不存在，表现为一条可识别的传输层失败，而不是静默绑到别的命名空间。升级要求 host 与 client 同版本，并硬刷新浏览器以丢弃旧 bundle；这一点写进发布说明。

## Consequences

- 服务键不再是一个领域通用词，整棵树里可以与本插件共存任意名称的其他包；wire 名与 locale 命名空间也随之独占。
- 重复组合的 profile 不再留下失败条目：第二条目保持惰性，只在日志里留一行说明。代价是若第一条目先卸载、第二条目仍在，面板会消失到下一次重新挂载为止——这只会发生在本来就重复的组合里，且日志已经说明。守卫只管 host 半；client 半按包名记账，同名包的重复条目在宿主侧塌成一条 source、只 apply 一次，同一包来自不同来源时由 `client-modules` 拒绝并提示移除其中一条，这一层不归插件管。
- 旧版本的 client bundle 与新 host 不兼容（反之亦然）。失败是显式的传输层错误，面板降级为不可用而不会误绑；发布说明要求同版本 + 硬刷新。
- 配置命名空间不受影响：插件配置仍按 profile 条目落在 `cordis.patch.yml` 的 `id` 下，重命名只动服务键、wire 名与 locale 名。
- ADR-0001 中「`gitPanel` 命名空间上的五个端点」这个名称由本 ADR 取代，双半边界与端点语义不变；端点数量本身也已扩展到七个（新增 `openFile` / `writeFile`），不在本 ADR 的范围。ADR-0001 已加前向注记，并在 `docs/adr/README.md` 的「有效期」登记。
