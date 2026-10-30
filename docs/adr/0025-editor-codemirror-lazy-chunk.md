# ADR-0025：编辑器以 CodeMirror 6 懒加载 chunk 引入

- 状态：Accepted（2026-10-30）
- 相关：issue #94、ADR-0004、ADR-0024、`src/client/editor-chunk.ts`、`src/client/yaml-check.ts`、`src/client/FileEditor.tsx`、`src/client/dialog-focus.ts`

## Context

文件编辑（ADR-0024）需要一个编辑器。dsh 平台原语里没有：`primitives.d.ts` 只有高亮、Markdown、菜单、分段控件；官方 `workspaceFiles` 服务的注释写明 "this service exposes no mutations"。所以必须引入依赖或自研。

备选方案：

- 原生 `textarea`：零依赖。但它没有行号和高亮，查找要另写，2 MiB 的文本整块进 DOM，手机上输入会卡。
- Monaco：功能最全，但体积数 MB，依赖 Web Worker 与自己的主题系统，与宿主变量对不上，手机输入法支持差。
- CodeMirror 6：模块化，可以只取高亮、行号、撤销、查找、缩进；按视口渲染，大文件只画可见行；用 `contenteditable` 承载输入，输入法组合由它处理；主题可以完全用 CSS 变量写。

## Decision

- 采用 CodeMirror 6，打进第二个懒加载 chunk `lib/client.editor.js`（注册 `chunk: "client.editor.js"`），与 mermaid chunk 同一包装（ADR-0004）。**主 bundle 只有 `FileEditor.tsx` 里一个 `require.async('./client.editor.js')` 引用点**；CodeMirror、`@lezer/*` 与 `yaml` 只能被 `editor-chunk.ts` / `yaml-check.ts` 导入，由 `architecture.test.mjs` 与 `scripts/assert-pack.mjs` 把住。
- 依赖 pin 精确版本进 devDependencies：`@codemirror/state` `view` `commands` `language` `search` `lang-json` `lang-xml` `lang-markdown` `lang-yaml` `legacy-modes`、`@lezer/highlight`、`yaml`。
- 扩展集只取行号、撤销历史、输入时缩进、括号匹配、当前行高亮、选中匹配、查找面板、自动换行与语言包；不要自动补全、括号自动闭合、折叠。Markdown 只用 `markdownLanguage`，不调 `markdown()`：后者会带进 HTML / CSS / JS 语法与标签补全。
- 语言映射：`json` / `xml` / `md` / `yaml` 用各自的语言包；`toml` 与 `properties` / `ini` / `cfg` / `.editorconfig` / `.env` 用 `legacy-modes` 的 toml 与 properties 模式；`txt` / `conf` / `.gitignore` / `.gitattributes` 为纯文本。
- 配色只用宿主变量：编辑器外观用 `--dsw-alias-*`，语法色用 `--shiki-token-*`，与只读源码视图同一套颜色。
- YAML 的保存前检查用 `yaml` 包的 `parseAllDocuments`，只看 `errors`，不看 `warnings`：CloudFormation 的 `!Ref` 一类自定义标签只产生 warning。它在 chunk 里，因为能点保存时 chunk 一定已加载。JSON 用自写的 RFC 8259 扫描定位第一处错误（V8 的 `JSON.parse` 报错常常不带位置），XML 用浏览器 `DOMParser`，都留在主 bundle 的纯模块 `edit-buffer.ts` 里。
- 键盘：Tab / Shift+Tab 缩进（`indentWithTab`，先按 Esc 再按 Tab 可移出编辑器），Ctrl/Cmd+S 保存，Esc 不退出编辑态。
- `dialog-focus.ts` 的焦点收容在 window 捕获阶段拦 Tab 与 Esc，先于 CodeMirror 执行。改为：目标在 `data-gp-keys-owner` 子树内的 Tab / Esc 在捕获阶段放行，冒泡阶段只有事件仍未被 `preventDefault` 时才执行原逻辑；另一个浮层里的按键也不再被它截走。全屏阅读器、弹窗、分支抽屉一起受益。
- 编辑器是内容的唯一持有者：React 只接收「是否已修改」，保存、暂存、离开时才读全文。视图挂载一次，换行与只读经 `Compartment` 切换，撤销栈不丢。

## Consequences

- 安装包多一个约 514 KB（gzip 约 172 KB）的 chunk，只在第一次点「编辑」时下载；主 bundle 不含编辑器代码。chunk 加载失败时提示并给「重试」，只读预览照常可用，不做 `textarea` 兜底（两套编辑器意味着键盘、缩进、守卫都要测两遍）。
- e2e 加载**真实** chunk（harness 的 `require.async` 以 `<script>` 装入 `client.editor.js`），所以 CodeMirror 本身在门禁里；mermaid 仍用桩。
- 移动端输入法（iOS Safari、Android Chrome + Gboard / 搜狗的组合输入、长按选区、粘贴）无头浏览器测不出，发版前须真机验证。
- 桌面上拖动侧栏跨档（stacked ↔ compact）会重挂编辑器：内容与光标从卸载前的报告恢复，撤销栈与焦点丢失。
- TOML / properties / ini 没有保存前检查：legacy mode 没有语法树，要另引解析器，留给后续单独评估体积。
