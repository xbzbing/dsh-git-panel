# ADR-0031：文件浏览按 Java/Kotlin 约定折叠包路径并投影源码根

- 状态：Accepted（2026-11-12）
- 相关：`src/host/package-tree.ts`、`src/host/queries.ts`（`queryDirList`）、`src/client/files-tree.tsx`、`src/client/FilesTab.tsx`、`test/unit/package-tree.test.mjs`、`test/e2e/files-package-tree.mjs`

## Context

Java 项目的标准布局是 `模块/src/main/java/com/example/demo/...`。文件浏览按真实目录懒加载时，从仓库根走到一个类要先展开 `src`、`main`、`java`、`com`、`example`、`demo` 六层，其中三层只是包名分段；同一个仓库里 `resources`、`test` 目录还要和这些分段混在同一层。IntelliJ 的 Compact Middle Packages、Eclipse 的 Package Presentation（Flat / Hierarchical）与 VS Code 的 `explorer.compactFolders` 都在解决同一件事：包是逻辑单位，不应和物理目录争夺层级。

文件浏览的现状是每次 `dir-list` 只取一层，client 不知道下一层有几个孩子，因此 `src/client/file-tree.ts` 里现成的单子目录折叠（用于变更列表的扁平路径）帮不上忙：折叠必须在 host 回答这一层时完成。通用折叠也不能直接套在 Java 布局上——`src` 同时有 `main` / `test`，`main` 同时有 `java` / `resources`，任何一条链都不会经过 `src/main/java`。

约束有四条：

- host 是文件系统的唯一权威，client 不直接读盘；新增信息只能是 `dir-list` 响应里的附加字段，旧 client 必须能忽略，旧 host 缺字段时新 client 必须回落到物理树。
- 本期只认约定，不读 `pom.xml` / `build.gradle` / classpath；构建文件可以声明任意源码根，解析它们是另一件事。
- 投影不能悄悄丢内容：`src` 下有文件、source set 下有文件、条目超过上限或父目录已被截断时，宁可显示物理树。
- 折叠的成本必须落在一次 `dir-list` 的有界预算内，不能为了美化一层目录发一串 RPC。

## Decision

**1. host 在 `dir-list` 响应里附加投影，client 用 `packages: true` 显式请求。** 只有请求带该标记、且配置 `compactPackages`（默认开启）为真时才计算；两个条件缺一即返回物理树。字段都是可选的：`DirEntry.sourceRoot?: true` 标记投影出来的源码根行，`DirEntry.chain?: { path, label }` 给出一条被折叠的包链。旧 host 忽略未知请求字段，旧 client 不发该字段，因此两端不需要能力位。

**2. 源码根投影：把 `src` 这一层换成它的孙辈行。** 列目录 `D` 时，若 `D` 不在任何源码根内、`D/src` 是目录且未被 Git 忽略，则读出 `src` 与 `main` / `test` / `androidTest` 的直接孩子：

- `src` 或某个 source set 下直接出现文件 → 放弃投影，保留 `src` 行；
- source set 的孩子投影为 `src/<set>/<child>`（`src/main/java`、`src/main/resources`、`src/test/java`），普通 `src` 孩子投影为 `src/<child>`；
- 投影结果里至少要有一条真正的源码根（`src/{main,test,androidTest}/{java,kotlin,scala,groovy}`），否则这是 `src/main/js` 一类的相似布局，仍显示物理树；
- 结果超过 64 行、或父层已截断、或并入后超过 `DIR_ENTRY_CAP` → 放弃投影。

**3. 包链折叠：在一行里合并连续的单子目录包。** 当被列的目录位于源码根内（含源码根本身）时，对每个目录条目向下走：目标目录恰好只有一个目录孩子、孩子名是合法包段（`^[\p{L}_$][\p{L}\p{N}_$]*$`）、realpath 仍在工作树内，才继续。停下时若链长大于 1，该行带 `chain.path`（最深层真实路径）与 `chain.label`（点号连接）。每条链最多 12 段；一次 listing 的目录读取与墙钟时间由所有行共享（32 次读取、120 ms），预算耗尽时保留已经折叠的前缀——它仍指向真实目录，展开即可看到剩余层级。

**4. client 按链的目标路径工作。** 折叠行的显示文本是 `chain.label`，展开状态、右键目标、点击加载的路径都是 `chain.path`（不是首段）；`title` 给出完整相对路径。源码根行保留完整相对路径作为文本（`name` 即 `src/main/java`），client 现有拼接逻辑无需新增寻址方式。配置开关翻转时整棵树从根重新开始并在途响应一律作废（旧形状的标签不会落进新树），选中文件与预览保留；粘性恢复缓存记录该设置，跨设置恢复同样只重建树——保留选中路径是未保存草稿能被接回的前提。

**5. 关闭开关回到物理树。** 配置页「视图」区新增“折叠 Java 包路径”开关，写入 `compactPackages`；关闭后 host 不再计算，client 也不再发 `packages`，行为与旧版本一致。

## Consequences

- Java/Kotlin 项目的文件浏览从六层压到三层：`src/main/java` 一行、`com.example.demo` 一行、类文件一行；`resources` 等普通目录仍是物理行，测试源码根与主源码根并列。其他语言的项目不受影响——没有约定尾缀就永远走物理树。
- 一次源码根 listing 最多多出 32 次目录读取，每跳带一次 realpath 包含检查（目标与根各一次，共 ≤64 次 `realpath`），通常只有 5–10 次；预算封顶且与展开动作重叠，没有常驻轮询。代价是宽而深的源码根里靠后的目录可能拿不到链，显示为普通目录——这是有意的降级，不报错。
- 投影出的源码根行与普通条目一样带 `.gitignore` 标记（多一次批量 `check-ignore`），只有链的中间跳不查（见上）。折叠丢掉的是中间层目录行：不能单独右键 `com` 或 `example`，右键目标是最深的那一层；需要中间层时关掉开关。路径复制、Git 历史、文件属性都使用真实路径，不受显示名影响。链的中间跳不查 `.gitignore`（只查首段，来自父层列表的忽略标记），因此一条被忽略的深层包目录仍可能被折进链里；展开后那一层的条目照常带忽略标记。
- 布局判定完全基于路径约定，不看构建文件；自定义源码根（Maven `build-helper`、Gradle `sourceSets`、Kotlin Multiplatform）不会被识别，显示为物理树。要支持它们需要读构建清单，属于另一个决策。
- 新增字段是纯附加的：旧 client 与旧 host 组合、任一端旧版本都不会误读；客户端请求标记由新 client 发出，旧 host 忽略。没有服务键或端点变化。
- 配置默认开启意味着升级后 Java 项目的树形立即变化；开关和 ADR 是回退路径。README、插件详情页与八份 DETAIL 已同步说明。
