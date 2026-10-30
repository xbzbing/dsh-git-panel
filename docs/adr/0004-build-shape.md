# ADR-0004：构建形态：host 逐模块不压缩 + client 单 bundle + 懒加载 chunk

- 状态：Accepted（2026-10-18，迁移自现有实现）
- 相关：`build.mjs`、`tsconfig.build.json`、`src/client/mermaid-chunk.ts`
- 后续：ADR-0025 按同一形态加了第二个懒加载 chunk（编辑器 `lib/client.editor.js`）

## Context

两半的运行环境不同，对产物的要求也相反。

host 跑在 DSH 进程里，经 typert 暴露 RPC。**typert 靠方法参数名做参数校验**：它读取函数签名的形参名来校验入参，任何重命名都会静默破坏 wire 契约。所以 host 产物不能压缩、不能改名、不能 bundle 成一块——否则堆栈也会落在一个巨大的匿名文件里。

client 跑在浏览器里，由 loader 按 `window.__ModuleLoader__.load({ id, factory })` 装载，平台模块（react / react-dom / `@deepseek-ai/*`）由宿主提供。这里体积和加载速度重要，压缩与打包是正收益。

另有一个特例：mermaid 是唯一非平台运行时依赖（宿主不提供，平台组件也没有 mermaid 钩子），它体积巨大，绝大多数会话根本用不到。

## Decision

- host：`tsc -p tsconfig.build.json` 只出 `lib/host/*.d.ts`；esbuild 把 `src/host/*.ts` **逐文件**转译成 `lib/host/*.js`（`bundle: false`，与 `src/host/` 一一对应），`minify: false`、`sourcemap: false`。平台包保持裸 import，由安装端解析。
- client：esbuild 把 `src/client/index.ts` 打成单个 `lib/client.js`（cjs，包进 `__ModuleLoader__.load({ id, factory })`），平台模块 external，**可 minify**。
- 懒加载 chunk：`src/client/mermaid-chunk.ts` 单独打成 `lib/client.mermaid.js`，注册 `chunk: "client.mermaid.js"`，由 `/plugins` 路由按需下发。**主 bundle 里只允许一个引用点**（`MermaidFigure.tsx` 的 `require.async('./client.mermaid.js')`），mermaid 绝不进主 bundle；文件名必须匹配平台的 `client.<name>.js` 规则，且随 `lib/` 提交。
- 类型声明只覆盖 host：client 是 bundle，不对外暴露类型面。

## Consequences

- host 的堆栈直接落在出问题的模块上，审查可以逐文件对照 `src/host/`；typert 的参数名校验不受构建影响。
- 代价：host 产物文件数 = 源文件数（当前 15 对 js + d.ts），`lib/` 的 diff 噪声大；**host 拆分目录前必须先让构建递归**（见架构规划 T4.1），否则新子目录不会产物。
- mermaid chunk 让主 bundle 保持轻量，但把 5.3 MB 放进版本库与 npm 包（安装包从 133 KB 涨到 1.6 MB）；首次渲染图表时才有一次额外请求，失败回退代码块。
- client 无 sourcemap，线上堆栈不可读——这是当前已知的运维缺口。
