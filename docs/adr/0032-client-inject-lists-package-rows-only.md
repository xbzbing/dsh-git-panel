# ADR-0032：`dsh.client.inject` 只声明客户端包边，平台 seed 不进这张表

- 状态：Accepted（2026-11-13）
- 相关：ADR-0003、ADR-0004、ADR-0022、ADR-0029、`package.json`、`build.mjs`、`test/unit/plugin-contract.test.mjs`

## Context

浏览器半加载时会遇到两类外部模块，它们的**提供者与声明位置完全不同**，但早期被当成同一件事：

1. **平台 seed**：react、react-dom、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。web shell 在启动时把它们放进一张**冻结的模块表**，每个 bundle 的 `require` 都解析到同一份实例。
2. **客户端包（boot graph row）**：`@deepseek-ai/dsh-client-connection`、`dsh-client-locale`、`dsh-client-ui-conversation`、`dsh-client-ui-sidebar-right`、`dsh-client-ui-context-menu` 等。它们是独立的客户端插件包，有自己的 bundle，由 dsh 按图组合、按需取回。

`dsh.client.inject` 属于第 2 类：它是「这些**包**的工厂必须先到」的到达顺序边（dsh `packages/client/modules/src/client/manifest.ts` 把字段描述为 package-name dependency edges）。

历史上本插件把第 1 类的 `@deepseek-ai/dsh-client-ui-primitives` 也写进了这张表，理由是「MarkdownText 来自平台 seed」。这条边**永远是死边**：该包没有 `dsh.client` 声明（它的 package.json 无 `dsh` 字段），因此 dsh 永远不会为它合成 graph row，`inject` 里这个名字查不到任何行，被静默跳过。同期的 `menu-types.ts` / `sidebar-types.ts` 注释也把 context-menu 与 sidebar-right 误称为「platform seed」，进一步把两种机制混在一起。

这不造成故障（缺行被跳过），但它是**错误的声明**：读的人会以为 seed 应该在这张表里声明，下一次就会为一个真正需要 seed 的模块加一条无效边，或者反过来漏掉一条真实的包边。

## Decision

**1. `dsh.client.inject` 只列真实的客户端包行。** 当前五项：`dsh-client-connection`、`dsh-client-locale`、`dsh-client-ui-conversation`、`dsh-client-ui-sidebar-right`、`dsh-client-ui-context-menu`。移除 `@deepseek-ai/dsh-client-ui-primitives`。

**2. 平台 seed 不由插件声明。** seed 表由 shell 独占（它对插件不可配置），插件能做的只是「不要在打包时把 seed 复制进自己的 bundle」，这件事由 `build.mjs` 把整个 `@deepseek-ai/*` 作用域保持 external 完成，与 manifest 无关。

**3. 契约测试把这张表钉成精确清单。** `test/unit/plugin-contract.test.mjs` 断言 `inject` 逐项等于上面五个包名，并在注释里写明 seed 不进这张表的原因。加 seed 边会让测试变红。

**4. 不因为老版本缺某个包就删边。** `dsh-client-ui-context-menu` 在 dsh 0.2.1 上不是 graph row，边被静默跳过，插件按延迟注入门控静默不注册菜单；这是预期的降级，不是需要调整声明的理由。

## Consequences

- 行为零变化：删掉的是一条从未生效的边。实测 dsh 0.2.2-rc.2 与 0.2.1-rc.5 上 boot row、两个懒加载 chunk、七个端点与面板渲染均不受影响。
- 声明与机制一一对应了：想知道「浏览器半等哪些包先到」看 `dsh.client.inject`；想知道「哪些模块由 shell 提供单实例」看 shell 的模块表与 `build.mjs` 的 external 规则。两处不再互相污染。
- 新增一个真正依赖的客户端包时，必须同时加进 `inject` 与契约测试清单；只加一半会让测试失败——这是有意的摩擦，因为这条边错了只会表现为「某个服务偶发未就绪」。
- **ADR-0022** 中「加进 `dsh.client.inject`（浏览器半依赖哪些 platform seed 包）」的括注由此澄清：决策（加 inject、不加 `peerDependencies`）不变，只是「seed 包」这个说法改为「客户端包」。ADR-0022 正文未改写，已加前向注记指向本条。
- 若 dsh 将来把 `ui-primitives` 这类包也做成 graph row（给它加上 `dsh.client` 声明），本决策仍然成立：那时它已经是「包」而不是 seed，插件是否加边取决于是否真的需要它的工厂先到，而不是取决于它曾经是 seed。
