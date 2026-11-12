# ADR-0031：host 端点经 typert SRC 反射发布，参数名即 wire 键名

- 状态：Accepted（2026-11-12）
- 相关：ADR-0001、ADR-0002、ADR-0029、`src/host/index.ts`、`src/host/types.ts`、`src/client/rpc.ts`、`test/unit/plugin-contract.test.mjs`

## Context

host 半的七个端点用 `@Remote('snapshot')` 这类字符串形式标注，服务本身 `extends TypertRemoteService`，没有 `./typert` 导出、也没有由构建产出的 typert 严格描述符。dsh 的 Gateway 因此走 **SRC 反射**这条路径：它从方法源码文本里解析参数表，把**参数名**当作 wire 参数键（dsh `packages/api/gateway/src/index.ts` 的 `methodParameterNames`），失败时以 `gateway/*` 错误码拒绝，且**不会**退回宽松匹配。

这条路有三条硬约束，且全部在 TypeScript 的类型系统之外——签名写得再漂亮，运行期照样可能一个端点都调不通：

1. **参数名即 wire 键名。** client 固定发 `{ args: { request } }`，host 方法第一个参数必须叫 `request`。改名不会让任何一半报错，只会让调用在网关上对不上字段。
2. **签名必须能被静态推导。** 解构、默认值、rest 参数都会让方法无法绑定（dsh 侧视为非法签名）；`signal` 是取消参数，必须排在最后一位。
3. **host 产物绝不压缩。** 压缩会重命名参数，等价于把七个端点同时改名。这也是 `build.mjs` 对 host 段坚持逐文件、`minify: false` 的原因之一（ADR-0004 记录了产物形态，本条记录它在 wire 上的必要性）。

2026-11-12 对 dsh 0.2.2-rc.2 的实测确认：SRC 路径在 rc.2 上仍然可用，七个端点全部返回 200，`request` 解析正常，`signal` 末位被接受。但 dsh 官方文档把 SRC 定位为 *development fallback*（正式路径是构建期生成的严格描述符），并且当某个 namespace 存在过严格描述符又被撤回时，Gateway 会**禁止**回退到 SRC。也就是说这条依赖随时可能因为 dsh 侧策略收紧而失效，而失效方式是七个端点同时不可用。

备选方案是引入 typert 生成器、为 host 半产出严格描述符。放弃的理由：那要求 host 半接入 dsh 的构建插件与类型模型，与本插件「逐文件输出、零构建耦合」的产物契约冲突，代价远大于当前收益；且严格模式要求参数全部必填，现有 `signal?: AbortSignal` 反而要先改写。

## Decision

**1. 端点集合与顺序固定为七个，写在共享的 `REMOTE_METHODS` 常量里。** `src/host/types.ts` 是 wire 类型的单源，端点名单也放这里；client 的 `invoke()` 参数类型取 `RemoteMethod`，因此拼错方法名会在 typecheck 阶段失败，而不是在用户点按钮时。

**2. 每个端点的第一个参数必须叫 `request`，`signal` 只出现在需要取消的四个端点上并排在最后。** 这是 client 的固定 payload `{ args: { request } }` 能够成立的前提。

**3. 契约由测试钉在编译产物上，而不是钉在源码上。** `test/unit/plugin-contract.test.mjs` 读取 `lib/host`，对每个端点断言：存在同名原型方法、参数表逐字等于预期、不含默认值 / 解构 / rest。跑在产物上这一点是刻意的——它同时守住「host 不压缩」这条构建规则。

**4. 不为此引入 typert 生成器。** 只有当 dsh 收紧到 SRC 不可用（例如某天要求所有 Remote namespace 必须有严格描述符）时，才回来评估生成器迁移；届时也要一并处理 `signal` 的可选性问题。

## Consequences

- 端点改名、参数改名、给 `signal` 以外加参数、给参数加默认值，都会在 `test:unit` 阶段失败，并给出具体的端点与参数名。这类改动本来是「静默失效、只在运行时表现为某个功能不工作」。
- `REMOTE_METHODS` 与 host 的实际方法集合是**单向**约束：名单里的每一项都必须有对应方法，但测试不会发现「host 新增了方法却没进名单」。新增端点时必须同时改三处（`types.ts` 名单、host 方法、client 的 `GitPanelRemote`），这是有意的摩擦——只加方法不加名单的端点，client 也调不到。
- 插件的 host 半继续依赖 SRC 反射这条非正式通路。dsh 若在未来版本收紧策略，症状是**七个端点一起失效**（`gateway/definition-unavailable` 一类错误），而不是某个功能退化；排查时应先确认 dsh 版本与 namespace 策略，再看方法签名。
- 只要 dsh 的 SRC 解析规则不变，本插件就无需接入 typert 构建链；`build.mjs` 里 host 段的 `minify: false` 从「产物可读性偏好」升级为**契约要求**，改动它会直接破坏 wire。
- 本条不涉及 `dsh.client.inject`：那是浏览器半的包间到达顺序声明，与 host 端点无关。
